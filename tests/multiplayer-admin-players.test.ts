import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { directoryAdminUi } from "../game/src/multiplayer/adminUi.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const IDENTITY = "https://identity.test/", ASSETS = "https://cdn.test/corealm/";
const world = (worldId: string): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available", assetBaseUrl: ASSETS });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const temporary = (name: string) => {
  const path = join(tmpdir(), `corealm-m5-${randomUUID()}-${name}`);
  cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(path + suffix, { force: true, recursive: true }); });
  return path;
};

const signing = createSigningKey();
const keys: IdentityKey[] = [{ kid: signing.signing.kid, alg: "EdDSA", publicKey: signing.publicKey, status: "active" }];

async function serve(options: { file?: string; ui?: string | null; registered?: { url: string; body: any }[]; memory?: boolean } = {}) {
  const storage = options.memory ? new MemoryWorldStorage() : new SqliteWorldStorage(options.file ?? ":memory:", { log: () => {} });
  const logs: Record<string, unknown>[] = [];
  const server = await startReferenceServer({
    worlds: [world("north"), world("south")], storage, admin: storage.admin, build: () => createMultiplayerLabWorld(), ownerAccount: OWNER,
    log: event => logs.push(event), identityUrl: IDENTITY, adminUi: options.ui ? directoryAdminUi(options.ui) : null,
    directory: { fetch: (async (url: URL, init: RequestInit) => { options.registered?.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response('{"ok":true}'); }) as unknown as typeof fetch },
    authentication: await createIdentityAuthentication({ identityUrl: IDENTITY, fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }),
  });
  let closed = false; const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanups.push(close);
  const endpoint = `ws://127.0.0.1:${server.port}/`;
  const token = (accountId: string, name: string) => signJoinToken(signing.signing, joinTokenClaims({ accountId, name, endpoint, issuedAt: Date.now() / 1000 }));
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET", redirect: "manual",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: response.headers.get("content-type")?.startsWith("application/json") && text ? JSON.parse(text) as any : null };
  };
  const owner = (await call("/admin/session", { method: "POST", body: { token: token(OWNER, "Owner") } })).body.session as string;
  const apiToken = async (scopes: string[]) => (await call("/admin/tokens", { method: "POST", token: owner, body: { label: scopes.join(), scopes } })).body.token as string;
  const audit = async (query = "") => (await call(`/admin/audit?${query}`, { token: owner })).body.entries as any[];
  const player = async (accountId: string) => (await call(`/admin/players/${accountId}`, { token: owner })).body;
  return { server, storage, logs, endpoint, token, call, owner, apiToken, audit, player, close };
}

