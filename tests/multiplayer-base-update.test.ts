import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { setSkillLevel } from "../game/src/state/store.js";
import { seedCatalog, type BaseCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld, { PLACEMENT_GROUP as GROUP } from "./fixtures/placementWorld.js";

/**
 * Updating a live server from a newer base game, on a server with no edits of its own: the fast
 * path. A real server on a temp-file SQLite database, driven only through its admin API, `/worlds`
 * and a socket. The newer base is injected the way the entry point passes the one it ships with.
 */
const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA";
const TABLE = "shared_t0_frog", MARKER = "base_marker";
const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };
type Sources = Record<string, any>;
const markerItem = { id: MARKER, name: "Base Marker", tier: 1, description: "Dropped only by the newer base's frog table.", stackable: true, value: 1, category: "resource" };

let file: string, seededSources: Sources, bundled: BaseCatalog, running: Awaited<ReturnType<typeof boot>>;

async function boot() {
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const logs: Record<string, unknown>[] = [];
  const storage = new SqliteWorldStorage(file, { log: () => {} });
  await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: seededSources }, () => {});
  const server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld, bundledBase: bundled,
    ownerAccount: OWNER, log: event => logs.push(event),
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
  const token = (accountId: string, name: string) => signJoinToken(created.signing, joinTokenClaims({ accountId, name, endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, cache: response.headers.get("cache-control"), bytes: text.length, body: text ? JSON.parse(text) as any : null };
  };
  const session = (await call("/admin/session", { method: "POST", body: { token: token(OWNER, "Owner") } })).body.session as string;
  const runtime = [...server.worlds.values()][0]!.runtime;
  return { server, storage, logs, call, token, session, runtime };
}

