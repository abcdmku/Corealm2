import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { blendBiomeLook } from "../game/src/render/biomeAtmosphere.js";
import { BiomeSky, blendBiomeSky } from "../game/src/render/biomeSky.js";

describe("fairy map atmosphere", () => {
  it("keeps Crownward daylight and both fairy skies independent of Wilderness magic", () => {
    const surface = blendBiomeSky({ crownward: 1 });
    expect(surface.night).toBe(0);
    expect(surface.underground).toBe(0);
    expect(surface.fogFar).toBe(1);
    for (const id of ["gloamgarden", "faeholme"] as const) {
      const fairy = blendBiomeSky({ [id]: 1 });
      const withWildernessMagic = blendBiomeSky({ [id]: 1 }, 1);
      expect(fairy.night).toBe(1);
      expect(fairy.underground).toBe(1);
      expect(fairy.magic).toBe(0);
      expect(withWildernessMagic).toEqual(fairy);
      expect(blendBiomeLook({ [id]: 1 }, 1)).toEqual(blendBiomeLook({ [id]: 1 }));
    }
  });

  it("blends the T30 and T60 palettes continuously without changing the map's sky mode", () => {
    const turquoise = blendBiomeSky({ gloamgarden: 1 });
    const purple = blendBiomeSky({ faeholme: 1 });
    const mixed = blendBiomeSky({ gloamgarden: 3, faeholme: 1 });
    expect(turquoise.horizon.g).toBeGreaterThan(turquoise.horizon.r);
    expect(purple.horizon.b).toBeGreaterThan(purple.horizon.g);
    expect(mixed.underground).toBe(1);
    expect(mixed.fairyDepth).toBe(.25);
    expect(mixed.horizon.toArray()).toEqual(turquoise.horizon.clone().multiplyScalar(.75).add(purple.horizon.clone().multiplyScalar(.25)).toArray());
    expect(blendBiomeSky({ gloamgarden: NaN, faeholme: -1, wilderness: Infinity })).toEqual(blendBiomeSky({}));
  });

  it("preserves horizon fog and clears the underground blend when returning to Crownward", () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 26, 210);
    const sky = new BiomeSky();
    sky.enabled = true;
    for (let i = 0; i < 50; i++) sky.update(scene, { faeholme: 1 }, .1);
    expect(sky.undergroundAmount).toBeGreaterThan(.99);
    expect(sky.fairyDepthAmount).toBeGreaterThan(.99);
    expect(scene.fog.color.getHex()).toBe(sky.snapshot().horizon);
    expect(scene.fog.far).toBeGreaterThan(170);
    for (let i = 0; i < 50; i++) sky.update(scene, { crownward: 1 }, .1);
    expect(sky.undergroundAmount).toBeLessThan(.001);
    expect(sky.nightAmount).toBeLessThan(.001);
    expect(scene.fog.color.getHex()).toBe(sky.snapshot().horizon);
    sky.dispose();
    expect(scene.children).not.toContain(sky.mesh);
  });
});
