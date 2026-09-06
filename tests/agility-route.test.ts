import { describe, expect, it } from "vitest";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { PLAYER_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { pathLength } from "../game/src/core/math.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { ActivitySystem } from "../game/src/systems/activity.js";
import { AgilitySystem } from "../game/src/systems/agility.js";
import type { TraversalPresentationPort } from "../game/src/systems/traversalMotion.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation, RouteLeg } from "../game/src/systems/navigation.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

function seedFor(success: boolean): number {
  for (let seed = 1; seed < 100; seed += 1) {
    if (new RngStreams(seed).get("misc").chance(0.6) === success) return seed;
  }
  throw new Error("No deterministic traversal seed found");
}

function runtime(seed = seedFor(true), presentation?: TraversalPresentationPort, isLandingSafe?: (point: Vec3) => boolean) {
  const store = new Store(seed, 0);
  const state = store.get();
  state.player.position = [0, 0, 0];
  const events = new EventBus();
  const clock = new SimClock();
  const rng = new RngStreams(seed);
  const obstacle: SemanticEntity = {
    id: "test_ledge", name: "Test ledge", archetype: "obstacle", tier: 1, regionId: "fallowmarch",
    position: [0, 0, 0], state: "available", interactions: ["inspect", "climb"],
    requirements: { agility: 1 },
    obstacle: { reqLevel: 1, exitPosition: [8, 0, 0], durationMs: 800, savesMeters: 30 },
  };
  const entities = { get: (id: string) => id === obstacle.id ? obstacle : undefined };
  const nav = {
    isReady: () => true,
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed: (from: Vec3, to: Vec3) => ({ path: [from, to], partial: false, arrivalGap: 0 }),
    etaMs: (path: Vec3[]) => pathLength(path) / PLAYER_SPEED * 1000,
    planRouteVia: () => null,
  } as unknown as Navigation;
  const dispatcher = new InteractionDispatcher({
    get: entities.get,
    playerPosition: () => state.player.position,
    skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
  });
  const activity = new ActivitySystem(store, events);
  const agility = new AgilitySystem({ store, events, clock, rng, entities, activity, dispatcher, nav, presentation, isLandingSafe });
  const movement = new Movement(nav, events, {
    shortcuts: {
      begin: (id, entry, exit) => agility.beginRoute(id, entry, exit),
      cancel: (atMs, reason) => agility.cancelTraversal(atMs, reason),
    },
  });
  const api = new CorealmGameApi(store, events, nav, movement, clock);
  api.register("entities", { ...entities, all: () => [obstacle], observe: () => [] });
  api.register("interactions", dispatcher);
  const leg: RouteLeg = {
    kind: "shortcut", from: [0, 0, 0], to: [8, 0, 0], fromId: "entry", toId: "exit",
    obstacleId: obstacle.id, reqLevel: 1, cost: 0.001, durationMs: 1,
  };
  const step = (ticks: number) => {
    for (let tick = 0; tick < ticks; tick += 1) {
      clock.commitTick();
      movement.update(state, 100, clock.elapsedMs);
      activity.tick(100, clock.elapsedMs);
      events.flush();
    }
  };
  const outcome = () => ({
    position: state.player.position,
    health: state.player.health,
    xp: state.skills.agility.xp,
    uses: state.world.obstaclesUsed[obstacle.id] ?? 0,
    rng: rng.get("misc").getState(),
  });
  return { store, state, events, clock, rng, obstacle, activity, agility, movement, api, leg, step, outcome };
}

describe("Agility route parity", () => {
  it("waits for an opaque painted frame before RNG and placement and ends after the commit", () => {
    let ready = false;
    const calls: string[] = [];
    const h = runtime(seedFor(true), {
      begin: () => calls.push("begin"), update: () => calls.push("update"),
      readyToCommit: () => ready,
      end: (reason, position) => calls.push(`${reason}:${position[0]}`),
    });
    h.api.interact(h.obstacle.id, "climb");
    const rngBefore = h.rng.get("misc").getState();
    h.step(10);
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.rng.get("misc").getState()).toBe(rngBefore);
    expect(calls).not.toContain("completed:8");
    ready = true;
    h.step(1);
    expect(calls.at(-1)).toBe("completed:8");
    expect(h.state.skills.agility.xp).toBe(18);
  });

  it("checks live landing collision at start and again at commit", () => {
    let safe = false;
    const h = runtime(seedFor(true), undefined, () => safe);
    expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(false);
    safe = true;
    expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    const rngBefore = h.rng.get("misc").getState();
    safe = false;
    h.step(9);
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.rng.get("misc").getState()).toBe(rngBefore);
    expect(h.state.skills.agility.xp).toBe(0);
  });
  it("rejects reverse traversal of a one-way obstacle without consuming RNG", () => {
    const h = runtime();
    h.obstacle.meta = { oneWay: true };
    h.state.player.position = [8, 0, 0];
    const before = h.outcome();
    expect(h.agility.beginRoute(h.obstacle.id, [8, 0, 0], [0, 0, 0])).toMatchObject({ ok: false });
    expect(h.outcome()).toEqual(before);
  });

  it("rejects a landing that disappears during traversal with no XP or RNG roll", () => {
    const h = runtime();
    expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    const before = h.outcome();
    // Authored destination can be invalidated while the activity is running.
    h.obstacle.obstacle!.exitPosition = [Number.NaN, 0, 0];
    h.step(9);
    expect(h.outcome()).toEqual(before);
    expect(h.state.activity).toBeNull();
    expect(h.events.since(0, ["activity.stopped"]).events[0]?.data)
      .toMatchObject({ reason: "failed", landingBlocked: true, xp: 0, damage: 0 });
  });
  it.each([true, false])("uses direct traversal duration and seeded outcome for success=%s", (success) => {
    const direct = runtime(seedFor(success));
    const route = runtime(seedFor(success));
    const healthBefore = direct.state.player.health;
    expect(direct.api.interact(direct.obstacle.id, "climb").ok).toBe(true);
    expect(route.movement.startRoute(route.state, [route.leg], 0)).toBe(true);
    expect(route.state.activity).toMatchObject(direct.state.activity!);
    expect(route.state.activity).toMatchObject({ kind: "traversing", endsAtMs: 800 });

    direct.step(7);
    route.step(7);
    expect(route.outcome()).toEqual(direct.outcome());
    expect(route.state.player.position).toEqual([0, 0, 0]);
    expect(route.state.skills.agility.xp).toBe(0);
    expect(route.movement.isTraversing()).toBe(true);
    direct.step(1);
    route.step(1);

    expect(route.outcome()).toEqual(direct.outcome());
    expect(route.events.since(0, ["activity.started", "activity.stopped", "level.gained"]).events)
      .toEqual(direct.events.since(0, ["activity.started", "activity.stopped", "level.gained"]).events.map((event) => ({
        ...event, seq: event.seq + 1,
      })));
    expect(route.state.skills.agility.xp).toBe(success ? 18 : 0);
    expect(route.state.world.obstaclesUsed[route.obstacle.id] ?? 0).toBe(success ? 1 : 0);
    expect(route.state.player.position).toEqual(success ? [8, 0, 0] : [0, 0, 0]);
    if (success) expect(route.state.player.health).toBe(healthBefore);
    else expect(healthBefore - route.state.player.health).toBeGreaterThanOrEqual(2);
    if (!success) expect(healthBefore - route.state.player.health).toBeLessThanOrEqual(6);
    route.step(1);
    expect(route.movement.getRouteProgress().active).toBe(false);
    expect(route.events.since(0, ["navigation.completed"]).events).toHaveLength(success ? 1 : 0);
    expect(route.events.since(0, ["navigation.failed"]).events).toHaveLength(success ? 0 : 1);
  });

  it("continues the next walk only after the Agility activity succeeds", () => {
    const h = runtime();
    const tail: RouteLeg = {
      kind: "walk", from: [8, 0, 0], to: [10, 0, 0], fromId: "exit", toId: "goal", cost: 2 / PLAYER_SPEED,
    };
    expect(h.movement.startRoute(h.state, [h.leg, tail], 0)).toBe(true);
    h.step(7);
    expect(h.state.player.position).toEqual([0, 0, 0]);
    h.step(30);
    expect(h.state.player.position[0]).toBeGreaterThan(9.65);
    expect(h.state.skills.agility.xp).toBe(18);
    expect(h.state.world.obstaclesUsed[h.obstacle.id]).toBe(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
  });

  it.each([true, false])("retains reverse traversal direction for success=%s", (success) => {
    const h = runtime(seedFor(success));
    h.state.player.position = [8, 0, 0];
    const reverse = { ...h.leg, from: h.leg.to, to: h.leg.from };
    expect(h.movement.startRoute(h.state, [reverse], 0)).toBe(true);
    expect(h.state.activity).toMatchObject({ kind: "traversing", exitPosition: [0, 0, 0], endsAtMs: 800 });
    h.step(7);
    expect(h.state.player.position).toEqual([8, 0, 0]);
    h.step(2);

    expect(h.state.player.position).toEqual(success ? [0, 0, 0] : [8, 0, 0]);
    expect(h.state.skills.agility.xp).toBe(success ? 18 : 0);
    expect(h.state.world.obstaclesUsed[h.obstacle.id] ?? 0).toBe(success ? 1 : 0);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(success ? 1 : 0);
  });

  it("rejects fabricated route endpoints and the wrong physical entrance", () => {
    const h = runtime();
    expect(h.agility.beginRoute(h.obstacle.id, [0, 0, 0], [100, 0, 0])).toMatchObject({
      ok: false, error: { code: "INVALID_ARGUMENT" },
    });
    expect(h.agility.beginRoute(h.obstacle.id, [8, 0, 0], [0, 0, 0])).toMatchObject({
      ok: false, error: { code: "OUT_OF_RANGE" },
    });
    expect(h.state.activity).toBeNull();
    expect(h.state.skills.agility.xp).toBe(0);
  });

  it.each(["direct", "route"] as const)("cancels %s traversal before a replacement path can be relocated by its deadline", (kind) => {
    const h = runtime();
    if (kind === "direct") expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    else expect(h.movement.startRoute(h.state, [h.leg], 0)).toBe(true);
    const rngBefore = h.rng.get("misc").getState();
    expect(h.movement.startPath(h.state, [0, 0, 2], null, 0)).not.toBeNull();
    expect(h.state.activity).toBeNull();
    h.step(30);

    expect(h.state.player.position[0]).toBe(0);
    expect(h.state.player.position[2]).toBeGreaterThan(1.65);
    expect(h.state.skills.agility.xp).toBe(0);
    expect(h.state.world.obstaclesUsed[h.obstacle.id]).toBeUndefined();
    expect(h.rng.get("misc").getState()).toBe(rngBefore);
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ kind: "traversing", reason: "replaced" }) }),
    ]);
  });

  it("uses the real dispatcher range and live level requirements before taking a route shortcut", () => {
    const remote = runtime();
    remote.state.player.position = [30, 0, 0];
    expect(remote.agility.beginRoute(remote.obstacle.id, remote.leg.from, remote.leg.to)).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    expect(remote.movement.startRoute(remote.state, [remote.leg], 0)).toBe(false);
    expect(remote.state.activity).toBeNull();

    const locked = runtime();
    locked.obstacle.obstacle!.reqLevel = 8;
    expect(locked.agility.beginRoute(locked.obstacle.id, locked.leg.from, locked.leg.to)).toMatchObject({ ok: false, error: { code: "REQUIREMENTS_NOT_MET" } });
    expect(locked.movement.startRoute(locked.state, [locked.leg], 0)).toBe(false);
    expect(locked.state.activity).toBeNull();
    expect(locked.state.skills.agility.xp).toBe(0);
  });

  it("leaves other activities to ActivitySystem's normal interruption rules", () => {
    const h = runtime();
    h.activity.start({ kind: "eating", itemId: "seared_minnow", endsAtMs: 1_800 }, 0);
    const running = h.state.activity;
    expect(h.agility.cancelTraversal(0, "replaced")).toBe(false);
    h.movement.startPath(h.state, [0, 0, 2], null, 0);
    expect(h.state.activity).toBe(running);
    h.events.flush();
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([]);
  });

  it("replaces a direct traversal with a route and cancels a routed traversal through the normal activity owner", () => {
    const h = runtime();
    expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    expect(h.movement.startRoute(h.state, [h.leg], 0)).toBe(true);
    h.events.flush();
    expect(h.events.since(0, ["activity.stopped"]).events).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ reason: "replaced" }) }),
    ]);
    expect(h.api.stop().ok).toBe(true);
    h.step(20);
    expect(h.state.activity).toBeNull();
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.state.skills.agility.xp).toBe(0);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(2);
    expect(h.events.since(0, ["activity.stopped"]).events[1]?.data.reason).toBe("cancelled");
  });

  it.each(["direct", "route"] as const)("keeps a repeated %s obstacle action on its original timer", (kind) => {
    const h = runtime();
    if (kind === "direct") expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    else expect(h.movement.startRoute(h.state, [h.leg], 0)).toBe(true);
    h.step(3);
    expect(h.api.interact(h.obstacle.id, "climb")).toMatchObject({ ok: true, value: { started: "already on Test ledge" } });
    expect(h.state.activity).toMatchObject({ kind: "traversing", endsAtMs: 800 });
    h.step(6);
    expect(h.state.player.position).toEqual([8, 0, 0]);
    expect(h.state.skills.agility.xp).toBe(18);
    expect(h.events.since(0, ["activity.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
  });

  it("acknowledges a repeated reverse crossing before checking the forward entrance distance", () => {
    const h = runtime();
    h.state.player.position = [8, 0, 0];
    expect(h.movement.startRoute(h.state, [{ ...h.leg, from: h.leg.to, to: h.leg.from }], 0)).toBe(true);
    h.step(3);
    expect(h.api.interact(h.obstacle.id, "climb")).toMatchObject({ ok: true, value: { started: "already on Test ledge" } });
    expect(h.state.activity).toMatchObject({ kind: "traversing", endsAtMs: 800, exitPosition: [0, 0, 0] });
    expect(h.movement.getRouteProgress()).toMatchObject({ active: true, traversing: true });
    h.step(6);

    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.state.skills.agility.xp).toBe(18);
    expect(h.events.since(0, ["activity.started"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("stops a direct traversal through Movement.stop before an external placement", () => {
    const h = runtime();
    expect(h.api.interact(h.obstacle.id, "climb").ok).toBe(true);
    h.step(3);
    h.movement.stop(h.state, h.clock.elapsedMs, "teleport");
    h.state.player.position = [20, 0, 0];
    h.step(20);

    expect(h.state.activity).toBeNull();
    expect(h.state.player.position).toEqual([20, 0, 0]);
    expect(h.state.skills.agility.xp).toBe(0);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
  });

  it("reports the direct traversal stopped by the movement port exactly once", () => {
    const h = runtime();
    h.api.interact(h.obstacle.id, "climb");
    expect(h.api.stop()).toEqual({ ok: true, value: { stopped: ["traversing"] } });
    h.step(20);
    expect(h.state.activity).toBeNull();
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
  });
});
