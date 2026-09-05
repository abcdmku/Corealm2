import { describe, expect, it, vi } from "vitest";
import { SKILL_IDS, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { content, yieldRange } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, resourceDef } from "../game/src/content/resources.js";
import { EventBus } from "../game/src/core/events.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { GatheringSystem } from "../game/src/systems/gathering.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { EntityStore } from "../game/src/world/entities.js";
import { ForestResources, type ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

content.register({ items: ALL_ITEMS, resources: RESOURCES });

const noPins = new Set<string>();

function tree(id: string, position: Vec3 = [0, 0, 0]): ForestTreeDescriptor {
  return {
    id, position, resourceId: "tree_duskoak", regionId: "vellenwood",
    assetId: "tree_common_2", scale: 1.28, rotationY: 0.6, trunkRadius: 0.42,
  };
}

function harness(store = new Store(104, 0)) {
  const skillLevels = () => Object.fromEntries(
    SKILL_IDS.map((id) => [id, store.get().skills[id].level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  const onActivate = vi.fn();
  const onDeactivate = vi.fn();
  const getNodeState = vi.fn((id: string) => store.get().world.nodes[id]);
  const forest = new ForestResources({ entities, getNodeState, onActivate, onDeactivate });
  return { store, entities, forest, onActivate, onDeactivate, getNodeState, skillLevels };
}

describe("harvestable forest residency", () => {
  it("promotes nearby trees, preserves them across the boundary, and pins remote navigation targets", () => {
    const h = harness();
    const near = tree("forest_near", [35, 0, 0]);
    const far = tree("forest_far", [90, 0, 0]);
    h.forest.register(near);
    h.forest.register(far);
    expect(h.entities.size).toBe(0);
    expect(h.forest.update([0, 0, 0], noPins)).toBe(true);
    expect(h.entities.get(near.id)?.interactions).toContain("chop");
    expect(h.entities.get(far.id)).toBeUndefined();
    expect(h.forest.update([-15, 0, 0], noPins)).toBe(false);
    expect(h.entities.get(near.id)).toBeDefined();
    expect(h.forest.update([-15.01, 0, 0], new Set([far.id]))).toBe(true);
    expect(h.entities.get(near.id)).toBeUndefined();
    expect(h.entities.get(far.id)).toBeDefined();
    expect(h.onDeactivate).toHaveBeenCalledWith(near);
    expect(h.forest.update([-15.01, 0, 0], noPins)).toBe(true);
    expect(h.entities.size).toBe(0);
  });

  it("keeps stable identities, drawn transforms, and partially harvested yields through demotion", () => {
    const h = harness();
    const descriptor = tree("forest_partial");
    h.forest.register(descriptor);
    h.forest.update([0, 0, 0], noPins);
    const initial = h.entities.get(descriptor.id)!;
    const definition = resourceDef(descriptor.resourceId);
    const maxYields = initial.resource!.maxYields;
    h.store.get().world.nodes[descriptor.id] = {
      state: "available", remaining: 3, maxYields, respawnAtMs: null,
    };
    h.forest.update([100, 0, 0], noPins);
    expect(h.entities.size).toBe(0);
    const sparse = h.forest.resolve(descriptor.id)!;
    expect(h.entities.size).toBe(0);
    expect(sparse.resource).toMatchObject({ remaining: 3, maxYields, itemId: definition.itemId });
    expect(sparse.meta?.resourceId).toBe(definition.id);
    expect(sparse.view!.scale! * tierSilhouetteScale(sparse.tier)).toBeCloseTo(descriptor.scale, 10);
    expect(sparse.view?.rotationY).toBe(descriptor.rotationY);
    h.forest.update([0, 0, 0], noPins);
    expect(h.entities.get(descriptor.id)).toEqual(sparse);
    expect(h.forest.resolve("unregistered_tree")).toBeUndefined();
  });

  it("restores saved stumps before drawing and releases them only after the production respawn tick", () => {
    const savedStore = new Store(104, 0);
    const descriptor = tree("forest_saved_stump", [200, 0, 0]);
    descriptor.resourceId = "tree_cinderpine";
    descriptor.regionId = "kilnhalt";
    descriptor.assetId = "tree_twisted_2";
    savedStore.get().world.nodes[descriptor.id] = {
      state: "depleted", remaining: 0, maxYields: 11, respawnAtMs: 52_000,
    };
    savedStore.get().meta.playSeconds = 51;
    const loadedStore = new Store();
    loadedStore.replace(JSON.parse(JSON.stringify(savedStore.get())));
    const h = harness(loadedStore);
    h.onActivate.mockImplementation((row: ForestTreeDescriptor) => {
      expect(h.entities.get(row.id)?.state).toBe("depleted");
    });
    h.forest.register(descriptor);
    expect(h.onActivate).toHaveBeenCalledOnce();
    expect(h.forest.stats()).toEqual({ registered: 1, resident: 1, depleted: 1 });
    h.forest.update([0, 0, 0], noPins);
    expect(h.forest.update([0, 0, 0], noPins)).toBe(false);
    expect(h.entities.get(descriptor.id)?.resource?.remaining).toBe(0);
    const events = new EventBus();
    const clock = new SimClock();
    const rng = new RngStreams(104);
    const activity = new ActivitySystem(loadedStore, events);
    const inventory = new InventorySystem({ store: loadedStore, events, now: () => 0 });
    const dispatcher = new InteractionDispatcher({
      get: (id) => h.entities.get(id), playerPosition: () => [0, 0, 0], skillLevels: h.skillLevels,
    });
    const gathering = new GatheringSystem({
      store: loadedStore, events, clock, rng, activity, inventory, dispatcher,
      entities: { get: (id) => h.entities.get(id) ?? h.forest.resolve(id) },
    });
    gathering.tick(0, 0);
    expect(h.entities.get(descriptor.id)?.state).toBe("depleted");
    loadedStore.get().meta.playSeconds = 52;
    gathering.tick(0, 0);
    const definition = resourceDef(descriptor.resourceId);
    const [min, max] = definition.yieldRange ?? yieldRange(definition.tier);
    const remaining = loadedStore.get().world.nodes[descriptor.id]!.remaining;
    expect(remaining).toBeGreaterThanOrEqual(Math.round(min * descriptor.scale));
    expect(remaining).toBeLessThanOrEqual(Math.round(max * descriptor.scale));
    expect(h.forest.update([0, 0, 0], noPins)).toBe(true);
    expect(h.onDeactivate).toHaveBeenCalledWith(descriptor);
    expect(h.entities.size).toBe(0);
    expect(h.forest.resolve(descriptor.id)?.resource).toMatchObject({
      remaining, maxYields: remaining, itemId: definition.itemId,
    });
    // A saved-node change can arrive while the tree has no resident entity. Resolve must still
    // give GatheringSystem the tier-20 yield range instead of its missing-entity tier-1 fallback.
    const node = loadedStore.get().world.nodes[descriptor.id]!;
    Object.assign(node, { remaining: 0, state: "depleted", respawnAtMs: 54_000 });
    loadedStore.get().meta.playSeconds = 54;
    const expectedRng = new RngStreams(104);
    expectedRng.get("gather").int(min, max);
    const expectedSecondRoll = Math.round(expectedRng.get("gather").int(min, max) * descriptor.scale);
    gathering.tick(0, 0);
    expect(node.remaining).toBe(expectedSecondRoll);
    expect(node.state).toBe("available");
    expect(h.entities.size).toBe(0);
  });

  it("re-suppresses reloaded meshes without duplicating semantics and resets only its own entities", () => {
    const h = harness();
    const descriptor = tree("forest_stable");
    h.forest.register(descriptor);
    h.forest.update([0, 0, 0], noPins);
    const initialYields = h.entities.get(descriptor.id)?.resource?.remaining;
    h.forest.register({ ...descriptor });
    expect(h.onActivate).toHaveBeenCalledTimes(2);
    expect(h.forest.stats()).toEqual({ registered: 1, resident: 1, depleted: 0 });
    expect(h.forest.update([0, 0, 0], noPins)).toBe(false);
    h.entities.add({
      id: "landmark", name: "Marker", archetype: "landmark", tier: 0,
      position: [0, 0, 0], regionId: "vellenwood", interactions: ["inspect"], state: "known",
    });
    h.forest.reset();
    expect(h.entities.all().map((entity) => entity.id)).toEqual(["landmark"]);
    expect(h.forest.stats()).toEqual({ registered: 0, resident: 0, depleted: 0 });
    h.forest.register(descriptor);
    h.forest.update([0, 0, 0], noPins);
    expect(h.entities.get(descriptor.id)?.resource?.remaining).toBe(initialYields);
  });

  it("scales fresh wood yields with tree size, chooses the actual species stump, and iterates only residents", () => {
    const small = harness();
    const large = harness();
    const smallTree = { ...tree("same_seed"), scale: 0.2, assetId: "corealm_pine_3" };
    const largeTree = { ...tree("same_seed"), scale: 3, assetId: "corealm_oak_1" };
    small.forest.register(smallTree);
    large.forest.register(largeTree);
    const smallEntity = small.forest.resolve(smallTree.id)!;
    const largeEntity = large.forest.resolve(largeTree.id)!;
    expect(smallEntity.meta?.forestYieldFactor).toBe(0.65);
    expect(largeEntity.meta?.forestYieldFactor).toBe(1.5);
    expect(smallEntity.resource!.remaining).toBeLessThan(largeEntity.resource!.remaining);
    expect(smallEntity.view?.depletedAssetId).toBe("corealm_stump_pine");
    expect(largeEntity.view?.depletedAssetId).toBe("corealm_stump_oak");
    large.forest.register(tree("remote", [100, 0, 0]));
    large.forest.update([0, 0, 0], noPins);
    const seen: string[] = [];
    large.forest.forEachResident((entity, descriptor) => {
      expect(descriptor).toBe(largeTree);
      seen.push(entity.id);
    });
    expect(seen).toEqual([largeTree.id]);
  });

  it("keeps frame work local with twenty thousand distant descriptors", () => {
    const h = harness();
    h.forest.register(tree("forest_local"));
    for (let i = 0; i < 20_000; i += 1) {
      h.forest.register(tree(`forest_remote_${i}`, [1000 + (i % 200) * 12, 0, 1000 + Math.floor(i / 200) * 12]));
    }
    h.getNodeState.mockClear();
    h.forest.update([0, 0, 0], noPins);
    for (let frame = 0; frame < 10; frame += 1) h.forest.update([1, 0, 0], noPins);
    expect(h.forest.stats()).toEqual({ registered: 20_001, resident: 1, depleted: 0 });
    expect(h.getNodeState.mock.calls.length).toBeLessThan(15);
  });
});
