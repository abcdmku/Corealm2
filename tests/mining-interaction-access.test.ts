import { describe, expect, it } from "vitest";
import { CorealmGameApi, type PendingInteractionOutcome } from "../game/src/api/gameApi.js";
import { INTERACT_RANGE, PLAYER_SPEED, SPELL_RANGE } from "../game/src/app/config.js";
import { miningAccessPositions } from "../game/src/app/miningAccess.js";
import { SKILL_IDS, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { content, respawnSeconds, yieldRange } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, resourceDef } from "../game/src/content/resources.js";
import { WORLD_SITES, type WorldSite } from "../game/src/content/worldSites.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ, pathLength } from "../game/src/core/math.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { Store, setSkillLevel } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { GatheringSystem } from "../game/src/systems/gathering.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

content.register({ items: ALL_ITEMS, resources: RESOURCES });

function resourceAccess(resourceId = "ore_grithe", anchored = true) {
  const source = WORLD_SITES.find((site) => site.id === "bracken_workings")!;
  const slot = { ...source.resourceSlots[0]!, x: 0, z: 0, yaw: 0 };
  const site: WorldSite = { ...source, centre: [0, 0], rotationY: 0, resourceSlots: [slot] };
  const id = `${slot.clusterId}_${slot.index}`;
  const stance = miningAccessPositions([site], () => 0, {
    assetSize: () => ({ x: 2.6, y: 1.6, z: 0.65 }),
    assetCenterXZ: () => ({ x: 0, z: 0 }),
  }).get(id)!;
  const definition = resourceDef(resourceId);
  const verb = definition.skill === "mining" ? "mine" : definition.skill === "fishing" ? "fish" : "chop";
  const capacity = (definition.yieldRange ?? yieldRange(definition.tier))[0];
  const store = new Store(7813, 0);
  store.get().player.position = [stance[0], stance[1], stance[2] + 1];
  setSkillLevel(store.get(), definition.skill, 99);
  const events = new EventBus();
  const clock = new SimClock();
  const levels = () => Object.fromEntries(SKILL_IDS.map((skill) => [skill, store.get().skills[skill].level])) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels: levels });
  const node: SemanticEntity = {
    id, name: definition.name, archetype: definition.archetype, tier: definition.tier,
    regionId: site.regionId, position: [0, 0, 0],
    ...(anchored ? { interactionPosition: stance } : {}),
    state: "available", interactions: ["inspect", verb], requirements: { [definition.skill]: definition.reqLevel },
    resource: {
      remaining: capacity, maxYields: capacity, itemId: definition.itemId,
      respawnSeconds: definition.respawnSeconds ?? respawnSeconds(definition.tier),
    },
    meta: { resourceId: definition.id, skill: definition.skill },
  };
  entities.add(node);
  // Only navigation is mocked. API queuing, movement, dispatch, and gathering use production code.
  const nav = {
    isReady: () => true,
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed: (from: Vec3, to: Vec3) => ({ path: [from, to], partial: false, arrivalGap: 0 }),
    etaMs: (path: Vec3[]) => pathLength(path) / PLAYER_SPEED * 1000,
    planRouteVia: () => null,
  } as unknown as Navigation;
  const movement = new Movement(nav, events);
  const activity = new ActivitySystem(store, events);
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const dispatcher = new InteractionDispatcher({
    get: (entityId) => entities.get(entityId), playerPosition: () => store.get().player.position, skillLevels: levels,
  });
  new GatheringSystem({ store, events, clock, rng: new RngStreams(7813), activity, inventory, dispatcher, entities });
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  api.register("entities", entities);
  api.register("interactions", dispatcher);
  const outcomes: PendingInteractionOutcome[] = [];
  api.subscribePendingResult((outcome) => outcomes.push(outcome));
  events.subscribe((event) => {
    if (event.type === "navigation.completed") api.resumePending();
    if (event.type === "navigation.failed") api.clearPending();
  });
  function tick() {
    clock.commitTick();
    movement.update(store.get(), 100, clock.elapsedMs);
    activity.tick(100, clock.elapsedMs);
    events.flush();
  }
  return {
    api, store, entities, node, stance, capacity, inventory, events, dispatcher, outcomes,
    walk() {
      for (let index = 0; index < 160 && store.get().player.movement.mode !== "idle"; index += 1) tick();
    },
    gatherOne() {
      const before = inventory.countItem(definition.itemId);
      for (let index = 0; index < 180 && inventory.countItem(definition.itemId) === before; index += 1) tick();
      return inventory.countItem(definition.itemId) - before;
    },
  };
}

