import { describe, expect, it, vi } from "vitest";
import { Scene } from "three";
import { fishingAccessPositions } from "../game/src/app/fishingAccess.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { WORLD_SITES, type WorldSite } from "../game/src/content/worldSites.js";
import type { Vec3 } from "../game/src/contracts.js";
import { WorldScene } from "../game/src/render/scene.js";
import { WATER_FILL_DEPTH } from "../game/src/world/waterBodies.js";

type WaterBody = Parameters<typeof fishingAccessPositions>[1][number];

function fishery(overrides: Partial<WorldSite> = {}): WorldSite {
  return {
    id: "test_fishery",
    locationId: "test_landing",
    regionId: "fallowmarch",
    centre: [0, 0],
    rotationY: 0,
    kind: "fishery",
    workRadius: 4,
    extent: [12, 12],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [{ clusterId: "test_pool", index: 7, x: 0, z: -2, yaw: 0, scale: 1 }],
    dressing: [],
    ...overrides,
  };
}

function rectangle(
  id: string, minX: number, minZ: number, maxX: number, maxZ: number, level = 0,
): WaterBody {
  return { id, level, contour: [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]] };
}

function position(positions: Map<string, Vec3>, id: string): Vec3 {
  expect(positions.has(id), `Missing access position ${id}`).toBe(true);
  return positions.get(id)!;
}

