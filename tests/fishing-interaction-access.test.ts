import { describe, expect, it } from "vitest";
import { CorealmGameApi, type PendingInteractionOutcome } from "../game/src/api/gameApi.js";
import { INTERACT_RANGE, PLAYER_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { content, respawnSeconds, yieldRange } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES, resourceDef } from "../game/src/content/resources.js";
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

function fishery(anchored = true) {
  const store = new Store(7813, 0);
  store.get().player.position = [-8, 0, 0];
  setSkillLevel(store.get(), "fishing", 99);
  const events = new EventBus();
  const clock = new SimClock();
  const levels = () => Object.fromEntries(SKILL_IDS.map((id) => [id, store.get().skills[id].level])) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels: levels });
  const definition = resourceDef("fish_silt_minnow");
  const capacity = (definition.yieldRange ?? yieldRange(definition.tier))[0];
  const school: SemanticEntity = {
    id: "fishing-access:redsill:1", name: definition.name, archetype: definition.archetype,
    tier: definition.tier, regionId: "fallowmarch", position: anchored ? [20, 0.495, 0] : [8, 0, 0],
    ...(anchored ? { interactionPosition: [0, 0, 0] as Vec3 } : {}),
    state: "available", interactions: ["inspect", "fish"], requirements: { fishing: definition.reqLevel },
    resource: {
      remaining: capacity, maxYields: capacity,
      itemId: definition.itemId, respawnSeconds: definition.respawnSeconds ?? respawnSeconds(definition.tier),
    },
    meta: { resourceId: definition.id, skill: definition.skill },
  };
  entities.add(school);
  // Flat deterministic navigation isolates access rules; movement and all action systems are real.
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
  const dispatcher = new InteractionDispatcher({ get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels: levels });
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
  const positions: Vec3[] = [];
  function tick() {
    clock.commitTick();
    movement.update(store.get(), 100, clock.elapsedMs);
    activity.tick(100, clock.elapsedMs);
    events.flush();
    positions.push([...store.get().player.position] as Vec3);
  }
  return {
    api, store, entities, school, capacity, inventory, events, outcomes, positions,
    walk() {
      for (let i = 0; i < 160 && store.get().player.movement.mode !== "idle"; i += 1) tick();
    },
    catchOne() {
      const before = inventory.countItem(definition.itemId);
      for (let i = 0; i < 180 && inventory.countItem(definition.itemId) === before; i += 1) tick();
      return inventory.countItem(definition.itemId) - before;
    },
  };
}

describe("fishing bank access", () => {
  it("approaches the dry bank, resumes through the dispatcher, and catches an offshore fish", () => {
    const h = fishery();
    const visiblePosition = [...h.school.position];
    expect(h.api.interact(h.school.id, "fish")).toMatchObject({ ok: true });
    expect(h.api.hasPending()).toBe(true);
    expect(h.store.get().activity).toBeNull();
    h.walk();

    expect(h.outcomes).toMatchObject([{ entityId: h.school.id, interaction: "fish", result: { ok: true } }]);
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.school.id, skill: "fishing" });
    expect(distanceXZ(h.store.get().player.position, h.school.interactionPosition!)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(distanceXZ(h.store.get().player.position, h.school.position)).toBeGreaterThan(20);
    expect(h.catchOne()).toBe(1);
    expect(h.store.get().world.nodes[h.school.id]?.remaining).toBe(h.capacity - 1);
    expect(h.school.resource?.remaining).toBe(h.capacity - 1);
    expect(h.school.position).toEqual(visiblePosition);
    expect(h.positions.every(([x, y]) => x <= 0 && y === 0)).toBe(true);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
  });

  it.each([1, 8])("refuses a queued catch when the bank moves to x=%s, even if the visible school is nearby", (bankX) => {
    const h = fishery();
    h.api.interact(h.school.id, "fish");
    expect(h.api.hasPending()).toBe(true);
    // The old bank route still completes. One case reaches the dispatcher; the other exceeds the pending guard.
    h.school.interactionPosition = [bankX, 0, 0];
    h.school.position = [-1.9, 0.495, 0];
    h.walk();

    expect(distanceXZ(h.store.get().player.position, h.school.position)).toBeLessThan(INTERACT_RANGE);
    expect(h.outcomes).toMatchObject([{ result: { ok: false, error: { code: "OUT_OF_RANGE" } } }]);
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().activity).toBeNull();
    expect(h.inventory.countItem("silt_minnow")).toBe(0);
    expect(h.school.resource?.remaining).toBe(h.capacity);
  });

  it("plans and moves to the working bank without starting a catch", () => {
    const h = fishery();
    const plan = h.api.planPath({ entityId: h.school.id });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.points.at(-1)).toEqual(h.school.interactionPosition);
    expect(plan.value.pathLength).toBe(8);
    expect(h.api.moveTo({ entityId: h.school.id })).toMatchObject({ ok: true });
    h.walk();
    expect(distanceXZ(h.store.get().player.position, h.school.interactionPosition!)).toBeLessThan(0.35);
    expect(h.positions.every(([x]) => x <= 0)).toBe(true);
    expect(h.store.get().activity).toBeNull();
    expect(h.outcomes).toHaveLength(0);
  });

  it("finds an offshore school within bank interaction radius and keeps its visible position distinct", () => {
    const h = fishery();
    expect(h.api.observe({ radius: INTERACT_RANGE, interaction: "fish" })).toHaveLength(0);
    h.api.moveTo({ entityId: h.school.id });
    h.walk();
    h.entities.registerLocations([{
      id: "fishing-access:bank", name: "Redsill bank", regionId: h.school.regionId,
      entityId: h.school.id, position: h.school.position,
    }]);
    // Moving the rendered school must leave its dry-bank access in the spatial index.
    h.entities.setPosition(h.school.id, [35, 0.495, 0]);
    const nearby = h.api.observe({ radius: INTERACT_RANGE, interaction: "fish" });
    expect(nearby).toHaveLength(1);
    expect(nearby[0]).toMatchObject({ id: h.school.id, position: [35, 0.495, 0], interactionPosition: [0, 0, 0] });
    expect(nearby[0]!.distance).toBeLessThan(INTERACT_RANGE);
    expect(h.entities.nearest(h.store.get().player.position, INTERACT_RANGE, (entity) => entity.interactions.includes("fish"))?.id).toBe(h.school.id);
    expect(h.api.observe({ scope: "known", interaction: "fish" })[0]?.distance).toBe(nearby[0]!.distance);
    expect(h.api.interact(nearby[0]!.id, "fish")).toMatchObject({ ok: true });
    expect(h.api.hasPending()).toBe(false);
    expect(h.catchOne()).toBe(1);
  });

  it("keeps ordinary resource approach and gathering at the entity position when no bank anchor exists", () => {
    const h = fishery(false);
    h.api.interact(h.school.id, "fish");
    h.walk();
    expect(h.school.interactionPosition).toBeUndefined();
    expect(h.store.get().player.position[0]).toBeGreaterThan(5);
    expect(distanceXZ(h.store.get().player.position, h.school.position)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(h.outcomes).toMatchObject([{ result: { ok: true } }]);
    expect(h.catchOne()).toBe(1);
    expect(h.school.resource?.remaining).toBe(h.capacity - 1);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
  });
});
