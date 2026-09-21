import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor, type WorldStorageRecord } from "../game/src/contracts.js";
import type { PlayerSessionState } from "../game/src/state/store.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const descriptor = (worldId: string): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 8, availability: "available" });
const key = (worldId: string) => JSON.stringify(["reference", worldId]);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The tables exactly as the format 1 storage created them. */
const FORMAT_1 = `
CREATE TABLE worlds (world_key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
CREATE TABLE world_chunks (world_key TEXT NOT NULL, chunk_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key, chunk_key)) STRICT;
CREATE TABLE world_receipts (world_key TEXT NOT NULL, player_id TEXT NOT NULL, operation INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,player_id,operation)) STRICT;
CREATE TABLE world_entities (world_key TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,entity_id)) STRICT;`;
const receipt = (operation: number) => ({ operation, sequence: operation, command: '{"method":"stop","args":[]}', outcome: { status: "accepted" as const, sequence: operation, tick: operation, result: {} } });
const fire = { id: "campfire:player", position: [-8, 0, 1.5] as [number, number, number], regionId: "fallowmarch" as const, logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 900 };

it("moves format 1 players into one character per account, keeps every world's own objects, and does it once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-migration-")), file = join(directory, "worlds.sqlite");
  cleanups.push(async () => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-migration-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  });
  // Real player and world state from the simulation, laid out by hand in the rows format 1 wrote.
  const ports = await createMultiplayerLabWorld();
  const world = new HeadlessWorld(descriptor("north"), ports);
  for (const id of ["alice", "bob", "carol", "constructor"]) world.join(id);
  world.tick();
  const snapshot = world.snapshot({}, false);
  const player = (id: string, edit: (state: PlayerSessionState) => void): PlayerSessionState => { const state = structuredClone(snapshot.players[id]!); edit(state); return state; };
  const random = (seed: number) => ({ ...snapshot.random!.players.alice!, loot: seed });
  // Formats 1 and 2 stamped a hand-edited content version where format 3 keeps the fixture and the catalog revision.
  const { fixture: _fixture, catalogRevision: _catalogRevision, ...legacySnapshot } = snapshot;
  const payload = (worldId: string, tick: number, extra: Partial<WorldStorageRecord> & { playerWrites?: "patch" }) => JSON.stringify({ ...legacySnapshot, contentVersion: "corealm-pve-1", key: { providerId: "reference", worldId }, tick,
    entities: [], receipts: {}, entityWrites: "patch", removedEntityIds: [], players: {}, random: { world: snapshot.random!.world, players: {} }, playerWrites: "patch", ...extra });

  const old = new DatabaseSync(file); old.exec(FORMAT_1);
  const putWorld = old.prepare("INSERT INTO worlds VALUES (?,?)"), putChunk = old.prepare("INSERT INTO world_chunks VALUES (?,?,?)");
  const putReceipt = old.prepare("INSERT INTO world_receipts VALUES (?,?,?,?)"), putEntity = old.prepare("INSERT INTO world_entities VALUES (?,?,?)");
  // north: the incremental layout the last format 1 server wrote. Alice has less XP here, and a campfire.
  putWorld.run(key("north"), payload("north", 500, {}));
  for (const entity of snapshot.entities) putEntity.run(key("north"), entity.id, JSON.stringify(entity));
  putChunk.run(key("north"), '["player","alice"]', JSON.stringify(player("alice", state => { state.skills.mining.xp = 500; state.currency = 10; state.ownedWorld.campfire = fire; })));
  putChunk.run(key("north"), '["random","alice"]', JSON.stringify(random(11)));
  for (const operation of [4, 5]) putReceipt.run(key("north"), "alice", operation, JSON.stringify(receipt(operation)));
  putChunk.run(key("north"), '["player","constructor"]', JSON.stringify(player("constructor", state => { state.currency = 3; })));
  // south: Alice's most advanced character, receipts still in the older per-player chunk, and Bob tied on XP with a lower tick.
  putWorld.run(key("south"), payload("south", 200, {}));
  putChunk.run(key("south"), '["player","alice"]', JSON.stringify(player("alice", state => { state.skills.mining.xp = 900; state.currency = 99; state.ownedWorld.obstaclesUsed = { "south:gate": 2 }; })));
  putChunk.run(key("south"), '["random","alice"]', JSON.stringify(random(22)));
  putChunk.run(key("south"), '["receipts","alice"]', JSON.stringify([receipt(1), receipt(2)]));
  putChunk.run(key("south"), '["player","bob"]', JSON.stringify(player("bob", state => { state.currency = 20; })));
  // east: the oldest layout, everything inside the payload. Bob ties on XP here with the higher tick.
  putWorld.run(key("east"), payload("east", 300, { entityWrites: undefined, removedEntityIds: undefined, playerWrites: undefined, entities: snapshot.entities,
    players: { bob: player("bob", state => { state.currency = 30; }), carol: player("carol", state => { state.currency = 40; }) },
    receipts: { carol: [receipt(1)] }, random: { world: snapshot.random!.world, players: { carol: random(33) } } }));
  old.close();

  const lines: string[] = [];
  let storage = new SqliteWorldStorage(file, { now: () => 1_700_000_000_000, log: line => lines.push(line) });
  cleanups.push(() => storage.close());
  expect(lines.map(line => JSON.parse(line))).toEqual([{ event: "storage-migrated", from: 1, to: 2, worlds: 3, players: 4, conflicts: [
    { playerId: "alice", kept: key("south"), discarded: [key("north")] }, { playerId: "bob", kept: key("east"), discarded: [key("south")] }] },
    { event: "storage-migrated", from: 2, to: 3, worlds: 3 }]);

  const inspect = () => {
    const db = storage.database, rows = (sql: string) => db.prepare(sql).all().map(row => ({ ...row }));
    return {
      version: rows("SELECT value FROM meta WHERE key='schema_version'"),
      chunks: rows("SELECT name FROM sqlite_master WHERE name='world_chunks'"),
      players: rows("SELECT account_id, name, json_extract(character,'$.currency') AS currency, json_extract(character,'$.ownedWorld') AS owned, last_world, first_seen, last_seen, playtime_seconds FROM players ORDER BY account_id"),
      owned: rows("SELECT world_key, account_id, json_extract(owned,'$.campfire.id') AS campfire, json_extract(owned,'$.obstaclesUsed') AS obstacles, json_extract(random,'$.loot') AS loot, resident FROM world_players ORDER BY world_key, account_id"),
      receipts: rows("SELECT world_key, player_id, operation FROM world_receipts ORDER BY world_key, player_id, operation"),
      leftovers: rows("SELECT world_key, json_extract(payload,'$.players') AS players, json_extract(payload,'$.receipts') AS receipts, json_extract(payload,'$.random.players') AS random, json_extract(payload,'$.playerWrites') AS writes FROM worlds ORDER BY world_key"),
    };
  };
  const at = 1_700_000_000_000;
  const expected = {
    version: [{ value: "4" }], chunks: [],
    players: [
      { account_id: "alice", name: "Wanderer", currency: 99, owned: null, last_world: key("south"), first_seen: at, last_seen: at, playtime_seconds: 0 },
      { account_id: "bob", name: "Wanderer", currency: 30, owned: null, last_world: key("east"), first_seen: at, last_seen: at, playtime_seconds: 0 },
      { account_id: "carol", name: "Wanderer", currency: 40, owned: null, last_world: key("east"), first_seen: at, last_seen: at, playtime_seconds: 0 },
      { account_id: "constructor", name: "Wanderer", currency: 3, owned: null, last_world: key("north"), first_seen: at, last_seen: at, playtime_seconds: 0 },
    ],
    owned: [
      { world_key: key("east"), account_id: "bob", campfire: null, obstacles: "{}", loot: null, resident: 0 },
      { world_key: key("east"), account_id: "carol", campfire: null, obstacles: "{}", loot: 33, resident: 0 },
      { world_key: key("north"), account_id: "alice", campfire: "campfire:player", obstacles: "{}", loot: 11, resident: 1 },
      { world_key: key("north"), account_id: "constructor", campfire: null, obstacles: "{}", loot: null, resident: 0 },
      { world_key: key("south"), account_id: "alice", campfire: null, obstacles: '{"south:gate":2}', loot: 22, resident: 0 },
      { world_key: key("south"), account_id: "bob", campfire: null, obstacles: "{}", loot: null, resident: 0 },
    ],
    receipts: [
      { world_key: key("east"), player_id: "carol", operation: 1 },
      { world_key: key("north"), player_id: "alice", operation: 4 }, { world_key: key("north"), player_id: "alice", operation: 5 },
      { world_key: key("south"), player_id: "alice", operation: 1 }, { world_key: key("south"), player_id: "alice", operation: 2 },
    ],
    leftovers: ["east", "north", "south"].map(worldId => ({ world_key: key(worldId), players: "{}", receipts: "{}", random: "{}", writes: null })),
  };
  expect(inspect()).toEqual(expected);

  // What a starting world and a joining player now see.
  const resident = (await storage.openWorld(descriptor("north")))!;
  expect(Object.keys(resident.players)).toEqual(["alice"]);
  expect(resident.players.alice).toMatchObject({ currency: 99, ownedWorld: { campfire: fire } });
  expect(resident.receipts.alice!.map(entry => entry.operation)).toEqual([4, 5]);
  expect(resident.random!.players.alice!.loot).toBe(11);
  expect(resident.entities.map(entity => entity.id)).toEqual(snapshot.entities.map(entity => entity.id));
  expect((await storage.load(descriptor("east")))!.entities.map(entity => entity.id)).toEqual(snapshot.entities.map(entity => entity.id));
  const claim = (await storage.claimPlayer(descriptor("north"), "alice", "s1", "Alice"))!;
  expect(claim.character!.skills.mining.xp).toBe(900); expect(claim.lastWorld).toEqual({ providerId: "reference", worldId: "south" });
  expect(claim.world).toMatchObject({ ownedWorld: { campfire: fire, obstaclesUsed: {} }, random: { loot: 11 } });
  const restored = new HeadlessWorld(descriptor("north"), ports, resident);
  expect(restored.join("alice", claim).store.get()).toMatchObject({ currency: 99, world: { campfire: fire }, player: { position: [0, 0, 0] } });
  await storage.releasePlayer(descriptor("north"), "alice", "s1");

  // Reopening is a no-op: nothing logged, nothing moved.
  await storage.close(); lines.length = 0;
  storage = new SqliteWorldStorage(file, { now: () => 1_800_000_000_000, log: line => lines.push(line) });
  expect(lines).toEqual([]);
  expect(inspect()).toEqual({ ...expected, players: expected.players.map(row => row.account_id === "alice" ? { ...row, name: "Alice", last_seen: at } : row) });
});

it("stamps a new database with the schema version and refuses one written by a newer server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-migration-")), file = join(directory, "worlds.sqlite");
  cleanups.push(async () => {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-migration-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  });
  const lines: string[] = [];
  const storage = new SqliteWorldStorage(file, { log: line => lines.push(line) });
  expect({ ...storage.database.prepare("SELECT value FROM meta WHERE key='schema_version'").get() }).toEqual({ value: "4" });
  storage.database.prepare("UPDATE meta SET value='5' WHERE key='schema_version'").run();
  await storage.close();
  expect(lines).toEqual([]);
  expect(() => new SqliteWorldStorage(file)).toThrow("Database schema 5 is newer than this server understands");
});
