import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FoliageOcclusion, foliageRevealBounds } from "../game/src/render/foliageOcclusion.js";

function contains(bounds: THREE.Vector4, x: number, y: number): boolean {
  return x >= bounds.x && y >= bounds.y && x <= bounds.z && y <= bounds.w;
}

function verifyCircleEnvelope(foot: THREE.Vector4, head: THREE.Vector4): void {
  const bounds = foliageRevealBounds(foot, head, new THREE.Vector4());
  // Simulate uploaded float32 uniforms. The shader's dither shrinks this envelope further.
  const rounded = new THREE.Vector4(...bounds.toArray().map(Math.fround) as [number, number, number, number]);
  for (let step = 0; step <= 40; step++) {
    const t = step / 40;
    const x = THREE.MathUtils.lerp(Math.fround(foot.x), Math.fround(head.x), t);
    const y = THREE.MathUtils.lerp(Math.fround(foot.y), Math.fround(head.y), t);
    const radius = THREE.MathUtils.lerp(Math.fround(foot.w), Math.fround(head.w), t);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 24) {
      expect(contains(rounded, x + radius * Math.cos(angle), y + radius * Math.sin(angle))).toBe(true);
    }
  }
}

describe("conservative foliage reveal bounds", () => {
  it("contains the complete variable-radius capsule including diagonal, offscreen and degenerate segments", () => {
    for (const [foot, head] of [
      [[600, 250, 10, 35], [600, 330, 10, 35]],
      [[-800, -400, .2, 800], [1600, 1100, 30, 10]],
      [[60, 60, 2, 0], [60, 60, 2, 30]],
      [[-1e7, 1e7, .101, 1e5], [1e7, -1e7, .102, 1e6]],
    ] as const) verifyCircleEnvelope(new THREE.Vector4(...foot), new THREE.Vector4(...head));
  });

  it("preserves the projected reveal envelope across aspect ratios, roll and near-clip distances", () => {
    for (const size of [[320, 1600], [1440, 900], [3840, 1080]]) {
      for (const distance of [.101, .5, 10, 100]) {
        const camera = new THREE.PerspectiveCamera(50, size[0]! / size[1]!, .1, 200);
        camera.position.set(0, 1, distance);
        camera.lookAt(0, 1, 0);
        camera.rotateZ(.7);
        camera.updateMatrixWorld();
        const state = new FoliageOcclusion();
        state.update(camera, new THREE.Vector3(), new THREE.Vector2(...size));
        expect(state.enabled).toBe(true);
        verifyCircleEnvelope(state.uniforms.uCorealmFoliageRevealFoot.value, state.uniforms.uCorealmFoliageRevealHead.value);
      }
    }
  });

  it("leaves the optimization off by default and does not change the inner reveal uniforms when toggled", () => {
    const state = new FoliageOcclusion();
    expect(state.snapshot().boundsOptimization).toBe(false);
    const before = state.snapshot();
    state.setBoundsOptimization(true);
    expect(state.snapshot()).toEqual({ ...before, boundsOptimization: true });
    state.setBoundsOptimization(false);
    expect(state.snapshot()).toEqual(before);
  });
});
