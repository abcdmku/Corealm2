import { describe, expect, it } from "vitest";
import type { ItemId, RegionId, Result, SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { err, ok } from "../game/src/contracts.js";
import type { CampfireFuelDef } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { loadSerializedSave } from "../game/src/persistence/storage.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import {
  CAMPFIRE_BUILD_TIME_MS,
  CAMPFIRE_ENTITY_ID,
  CAMPFIRE_SAVE_ID,
  CampfireSystem,
  type CampfireEntityPort,
  type CampfireInventoryPort,
  type CampfirePlacementProbes,
} from "../game/src/systems/campfire.js";

const PALEWOOD: CampfireFuelDef = {
  logItemId: "palewood_log",
  tier: 1,
  buildTimeMs: CAMPFIRE_BUILD_TIME_MS,
  lifetimeMs: 72_000,
  buildXp: { fletching: 2, crafting: 2 },
  visualLogAssetId: "woodlog",
};

class TestInventory implements CampfireInventoryPort {
  readonly counts = new Map<ItemId, number>();

  countItem(itemId: ItemId): number {
    return this.counts.get(itemId) ?? 0;
  }

  removeItem(itemId: ItemId, quantity: number): Result<number> {
    const held = this.countItem(itemId);
    if (held < quantity) return err("NOT_ENOUGH_ITEMS", "missing test item");
    this.counts.set(itemId, held - quantity);
    return ok(quantity);
  }
}

class TestEntities implements CampfireEntityPort {
  readonly rows = new Map<string, SemanticEntity>();

  get(id: string): SemanticEntity | undefined {
    return this.rows.get(id);
  }

  add(entity: SemanticEntity): void {
    this.rows.set(entity.id, entity);
  }

  remove(id: string): boolean {
    return this.rows.delete(id);
  }
}

interface Harness {
  store: Store;
  events: EventBus;
  activity: ActivitySystem;
  inventory: TestInventory;
  entities: TestEntities;
  system: CampfireSystem;
  finishBuild(): void;
}

function harness(placementOverrides: Partial<CampfirePlacementProbes> = {}): Harness {
  const store = new Store(7, 0);
  store.get().player.position = [0, 0, 0];
  store.get().player.facingRad = 0;
  store.get().player.regionId = "fallowmarch";

  const events = new EventBus();
  const activity = new ActivitySystem(store, events);
  const inventory = new TestInventory();
  const entities = new TestEntities();
  let nowMs = 0;
  const placement: CampfirePlacementProbes = {
    groundAt: (_regionId: RegionId, _x: number, _z: number) => ({
      y: 4,
      normal: [0, 1, 0],
    }),
    withinPlayableBounds: (_regionId: RegionId, _position: Vec3) => true,
    distanceToWater: (_regionId: RegionId, _position: Vec3) => Number.POSITIVE_INFINITY,
    clearAt: (_regionId: RegionId, _position: Vec3, _radius: number) => true,
    ...placementOverrides,
  };
  const system = new CampfireSystem({
    store,
    events,
    activity,
    inventory,
    entities,
    placement,
    fuelFor: (itemId) => itemId === PALEWOOD.logItemId ? PALEWOOD : undefined,
    now: () => nowMs,
  });

  return {
    store,
    events,
    activity,
    inventory,
    entities,
    system,
    finishBuild(): void {
      nowMs = CAMPFIRE_BUILD_TIME_MS;
      activity.tick(CAMPFIRE_BUILD_TIME_MS, nowMs);
      events.flush();
    },
  };
}

function startBuild(h: Harness): void {
  h.inventory.counts.set(PALEWOOD.logItemId, 1);
  const result = h.system.build(PALEWOOD.logItemId);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
}

function expectNoBuildPayout(h: Harness): void {
  expect(h.inventory.countItem(PALEWOOD.logItemId)).toBe(1);
  expect(h.store.get().skills.fletching.xp).toBe(0);
  expect(h.store.get().skills.crafting.xp).toBe(0);
  expect(h.store.get().world.campfire).toBeNull();
  expect(h.entities.get(CAMPFIRE_ENTITY_ID)).toBeUndefined();
  expect(h.events.since(0, ["campfire.built"]).events).toHaveLength(0);
}

describe("campfire persistence integrity", () => {
  it("round-trips a completed fire through save repair and reconstructs its live station", () => {
    const before = harness();
    startBuild(before);
    before.finishBuild();

    expect(before.store.get().world.campfire?.id).toBe(CAMPFIRE_SAVE_ID);
    const loaded = loadSerializedSave(JSON.stringify(before.store.get()));
    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.world.campfire).toEqual(before.store.get().world.campfire);

    const after = harness();
    if (!loaded.state) throw new Error("save unexpectedly loaded without state");
    after.store.replace(loaded.state);
    expect(after.system.reconstruct()).toBe(true);
    expect(after.entities.get(CAMPFIRE_ENTITY_ID)).toMatchObject({
      id: CAMPFIRE_ENTITY_ID,
      archetype: "station",
      station: { kind: "campfire" },
      meta: { logItemId: PALEWOOD.logItemId },
    });
  });

  it.each([
    ["region", (h: Harness) => {
      const fire = h.store.get().world.campfire;
      if (fire) fire.regionId = "vellenwood";
    }, { regionId: "vellenwood" }],
    ["tier", (h: Harness) => {
      const fire = h.store.get().world.campfire;
      if (fire) fire.tier = 5;
    }, { tier: 5 }],
  ] as const)("rebuilds the live station when the persisted %s changes", (_label, mutate, expected) => {
    const h = harness();
    startBuild(h);
    h.finishBuild();
    const initial = h.entities.get(CAMPFIRE_ENTITY_ID);
    expect(initial).toBeDefined();

    mutate(h);
    expect(h.system.reconstruct()).toBe(true);

    const rebuilt = h.entities.get(CAMPFIRE_ENTITY_ID);
    expect(rebuilt).not.toBe(initial);
    expect(rebuilt).toMatchObject(expected);
  });

  it.each([
    ["changes region", (h: Harness) => { h.store.get().player.regionId = "vellenwood"; }],
    ["travels out of reach", (h: Harness) => { h.store.get().player.position = [40, 0, 40]; }],
  ] as const)("consumes nothing when the player %s before completion", (_label, travel) => {
    const h = harness();
    startBuild(h);

    travel(h);
    h.finishBuild();

    expectNoBuildPayout(h);
    expect(h.store.get().activity).toBeNull();
    expect(h.events.since(0, ["activity.stopped"]).events.at(-1)?.data.reason).toBe("failed");
  });

  it("revalidates the selected site before consuming the log or awarding XP", () => {
    let clear = true;
    const h = harness({ clearAt: () => clear });
    startBuild(h);

    clear = false;
    h.finishBuild();

    expectNoBuildPayout(h);
    expect(h.events.since(0, ["activity.stopped"]).events.at(-1)?.data.reason).toBe("failed");
  });
});
