import { describe, expect, it } from "vitest";
import { WORLD_MAP_IMAGE_BOUNDS } from "../game/src/generated/worldMapFingerprint.js";
import { IMAGE_BOX, boxFraction, cropPosition, onDrawnMap, zAtFraction, type MapBox } from "../devdocs/src/model/worldMap.js";

/*
  The map image is north-up, so a place with a bigger z belongs nearer the top of the box. Reading
  z as a distance down from the top instead put every thumbnail crop and every pin on the mirror
  of its real spot — a farm at z = -72 drew over the ashlands at z = 822 — and it read as plausible
  terrain, so nothing caught it. These hold the sense of the flip.
*/

const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;

describe("world map projection", () => {
  it("puts north at the top and east at the right", () => {
    const box: MapBox = { x0: 0, z0: 0, spanX: 100, spanZ: 100 };
    expect(boxFraction(box, 50, 100)).toEqual({ u: 0.5, v: 0 });
    expect(boxFraction(box, 50, 0)).toEqual({ u: 0.5, v: 1 });
    expect(boxFraction(box, 100, 50)).toEqual({ u: 1, v: 0.5 });
    expect(boxFraction(box, 0, 50)).toEqual({ u: 0, v: 0.5 });
  });

  it("reads a fraction back to the z it came from", () => {
    const box: MapBox = { x0: -650, z0: -142, spanX: 320, spanZ: 140 };
    for (const z of [-142, -72, -2]) expect(zAtFraction(box, boxFraction(box, 0, z).v)).toBeCloseTo(z, 9);
  });

  it("spans the whole drawn map", () => {
    expect(IMAGE_BOX).toEqual({ x0: minX, z0: minZ, spanX: maxX - minX, spanZ: maxZ - minZ });
    expect(boxFraction(IMAGE_BOX, minX, maxZ)).toEqual({ u: 0, v: 0 });
    expect(boxFraction(IMAGE_BOX, maxX, minZ)).toEqual({ u: 1, v: 1 });
  });

  it("offsets a crop by its share of the leftover image", () => {
    // Millfield's warden stands at z = -72, well south of the middle: the crop sits low in the image.
    const crop: MapBox = { x0: -319.4, z0: -142, spanX: 320, spanZ: 140 };
    expect(cropPosition(crop).u).toBeCloseTo((crop.x0 - minX) / (IMAGE_BOX.spanX - crop.spanX), 9);
    expect(cropPosition(crop).v).toBeCloseTo((maxZ - (crop.z0 + crop.spanZ)) / (IMAGE_BOX.spanZ - crop.spanZ), 9);
    expect(cropPosition(crop).v).toBeGreaterThan(0.5);
    // A crop of the whole image has no leftover to divide.
    expect(cropPosition(IMAGE_BOX)).toEqual({ u: 0, v: 0 });
  });

  it("knows what the drawn map covers", () => {
    expect(onDrawnMap(0, 0)).toBe(true);
    expect(onDrawnMap(minX, maxZ)).toBe(true);
    // The fey realms sit east of the island and have no drawn map.
    expect(onDrawnMap(2300, 139)).toBe(false);
  });
});
