import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { worldToMap, mapToWorld, mapFacing } from "../game/src/world/mapOrientation.js";
import { WORLD_MAP_IMAGE_BOUNDS } from "../game/src/generated/worldMapFingerprint.js";
import { IMAGE_BOX, boxFraction, cropPosition, onDrawnMap, xAtFraction, zAtFraction, type MapBox } from "../devdocs/src/model/worldMap.js";
import { scatteredOffsets } from "../devdocs/src/workspaces/world/model.js";
import type { WorldPlacement } from "../game/src/content/schema/encounters.js";
import terrainRows from "../game/content/data/worldTerrain.json";
import regionRows from "../game/content/data/worldRegions.json";
import { WorldTerrainSchema } from "../game/src/content/schema/worldTerrain.js";
import { parseCollection } from "../game/src/content/schema/core.js";
import { regionBoundaryGeometry } from "../game/src/content/terrainBoundaries.js";

/*
  The map image is north-up, so a place with a bigger z belongs nearer the top of the box. Reading
  z as a distance down from the top instead put every thumbnail crop and every pin on the mirror
  of its real spot — a farm at z = -72 drew over the ashlands at z = 822 — and it read as plausible
  terrain, so nothing caught it. These hold the sense of the flip.
*/

const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;

describe("world map projection", () => {
  it("matches a north-facing gameplay camera and round-trips both axes", () => {
    const camera = new PerspectiveCamera(60, 1, .1, 1000);
    camera.position.set(0, 20, -20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const [x, z] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const screen = new Vector3(x, 0, z).project(camera);
      const map = worldToMap(x!, z!);
      if (x) expect(Math.sign(map.u)).toBe(Math.sign(screen.x));
      if (z) expect(Math.sign(map.v)).toBe(-Math.sign(screen.y));
      expect(mapToWorld(map.u, map.v)).toEqual({ x, z });
      const facing = mapFacing(Math.atan2(x!, z!));
      expect(Math.sin(facing)).toBeCloseTo(map.u / 4);
      expect(-Math.cos(facing)).toBeCloseTo(map.v / 4);
    }
  });
  it("includes coastal land in full region extents and derives editable boundary bands", () => {
    const terrains = parseCollection(WorldTerrainSchema, terrainRows, { name: 'worldTerrain' });
    const regions = regionRows as unknown as { id: string; bounds: { min: [number, number]; max: [number, number] } }[];
    const highlands = regions.find(row => row.id === 'karrowmoor')!;
    const geometry = regionBoundaryGeometry(highlands, regions, terrains);
    expect(geometry.full).toEqual({ minX: -20, maxX: 350, minZ: -390, maxZ: 10 });
    expect(geometry.bands.map(row => row.edge)).toEqual(['south']);
    const forest = regionBoundaryGeometry(regions.find(row => row.id === 'vellenwood')!, regions, terrains);
    expect(forest.bands).toEqual([]);
    const crownward = regions.find(row => row.id === 'crownward')!;
    expect(regionBoundaryGeometry(crownward, regions, terrains).full.maxX).toBe(910);
    expect(regionBoundaryGeometry(crownward, regions, terrains).bands.find(row => row.kind === 'mountain')?.bounds).toEqual({ minX: 660, maxX: 860, minZ: -200, maxZ: 460 });
    terrains[0]!.coast.shoreline = [terrains[0]!.coast.shoreline[0], 200];
    terrains[0]!.mountains[0]!.width = 210;
    expect(regionBoundaryGeometry(highlands, regions, terrains).full.minZ).toBe(-400);
    expect(regionBoundaryGeometry(crownward, regions, terrains).bands.find(row => row.kind === 'mountain')?.bounds.maxX).toBe(870);
    const fairy = regions.find(row => row.id === 'gloamgarden')!;
    expect(regionBoundaryGeometry(fairy, regions, terrains).bands).toEqual([]);
  });
  it("scatters the authored count inside the circle and keeps saved positions stable", () => {
    const placement: WorldPlacement = { id: "scatter_test", encounterId: "test", regionId: "fallowmarch", centre: [100, -100], count: 32, radius: 24, formation: { kind: "authored", spacing: 3, rotation: 0 }, dressing: [] };
    const offsets = scatteredOffsets(placement);
    expect(offsets.map(row => row.index)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(new Set(offsets.map(row => row.offset.join(","))).size).toBe(32);
    expect(offsets.every(row => Math.hypot(...row.offset) <= placement.radius - 1.5)).toBe(true);
    expect(scatteredOffsets(placement)).toEqual(offsets);
    expect(scatteredOffsets({ ...placement, centre: [0, 0] })).toEqual(offsets);
    expect(scatteredOffsets(placement, 42)).not.toEqual(offsets);
    const expanded = scatteredOffsets({ ...placement, count: 36, anchorAdjustments: offsets });
    expect(expanded.slice(0, 32)).toEqual(offsets);
    expect(expanded.slice(32)).toHaveLength(4);
    expect(expanded.slice(32).every(row => Math.hypot(...row.offset) <= placement.radius)).toBe(true);
    expect(scatteredOffsets({ ...placement, count: 2, anchorAdjustments: expanded })).toEqual(offsets.slice(0, 2));
    expect(scatteredOffsets({ ...placement, radius: 40, anchorAdjustments: offsets })).toEqual(offsets);
    for (const count of [1, 2, 64]) for (const radius of [.01, 1, 12]) {
      const resized = scatteredOffsets({ ...placement, count, radius });
      expect(resized).toHaveLength(count);
      expect(resized.every(row => Math.hypot(...row.offset) <= radius)).toBe(true);
    }
  });

  it("matches gameplay with +Z up and +X left", () => {
    const box: MapBox = { x0: 0, z0: 0, spanX: 100, spanZ: 100 };
    expect(boxFraction(box, 50, 100)).toEqual({ u: 0.5, v: 0 });
    expect(boxFraction(box, 50, 0)).toEqual({ u: 0.5, v: 1 });
    expect(boxFraction(box, 100, 50)).toEqual({ u: 0, v: 0.5 });
    expect(boxFraction(box, 0, 50)).toEqual({ u: 1, v: 0.5 });
  });

  it("reads screen fractions back to both world coordinates", () => {
    const box: MapBox = { x0: -650, z0: -142, spanX: 320, spanZ: 140 };
    for (const x of [-650, -490, -330]) expect(xAtFraction(box, boxFraction(box, x, 0).u)).toBeCloseTo(x, 9);
    for (const z of [-142, -72, -2]) expect(zAtFraction(box, boxFraction(box, 0, z).v)).toBeCloseTo(z, 9);
  });

  it("spans the whole drawn map", () => {
    expect(IMAGE_BOX).toEqual({ x0: minX, z0: minZ, spanX: maxX - minX, spanZ: maxZ - minZ });
    expect(boxFraction(IMAGE_BOX, minX, maxZ)).toEqual({ u: 1, v: 0 });
    expect(boxFraction(IMAGE_BOX, maxX, minZ)).toEqual({ u: 0, v: 1 });
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
