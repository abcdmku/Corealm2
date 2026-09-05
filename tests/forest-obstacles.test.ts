import { describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import { EventBus } from "../game/src/core/events.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";
import { ForestObstacles } from "../game/src/world/forestObstacles.js";

const trunk = { id: "tree", position: [0, 0, 0] as Vec3, trunkRadius: 0.45 };

function flatNavigation(): Navigation {
  return {
    closestPoint: (point: Vec3) => point,
    nearestWalkable: (point: Vec3) => point,
    findPathDetailed: (from: Vec3, to: Vec3) => ({ path: [from, to], partial: false, arrivalGap: 0 }),
    etaMs: () => 0,
  } as unknown as Navigation;
}

describe("resident forest trunk collision", () => {
  it("reports placement overlaps without movement and respects height and removed trunks", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    expect(obstacles.overlaps([0, 0, 0], PLAYER_RADIUS)).toEqual(["tree"]);
    expect(obstacles.overlaps([trunk.trunkRadius + PLAYER_RADIUS, 0, 0], PLAYER_RADIUS)).toEqual([]);
    expect(obstacles.overlaps([0, -12, 0], PLAYER_RADIUS)).toEqual([]);
    obstacles.remove(trunk.id);
    expect(obstacles.overlaps([0, 0, 0], PLAYER_RADIUS)).toEqual([]);
  });

  it("sweeps the entire movement segment instead of tunnelling between clear endpoints", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const result = obstacles.resolve([3, 0, 0], [-3, 0, 0], PLAYER_RADIUS);
    expect(result[0]).toBeCloseTo(-trunk.trunkRadius - PLAYER_RADIUS - 0.002, 5);
    expect(result[2]).toBe(0);
    obstacles.remove(trunk.id);
    expect(obstacles.resolve([3, 0, 0], [-3, 0, 0], PLAYER_RADIUS)).toEqual([3, 0, 0]);
  });

  it("preserves tangent motion and ignores trunks on another vertical level", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const from: Vec3 = [-2, 0, -0.2];
    const result = obstacles.resolve([1, 0, 1.2], from, PLAYER_RADIUS);
    expect(result[2]).toBeGreaterThan(1.2);
    expect(Math.hypot(result[0], result[2])).toBeGreaterThanOrEqual(trunk.trunkRadius + PLAYER_RADIUS);
    expect(Math.hypot(result[0] - from[0], result[2] - from[2])).toBeLessThanOrEqual(Math.hypot(3, 1.4));
    expect(obstacles.resolve([3, -12, 0], [-3, -12, 0], PLAYER_RADIUS)).toEqual([3, -12, 0]);
  });

  it("allows gradual overlap escape after activation without teleporting or allowing deeper motion", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    expect(obstacles.resolve([0.3, 0, 0], [0.1, 0, 0], PLAYER_RADIUS)).toEqual([0.3, 0, 0]);
    expect(obstacles.resolve([-0.1, 0, 0], [0.1, 0, 0], PLAYER_RADIUS)).toEqual([0.1, 0, 0]);
    expect(obstacles.resolve([0.2, 0, 0], [0, 0, 0], PLAYER_RADIUS)).toEqual([0.2, 0, 0]);
  });

  it("keeps the player outside both trunks when a gap is narrower than their body", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    obstacles.upsert({ ...trunk, id: "second", position: [0, 0, 1.5] });
    const result = obstacles.resolve([2, 0, 0.75], [-2, 0, 0.75], PLAYER_RADIUS);
    expect(result[0]).toBeLessThan(0);
    expect(Math.hypot(result[0], result[2])).toBeGreaterThanOrEqual(trunk.trunkRadius + PLAYER_RADIUS - 0.0001);
    expect(Math.hypot(result[0], result[2] - 1.5)).toBeGreaterThanOrEqual(trunk.trunkRadius + PLAYER_RADIUS - 0.0001);
  });

  it("rechecks other trunks after an overlap changes the escape direction", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert({ ...trunk, id: "ahead", position: [0.6, 0, 1] });
    obstacles.upsert(trunk);
    const result = obstacles.resolve([-0.9, 0, 1], [0.1, 0, 0], PLAYER_RADIUS);
    expect(Math.hypot(result[0] - 0.6, result[2] - 1)).toBeGreaterThanOrEqual(trunk.trunkRadius + PLAYER_RADIUS - 0.0001);
    expect(Math.hypot(result[0], result[2])).toBeGreaterThanOrEqual(0.1);
  });

  it("never deepens conflicting overlaps when several trunks activate around the player", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert({ ...trunk, id: "left", position: [-0.5, 0, 0] });
    obstacles.upsert({ ...trunk, id: "right", position: [0.25, 0, -0.433] });
    const result = obstacles.resolve([0, 0, -1], [0, 0, 0], PLAYER_RADIUS);
    expect(Math.hypot(result[0] + 0.5, result[2])).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(Math.hypot(result[0] - 0.25, result[2] + 0.433)).toBeGreaterThanOrEqual(Math.hypot(0.25, 0.433) - 1e-9);
  });

  it("uses the clear side when static navigation rejects the initially preferred detour", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const preferred = obstacles.waypoint([-2, 0, 0], [2, 0, 0], PLAYER_RADIUS)!;
    const alternative = obstacles.waypoint([-2, 0, 0], [2, 0, 0], PLAYER_RADIUS,
      (candidate) => candidate[2] * preferred[2] < 0);
    expect(alternative).not.toBeNull();
    expect(alternative![2] * preferred[2]).toBeLessThan(0);
  });

  it("constrains real direct movement and opens the trunk footprint when the tree is harvested", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const state = createInitialState();
    state.player.position = [-2, 0, 0];
    const movement = new Movement(flatNavigation(), new EventBus(), { dynamicObstacles: obstacles });
    movement.setDirectInput({ forward: 0, strafe: 1, cameraYaw: 0 });
    for (let tick = 0; tick < 20; tick += 1) movement.update(state, 100, tick * 100);
    expect(state.player.position[0]).toBeLessThanOrEqual(-trunk.trunkRadius - PLAYER_RADIUS);
    obstacles.remove(trunk.id);
    for (let tick = 20; tick < 40; tick += 1) movement.update(state, 100, tick * 100);
    expect(state.player.position[0]).toBeGreaterThan(2);
  });

  it("walks a real path around a trunk on an intermediate corner and completes at the destination", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert({ ...trunk, position: [3, 0, 0] });
    const state = createInitialState();
    state.player.position = [0, 0, 0];
    const events = new EventBus();
    const movement = new Movement(flatNavigation(), events, { dynamicObstacles: obstacles });
    expect(movement.startPath(state, [6, 0, 0], null, 0)).not.toBeNull();
    let widest = 0;
    for (let tick = 0; tick < 120 && state.player.movement.mode === "path"; tick += 1) {
      movement.update(state, 100, tick * 100);
      widest = Math.max(widest, Math.abs(state.player.position[2]));
      expect(Math.hypot(state.player.position[0] - 3, state.player.position[2])).toBeGreaterThanOrEqual(
        trunk.trunkRadius + PLAYER_RADIUS - 0.0001,
      );
    }
    events.flush();
    expect(widest).toBeGreaterThan(0.8);
    expect(state.player.movement.mode).toBe("idle");
    expect(Math.hypot(state.player.position[0] - 6, state.player.position[2])).toBeLessThan(0.35);
    expect(events.since(0).events.filter((event) => event.type === "navigation.completed")).toHaveLength(1);
    expect(events.since(0).events.filter((event) => event.type === "navigation.failed")).toHaveLength(0);
  });

  it("rejects a detour snapped away from its requested point and walks around the other side", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const state = createInitialState();
    state.player.position = [-2, 0, 0];
    const nav = {
      ...flatNavigation(),
      findPathDetailed(from: Vec3, to: Vec3) {
        // This matches Detour: arrivalGap can be zero even when the requested point snapped
        // out of a wall. The path's endpoint is the useful evidence for accepting the detour.
        const snapped: Vec3 = to[2] < -0.1 ? [to[0], 0, 0] : to;
        return { path: [from, snapped], partial: false, arrivalGap: 0 };
      },
    } as unknown as Navigation;
    const movement = new Movement(nav, new EventBus(), { dynamicObstacles: obstacles });
    movement.startPath(state, [2, 0, 0], null, 0);
    let widest = 0;
    for (let tick = 0; tick < 100 && state.player.movement.mode === "path"; tick += 1) {
      movement.update(state, 100, tick * 100);
      widest = Math.max(widest, state.player.position[2]);
      expect(state.player.position[2]).toBeGreaterThanOrEqual(-0.01);
    }
    expect(widest).toBeGreaterThan(0.8);
    expect(Math.hypot(state.player.position[0] - 2, state.player.position[2])).toBeLessThan(0.35);
  });

  it("fails an unreachable trunk-centre destination once instead of claiming arrival or retrying forever", () => {
    const obstacles = new ForestObstacles();
    obstacles.upsert(trunk);
    const state = createInitialState();
    state.player.position = [-2, 0, 0];
    const events = new EventBus();
    const movement = new Movement(flatNavigation(), events, { dynamicObstacles: obstacles });
    movement.startPath(state, [0, 0, 0], null, 0);
    for (let tick = 0; tick < 100; tick += 1) movement.update(state, 100, tick * 100);
    events.flush();
    expect(state.player.position[0]).toBeLessThan(-0.7);
    expect(state.player.movement.mode).toBe("idle");
    expect(events.since(0).events.filter((event) => event.type === "navigation.completed")).toHaveLength(0);
    expect(events.since(0).events.filter((event) => event.type === "navigation.failed")).toHaveLength(1);
  });
});
