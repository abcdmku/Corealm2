import * as THREE from "three";
import { expect, it } from "vitest";
import { BiomeSky, blendBiomeSky } from "../game/src/render/biomeSky.js";

it("blends sky and haze continuously from normalized organic weights", () => {
  const a = blendBiomeSky({ fallowmarch: 1, kilnhalt: 1 });
  const b = blendBiomeSky({ fallowmarch: .5, kilnhalt: .5 });
  expect(a.horizon.toArray()).toEqual(b.horizon.toArray());
  expect(a.fogFar).toBeCloseTo(.83125);
  expect(blendBiomeSky({ kilnhalt: NaN }).fogFar).toBe(1);
});

it("keeps the fog terminal colour identical to the sky horizon while blending and respects draw distance", () => {
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 18, 105);
  const sky = new BiomeSky(); sky.enabled = true; sky.setFogRange(18, 105);
  for (let i = 0; i < 50; i++) {
    sky.update(scene, { kilnhalt: 1 }, 1 / 30);
    const snapshot = sky.snapshot();
    expect(scene.fog.color.getHex()).toBe(snapshot.horizon);
    expect(scene.fog.far).toBeLessThanOrEqual(105);
    expect(scene.fog.near).toBeLessThan(scene.fog.far);
  }
  expect(scene.fog.far).toBeCloseTo(69.5625, 0);
  expect(scene.children).toContain(sky.mesh);
  sky.dispose(); expect(scene.children).not.toContain(sky.mesh);
});
