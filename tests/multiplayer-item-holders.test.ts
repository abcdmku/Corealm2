import { describe, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA";
const descriptor: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "lab", seed: 1337, capacity: 2, population: 0, availability: "available" };

describe.each([["sqlite", () => new SqliteWorldStorage(":memory:", { log: () => {} })], ["memory", () => new MemoryWorldStorage()]] as const)("stored item holders (%s)", (_name, open) => {
  it("finds an item that only lies in an offline player's recovery cache, and names the world", async () => {
    const storage = open();
    await storage.openWorld(descriptor);
    const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld());
    const claim = await storage.claimPlayer(descriptor, ALICE, "session-1", "Alice");
    const state = world.join(ALICE, claim!).store.get();
    state.player.name = "Alice";
    state.inventory.slots.fill(null); state.bank.slots = [];
    state.inventory.slots[2] = { itemId: "pale_quartz", quantity: 1, slotIndex: 2 };
    state.world.recoveryCache = { id: `recovery:${ALICE}`, position: [1, 0, 1], regionId: "fallowmarch", items: [{ itemId: "march_stone", quantity: 2 }], expiresAtMs: 9e9 };
    world.leave(ALICE);
    const snapshot = world.snapshot();
    snapshot.leases = { [ALICE]: { sessionId: "session-1", action: "release" } };
    expect((await storage.commit(snapshot)).fenced).toEqual([]);

    expect(await storage.admin.itemHolders(["march_stone", "pale_quartz", "no_such_item"], 20)).toEqual([
      { accountId: ALICE, name: "Alice", itemId: "march_stone", place: "recovery-cache", world: { providerId: "reference", worldId: "north" } },
      { accountId: ALICE, name: "Alice", itemId: "pale_quartz", place: "inventory", world: null },
    ]);
    expect(await storage.admin.itemHolders(["march_stone"], 20)).toHaveLength(1);
    expect(await storage.admin.itemHolders([], 20)).toEqual([]);
    await storage.close();
  });
});
