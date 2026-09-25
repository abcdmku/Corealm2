import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type SemanticEntity, type Vec3, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { content } from "../game/src/content/index.js";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { RESOLVED_CATALOG, RESOLVED_TABLES } from "../game/src/content/resolvedCatalog.js";
import type { CompiledWorld } from "../game/src/content/worldData.js";
import { setSkillLevel } from "../game/src/state/store.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { Solids } from "../game/src/systems/solids.js";
import { createAssetHost } from "../game/src/multiplayer/assetManifest.js";
import { activeServerCatalog, CATALOG_TABLE_APPLIES, seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import type { HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { planSpawns, type SpawnContext } from "../game/src/multiplayer/spawnPlan.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { contentUpdated } from "../game/src/multiplayer/protocol.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld, { PLACEMENT_GROUP as GROUP } from "./fixtures/placementWorld.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB", CAROL = "acc_CCCCCCCCCCCCCCCCCCCCCC";
const TABLE = "shared_t0_frog", MARKER = "publish_marker";
const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };

type Sources = Record<string, any>;
const clone = <T>(value: T): T => structuredClone(value);
let file: string, sources: Sources;
let running: Awaited<ReturnType<typeof boot>>;

async function boot() {
  const clock = { ms: Date.now() };
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const logs: Record<string, unknown>[] = [];
  const storage = new SqliteWorldStorage(file, { log: () => {} });
  await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources }, () => {}, { now: () => clock.ms });
  const server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
    ownerAccount: OWNER, now: () => clock.ms, log: event => logs.push(event),
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch, now: () => clock.ms }) });
  const token = (accountId: string, name: string) => signJoinToken(created.signing, joinTokenClaims({ accountId, name, endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: clock.ms / 1000 }));
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  };
  const session = (await call("/admin/session", { method: "POST", body: { token: token(OWNER, "Owner") } })).body.session as string;
  const hosted = [...server.worlds.values()][0]!;
  return { server, storage, logs, call, token, session, hosted, runtime: hosted.runtime };
}

