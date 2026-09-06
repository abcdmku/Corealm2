import { describe, expect, it, vi } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { INTERACT_RANGE, PLAYER_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, ok, type MoveTarget, type Result, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ, pathLength } from "../game/src/core/math.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { AgilitySystem } from "../game/src/systems/agility.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation, RouteLeg, RoutePlan } from "../game/src/systems/navigation.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const START: Vec3 = [0, 0, 0];
const ENTRY: Vec3 = [4.2, 0, 0];
const EXIT: Vec3 = [37.8, 0, 0];
const GOAL: Vec3 = [42, 0, 0];
type DetailedPath = ReturnType<Navigation["findPathDetailed"]>;

function value<T>(result: Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function runtime(level = 8) {
  const store = new Store(7302, 0);
  store.get().player.position = [...START];
  store.get().player.regionId = "fallowmarch";
  store.get().skills.agility.level = level;
  const events = new EventBus();
  const clock = new SimClock();
  const obstacle: SemanticEntity = {
    id: "test_shortcut", name: "Test shortcut", archetype: "obstacle", tier: 1,
    regionId: "fallowmarch", position: ENTRY, state: "idle", interactions: ["climb"],
    obstacle: { reqLevel: 8, exitPosition: EXIT, durationMs: 1000, savesMeters: 33.6 },
  };
  const targetEntity: SemanticEntity = {
    id: "test_target", name: "Test target", archetype: "npc", tier: 1,
    regionId: "fallowmarch", position: [50, 0, 0], interactionPosition: GOAL,
    state: "idle", interactions: ["talk"],
  };
  const entities = [obstacle, targetEntity];
  const controls = {
    graphEnabled: true,
    graphReqLevel: 8,
    authoredCost: 3,
    authoredWalkCost: 1,
    authoredDurationMs: 1000,
    traversalKind: "shortcut" as "shortcut" | "portal",
    reverse: false,
    startsWithShortcut: false,
    graphEntry: undefined as Vec3 | undefined,
    graphExit: undefined as Vec3 | undefined,
    pathOverride: undefined as ((from: Vec3, to: Vec3) => DetailedPath | undefined) | undefined,
  };
  const pathQueries: { from: Vec3; to: Vec3 }[] = [];
  const routeQueries: { from: Vec3; target: Parameters<Navigation["planRouteVia"]>[1]; level: number }[] = [];
  const nav = {
    isReady: () => true,
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed(from: Vec3, to: Vec3): DetailedPath {
      pathQueries.push({ from: [...from], to: [...to] });
      const overridden = controls.pathOverride?.(from, to);
      if (overridden !== undefined) return overridden;
      return { path: [[...from], [...to]], partial: false, arrivalGap: 0 };
    },
    etaMs: (points: Vec3[]) => pathLength(points) / PLAYER_SPEED * 1000,
    routeNode: (id: string) => id === "test_location"
      ? { id, name: "Test location", position: GOAL, regionId: "fallowmarch" }
      : undefined,
    planRouteVia(from: Vec3, target: Parameters<Navigation["planRouteVia"]>[1], agility: number): RoutePlan | null {
      routeQueries.push({ from: [...from], target, level: agility });
      if (!controls.graphEnabled || agility < controls.graphReqLevel) return null;
      const to = "locationId" in target ? GOAL : target.position;
      const toId = "locationId" in target ? target.locationId : target.id ?? "destination";
      const entry = controls.graphEntry ?? (controls.reverse ? EXIT : ENTRY);
      const exit = controls.graphExit ?? (controls.reverse ? ENTRY : EXIT);
      const crossing: RouteLeg = {
        kind: controls.traversalKind, from: entry, to: exit, fromId: "entry", toId: "exit",
        cost: controls.authoredDurationMs / 1000, durationMs: controls.authoredDurationMs,
        ...(controls.traversalKind === "shortcut"
          ? { obstacleId: obstacle.id, reqLevel: controls.graphReqLevel }
          : { portalId: "test_portal", toRegionId: "gravelmaw" }),
      };
      const legs: RouteLeg[] = [
        { kind: "walk", from, to: entry, fromId: "start", toId: "entry", cost: controls.authoredWalkCost },
        crossing,
        { kind: "walk", from: exit, to, fromId: "exit", toId, cost: controls.authoredWalkCost },
      ];
      if (controls.startsWithShortcut) legs.shift();
      return {
        path: ["start", "entry", "exit", toId], cost: controls.authoredCost, edges: [],
        legs,
      };
    },
  } as unknown as Navigation;
  const get = (id: string) => entities.find((entity) => entity.id === id);
  const dispatcher = new InteractionDispatcher({
    get,
    playerPosition: () => store.get().player.position,
    skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, store.get().skills[id].level])) as Record<SkillId, number>,
  });
  const activity = new ActivitySystem(store, events);
  const rng = new RngStreams(7302);
  // Route choice has no random input. Successful traversal keeps the execution checks deterministic.
  vi.spyOn(rng.get("misc"), "chance").mockReturnValue(true);
  const agility = new AgilitySystem({ store, events, clock, rng, entities: { get }, activity, dispatcher, nav });
  const movement = new Movement(nav, events);
  movement.setPorts({ shortcuts: {
    begin: (obstacleId, entry, exit) => agility.beginRoute(obstacleId, entry, exit),
    cancel: (atMs, reason) => agility.cancelTraversal(atMs, reason),
  } });
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  const talks: string[] = [];
  api.register("entities", {
    get,
    all: () => entities,
    observe: () => [],
  });
  dispatcher.registerHandler("talk", ({ entity, distance }) => {
    expect(distance).toBeLessThanOrEqual(INTERACT_RANGE);
    talks.push(entity.id);
    return ok({ started: "talking" });
  });
  api.register("interactions", dispatcher);
  events.subscribe((event) => {
    if (event.type === "navigation.completed") api.resumePending();
    if (event.type === "navigation.failed") api.clearPending();
  });
  const step = (ticks: number) => {
    for (let tick = 0; tick < ticks; tick += 1) {
      clock.commitTick();
      movement.update(store.get(), 100, clock.elapsedMs);
      activity.tick(100, clock.elapsedMs);
      events.flush();
    }
  };
  return { store, events, clock, movement, api, nav, controls, obstacle, targetEntity, entities, pathQueries, routeQueries, talks, step };
}

