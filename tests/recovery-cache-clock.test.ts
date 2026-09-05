import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillId } from "../game/src/contracts.js";
import { ok } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { rehydrateWorldContainers } from "../game/src/persistence/worldContainers.js";
import { Store, type GameState } from "../game/src/state/store.js";
import type { CombatInventoryPort } from "../game/src/systems/combat.js";
import { DeathSystem, RECOVERY_CACHE_ID } from "../game/src/systems/death.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const WALL_START = Date.UTC(2026, 8, 4, 12);
const FIFTEEN_MINUTES = 900_000;

function fixture(initialState?: GameState) {
  const store = new Store(17, WALL_START);
  if (initialState) store.replace(initialState);
  const events = new EventBus();
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  const addItem = vi.fn((_itemId: string, quantity: number) => ok(quantity));
  const onLootOpened = vi.fn();
  const inventory: CombatInventoryPort = {
    addItem,
    removeItem: (_itemId, quantity) => ok(quantity),
    countItem: () => 0,
    freeSlots: () => 28,
    hasRoomFor: () => true,
  };
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });
  const death = new DeathSystem({
    store,
    events,
    entities,
    inventory,
    dispatcher,
    onLootOpened,
    respawn: { resolve: () => ({ position: [0, 0, 0], regionId: "fallowmarch" }) },
  });
  const die = (atMs = 42_000) => {
    const state = store.get();
    state.inventory.slots.fill(null);
    state.inventory.slots[0] = { slotIndex: 0, itemId: "grithe_ore", quantity: 2 };
    state.player.position = [0, 0, 0];
    state.player.health = 0;
    death.tick(0, atMs);
    events.flush();
  };
  return { store, events, entities, dispatcher, death, die, addItem, onLootOpened };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WALL_START);
});

afterEach(() => vi.useRealTimers());

describe("recovery cache wall clock", () => {
  it("publishes the same fifteen-minute epoch deadline in state, entity metadata, and death event", () => {
    const h = fixture();
    h.die(42_000);

    expect(h.store.get().world.recoveryCache).toMatchObject({
      id: RECOVERY_CACHE_ID,
      items: [{ itemId: "grithe_ore", quantity: 2 }],
      expiresAtWallMs: WALL_START + FIFTEEN_MINUTES,
    });
    expect(h.entities.get(RECOVERY_CACHE_ID)?.meta).toMatchObject({
      expiresAtWallMs: WALL_START + FIFTEEN_MINUTES,
    });
    expect(h.events.since(0, ["player.died"]).events).toHaveLength(1);
    expect(h.events.since(0, ["player.died"]).events[0]).toMatchObject({
      atMs: 42_000,
      entityId: RECOVERY_CACHE_ID,
      data: { cacheId: RECOVERY_CACHE_ID, expiresAtWallMs: WALL_START + FIFTEEN_MINUTES },
    });
    expect(h.store.get().inventory.slots.every((slot) => slot === null)).toBe(true);
  });

  it("keeps a wall-clock cache through a simulation jump beyond its legacy deadline", () => {
    const h = fixture();
    h.die();
    h.death.tick(10_000_000, 10_042_000);

    expect(h.store.get().world.recoveryCache?.items).toEqual([
      { itemId: "grithe_ore", quantity: 2 },
    ]);
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeDefined();
    expect(h.dispatcher.run(RECOVERY_CACHE_ID, "loot").ok).toBe(true);
    expect(h.death.cacheRemainingMs()).toBe(FIFTEEN_MINUTES);
  });

  it("expires at the exact wall deadline while simulation time remains fixed", () => {
    const h = fixture();
    h.die(42_000);
    vi.setSystemTime(WALL_START + FIFTEEN_MINUTES - 1);
    h.death.tick(0, 42_000);
    expect(h.death.cacheRemainingMs()).toBe(1);
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeDefined();

    vi.setSystemTime(WALL_START + FIFTEEN_MINUTES);
    expect(h.death.cacheRemainingMs()).toBe(0);
    h.death.tick(0, 42_000);
    h.events.flush();

    expect(h.store.get().world.recoveryCache).toBeNull();
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeUndefined();
    expect(h.death.cacheRemainingMs()).toBeNull();
    expect(h.events.since(0, ["item.lost"]).events.filter(
      (event) => event.data.reason === "expired",
    )).toMatchObject([{
      atMs: 42_000,
      data: { cacheId: RECOVERY_CACHE_ID, items: [{ itemId: "grithe_ore", quantity: 2 }] },
    }]);
  });

  it("computes remaining wall time independently of the caller's simulation timestamp", () => {
    const h = fixture();
    h.die();
    vi.setSystemTime(WALL_START + 123_456);

    expect(h.death.cacheRemainingMs(0)).toBe(FIFTEEN_MINUTES - 123_456);
    expect(h.death.cacheRemainingMs(50_000_000)).toBe(FIFTEEN_MINUTES - 123_456);
  });

  it.each(["open", "take"])("rejects %s at the wall deadline before another tick", (action) => {
    const h = fixture();
    h.die();
    const inventoryBefore = h.store.snapshot().inventory;
    vi.setSystemTime(WALL_START + FIFTEEN_MINUTES);
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeDefined();

    const result = action === "open"
      ? h.dispatcher.run(RECOVERY_CACHE_ID, "loot")
      : h.death.take(RECOVERY_CACHE_ID, 0);

    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(h.store.get().world.recoveryCache).toBeNull();
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeUndefined();
    expect(h.store.get().inventory).toEqual(inventoryBefore);
    expect(h.addItem).not.toHaveBeenCalled();
    expect(h.onLootOpened).not.toHaveBeenCalled();
  });

  it("retains simulation expiry for an in-memory legacy cache without an epoch deadline", () => {
    const h = fixture();
    h.store.get().world.recoveryCache = {
      id: RECOVERY_CACHE_ID,
      regionId: "fallowmarch",
      position: [0, 0, 0],
      items: [{ itemId: "grithe_ore", quantity: 2 }],
      expiresAtMs: 50_000,
    };
    rehydrateWorldContainers(h.store.get(), h.entities);
    vi.setSystemTime(WALL_START + 86_400_000);
    h.death.tick(0, 49_999);

    expect(h.death.cacheRemainingMs()).toBe(1);
    expect(h.death.cacheRemainingMs(45_000)).toBe(5_000);
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeDefined();
    h.death.tick(1, 50_000);
    expect(h.store.get().world.recoveryCache).toBeNull();
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeUndefined();
  });

  it("continues expiring enemy loot piles on simulation time", () => {
    const h = fixture();
    h.store.get().world.lootPiles.loot_fenmite_1 = {
      position: [0, 0, 0],
      items: [{ itemId: "grithe_ore", quantity: 1 }],
      expiresAtMs: 5_000,
      ownerOnly: true,
    };
    rehydrateWorldContainers(h.store.get(), h.entities);
    vi.setSystemTime(WALL_START + 86_400_000);
    h.death.tick(0, 4_999);
    expect(h.store.get().world.lootPiles.loot_fenmite_1).toBeDefined();
    expect(h.entities.get("loot_fenmite_1")).toBeDefined();

    h.death.tick(1, 5_000);
    expect(h.store.get().world.lootPiles.loot_fenmite_1).toBeUndefined();
    expect(h.entities.get("loot_fenmite_1")).toBeUndefined();
  });
});

