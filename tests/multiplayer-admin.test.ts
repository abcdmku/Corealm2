import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey, type SigningKey } from "../identity/src/joinToken.js";
import { ADMIN_SESSION_MS, hashSecret } from "../game/src/multiplayer/adminStorage.js";
import { MemoryAdminStorage, type MemoryPlayerRow } from "../game/src/multiplayer/playerTables.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { guestAuthentication } from "../game/src/multiplayer/guestAuthentication.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ADMIN = "acc_DDDDDDDDDDDDDDDDDDDDDD";
const ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const DEVDOCS = "https://devdocs.example.com";
const world = (worldId: string, capacity = 4): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity, availability: "available" });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A stand-in for the identity service: real Ed25519 keys, one shared clock, no network. */
function identity(clock: { ms: number }) {
  const published: IdentityKey[] = []; let signing!: SigningKey;
  const created = createSigningKey(); signing = created.signing;
  published.push({ kid: signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" });
  const fetchKeys = (async () => new Response(JSON.stringify({ keys: published }))) as typeof fetch;
  return { fetch: fetchKeys, token: (accountId: string, name: string, endpoint: string) =>
    signJoinToken(signing, joinTokenClaims({ accountId, name, endpoint, issuedAt: clock.ms / 1000 })) };
}

async function serve(options: { file?: string; ownerAccount?: string; clock?: { ms: number }; sources?: Record<string, unknown> } = {}) {
  const clock = options.clock ?? { ms: Date.now() };
  const id = identity(clock);
  const logs: Record<string, unknown>[] = [];
  const storage = new SqliteWorldStorage(options.file ?? ":memory:", { log: () => {} });
  if (options.sources) await seedCatalog(storage.catalog, { catalog: RESOLVED_CATALOG, sources: options.sources }, () => {}, { now: () => clock.ms });
  const server = await startReferenceServer({
    worlds: [world("north"), world("south")], storage, admin: storage.admin, ...(options.sources ? { catalog: storage.catalog } : {}), build: () => createMultiplayerLabWorld(),
    allowedOrigins: [DEVDOCS], now: () => clock.ms, log: event => logs.push(event),
    ...(options.ownerAccount ? { ownerAccount: options.ownerAccount } : {}),
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: id.fetch, now: () => clock.ms }),
  });
  let closed = false; const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanups.push(close);
  const endpoint = `ws://127.0.0.1:${server.port}/`;
  const token = (accountId: string, name = "Player") => id.token(accountId, name, endpoint);
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown; raw?: string; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.origin) headers.Origin = init.origin;
    if (init.body !== undefined || init.raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET", headers,
      ...(init.raw !== undefined ? { body: init.raw } : init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as any : null };
  };
  /** Take the owner role with the printed code, and return the session it hands back. */
  const claimOwner = async (accountId = OWNER) => {
    const code = logs.find(line => line.event === "owner-setup-code")?.code as string;
    const answer = await call("/admin/setup", { method: "POST", body: { token: token(accountId, "Owner"), code } });
    expect(answer.status).toBe(200);
    return answer.body.session as string;
  };
  const signIn = async (accountId: string, name = "Player") => {
    const answer = await call("/admin/session", { method: "POST", body: { token: token(accountId, name) } });
    return answer;
  };
  return { server, storage, logs, endpoint, token, call, claimOwner, signIn, clock, close };
}