/** One real client. Commands go over the socket; the test reads what the server then holds. */
async function connect(accountId: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${running.server.port}/`); const messages: any[] = [];
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  await new Promise<void>(resolve => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId: "north", token: running.token(accountId, name), protocolVersion: WORLD_PROTOCOL_VERSION }));
  for (let waited = 0; !messages.some(message => message.type === "joined" || message.type === "error") && waited < 5000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10));
  const joined = messages.find(message => message.type === "joined");
  if (!joined) throw new Error(`join refused: ${JSON.stringify(messages)}`);
  let sequence = 0, operation = joined.nextOperation as number;
  const command = (method: string, args: unknown[]) => ws.send(JSON.stringify({ type: "command", envelope: { sessionId: joined.sessionId, sequence: ++sequence, operation: operation++, command: { method, args } } }));
  return { ws, messages, joined, command };
}
let alice: Awaited<ReturnType<typeof connect>>;

const frogs = () => running.runtime.entities.all().filter(entity => entity.meta?.groupId === GROUP).sort((a, b) => a.id.localeCompare(b.id));
/** Alice attacks over her socket until the creature dies. Returns the item ids of the pile that kill dropped. */
async function kill(id: string): Promise<string[]> {
  const { runtime } = running, player = runtime.players.get(ALICE)!, state = player.store.get(), target = runtime.entities.get(id)!;
  setSkillLevel(state, "melee", 99);
  state.player.health = 99; state.player.position = [target.position[0] - 1.2, 0, target.position[2]];
  player.combat.runtimeFor(state, target).health = 1;
  const before = new Set(Object.keys(runtime.shared.lootPiles));
  alice.command("attack", [id]);
  await expect.poll(() => runtime.shared.enemies[id]?.state, { timeout: 30_000, interval: 25 }).toBe("dead");
  await expect.poll(() => Object.keys(runtime.shared.lootPiles).some(pile => !before.has(pile)), { timeout: 5000, interval: 25 }).toBe(true);
  return Object.entries(runtime.shared.lootPiles).filter(([pile]) => !before.has(pile)).flatMap(([, pile]) => pile.items.map(stack => stack.itemId)).sort();
}
/** The respawn timer is content. The test only brings it forward. */
async function respawn(id: string): Promise<SemanticEntity> {
  running.runtime.shared.enemies[id]!.respawnAtMs = 0; delete running.runtime.shared.enemies[id]!.respawnAtWallMs;
  await expect.poll(() => running.runtime.shared.enemies[id]?.state, { timeout: 5000, interval: 25 }).toBe("idle");
  return running.runtime.entities.get(id)!;
}

async function current(): Promise<{ revision: string; revisions: Record<string, string>; sources: Sources }> {
  const answer = await running.call("/admin/content/sources", { token: running.session });
  expect(answer.status).toBe(200);
  return answer.body;
}
/**
 * Edit the active sources the way devdocs does: read, change whole collections, send each back with
 * the revision the read reported. Nothing here hashes a collection, so every publish in this file is
 * evidence that what `GET /admin/content/sources` reports is what `POST /admin/content/publish` takes.
 */
async function publish(change: (draft: Sources) => void, options: { path?: string; token?: string; note?: string } = {}) {
  const active = await current(), draft = clone(active.sources);
  change(draft);
  const collections = Object.fromEntries(Object.keys(draft).filter(name => JSON.stringify(draft[name]) !== JSON.stringify(active.sources[name]))
    .map(name => [name, { revision: active.revisions[name]!, value: draft[name] }]));
  return running.call(options.path ?? "/admin/content/publish", { method: "POST", token: options.token ?? running.session,
    body: { base: active.revision, collections, ...(options.note ? { note: options.note } : {}) } });
}
const markerItem = { id: MARKER, name: "Publish Marker", tier: 1, description: "Dropped only by a table a test published.", stackable: true, value: 1, category: "resource" };
/** The frogs' table drops the marker every time and nothing else, so one kill proves which table was rolled. */
const markerRoll = (draft: Sources) => {
  const table = draft.lootTables.find((row: any) => row.id === TABLE);
  for (const roll of table.rolls) { roll.drops = roll.id === "items" ? [{ itemId: MARKER, quantity: [1, 1], chance: 1 }] : []; roll.tables = []; }
};

beforeAll(async () => {
  file = join(tmpdir(), `corealm-publish-${randomUUID()}.sqlite`);
  sources = Object.fromEntries(await readContentSources());
  running = await boot();
  alice = await connect(ALICE, "Alice");
}, 60_000);
afterAll(async () => {
  alice?.ws.terminate();
  await running?.server.close();
  for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
});

describe("publishing content into a running server", () => {
  let seeded: string, withItem: string, withLoot: string;

  it("names every table of the compiled catalog as live or on restart", () => {
    const compiled = compileCatalog(sources, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    expect(compiled.ok).toBe(true);
    expect(Object.keys(CATALOG_TABLE_APPLIES).sort()).toEqual(Object.keys(compiled.ok ? compiled.catalog.tables : {}).sort());
    expect(Object.entries(CATALOG_TABLE_APPLIES).filter(([, applies]) => applies === "live").map(([name]) => name).sort()).toEqual(
      ["compiledCreatures", "creatureDefinitions", "creatureProfiles", "encounters", "enemies", "items", "lootTables", "placements", "recipes", "shops", "species", "world"]);
  });

  it("starts on the seeded revision and refuses a credential without content:publish", async () => {
    seeded = RESOLVED_CATALOG.revision;
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0].catalogRevision).toBe(seeded);
    const reader = (await running.call("/admin/tokens", { method: "POST", token: running.session, body: { label: "export", scopes: ["content:read"] } })).body.token as string;
    const refused = await publish(draft => { draft.items.push(markerItem); }, { token: reader });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: { code: "forbidden", message: "This credential is missing the content:publish scope" } });
    expect((await publish(draft => { draft.items.push(markerItem); }, { token: "cas_nope" })).status).toBe(401);
    expect(await running.storage.catalog.activeRevision()).toBe(seeded);
  });

  it("validates without storing anything", async () => {
    const history = await running.storage.catalog.history(50);
    const checked = await publish(draft => { draft.items.push(markerItem); }, { path: "/admin/content/validate" });
    expect(checked.status).toBe(200);
    expect({ previous: checked.body.previous, stored: checked.body.stored, unchanged: checked.body.unchanged, changedCollections: checked.body.changedCollections, items: checked.body.affected.items })
      .toEqual({ previous: seeded, stored: false, unchanged: false, changedCollections: ["items"], items: [MARKER] });
    expect(await running.storage.catalog.revisionInfo(checked.body.revision)).toBeNull();
    expect(await running.storage.catalog.history(50)).toEqual(history);
    expect(running.server.catalog.revision).toBe(seeded);
    expect(alice.messages.some(message => message.type === "content-updated")).toBe(false);
  });

  it("rolls the published loot table on the very next kill, and tells connected clients", async () => {
    // Bob is the game's own client session, which is what raises the refresh prompt.
    const selected = { ...world, endpoint: `ws://127.0.0.1:${running.server.port}/`, catalogRevision: seeded };
    const bob = await new WebSocketProvider("reference", [selected], async () => ({ token: "" })).connect(selected, { token: running.token(BOB, "Bob") });
    const told: string[] = []; bob.subscribeContent!(revision => told.push(revision));
    const item = await publish(draft => { draft.items.push(markerItem); }, { note: "marker item" });
    expect(item.status).toBe(200);
    withItem = item.body.revision;
    const loot = await publish(markerRoll, { note: "frogs drop the marker" });
    expect(loot.status).toBe(200);
    withLoot = loot.body.revision;
    expect(new Set([seeded, withItem, withLoot]).size).toBe(3);
    expect({ previous: loot.body.previous, stored: loot.body.stored, changedCollections: loot.body.changedCollections, onRestart: loot.body.onRestart, lootTables: loot.body.affected.lootTables, notified: loot.body.notified, assetValidation: loot.body.assetValidation })
      .toEqual({ previous: withItem, stored: true, changedCollections: ["lootTables"], onRestart: [], lootTables: [TABLE], notified: 2, assetValidation: "bundled" });
    expect(loot.body.live).toEqual(expect.arrayContaining(["lootTables", "enemies"]));
    expect(loot.body.affected.enemies).toContain(GROUP);
    expect(loot.body.affected.regions).toBeUndefined();
    await expect.poll(() => alice.messages.filter(message => message.type === "content-updated").map(message => message.revision), { timeout: 3000, interval: 10 }).toEqual([withItem, withLoot]);
    expect(told).toEqual([withItem, withLoot]);
    await bob.close();
    expect(() => contentUpdated({ type: "content-updated", revision: "not-a-revision" })).toThrow("Invalid content update");
    expect(() => contentUpdated({ type: "content-updated", revision: withLoot, reload: true })).toThrow("Invalid content update");

    expect(await kill(frogs()[0]!.id)).toEqual(["gold", MARKER]);
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0].catalogRevision).toBe(withLoot);
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/catalog/${withLoot}`)).json()).tables.items.find((row: any) => row.id === MARKER).name).toBe("Publish Marker");
    // Saves carry the revision they were written under. The restart test reads it back from the database.
    expect(running.runtime.snapshot().catalogRevision).toBe(withLoot);
    await respawn(frogs()[0]!.id);
  }, 60_000);

  it("moves a spawn at the next respawn and leaves the living creature where it was", async () => {
    const target = frogs()[1]!, before = { position: [...target.position], spawnX: target.meta!.spawnX as number, spawnZ: target.meta!.spawnZ as number };
    const moved = await publish(draft => { draft.placements.find((row: any) => row.id === GROUP).centre[0] += 20; }, { note: "frogs move east" });
    expect(moved.status).toBe(200);
    expect({ regions: moved.body.affected.regions, spawnGroups: moved.body.affected.spawnGroups, spawns: moved.body.spawns, placements: moved.body.affected.placements })
      .toEqual({ regions: ["fallowmarch"], spawnGroups: [GROUP], spawns: [{ world: "north", added: 0, pending: 7, retiring: 0, removed: 0 }], placements: [GROUP] });
    // Alive: same spawn, and it has not been carried off towards the new habitat.
    expect([target.meta!.spawnX, target.meta!.spawnZ]).toEqual([before.spawnX, before.spawnZ]);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(Math.hypot(target.position[0] - before.spawnX, target.position[2] - before.spawnZ)).toBeLessThan(13);
    await kill(target.id);
    const back = await respawn(target.id);
    expect(back.meta!.spawnX as number - before.spawnX).toBeGreaterThan(10);
    expect(Math.hypot(back.position[0] - (back.meta!.spawnX as number), back.position[2] - (back.meta!.spawnZ as number))).toBeLessThan(.01);
    expect(Math.hypot(back.position[0] - (-30), back.position[2] - (-52))).toBeLessThan(30);
    // The others are still waiting for their own deaths.
    expect(frogs().filter(frog => frog.id !== target.id).every(frog => (frog.meta!.spawnX as number) < -38)).toBe(true);
  }, 60_000);

  it("rolls back to a stored revision through the same path", async () => {
    const back = await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: withItem } });
    expect(back.status).toBe(200);
    expect({ revision: back.body.revision, stored: back.body.stored, changedCollections: back.body.changedCollections }).toEqual({ revision: withItem, stored: false, changedCollections: ["lootTables", "placements"] });
    expect(running.server.catalog.revision).toBe(withItem);
    const drops = await kill(frogs()[2]!.id);
    expect(drops).toContain("gold");
    expect(drops).not.toContain(MARKER);
    expect((await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: withItem } })).body.error.code).toBe("already_active");
    expect((await running.call("/admin/content/rollback", { method: "POST", token: running.session, body: { revision: "0".repeat(64) } })).status).toBe(404);
    const history = (await running.call("/admin/content/revision", { token: running.session })).body.history as any[];
    expect(history.map(row => row.revision).slice(0, 2)).toEqual([withItem, history[1].revision]);
    expect(history[0].previous).toBe(history[1].revision);
  }, 60_000);

  it("refuses to remove an item a player holds, and retires it instead", async () => {
    const state = running.runtime.players.get(ALICE)!.store.get();
    state.inventory.slots[0] = { itemId: MARKER, quantity: 3, slotIndex: 0 };
    // Carol died holding one and went offline. Her cache is a row of `world_players`, not of her character.
    const carol = await connect(CAROL, "Carol");
    running.runtime.players.get(CAROL)!.store.get().world.recoveryCache = { id: `recovery:${CAROL}`, position: [-50, 0, -40], regionId: "fallowmarch", items: [{ itemId: MARKER, quantity: 1 }], expiresAtMs: 9e12 };
    carol.ws.send(JSON.stringify({ type: "leave" }));
    await new Promise(resolve => setTimeout(resolve, 400));
    const active = await running.storage.catalog.activeRevision();
    const removal = await publish(draft => { draft.items = draft.items.filter((row: any) => row.id !== MARKER); });
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe("definition_in_use");
    expect(removal.body.error.message).toContain("Mark it retired instead");
    expect(removal.body.error.blockers).toContainEqual({ kind: "item", id: MARKER, heldBy: "player", place: "inventory", accountId: ALICE, name: "Alice" });
    expect(removal.body.error.blockers).toContainEqual({ kind: "item", id: MARKER, heldBy: "player", place: "recovery-cache", accountId: CAROL, name: "Carol", world: "north" });
    expect(removal.body.error.blockers.some((blocker: any) => blocker.heldBy === "loot-pile" && blocker.id === MARKER)).toBe(true);
    expect(await running.storage.catalog.activeRevision()).toBe(active);

    const retired = await publish(draft => { draft.items.find((row: any) => row.id === MARKER).retired = true; markerRoll(draft); }, { note: "retire the marker" });
    expect(retired.status).toBe(200);
    expect(retired.body.problems).toContainEqual({ path: `lootTables.${TABLE}.items`, message: `Retired item ${MARKER} no longer drops`, severity: "info" });
    expect(await kill(frogs()[3]!.id)).toEqual(["gold"]);
    expect(state.inventory.slots[0]).toEqual({ itemId: MARKER, quantity: 3, slotIndex: 0 });
    expect(content.item(MARKER)).toMatchObject({ name: "Publish Marker", retired: true });
  }, 60_000);

  it("refuses a living creature's definition the same way", async () => {
    const refused = await publish(draft => {
      draft.creatureDefinitions = draft.creatureDefinitions.filter((row: any) => row.id !== GROUP);
      draft.encounters = draft.encounters.filter((row: any) => !row.members.some((member: any) => member.creatureId === GROUP));
      draft.placements = draft.placements.filter((row: any) => row.id !== GROUP);
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.blockers.find((blocker: any) => blocker.kind === "creature")).toMatchObject({ kind: "creature", id: GROUP, heldBy: "world", world: "north" });
  });

  it("answers a stale collection with 409, a compile failure with 422, and stores neither", async () => {
    const active = await current(), history = await running.storage.catalog.history(50);
    const stale = await running.call("/admin/content/publish", { method: "POST", token: running.session,
      body: { base: active.revision, collections: { lootTables: { revision: "f".repeat(64), value: active.sources.lootTables } } } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toEqual({ code: "stale_collections", message: "Content changed on the server since this edit began. Your draft has been preserved.",
      stale: ["lootTables"], revisions: { lootTables: active.revisions.lootTables }, revision: active.revision });

    const broken = await publish(draft => { draft.lootTables.find((row: any) => row.id === TABLE).rolls[0].drops = [{ itemId: "no_such_item", quantity: [1, 1], chance: 1 }]; });
    expect(broken.status).toBe(422);
    expect(broken.body.error.code).toBe("content_invalid");
    expect(broken.body.error.problems.map((problem: any) => problem.message)).toContain('unknown item reference "no_such_item"');

    const asset = await publish(draft => { draft.npcs[0].assetId = "no_such_model"; });
    expect(asset.status).toBe(422);
    expect(asset.body.error.problems.map((problem: any) => problem.message)).toEqual(['unknown asset reference "no_such_model"']);

    expect((await running.call("/admin/content/publish", { method: "POST", token: running.session, body: { base: active.revision, collections: { nonsense: { revision: "f".repeat(64), value: [] } } } })).body.error)
      .toEqual({ code: "invalid_request", message: 'Unknown collection "nonsense"' });
    const huge = await running.call("/admin/content/publish", { method: "POST", token: running.session,
      body: { base: active.revision, collections: { items: { revision: "f".repeat(64), value: [] } }, note: "x".repeat(17 * 1024 * 1024) } });
    expect([huge.status, huge.body.error]).toEqual([413, { code: "payload_too_large", message: "Request bodies are capped at 16 MiB" }]);
    expect(await running.storage.catalog.history(50)).toEqual(history);
    expect(running.server.catalog.revision).toBe(active.revision);
  });

  it("serialises concurrent publishes: the second sees the first", async () => {
    const active = await current();
    const send = (name: string) => { const items = clone(active.sources.items); items.find((row: any) => row.id === MARKER).name = name;
      return running.call("/admin/content/publish", { method: "POST", token: running.session, body: { base: active.revision, collections: { items: { revision: active.revisions.items!, value: items } } } }); };
    const answers = await Promise.all([send("Marker One"), send("Marker Two")]);
    expect(answers.map(answer => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find(answer => answer.status === 409)!.body.error.code).toBe("stale_collections");
    expect(content.item(MARKER)!.name).toBe(answers[0]!.status === 200 ? "Marker One" : "Marker Two");
  });

  it("lets a removed placement's creatures finish their lives, and spawns an added placement at once", async () => {
    const alive = frogs().filter(frog => running.runtime.shared.enemies[frog.id]?.state !== "dead"), dead = frogs().filter(frog => !alive.includes(frog));
    expect([alive.length, dead.length]).toEqual([5, 2]);
    const swapped = await publish(draft => {
      const index = draft.placements.findIndex((row: any) => row.id === GROUP), { anchorAdjustments: _anchors, habitatId: _habitat, ...row } = draft.placements[index];
      draft.placements.splice(index, 1, { ...row, id: "publish_toads", centre: [-90, -52], count: 2, radius: 12, formation: { kind: "ring", spacing: 8, rotation: 0 }, dressing: [] });
    }, { note: "toads replace frogs" });
    expect(swapped.status).toBe(200);
    expect({ spawnGroups: swapped.body.affected.spawnGroups, spawns: swapped.body.spawns })
      .toEqual({ spawnGroups: ["publish_toads", GROUP], spawns: [{ world: "north", added: 2, pending: 0, retiring: 5, removed: 2 }] });
    const toads = running.runtime.entities.all().filter(entity => entity.meta?.groupId === "publish_toads");
    expect(toads.map(toad => [toad.id, toad.state, Math.hypot(toad.position[0] + 90, toad.position[2] + 52) < 20])).toEqual([["publish_toads_1", "alive", true], ["publish_toads_2", "alive", true]]);
    expect(frogs().map(frog => frog.id)).toEqual(alive.map(frog => frog.id));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(dead.map(frog => running.runtime.shared.enemies[frog.id])).toEqual([undefined, undefined]);
    // A frog that outlived its placement dies like any other, and then it is gone for good.
    const last = alive[0]!.id;
    expect(await kill(last)).toEqual(["gold"]);
    running.runtime.shared.enemies[last]!.respawnAtMs = 0; delete running.runtime.shared.enemies[last]!.respawnAtWallMs;
    await expect.poll(() => running.runtime.entities.get(last), { timeout: 5000, interval: 25 }).toBeUndefined();
    expect(running.runtime.shared.enemies[last]).toBeUndefined();
    expect(frogs()).toHaveLength(4);
  }, 60_000);

  it("audits every publish and rollback with the move it made", async () => {
    const entries = (await running.call("/admin/audit?limit=200", { token: running.session })).body.entries as any[];
    const moves = entries.filter(entry => entry.action.startsWith("content.")).reverse();
    expect(moves.map(entry => entry.action)).toEqual(["content.publish", "content.publish", "content.publish", "content.rollback", "content.publish", "content.publish", "content.publish"]);
    expect(moves.slice(0, 2).map(entry => [entry.target, entry.before, entry.after.note, entry.after.changedCollections, entry.accountId, entry.credential]))
      .toEqual([[withItem, { revision: seeded }, "marker item", ["items"], OWNER, "session"], [withLoot, { revision: withItem }, "frogs drop the marker", ["lootTables"], OWNER, "session"]]);
    expect([moves[3].target, moves[3].after.base]).toEqual([withItem, withItem]);
    expect((await running.storage.catalog.history(50)).length).toBe(moves.length + 1);
  });

  it("boots on the published revision after a restart", async () => {
    const published = running.server.catalog.revision;
    expect(published).not.toBe(seeded);
    alice.ws.terminate();
    await running.server.close();
    const reopened = new SqliteWorldStorage(file, { log: () => {} });
    const catalog = await activeServerCatalog(reopened.catalog);
    expect(catalog.revision).toBe(published);
    const saved = await reopened.openWorld(world);
    expect(saved?.catalogRevision).toBe(published);
    // The retired frogs left the save as they died; the placement that replaced them is in it.
    expect(saved!.entities.filter(entity => entity.meta?.groupId === GROUP)).toHaveLength(4);
    expect(saved!.entities.filter(entity => entity.meta?.groupId === "publish_toads").map(entity => entity.id).sort()).toEqual(["publish_toads_1", "publish_toads_2"]);
    expect((catalog.tables.items as any[]).find(row => row.id === MARKER)).toMatchObject({ retired: true, name: content.item(MARKER)!.name });
    await reopened.close();
    running = await boot();
    expect((await (await fetch(`http://127.0.0.1:${running.server.port}/worlds`)).json())[0].catalogRevision).toBe(published);
  }, 60_000);

  it("reports the revision of every source collection, which is the revision a publish accepts", async () => {
    const active = await current();
    expect(Object.keys(active.revisions).sort()).toEqual(Object.keys(active.sources).sort());
    // The same function the stale check runs. An editor in a browser never has to compute one.
    for (const name of Object.keys(active.sources)) expect(`${name}:${active.revisions[name]}`).toBe(`${name}:${collectionRevision(active.sources[name])}`);

    const stored = await publish(draft => { draft.items.find((row: any) => row.id === "worn_sword").description = "Reported revisions."; });
    expect(stored.status).toBe(200);
    // What was stored is reported back, so the next edit sends a revision the server will still take.
    expect(stored.body.revisions).toEqual({ items: collectionRevision((await current()).sources.items) });
    const again = await publish(draft => { draft.items.find((row: any) => row.id === "worn_sword").description = "And again."; });
    expect(again.status).toBe(200);
    // A dry run stores nothing, so it moves no revision.
    const dry = await publish(draft => { draft.items.find((row: any) => row.id === "worn_sword").description = "Only a dry run."; }, { path: "/admin/content/validate" });
    expect([dry.status, dry.body.stored, dry.body.revisions]).toEqual([200, false, {}]);
  });
});