async function connect(port: number, worldId: string, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`); const messages: any[] = [];
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  cleanups.push(async () => { ws.terminate(); });
  await new Promise<void>(resolve => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token, protocolVersion: WORLD_PROTOCOL_VERSION }));
  await expect.poll(() => messages.some(message => message.type === "joined" || message.type === "error"), { timeout: 3000, interval: 5 }).toBe(true);
  const verdict = messages.find(message => message.type === "joined" || message.type === "error");
  if (verdict.type === "joined") await expect.poll(() => messages.some(message => message.type === "update" && message.update.snapshot), { timeout: 3000, interval: 5 }).toBe(true);
  const snapshot = () => messages.find(message => message.type === "update" && message.update.snapshot)?.update.privateState;
  const deltas = (field: string) => messages.filter(message => message.type === "update" && message.update.privateDelta?.[field] !== undefined).map(message => message.update.privateDelta[field]);
  const closedWith = new Promise<number>(resolve => ws.once("close", code => resolve(code)));
  return { ws, messages, verdict, snapshot, deltas, closedWith };
}
/** Leave on purpose and wait until the server has saved the player and freed the account. */
async function leave(client: Awaited<ReturnType<typeof connect>>, served: Awaited<ReturnType<typeof serve>>, accountId: string) {
  client.ws.send(JSON.stringify({ type: "leave" })); await client.closedWith;
  await expect.poll(async () => (await served.player(accountId)).online, { timeout: 3000, interval: 20 }).toBeNull();
  await expect.poll(() => [...served.server.worlds.values()].some(hosted => hosted.leases.has(accountId)), { timeout: 3000, interval: 10 }).toBe(false);
}
const stack = (slot: any) => slot && [slot.itemId, slot.quantity];

describe("editing a player who is online", () => {
  it("changes the live player, sends their client the private delta, audits it in the commit, and survives a restart", async () => {
    const file = temporary("online.sqlite");
    const first = await serve({ file });
    const alice = await connect(first.server.port, "north", first.token(ALICE, "Alice"));
    expect(alice.snapshot().inventory.slots.slice(0, 6).map(stack)).toEqual([["worn_sword", 1], ["worn_hatchet", 1], ["worn_pickaxe", 1], ["worn_rod", 1], ["air_essence", 50], null]);
    const before = await first.player(ALICE);
    expect(before.revision).toMatch(/^[0-9a-f]{16}$/);

    const edited = await first.call(`/admin/players/${ALICE}`, { method: "PATCH", token: first.owner, body: { expect: { revision: before.revision }, ops: [
      { op: "inventory.add", itemId: "pale_quartz", quantity: 7 }, { op: "inventory.add", itemId: "crown_trout", quantity: 2 },
      { op: "inventory.remove", itemId: "air_essence", quantity: 20 }, { op: "currency.set", amount: 500 },
      { op: "skill.setXp", skill: "mining", xp: 1000 }, { op: "equipment.set", slot: "accessory1", itemId: "crafted_ring_t40" }] } });
    expect(edited.status).toBe(200);
    expect({ applied: edited.body.applied, world: edited.body.world, changed: edited.body.changed }).toEqual({ applied: "live", world: { providerId: "reference", worldId: "north" }, changed: true });
    expect(edited.body.warnings).toEqual(["ops[5]: Titanium Amber Ring needs melee level 40 and the player has 1. Equipped anyway"]);
    expect(edited.body.player.inventory.slice(4, 8).map(stack)).toEqual([["air_essence", 30], ["pale_quartz", 7], ["crown_trout", 1], ["crown_trout", 1]]);
    expect(edited.body.player.revision).not.toBe(before.revision);

    // The game client is told through ordinary replication, one tick later.
    await expect.poll(() => alice.deltas("inventory").length, { timeout: 3000, interval: 10 }).toBeGreaterThan(0);
    expect(alice.deltas("inventory").at(-1).slots.slice(4, 8).map(stack)).toEqual([["air_essence", 30], ["pale_quartz", 7], ["crown_trout", 1], ["crown_trout", 1]]);
    expect(alice.deltas("currency").at(-1)).toBe(500);
    expect(alice.deltas("skills").at(-1).mining).toEqual({ xp: 1000, level: 7 });
    expect(alice.deltas("equipment").at(-1).accessory1).toEqual({ itemId: "crafted_ring_t40", quantity: 1 });
    const told = alice.messages.flatMap(message => message.type === "update" ? message.update.events : []).filter((event: any) => event.data?.source === "admin");
    expect(told.map((event: any) => [event.type, event.data.itemId, event.data.quantity]).sort()).toEqual([["item.lost", "air_essence", 20], ["item.received", "crown_trout", 2], ["item.received", "pale_quartz", 7]]);

    const rows = await first.audit("action=player.");
    expect(rows.map(row => [row.credential, row.accountId, row.action, row.target])).toEqual([["session", OWNER, "player.edit", ALICE]]);
    expect(rows[0].before).toEqual({ inventory: { 4: { itemId: "air_essence", quantity: 50 }, 5: null, 6: null, 7: null }, equipment: { accessory1: null }, skills: { mining: { xp: 0, level: 1 } }, currency: 0 });
    expect(rows[0].after).toEqual({ inventory: { 4: { itemId: "air_essence", quantity: 30 }, 5: { itemId: "pale_quartz", quantity: 7 }, 6: { itemId: "crown_trout", quantity: 1 }, 7: { itemId: "crown_trout", quantity: 1 } },
      equipment: { accessory1: { itemId: "crafted_ring_t40", quantity: 1 } }, skills: { mining: { xp: 1000, level: 7 } }, currency: 500, applied: "live", world: "north" });
    await first.close();

    const second = await serve({ file });
    const stored = await second.player(ALICE);
    expect([stored.online, stored.currency, stored.skills.mining.level, stack(stored.inventory[5])]).toEqual([null, 500, 7, ["pale_quartz", 7]]);
    const again = await connect(second.server.port, "north", second.token(ALICE, "Alice"));
    expect(again.snapshot().inventory.slots.slice(4, 8).map(stack)).toEqual([["air_essence", 30], ["pale_quartz", 7], ["crown_trout", 1], ["crown_trout", 1]]);
  }, 30_000);

  it("moves a player inside the world that holds them, and nowhere else", async () => {
    const served = await serve();
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const from = alice.snapshot().player;
    const target = [from.position[0] + 2, from.position[1], from.position[2] + 1];
    const wrong = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "position.set", world: { providerId: "reference", worldId: "south" }, regionId: from.regionId, position: target }] } });
    expect([wrong.status, wrong.body.error.code, wrong.body.error.message]).toEqual([409, "does_not_fit", "ops[0]: the player is in world north, not south"]);
    const nowhere = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "position.set", world: { providerId: "reference", worldId: "north" }, regionId: "no_such_region", position: target }] } });
    expect([nowhere.status, nowhere.body.error.code]).toEqual([400, "unknown_region"]);
    const moved = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "position.set", world: { providerId: "reference", worldId: "north" }, regionId: from.regionId, position: target }] } });
    expect(moved.status).toBe(200);
    expect(Math.hypot(moved.body.player.position[0] - target[0], moved.body.player.position[2] - target[2])).toBeLessThan(8);
    expect(moved.body.player.position).not.toEqual(from.position);
    expect((await served.audit("action=player.edit"))[0].after.position.regionId).toBe(from.regionId);
  }, 20_000);
});

describe("editing a player who is not connected", () => {
  it("writes the stored character under the lease, audits it with the write, and the next join sees it", async () => {
    const served = await serve();
    await leave(await connect(served.server.port, "north", served.token(ALICE, "Alice")), served, ALICE);
    const edited = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [
      { op: "bank.add", itemId: "crown_trout", quantity: 300 }, { op: "inventory.set", slots: [{ itemId: "worn_sword", quantity: 1 }, null, { itemId: "air_essence", quantity: 9 }] }] } });
    expect([edited.status, edited.body.applied, edited.body.world, edited.body.changed]).toEqual([200, "stored", null, true]);
    expect(edited.body.player.bank).toEqual([{ itemId: "crown_trout", quantity: 300 }]);
    const row = (await served.audit("action=player.edit&target=acc_AAAA"))[0];
    expect([row.action, row.target, row.after.applied, row.before.bank, row.after.bank]).toEqual(["player.edit", ALICE, "stored", { 0: null }, { 0: { itemId: "crown_trout", quantity: 300 } }]);
    expect(row.after.inventory).toEqual({ 1: null, 2: { itemId: "air_essence", quantity: 9 }, 3: null, 4: null });

    // A different world than the last one: the character is the server's, not a world's.
    const back = await connect(served.server.port, "south", served.token(ALICE, "Alice"));
    expect(back.snapshot().bank.slots).toEqual([{ itemId: "crown_trout", quantity: 300 }]);
    expect(back.snapshot().inventory.slots.slice(0, 4).map(stack)).toEqual([["worn_sword", 1], null, ["air_essence", 9], null]);
  }, 20_000);

  it("lands an edit made the instant a connection drops, and one made inside the reconnect reservation", async () => {
    const served = await serve();
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    alice.ws.terminate();
    // No waiting: the world may still hold the dropped player for its next commit, or may have saved and reserved them already.
    const racing = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "currency.set", amount: 111 }] } });
    expect(racing.status).toBe(200);
    expect(["live", "stored"]).toContain(racing.body.applied);

    await expect.poll(() => [...served.server.worlds.values()].some(hosted => hosted.leases.has(ALICE)), { timeout: 3000, interval: 10 }).toBe(false);
    const lease = (served.storage as SqliteWorldStorage).database.prepare("SELECT reserved FROM player_leases WHERE account_id=?").get(ALICE);
    expect(lease?.reserved).toBe(1);
    const reserved = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "inventory.add", itemId: "pale_quartz", quantity: 3 }] } });
    expect([reserved.status, reserved.body.applied]).toEqual([200, "stored"]);

    const back = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    expect(back.verdict.type).toBe("joined");
    expect([back.snapshot().currency, stack(back.snapshot().inventory.slots[5])]).toEqual([111, ["pale_quartz", 3]]);
    expect((await served.audit("action=player.edit")).map(row => Object.keys(row.after).filter(key => key !== "applied" && key !== "world"))).toEqual([["inventory"], ["currency"]]);
  }, 20_000);

  it("never lets the copy a world keeps for a campfire owner come back over the edit", async () => {
    const served = await serve();
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const north = served.server.worlds.get(JSON.stringify(["reference", "north"]))!.runtime;
    const live = north.players.get(ALICE)!.store.get();
    live.world.campfire = { id: `campfire:${ALICE}`, position: live.player.position, regionId: live.player.regionId, logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 1e9 };
    await leave(alice, served, ALICE);
    expect(north.players.has(ALICE)).toBe(true);

    const edited = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "inventory.remove", itemId: "air_essence", quantity: 50 }, { op: "currency.set", amount: 42 }] } });
    expect([edited.status, edited.body.applied]).toEqual([200, "stored"]);
    expect([north.players.get(ALICE)!.store.get().currency, stack(north.players.get(ALICE)!.store.get().inventory.slots[4])]).toEqual([42, null]);
    // Several commits of the world that keeps the resident copy, then the player comes home.
    const tick = north.clock.tick; await expect.poll(() => north.clock.tick, { timeout: 3000, interval: 20 }).toBeGreaterThan(tick + 3);
    expect((await served.player(ALICE)).currency).toBe(42);
    const back = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    expect([back.snapshot().currency, stack(back.snapshot().inventory.slots[4])]).toEqual([42, null]);
  }, 20_000);
});

describe("refusing a player edit", () => {
  it("answers 409 to a stale revision, rejects a whole patch for one bad operation, and changes nothing either time", async () => {
    const served = await serve();
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const loaded = await served.player(ALICE);
    // The player loots something after the editor loaded them.
    served.server.worlds.get(JSON.stringify(["reference", "north"]))!.runtime.players.get(ALICE)!.inventory.addItem("crown_trout", 1);
    const stale = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { expect: { revision: loaded.revision }, ops: [{ op: "inventory.set", slots: [] }] } });
    const current = await served.player(ALICE);
    expect([stale.status, stale.body.error.code]).toEqual([409, "revision_mismatch"]);
    expect(stale.body.error.message).toBe(`The player changed since revision ${loaded.revision} was read. It is now ${current.revision}`);
    expect(current.inventory.slice(0, 6).map(stack)).toEqual([["worn_sword", 1], ["worn_hatchet", 1], ["worn_pickaxe", 1], ["worn_rod", 1], ["air_essence", 50], ["crown_trout", 1]]);

    const partial = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [
      { op: "currency.set", amount: 9 }, { op: "inventory.add", itemId: "pale_quartz", quantity: 5 }, { op: "inventory.add", itemId: "crown_trout", quantity: 40 }] } });
    expect(partial.status).toBe(409);
    expect(partial.body.error).toEqual({ code: "does_not_fit", op: 2, message: "ops[2]: 40 Trout need 40 free inventory slots and 21 are free" });
    const unknown = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "currency.set", amount: 9 }, { op: "bank.add", itemId: "sword_of_a_thousand_truths", quantity: 1 }] } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toEqual({ code: "unknown_item", op: 1, message: 'ops[1]: no item with id "sword_of_a_thousand_truths" in the active catalog' });

    const cases: [unknown, number, string][] = [
      [{ ops: [] }, 400, "invalid_request"], [{ ops: [{ op: "name.set", name: "x" }] }, 400, "invalid_op"], [{ state: {} }, 400, "invalid_op"],
      [{ ops: [{ op: "inventory.add", itemId: "pale_quartz", quantity: 0 }] }, 400, "invalid_op"], [{ ops: [{ op: "inventory.add", itemId: "pale_quartz", quantity: 1.5 }] }, 400, "invalid_op"],
      [{ ops: [{ op: "inventory.add", itemId: "gold", quantity: 5 }] }, 400, "invalid_op"], [{ ops: [{ op: "inventory.set", slots: [{ itemId: "crown_trout", quantity: 2 }] }] }, 400, "invalid_op"],
      [{ ops: [{ op: "inventory.set", slots: [{ itemId: "pale_quartz", quantity: 2 }, { itemId: "pale_quartz", quantity: 2 }] }] }, 400, "invalid_op"],
      [{ ops: [{ op: "equipment.set", slot: "head", itemId: "crafted_ring_t40" }] }, 400, "invalid_op"], [{ ops: [{ op: "equipment.set", slot: "offHand", itemId: "palewood_shield" }, { op: "equipment.set", slot: "mainHand", itemId: "basic_wooden_staff" }] }, 409, "does_not_fit"],
      [{ ops: [{ op: "skill.setXp", skill: "mining", xp: 9_999_880 }] }, 400, "invalid_op"], [{ ops: [{ op: "bank.remove", itemId: "crown_trout", quantity: 1 }] }, 409, "does_not_fit"],
      [{ ops: [{ op: "currency.set", amount: 1 }], expect: { revision: "nope" } }, 400, "invalid_request"],
    ];
    for (const [body, status, code] of cases) {
      const answer = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body });
      expect([JSON.stringify(body), answer.status, answer.body.error.code]).toEqual([JSON.stringify(body), status, code]);
    }
    const after = await served.player(ALICE);
    expect([after.revision, after.currency]).toEqual([current.revision, 0]);
    expect(await served.audit("action=player.")).toEqual([]);
    expect(alice.deltas("currency")).toEqual([]);

    const missing = await served.call(`/admin/players/${BOB}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "currency.set", amount: 1 }] } });
    expect([missing.status, missing.body.error.code]).toEqual([404, "not_found"]);
  }, 30_000);

  it("needs players:write, and players:read may still look", async () => {
    const served = await serve();
    await leave(await connect(served.server.port, "north", served.token(ALICE, "Alice")), served, ALICE);
    const reader = await served.apiToken(["players:read"]), writer = await served.apiToken(["players:write"]);
    const refused = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: reader, body: { ops: [{ op: "currency.set", amount: 5 }] } });
    expect([refused.status, refused.body]).toEqual([403, { error: { code: "forbidden", message: "This credential is missing the players:write scope" } }]);
    expect((await served.call(`/admin/players/${ALICE}/kick`, { method: "POST", token: reader, body: {} })).status).toBe(403);
    expect((await served.call(`/admin/players/${ALICE}`, { method: "PATCH", body: { ops: [{ op: "currency.set", amount: 5 }] } })).status).toBe(401);
    expect((await served.call(`/admin/players/${ALICE}`, { token: reader })).body.currency).toBe(0);
    const allowed = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: writer, body: { ops: [{ op: "currency.set", amount: 5 }] } });
    expect([allowed.status, allowed.body.player.currency]).toEqual([200, 5]);
    const row = (await served.audit("action=player.edit"))[0];
    expect([row.accountId, row.credential.slice(0, 10), row.before, row.after]).toEqual([OWNER, "token:tok_", { currency: 0 }, { currency: 5, applied: "stored" }]);
  }, 20_000);
});

