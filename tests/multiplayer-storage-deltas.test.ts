import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const descriptor: WorldDescriptor = { providerId: "delta", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 200, availability: "available" };

it("migrates an existing full save, applies entity changes and deletions, and reopens complete state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-storage-delta-")), file = join(directory, "world.sqlite");
  let storage = new SqliteWorldStorage(file);
  try {
    const ports = await createMultiplayerLabWorld();
    const world = new HeadlessWorld(descriptor, ports); world.join("alice");
    await storage.claimPlayer(descriptor, "alice", "s1", "Alice"); const leases = { alice: { sessionId: "s1", action: "hold" as const } };
    const initial = world.snapshot(); initial.leases = leases; await storage.commit(initial);
    // Restart from a legacy save, including startup removal before the first patched commit.
    const restored = new HeadlessWorld(descriptor, { ...ports, initialize(runtime) { runtime.entities.remove("multiplayer:frog"); } }, await storage.load(descriptor));
    restored.join("alice").store.get().currency = 17;
    restored.entities.get("multiplayer:caster")!.combat!.health = 1;
    const delta = restored.snapshot({}, true); delta.leases = leases;
    expect(delta.entities.map(entity => entity.id)).toEqual(["multiplayer:caster"]);
    expect(delta.removedEntityIds).toEqual(["multiplayer:frog"]);
    const committedOre = structuredClone(delta.entities[0]);
    restored.entities.get("multiplayer:caster")!.combat!.health = 2;
    expect(delta.entities[0]).toEqual(committedOre);
    await storage.commit(delta); restored.committed(delta); await storage.close(); storage = new SqliteWorldStorage(file);
    const loaded = (await storage.load(descriptor))!;
    expect(loaded.entities.map(entity => entity.id)).toEqual(initial.entities.filter(entity => entity.id !== "multiplayer:frog").map(entity => entity.id));
    expect(loaded.entities.find(entity => entity.id === "multiplayer:caster")?.combat?.health).toBe(1);
    expect(loaded.players.alice!.currency).toBe(17);
    expect(loaded.entityWrites).toBeUndefined();
    expect((await storage.openWorld(descriptor))!.entities).toEqual(loaded.entities);
    const next = restored.snapshot({}, true);
    expect(next.entities.map(entity => entity.id)).toEqual(["multiplayer:caster"]);
    expect(restored.snapshot({}, true).entities.map(entity => entity.id)).toEqual(["multiplayer:caster"]);
    await storage.commit(next); restored.committed(next);
    expect(restored.snapshot({}, true).entities).toEqual([]);
  } finally {
    await storage.close();
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-storage-delta-")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

it("rolls back entities, player state, clock and receipts together when a patch fails", async () => {
  const storage = new SqliteWorldStorage(":memory:");
  try {
    const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld()); world.join("alice");
    await storage.claimPlayer(descriptor, "alice", "s1", "Alice"); const leases = { alice: { sessionId: "s1", action: "hold" as const } };
    const initial = world.snapshot({}, true); initial.leases = leases; await storage.commit(initial); world.committed(initial);
    const before = await storage.load(descriptor);
    world.players.get("alice")!.store.get().currency = 99; world.tick();
    const record = world.snapshot({ alice: [{ operation: 1, sequence: 1, command: "test", outcome: { status: "accepted", sequence: 1, tick: 1, result: {} } }] }, true);
    record.leases = leases;
    record.entities.push({ ...world.entities.get("multiplayer:ore")!, id: null as never });
    await expect(storage.commit(record)).rejects.toThrow();
    expect(await storage.load(descriptor)).toEqual(before);
  } finally { await storage.close(); }
});

/** The lab pad as a later catalog builds it: the range moved, the passage portal gone, a well added. */
async function republishedLab(): Promise<HeadlessWorldPorts> {
  const ports = await createMultiplayerLabWorld();
  ports.entities.find(entity => entity.id === "multiplayer:range")!.position = [-3, 0, -9];
  ports.entities.splice(ports.entities.findIndex(entity => entity.id === "multiplayer:portal"), 1);
  ports.entities.push({ id: "multiplayer:well", name: "Lab well", archetype: "landmark", tier: 1, regionId: "fallowmarch",
    position: [3, 0, -6], state: "available", interactions: ["inspect"], view: { assetId: "crate_wood" } });
  return ports;
}