function expectDirect(h: ReturnType<typeof runtime>, target: MoveTarget = { position: GOAL }) {
  const preview = value(h.api.planPath(target));
  expect(preview.legs).toEqual([]);
  expect(preview.pathLength).toBeCloseTo(42, 6);
  expect(preview.etaMs).toBe(Math.round(42 / PLAYER_SPEED * 1000));
  const started = value(h.api.moveTo(target));
  expect(started.pathLength).toBeCloseTo(preview.pathLength, 6);
  expect(started.etaMs).toBeCloseTo(42 / PLAYER_SPEED * 1000, 6);
  expect(h.movement.getRouteProgress().active).toBe(false);
  expect(h.store.get().player.movement.destination).toEqual(GOAL);
  h.events.flush();
  expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
  expect(h.events.since(0, ["navigation.failed", "activity.started", "activity.stopped"]).events).toEqual([]);
}

describe("API route cost selection", () => {
  it("uses the faster shortcut at Agility 8 even when the direct walk succeeds", () => {
    const h = runtime();
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "shortcut", "walk"]);
    expect(preview.pathLength).toBeCloseTo(8.4, 6);
    expect(preview.etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(preview.points.at(-1)).toEqual(GOAL);
    const started = value(h.api.moveTo({ position: GOAL }));
    expect(started.pathLength).toBeCloseTo(preview.pathLength, 6);
    expect(started.etaMs).toBeCloseTo(preview.etaMs, 6);
    expect(h.movement.getRouteProgress().active).toBe(true);
    expect(h.store.get().player.movement.destination).toEqual(ENTRY);
    h.events.flush();
    expect(h.events.since(0, ["navigation.started"]).events).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ route: true, etaMs: Math.round(1000 + 8.4 / PLAYER_SPEED * 1000) }) }),
    ]);
    h.step(60);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("keeps the direct walk below the shortcut's level requirement", () => {
    const h = runtime(7);
    expectDirect(h);
    expect(h.routeQueries).toHaveLength(2);
    expect(h.routeQueries.every((query) => query.level === 7)).toBe(true);
  });

  it("executes a cheaper shortcut in reverse and resumes walking from the original entrance", () => {
    const h = runtime();
    h.controls.reverse = true;
    h.store.get().player.position = [...GOAL];
    const preview = value(h.api.planPath({ position: START }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "shortcut", "walk"]);
    expect(preview.etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(preview.pathLength).toBeCloseTo(8.4, 6);
    expect(preview.points.at(-1)).toEqual(START);
    expect(value(h.api.moveTo({ position: START })).etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(h.store.get().player.movement.destination).toEqual(EXIT);
    h.step(15);
    expect(h.store.get().activity).toMatchObject({ kind: "traversing", exitPosition: ENTRY });
    h.step(45);
    expect(distanceXZ(h.store.get().player.position, START)).toBeLessThanOrEqual(0.35);
    expect(h.store.get().world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("executes a partial approach with room for movement's arrival tolerance", () => {
    const h = runtime();
    const arrivalGap = 1.9;
    h.controls.pathOverride = (from, to) => distanceXZ(to, ENTRY) < 0.001
      ? { path: [from, [ENTRY[0] - arrivalGap, 0, 0]], partial: true, arrivalGap }
      : undefined;
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.some((leg) => leg.kind === "shortcut")).toBe(true);
    expect(preview.pathLength).toBeCloseTo(6.5, 6);
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(preview.etaMs);
    h.step(60);
    expect(h.store.get().world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it.each([2.3, 3])("keeps direct when a %s m partial approach leaves too little shortcut interaction reach", (arrivalGap) => {
    const h = runtime();
    h.controls.pathOverride = (from, to) => distanceXZ(to, ENTRY) < 0.001
      ? { path: [from, [ENTRY[0] - arrivalGap, 0, 0]], partial: true, arrivalGap }
      : undefined;
    expectDirect(h);
  });

  it("allows a shortcut first leg when the player's actual position is 2.3 m from its entrance", () => {
    const h = runtime();
    h.controls.startsWithShortcut = true;
    h.store.get().player.position = [ENTRY[0] - 2.3, 0, 0];
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["shortcut", "walk"]);
    expect(preview.etaMs).toBe(Math.round(1000 + 4.2 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(1000 + 4.2 / PLAYER_SPEED * 1000));
    expect(h.store.get().activity).toMatchObject({ kind: "traversing", obstacleId: h.obstacle.id });
    h.step(60);
    expect(h.store.get().world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("keeps direct on a tie after restoring a graph's omitted 0.4 m destination tail", () => {
    const h = runtime();
    const from: Vec3 = [-10, 0, 0];
    const anchor: Vec3 = [0, 0, 0];
    const destination: Vec3 = [0.4, 0, 0];
    h.store.get().player.position = from;
    vi.spyOn(h.nav, "planRouteVia").mockReturnValue({
      path: ["start", "anchor"], cost: 10 / PLAYER_SPEED, edges: [],
      legs: [{ kind: "walk", from, to: anchor, fromId: "start", toId: "anchor", cost: 10 / PLAYER_SPEED }],
    });
    const preview = value(h.api.planPath({ position: destination }));
    expect(preview.legs).toEqual([]);
    expect(preview.pathLength).toBeCloseTo(10.4, 6);
    expect(preview.points.at(-1)).toEqual(destination);
    const started = value(h.api.moveTo({ position: destination }));
    expect(started.pathLength).toBeCloseTo(preview.pathLength, 6);
    expect(started.etaMs).toBeCloseTo(preview.etaMs, 0);
    expect(h.movement.getRouteProgress().active).toBe(false);
    expect(h.store.get().player.movement.destination).toEqual(destination);
    h.events.flush();
    expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("walks an omitted 0.4 m destination tail after a shortcut", () => {
    const h = runtime();
    const destination: Vec3 = [EXIT[0] + 0.4, 0, 0];
    vi.spyOn(h.nav, "planRouteVia").mockReturnValue({
      path: ["start", "entry", "exit"], cost: 2, edges: [],
      legs: [
        { kind: "walk", from: START, to: ENTRY, fromId: "start", toId: "entry", cost: 1 },
        {
          kind: "shortcut", from: ENTRY, to: EXIT, fromId: "entry", toId: "exit", cost: 1,
          obstacleId: h.obstacle.id, reqLevel: 8, durationMs: 1000,
        },
      ],
    });
    const preview = value(h.api.planPath({ position: destination }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "shortcut", "walk"]);
    expect(preview.points.at(-1)).toEqual(destination);
    expect(preview.pathLength).toBeCloseTo(4.6, 6);
    expect(preview.etaMs).toBe(Math.round(1000 + 4.6 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: destination }))).toMatchObject({
      pathLength: preview.pathLength, etaMs: preview.etaMs,
    });
    h.step(60);
    expect(h.store.get().world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(h.store.get().player.position[0]).toBeGreaterThan(EXIT[0]);
    expect(distanceXZ(h.store.get().player.position, destination)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it.each(["entrance", "exit"])("keeps direct when the graph's shortcut %s differs from the live obstacle", (endpoint) => {
    const h = runtime();
    if (endpoint === "entrance") h.controls.graphEntry = [ENTRY[0], ENTRY[1] + 1, ENTRY[2]];
    if (endpoint === "exit") h.controls.graphExit = [EXIT[0], EXIT[1] + 1, EXIT[2]];
    expectDirect(h);
  });

  it.each([33.6 / PLAYER_SPEED * 1000, 33.6 / PLAYER_SPEED * 1000 + 1000])("keeps direct when the shortcut duration is %s ms, tying or exceeding its total", (duration) => {
    const h = runtime();
    h.obstacle.obstacle!.durationMs = duration;
    expectDirect(h);
  });

  it("prices actual walk paths when authored graph costs overstate a fast shortcut", () => {
    const h = runtime();
    h.controls.authoredCost = 200;
    h.controls.authoredWalkCost = 80;
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.some((leg) => leg.kind === "shortcut")).toBe(true);
    expect(preview.pathLength).toBeCloseTo(8.4, 6);
    expect(preview.etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
  });

  it("rejects an apparently cheap graph route when its actual approach is a long detour", () => {
    const h = runtime();
    h.controls.authoredCost = 0.1;
    h.controls.authoredWalkCost = 0.01;
    h.controls.pathOverride = (from, to) => to === ENTRY || distanceXZ(to, ENTRY) < 0.001
      ? { path: [from, [0, 0, 30], [4.2, 0, 30], to], partial: false, arrivalGap: 0 }
      : undefined;
    expectDirect(h);
  });

  it("uses the live obstacle duration for preview, route events, and traversal", () => {
    const h = runtime();
    h.controls.authoredDurationMs = 9000;
    h.controls.authoredCost = 11;
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    h.step(30);
    expect(h.events.since(0, ["activity.started"]).events).toEqual([
      expect.objectContaining({ entityId: h.obstacle.id, data: expect.objectContaining({ durationMs: 1000 }) }),
    ]);
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([
      expect.objectContaining({ entityId: h.obstacle.id, data: expect.objectContaining({ kind: "traversing", reason: "completed" }) }),
    ]);
  });

  it("uses a three-second traversal fallback when live obstacle duration is absent", () => {
    const h = runtime();
    delete (h.obstacle.obstacle as Partial<NonNullable<SemanticEntity["obstacle"]>>).durationMs;
    expect(value(h.api.planPath({ position: GOAL })).etaMs).toBe(Math.round(3000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(3000 + 8.4 / PLAYER_SPEED * 1000));
    h.step(20);
    expect(h.events.since(0, ["activity.started"]).events).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ durationMs: 3000 }) }),
    ]);
  });

  it.each(["missing entity", "missing obstacle", "new requirement"])("keeps direct when the shortcut has a %s", (invalid) => {
    const h = runtime();
    if (invalid === "missing entity") h.entities.splice(0, 1);
    if (invalid === "missing obstacle") delete h.obstacle.obstacle;
    if (invalid === "new requirement") h.obstacle.obstacle!.reqLevel = 9;
    expectDirect(h);
  });

  it.each([
    ["approach", ENTRY, false],
    ["approach", ENTRY, true],
    ["final", GOAL, false],
    ["final", GOAL, true],
  ] as const)("keeps direct when the %s walk leg to %s is invalid with partial=%s", (_name, invalidTo, partial) => {
    const h = runtime();
    h.controls.pathOverride = (from, to) => {
      const isRouteLeg = distanceXZ(to, invalidTo) < 0.001
        && (invalidTo === ENTRY || distanceXZ(from, EXIT) < 0.001);
      if (!isRouteLeg) return undefined;
      return partial ? { path: [from], partial: true, arrivalGap: 10 } : null;
    };
    expectDirect(h);
  });

  describe.each([
    ["position", { position: GOAL }],
    ["location", { locationId: "test_location" }],
  ] satisfies [string, MoveTarget][])("final route allowance for a %s target", (_name, target) => {
    it.each(["complete", "partial", "unreachable"] as const)(
      "rejects a final leg ending 3 m short when the direct path is %s",
      (directPath) => {
        const h = runtime();
        h.controls.pathOverride = (from, to) => {
          if (distanceXZ(to, GOAL) > 0.001) return undefined;
          if (distanceXZ(from, EXIT) < 0.001) {
            return { path: [from, [39, 0, 0]], partial: true, arrivalGap: 3 };
          }
          if (distanceXZ(from, START) > 0.001 || directPath === "complete") return undefined;
          return directPath === "partial"
            ? { path: [from, [39, 0, 0]], partial: true, arrivalGap: 3 }
            : null;
        };
        if (directPath === "complete") {
          expectDirect(h, target);
          return;
        }
        expect(h.api.planPath(target)).toMatchObject({ ok: false, error: { code: "NOT_REACHABLE" } });
        h.events.flush();
        expect(h.events.since(0).events).toEqual([]);
        expect(h.api.moveTo(target)).toMatchObject({ ok: false, error: { code: "NOT_REACHABLE" } });
        h.events.flush();
        expect(h.events.since(0, ["navigation.started"]).events).toEqual([]);
        expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(1);
        expect(h.store.get().player.movement.mode).toBe("idle");
      },
    );
  });

  it("keeps the allowance for an intermediate walk while reaching the final raw position", () => {
    const h = runtime();
    const anchor: Vec3 = [10, 0, 0];
    vi.spyOn(h.nav, "planRouteVia").mockReturnValue({
      path: ["start", "anchor", "destination"], cost: 10, edges: [],
      legs: [
        { kind: "walk", from: START, to: anchor, fromId: "start", toId: "anchor", cost: 10 / PLAYER_SPEED },
        { kind: "walk", from: anchor, to: GOAL, fromId: "anchor", toId: "destination", cost: 32 / PLAYER_SPEED },
      ],
    });
    h.controls.pathOverride = (from, to) => {
      if (distanceXZ(from, START) < 0.001 && distanceXZ(to, GOAL) < 0.001) return null;
      if (distanceXZ(to, anchor) < 0.001) {
        return { path: [from, [7, 0, 0]], partial: true, arrivalGap: 3 };
      }
      return undefined;
    };
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "walk"]);
    expect(preview.points.at(-1)).toEqual(GOAL);
    expect(value(h.api.moveTo({ position: GOAL })).pathLength).toBeCloseTo(42, 6);
    h.step(140);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("keeps an entity target's final route allowance when its path ends 3 m short", () => {
    const h = runtime();
    h.controls.pathOverride = (from, to) => {
      if (distanceXZ(to, GOAL) > 0.001) return undefined;
      if (distanceXZ(from, START) < 0.001) return null;
      if (distanceXZ(from, EXIT) < 0.001) {
        return { path: [from, [39, 0, 0]], partial: true, arrivalGap: 3 };
      }
      return undefined;
    };
    const target = { entityId: h.targetEntity.id };
    const preview = value(h.api.planPath(target));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "shortcut", "walk"]);
    expect(preview.points.at(-1)).toEqual([39, 0, 0]);
    expect(value(h.api.moveTo(target)).etaMs).toBe(preview.etaMs);
    h.step(60);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(3.4);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it.each([
    ["position", { position: GOAL }],
    ["location", { locationId: "test_location" }],
    ["entity interaction position", { entityId: "test_target" }],
  ] satisfies [string, MoveTarget][])("selects the same route for a %s target", (_name, target) => {
    const h = runtime();
    const preview = value(h.api.planPath(target));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "shortcut", "walk"]);
    expect(preview.points.at(-1)).toEqual(GOAL);
    expect(preview.etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo(target)).etaMs).toBeCloseTo(preview.etaMs, 6);
    expect(h.pathQueries.some((query) => query.to[0] === 50)).toBe(false);
    h.step(60);
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
  });

  it("prices portals with their leg duration and preserves the destination region", () => {
    const h = runtime();
    h.controls.traversalKind = "portal";
    h.controls.authoredDurationMs = 2000;
    h.controls.authoredCost = 100;
    const preview = value(h.api.planPath({ position: GOAL }));
    expect(preview.legs.map((leg) => leg.kind)).toEqual(["walk", "portal", "walk"]);
    expect(preview.etaMs).toBe(Math.round(2000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(2000 + 8.4 / PLAYER_SPEED * 1000));
    h.step(70);
    expect(h.store.get().player.regionId).toBe("gravelmaw");
    expect(distanceXZ(h.store.get().player.position, GOAL)).toBeLessThanOrEqual(0.35);
  });

  it("falls back to the executable graph route when the direct path is unreachable", () => {
    const h = runtime();
    h.controls.pathOverride = (from, to) => distanceXZ(from, START) < 0.001 && distanceXZ(to, GOAL) < 0.001
      ? null : undefined;
    expect(value(h.api.planPath({ position: GOAL })).etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    expect(value(h.api.moveTo({ position: GOAL })).etaMs).toBe(Math.round(1000 + 8.4 / PLAYER_SPEED * 1000));
    h.events.flush();
    expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("previews repeatedly without changing active movement, pending interaction, revision, or events", () => {
    const h = runtime();
    value(h.api.interact(h.targetEntity.id, "talk"));
    h.events.flush();
    const beforeState = structuredClone(h.store.get());
    const beforeRevision = h.api.getRevision();
    const beforeRoute = h.movement.getRouteProgress();
    const beforeEvents = h.events.since(0);
    expect(h.api.hasPending()).toBe(true);
    const first = value(h.api.planPath({ position: GOAL }));
    const second = value(h.api.planPath({ entityId: h.targetEntity.id }));
    expect(second.etaMs).toBeCloseTo(first.etaMs, 6);
    expect(first.legs.some((leg) => leg.kind === "shortcut")).toBe(true);
    h.events.flush();
    expect(h.store.get()).toEqual(beforeState);
    expect(h.api.getRevision()).toEqual(beforeRevision);
    expect(h.movement.getRouteProgress()).toEqual(beforeRoute);
    expect(h.events.since(0)).toEqual(beforeEvents);
    expect(h.api.hasPending()).toBe(true);
    h.step(60);
    expect(h.talks).toEqual([h.targetEntity.id]);
    expect(h.api.hasPending()).toBe(false);
  });

  it("keeps entity partial-path arrival allowance in agreement between preview and movement", () => {
    const h = runtime();
    h.controls.graphEnabled = false;
    h.controls.pathOverride = (from) => ({ path: [from, [41, 0, 0]], partial: true, arrivalGap: 1 });
    const target = { entityId: h.targetEntity.id };
    const preview = value(h.api.planPath(target));
    expect(preview.legs).toEqual([]);
    expect(preview.points.at(-1)).toEqual([41, 0, 0]);
    const started = value(h.api.moveTo(target));
    expect(started.pathLength).toBeCloseTo(preview.pathLength, 2);
    expect(started.etaMs).toBeCloseTo(preview.etaMs, 0);
    expect(h.api.planPath({ position: GOAL })).toMatchObject({ ok: false, error: { code: "NOT_REACHABLE" } });
  });

  it.each([false, true])("keeps a pending talk when the active shortcut is clicked again with reverse=%s", (reverse) => {
    const h = runtime();
    h.controls.reverse = reverse;
    if (reverse) {
      h.store.get().player.position = [...GOAL];
      h.targetEntity.interactionPosition = START;
    }
    value(h.api.interact(h.targetEntity.id, "talk"));
    h.step(15);
    expect(h.store.get().activity).toMatchObject({ kind: "traversing", obstacleId: h.obstacle.id });
    expect(h.api.hasPending()).toBe(true);
    const beforeState = structuredClone(h.store.get());
    const beforeRoute = h.movement.getRouteProgress();
    const beforeEvents = h.events.since(0);

    expect(value(h.api.interact(h.obstacle.id, "climb"))).toEqual({ started: `already on ${h.obstacle.name}` });
    h.events.flush();
    expect(h.store.get()).toEqual(beforeState);
    expect(h.movement.getRouteProgress()).toEqual(beforeRoute);
    expect(h.events.since(0)).toEqual(beforeEvents);
    expect(h.api.hasPending()).toBe(true);

    h.step(60);
    expect(h.talks).toEqual([h.targetEntity.id]);
    expect(h.api.hasPending()).toBe(false);
    expect(h.store.get().world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("trims only the final route walk into interaction reach and runs the pending action once", () => {
    const h = runtime();
    value(h.api.interact(h.targetEntity.id, "talk"));
    expect(h.store.get().player.movement.destination).toEqual(ENTRY);
    expect(h.api.hasPending()).toBe(true);
    h.step(60);
    expect(h.talks).toEqual([h.targetEntity.id]);
    const gap = distanceXZ(h.store.get().player.position, GOAL);
    expect(gap).toBeGreaterThanOrEqual(INTERACT_RANGE - 0.5);
    expect(gap).toBeLessThanOrEqual(INTERACT_RANGE);
    expect(h.events.since(0, ["navigation.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });
});
