import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { OrbitCamera } from "../game/src/render/camera.js";
import { StaticCameraQueries } from "../game/src/systems/staticCameraQueries.js";

const PLAYER: Vec3 = [2083, -120, -106];

/** A rendered 1 m lattice: a flat corridor followed by a 1 m-wide, 6–8 m bank. */
function bank(axis: "x" | "z", rise: number) {
  const height = (x: number, z: number) => PLAYER[1]
    + rise * THREE.MathUtils.clamp((axis === "x" ? x - PLAYER[0] : z - PLAYER[2]) - 3, 0, 1);
  const queries = new StaticCameraQueries();
  const heights = new Float32Array(33 * 33);
  for (let col = 0; col <= 32; col++) for (let row = 0; row <= 32; row++) {
    heights[col * 33 + row] = height(PLAYER[0] + col - 16, PLAYER[2] + row - 16) - PLAYER[1];
  }
  queries.addHeightfield({
    ncols: 32, nrows: 32, heights,
    centre: { x: PLAYER[0], y: PLAYER[1], z: PLAYER[2] }, scale: { x: 32, y: 1, z: 32 },
  });
  return { queries, height };
}

function attach(queries: StaticCameraQueries) {
  const view = new THREE.PerspectiveCamera(55, 1.6, 0.1, 280);
  const orbit = new OrbitCamera(view);
  orbit.fixedFollow = true;
  const cast = (from: Vec3, to: Vec3, hardOnly: boolean) => {
    const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    return queries.raycast(from, delta, Math.hypot(...delta), hardOnly);
  };
  orbit.setOcclusionProbe((from, to) => cast(from, to, false));
  orbit.setHardOcclusionProbe((from, to) => cast(from, to, true));
  return { view, orbit };
}

describe("fixed follow terrain clearance", () => {
  it.each([["x", 6], ["z", 8]] as const)("keeps the lens and near plane outside a %s-facing %im bank", (axis, rise) => {
    const { queries, height } = bank(axis, rise);
    const { view, orbit } = attach(queries);
    const yaw = axis === "x" ? Math.PI / 2 : 0;
    orbit.setPose(yaw, 0.55, 11);
    orbit.update(...PLAYER, true);

    const state = orbit.snapshot();
    expect(state.occluded).toBe(true);
    expect(state.distance).toBeGreaterThan(2);
    expect(state.distance).toBeLessThan(4);
    expect(state.requestedDistance).toBe(11);
    expect(state.effectivePitch).toBe(0.55);
    expect(state.effectiveYaw).toBeCloseTo(yaw, 3);
    expect(state.target).toEqual({ x: PLAYER[0], y: PLAYER[1] + 1.1, z: PLAYER[2] });
    expect(view.position.y - height(view.position.x, view.position.z)).toBeGreaterThan(0.1);
    view.updateMatrixWorld(true);
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const corner = new THREE.Vector3(x, y, -1).unproject(view);
      expect(corner.y - height(corner.x, corner.z)).toBeGreaterThan(0.1);
    }
    const focus: Vec3 = [state.target.x, state.target.y, state.target.z];
    const delta: Vec3 = [view.position.x - focus[0], view.position.y - focus[1], view.position.z - focus[2]];
    expect(queries.raycast(focus, delta, Math.hypot(...delta), true)).toBeNull();

    // Ordinary orbit away from the bank restores the player's distance without lifting focus.
    orbit.rotate(Math.PI, 0);
    orbit.update(...PLAYER, true);
    expect(orbit.snapshot().distance).toBe(11);
    expect(orbit.snapshot().occluded).toBe(false);
    expect(orbit.snapshot().effectivePitch).toBe(0.55);
    expect(orbit.snapshot().target).toEqual(state.target);
  });

  it("keeps terrain hard while cutaway building geometry stays out of the fixed-follow cast", () => {
    const { queries } = bank("z", 8);
    const origin: Vec3 = [PLAYER[0], PLAYER[1] + 2, PLAYER[2]];
    queries.addStaticBox([PLAYER[0], PLAYER[1] + 2, PLAYER[2] + 1], [1, 1, 0.25], 0, "roof");
    expect(queries.raycast(origin, [0, 0, 1], 11)).toBe(0.75);
    expect(queries.raycast(origin, [0, 0, 1], 11, true)).toBe(3.25);
    queries.setHiddenEntities(new Set(["roof"]), new Map([["roof", PLAYER[1]]]));
    expect(queries.raycast(origin, [0, 0, 1], 11, true)).toBe(3.25);
  });
});
