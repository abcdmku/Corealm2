import * as THREE from "three";
import { expect, it } from "vitest";
import { BiomeSky, blendBiomeSky } from "../game/src/render/biomeSky.js";

it("blends sky and haze continuously from normalized organic weights", () => {
  const a = blendBiomeSky({ fallowmarch: 1, kilnhalt: 1 });
  const b = blendBiomeSky({ fallowmarch: .5, kilnhalt: .5 });
  expect(a.horizon.toArray()).toEqual(b.horizon.toArray());
  expect(a.fogFar).toBeCloseTo(.83125);
  expect(blendBiomeSky({ kilnhalt: NaN }).fogFar).toBe(1);
  // The distant range must not extend geometry visibility beyond the residency budget.
  expect(blendBiomeSky({ crownward: 1 }).fogFar).toBe(1);
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

it("configures a world-anchored backdrop without taking ownership of its texture", () => {
  const sky = new BiomeSky();
  expect(sky.snapshot().mountainBackdrop).toMatchObject({ enabled: false, bounds: null });
  const image = new THREE.Texture();
  let disposals = 0;
  image.addEventListener("dispose", () => { disposals++; });
  const bounds = { x: 1600, minZ: -800, width: 2200, baseY: -50, height: 400 };
  sky.setMountainBackdrop(image, bounds);
  bounds.x = 99;
  expect(sky.snapshot().mountainBackdrop).toMatchObject({
    enabled: true, bounds: { x: 1600, minZ: -800, width: 2200, baseY: -50, height: 400 },
  });
  const snapshot = sky.snapshot();
  snapshot.mountainBackdrop.bounds!.width = 1;
  expect(sky.snapshot().mountainBackdrop.bounds!.width).toBe(2200);
  expect(() => sky.setMountainBackdrop(image, { ...bounds, width: 0 })).toThrow(RangeError);
  expect(() => sky.setMountainBackdrop(image, { ...bounds, x: NaN })).toThrow(RangeError);
  expect(sky.snapshot().mountainBackdrop.bounds!.x).toBe(1600);
  sky.setMountainBackdrop(null, bounds);
  expect(sky.snapshot().mountainBackdrop).toMatchObject({ enabled: false, bounds: null });
  expect(disposals).toBe(0);
  sky.setMountainBackdrop(image, bounds);
  sky.dispose();
  expect(disposals).toBe(0);
  image.dispose();
  expect(disposals).toBe(1);
});
