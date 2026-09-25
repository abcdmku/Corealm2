import { afterEach, expect, it, vi } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor, type WorldStorageRecord } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import {
  LOCAL_SCHEMA_VERSION, LocalPlayBusyError, memoryPort, openLocalWorldStorage,
  type KeyValuePort, type LocalStorageErrorEvent, type LocalStoreMeta, type LocalWorldStorage,
} from "../game/src/multiplayer/indexedDbStorage.js";

const descriptor: WorldDescriptor = { providerId: "local", worldId: "home", name: "Home", endpoint: "worker:",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 1, availability: "available" };
const leases = { alice: { sessionId: "s1", action: "hold" as const } };

/** A tab that was killed released nothing; these tests open the same store again in one process. */
const free = async (): Promise<{ release(): void }> => ({ release() {} });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.unstubAllGlobals(); });

/** A storage and a world that has already claimed one player, restored from whatever the port holds. */
async function open(options: Parameters<typeof openLocalWorldStorage>[0]): Promise<{ storage: LocalWorldStorage; world: HeadlessWorld }> {
  const storage = await openLocalWorldStorage(options);
  cleanups.push(() => storage.close().catch(() => {}));
  const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld(), await storage.openWorld(descriptor));
  const claim = await storage.claimPlayer(descriptor, "alice", "s1", "Alice");
  world.join("alice", claim ?? undefined);
  return { storage, world };
}

/** One commit the way the host makes it: an entity patch, this session's lease, then the baseline. */
async function commit(storage: LocalWorldStorage, world: HeadlessWorld): Promise<WorldStorageRecord> {
  const snapshot = world.snapshot({}, storage.entityPatches);
  snapshot.leases = leases;
  await storage.commit(snapshot);
  world.committed(snapshot);
  return snapshot;
}

/** Entity order is a store detail; every other field must survive a reopen unchanged. */
const stable = (record: WorldStorageRecord | null): unknown =>
  record && { ...record, entities: [...record.entities].sort((a, b) => a.id.localeCompare(b.id)) };

it("commits without touching the port, then hydrates the whole world back from one flush", async () => {
  const port = memoryPort();
  const writes: number[] = [];
  const counted: KeyValuePort = { ...port, async write(batch) { writes.push(batch.length); return port.write(batch); } };
  const { storage, world } = await open({ port: counted, flushMs: 60_000, guard: free });
  world.players.get("alice")!.store.get().currency = 40;
  world.entities.get("multiplayer:frog")!.combat!.health = 1;
  await commit(storage, world);
  expect(writes).toEqual([]);
  expect(storage.dirty).toBe(true);
  const before = await storage.load(descriptor);
  await storage.flush();
  expect(storage.dirty).toBe(false);
  expect(writes.length).toBe(1);
  await storage.close();

  const reopened = await openLocalWorldStorage({ port, flushMs: 60_000, guard: free });
  cleanups.push(() => reopened.close());
  expect(stable(await reopened.load(descriptor))).toEqual(stable(before));
  expect((await reopened.load(descriptor))!.players.alice!.currency).toBe(40);
  expect((await reopened.load(descriptor))!.entities.find(entity => entity.id === "multiplayer:frog")!.combat!.health).toBe(1);
  // A previous tab's leases are never stored, so nothing has to expire before this one can play.
  expect(await reopened.claimPlayer(descriptor, "alice", "s2", "Alice")).not.toBeNull();
});

it("writes only the entity rows a tick changed", async () => {
  const port = memoryPort();
  const batches: string[][] = [];
  const counted: KeyValuePort = { ...port, async write(batch) { batches.push(batch.map(write => `${write.store}/${write.key}`)); return port.write(batch); } };
  const { storage, world } = await open({ port: counted, flushMs: 60_000, guard: free });
  await commit(storage, world);
  await storage.flush();
  const row = (id: string) => `entities/${JSON.stringify(["local", "home"])}\u0000${id}`;
  // A save keeps what play made or moves: on a fresh pad, its two creatures.
  expect(batches[0]!.filter(row => row.startsWith("entities/")).sort()).toEqual([row("multiplayer:caster"), row("multiplayer:frog")]);

  world.entities.get("multiplayer:frog")!.combat!.health = 1;
  await commit(storage, world);
  await storage.flush();
  expect(batches[1]!.filter(row => row.startsWith("entities/"))).toEqual([row("multiplayer:frog")]);
});