describe("an edit and its audit row", () => {
  it("land together or not at all: a commit that fails loses both, and the editor is told", async () => {
    const served = await serve();
    await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const saved = () => (served.storage as SqliteWorldStorage).database.prepare("SELECT character FROM players WHERE account_id=?").get(ALICE)?.character ?? null;
    await expect.poll(saved, { timeout: 3000, interval: 10 }).not.toBeNull();
    served.storage.commit = () => Promise.reject(new Error("disk full"));
    const edited = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "currency.set", amount: 77 }] } });
    expect([edited.status, edited.body.error]).toEqual([503, { code: "unavailable", message: "World storage failed before the edit was saved" }]);
    const database = (served.storage as SqliteWorldStorage).database;
    expect(database.prepare("SELECT count(*) AS rows FROM audit_log WHERE action='player.edit'").get()!.rows).toBe(0);
    expect(JSON.parse(String(database.prepare("SELECT character FROM players WHERE account_id=?").get(ALICE)!.character)).currency).toBe(0);
  }, 20_000);

  it("follow the same rules in the memory adapter, online and stored", async () => {
    const served = await serve({ memory: true });
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const live = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { ops: [{ op: "currency.set", amount: 12 }] } });
    expect([live.status, live.body.applied, live.body.player.currency]).toEqual([200, "live", 12]);
    await leave(alice, served, ALICE);
    const stored = await served.call(`/admin/players/${ALICE}`, { method: "PATCH", token: served.owner, body: { expect: { revision: live.body.player.revision }, ops: [{ op: "currency.set", amount: 13 }] } });
    expect([stored.status, stored.body.applied, stored.body.player.currency]).toEqual([200, "stored", 13]);
    expect((await served.audit("action=player.edit")).map(row => [row.before, row.after])).toEqual([[{ currency: 12 }, { currency: 13, applied: "stored" }], [{ currency: 0 }, { currency: 12, applied: "live", world: "north" }]]);
    expect((await connect(served.server.port, "south", served.token(ALICE, "Alice"))).snapshot().currency).toBe(13);
  }, 20_000);
});