describe("recovery cache save and rehydration clocks", () => {
  it("preserves the original epoch and elapsed wall time across repeated real save roundtrips", () => {
    const saves = new SaveService(false);
    let h = fixture();
    h.die(5_000_000);
    const originalCache = h.store.snapshot().world.recoveryCache;

    for (const elapsedWallMs of [60_000, 300_000, FIFTEEN_MINUTES - 1]) {
      const raw = saves.serialize(h.store.get());
      vi.setSystemTime(WALL_START + elapsedWallMs);
      const loaded = saves.deserialize(raw);
      expect(loaded.status).toBe("loaded");
      if (!loaded.state) throw new Error(loaded.reason ?? "Save returned no state");
      h = fixture(loaded.state);
      expect(rehydrateWorldContainers(h.store.get(), h.entities)).toEqual({
        recoveryCaches: 1, lootPiles: 0,
      });
      h.death.tick(0, 0);

      expect(h.store.get().world.recoveryCache).toEqual(originalCache);
      expect(h.entities.get(RECOVERY_CACHE_ID)?.meta?.expiresAtWallMs)
        .toBe(WALL_START + FIFTEEN_MINUTES);
      expect(h.death.cacheRemainingMs(0)).toBe(FIFTEEN_MINUTES - elapsedWallMs);
      expect(h.dispatcher.run(RECOVERY_CACHE_ID, "loot").ok).toBe(true);
    }
  });

  it.each([FIFTEEN_MINUTES, FIFTEEN_MINUTES + 86_400_000])(
    "discards an offline-expired wall cache while deserializing after %i ms",
    (elapsedWallMs) => {
      const saves = new SaveService(false);
      const h = fixture();
      h.die(5_000_000);
      const raw = saves.serialize(h.store.get());
      vi.setSystemTime(WALL_START + elapsedWallMs);

      const loaded = saves.deserialize(raw);
      expect(loaded.status).toBe("loaded");
      if (!loaded.state) throw new Error(loaded.reason ?? "Save returned no state");
      expect(loaded.state.world.recoveryCache).toBeNull();
      expect(rehydrateWorldContainers(loaded.state, h.entities)).toEqual({
        recoveryCaches: 0, lootPiles: 0,
      });
      expect(h.entities.get(RECOVERY_CACHE_ID)).toBeUndefined();
    },
  );

  it("removes a cache that expires between deserialization and world rehydration", () => {
    const saves = new SaveService(false);
    const h = fixture();
    h.die();
    const raw = saves.serialize(h.store.get());
    vi.setSystemTime(WALL_START + FIFTEEN_MINUTES - 1);
    const loaded = saves.deserialize(raw);
    expect(loaded.status).toBe("loaded");
    if (!loaded.state) throw new Error(loaded.reason ?? "Save returned no state");
    expect(loaded.state.world.recoveryCache).not.toBeNull();

    vi.setSystemTime(WALL_START + FIFTEEN_MINUTES);
    expect(rehydrateWorldContainers(loaded.state, h.entities)).toEqual({
      recoveryCaches: 0, lootPiles: 0,
    });
    expect(loaded.state.world.recoveryCache).toBeNull();
    expect(h.entities.get(RECOVERY_CACHE_ID)).toBeUndefined();
  });
});