it("rebuilds every structure from the running content, and keeps what play made and moved", async () => {
  const storage = new SqliteWorldStorage(":memory:");
  try {
    const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld());
    const alice = world.join("alice"), bob = world.join("bob");
    await storage.claimPlayer(descriptor, "alice", "s1", "Alice"); await storage.claimPlayer(descriptor, "bob", "s2", "Bob");
    const leases = { alice: { sessionId: "s1", action: "hold" as const }, bob: { sessionId: "s2", action: "hold" as const } };
    const commit = async (runtime: HeadlessWorld): Promise<void> => {
      const record = runtime.snapshot({}, true); record.leases = leases; await storage.commit(record); runtime.committed(record);
    };
    await commit(world);

    // Alice lights a campfire, drops some ore and mines the last yield out of the node. Bob dies with a pouch on him.
    const state = alice.store.get();
    state.player.position = [-8, 0, 0]; state.skills.mining = { level: 99, xp: 0 };
    state.inventory.slots[0] = { itemId: "palewood_log", quantity: 1, slotIndex: 0 };
    state.inventory.slots[1] = { itemId: "grithe_ore", quantity: 2, slotIndex: 1 };
    expect(world.execute("alice", { method: "buildCampfire", args: ["palewood_log"] }).ok).toBe(true);
    for (let tick = 0; tick < 40; tick++) world.tick();
    expect(world.execute("alice", { method: "dropItem", args: ["grithe_ore", 1] }).ok).toBe(true);
    const ore = world.entities.get("multiplayer:ore")!;
    ore.resource!.remaining = 1; ore.resource!.maxYields = 1; state.player.position = [5, 0, 0];
    expect(alice.gathering.begin(ore, "mine").ok).toBe(true);
    for (let tick = 0; tick < 100 && ore.resource!.remaining > 0; tick++) world.tick();
    bob.store.get().inventory.slots[0] = { itemId: "grithe_ore", quantity: 1, slotIndex: 0 };
    bob.store.get().player.health = 0; world.tick();
    // The frog took a beating and wandered off.
    const frog = world.entities.get("multiplayer:frog")!;
    frog.combat!.health = 1; world.entities.setPosition(frog.id, [15, 0, 3]);
    await commit(world);

    const pile = Object.keys(world.shared.lootPiles).find(id => id.startsWith("drop:alice:"))!;
    const kept = ["campfire:alice", "multiplayer:caster", "multiplayer:frog", pile, "recovery:bob"].sort();
    // Storage holds what play made or moves, and nothing the content build makes.
    expect((await storage.load(descriptor))!.entities.map(entity => entity.id).sort()).toEqual(kept);
    expect(world.shared.nodes["multiplayer:ore"]).toMatchObject({ state: "depleted", remaining: 0 });

    const restored = new HeadlessWorld(descriptor, await republishedLab(), await storage.openWorld(descriptor));
    const at = (id: string) => restored.entities.get(id)?.position;
    expect([at("multiplayer:range"), at("multiplayer:portal"), at("multiplayer:well")]).toEqual([[-3, 0, -9], undefined, [3, 0, -6]]);
    expect(kept.map(id => restored.entities.get(id)?.archetype)).toEqual(kept.map(id => world.entities.get(id)!.archetype));
    expect(restored.entities.get("multiplayer:frog")).toMatchObject({ position: [15, 0, 3], combat: { health: 1 } });
    expect(restored.entities.get("multiplayer:ore")).toMatchObject({ state: "depleted", resource: { remaining: 0 } });
  } finally { await storage.close(); }
});

it("drops the structures an older build stored: the world shows current content, and the first commit deletes their rows", async () => {
  const storage = new SqliteWorldStorage(":memory:");
  try {
    const old = new HeadlessWorld(descriptor, await createMultiplayerLabWorld());
    // What a save held before it kept only what play made: the whole entity table, with a stump since taken out of content.
    const legacy = old.snapshot({}, true);
    legacy.entities = [...structuredClone(old.entities.all()), { id: "multiplayer:stump", name: "Old stump", archetype: "landmark", tier: 1,
      regionId: "fallowmarch", position: [0, 0, -12], state: "available", interactions: ["inspect"], view: { assetId: "crate_wood" } }];
    await storage.commit(legacy);
    expect((await storage.load(descriptor))!.entities.length).toBe(old.entities.all().length + 1);

    const restored = new HeadlessWorld(descriptor, await republishedLab(), await storage.openWorld(descriptor));
    expect(["multiplayer:stump", "multiplayer:portal"].map(id => restored.entities.get(id))).toEqual([undefined, undefined]);
    expect(restored.entities.get("multiplayer:range")!.position).toEqual([-3, 0, -9]);
    const first = restored.snapshot({}, true);
    expect(first.entities).toEqual([]);
    await storage.commit(first); restored.committed(first);
    expect((await storage.load(descriptor))!.entities.map(entity => entity.id).sort()).toEqual(["multiplayer:caster", "multiplayer:frog"]);
  } finally { await storage.close(); }
});
