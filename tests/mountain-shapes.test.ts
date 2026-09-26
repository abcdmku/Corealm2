import { describe, expect, it } from "vitest";
import { MOUNTAIN_MASSIF_VARIANTS, sampleMountainMassif } from "../game/src/world/mountainShapes.js";

describe("authored alpine landforms", () => {
  it("has independent ridge networks with a jagged crest, broad divided massif and lower shoulder", () => {
    const [high, broad, eroded] = MOUNTAIN_MASSIF_VARIANTS;
    expect(high!.ridges).not.toEqual(broad!.ridges);
    expect(broad!.ridges).not.toEqual(eroded!.ridges);
    const [highX, highZ] = high!.summits[0]!;
    expect(sampleMountainMassif(highX, highZ, 0)).toBeGreaterThan(.94);
    for (const index of [0, 3]) {
      const [x, z] = broad!.summits[index]!;
      expect(sampleMountainMassif(x, z, 1)).toBeGreaterThan(.85);
    }
    const [passX, passZ] = broad!.summits[2]!;
    expect(sampleMountainMassif(passX, passZ, 1)).toBeLessThan(.56);
    expect(Math.max(...eroded!.summits.map(p => p[2]))).toBe(.72);

    const census = [0, 1, 2].map(variant => {
      let highArea = 0, middleArea = 0, gentleFaces = 0;
      for (let x = -.9; x < .9; x += .025) for (let z = -.9; z < .9; z += .025) {
        const h = sampleMountainMassif(x, z, variant);
        if (h > .65) highArea++;
        if (h > .3) middleArea++;
        if (h <= .25 || h >= .8) continue;
        const slope = Math.hypot(
          sampleMountainMassif(x + .01, z, variant) - sampleMountainMassif(x - .01, z, variant),
          sampleMountainMassif(x, z + .01, variant) - sampleMountainMassif(x, z - .01, variant),
        ) / .02;
        if (slope < 1.5) gentleFaces++;
      }
      return { highArea, middleArea, gentleFaces };
    });
    expect(census[1]!.highArea).toBeGreaterThan(census[0]!.highArea * 1.3);
    expect(census[1]!.middleArea).toBeGreaterThan(census[0]!.middleArea * 1.3);
    expect(census[2]!.highArea).toBeLessThan(census[0]!.highArea * .3);
    expect(census[2]!.gentleFaces).toBeGreaterThan(census[0]!.gentleFaces * 1.6);
  });

  it("keeps connected descending ridges across all three independent graphs", () => {
    for (let variant = 0; variant < 3; variant++) {
      const shape = MOUNTAIN_MASSIF_VARIANTS[variant]!;
      for (const [ia, ib] of shape.ridges) {
        const a = shape.summits[ia]!, b = shape.summits[ib]!;
        if (Math.min(a[2], b[2]) < .15) continue;
        const middle = sampleMountainMassif((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, variant);
        expect(middle).toBeGreaterThan(Math.min(a[2], b[2]) * .85);
      }
    }
  });

  it("has finite deterministic relief and a continuous zero perimeter", () => {
    for (let variant = 0; variant < 3; variant++) {
      for (let ix = -16; ix <= 16; ix++) for (let iz = -16; iz <= 16; iz++) {
        const x = ix / 20, z = iz / 20, height = sampleMountainMassif(x, z, variant);
        expect(Number.isFinite(height)).toBe(true);
        expect(height).toBe(sampleMountainMassif(x, z, variant));
        expect(height).toBeGreaterThanOrEqual(0);
        expect(height).toBeLessThanOrEqual(variant === 2 ? .80 : 1);
      }
      for (const edge of [-1, 1]) for (const along of [-.8, 0, .8]) {
        expect(sampleMountainMassif(edge, along, variant)).toBe(0);
        expect(sampleMountainMassif(along, edge, variant)).toBe(0);
      }
      expect(sampleMountainMassif(.995, .2, variant)).toBeLessThan(.005);
    }
    expect(sampleMountainMassif(NaN, 0)).toBe(0);
    expect(sampleMountainMassif(0, Infinity)).toBe(0);
  });
});