describe("asset ids against a remote asset host", () => {
  it("fetches <assetBaseUrl>assets/manifest.json, revalidates with its ETag, and accepts audio paths it cannot see", async () => {
    const requests: { url: string; etag: string | null }[] = []; let at = 0;
    const host = createAssetHost({ assetBaseUrl: "https://assets.example.com/corealm/", now: () => at,
      fetch: (async (url: string, init: RequestInit) => {
        const etag = new Headers(init.headers).get("if-none-match"); requests.push({ url, etag });
        return etag === '"v1"' ? new Response(null, { status: 304 }) : new Response(JSON.stringify({ assets: [{ id: "animal_frog" }] }), { headers: { ETag: '"v1"' } });
      }) as typeof fetch });
    const pools = await host.pools({ audio: { cues: { step: { files: ["audio/sfx/step.ogg"] } } } });
    expect([host.source, pools.asset!.has("animal_frog"), pools.asset!.has("audio/sfx/step.ogg"), pools.asset!.has("no_such_model")]).toEqual(["remote", true, true, false]);
    await host.pools({}); at = 60_000; await host.pools({});
    expect(requests).toEqual([{ url: "https://assets.example.com/corealm/assets/manifest.json", etag: null }, { url: "https://assets.example.com/corealm/assets/manifest.json", etag: '"v1"' }]);
  });
  it("refuses a manifest that is not one, and a host that does not answer", async () => {
    const shaped = createAssetHost({ assetBaseUrl: "https://assets.example.com/", fetch: (async () => new Response(JSON.stringify({ assets: [{ name: "frog" }] }))) as typeof fetch });
    await expect(shaped.pools({})).rejects.toThrow("The asset manifest at https://assets.example.com/assets/manifest.json is not a manifest");
    const down = createAssetHost({ assetBaseUrl: "https://assets.example.com/", fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    await expect(down.pools({})).rejects.toThrow("could not be fetched");
  });
});
