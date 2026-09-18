import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const descriptor: WorldDescriptor = { providerId: "delta", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337, population: 0, capacity: 200, availability: "available" };

it("migrates an existing full save, applies entity changes and deletions, and reopens complete state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "corealm-storage-delta-")), file = join(directory, "world.sqlite");
  let storage = new SqliteWorldStorage(file);
  try {
    const ports = await createMultiplayerLabWorld();
    const world = new HeadlessWorld(descriptor, ports); world.join("alice");
    const initial = world.snapshot(); await storage.commit(initial);
    // Restart from a legacy save, including startup removal before the first patched commit.
    const restored = new HeadlessWorld(descriptor, { ...ports, initialize(runtime) { runtime.entities.remove("multiplayer:frog"); } }, await storage.load(descriptor));
    restored.join("alice").store.get().currency = 17;
    restored.entities.get("multiplayer:ore")!.state = "depleted";
    const delta = restored.snapshot({}, true);
    expect(delta.entities.map(entity => entity.id)).toEqual(["multiplayer:ore"]);
    expect(delta.removedEntityIds).toEqual(["multiplayer:frog"]);
    const committedOre = structuredClone(delta.entities[0]);
    restored.entities.get("multiplayer:ore")!.state = "available";
    expect(delta.entities[0]).toEqual(committedOre);
    await storage.commit(delta); restored.committed(delta); await storage.close(); storage = new SqliteWorldStorage(file);
    const loaded = (await storage.load(descriptor))!;
    expect(loaded.entities.map(entity => entity.id)).toEqual(initial.entities.filter(entity => entity.id !== "multiplayer:frog").map(entity => entity.id));
    expect(loaded.entities.find(entity => entity.id === "multiplayer:ore")?.state).toBe("depleted");
    expect(loaded.players.alice!.currency).toBe(17);
    expect(loaded.entityWrites).toBeUndefined();
    expect((await storage.loadResident(descriptor))!.entities).toEqual(loaded.entities);
    const next = restored.snapshot({}, true);
    expect(next.entities.map(entity => entity.id)).toEqual(["multiplayer:ore"]);
    expect(restored.snapshot({}, true).entities.map(entity => entity.id)).toEqual(["multiplayer:ore"]);
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
    const initial = world.snapshot({}, true); await storage.commit(initial); world.committed(initial);
    const before = await storage.load(descriptor);
    world.players.get("alice")!.store.get().currency = 99; world.tick();
    const record = world.snapshot({ alice: [{ operation: 1, sequence: 1, command: "test", outcome: { status: "accepted", sequence: 1, tick: 1, result: {} } }] }, true);
    record.entities.push({ ...world.entities.get("multiplayer:ore")!, id: null as never });
    await expect(storage.commit(record)).rejects.toThrow();
    expect(await storage.load(descriptor)).toEqual(before);
  } finally { await storage.close(); }
});