describe("fishing access positions", () => {
  it("uses the referenced solved shoreline instead of the site's nominal radius or body order", () => {
    const site = fishery();
    const pool: WaterBody = {
      id: "test_pool",
      level: 1,
      contour: [[-8, -6], [9, -6], [9, 8], [3, 8], [3, 36], [-3, 36], [-3, 12], [-8, 12]],
    };
    const unrelated = rectangle(site.id, 200, 200, 220, 220);
    const positions = fishingAccessPositions([site], [unrelated, pool], () => 2);

    expect([...positions.keys()].sort()).toEqual(["test_landing", "test_pool_7"]);
    for (const point of positions.values()) {
      expect(point[0]).toBeCloseTo(0, 10);
      expect(point[1]).toBe(2);
      expect(point[2]).toBeGreaterThanOrEqual(39);
    }
  });

  it("passes the final exit of a concave lake even when an earlier dry notch could hold a stance", () => {
    const pool: WaterBody = {
      id: "test_pool",
      level: 1,
      // The +Z ray crosses water at -6..6 and 12..18, with a dry notch between.
      contour: [[-6, -6], [6, -6], [6, 18], [-6, 18], [-6, 12], [2, 12], [2, 6], [-6, 6]],
    };
    const heightAt = (_x: number, z: number) => z > 6 && z < 12 || z > 18 ? 2 : 0;
    const positions = fishingAccessPositions([fishery()], [pool], heightAt);

    for (const point of positions.values()) {
      expect(point[0]).toBeCloseTo(0, 10);
      expect(point[2]).toBeGreaterThanOrEqual(21);
      expect(point[1]).toBe(heightAt(point[0], point[2]));
    }
  });

  it("rotates centre-rooted location and slot rays and keeps oblique stances three metres from shore", () => {
    const site = fishery({
      centre: [40, -30],
      rotationY: Math.PI / 2,
      resourceSlots: [
        { clusterId: "test_pool", index: 3, x: -6, z: -4, yaw: 1, scale: 1 },
        { clusterId: "test_pool", index: 7, x: 0, z: 3, yaw: 2, scale: 1 },
        { clusterId: "test_pool", index: 12, x: 9, z: -1, yaw: -1, scale: 1 },
      ],
    });
    // Local bounds are x -20..20, z -10..10. Rotated +Z exits at world x = 50.
    const pool = rectangle("test_pool", 30, -50, 50, -10, 2);
    const heightAt = (x: number, z: number) => 10 + x / 100 + z / 100;
    const positions = fishingAccessPositions([site], [pool], heightAt);

    expect([...positions.keys()].sort()).toEqual(["test_landing", "test_pool_12", "test_pool_3", "test_pool_7"]);
    const landing = position(positions, site.locationId);
    expect(landing[0]).toBeGreaterThanOrEqual(53 - 1e-8);
    expect(landing[2]).toBeCloseTo(-30, 10);
    for (const slot of site.resourceSlots) {
      const point = position(positions, `${slot.clusterId}_${slot.index}`);
      const dx = point[0] - site.centre[0];
      const dz = point[2] - site.centre[1];
      expect(dx).toBeGreaterThan(0);
      // Rotation maps the local direction [slot.x, 24] to [24, -slot.x].
      expect(dz * 24 + dx * slot.x).toBeCloseTo(0, 9);
      expect(point[0] - 50).toBeGreaterThanOrEqual(3 - 1e-8);
      expect(point[2]).toBeGreaterThan(-50);
      expect(point[2]).toBeLessThan(-10);
      expect(point[1]).toBe(heightAt(point[0], point[2]));
    }
  });

  it("uses dry ground outside the closed bank even when it falls below the lake plane", () => {
    const pool = rectangle("test_pool", -10, -10, 10, 10, 5);
    const heightAt = (_x: number, z: number) => 5 - Math.max(0, z - 10) / 4;
    const positions = fishingAccessPositions([fishery()], [pool], heightAt);

    for (const point of positions.values()) {
      expect(point[0]).toBeCloseTo(0, 10);
      expect(point[2]).toBe(13);
      expect(point[1]).toBeLessThan(pool.level);
      expect(point[1]).toBe(heightAt(point[0], point[2]));
    }
  });

  it.each([2, 3, 4])("fans along the local bank to avoid an adjacent lake at ground height %s", (groundHeight) => {
    const pool = rectangle("test_pool", -10, -10, 10, 10);
    const adjacent = rectangle("adjacent_pool", -5, 12, 5, 22, 3);
    const positions = fishingAccessPositions([fishery()], [pool, adjacent], () => groundHeight);

    for (const point of positions.values()) {
      expect(point[1]).toBe(groundHeight);
      expect(Math.abs(point[0])).toBeGreaterThanOrEqual(8);
      expect(point[2]).toBeGreaterThanOrEqual(13);
      expect(Math.hypot(point[0], point[2] - 10)).toBeLessThanOrEqual(12);
    }
  });

  it("fails locally when another solved water polygon blocks the whole bank, regardless of height", () => {
    const pool = rectangle("test_pool", -10, -10, 10, 10);
    const dryOverlap = rectangle("lower_pool", -200, 12, 200, 200, 1);
    expect(() => fishingAccessPositions([fishery()], [pool, dryOverlap], () => 2))
      .toThrow("no dry bank for test_landing within 12 m of its solved shoreline");
  });

  it("keeps invalid terrain probes bounded to twelve metres from the intended shoreline exit", () => {
    const heightAt = vi.fn((_x: number, _z: number) => Number.NaN);
    expect(() => fishingAccessPositions([fishery()], [rectangle("test_pool", -10, -10, 10, 10)], heightAt)).toThrow("within 12 m");
    expect(heightAt.mock.calls.length).toBeGreaterThan(0);
    expect(heightAt.mock.calls.length).toBeLessThanOrEqual(209);
    for (const [x, z] of heightAt.mock.calls) expect(Math.hypot(x, z - 10)).toBeLessThanOrEqual(12 + 1e-9);
  });

  it("finds gentle dry footing beside the fitted Cairn Tarn production basin", () => {
    const site = WORLD_SITES.find((candidate) => candidate.id === "cairn_tarn_ledge")!;
    const spec = buildWorldTerrainSpec();
    const basin = spec.basins!.find((candidate) => candidate.id === "cairn_tarn_spots")!;
    const scene = new WorldScene(new Scene());
    try {
      // Retain production fields, relief, pads and the two-metre lattice. Only distant meshes
      // and the render-only coast are omitted from this local ridge fixture.
      scene.buildWorld({
        ...spec, coast: undefined, chunkSize: 96,
        bounds: { minX: basin.x - 48, maxX: basin.x + 48, minZ: basin.z - 48, maxZ: basin.z + 48 },
      }, (prepared) => {
        prepared.buildWater({
          minX: basin.x - basin.crestRadius, maxX: basin.x + basin.crestRadius,
          minZ: basin.z - basin.crestRadius, maxZ: basin.z + basin.crestRadius,
        }, prepared.heightAt(site.regionId, basin.x, basin.z) + WATER_FILL_DEPTH, site.regionId);
      });
      const bodies = scene.getWaterBodies();
      expect(bodies).toHaveLength(1);
      expect(bodies[0]!.closed).toBe(true);
      const access = fishingAccessPositions([site], bodies, (x, z) => scene.meshHeightAt(x, z));
      const bank = position(access, "cairn_tarn_spots_2");
      expect(bank[1]).toBe(scene.meshHeightAt(bank[0], bank[2]));
      const slopeX = scene.meshHeightAt(bank[0] + 0.5, bank[2]) - scene.meshHeightAt(bank[0] - 0.5, bank[2]);
      const slopeZ = scene.meshHeightAt(bank[0], bank[2] + 0.5) - scene.meshHeightAt(bank[0], bank[2] - 0.5);
      expect(Math.hypot(slopeX, slopeZ)).toBeLessThan(0.6);
      expect(scene.sampleWorld(bank[0], bank[2]).waterBodyId).toBeNull();
      expect(Math.hypot(bank[0] - site.centre[0], bank[2] - site.centre[1])).toBeLessThan(basin.crestRadius + 12);
      // The whole ordinary interaction stand radius, not merely the anchor point, stays dry.
      for (let i = 0; i < 24; i++) {
        const angle = i / 24 * Math.PI * 2;
        expect(scene.sampleWorld(bank[0] + Math.cos(angle) * 3, bank[2] + Math.sin(angle) * 3).waterBodyId).toBeNull();
      }
    } finally {
      scene.dispose();
    }
  });

  it("throws when the first resource slot has no matching solved water body", () => {
    const site = fishery();
    const wrongBody = rectangle(site.id, -10, -10, 10, 10);

    expect(() => fishingAccessPositions([site], [], () => 2)).toThrow();
    expect(() => fishingAccessPositions([site], [wrongBody], () => 2)).toThrow();
  });

  it.each(["mine", "grove", "habitat"] as const)("ignores a %s without requiring a water body or sampling terrain", (kind) => {
    const heightAt = vi.fn(() => 2);

    expect(fishingAccessPositions([fishery({ kind })], [], heightAt)).toEqual(new Map());
    expect(heightAt).not.toHaveBeenCalled();
  });

  it("returns the same positions on repeated calls without changing the authored inputs", () => {
    const sites = [fishery({
      resourceSlots: [
        { clusterId: "test_pool", index: 7, x: -5, z: -2, yaw: 0, scale: 1 },
        { clusterId: "test_pool", index: 2, x: 6, z: 1, yaw: 0, scale: 1 },
      ],
    })];
    const bodies = [rectangle("test_pool", -10, -10, 10, 10, 2)];
    const before = structuredClone({ sites, bodies });
    const heightAt = (x: number, z: number) => 3 + x * 0.01 + z * 0.02;
    const first = fishingAccessPositions(sites, bodies, heightAt);
    const second = fishingAccessPositions(sites, bodies, heightAt);

    expect(first.size).toBe(3);
    expect(second).not.toBe(first);
    expect([...second]).toEqual([...first]);
    expect({ sites, bodies }).toEqual(before);
  });
});