/** One raw client. Resolves with the server's first verdict: `joined` or `error`. */
async function connect(port: number, worldId: string, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`); const messages: any[] = [];
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  cleanups.push(async () => { ws.terminate(); });
  await new Promise<void>(resolve => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token, protocolVersion: WORLD_PROTOCOL_VERSION }));
  await expect.poll(() => messages.some(message => message.type === "joined" || message.type === "error"), { timeout: 3000, interval: 5 }).toBe(true);
  const verdict = messages.find(message => message.type === "joined" || message.type === "error");
  return { ws, messages, verdict, error: verdict.type === "error" ? verdict.error : null };
}
const temporary = () => {
  const file = join(tmpdir(), `corealm-admin-${randomUUID()}.sqlite`);
  cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
  return file;
};

describe("becoming the owner of a server", () => {
  it("prints one setup code, spends it exactly once, and stops printing once an owner exists", async () => {
    const file = temporary();
    const first = await serve({ file });
    const printed = first.logs.filter(line => line.event === "owner-setup-code");
    expect(printed).toHaveLength(1);
    expect(printed[0]!.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);

    const code = printed[0]!.code as string;
    const claimed = await first.call("/admin/setup", { method: "POST", body: { token: first.token(OWNER, "Owner"), code } });
    expect(claimed.status).toBe(200);
    expect({ accountId: claimed.body.accountId, name: claimed.body.name, role: claimed.body.role })
      .toEqual({ accountId: OWNER, name: "Owner", role: "owner" });
    expect(claimed.body.session).toMatch(/^cas_[A-Za-z0-9_-]{43}$/);

    // The code is gone, including for the account that already used it.
    const again = await first.call("/admin/setup", { method: "POST", body: { token: first.token(BOB, "Bob"), code } });
    expect(again.status).toBe(403);
    expect(again.body).toEqual({ error: { code: "forbidden", message: "The setup code is not valid" } });
    expect((await first.call("/admin/roles", { token: claimed.body.session })).body.roles.map((role: any) => [role.accountId, role.role]))
      .toEqual([[OWNER, "owner"]]);
    await first.close();

    const second = await serve({ file });
    expect(second.logs.filter(line => line.event === "owner-setup-code")).toEqual([]);
  });

  it("rate-limits wrong codes and never says which part was wrong", async () => {
    const { call, token } = await serve();
    const wrong = "00000-00000-00000-00000";
    const answers = [];
    for (let attempt = 0; attempt < 6; attempt++) answers.push(await call("/admin/setup", { method: "POST", body: { token: token(BOB, "Bob"), code: wrong } }));
    expect(answers.map(answer => answer.status)).toEqual([403, 403, 403, 403, 403, 429]);
    expect(answers[5]!.body).toEqual({ error: { code: "rate_limited", message: "Too many setup attempts" } });
  });

  it("takes the owner from configuration, prints no code, and audits it as a config write", async () => {
    const { logs, call, signIn } = await serve({ ownerAccount: OWNER });
    expect(logs.filter(line => line.event === "owner-setup-code")).toEqual([]);
    expect(logs.find(line => line.event === "admin.owner")).toEqual({ event: "admin.owner", accountId: OWNER, via: "config" });
    const session = (await signIn(OWNER, "Owner")).body.session;
    expect((await call("/admin/audit", { token: session })).body.entries.map((entry: any) => [entry.credential, entry.action, entry.target]))
      .toEqual([["login", "session.create", OWNER], ["config", "role.set", OWNER]]);
  });
});

describe("admin sessions and API tokens", () => {
  it("issues a session only to a role holder, and refuses bad, foreign and revoked credentials", async () => {
    const { call, claimOwner, signIn, token, endpoint, clock } = await serve();
    const owner = await claimOwner();
    expect((await call("/admin/me", { token: owner })).body)
      .toEqual({ credential: "session", accountId: OWNER, tokenId: null, role: "owner", scopes: ["content:read", "content:publish", "players:read", "players:write", "stats:read"],
        server: { name: "Corealm server", endpoint, assetBaseUrl: null, identityUrl: null, catalogRevision: RESOLVED_CATALOG.revision } });

    const stranger = await signIn(ALICE, "Alice");
    expect(stranger.status).toBe(403);
    expect(stranger.body).toEqual({ error: { code: "forbidden", message: "This account holds no role on this server" } });

    expect((await call("/admin/me", { token: "cas_not-a-session" })).status).toBe(401);
    expect((await call("/admin/me")).body).toEqual({ error: { code: "unauthorized", message: "An admin session or API token is required" } });
    const elsewhere = await call("/admin/session", { method: "POST", body: { token: signJoinToken(createSigningKey().signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint, issuedAt: clock.ms / 1000 })) } });
    expect(elsewhere.status).toBe(401);

    // An admin the owner granted signs in; after the owner revokes the role the session is dead.
    expect((await call(`/admin/roles/${ADMIN}`, { method: "PUT", token: owner, body: { role: "admin" } })).status).toBe(200);
    const admin = await signIn(ADMIN, "Dee");
    expect(admin.body.role).toBe("admin");
    expect((await call("/admin/roles", { token: admin.body.session })).status).toBe(200);
    expect((await call(`/admin/roles/${ADMIN}`, { method: "DELETE", token: owner })).status).toBe(200);
    expect((await call("/admin/me", { token: admin.body.session })).status).toBe(401);

    // Signing out kills the presenting session and nothing else.
    expect((await call("/admin/session", { method: "DELETE", token: owner })).body).toEqual({ ok: true });
    expect((await call("/admin/me", { token: owner })).status).toBe(401);
    expect((await signIn(OWNER, "Owner")).status).toBe(200);
    expect((await call("/admin/me", { token: token(OWNER, "Owner") })).status).toBe(401);
  });

  it("expires a session twelve hours after it was issued", async () => {
    const clock = { ms: Date.parse("2026-09-20T00:00:00Z") };
    const { call, claimOwner } = await serve({ clock });
    const owner = await claimOwner();
    clock.ms += ADMIN_SESSION_MS - 1000;
    expect((await call("/admin/me", { token: owner })).status).toBe(200);
    clock.ms += 2000;
    expect((await call("/admin/me", { token: owner })).body)
      .toEqual({ error: { code: "unauthorized", message: "This admin session has expired or was revoked" } });
  });

  it("shows an API token secret once, stores only its hash, and never lets a token mint another", async () => {
    const file = temporary();
    const { call, claimOwner, close } = await serve({ file });
    const owner = await claimOwner();
    const created = await call("/admin/tokens", { method: "POST", token: owner, body: { label: "export", scopes: ["content:read", "stats:read"] } });
    expect(created.status).toBe(201);
    const secret: string = created.body.token;
    expect(secret).toMatch(/^cat_[A-Za-z0-9_-]{43}$/);
    expect({ label: created.body.label, scopes: created.body.scopes, createdBy: created.body.createdBy, lastUsedAt: created.body.lastUsedAt, expiresAt: created.body.expiresAt })
      .toEqual({ label: "export", scopes: ["content:read", "stats:read"], createdBy: OWNER, lastUsedAt: null, expiresAt: null });

    const listed = await call("/admin/tokens", { token: owner });
    expect(listed.body.tokens).toHaveLength(1);
    expect(Object.keys(listed.body.tokens[0]).sort()).toEqual(["createdAt", "createdBy", "expiresAt", "id", "label", "lastUsedAt", "scopes"]);

    // A token is not a session: it cannot mint tokens, grant roles or read the audit log.
    expect((await call("/admin/tokens", { method: "POST", token: secret, body: { label: "self", scopes: ["content:read"] } })).body)
      .toEqual({ error: { code: "forbidden", message: "This endpoint requires an admin session, not an API token" } });
    expect((await call(`/admin/roles/${ADMIN}`, { method: "PUT", token: secret, body: { role: "admin" } })).status).toBe(403);
    expect((await call("/admin/audit", { token: secret })).status).toBe(403);
    expect((await call("/admin/me", { token: secret })).body)
      .toMatchObject({ credential: "token", accountId: OWNER, tokenId: created.body.id, role: null, scopes: ["content:read", "stats:read"] });

    // A revoked token is refused at once; a live one keeps working until it is.
    const spare: string = (await call("/admin/tokens", { method: "POST", token: owner, body: { label: "spare", scopes: ["stats:read"] } })).body.token;
    expect((await call(`/admin/tokens/${created.body.id}`, { method: "DELETE", token: owner })).body).toEqual({ ok: true });
    expect((await call("/admin/stats", { token: secret })).body)
      .toEqual({ error: { code: "unauthorized", message: "This API token has expired or was revoked" } });
    expect((await call("/admin/stats", { token: spare })).status).toBe(200);
    await close();

    // Open the database with nothing of ours running: only a SHA-256 digest of the secret is there.
    const database = new DatabaseSync(file);
    const rows = database.prepare("SELECT id, token_hash, label FROM api_tokens").all().map(row => ({ ...row }));
    database.close();
    expect(rows).toEqual([{ id: expect.any(String), label: "spare", token_hash: createHash("sha256").update(spare, "utf8").digest("hex") }]);
    expect(readFileSync(file).includes(spare)).toBe(false);
  });
});

describe("bans", () => {
  it("blocks a join and an admin session, kicks the account off, and stops applying when it expires", async () => {
    const clock = { ms: Date.parse("2026-09-20T00:00:00Z") };
    const { server, call, signIn, token } = await serve({ ownerAccount: OWNER, clock });
    const owner = (await signIn(OWNER, "Owner")).body.session;
    expect((await call(`/admin/roles/${ALICE}`, { method: "PUT", token: owner, body: { role: "admin" } })).status).toBe(200);

    const playing = await connect(server.port, "north", token(ALICE, "Alice"));
    expect(playing.verdict.type).toBe("joined");
    const gone = new Promise(resolve => playing.ws.once("close", resolve));

    const banned = await call("/admin/bans", { method: "POST", token: owner, body: { accountId: ALICE, reason: "Griefing", expiresAt: clock.ms + 60_000 } });
    expect(banned.status).toBe(200);
    expect(banned.body.kicked).toBe(true);
    expect({ accountId: banned.body.ban.accountId, reason: banned.body.ban.reason, bannedBy: banned.body.ban.bannedBy })
      .toEqual({ accountId: ALICE, reason: "Griefing", bannedBy: OWNER });
    await gone;
    expect(playing.messages.at(-1)).toEqual({ type: "error", error: { code: "BANNED", message: "Banned from this server until 2026-09-20T00:01:00.000Z: Griefing" } });

    expect((await connect(server.port, "north", token(ALICE, "Alice"))).error)
      .toEqual({ code: "BANNED", message: "Banned from this server until 2026-09-20T00:01:00.000Z: Griefing" });
    expect((await signIn(ALICE, "Alice")).body).toEqual({ error: { code: "forbidden", message: "This account is banned from this server" } });
    expect((await call("/admin/bans", { token: owner })).body.bans.map((ban: any) => ban.accountId)).toEqual([ALICE]);

    // The lease the kicked session held was released through the ordinary leave path.
    await expect.poll(() => (server.worlds.get(JSON.stringify(["reference", "north"]))!).leases.size, { timeout: 3000, interval: 10 }).toBe(0);

    clock.ms += 61_000;
    expect((await call("/admin/bans", { token: owner })).body.bans).toEqual([]);
    expect((await connect(server.port, "north", token(ALICE, "Alice"))).verdict.type).toBe("joined");
    expect((await signIn(ALICE, "Alice")).body.role).toBe("admin");
  }, 20_000);

  it("lifts a ban on request and refuses to ban the owner", async () => {
    const { call, claimOwner } = await serve();
    const owner = await claimOwner();
    expect((await call("/admin/bans", { method: "POST", token: owner, body: { accountId: OWNER, reason: "no" } })).body)
      .toEqual({ error: { code: "conflict", message: "An owner cannot be banned" } });
    expect((await call("/admin/bans", { method: "POST", token: owner, body: { accountId: BOB, reason: "Spam" } })).status).toBe(200);
    expect((await call(`/admin/bans/${BOB}`, { method: "DELETE", token: owner })).body).toEqual({ ok: true });
    expect((await call(`/admin/bans/${BOB}`, { method: "DELETE", token: owner })).body)
      .toEqual({ error: { code: "not_found", message: "That account is not banned" } });
  });
});

describe("roles", () => {
  it("keeps the last owner, and lets no admin demote an owner", async () => {
    const { call, claimOwner, signIn } = await serve();
    const owner = await claimOwner();
    expect((await call(`/admin/roles/${ADMIN}`, { method: "PUT", token: owner, body: { role: "admin" } })).body.role)
      .toMatchObject({ accountId: ADMIN, role: "admin", grantedBy: OWNER });
    const admin = (await signIn(ADMIN, "Dee")).body.session;

    // An admin holds a session but not role management.
    expect((await call(`/admin/roles/${OWNER}`, { method: "DELETE", token: admin })).body)
      .toEqual({ error: { code: "forbidden", message: "Only the owner manages roles" } });
    expect((await call(`/admin/roles/${BOB}`, { method: "PUT", token: admin, body: { role: "admin" } })).status).toBe(403);

    expect((await call(`/admin/roles/${OWNER}`, { method: "DELETE", token: owner })).body)
      .toEqual({ error: { code: "conflict", message: "The last owner cannot be removed" } });
    expect((await call(`/admin/roles/${OWNER}`, { method: "PUT", token: owner, body: { role: "admin" } })).body)
      .toEqual({ error: { code: "conflict", message: "An owner cannot be demoted" } });
    expect((await call(`/admin/roles/${BOB}`, { method: "PUT", token: owner, body: { role: "owner" } })).body)
      .toEqual({ error: { code: "invalid_request", message: "Only the admin role can be granted" } });
    expect((await call("/admin/roles/not-an-account", { method: "DELETE", token: owner })).status).toBe(400);
  });
});

describe("the audit log", () => {
  it("records exactly one row for every admin write, newest first, with before and after", async () => {
    const { call, claimOwner } = await serve();
    const owner = await claimOwner();
    await call(`/admin/roles/${ADMIN}`, { method: "PUT", token: owner, body: { role: "admin" } });
    const token = await call("/admin/tokens", { method: "POST", token: owner, body: { label: "ci", scopes: ["content:publish"] } });
    await call("/admin/bans", { method: "POST", token: owner, body: { accountId: BOB, reason: "Spam" } });
    await call(`/admin/bans/${BOB}`, { method: "DELETE", token: owner });
    await call(`/admin/tokens/${token.body.id}`, { method: "DELETE", token: owner });
    await call(`/admin/roles/${ADMIN}`, { method: "DELETE", token: owner });

    const entries = (await call("/admin/audit", { token: owner })).body.entries;
    expect(entries.map((entry: any) => [entry.credential, entry.action, entry.target])).toEqual([
      ["session", "role.revoke", ADMIN], ["session", "token.revoke", token.body.id], ["session", "ban.remove", BOB],
      ["session", "ban.set", BOB], ["session", "token.create", token.body.id], ["session", "role.set", ADMIN],
      ["login", "session.create", OWNER], ["setup", "owner.setup", OWNER],
    ]);
    expect(entries.every((entry: any) => entry.accountId === OWNER)).toBe(true);
    expect(entries.find((entry: any) => entry.action === "role.revoke")).toMatchObject({ before: { role: "admin" }, after: null });
    expect(entries.find((entry: any) => entry.action === "ban.set")).toMatchObject({ before: null, after: { reason: "Spam", expiresAt: null } });
    expect(entries.find((entry: any) => entry.action === "token.create")).toMatchObject({ after: { label: "ci", scopes: ["content:publish"], expiresAt: null } });

    // Paging walks backwards from an id the previous page ended on.
    const page = (await call("/admin/audit?limit=2", { token: owner })).body.entries;
    expect(page.map((entry: any) => entry.action)).toEqual(["role.revoke", "token.revoke"]);
    expect((await call(`/admin/audit?limit=2&before=${page[1].id}`, { token: owner })).body.entries.map((entry: any) => entry.action))
      .toEqual(["ban.remove", "ban.set"]);
  });
});

describe("stats and players", () => {
  it("answers 401 without a credential, 403 for a token without the scope, and 200 for a session or stats:read", async () => {
    const { server, call, claimOwner, token } = await serve({ });
    expect((await call("/admin/stats")).status).toBe(401);
    const owner = await claimOwner();
    const reader = (await call("/admin/tokens", { method: "POST", token: owner, body: { label: "reader", scopes: ["content:read"] } })).body.token;
    const watcher = (await call("/admin/tokens", { method: "POST", token: owner, body: { label: "watcher", scopes: ["stats:read"] } })).body.token;
    expect((await call("/admin/stats", { token: reader })).body)
      .toEqual({ error: { code: "forbidden", message: "This credential is missing the stats:read scope" } });

    const playing = await connect(server.port, "north", token(ALICE, "Alice"));
    expect(playing.verdict.type).toBe("joined");
    await expect.poll(async () => (await call("/admin/stats", { token: watcher })).body.tick.samples, { timeout: 5000, interval: 50 }).toBeGreaterThan(0);

    const stats = (await call("/admin/stats", { token: owner })).body;
    expect(Object.keys(stats).sort()).toEqual(["backlogDisconnects", "bytesOut", "bytesOutPerSecond", "catalogRevision", "commands", "errors", "events",
      "memory", "rejected", "server", "stages", "startedAt", "tick", "uptimeSeconds", "worlds"]);
    expect(stats.worlds.map((entry: any) => [entry.worldId, entry.playersOnline, entry.capacity]))
      .toEqual([["north", 1, 4], ["south", 0, 4]]);
    expect(Object.keys(stats.tick).sort()).toEqual(["lastMs", "maxMs", "meanMs", "p95Ms", "samples"]);
    expect(Object.keys(stats.stages).sort()).toEqual(["commitMs", "replicationMs", "samples", "simulationMs", "snapshotMs"]);
    expect(Object.keys(stats.memory).sort()).toEqual(["heapUsedBytes", "rssBytes"]);
    expect(stats.memory.rssBytes).toBeGreaterThan(0);
    expect(stats.events.map((event: any) => [event.kind, event.accountId, event.detail]))
      .toEqual([["owner-setup", OWNER, null], ["admin-session", OWNER, "owner"], ["join", ALICE, "north"]]);
  }, 20_000);

  it("reads a player from storage, and from the world holding them while they are online", async () => {
    const { server, call, claimOwner, token } = await serve();
    const owner = await claimOwner();
    const playing = await connect(server.port, "north", token(ALICE, "Alice"));
    expect(playing.verdict.type).toBe("joined");
    const live = server.worlds.get(JSON.stringify(["reference", "north"]))!.runtime.players.get(ALICE)!.store.get();
    live.currency = 91; live.inventory.slots[3] = { itemId: "grithe_ore", quantity: 2, slotIndex: 3 };

    const listed = (await call(`/admin/players?query=Ali`, { token: owner })).body;
    expect(listed.players.map((player: any) => [player.accountId, player.name, player.online?.worldId])).toEqual([[ALICE, "Alice", "north"]]);
    expect(listed.cursor).toBeNull();
    expect((await call("/admin/players?query=nobody", { token: owner })).body.players).toEqual([]);

    // Online: the answer comes from the running world, not the row the last commit wrote.
    const detail = (await call(`/admin/players/${ALICE}`, { token: owner })).body;
    expect(Object.keys(detail).sort()).toEqual(["accountId", "ban", "bank", "currency", "equipment", "firstSeen", "inventory",
      "lastSeen", "lastWorld", "name", "online", "playtimeSeconds", "position", "regionId", "revision", "skills"]);
    expect(detail.currency).toBe(91);
    expect(detail.inventory[3]).toEqual({ itemId: "grithe_ore", quantity: 2, slotIndex: 3 });
    expect(detail.online).toEqual({ providerId: "reference", worldId: "north" });
    expect(detail.ban).toBeNull();
    expect(detail.skills.mining).toMatchObject({ level: 1 });
    expect((await call(`/admin/players/${BOB}`, { token: owner })).body)
      .toEqual({ error: { code: "not_found", message: "No such player on this server" } });
  }, 20_000);
});

describe("content reads", () => {
  it("gives content:read the active revision, its history and the source collections of any stored revision", async () => {
    const clock = { ms: 1_800_000_000_000 };
    const sources = { items: [{ id: "lantern", name: "Lantern" }], "balance/sets": { thresholds: [2, 4] } };
    const { call, claimOwner } = await serve({ clock, sources });
    const owner = await claimOwner();
    const revision = RESOLVED_CATALOG.revision;
    expect((await call("/admin/content/revision")).status).toBe(401);
    const watcher = (await call("/admin/tokens", { method: "POST", token: owner, body: { label: "watcher", scopes: ["stats:read"] } })).body.token;
    expect((await call("/admin/content/revision", { token: watcher })).body)
      .toEqual({ error: { code: "forbidden", message: "This credential is missing the content:read scope" } });
    const exporter = (await call("/admin/tokens", { method: "POST", token: owner, body: { label: "export", scopes: ["content:read"] } })).body.token;
    const active = await call("/admin/content/revision", { token: exporter });
    expect(active.headers.get("cache-control")).toBe("no-store");
    expect(active.body).toEqual({ revision, history: [{ id: 1, revision, previous: null, by: "seed", at: clock.ms }] });
    // The reply carries the revision of each collection, by the function a publish checks against,
    // so no client ever has to hash one itself.
    const revisions = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, collectionRevision(value)]));
    expect((await call("/admin/content/sources", { token: exporter })).body).toEqual({ revision, revisions, sources });
    expect((await call(`/admin/content/sources?revision=${revision}`, { token: owner })).body).toEqual({ revision, revisions, sources });
    expect((await call(`/admin/content/sources?revision=${"0".repeat(64)}`, { token: exporter })).status).toBe(404);
    expect((await call("/admin/content/sources?revision=latest", { token: exporter })).body)
      .toEqual({ error: { code: "invalid_request", message: "A revision is 64 lowercase hex characters" } });
    expect((await call("/admin/content/revision?limit=0", { token: exporter })).status).toBe(400);
  });
});

describe("the admin API boundary", () => {
  it("allows exactly the configured origin, caps bodies, rejects malformed JSON and never caches", async () => {
    const { call, claimOwner } = await serve();
    const owner = await claimOwner();
    const preflight = await call("/admin/session", { method: "OPTIONS", origin: DEVDOCS });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(DEVDOCS);
    expect(preflight.headers.get("access-control-allow-headers")).toBe("authorization, content-type");

    const foreign = await call("/admin/session", { method: "OPTIONS", origin: "https://evil.example.com" });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("/admin/stats", { token: owner, origin: "https://evil.example.com" })).headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("/admin/stats", { token: owner, origin: DEVDOCS })).headers.get("access-control-allow-origin")).toBe(DEVDOCS);
    expect((await call("/admin/stats", { token: owner })).headers.get("cache-control")).toBe("no-store");

    expect((await call("/admin/tokens", { method: "POST", token: owner, raw: "not json" })).body)
      .toEqual({ error: { code: "invalid_request", message: "A JSON object body is required" } });
    expect((await call("/admin/tokens", { method: "POST", token: owner, raw: "[1,2,3]" })).status).toBe(400);
    expect((await call("/admin/tokens", { method: "POST", token: owner, body: { label: "x", scopes: ["content:delete"] } })).body)
      .toEqual({ error: { code: "invalid_scope", message: 'Unknown scope "content:delete"' } });
    expect((await call("/admin/tokens", { method: "POST", token: owner, body: { label: "x", scopes: [] } })).status).toBe(400);
    expect((await call("/admin/tokens", { method: "POST", token: owner, raw: JSON.stringify({ label: "x".repeat(20_000) }) })).body)
      .toEqual({ error: { code: "payload_too_large", message: "Request bodies are capped at 8 KiB" } });
    expect((await call("/admin/players?limit=9999", { token: owner })).status).toBe(400);
    expect((await call("/admin/players/a/b/c", { token: owner })).body).toEqual({ error: { code: "not_found", message: "No such admin endpoint" } });

    // The public endpoints stay exactly as they were.
    expect((await call("/healthz")).body).toEqual({ ready: true });
    expect((await call("/worlds")).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("keeps the same rules in the memory adapter, which tests and keepless hosts use", async () => {
    const rows: MemoryPlayerRow[] = [
      { accountId: ALICE, name: "Alice", character: null, lastWorld: null, firstSeen: 10, lastSeen: 30, playtimeSeconds: 0, online: { providerId: "reference", worldId: "north" } },
      { accountId: BOB, name: "Bob", character: null, lastWorld: null, firstSeen: 10, lastSeen: 20, playtimeSeconds: 0, online: null },
    ];
    const admin = new MemoryAdminStorage(() => rows);
    const owner = { accountId: OWNER, credential: "session", at: 1000 };
    await admin.setSetupCodeHash(hashSecret("SECRET"));
    expect(await admin.claimSetupCode(hashSecret("WRONG"), { accountId: BOB, credential: "setup", at: 500 })).toBeNull();
    expect(await admin.claimSetupCode(hashSecret("SECRET"), { accountId: OWNER, credential: "setup", at: 500 })).toMatchObject({ accountId: OWNER, role: "owner" });
    expect(await admin.claimSetupCode(hashSecret("SECRET"), { accountId: BOB, credential: "setup", at: 600 })).toBeNull();

    await admin.setBan({ accountId: ALICE, reason: "Spam", expiresAt: 2000 }, owner);
    expect((await admin.banOf(ALICE, 1999))?.reason).toBe("Spam");
    expect(await admin.banOf(ALICE, 2000)).toBeNull();
    expect(await admin.listBans(2000)).toEqual([]);

    await admin.createApiToken({ id: "tok_one", hash: hashSecret("cat_one"), label: "ci", scopes: ["stats:read"], expiresAt: 3000 }, owner);
    expect((await admin.useApiToken(hashSecret("cat_one"), 2500))?.lastUsedAt).toBe(2500);
    expect(await admin.useApiToken(hashSecret("cat_one"), 3000)).toBeNull();
    expect(await admin.revokeApiToken("tok_one", owner)).toBe(true);
    expect(await admin.useApiToken(hashSecret("cat_one"), 2500)).toBeNull();

    expect((await admin.audit(50, null)).map(entry => [entry.credential, entry.action, entry.target])).toEqual([
      ["session", "token.revoke", "tok_one"], ["session", "token.create", "tok_one"], ["session", "ban.set", ALICE], ["setup", "owner.setup", OWNER]]);

    const first = await admin.listPlayers(null, 1, null, 0);
    expect(first.players.map(player => [player.accountId, player.online?.worldId])).toEqual([[ALICE, "north"]]);
    expect(first.cursor).toBe(`30.${ALICE}`);
    expect((await admin.listPlayers(null, 1, first.cursor, 0)).players.map(player => player.accountId)).toEqual([BOB]);
    expect((await admin.listPlayers("bo", 10, null, 0)).players.map(player => player.name)).toEqual(["Bob"]);
    expect(await admin.player("acc_missing", 0)).toBeNull();
  });

  it("answers 501 on every admin path when the host does not use accounts", async () => {
    const storage = new MemoryWorldStorage();
    const server = await startReferenceServer({ worlds: [world("north")], storage, admin: storage.admin,
      build: () => createMultiplayerLabWorld(), authentication: guestAuthentication });
    cleanups.push(() => server.close());
    const answer = await fetch(`http://127.0.0.1:${server.port}/admin/session`, { method: "POST" });
    expect(answer.status).toBe(501);
    expect(await answer.json()).toEqual({ error: { code: "admin_unavailable",
      message: "Administration needs account authentication. Start this host with an identity service URL." } });
    expect((await fetch(`http://127.0.0.1:${server.port}/worlds`)).status).toBe(200);
  });
});
