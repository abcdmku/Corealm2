import { afterEach, describe, expect, it } from "vitest";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor, type WorldStorage, type WorldStorageRecord } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const descriptor = (worldId: string): WorldDescriptor => ({ providerId: "lease", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337, population: 0, capacity: 8, availability: "available" });
const north = descriptor("north"), south = descriptor("south");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** One world's snapshot with the given player's currency, written under a lease action. */
async function runtime(target: WorldDescriptor) { return new HeadlessWorld(target, await createMultiplayerLabWorld()); }
function record(world: HeadlessWorld, playerId: string, currency: number, sessionId: string, action: "hold" | "reserve" | "release" = "hold"): WorldStorageRecord {
  world.join(playerId).store.get().currency = currency;
  return { ...world.snapshot(), leases: { [playerId]: { sessionId, action } } };
}

for (const kind of ["sqlite", "memory"] as const) describe(`${kind} player leases`, () => {
  function open() {
    const clock = { now: 1_000_000 };
    const storage: WorldStorage = kind === "sqlite" ? new SqliteWorldStorage(":memory:", { now: () => clock.now }) : new MemoryWorldStorage(() => clock.now);
    cleanups.push(() => storage.close());
    return { storage, clock };
  }
  it("grants one live lease per account across worlds and lets only its holder release it", async () => {
    const { storage } = open();
    expect(await storage.claimPlayer(north, "p", "s1", "P")).toEqual({ character: null, lastWorld: null, world: null });
    expect(await storage.claimPlayer(north, "p", "s2", "P")).toBeNull();
    expect(await storage.claimPlayer(south, "p", "s3", "P")).toBeNull();
    expect(await storage.claimPlayer(south, "q", "s4", "Q")).not.toBeNull();
    await storage.releasePlayer(south, "p", "s1"); await storage.releasePlayer(north, "p", "other");
    expect(await storage.claimPlayer(south, "p", "s3", "P")).toBeNull();
    await storage.releasePlayer(north, "p", "s1");
    expect(await storage.claimPlayer(south, "p", "s3", "P")).not.toBeNull();
  });
  it("expires a crashed world's lease on its own, and a renewing world keeps its lease", async () => {
    const { storage, clock } = open(); const world = await runtime(north);
    await storage.claimPlayer(north, "p", "s1", "P");
    clock.now += 10_000; await storage.commit(record(world, "p", 5, "s1"));
    // Renewed at +10 s, so the lease now runs to +40 s. Then the world dies and renews nothing.
    clock.now += 29_999; expect(await storage.claimPlayer(south, "p", "s2", "P")).toBeNull();
    clock.now += 1;
    const claim = await storage.claimPlayer(south, "p", "s2", "P");
    expect(claim?.character?.currency).toBe(5); expect(claim?.lastWorld).toEqual({ providerId: "lease", worldId: "north" }); expect(claim?.world).toBeNull();
  });
  it("refuses a character write from a world whose lease was taken, and still keeps that world's own objects", async () => {
    const { storage, clock } = open(); const stalled = await runtime(north), taker = await runtime(south);
    await storage.claimPlayer(north, "p", "s1", "P");
    expect(await storage.commit(record(stalled, "p", 5, "s1"))).toEqual({ fenced: [] });
    clock.now += 30_000;
    await storage.claimPlayer(south, "p", "s2", "P");
    expect(await storage.commit(record(taker, "p", 9, "s2"))).toEqual({ fenced: [] });
    // The stalled world wakes up and commits the copy it still simulates.
    stalled.players.get("p")!.store.get().world.obstaclesUsed = { "lease:gate": 3 };
    expect(await storage.commit(record(stalled, "p", 1, "s1"))).toEqual({ fenced: ["p"] });
    expect(await storage.commit(record(stalled, "p", 1, "s1", "release"))).toEqual({ fenced: ["p"] });
    expect((await storage.load(south))!.players.p!.currency).toBe(9);
    const kept = (await storage.load(north))!.players.p!;
    expect(kept.currency).toBe(9); expect(kept.ownedWorld.obstaclesUsed).toEqual({ "lease:gate": 3 });
    expect(await storage.claimPlayer(north, "p", "s3", "P")).toBeNull();
  });
  it("never writes the character from a resident copy", async () => {
    const { storage } = open(); const world = await runtime(north);
    await storage.claimPlayer(north, "p", "s1", "P");
    await storage.commit(record(world, "p", 5, "s1", "release"));
    world.players.get("p")!.store.get().currency = 999;
    expect(await storage.commit(world.snapshot())).toEqual({ fenced: [] });
    expect((await storage.claimPlayer(south, "p", "s2", "P"))?.character?.currency).toBe(5);
  });
  it("saves a dropped player with the reservation, so any world may take the account at once", async () => {
    const { storage } = open(); const world = await runtime(north);
    await storage.claimPlayer(north, "p", "s1", "P");
    await storage.commit(record(world, "p", 7, "s1", "reserve"));
    expect((await storage.claimPlayer(south, "p", "s2", "P"))?.character?.currency).toBe(7);
    expect(await storage.commit(record(world, "p", 1, "s1"))).toEqual({ fenced: ["p"] });
  });
  it("frees the leases a world left behind when that world starts again, and no others", async () => {
    const { storage } = open();
    await storage.claimPlayer(north, "p", "s1", "P"); await storage.claimPlayer(south, "q", "s2", "Q");
    await storage.openWorld(north);
    expect(await storage.claimPlayer(south, "p", "s3", "P")).not.toBeNull();
    expect(await storage.claimPlayer(north, "q", "s4", "Q")).toBeNull();
  });
});