describe("kicking a player", () => {
  it("tells the client why, saves and frees the account at once, and audits the kick", async () => {
    const served = await serve();
    const offline = await served.call(`/admin/players/${ALICE}/kick`, { method: "POST", token: served.owner, body: {} });
    expect([offline.status, offline.body.error.code]).toEqual([409, "not_online"]);
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    const kicked = await served.call(`/admin/players/${ALICE}/kick`, { method: "POST", token: served.owner, body: { reason: "AFK in the bank door" } });
    expect([kicked.status, kicked.body]).toEqual([200, { kicked: true }]);
    expect(await alice.closedWith).toBe(4000);
    expect(alice.messages.find(message => message.type === "error").error).toEqual({ code: "KICKED", message: "Kicked from this server: AFK in the bank door" });

    // No reconnect reservation and no wait for a lease to expire: a kick is not a ban.
    const back = await connect(served.server.port, "south", served.token(ALICE, "Alice"));
    expect(back.verdict.type).toBe("joined");
    expect((await served.audit("action=player.kick")).map(row => [row.action, row.target, row.accountId, row.before, row.after])).toEqual([["player.kick", ALICE, OWNER, null, { reason: "AFK in the bank door" }]]);
    expect(served.server.events.filter(event => event.kind === "kick")).toMatchObject([{ accountId: ALICE, detail: "AFK in the bank door" }]);
    expect((await served.call(`/admin/players/${ALICE}/kick`, { method: "POST", token: served.owner, body: { reason: 5 } })).status).toBe(400);
  }, 20_000);
});

