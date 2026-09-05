import { describe, expect, it } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { INTERACT_RANGE, PLAYER_RADIUS, PLAYER_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, ok, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RESOURCES } from "../game/src/content/resources.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ, pathLength } from "../game/src/core/math.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { GatheringSystem } from "../game/src/systems/gathering.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation, RouteLeg } from "../game/src/systems/navigation.js";
import { EntityStore } from "../game/src/world/entities.js";
import { ForestObstacles } from "../game/src/world/forestObstacles.js";
import { ForestResources } from "../game/src/world/forestResources.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

content.register({ items: ALL_ITEMS, resources: RESOURCES });

function approach(options: { from?: Vec3; to?: Vec3; portal?: boolean; bend?: boolean; ranged?: boolean; anchorOffset?: number } = {}) {
  const store = new Store(7301, 0);
  store.get().player.position = options.from ?? [22, 0, 12];
  const targetPosition = options.to ?? [19.764, 0, 15.963];
  const events = new EventBus();
  const clock = new SimClock();
  const levels = () => Object.fromEntries(SKILL_IDS.map((id) => [id, store.get().skills[id].level])) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels: levels });
  const obstacles = new ForestObstacles();
  const forest = new ForestResources({
    entities, getNodeState: (id) => store.get().world.nodes[id], onActivate: (tree) => obstacles.upsert(tree),
  });
  forest.register({
    id: "feature-lab:forest:oak:4", resourceId: "tree_palewood", regionId: "fallowmarch",
    position: targetPosition, assetId: "corealm_oak_2", scale: 0.9, rotationY: 0.8, trunkRadius: 0.44 * 0.9,
  });
  forest.update(store.get().player.position, new Set(["feature-lab:forest:oak:4"]));
  let target = entities.get("feature-lab:forest:oak:4")!;
  if (options.ranged) {
    target = {
      id: "ranged_target", name: "Target", archetype: "enemy", tier: 1, regionId: "fallowmarch",
      position: targetPosition, state: "alive", interactions: ["cast"],
    } satisfies SemanticEntity;
    entities.add(target);
  }
  const legs: RouteLeg[] = [
    { kind: "walk", from: [-10, 0, 0], to: [-5, 0, 0], fromId: "start", toId: "entrance", cost: 5 / PLAYER_SPEED },
    { kind: "portal", from: [-5, 0, 0], to: [10, 0, 0], fromId: "entrance", toId: "exit", cost: 0.5, durationMs: 500, portalId: "portal" },
    { kind: "walk", from: [10, 0, 0], to: [targetPosition[0] - (options.anchorOffset ?? 0), targetPosition[1], targetPosition[2]], fromId: "exit", toId: target.id, cost: 10 / PLAYER_SPEED },
  ];
  const nav = {
    isReady: () => true,
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed(from: Vec3, to: Vec3) {
      if (options.portal && from[0] < 0 && to[0] >= 0) return null;
      const path = options.bend && distanceXZ(to, targetPosition) < 0.001
        ? [from, [5, 0, 0] as Vec3, [9, 0, 0.5] as Vec3, [9.5, 0, 0.5] as Vec3, to] : [from, to];
      return { path, partial: false, arrivalGap: 0 };
    },
    etaMs: (path: Vec3[]) => pathLength(path) / PLAYER_SPEED * 1000,
    planRouteVia: () => options.portal ? { legs, cost: legs.reduce((sum, leg) => sum + leg.cost, 0), path: [], edges: [] } : null,
  } as unknown as Navigation;
  const movement = new Movement(nav, events, { dynamicObstacles: obstacles });
  const activity = new ActivitySystem(store, events);
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const dispatcher = new InteractionDispatcher({ get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels: levels });
  new GatheringSystem({ store, events, clock, rng: new RngStreams(7301), activity, inventory, dispatcher, entities });
  let casts = 0;
  dispatcher.setRange("cast", 15);
  dispatcher.registerHandler("cast", () => { casts += 1; return ok({ started: "cast" }); });
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  api.register("entities", entities);
  api.register("interactions", dispatcher);
  const portalEntries: Vec3[] = [];
  const approachDestinations: Vec3[] = [];
  events.subscribe((event) => {
    if (event.type === "navigation.completed") api.resumePending();
    if (event.type === "navigation.failed") api.clearPending();
    if (event.type === "activity.started" && event.data.via === "portal") portalEntries.push(store.get().player.position);
  });
  return {
    api, store, target, movement, events, portalEntries, approachDestinations, casts: () => casts,
    walk() {
      for (let tick = 0; tick < 160 && store.get().player.movement.mode !== "idle"; tick += 1) {
        clock.commitTick();
        movement.update(store.get(), 100, clock.elapsedMs);
        if (movement.getRouteProgress().legIndex === 2 && store.get().player.movement.destination) {
          approachDestinations.push(store.get().player.movement.destination!);
        }
        events.flush();
      }
    },
  };
}

