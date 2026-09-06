import { describe, expect, it } from "vitest";
import { BIOME_LOOKS, blendBiomeLook } from "../game/src/render/biomeAtmosphere.js";

describe("biome atmosphere blending", () => {
  it("keeps absent and invalid field samples neutral", () => {
    expect(blendBiomeLook({})).toEqual({ tint: [1, 1, 1], shade: [1, 1, 1], saturation: 1 });
    expect(blendBiomeLook({ fallowmarch: NaN, vellenwood: -1 })).toEqual(blendBiomeLook({}));
  });
  it("blends competing visual fields independently of weight scale", () => {
    const mixed = blendBiomeLook({ fallowmarch: 0.5, karrowmoor: 0.5 });
    const scaled = blendBiomeLook({ fallowmarch: 5, karrowmoor: 5 });
    expect(mixed.saturation).toBeCloseTo(scaled.saturation);
    for (const key of ["tint", "shade"] as const) {
      for (let i = 0; i < 3; i++) expect(mixed[key][i]).toBeCloseTo(scaled[key][i]!);
    }
    expect(mixed.saturation).toBeCloseTo((BIOME_LOOKS.fallowmarch.saturation + BIOME_LOOKS.karrowmoor.saturation) / 2);
    expect(mixed.tint[2]).toBeCloseTo((BIOME_LOOKS.fallowmarch.tint[2] + BIOME_LOOKS.karrowmoor.tint[2]) / 2);
  });
  it("has no discontinuity across a visual winner change", () => {
    const a = blendBiomeLook({ vellenwood: 0.499, kilnhalt: 0.501 });
    const b = blendBiomeLook({ vellenwood: 0.501, kilnhalt: 0.499 });
    expect(Math.abs(a.saturation - b.saturation)).toBeLessThan(0.001);
    for (let i = 0; i < 3; i++) expect(Math.abs(a.tint[i]! - b.tint[i]!)).toBeLessThan(0.001);
  });
});