it("heals a local save an older build wrote with every structure in it", async () => {
  const port = memoryPort();
  const first = await open({ port, flushMs: 60_000, guard: free });
  // What local play stored before a save kept only what play made: the whole entity table, and a stump content has since removed.
  const legacy = first.world.snapshot({}, true);
  legacy.entities = [...structuredClone(first.world.entities.all()), { id: "multiplayer:stump", name: "Old stump", archetype: "landmark", tier: 1,
    regionId: "fallowmarch", position: [0, 0, -12], state: "available", interactions: ["inspect"] }];
  legacy.leases = leases; await first.storage.commit(legacy); await first.storage.close();
  expect((await port.getAll("entities")).length).toBe(first.world.entities.all().length + 1);

  const { storage, world } = await open({ port, flushMs: 60_000, guard: free });
  expect([world.entities.get("multiplayer:stump"), world.entities.get("multiplayer:range")?.archetype]).toEqual([undefined, "station"]);
  await commit(storage, world); await storage.flush();
  expect((await port.getAll("entities")).map(([key]) => key.slice(key.indexOf("\u0000") + 1)).sort()).toEqual(["multiplayer:caster", "multiplayer:frog"]);
});

it("keeps a killed tab on the last flushed cut instead of a torn one", async () => {
  const port = memoryPort();
  const { storage, world } = await open({ port, flushMs: 60_000, guard: free });
  const pile = { position: [1, 0, 1] as [number, number, number], items: [{ itemId: "copper_ore", quantity: 1 }], expiresAtMs: 99_000, ownerOnly: false };
  world.shared.lootPiles["pile:1"] = pile;
  await commit(storage, world);
  await storage.flush();

  // The pickup: the pile leaves the ground and the item enters the purse in one commit.
  delete world.shared.lootPiles["pile:1"];
  world.players.get("alice")!.store.get().currency = 10;
  await commit(storage, world);
  // The tab dies here, between flushes. No close, no flush.

  const recovered = await openLocalWorldStorage({ port, flushMs: 60_000, guard: free });
  cleanups.push(() => recovered.close());
  const loaded = (await recovered.load(descriptor))!;
  expect(Object.keys(loaded.world.lootPiles)).toEqual(["pile:1"]);
  expect(loaded.players.alice!.currency).toBe(0);
});

it("records its schema version and catalog revision, and refuses a store written by a newer build", async () => {
  const port = memoryPort();
  const { storage, world } = await open({ port, flushMs: 60_000, now: () => 1_700_000_000_000, guard: free });
  const snapshot = world.snapshot({}, storage.entityPatches);
  snapshot.leases = leases; snapshot.catalogRevision = "rev-7";
  await storage.commit(snapshot); world.committed(snapshot);
  await storage.flush();
  expect(await port.get("meta", "store")).toEqual({ schemaVersion: LOCAL_SCHEMA_VERSION, catalogRevision: "rev-7", updatedAt: 1_700_000_000_000 } satisfies LocalStoreMeta);

  await port.write([{ store: "meta", key: "store", value: { schemaVersion: LOCAL_SCHEMA_VERSION + 1, catalogRevision: null, updatedAt: 1 } }]);
  await expect(openLocalWorldStorage({ port, guard: free })).rejects.toThrow(/newer build/);
});

