import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WorldScene } from '../game/src/render/scene.js';
import { sampleFairyBankHeight } from '../game/src/world/fairyBankHeightmaps.js';
import { buildFairyCorridorCanopy, type FairyCorridorCanopyPoint } from '../game/src/world/fairyCorridorCanopy.js';
import { buildFairyCorridorDressing } from '../game/src/world/fairyCorridorDressing.js';
import { buildFairyGardenGroves } from '../game/src/world/fairyGardenGroves.js';
import { FAIRY_GARDEN_SHOULDERS, fairyGardenShoulderRise } from '../game/src/world/fairyGardenShoulders.js';
import { buildFairyLandformDressing, type FairyDressingRoad, type FairyLandformDressing } from '../game/src/world/fairyLandformDressing.js';
import { FAIRY_COMBAT_PLATEAUS, sampleFairyRamp, type FairyLandformPoint } from '../game/src/world/fairyLandforms.js';
import { FAIRY_GARDEN_LANDINGS, FAIRY_UPPER_GARDEN_RAMPS } from '../game/src/world/fairyRegionalRelief.js';

const radius = (tree: FairyCorridorCanopyPoint) => (tree.assetId.includes('_hero_') ? 1.75 : tree.assetId.endsWith('_1') ? 1.37 : .95) * tree.scale;
const distanceToSegment = (p: FairyLandformPoint, a: FairyLandformPoint, b: FairyLandformPoint) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1,
    ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};

function nativeSurface(x: number, z: number, ground: (x: number, z: number) => number, rocks: readonly FairyLandformDressing[]) {
  let highest = ground(x, z);
  for (const rock of rocks) {
    if (rock.assetId === 'fairy_boulder_0' || rock.assetId === 'fairy_boulder_4') continue;
    const dx = x - rock.position[0], dz = z - rock.position[1], c = Math.cos(rock.rotationY), s = Math.sin(rock.rotationY);
    const top = sampleFairyBankHeight(rock.assetId, (dx * c - dz * s) / rock.scale, (dx * s + dz * c) / rock.scale);
    if (top !== null) highest = Math.max(highest, ground(...rock.position) + rock.heightOffset - rock.sink + top * rock.scale);
  }
  return highest;
}

