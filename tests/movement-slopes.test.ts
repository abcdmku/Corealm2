import { describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { PLAYER_SLOPES } from "../game/src/app/config.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";

function slopeHeight(angleDegrees: number, downhillAlongX = false): (x: number) => number {
  const gradient = Math.tan(angleDegrees * Math.PI / 180);
  return (x) => (downhillAlongX ? -x : x) * gradient;
}

function movementOn(height: (x: number) => number, navHeightOffset = 0): Movement {
  const nav = {
    closestPoint(point: Vec3): Vec3 {
      return [point[0], height(point[0]) + navHeightOffset, point[2]];
    },
  } as Navigation;
  return new Movement(nav, new EventBus(), {
    heightAt: (_regionId, x) => height(x),
  });
}

function walkFor(movement: Movement, state: ReturnType<typeof createInitialState>, ticks = 12): void {
  movement.setDirectInput({ forward: 0, strafe: 1, cameraYaw: 0 });
  for (let tick = 0; tick < ticks; tick += 1) movement.update(state, 100, tick * 100);
}

describe("directional player slope traversal", () => {
  it("settles a navmesh landing before checking the first uphill step", () => {
    const height = slopeHeight(50);
    const state = createInitialState();
    state.player.position = [0, 1, 0];
    const movement = movementOn(height, 1);
    walkFor(movement, state);
    expect(state.player.position[0]).toBeGreaterThan(2);
    expect(state.player.position[1]).toBeCloseTo(height(state.player.position[0]), 5);
  });
  it("walks uphill on demanding ground below the very-steep limit", () => {
    const state = createInitialState();
    const movement = movementOn(slopeHeight(PLAYER_SLOPES.maxAscentAngle - 4));

    walkFor(movement, state);

    expect(state.player.position[0]).toBeGreaterThan(2);
    expect(state.player.position[1]).toBeGreaterThan(3);
  });

  it("judges the grounded terrain instead of a floating navmesh edge", () => {
    const state = createInitialState();
    const movement = movementOn(slopeHeight(50), 0.7);

    walkFor(movement, state);

    expect(state.player.position[0]).toBeGreaterThan(2);
    expect(state.player.position[1]).toBeGreaterThan(2);
  });

  it("blocks uphill movement once the ground is cliff-like", () => {
    const state = createInitialState();
    const movement = movementOn(slopeHeight(PLAYER_SLOPES.maxAscentAngle + 2));

    walkFor(movement, state);

    expect(state.player.position[0]).toBeLessThan(0.2);
    expect(state.player.position[1]).toBeLessThan(0.5);
  });

  it("walks down steep ground inside the shared navigation limit", () => {
    const state = createInitialState();
    const movement = movementOn(slopeHeight(PLAYER_SLOPES.maxDescentAngle - 2, true));

    walkFor(movement, state);

    expect(state.player.position[0]).toBeGreaterThan(2);
    expect(state.player.position[1]).toBeLessThan(-5);
  });

  it("follows steep downhill click-to-move paths", () => {
    const angle = PLAYER_SLOPES.maxDescentAngle - 2;
    const height = slopeHeight(angle, true);
    const state = createInitialState();
    const movement = movementOn(height);
    const destination: Vec3 = [4, height(4), 0];
    state.player.movement.mode = "path";
    state.player.movement.path = [destination];
    state.player.movement.pathIndex = 0;
    state.player.movement.destination = destination;

    for (let tick = 0; tick < 12; tick += 1) movement.update(state, 100, tick * 100);

    expect(state.player.position[0]).toBeGreaterThan(2);
    expect(state.player.position[1]).toBeLessThan(-5);
  });

  it("does not let click-to-move climb a cliff-like path", () => {
    const angle = PLAYER_SLOPES.maxAscentAngle + 2;
    const height = slopeHeight(angle);
    const state = createInitialState();
    const movement = movementOn(height);
    const destination: Vec3 = [4, height(4), 0];
    state.player.movement.mode = "path";
    state.player.movement.path = [destination];
    state.player.movement.pathIndex = 0;
    state.player.movement.destination = destination;

    for (let tick = 0; tick < 12; tick += 1) movement.update(state, 100, tick * 100);

    expect(state.player.position[0]).toBe(0);
    expect(state.player.position[1]).toBe(0);
  });
});