describe("settings an admin changes while the server runs", () => {
  it("applies a world capacity to the next join with no restart, audits it, and keeps it across one", async () => {
    const file = temporary("settings.sqlite");
    const served = await serve({ file });
    expect((await served.call("/admin/settings", { token: served.owner })).body).toEqual({
      settings: { name: "Corealm server", description: null, registerWithDirectory: false, capacity: { north: 4, south: 4 } }, overrides: {},
      defaults: { name: "Corealm server", description: null, registerWithDirectory: false, capacity: { north: 4, south: 4 } } });
    const alice = await connect(served.server.port, "north", served.token(ALICE, "Alice"));
    expect(alice.verdict.type).toBe("joined");

    const lowered = await served.call("/admin/settings", { method: "PATCH", token: served.owner, body: { description: "Friday night raids", worlds: { north: { capacity: 1 } } } });
    expect([lowered.status, lowered.body.settings.capacity, lowered.body.overrides]).toEqual([200, { north: 1, south: 4 }, { "capacity.north": 1, description: "Friday night raids" }]);
    const full = await connect(served.server.port, "north", served.token(BOB, "Bob"));
    expect(full.verdict.error).toEqual({ code: "FULL", message: "This world is full" });
    const listed = (await served.call("/worlds")).body;
    expect(listed.map((entry: any) => [entry.worldId, entry.capacity, entry.population, entry.availability, entry.description]))
      .toEqual([["north", 1, 1, "full", "Friday night raids"], ["south", 4, 0, "available", "Friday night raids"]]);

    const rows = await served.audit("action=settings.");
    expect(rows.map(row => [row.action, row.target, row.accountId, row.before, row.after]))
      .toEqual([["settings.set", null, OWNER, { description: null, "capacity.north": null }, { description: "Friday night raids", "capacity.north": 1 }]]);
    await served.close();

    const second = await serve({ file });
    expect(second.server.settings).toEqual({ name: "Corealm server", description: "Friday night raids", registerWithDirectory: false, capacity: { north: 1, south: 4 } });
    const restored = await second.call("/admin/settings", { method: "PATCH", token: second.owner, body: { worlds: { north: { capacity: null } } } });
    expect([restored.body.settings.capacity.north, restored.body.overrides]).toEqual([4, { description: "Friday night raids" }]);
    const first = await connect(second.server.port, "north", second.token(ALICE, "Alice")), other = await connect(second.server.port, "north", second.token(BOB, "Bob"));
    expect([first.verdict.type, other.verdict.type]).toEqual(["joined", "joined"]);

    for (const [body, status] of [[{ worlds: { east: { capacity: 2 } } }, 400], [{ worlds: { north: { capacity: 0 } } }, 400], [{ name: "x" }, 400], [{ motd: "hi" }, 400], [{}, 400], [{ description: "d".repeat(201) }, 400]] as const)
      expect([JSON.stringify(body), (await second.call("/admin/settings", { method: "PATCH", token: second.owner, body })).status]).toEqual([JSON.stringify(body), status]);
    expect((await second.call("/admin/settings", { method: "PATCH", token: await second.apiToken(["players:write", "stats:read"]), body: { name: "Raid Night" } })).status).toBe(403);
  }, 30_000);

  it("registers with the identity service's directory when switched on, with the name and description of the moment", async () => {
    const registered: { url: string; body: any }[] = [];
    const served = await serve({ registered });
    expect(registered).toEqual([]);
    const on = await served.call("/admin/settings", { method: "PATCH", token: served.owner, body: { registerWithDirectory: true, name: "Raid Night", description: "Fridays" } });
    expect(on.status).toBe(200);
    await expect.poll(() => registered.length, { timeout: 2000, interval: 10 }).toBe(1);
    expect(registered[0]).toEqual({ url: "https://identity.test/servers/register", body: { name: "Raid Night", endpoint: served.endpoint, description: "Fridays" } });
    expect(served.logs.filter(line => String(line.event).startsWith("directory."))).toEqual([{ event: "directory.registered", endpoint: served.endpoint, name: "Raid Night" }]);
    await served.call("/admin/settings", { method: "PATCH", token: served.owner, body: { description: null } });
    await expect.poll(() => registered.length, { timeout: 2000, interval: 10 }).toBe(2);
    expect(registered[1]!.body).toEqual({ name: "Raid Night", endpoint: served.endpoint });
    await served.call("/admin/settings", { method: "PATCH", token: served.owner, body: { registerWithDirectory: false } });
    expect(served.logs.at(-1)).toEqual({ event: "directory.stopped" });
    expect(registered).toHaveLength(2);
  }, 20_000);

  it("keeps playing when the directory refuses or cannot be reached, and says so once", async () => {
    const { createDirectoryHeartbeat } = await import("../game/src/multiplayer/serverSettings.js");
    const logs: Record<string, unknown>[] = []; let answer: () => Promise<Response> = async () => new Response('{"error":{"code":"unreachable"}}', { status: 422 });
    const heartbeat = createDirectoryHeartbeat({ identityUrl: IDENTITY, endpoint: () => "wss://play.test/", log: event => logs.push(event), fetch: (() => answer()) as typeof fetch,
      settings: () => ({ name: "Raid Night", description: null, registerWithDirectory: true, capacity: {} }) });
    expect([await heartbeat.beat(), await heartbeat.beat()]).toEqual([false, false]);
    answer = async () => { throw new Error("connect ECONNREFUSED"); };
    expect(await heartbeat.beat()).toBe(false);
    expect(logs).toEqual([{ event: "directory.refused", endpoint: "wss://play.test/", name: "Raid Night", status: 422, reason: "unreachable" },
      { event: "directory.unreachable", endpoint: "wss://play.test/", name: "Raid Night", message: "connect ECONNREFUSED" }]);
  });
});

