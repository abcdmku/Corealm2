import { describe, expect, it } from "vitest";
import { MOVEMENT } from "../game/src/app/config.js";
import type { RegionId, Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ, pathLength } from "../game/src/core/math.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation, RouteLeg } from "../game/src/systems/navigation.js";

function fixture() {
  const state = createInitialState();
  state.player.position = [0, 0, 0];
  state.player.regionId = "fallowmarch";
  const events = new EventBus();
  const nav = {
    closestPoint: (point: Vec3) => point,
    findPathDetailed: (from: Vec3, to: Vec3) => ({ path: [from, to], partial: false, arrivalGap: 0 }),
    etaMs: (path: Vec3[]) => pathLength(path) / MOVEMENT.runSpeed * 1000,
  } as unknown as Navigation;
  const calls: { destination: Vec3; regionId: RegionId; commit: () => void }[] = [];
  let resolve!: () => void, reject!: (error: Error) => void;
  const fade = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const movement = new Movement(nav, events, { portals: {
    transition: (destination, regionId, commit) => {
      calls.push({ destination, regionId, commit });
      return fade;
    },
  } });
  const route: RouteLeg[] = [
    { kind: "portal", from: [0, 0, 0], to: [20, 0, 0], fromId: "entry", toId: "exit",
      portalId: "test_portal", toRegionId: "gravelmaw", durationMs: 100, cost: 0.1 },
    { kind: "walk", from: [20, 0, 0], to: [24, 0, 0], fromId: "exit", toId: "goal", cost: 4 / MOVEMENT.runSpeed },
  ];
  expect(movement.startRoute(state, route, 0)).toBe(true);
  movement.update(state, 100, 100);
  expect(calls).toHaveLength(1);
  const tick = (count = 30) => {
    for (let index = 0; index < count; index++) movement.update(state, 100, 300 + index * 100);
    events.flush();
  };
  return { state, events, movement, calls, resolve, reject, tick };
}

describe("routed portal presentation", () => {
  it("commits once behind the curtain and waits for the fade to finish before walking", async () => {
    const h = fixture();
    h.tick(3);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ destination: [20, 0, 0], regionId: "gravelmaw" });
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.state.player.regionId).toBe("fallowmarch");

    h.calls[0]!.commit();
    h.calls[0]!.commit();
    expect(h.state.player.position).toEqual([20, 0, 0]);
    expect(h.state.player.regionId).toBe("gravelmaw");
    expect(h.movement.getSpeedMps()).toBe(0);
    expect(h.movement.getGait()).toBe("idle");
    h.tick(3);
    expect(h.state.player.position).toEqual([20, 0, 0]);
    expect(h.movement.getRouteProgress()).toMatchObject({ active: true, kind: "portal", traversing: true });
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);

    h.resolve();
    await Promise.resolve();
    expect(h.movement.getRouteProgress()).toMatchObject({ active: true, kind: "walk", traversing: false });
    h.tick();
    expect(distanceXZ(h.state.player.position, [24, 0, 0])).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it.each(["before commit", "after commit"])("keeps a replacement intent when the old fade ends %s", async (stage) => {
    const h = fixture();
    if (stage === "after commit") h.calls[0]!.commit();
    const position = h.state.player.position;
    const destination: Vec3 = [position[0], position[1], 6];
    expect(h.movement.startPath(h.state, destination, null, 200)).not.toBeNull();
    h.calls[0]!.commit();
    h.resolve();
    await Promise.resolve();
    expect(h.state.player.position).toEqual(position);
    expect(h.state.player.movement.destination).toEqual(destination);
    h.tick();
    expect(distanceXZ(h.state.player.position, destination)).toBeLessThanOrEqual(0.35);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.completed"]).events).toHaveLength(1);
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });

  it("ignores a late commit after explicit cancellation", async () => {
    const h = fixture();
    expect(h.movement.stop(h.state, 200)).toBe(true);
    h.calls[0]!.commit();
    h.resolve();
    await Promise.resolve();
    h.tick();
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.state.player.regionId).toBe("fallowmarch");
    expect(h.movement.isTraversing()).toBe(false);
    expect(h.events.since(0, ["navigation.completed"]).events).toEqual([]);
    expect(h.events.since(0, ["navigation.failed"]).events).toHaveLength(1);
  });

  it.each(["load failure", "missing commit"])("ends a failed transition without relocating on %s", async (reason) => {
    const h = fixture();
    if (reason === "load failure") h.reject(new Error("Destination asset failed"));
    else h.resolve();
    await Promise.resolve();
    h.tick();
    expect(h.state.player.position).toEqual([0, 0, 0]);
    expect(h.state.player.regionId).toBe("fallowmarch");
    expect(h.movement.getRouteProgress().active).toBe(false);
    expect(h.state.player.movement.mode).toBe("idle");
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([
      expect.objectContaining({ data: { reason: reason === "load failure" ? "portal-load-failed" : "portal-transition-cancelled" } }),
    ]);
    expect(h.events.since(0, ["activity.stopped"]).events).toHaveLength(1);
  });
});