describe("click-to-interact approach", () => {
  it("walks to the real forest lab tree and begins chopping outside its solid trunk", () => {
    const h = approach();
    expect(h.api.interact(h.target.id, "chop")).toMatchObject({ ok: true });
    expect(h.store.get().activity).toBeNull();
    expect(h.store.get().player.movement.destinationEntityId).toBe(h.target.id);
    h.walk();
    const gap = distanceXZ(h.store.get().player.position, h.target.position);
    expect(gap).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(gap).toBeGreaterThan(0.396 + PLAYER_RADIUS);
    expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.target.id, skill: "woodcutting" });
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
  });

  it("finds the stand radius on a bent path with several final corners inside interaction range", () => {
    const h = approach({ from: [0, 0, 0], to: [10, 0, 0], bend: true });
    h.api.interact(h.target.id, "chop");
    h.walk();
    expect(distanceXZ(h.store.get().player.position, h.target.position)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.target.id });
  });

  it("preserves portal entry arrival and trims only the final route leg before chopping", () => {
    const h = approach({ from: [-10, 0, 0], to: [20, 0, 0], portal: true });
    expect(h.api.interact(h.target.id, "chop")).toMatchObject({ ok: true });
    expect(h.movement.getRouteProgress().active).toBe(true);
    h.walk();
    expect(h.portalEntries).toHaveLength(1);
    expect(distanceXZ(h.portalEntries[0]!, [-5, 0, 0])).toBeLessThan(0.35);
    expect(distanceXZ(h.store.get().player.position, h.target.position)).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.target.id });
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
  });

  it("keeps the existing ranged approach slack", () => {
    const h = approach({ from: [0, 0, 0], to: [24, 0, 0], ranged: true });
    h.api.interact(h.target.id, "cast");
    expect(distanceXZ(h.store.get().player.movement.destination!, h.target.position)).toBeCloseTo(13.5);
    h.walk();
    expect(h.casts()).toBe(1);
    expect(distanceXZ(h.store.get().player.position, h.target.position)).toBeGreaterThan(13);
  });

  it("centres the final approach on the tree when its short route-anchor tail was omitted", () => {
    for (const anchorOffset of [0.49, 0.1]) {
      const h = approach({ from: [-10, 0, 0], to: [20, 0, 0], portal: true, anchorOffset });
      h.api.interact(h.target.id, "chop");
      h.walk();
      expect(h.approachDestinations.length).toBeGreaterThan(0);
      expect(distanceXZ(h.approachDestinations[0]!, h.target.position)).toBeCloseTo(INTERACT_RANGE - 0.5);
      expect(distanceXZ(h.store.get().player.position, h.target.position)).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(h.store.get().activity).toMatchObject({ kind: "gathering", entityId: h.target.id });
      expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
      expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(0);
    }
  });

  it("keeps raw entity movement aimed at the centre and reports its blocked endpoint", () => {
    const h = approach();
    h.api.moveTo({ entityId: h.target.id });
    expect(h.store.get().player.movement.destination).toEqual(h.target.position);
    h.walk();
    expect(h.store.get().activity).toBeNull();
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(0);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(1);
  });
});
