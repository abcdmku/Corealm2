import { describe, expect, it } from 'vitest';
import type { SolidVolume, Vec3 } from '../game/src/contracts.js';
import { Solids } from '../game/src/systems/solids.js';
import { sampleFairyBankHeight } from '../game/src/world/fairyBankHeightmaps.js';
import { buildFairyCorridorDressing } from '../game/src/world/fairyCorridorDressing.js';
import { FAIRY_ROCK_NATIVE_BOUNDS, fairyDressingClearance, type FairyDressingRoad,
  type FairyLandformDressing } from '../game/src/world/fairyLandformDressing.js';
import { FAIRY_GARDEN_LANDINGS } from '../game/src/world/fairyRegionalRelief.js';

const roads: readonly FairyDressingRoad[] = [
  { points: [[2018, -180], [2120, -178], [2240, -185], [2380, -174], [2580, -179]], halfWidth: 1.6, allowSway: false },
  { points: [[2018, 432], [2200, 435], [2370, 429], [2580, 434]], halfWidth: 1.6, allowSway: false },
];

function roadDistance(x: number, z: number): number {
  let result = Infinity;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!, dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    result = Math.min(result, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return result;
}

function vertex(x: number, z: number): number {
  const t = Math.max(0, Math.min(1, (roadDistance(x, z) - 3) / (z < 100 ? 3.9 : 3)));
  return -120 + (z < 100 ? 7.2 : 4.7) * t * t * (3 - 2 * t) + Math.sin(x * 1.3 + z * .7) * .27;
}

// A full one-metre terrain lattice with diagonal interpolation and small local creases.
function ground(x: number, z: number): number {
  const ax = Math.floor(x), az = Math.floor(z), u = x - ax, v = z - az;
  return u + v <= 1
    ? vertex(ax, az) * (1 - u - v) + vertex(ax + 1, az) * u + vertex(ax, az + 1) * v
    : vertex(ax + 1, az + 1) * (u + v - 1) + vertex(ax + 1, az) * (1 - v) + vertex(ax, az + 1) * (1 - u);
}

const entries = buildFairyCorridorDressing(ground, roads);
const transform = (entry: FairyLandformDressing, x: number, z: number): readonly [number, number] => {
  const c = Math.cos(entry.rotationY), s = Math.sin(entry.rotationY);
  return [entry.position[0] + (x * c + z * s) * entry.scale,
    entry.position[1] + (-x * s + z * c) * entry.scale];
};

describe('rounded fairy corridor accents', () => {
  it('produces stable separated groups in both regions within the instance budget', () => {
    expect(entries).toEqual(buildFairyCorridorDressing(ground, roads));
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.length).toBeLessThanOrEqual(360);
    for (const regionId of ['gloamgarden', 'faeholme']) {
      const regional = entries.filter(entry => entry.regionId === regionId);
      expect(regional.length).toBeGreaterThan(8);
      expect(regional.length).toBeLessThanOrEqual(180);
    }
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
    expect(Math.min(...entries.map(entry => entry.scale))).toBeGreaterThanOrEqual(1.3);
    expect(Math.max(...entries.map(entry => entry.scale))).toBeLessThanOrEqual(2.3);
    const remoteHeights = entries.filter(entry => entry.regionId === 'gloamgarden').map(entry =>
      FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId][1] * entry.scale);
    expect(remoteHeights.reduce((sum, height) => sum + height, 0) / remoteHeights.length).toBeGreaterThan(5.5);
    const groups = new Map<string, FairyLandformDressing[]>();
    for (const entry of entries) groups.set(entry.landformId, [...(groups.get(entry.landformId) ?? []), entry]);
    expect([...groups.values()].filter(group => group.length > 1).length).toBeGreaterThan(5);
    expect(Math.max(...[...groups.values()].map(group => group.length))).toBeLessThanOrEqual(3);
    // A flat field provides no receiving face and must not acquire an isolated boulder row.
    expect(buildFairyCorridorDressing(() => -120, roads)).toEqual([]);
  });

  it('buries complete rotated bodies through terrain creases while leaving native stone visible', () => {
    let worstFooting = -Infinity, lowestVisiblePeak = Infinity, highestVisiblePeak = 0;
    for (const entry of entries) {
      const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
      const base = ground(...entry.position) + entry.heightOffset - entry.sink;
      let visiblePeak = 0;
      for (let ix = 0; ix <= 64; ix++) for (let iz = 0; iz <= 64; iz++) {
        const lx = (ix / 64 - .5) * bounds[0], lz = (iz / 64 - .5) * bounds[2];
        const [x, z] = transform(entry, lx, lz), terrain = ground(x, z);
        worstFooting = Math.max(worstFooting, base - terrain);
        const top = sampleFairyBankHeight(entry.assetId as 'fairy_rounded_bank_0' | 'fairy_rounded_bank_1', lx, lz);
        if (top !== null) visiblePeak = Math.max(visiblePeak, base + top * entry.scale - terrain);
      }
      lowestVisiblePeak = Math.min(lowestVisiblePeak, visiblePeak);
      highestVisiblePeak = Math.max(highestVisiblePeak, visiblePeak);
    }
    expect(worstFooting).toBeLessThan(-.15);
    expect(lowestVisiblePeak).toBeGreaterThan(.45);
    expect(highestVisiblePeak).toBeLessThanOrEqual(2.5);
  });

  it('keeps curved walking floors clear through production body collision', () => {
    const volumes: SolidVolume[] = entries.map(entry => {
      const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
      return { kind: 'box', id: entry.id, position: [entry.position[0],
        ground(...entry.position) + entry.heightOffset - entry.sink, entry.position[1]],
      size: [bounds[0] * entry.scale, bounds[1] * entry.scale, bounds[2] * entry.scale], rotationY: entry.rotationY };
    });
    const solids = new Solids(volumes);
    let maximumPush = 0, minimumReserve = Infinity, minimumRoadDistance = Infinity;
    for (const entry of entries) minimumReserve = Math.min(minimumReserve,
      fairyDressingClearance(entry, []));
    // These placements must use the space the old enclosing circles incorrectly rejected.
    expect(entries.filter(entry => fairyDressingClearance(entry, roads) < 0).length).toBeGreaterThan(10);
    for (const road of roads) for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!, b = road.points[i]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.ceil(length / .2);
      for (let step = 0; step <= steps; step++) for (const offset of [-2.5, 0, 2.5]) {
        const x = a[0] + (b[0] - a[0]) * step / steps - (b[1] - a[1]) / length * offset;
        const z = a[1] + (b[1] - a[1]) * step / steps + (b[0] - a[0]) / length * offset;
        const point: Vec3 = [x, ground(x, z), z], resolved = solids.resolve(point, point, .9);
        maximumPush = Math.max(maximumPush, Math.hypot(resolved[0] - x, resolved[2] - z));
        if (offset === 0) for (const entry of entries) {
          const dx = x - entry.position[0], dz = z - entry.position[1], c = Math.cos(entry.rotationY), s = Math.sin(entry.rotationY);
          const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
          const rx = Math.max(0, Math.abs(dx * c - dz * s) - bounds[0] * entry.scale / 2);
          const rz = Math.max(0, Math.abs(dx * s + dz * c) - bounds[2] * entry.scale / 2);
          minimumRoadDistance = Math.min(minimumRoadDistance, Math.hypot(rx, rz));
        }
      }
    }
    expect(minimumReserve).toBeGreaterThanOrEqual(.02);
    expect(minimumRoadDistance).toBeGreaterThanOrEqual(3.45 - 1e-6);
    expect(maximumPush).toBeLessThan(1e-6);
    // Test the complete landing width and round ends using real body collision,
    // including the forest beyond the old six-metre crest reserve.
    for (const landing of FAIRY_GARDEN_LANDINGS) {
      const dx = landing.to[0] - landing.from[0], dz = landing.to[1] - landing.from[1];
      const length = Math.hypot(dx, dz), steps = Math.ceil(length / .2);
      const points: (readonly [number, number])[] = [];
      for (let step = 0; step <= steps; step++) for (const side of [-3, 0, 3]) {
        points.push([landing.from[0] + dx * step / steps - dz / length * side,
          landing.from[1] + dz * step / steps + dx / length * side]);
      }
      for (const end of [landing.from, landing.to]) for (let sample = 0; sample < 32; sample++) {
        const angle = sample / 32 * Math.PI * 2;
        points.push([end[0] + Math.cos(angle) * landing.halfWidth, end[1] + Math.sin(angle) * landing.halfWidth]);
      }
      for (const [x, z] of points) {
        const point: Vec3 = [x, ground(x, z), z];
        expect(solids.resolve(point, point, .9), `${landing.id} entry at ${x},${z}`).toEqual(point);
      }
    }
  });
});