async function connect(accountId: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${running.server.port}/`); const messages: any[] = [];
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>(resolve => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId: "north", token: running.token(accountId, name), protocolVersion: WORLD_PROTOCOL_VERSION }));
  for (let waited = 0; !messages.some(message => message.type === "joined" || message.type === "error") && waited < 5000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
  const joined = messages.find(message => message.type === "joined");
  let sequence = 0, operation = joined.nextOperation as number;
  const command = (method: string, args: unknown[]) => ws.send(JSON.stringify({ type: "command", envelope: { sessionId: joined.sessionId, sequence: ++sequence, operation: operation++, command: { method, args } } }));
  return { ws, messages, joined, command };
}
let alice: Awaited<ReturnType<typeof connect>>;

async function kill(): Promise<string[]> {
  const { runtime } = running, id = runtime.entities.all().filter(entity => entity.meta?.groupId === GROUP).sort((a, b) => a.id.localeCompare(b.id))[0]!.id;
  const player = runtime.players.get(ALICE)!, state = player.store.get(), target = runtime.entities.get(id)!;
  setSkillLevel(state, "melee", 99);
  state.player.health = 99; state.player.position = [target.position[0] - 1.2, 0, target.position[2]];
  player.combat.runtimeFor(state, target).health = 1;
  const before = new Set(Object.keys(runtime.shared.lootPiles));
  alice.command("attack", [id]);
  await expect.poll(() => runtime.shared.enemies[id]?.state, { timeout: 30_000, interval: 25 }).toBe("dead");
  await expect.poll(() => Object.keys(runtime.shared.lootPiles).some(pile => !before.has(pile)), { timeout: 5000, interval: 25 }).toBe(true);
  return Object.entries(runtime.shared.lootPiles).filter(([pile]) => !before.has(pile)).flatMap(([, pile]) => pile.items.map(stack => stack.itemId)).sort();
}

beforeAll(async () => {
  file = join(tmpdir(), `corealm-base-update-${randomUUID()}.sqlite`);
  seededSources = Object.fromEntries(await readContentSources());
  // The newer base: one new item, and the frogs' table drops it every time.
  const next = structuredClone(seededSources);
  next.items.push(markerItem);
  for (const roll of next.lootTables.find((row: any) => row.id === TABLE).rolls) { roll.drops = roll.id === "items" ? [{ itemId: MARKER, quantity: [1, 1], chance: 1 }] : []; roll.tables = []; }
  const compiled = compileCatalog(next, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
  bundled = { version: "0.2.0", catalog: compiled.catalog, sources: next };
  running = await boot();
  alice = await connect(ALICE, "Alice");
}, 60_000);
afterAll(async () => {
  alice?.ws.terminate();
  await running?.server.close();
  for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
});

describe("updating a server with no edits of its own from a newer base", () => {
  // A swap moves RESOLVED_CATALOG with the process, so the seed is remembered here before anything moves it.
  const seeded = RESOLVED_CATALOG.revision;
  const seed = () => ({ version: "0.1.0", revision: seeded });

  it("records the seed as its base and says so in /worlds, joined, /admin/info, /admin/stats and the base status", async () => {
    expect(await running.storage.catalog.activeBase()).toEqual(seed());
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0].baseVersion).toBe("0.1.0");
    expect(alice.joined.world.baseVersion).toBe("0.1.0");
    expect((await running.call("/admin/info")).body.baseVersion).toBe("0.1.0");
    const status = await running.call("/admin/content/base", { token: running.session });
    expect([status.status, status.cache, status.body]).toEqual([200, "no-store", { current: seed(), bundled: { version: "0.2.0", revision: bundled.catalog.revision },
      updateAvailable: true, direction: "newer", serverModified: false }]);
    const stats = await running.call("/admin/stats", { token: running.session });
    expect(stats.body.base).toEqual({ current: seed(), bundled: { version: "0.2.0", revision: bundled.catalog.revision }, updateAvailable: true });
    expect(stats.body.server.baseVersion).toBe("0.1.0");
  });

  it("keeps preview and apply to content:publish, and checks what it is sent", async () => {
    const reader = (await running.call("/admin/tokens", { method: "POST", token: running.session, body: { label: "reader", scopes: ["content:read"] } })).body.token as string;
    expect((await running.call("/admin/content/base", { token: reader })).status).toBe(200);
    for (const [side, version, revision, sources] of [
      ["current", "0.1.0", seeded, seededSources],
      ["bundled", bundled.version, bundled.catalog.revision, bundled.sources],
    ] as const) {
      const reply = await running.call(`/admin/content/base/sources?side=${side}`, { token: reader });
      expect([reply.status, reply.cache, reply.body]).toEqual([200, "no-store", { version, revision, sources }]);
    }
    expect((await running.call("/admin/content/base/sources?side=current")).status).toBe(401);
    expect((await running.call("/admin/content/base/sources?side=other", { token: reader })).status).toBe(400);
    for (const path of ["/admin/content/base/preview", "/admin/content/base/apply"]) {
      const refused = await running.call(path, { method: "POST", token: reader, body: {} });
      expect([refused.status, refused.body.error.code]).toEqual([403, "forbidden"]);
    }
    const unknownField = await running.call("/admin/content/base/preview", { method: "POST", token: running.session, body: { merged: {} } });
    expect([unknownField.status, unknownField.body.error]).toEqual([400, { code: "invalid_request", message: 'Unknown field "merged"' }]);
    const badDecision = await running.call("/admin/content/base/preview", { method: "POST", token: running.session, body: { decisions: [{ collection: "items", id: "x", take: "both" }] } });
    expect([badDecision.status, badDecision.body.error.code]).toEqual([400, "invalid_request"]);
    // Well formed, but there is nothing to decide on a server with no edits.
    const bogus = await running.call("/admin/content/base/preview", { method: "POST", token: running.session, body: { decisions: [{ collection: "items", id: "sword", take: "mine" }] } });
    expect([bogus.status, bogus.body.error]).toEqual([400, { code: "invalid_decisions", message: "1 decision names no conflict. Decide each conflict the preview lists, once.",
      unknown: [{ collection: "items", id: "sword", take: "mine" }] }]);
    expect((await running.call("/admin/content/base/apply", { method: "POST", token: running.session, body: { decisions: [] } })).body.error)
      .toEqual({ code: "invalid_request", message: "expect is {activeRevision, bundledRevision}, as the preview reported them" });
    expect(await running.storage.catalog.activeRevision()).toBe(seeded);
  });

  it("previews with no conflicts and every check a publish runs, storing nothing", async () => {
    const history = await running.storage.catalog.history(50);
    const preview = await running.call("/admin/content/base/preview", { method: "POST", token: running.session, body: {} });
    expect(preview.status).toBe(200);
    const body = preview.body;
    expect({ base: body.base, direction: body.direction, expect: body.expect, conflicts: body.conflicts, conflictsTotal: body.conflictsTotal, decisionsNeeded: body.decisionsNeeded,
      changedCollections: body.changedCollections, items: body.summary.items, lootTables: body.summary.lootTables, ok: body.validation.ok, revision: body.validation.result.revision, stored: body.validation.result.stored })
      .toEqual({ base: { from: seed(), to: { version: "0.2.0", revision: bundled.catalog.revision } }, direction: "newer",
        expect: { activeRevision: seeded, bundledRevision: bundled.catalog.revision }, conflicts: [], conflictsTotal: 0, decisionsNeeded: 0,
        changedCollections: ["items", "lootTables"], items: { takenFromBase: 0, keptMine: 0, added: 1, deleted: 0, unchanged: seededSources.items.length, conflicts: 0 },
        lootTables: { takenFromBase: 1, keptMine: 0, added: 0, deleted: 0, unchanged: seededSources.lootTables.length - 1, conflicts: 0 },
        ok: true, revision: bundled.catalog.revision, stored: false });
    expect(body.live).toEqual(expect.arrayContaining(["items", "lootTables", "enemies"]));
    expect(body.affected.lootTables).toEqual([TABLE]);
    expect(await running.storage.catalog.history(50)).toEqual(history);
    expect(alice.messages.some(message => message.type === "content-updated")).toBe(false);
  });

  it("refuses an apply whose expect is stale", async () => {
    const stale = await running.call("/admin/content/base/apply", { method: "POST", token: running.session, body: { expect: { activeRevision: "c".repeat(64), bundledRevision: bundled.catalog.revision }, decisions: [] } });
    expect([stale.status, stale.body.error]).toEqual([409, { code: "stale_base", message: "The server's content or its bundled base changed since this update was previewed. Preview it again.",
      activeRevision: seeded, bundledRevision: bundled.catalog.revision }]);
  });

  it("applies onto the bundled revision exactly, moves the base, tells clients, and the next kill rolls the new table", async () => {
    const applied = await running.call("/admin/content/base/apply", { method: "POST", token: running.session,
      body: { expect: { activeRevision: seeded, bundledRevision: bundled.catalog.revision }, decisions: [], note: "Take base 0.2.0" } });
    expect(applied.status).toBe(200);
    expect({ revision: applied.body.revision, previous: applied.body.previous, stored: applied.body.stored, base: applied.body.base, to: applied.body.baseUpdate.to, decisions: applied.body.baseUpdate.decisions, notified: applied.body.notified })
      .toEqual({ revision: bundled.catalog.revision, previous: seeded, stored: true, base: { version: "0.2.0", revision: bundled.catalog.revision },
        to: { version: "0.2.0", revision: bundled.catalog.revision }, decisions: { mine: 0, theirs: 0 }, notified: 1 });
    await expect.poll(() => alice.messages.filter(message => message.type === "content-updated").map(message => message.revision), { timeout: 3000, interval: 10 }).toEqual([bundled.catalog.revision]);
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0]).toMatchObject({ baseVersion: "0.2.0", catalogRevision: bundled.catalog.revision });
    expect(await running.storage.catalog.baseSources(bundled.catalog.revision)).toBe(JSON.stringify(bundled.sources));
    const status = (await running.call("/admin/content/base", { token: running.session })).body;
    expect([status.updateAvailable, status.direction, status.serverModified]).toEqual([false, "same", false]);
    // One audit row, in the transaction that moved the pointer.
    const audit = (await running.call("/admin/audit?action=content.base-update", { token: running.session })).body.entries;
    expect(audit.map(({ id, at, ...entry }: any) => entry)).toEqual([{ accountId: OWNER, credential: "session", action: "content.base-update", target: bundled.catalog.revision,
      before: { revision: seeded, baseVersion: "0.1.0", baseRevision: seeded },
      after: { revision: bundled.catalog.revision, base: seeded, note: "Take base 0.2.0", changedCollections: ["items", "lootTables"], changedTables: applied.body.changedTables,
        baseVersion: "0.2.0", baseRevision: bundled.catalog.revision, decisions: { mine: 0, theirs: 0 } } }]);
    expect(running.logs.some(event => event.event === "content.base-update" && event.baseVersion === "0.2.0")).toBe(true);
    // No restart: the next kill already rolls the base's table.
    expect(await kill()).toEqual([MARKER, "gold"]);
    // Nothing left to take.
    const again = await running.call("/admin/content/base/preview", { method: "POST", token: running.session, body: {} });
    expect([again.status, again.body.error.code]).toEqual([409, "no_update"]);
  }, 60_000);

  it("rolls the base back with the content, and publishing afterwards keeps the base it was made from", async () => {
    // The kill left a marker on the ground; the older base has no such item, so the rollback is refused until it is gone.
    const refused = await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: seeded } });
    expect([refused.status, refused.body.error.code]).toEqual([409, "definition_in_use"]);
    for (const pile of Object.values(running.runtime.shared.lootPiles)) pile.items = pile.items.filter(stack => stack.itemId !== MARKER);
    const back = await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: seeded } });
    expect([back.status, back.body.revision, back.body.base]).toEqual([200, seeded, seed()]);
    expect(await running.storage.catalog.activeBase()).toEqual(seed());
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0].baseVersion).toBe("0.1.0");
    expect((await running.call("/admin/content/base", { token: running.session })).body.updateAvailable).toBe(true);
    // A publish inherits the base of the revision it was made from.
    const active = (await running.call("/admin/content/sources", { token: running.session })).body;
    const shops = structuredClone(active.sources.shops); shops[0].name = "Renamed on this server";
    const published = await running.call("/admin/content/publish", { method: "POST", token: running.session, body: { base: active.revision, collections: { shops: { revision: active.revisions.shops, value: shops } } } });
    expect([published.status, published.body.base]).toEqual([200, seed()]);
    expect((await running.storage.catalog.revisionInfo(published.body.revision))!.base).toEqual(seed());
    expect((await running.call("/admin/content/base", { token: running.session })).body.serverModified).toBe(true);
    // Leave the process on the catalog it started with, for anything that runs after.
    expect((await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: seeded } })).status).toBe(200);
  }, 60_000);
});
