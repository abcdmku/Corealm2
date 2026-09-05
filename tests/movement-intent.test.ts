import { describe, expect, it } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { PLAYER_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, ok, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ, pathLength } from "../game/src/core/math.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation, RouteLeg } from "../game/src/systems/navigation.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

function runtime() {
  const store = new Store(7302, 0);
  store.get().player.position = [0, 0, 0];
  store.get().player.regionId = "fallowmarch";
  const events = new EventBus();
  const clock = new SimClock();
  const controls = { blocked: false, reachable: true, pathQueries: 0, partialGap: 0 };
  const nav = {
    isReady: () => true,
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed(from: Vec3, to: Vec3) {
      controls.pathQueries += 1;
      const end: Vec3 = controls.partialGap > 0 ? [to[0] - controls.partialGap, to[1], to[2]] : to;
      return controls.reachable ? { path: [from, end], partial: controls.partialGap > 0, arrivalGap: controls.partialGap } : null;
    },
    etaMs: (path: Vec3[]) => pathLength(path) / PLAYER_SPEED * 1000,
    planRouteVia: () => null,
  } as unknown as Navigation;
  const movement = new Movement(nav, events, {
    solids: { resolve: (desired, from) => controls.blocked ? from : desired },
  });
  const entities: SemanticEntity[] = [
    {
      id: "first_npc", name: "First NPC", archetype: "npc", tier: 1, regionId: "fallowmarch",
      position: [8, 0, 0], state: "idle", interactions: ["talk"],
    },
    {
      id: "second_npc", name: "Second NPC", archetype: "npc", tier: 1, regionId: "fallowmarch",
      position: [8, 0, 3], state: "idle", interactions: ["talk"],
    },
  ];
  const get = (id: string) => entities.find((entity) => entity.id === id);
  const dispatcher = new InteractionDispatcher({
    get,
    playerPosition: () => store.get().player.position,
    skillLevels: () => Object.fromEntries(
      SKILL_IDS.map((id) => [id, store.get().skills[id].level]),
    ) as Record<SkillId, number>,
  });
  const talks: string[] = [];
  dispatcher.registerHandler("talk", ({ entity }) => {
    talks.push(entity.id);
    return ok({ started: `talking to ${entity.name}` });
  });
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  api.register("entities", { get, all: () => entities, observe: () => [] });
  api.register("interactions", dispatcher);
  events.subscribe((event) => {
    if (event.type === "navigation.completed") api.resumePending();
    if (event.type === "navigation.failed") api.clearPending();
  });
  const step = (ticks = 1) => {
    for (let tick = 0; tick < ticks; tick += 1) {
      clock.commitTick();
      movement.update(store.get(), 100, clock.elapsedMs);
      events.flush();
    }
  };
  return { store, events, clock, movement, controls, api, entities, talks, step };
}

function route(): RouteLeg[] {
  return [
    { kind: "walk", from: [0, 0, 0], to: [2, 0, 0], fromId: "start", toId: "entry", cost: 2 / PLAYER_SPEED },
    {
      kind: "portal", from: [2, 0, 0], to: [20, 0, 0], fromId: "entry", toId: "exit",
      cost: 0.5, durationMs: 500, portalId: "old_portal", toRegionId: "gravelmaw",
    },
    { kind: "walk", from: [20, 0, 0], to: [24, 0, 0], fromId: "exit", toId: "goal", cost: 4 / PLAYER_SPEED },
  ];
}