describe("what devdocs reads before and after it signs in", () => {
  it("tells anyone where to sign in and which endpoint a token is for, and tells a session the rest", async () => {
    const served = await serve();
    const info = await served.call("/admin/info");
    expect([info.status, info.body]).toEqual([200, { name: "Corealm server", description: null, endpoint: served.endpoint, assetBaseUrl: ASSETS, identityUrl: IDENTITY,
      authentication: "account", catalogRevision: RESOLVED_CATALOG.revision, baseVersion: "0.0.0", worlds: [{ providerId: "reference", worldId: "north", name: "north", seed: 1337, capacity: 4 }, { providerId: "reference", worldId: "south", name: "south", seed: 1337, capacity: 4 }] }]);
    expect((await served.call("/admin/me", { token: served.owner })).body.server).toEqual({ name: "Corealm server", endpoint: served.endpoint, assetBaseUrl: ASSETS, identityUrl: IDENTITY, catalogRevision: RESOLVED_CATALOG.revision });
    const stats = (await served.call("/admin/stats", { token: served.owner })).body;
    expect([stats.catalogRevision, stats.server.host, stats.server.identityUrl, stats.server.registerWithDirectory, stats.server.worlds.length]).toEqual([RESOLVED_CATALOG.revision, "127.0.0.1", IDENTITY, false, 2]);
    expect(JSON.stringify(stats.server)).not.toMatch(/cas_|cat_|secret|hash/i);
  });

  it("serves the whole server catalog to content:read, privately, immutably per revision, and compressed", async () => {
    const served = await serve();
    const reader = await served.apiToken(["content:read"]), watcher = await served.apiToken(["stats:read"]);
    expect((await served.call("/admin/content/catalog/active", { token: watcher })).status).toBe(403);
    expect((await served.call("/admin/content/catalog/active")).status).toBe(401);
    const active = await served.call("/admin/content/catalog/active", { token: reader, headers: { "Accept-Encoding": "gzip" } });
    expect([active.status, active.headers.get("cache-control"), active.headers.get("content-encoding"), active.headers.get("x-catalog-revision")]).toEqual([200, "private, no-cache", "gzip", RESOLVED_CATALOG.revision]);
    expect([active.body.revision, active.body.version, Array.isArray(active.body.tables.enemies), Array.isArray(active.body.tables.lootTables)]).toEqual([RESOLVED_CATALOG.revision, 1, true, true]);
    const pinned = await served.call(`/admin/content/catalog/${RESOLVED_CATALOG.revision}`, { token: reader, headers: { "Accept-Encoding": "identity" } });
    expect([pinned.status, pinned.headers.get("cache-control"), pinned.headers.get("content-encoding"), pinned.headers.get("etag")]).toEqual([200, "private, max-age=31536000, immutable", null, `"${RESOLVED_CATALOG.revision}"`]);
    expect(pinned.text).toBe(active.text);
    expect((await served.call(`/admin/content/catalog/${RESOLVED_CATALOG.revision}`, { token: reader, headers: { "If-None-Match": `"${RESOLVED_CATALOG.revision}"` } })).status).toBe(304);
    expect((await served.call(`/admin/content/catalog/${"0".repeat(64)}`, { token: reader })).status).toBe(404);
    expect((await served.call("/admin/content/catalog/latest", { token: reader })).status).toBe(400);
  }, 20_000);

  it("filters the audit log by action, account and target prefix", async () => {
    const served = await serve();
    await served.call("/admin/bans", { method: "POST", token: served.owner, body: { accountId: BOB, reason: "Spam" } });
    await served.call("/admin/bans", { method: "POST", token: served.owner, body: { accountId: ALICE, reason: "Bots" } });
    await served.call(`/admin/bans/${BOB}`, { method: "DELETE", token: served.owner });
    expect((await served.audit("action=ban.")).map(row => [row.action, row.target])).toEqual([["ban.remove", BOB], ["ban.set", ALICE], ["ban.set", BOB]]);
    expect((await served.audit("action=ban.&target=acc_B")).map(row => row.action)).toEqual(["ban.remove", "ban.set"]);
    expect((await served.audit("action=ban.set&target=acc_A&account=acc_O")).map(row => row.target)).toEqual([ALICE]);
    expect(await served.audit("account=acc_A")).toEqual([]);
    expect((await served.call("/admin/audit?action=", { token: served.owner })).status).toBe(400);
  });
});