it("survives a port that rejects: keeps the data, reports it, and ends up in memory only", async () => {
  const port = memoryPort();
  let failing = true;
  const errors: LocalStorageErrorEvent[] = [];
  const flaky: KeyValuePort = { ...port, async write(batch) {
    if (failing) throw new Error("QuotaExceededError");
    return port.write(batch);
  } };
  const { storage, world } = await open({ port: flaky, flushMs: 60_000, maxFlushFailures: 3, onError: event => errors.push(event), guard: free });
  world.players.get("alice")!.store.get().currency = 3;
  await commit(storage, world);
  await storage.flush();
  expect(errors.map(event => event.attempt)).toEqual([1]);
  expect(errors[0]!.degraded).toBe(false);
  expect(storage.dirty).toBe(true);

  // The host keeps committing while the port is broken.
  world.players.get("alice")!.store.get().currency = 4;
  await commit(storage, world);
  failing = false;
  await storage.flush();
  expect(storage.dirty).toBe(false);
  const recovered = await openLocalWorldStorage({ port, guard: free });
  cleanups.push(() => recovered.close());
  expect((await recovered.load(descriptor))!.players.alice!.currency).toBe(4);

  failing = true;
  world.players.get("alice")!.store.get().currency = 5;
  await commit(storage, world);
  for (let attempt = 0; attempt < 4; attempt++) await storage.flush();
  expect(errors.map(event => event.attempt)).toEqual([1, 1, 2, 3]);
  expect(errors.at(-1)!.degraded).toBe(true);
  expect(storage.memoryOnly).toBe(true);
  // Memory-only, but still a working world storage.
  expect((await storage.load(descriptor))!.players.alice!.currency).toBe(5);
});

it("flushes on its own timer while dirty", async () => {
  const port = memoryPort();
  const { storage, world } = await open({ port, flushMs: 5, guard: free });
  world.players.get("alice")!.store.get().currency = 12;
  await commit(storage, world);
  await vi.waitFor(() => expect(storage.dirty).toBe(false), { timeout: 5_000 });
  expect(((await port.get("worlds", JSON.stringify(["local", "home"]))) as { tick: number }).tick).toBeGreaterThanOrEqual(0);
});

it("writes a change to the player soon after it settles, caps the wait while changes keep coming, and leaves a ticking clock to the idle cadence", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const port = memoryPort(), writes: number[] = [];
    const counted: KeyValuePort = { ...port, async write(batch) { writes.push(Date.now()); return port.write(batch); } };
    const { storage, world } = await open({ port: counted, guard: free });
    // The first commit with a player in it is a change. Write it, then watch what follows.
    await commit(storage, world); await storage.flush(); await vi.advanceTimersByTimeAsync(10_000); writes.length = 0;
    const flushesBefore = storage.flushStats.flushes;
    const began = Date.now(), alice = world.players.get("alice")!.store.get();

    // Only the clock moves: the play clock ticks in every commit, and that alone waits the full five seconds.
    for (let tick = 0; tick < 30; tick++) { alice.meta.playSeconds += 0.1; await commit(storage, world); await vi.advanceTimersByTimeAsync(100); }
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(writes.map(at => at - began)).toEqual([5_000]);

    // One change, then quiet: written half a second after it.
    writes.length = 0; alice.currency = 99; const changed = Date.now(); await commit(storage, world);
    for (let tick = 0; tick < 10; tick++) { await vi.advanceTimersByTimeAsync(100); alice.meta.playSeconds += 0.1; await commit(storage, world); }
    expect(writes.map(at => at - changed)).toEqual([500]);

    // A player who never stands still is written every two seconds, not never.
    writes.length = 0; const walking = Date.now();
    for (let tick = 0; tick < 45; tick++) { alice.player.position = [tick + 1, 0, 0]; await commit(storage, world); await vi.advanceTimersByTimeAsync(100); }
    expect(writes.map(at => at - walking)).toEqual([2_000, 4_000]);
    expect(storage.flushStats.flushes - flushesBefore).toBe(4);
  } finally { vi.useRealTimers(); }
});

it("lets one tab own the store and tells the second one why it cannot", async () => {
  await expect(openLocalWorldStorage({ port: memoryPort(), guard: async () => null }))
    .rejects.toThrow(/already open in another tab/);
  await expect(openLocalWorldStorage({ port: memoryPort(), guard: async () => null })).rejects.toBeInstanceOf(LocalPlayBusyError);

  // The default guard, against the real Web Locks API a worker and this runtime both have.
  const lockName = `corealm.test.${Math.random().toString(36).slice(2)}`;
  const first = await openLocalWorldStorage({ port: memoryPort(), lockName });
  await expect(openLocalWorldStorage({ port: memoryPort(), lockName })).rejects.toBeInstanceOf(LocalPlayBusyError);
  await first.close();
  const second = await openLocalWorldStorage({ port: memoryPort(), lockName });
  cleanups.push(() => second.close());
  expect(second.dirty).toBe(true);
});
