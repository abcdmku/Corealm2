import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrbitCamera } from "../game/src/render/camera.js";
import { StaticCameraQueries } from "../game/src/systems/staticCameraQueries.js";
import { ROOTFALL } from "../game/src/content/settlements/rootfall.js";
import { prefabCollision } from "../game/src/render/buildings.js";
import type { Vec3 } from "../game/src/contracts.js";

afterEach(() => vi.restoreAllMocks());

function rootfallQuery() {
  const query = new StaticCameraQueries();
  for (const building of ROOTFALL.buildings) {
    const c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
    for (const box of prefabCollision(building.prefab, building.footprint)) {
      query.addStaticBox([
        building.position[0] + box.dx * c + box.dz * s,
        8.287 + box.height / 2,
        building.position[1] - box.dx * s + box.dz * c,
      ], [box.sizeX / 2, box.height / 2, box.sizeZ / 2], building.rotationY);
    }
  }
  return query;
}

describe("camera obstruction recovery", () => {
  it.each([
    ["real Rootfall stair descent", [68.443, 8.287, 128.443]],
    ["normal Rootfall bank arrival", [60.289, 8.287, 127.219]],
  ] as const)("finds a full-avatar seat at %s without redirecting movement", (_name, position) => {
    const query = rootfallQuery();
    const view = new THREE.PerspectiveCamera(55, 1.6, 0.1, 280);
    const orbit = new OrbitCamera(view);
    orbit.setPose(Math.PI / 4, 0.45, 10);
    orbit.setOcclusionProbe((from, to) => {
      const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      return query.raycast(from, direction, Math.hypot(...direction));
    });
    orbit.update(position[0], position[1], position[2], true);
    expect(orbit.yaw).toBe(Math.PI / 4);
    const state = orbit.snapshot();
    expect(state.effectiveYaw).not.toBe(state.yaw);
    expect(state.distance).toBeGreaterThanOrEqual(6);
    view.updateMatrixWorld(true);
    for (const height of [0, 2.1]) {
      const point = new THREE.Vector3(position[0], position[1] + height, position[2]).project(view);
      expect(Math.abs(point.x)).toBeLessThan(0.9);
      expect(Math.abs(point.y)).toBeLessThan(0.9);
    }
    const from: Vec3 = [state.target.x, state.target.y, state.target.z];
    const delta: Vec3 = [view.position.x - from[0], view.position.y - from[1], view.position.z - from[2]];
    expect(query.raycast(from, delta, Math.hypot(...delta))).toBeNull();
  });

  it("never forces the lens past a close wall to preserve the old 2.6m minimum", () => {
    const orbit = new OrbitCamera(new THREE.PerspectiveCamera());
    orbit.setOcclusionProbe(() => 1);
    orbit.update(1000, 0, 1000, true);
    expect(orbit.snapshot().distance).toBeLessThanOrEqual(0.55);
    expect(orbit.snapshot().distance).toBeGreaterThan(0);
  });

  it("keeps the lens before even an offset hit closer than the camera padding", () => {
    const orbit = new OrbitCamera(new THREE.PerspectiveCamera());
    orbit.setOcclusionProbe(() => 0.2);
    orbit.update(1000, 0, 1000, true);
    expect(orbit.snapshot().distance).toBeLessThanOrEqual(0.1);
    expect(orbit.snapshot().distance).toBeGreaterThan(0);
  });

  it("validates the interpolated pitch before placing the lens", () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const orbit = new OrbitCamera(new THREE.PerspectiveCamera());
    orbit.setPose(0, 0.45, 10);
    orbit.update(1000, 0, 1000, true);
    orbit.setOcclusionProbe((from, to) => {
      const pitch = Math.atan2(to[1] - from[1], Math.hypot(to[0] - from[0], to[2] - from[2]));
      return pitch >= 0.56 ? null : 4;
    });
    now += 1000 / 60;
    orbit.update(1000, 0, 1000);
    const state = orbit.snapshot();
    expect(state.effectivePitch).toBeGreaterThan(0.45);
    expect(state.effectivePitch).toBeLessThan(0.56);
    expect(state.distance).toBe(3.55);
    expect(state.occluded).toBe(true);
  });

  it("checks boots and head against an eave even when the focus ray clears it", () => {
    const query = new StaticCameraQueries();
    query.addStaticBox([-8, 2.855, 11.5], [2.2, 0.175, 1.25], 0);
    const view = new THREE.PerspectiveCamera(55, 1.6, 0.1, 280);
    const orbit = new OrbitCamera(view);
    orbit.setPose(Math.PI, 0.45, 10);
    orbit.setOcclusionProbe((from, to) => {
      const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      return query.raycast(from, delta, Math.hypot(...delta));
    });
    orbit.update(-8, 0, 15.5, true);
    for (const height of [0.15, 1.1, 2.05]) {
      const from: Vec3 = [-8, height, 15.5];
      const delta: Vec3 = [view.position.x + 8, view.position.y - height, view.position.z - 15.5];
      expect(query.raycast(from, delta, Math.hypot(...delta))).toBeNull();
    }
  });

  it("recovers toward a farther partial obstruction instead of refreshing its hold forever", () => {
    let now = 100, wallDistance = 2;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const orbit = new OrbitCamera(new THREE.PerspectiveCamera());
    orbit.setPose(0, 0.45, 10);
    orbit.setOcclusionProbe(() => wallDistance);
    orbit.update(1000, 0, 1000, true);
    for (let frame = 0; frame < 20; frame++) {
      now += 1000 / 60;
      orbit.update(1000, 0, 1000);
    }
    const near = orbit.snapshot().distance;
    wallDistance = 7;
    for (let frame = 0; frame < 60; frame++) {
      now += 1000 / 60;
      orbit.update(1000, 0, 1000);
    }
    expect(orbit.snapshot().distance).toBeGreaterThan(near + 3);
    expect(orbit.snapshot().distance).toBeLessThan(7);
    expect(orbit.snapshot().occluded).toBe(true);
  });
});