describe("the admin UI at /admin/", () => {
  const INLINE = "document.documentElement.dataset.theme='dark'";
  async function build() {
    const root = temporary("ui"), ui = join(root, "dist");
    await mkdir(join(ui, "assets"), { recursive: true }); await mkdir(join(ui, "players"), { recursive: true });
    await writeFile(join(root, "secret.txt"), "TOP-SECRET");
    await writeFile(join(ui, "index.html"), `<!doctype html><html><head><script>${INLINE}</script><script type="module" src="./assets/index-Bx7k2QpL.js"></script></head><body><div id="root"></div></body></html>`);
    await writeFile(join(ui, "assets", "index-Bx7k2QpL.js"), "console.log('devdocs')");
    await writeFile(join(ui, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    await writeFile(join(ui, "players", "index.html"), "a static file where the API lives");
    return ui;
  }
  /** `fetch` normalises a path before it sends it. An attacker does not. */
  const raw = (port: number, path: string, method = "GET") => new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, text: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject); request.end();
  });

  it("serves the page uncached under a tight policy, hashed files forever, and sends stale paths home", async () => {
    const served = await serve({ ui: await build() });
    const bare = await raw(served.server.port, "/admin");
    expect([bare.status, bare.headers.location]).toEqual([308, "/admin/"]);
    const page = await raw(served.server.port, "/admin/");
    expect([page.status, page.headers["content-type"], page.headers["cache-control"], page.headers["x-content-type-options"], page.headers["referrer-policy"], page.headers["x-frame-options"]])
      .toEqual([200, "text/html; charset=utf-8", "no-cache", "nosniff", "no-referrer", "DENY"]);
    expect(page.text).toContain('<div id="root">');
    const { createHash } = await import("node:crypto");
    expect(page.headers["content-security-policy"]).toBe(["default-src 'self'", `script-src 'self' 'wasm-unsafe-eval' 'sha256-${createHash("sha256").update(INLINE).digest("base64")}'`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://cdn.test", "font-src 'self' data:", "connect-src 'self' blob: data: https://identity.test https://cdn.test",
      "media-src 'self' blob: https://cdn.test", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'"].join("; "));

    const asset = await raw(served.server.port, "/admin/assets/index-Bx7k2QpL.js");
    expect([asset.status, asset.headers["content-type"], asset.headers["cache-control"], asset.text]).toEqual([200, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable", "console.log('devdocs')"]);
    const icon = await raw(served.server.port, "/admin/favicon.svg");
    expect([icon.status, icon.headers["content-type"], icon.headers["cache-control"], icon.headers["content-security-policy"]]).toEqual([200, "image/svg+xml", "public, max-age=300", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox"]);
    const head = await raw(served.server.port, "/admin/assets/index-Bx7k2QpL.js", "HEAD");
    expect([head.status, head.headers["content-length"], head.text]).toEqual([200, "22", ""]);
    const cached = await served.call("/admin/", { headers: { "If-None-Match": String(page.headers.etag) } });
    expect(cached.status).toBe(304);

    // The app routes in the fragment. A path is a stale link: the page directly under /admin/, a redirect from any deeper.
    const fallback = await raw(served.server.port, "/admin/creatures");
    expect([fallback.status, fallback.headers["cache-control"], fallback.text]).toEqual([200, "no-cache", page.text]);
    const deep = await raw(served.server.port, "/admin/creatures/wolf");
    expect([deep.status, deep.headers.location]).toEqual([302, "/admin/"]);
    expect((await raw(served.server.port, "/admin/assets/missing-AAAAAAAA.js")).status).toBe(404);
    const posted = await raw(served.server.port, "/admin/", "POST");
    expect([posted.status, posted.headers.allow]).toEqual([405, "GET, HEAD"]);
  }, 20_000);

  it("never leaves its directory", async () => {
    const ui = await build(), served = await serve({ ui });
    const attempts = ["/admin/../secret.txt", "/admin/%2e%2e/secret.txt", "/admin/..%2fsecret.txt", "/admin/%2e%2e%2fsecret.txt", "/admin/assets/../../secret.txt", "/admin/assets/%2e%2e/%2e%2e/secret.txt",
      "/admin/..\\secret.txt", "/admin/assets\\..\\..\\secret.txt", "/admin/%5c..%5csecret.txt", "/admin/%252e%252e/secret.txt", "/admin//secret.txt", "/admin/C:/Windows/win.ini", "/admin/%2fetc%2fpasswd",
      "/admin/index.html%00.js", "/admin/assets/%00", "/admin/.env", "/admin/%ff"];
    const statuses: string[] = [];
    for (const path of attempts) {
      const answer = await raw(served.server.port, path);
      statuses.push(`${answer.status} ${path}`);
      expect([path, answer.text.includes("TOP-SECRET")]).toEqual([path, false]);
    }
    // 404: the URL parser resolved the dots, so the path is not under /admin at all and no route owns it. 400: the UI refused it.
    expect(statuses).toEqual(["404 /admin/../secret.txt", "404 /admin/%2e%2e/secret.txt", "400 /admin/..%2fsecret.txt", "400 /admin/%2e%2e%2fsecret.txt", "404 /admin/assets/../../secret.txt",
      "404 /admin/assets/%2e%2e/%2e%2e/secret.txt", "404 /admin/..\\secret.txt", "404 /admin/assets\\..\\..\\secret.txt", "400 /admin/%5c..%5csecret.txt", "400 /admin/%252e%252e/secret.txt",
      "400 /admin//secret.txt", "400 /admin/C:/Windows/win.ini", "400 /admin/%2fetc%2fpasswd", "400 /admin/index.html%00.js", "400 /admin/assets/%00", "400 /admin/.env", "400 /admin/%ff"]);
    // The directory source refuses on its own too, whatever it is handed.
    const source = directoryAdminUi(ui);
    expect([await source.read("../secret.txt"), await source.read("assets/../../secret.txt"), (await source.read("index.html"))?.type]).toEqual([null, null, "text/html; charset=utf-8"]);
  }, 20_000);

  it("gives the API its paths whatever the browser asks for, and says how to build a UI that is missing", async () => {
    const served = await serve({ ui: await build() });
    const browser = await served.call("/admin/players", { headers: { Accept: "text/html,application/xhtml+xml" } });
    expect([browser.status, browser.headers.get("content-type"), browser.body]).toEqual([401, "application/json", { error: { code: "unauthorized", message: "An admin session or API token is required" } }]);
    const index = await served.call("/admin/players/index.html", { token: served.owner, headers: { Accept: "text/html" } });
    expect([index.status, index.body.error.code]).toEqual([400, "invalid_request"]);
    expect((await served.call("/admin/players", { token: served.owner })).body.players).toEqual([]);

    const bare = await serve();
    const missing = await bare.call("/admin/");
    expect([missing.status, missing.body.error.code]).toEqual([404, "admin_ui_missing"]);
    expect(missing.body.error.message).toContain("vite build --config devdocs/vite.config.ts --mode server");
    expect((await bare.call("/admin/info")).status).toBe(200);
  }, 20_000);
});
