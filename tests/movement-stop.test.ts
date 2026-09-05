import { describe, expect, it } from "vitest";
import { MOVEMENT } from "../game/src/app/config.js";
import type { Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { pathLength } from "../game/src/core/math.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement, type MovementSpeedFields } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";

function running(mode: "path" | "direct" = "path") {
  const state = createInitialState();
  state.player.position = [0, 0, 0];
  const nav = {
    closestPoint: (point: Vec3) => point,
    findPathDetailed: (from: Vec3, to: Vec3) => ({ path: [from, to], partial: false, arrivalGap: 0 }),
    etaMs: (path: Vec3[]) => pathLength(path) / MOVEMENT.runSpeed * 1000,
  } as unknown as Navigation;
  const events = new EventBus();
  const movement = new Movement(nav, events);
  if (mode === "path") expect(movement.startPath(state, [20, 0, 0], null, 0)).not.toBeNull();
  else movement.setDirectInput({ forward: 1, strafe: 0, cameraYaw: 0 });
  for (let tick = 1; tick <= 4; tick++) movement.update(state, 100, tick * 100);
  expect(movement.getSpeedMps()).toBeGreaterThan(MOVEMENT.walkPoseThreshold);
  expect(movement.getGait()).toBe("run");
  return { state, movement, events };
}

function expectHalted(h: ReturnType<typeof running>) {
  expect(h.movement.getSpeedMps()).toBe(0);
  expect(h.movement.getGait()).toBe("idle");
  const published = h.state.player.movement as typeof h.state.player.movement & MovementSpeedFields;
  expect(published.speed).toBe(0);
  expect(published.gait).toBe("idle");
}

describe("explicit movement cancellation", () => {
  it.each(["path", "direct"] as const)("publishes an idle pose synchronously after stopping %s movement", (mode) => {
    const h = running(mode);
    const position = [...h.state.player.position];
    expect(h.movement.stop(h.state, 400)).toBe(true);
    // No update or event flush: a portal fade can pause the simulation at this exact point.
    expectHalted(h);
    expect(h.state.player.movement.mode).toBe("idle");
    expect(h.state.player.position).toEqual(position);
  });

  it("resets the old velocity before a replacement path begins", () => {
    const h = running();
    expect(h.movement.startPath(h.state, [0, 0, 20], null, 400)).not.toBeNull();
    expectHalted(h);
    h.movement.update(h.state, 100, 500);
    expect(h.movement.getSpeedMps()).toBeLessThanOrEqual(MOVEMENT.accelMps2 * 0.1 + 1e-6);
    h.events.flush();
    expect(h.events.since(0, ["navigation.failed"]).events).toEqual([]);
  });
});