describe("movement intent replacement", () => {
  it("retains the final destination allowance supplied with a route", () => {
    const leg: RouteLeg = {
      kind: "walk", from: [0, 0, 0], to: [3, 0, 0], fromId: "start", toId: "goal", cost: 3 / PLAYER_SPEED,
    };
    const exact = runtime();
    exact.controls.partialGap = 1;
    expect(exact.movement.startRoute(exact.store.get(), [leg], 0, null, { arrivalAllowance: 0 })).toBe(false);
    expect(exact.store.get().player.movement.mode).toBe("idle");

    const landmark = runtime();
    landmark.controls.partialGap = 1;
    expect(landmark.movement.startRoute(landmark.store.get(), [leg], 0)).toBe(true);
    landmark.step(30);
    expect(landmark.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
  });

  it("ends a replaced route at the new ground destination without resuming its old legs", () => {
    const h = runtime();
    expect(h.movement.startRoute(h.store.get(), route(), 0)).toBe(true);
    h.step(2);
    expect(h.movement.startPath(h.store.get(), [0, 0, 3], null, h.clock.elapsedMs)).not.toBeNull();
    expect(h.movement.getRouteProgress().active).toBe(false);
    h.step(50);

    expect(distanceXZ(h.store.get().player.position, [0, 0, 3])).toBeLessThanOrEqual(0.35);
    expect(h.store.get().player.regionId).toBe("fallowmarch");
    expect(h.events.since(0, ["activity.started"]).events).toEqual([]);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("cancels an active crossing so its old deadline cannot relocate the player", () => {
    const h = runtime();
    expect(h.movement.startRoute(h.store.get(), route().slice(1), 0)).toBe(true);
    expect(h.movement.isTraversing()).toBe(true);
    expect(h.api.moveTo({ position: [0, 0, 3] }).ok).toBe(true);
    expect(h.movement.isTraversing()).toBe(false);
    h.step(50);

    expect(distanceXZ(h.store.get().player.position, [0, 0, 3])).toBeLessThanOrEqual(0.35);
    expect(h.store.get().player.regionId).toBe("fallowmarch");
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([
      expect.objectContaining({ entityId: "old_portal", data: { kind: "traversing", reason: "replaced" } }),
    ]);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("keeps route ownership through ordinary walk legs and portal completion", () => {
    const h = runtime();
    expect(h.movement.startRoute(h.store.get(), route(), 0)).toBe(true);
    h.step(80);

    expect(distanceXZ(h.store.get().player.position, [24, 0, 0])).toBeLessThanOrEqual(0.35);
    expect(h.store.get().player.regionId).toBe("gravelmaw");
    expect(h.movement.getRouteProgress().active).toBe(false);
    expect(h.events.since(0, ["navigation.completed"]).events).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: true }) }),
    ]);
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([
      expect.objectContaining({ entityId: "old_portal", data: { kind: "traversing", completed: true } }),
    ]);
  });

  it("keeps later route legs after a stuck walk replans", () => {
    const h = runtime();
    h.controls.blocked = true;
    expect(h.movement.startRoute(h.store.get(), route(), 0)).toBe(true);
    const initialQueries = h.controls.pathQueries;
    h.step(14);
    expect(h.controls.pathQueries).toBeGreaterThan(initialQueries);
    expect(h.movement.getRouteProgress().active).toBe(true);
    h.controls.blocked = false;
    h.step(80);

    expect(distanceXZ(h.store.get().player.position, [24, 0, 0])).toBeLessThanOrEqual(0.35);
    expect(h.store.get().player.regionId).toBe("gravelmaw");
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("clears a delayed talk when a ground click arrives within the old NPC's talk range", () => {
    const h = runtime();
    expect(h.api.interact("first_npc", "talk").ok).toBe(true);
    expect(h.api.hasPending()).toBe(true);
    expect(h.api.moveTo({ position: [7, 0, 0] }).ok).toBe(true);
    expect(h.api.hasPending()).toBe(false);
    h.step(50);

    expect(distanceXZ(h.store.get().player.position, [7, 0, 0])).toBeLessThanOrEqual(0.35);
    expect(h.talks).toEqual([]);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
  });

  it("preserves the newest delayed interaction across the replacement event flush", () => {
    const h = runtime();
    expect(h.api.interact("first_npc", "talk").ok).toBe(true);
    expect(h.api.interact("second_npc", "talk").ok).toBe(true);
    h.events.flush();
    expect(h.api.hasPending()).toBe(true);
    h.step(50);

    expect(h.talks).toEqual(["second_npc"]);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("cancels a route before running a new nearby interaction", () => {
    const h = runtime();
    h.entities[0]!.position = [1, 0, 0];
    h.movement.startRoute(h.store.get(), route().slice(1), 0);
    expect(h.movement.isTraversing()).toBe(true);
    const revision = h.store.revision();
    expect(h.api.interact("first_npc", "talk").ok).toBe(true);
    expect(h.store.revision()).toBeGreaterThan(revision);
    expect(h.movement.isTraversing()).toBe(false);
    expect(h.store.get().player.movement.mode).toBe("idle");
    h.step(50);

    expect(h.talks).toEqual(["first_npc"]);
    expect(h.store.get().player.position).toEqual([0, 0, 0]);
    expect(h.store.get().player.regionId).toBe("fallowmarch");
  });

  it("keeps a new delayed interaction when it interrupts an active crossing", () => {
    const h = runtime();
    h.movement.startRoute(h.store.get(), route().slice(1), 0);
    expect(h.api.interact("first_npc", "talk").ok).toBe(true);
    h.events.flush();
    expect(h.api.hasPending()).toBe(true);
    expect(h.movement.isTraversing()).toBe(false);
    h.step(50);

    expect(h.talks).toEqual(["first_npc"]);
    expect(h.store.get().player.regionId).toBe("fallowmarch");
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("stops and records cancellation when a replacement destination is unreachable", () => {
    const h = runtime();
    expect(h.api.interact("first_npc", "talk").ok).toBe(true);
    h.controls.reachable = false;
    const revision = h.store.revision();
    expect(h.api.moveTo({ position: [7, 0, 0] })).toMatchObject({ ok: false, error: { code: "NOT_REACHABLE" } });
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().player.movement.mode).toBe("idle");
    expect(h.store.revision()).toBeGreaterThan(revision);
    h.step(50);

    expect(h.store.get().player.position).toEqual([0, 0, 0]);
    expect(h.talks).toEqual([]);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(1);
  });
});