describe("mining working-position access", () => {
  it("refuses a swing one metre from the stance, then walks to it and mines without moving the ore", () => {
    const h = resourceAccess();
    const sourcePosition = [...h.node.position];
    expect(distanceXZ(h.store.get().player.position, h.stance)).toBeCloseTo(1);
    expect(h.dispatcher.rangeFor("mine", h.node.id)).toBe(0.45);
    expect(h.dispatcher.run(h.node.id, "mine")).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    expect(h.store.get().activity).toBeNull();

    expect(h.api.interact(h.node.id, "mine")).toMatchObject({ ok: true });
    expect(h.api.hasPending()).toBe(true);
    expect(h.store.get().activity).toBeNull();
    h.walk();

    expect(distanceXZ(h.store.get().player.position, h.stance)).toBeLessThan(0.25);
    expect(h.outcomes).toMatchObject([{ entityId: h.node.id, interaction: "mine", result: { ok: true } }]);
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().activity).toMatchObject({ kind: "gathering", skill: "mining", entityId: h.node.id });
    expect(h.gatherOne()).toBe(1);
    expect(h.store.get().world.nodes[h.node.id]?.remaining).toBe(h.capacity - 1);
    expect(h.node.resource?.remaining).toBe(h.capacity - 1);
    expect(h.node.position).toEqual(sourcePosition);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
  });

  it.each([0.6, 1])("refuses pending mining when the working position moves %s metres", (shift) => {
    const h = resourceAccess();
    const sourcePosition = [...h.node.position];
    expect(h.api.interact(h.node.id, "mine")).toMatchObject({ ok: true });
    expect(h.api.hasPending()).toBe(true);
    h.node.interactionPosition = [h.stance[0] + shift, h.stance[1], h.stance[2]];
    h.walk();

    expect(distanceXZ(h.store.get().player.position, h.node.position)).toBeLessThan(INTERACT_RANGE);
    expect(h.outcomes).toMatchObject([{ result: { ok: false, error: { code: "OUT_OF_RANGE" } } }]);
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countItem("grithe_ore")).toBe(0);
    expect(h.node.resource?.remaining).toBe(h.capacity);
    expect(h.node.position).toEqual(sourcePosition);
  });

  it.each([
    { verb: "mine", resourceId: "ore_grithe", anchored: false },
    { verb: "inspect", resourceId: "ore_grithe", anchored: true },
    { verb: "fish", resourceId: "fish_silt_minnow", anchored: true },
    { verb: "chop", resourceId: "tree_palewood", anchored: false },
  ] as const)("preserves default $verb range with anchored=$anchored", ({ verb, resourceId, anchored }) => {
    const h = resourceAccess(resourceId, anchored);
    const target = h.node.interactionPosition ?? h.node.position;
    h.store.get().player.position = [target[0] + INTERACT_RANGE, target[1], target[2]];
    expect(h.dispatcher.rangeFor(verb, h.node.id)).toBe(INTERACT_RANGE);
    expect(h.api.interact(h.node.id, verb)).toMatchObject({ ok: true });
    expect(h.api.hasPending()).toBe(false);
    if (verb === "inspect") expect(h.store.get().activity).toBeNull();
    else expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.node.id });

    h.store.get().player.position = [target[0] + INTERACT_RANGE + 0.01, target[1], target[2]];
    expect(h.dispatcher.run(h.node.id, verb)).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
  });

  it.each(["cast", "attack"] as const)("preserves ranged %s access without queuing a gathering-distance approach", (verb) => {
    const h = resourceAccess();
    const enemy: SemanticEntity = {
      id: "mining-access:enemy", name: "Range target", archetype: "enemy", tier: 1,
      regionId: "fallowmarch", position: [0, 0, 0], state: "alive", interactions: ["cast", "attack"],
    };
    h.entities.add(enemy);
    h.store.get().player.position = [SPELL_RANGE, 0, 0];
    expect(h.dispatcher.rangeFor(verb, enemy.id)).toBe(SPELL_RANGE);
    // Combat is not installed in this gathering fixture. Reaching its missing handler proves
    // API range checking did not queue a walk toward melee distance.
    expect(h.api.interact(enemy.id, verb)).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().player.movement.mode).toBe("idle");
    h.store.get().player.position = [SPELL_RANGE + 0.01, 0, 0];
    expect(h.dispatcher.run(enemy.id, verb)).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
  });
});