describe('wooded outer fairy garden shoulders', () => {
  const scene = new WorldScene(new THREE.Scene());
  const ground = (x: number, z: number) => scene.meshHeightAt(x, z);
  let roads: FairyDressingRoad[], rocks: FairyLandformDressing[], existing: FairyCorridorCanopyPoint[], points: FairyCorridorCanopyPoint[];
  beforeAll(() => {
    scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
    roads = scene.getRoadPolylines().map(line => ({ points: line.map(p => [p[0], p[2]] as const), halfWidth: 1.6, allowSway: false }));
    rocks = [...buildFairyLandformDressing(ground, roads), ...buildFairyCorridorDressing(ground, roads)];
    existing = buildFairyCorridorCanopy(ground, roads, rocks);
    points = buildFairyGardenGroves(ground, roads, rocks, existing);
  }, 30000);
  afterAll(() => scene.dispose());

  it('fills all three compositions with deterministic staggered crowns and a bounded total', () => {
    expect(points).toEqual(buildFairyGardenGroves(ground, roads, rocks, existing));
    expect(points.length).toBeGreaterThanOrEqual(30);
    expect(points.length).toBeLessThanOrEqual(42);
    expect(new Set(points.map(point => point.id)).size).toBe(points.length);
    for (const garden of ['southern', 'starroot', 'sovereign']) {
      const grove = points.filter(point => point.id.startsWith(`fairy_grove_${garden}_`));
      expect(grove.length, garden).toBeGreaterThanOrEqual(10);
      expect(grove.length, garden).toBeLessThanOrEqual(14);
      expect(grove.filter(point => point.assetId.includes('_hero_')).length, garden).toBeGreaterThanOrEqual(7);
      // A line along the boundary cannot pass: roots span both depth and width.
      expect(Math.max(...grove.map(p => p.position[0])) - Math.min(...grove.map(p => p.position[0])), garden).toBeGreaterThan(12);
      expect(Math.max(...grove.map(p => p.position[1])) - Math.min(...grove.map(p => p.position[1])), garden).toBeGreaterThan(12);
    }
    for (const shoulder of FAIRY_GARDEN_SHOULDERS) expect(points.some(point => point.id.startsWith(`fairy_grove_${shoulder.id}_`)), shoulder.id).toBe(true);
    expect(points.filter(point => point.regionId === 'gloamgarden')).toHaveLength(points.filter(point => point.id.startsWith('fairy_grove_southern_')).length);
  });

  it('preserves the full twelve-metre landing capsules, ramps, roads and world bounds', () => {
    for (const point of points) {
      const r = radius(point), [x, z] = point.position;
      expect(Math.min(x - 2000, 2600 - x, z + 200, 460 - z), point.id).toBeGreaterThanOrEqual(r);
      for (const landing of FAIRY_GARDEN_LANDINGS) expect(distanceToSegment(point.position, landing.from, landing.to) - r, point.id)
        .toBeGreaterThanOrEqual(landing.halfWidth + .9);
      for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) expect(sampleFairyRamp(x, z, ramp).distance - r, point.id)
        .toBeGreaterThanOrEqual(ramp.halfWidth + ramp.shoulder + 1);
      for (const road of roads) for (let i = 1; i < road.points.length; i++) expect(distanceToSegment(point.position, road.points[i - 1]!, road.points[i]!) - r, point.id)
        .toBeGreaterThanOrEqual(Math.max(3, road.halfWidth) + .9);
      for (const plateau of FAIRY_COMBAT_PLATEAUS) expect(Math.hypot(x - plateau.centre[0], z - plateau.centre[1]) - r, point.id)
        .toBeGreaterThanOrEqual(plateau.clearingRadius + 6);
    }
  });

  it('grounds complete native root footprints on final terrain or rocks without a second groundY subtraction', () => {
    for (const point of points) {
      const r = radius(point), [x, z] = point.position, base = ground(x, z) + point.heightOffset - point.sink;
      const centre = nativeSurface(x, z, ground, rocks);
      expect(point.sink).toBe(.03);
      let minimum = centre;
      for (let direction = 0; direction < 48; direction++) for (const fraction of [.2, .4, .6, .8, 1]) {
        const distance = r * fraction, dx = Math.cos(direction * Math.PI / 24) * distance, dz = Math.sin(direction * Math.PI / 24) * distance;
        const height = nativeSurface(x + dx, z + dz, ground, rocks);
        minimum = Math.min(minimum, height);
        expect(base - height, point.id).toBeLessThan(.015);
        expect(Math.abs(height - centre) / distance, point.id).toBeLessThan(.55);
      }
      expect(base, point.id).toBeGreaterThan(minimum - .08);
    }
  });

  it('keeps existing trunks separated and can root a new crown on a transformed native bank', () => {
    for (const [index, point] of points.entries()) for (const other of [...existing, ...points.slice(index + 1)]) {
      expect(Math.hypot(point.position[0] - other.position[0], point.position[1] - other.position[1]), point.id).toBeGreaterThanOrEqual(6.5);
    }
    const flat = (x: number, z: number) => -110 + fairyGardenShoulderRise(x, z, FAIRY_GARDEN_LANDINGS);
    const bank: FairyLandformDressing = { id: 'grove_support_bank', landformId: 'southern_west', regionId: 'gloamgarden',
      assetId: 'fairy_moss_bank_0', position: [2223, -184], rotationY: .43, scale: 2.4, heightOffset: -5, sink: .2 };
    const rooted = buildFairyGardenGroves(flat, [], [bank], []);
    const bankTrees = rooted.filter(point => point.heightOffset > .5);
    expect(bankTrees.length).toBeGreaterThan(0);
    for (const point of bankTrees) {
      const base = flat(...point.position) + point.heightOffset - point.sink, r = radius(point);
      let min = Infinity;
      for (let angle = 0; angle < 48; angle++) {
        const h = nativeSurface(point.position[0] + Math.cos(angle * Math.PI / 24) * r,
          point.position[1] + Math.sin(angle * Math.PI / 24) * r, flat, [bank]);
        expect(base - h, point.id).toBeLessThan(.015); min = Math.min(min, h);
      }
      expect(base, point.id).toBeGreaterThan(min - .08);
    }
    expect(buildFairyGardenGroves((x, z) => flat(x, z) + x * 2, [], [], [])).toEqual([]);
  });
});
