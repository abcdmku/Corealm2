import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMERA } from "../game/src/app/config.js";
import { OrbitCamera } from "../game/src/render/camera.js";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const view = new THREE.PerspectiveCamera(CAMERA.fov, 1.6, CAMERA.near, CAMERA.far);
  const orbit = new OrbitCamera(view);
  return { view, orbit, advance: () => { now += 1000 / 60; } };
}

describe("camera relocation recovery", () => {
  it("frames the whole player on the first update after a distant respawn", () => {
    const { view, orbit, advance } = fixture();
    orbit.update(-160, 1, -118, true);
    advance();
    orbit.update(144, 27.08, -66);

    expect(orbit.snapshot().target).toEqual({ x: 144, y: 28.18, z: -66 });
    view.updateMatrixWorld(true);
    for (const height of [0, 1.8]) {
      const projected = new THREE.Vector3(144, 27.08 + height, -66).project(view);
      expect(Math.abs(projected.x)).toBeLessThan(0.9);
      expect(Math.abs(projected.y)).toBeLessThan(0.9);
      expect(projected.z).toBeGreaterThan(-1);
      expect(projected.z).toBeLessThan(1);
    }
  });

  it("resolves the destination wall immediately instead of easing through it", () => {
    const { orbit, advance } = fixture();
    orbit.setOcclusionProbe((from) => from[0] > 500 ? 4 : null);
    orbit.update(0, 0, 0, true);
    advance();
    orbit.update(1000, 0, 1000);

    expect(orbit.snapshot().distance).toBeLessThanOrEqual(3.55);
    expect(orbit.snapshot().distance).toBeGreaterThan(0);
    expect(orbit.snapshot().occluded).toBe(true);
  });

  it("discards the previous location's obstruction hold and preserves the chosen orbit", () => {
    const { orbit, advance } = fixture();
    orbit.setPose(1.2, 0.4, 9);
    orbit.setOcclusionProbe((from) => from[0] < 500 ? 4 : null);
    orbit.update(0, 0, 0, true);
    for (let index = 0; index < 20; index++) {
      advance();
      orbit.update(0, 0, 0);
    }
    advance();
    orbit.update(1000, 0, 1000);

    expect(orbit.snapshot()).toMatchObject({
      yaw: 1.2, pitch: 0.4, effectivePitch: 0.4, distance: 9, occluded: false,
    });
  });

  it("keeps normal walking and terrace height changes smoothed", () => {
    const { orbit, advance } = fixture();
    orbit.update(1000, 0, 1000, true);
    advance();
    orbit.update(1000.1, 1, 1000);
    expect(orbit.snapshot().target.x).toBeGreaterThan(1000);
    expect(orbit.snapshot().target.x).toBeLessThan(1000.1);
    expect(orbit.snapshot().target.y).toBeGreaterThan(1.1);
    expect(orbit.snapshot().target.y).toBeLessThan(2.1);
  });

  it("does not reattach a free inspection camera when the player relocates", () => {
    const { orbit, advance } = fixture();
    orbit.setFreeTarget([1000, 3, 1000]);
    orbit.update(0, 0, 0, true);
    advance();
    orbit.update(144, 27.08, -66);
    expect(orbit.snapshot()).toMatchObject({
      freeMove: true, target: { x: 1000, y: 4.1, z: 1000 },
    });
  });

  it("starts inside the available clearance even without an explicit initial snap", () => {
    const { orbit } = fixture();
    orbit.setOcclusionProbe(() => 4);
    orbit.update(1000, 0, 1000);
    expect(orbit.snapshot().distance).toBeLessThanOrEqual(3.55);
    expect(orbit.snapshot().distance).toBeGreaterThan(0);
  });
});