describe("sqlite player records", () => {
  it("accounts playtime and last seen on the renewal cadence and on release, not on every tick", async () => {
    const clock = { now: 1_000_000 }; const storage = new SqliteWorldStorage(":memory:", { now: () => clock.now }); cleanups.push(() => storage.close());
    const world = await runtime(north);
    const row = () => ({ ...storage.database.prepare("SELECT name, last_world, first_seen, last_seen, playtime_seconds FROM players WHERE account_id='p'").get() });
    const lease = () => ({ ...storage.database.prepare("SELECT world_key, session_id, claimed_at, expires_at, reserved FROM player_leases WHERE account_id='p'").get() });
    await storage.claimPlayer(north, "p", "s1", "Pia");
    expect(row()).toEqual({ name: "Pia", last_world: null, first_seen: 1_000_000, last_seen: 1_000_000, playtime_seconds: 0 });
    expect(lease()).toEqual({ world_key: '["lease","north"]', session_id: "s1", claimed_at: 1_000_000, expires_at: 1_030_000, reserved: 0 });
    clock.now += 9_999; await storage.commit(record(world, "p", 1, "s1"));
    expect(row()).toEqual({ name: "Pia", last_world: '["lease","north"]', first_seen: 1_000_000, last_seen: 1_000_000, playtime_seconds: 0 });
    expect(lease().expires_at).toBe(1_030_000);
    clock.now += 1; await storage.commit(record(world, "p", 1, "s1"));
    expect(row()).toMatchObject({ last_seen: 1_010_000, playtime_seconds: 10 }); expect(lease().expires_at).toBe(1_040_000);
    clock.now += 2_500; await storage.commit(record(world, "p", 2, "s1", "release"));
    expect(row()).toMatchObject({ first_seen: 1_000_000, last_seen: 1_012_500, playtime_seconds: 12 });
    expect(storage.database.prepare("SELECT count(*) AS held FROM player_leases").get()!.held).toBe(0);
  });
  it("rolls a refused transaction back whole: world, character, lease and receipts", async () => {
    const storage = new SqliteWorldStorage(":memory:"); cleanups.push(() => storage.close());
    const world = await runtime(north); await storage.claimPlayer(north, "p", "s1", "P");
    await storage.commit(record(world, "p", 5, "s1")); const before = await storage.load(north);
    world.tick(); const failing = record(world, "p", 50, "s1", "release");
    failing.receipts = { p: [{ operation: 1, sequence: 1, command: "{}", outcome: { status: "accepted", sequence: 1, tick: 1, result: {} } }, { operation: null as never, sequence: 2, command: "{}", outcome: { status: "accepted", sequence: 2, tick: 1, result: {} } }] };
    await expect(storage.commit(failing)).rejects.toThrow();
    expect(await storage.load(north)).toEqual(before);
    expect(await storage.claimPlayer(south, "p", "s2", "P")).toBeNull();
  });
});
