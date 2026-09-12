import { describe, expect, it } from 'vitest';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { sampleFairyBankHeight } from '../game/src/world/fairyBankHeightmaps.js';
import { buildFairyCorridorCanopy, censusFairyCorridorCanopy } from '../game/src/world/fairyCorridorCanopy.js';
import type { FairyDressingRoad, FairyLandformDressing } from '../game/src/world/fairyLandformDressing.js';
import { applyFairyLandforms, FAIRY_ASCENT_ROUTES, FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, sampleFairyRamp } from '../game/src/world/fairyLandforms.js';
import { FAIRY_GARDEN_LANDINGS, FAIRY_UPPER_GARDEN_RAMPS } from '../game/src/world/fairyRegionalRelief.js';

const roads: readonly FairyDressingRoad[] = [
  { points: [[2020, -180], [2200, -180], [2400, -180], [2580, -180]], halfWidth: 1.6, allowSway: false },
  { points: [[2020, 435], [2200, 435], [2400, 435], [2580, 435]], halfWidth: 1.6, allowSway: false },
];
const ground = (x: number, z: number) => -120 + 7 * Math.min(1,
  Math.max(0, (Math.min(Math.abs(z + 180), Math.abs(z - 435)) - 3) / 4)) + Math.sin(x / 8) * .025;
const rocks: readonly FairyLandformDressing[] = [-167, 422].flatMap((z, region) =>
  [2060, 2110, 2180, 2250, 2330, 2410, 2490, 2540].map((x, index) => ({
    id: `canopy_test_rock_${region}_${index}`, landformId: 'canopy_test_rock',
    regionId: region === 0 ? 'gloamgarden' as const : 'faeholme' as const,
    assetId: index % 2 ? 'fairy_rounded_bank_1' as const : 'fairy_rounded_bank_0' as const,
    position: [x, z] as const, scale: 2.1, rotationY: index * .4, heightOffset: -4, sink: .15,
  })));
const points = buildFairyCorridorCanopy(ground, roads, rocks);
const trunk = (assetId: string, scale: number) => (assetId.includes('_hero_') ? 1.75 : assetId.endsWith('_1') ? 1.37 : .95) * scale;
const rimRoads: readonly FairyDressingRoad[] = FAIRY_ASCENT_ROUTES.map(route => ({
  points: route.points, halfWidth: route.width / 2, allowSway: false,
}));
const rimGround = (x: number, z: number) => applyFairyLandforms(x, z, -120, FAIRY_COMBAT_PLATEAUS);
const rimCensus = censusFairyCorridorCanopy(rimGround, rimRoads, []);

function surface(x: number, z: number): number {
  let highest = ground(x, z);
  for (const rock of rocks) {
    const dx = x - rock.position[0], dz = z - rock.position[1], c = Math.cos(rock.rotationY), s = Math.sin(rock.rotationY);
    const top = sampleFairyBankHeight(rock.assetId as 'fairy_rounded_bank_0' | 'fairy_rounded_bank_1',
      (dx * c - dz * s) / rock.scale, (dx * s + dz * c) / rock.scale);
    if (top !== null) highest = Math.max(highest, ground(...rock.position) + rock.heightOffset - rock.sink + top * rock.scale);
  }
  return highest;
}

describe('fairy upper corridor canopy', () => {
  it('fills supported banks deterministically while exposing uncapped supply and balanced regional budgets', () => {
    expect(points).toEqual(buildFairyCorridorCanopy(ground, roads, rocks));
    const census = censusFairyCorridorCanopy(ground, roads, rocks);
    expect(census.points).toEqual(points);
    expect(points.length).toBeGreaterThan(500);
    expect(points.length).toBeLessThanOrEqual(600);
    for (const regionId of ['gloamgarden', 'faeholme'] as const) {
      const count = census.regions[regionId];
      expect(count.selected).toBe(points.filter(point => point.regionId === regionId).length);
      expect(count.selected).toBeGreaterThan(250);
      expect(count.selected).toBe(Math.min(450, count.uncapped));
      expect(count.eligible).toBeGreaterThan(count.uncapped);
      expect(count.attempted).toBe(count.protected + count.unsupported + count.eligible);
      expect(count.corridor + count.rim).toBe(count.selected);
    }
    expect(Math.abs(census.regions.gloamgarden.selected - census.regions.faeholme.selected)).toBeLessThan(60);
    expect(census.regions.faeholme.uncapped).toBeGreaterThanOrEqual(300);
    let minimumSpacing = Infinity;
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      minimumSpacing = Math.min(minimumSpacing, Math.hypot(points[i]!.position[0] - points[j]!.position[0], points[i]!.position[1] - points[j]!.position[1]));
    }
    expect(minimumSpacing).toBeGreaterThanOrEqual(6.5);
    expect(minimumSpacing).toBeLessThan(8);
    for (const point of points) {
      const hero = point.assetId.includes('_hero_');
      for (const landing of FAIRY_GARDEN_LANDINGS) {
        const dx = landing.to[0] - landing.from[0], dz = landing.to[1] - landing.from[1];
        const t = Math.max(0, Math.min(1, ((point.position[0] - landing.from[0]) * dx
          + (point.position[1] - landing.from[1]) * dz) / (dx * dx + dz * dz)));
        expect(Math.hypot(point.position[0] - landing.from[0] - dx * t,
          point.position[1] - landing.from[1] - dz * t) - trunk(point.assetId, point.scale))
          .toBeGreaterThanOrEqual(landing.halfWidth + .9);
      }
      expect(point.scale).toBeGreaterThanOrEqual(hero ? .75 : .9);
      expect(point.scale).toBeLessThanOrEqual(hero ? 1 : 1.1);
      for (const region of FAIRY_REGIONS) if (region.settlement) expect(Math.hypot(
        point.position[0] - region.settlement.centre[0], point.position[1] - region.settlement.centre[1])
        - trunk(point.assetId, point.scale)).toBeGreaterThanOrEqual(55);
    }
    expect(buildFairyCorridorCanopy(() => -120, roads, [])).toEqual([]);
  });

  it('plants on real terrain or exposed transformed rocks without applying native groundY twice', () => {
    let onRock = 0, onTerrain = 0, highestFootGap = -Infinity, maximumSlope = 0;
    for (const point of points) {
      const [x, z] = point.position, radius = trunk(point.assetId, point.scale);
      const base = ground(x, z) + point.heightOffset - point.sink, centre = surface(x, z);
      if (point.heightOffset > .12) onRock++; else onTerrain++;
      const steps = Math.ceil(radius / .15);
      for (let ix = -steps; ix <= steps; ix++) for (let iz = -steps; iz <= steps; iz++) {
        const dx = ix * radius / steps, dz = iz * radius / steps, distance = Math.hypot(dx, dz);
        if (distance > radius) continue;
        const support = surface(x + dx, z + dz);
        highestFootGap = Math.max(highestFootGap, base - support);
        if (distance > .01) maximumSlope = Math.max(maximumSlope, Math.abs(support - centre) / distance);
      }
      const laneZ = point.regionId === 'gloamgarden' ? -180 : 435;
      expect(base - ground(x, laneZ)).toBeGreaterThanOrEqual(2.97);
      expect(Math.abs(z - laneZ)).toBeGreaterThanOrEqual(8);
      expect(Math.abs(z - laneZ)).toBeLessThanOrEqual(24);
      expect(point.sink).toBe(.03);
      // The closer shoulder can descend under a wide root. Its supported base may
      // sit below the centre, bounded by measured slope rather than a flat-bank constant.
      expect(point.heightOffset).toBeGreaterThanOrEqual(-.55 * radius);
    }
    expect(onRock).toBeGreaterThan(0);
    expect(onTerrain).toBeGreaterThan(30);
    expect(highestFootGap).toBeLessThan(.015);
    expect(maximumSlope).toBeLessThan(.55);
    expect(points.filter(point => Math.abs(point.position[1] - (point.regionId === 'gloamgarden' ? -180 : 435)) <= 12).length)
      .toBeGreaterThan(points.length * .35);
  });

  it('caps a larger supported supply at 450 per region without hiding uncapped candidates', () => {
    const rows = [-180, -15, 105, 155, 300, 435];
    const broadRoads = rows.map(z => ({ points: [[2020, z], [2580, z]] as const, halfWidth: 1.6, allowSway: false }));
    const broadGround = (_x: number, z: number) => -120 + 7 * Math.min(1,
      Math.max(0, (Math.min(...rows.map(row => Math.abs(z - row))) - 3) / 4));
    const census = censusFairyCorridorCanopy(broadGround, broadRoads, []);
    expect(census.points).toHaveLength(900);
    expect(new Set(census.points.map(point => point.id)).size).toBe(900);
    for (const regionId of ['gloamgarden', 'faeholme'] as const) {
      const counts = census.regions[regionId];
      expect(counts.uncapped).toBeGreaterThan(450);
      expect(counts.selected).toBe(450);
      expect(counts.eligible).toBeGreaterThan(counts.uncapped);
    }
  });

  it('woods every combat rim with grounded overlapping crowns outside the open encounter floor', () => {
    expect(rimCensus.points.length).toBeGreaterThan(220);
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      expect(rimCensus.plateauRims[plateau.id]!.selected, plateau.id).toBeGreaterThanOrEqual(18);
      expect(rimCensus.plateauRims[plateau.id]!.eligible).toBeGreaterThanOrEqual(rimCensus.plateauRims[plateau.id]!.uncapped);
    }
    for (const point of rimCensus.points) {
      const radius = trunk(point.assetId, point.scale), [x, z] = point.position;
      const base = rimGround(x, z) + point.heightOffset - point.sink;
      expect(point.sink).toBe(.03);
      for (let i = 0; i < 32; i++) for (const fraction of [.25, .5, .75, 1]) {
        const dx = Math.cos(i * Math.PI / 16) * radius * fraction, dz = Math.sin(i * Math.PI / 16) * radius * fraction;
        const height = rimGround(x + dx, z + dz);
        expect(base - height, point.id).toBeLessThan(.015);
        expect(Math.abs(height - rimGround(x, z)) / (radius * fraction), point.id).toBeLessThan(.55);
      }
    }
  });

  it('keeps full trunk bodies outside fighting clearings and every original or upper-garden ramp', () => {
    for (const point of [...points, ...rimCensus.points]) {
      const [x, z] = point.position, radius = trunk(point.assetId, point.scale);
      for (const plateau of FAIRY_COMBAT_PLATEAUS) {
        expect(Math.hypot(x - plateau.centre[0], z - plateau.centre[1]) - radius).toBeGreaterThanOrEqual(plateau.clearingRadius + 6);
        for (const ramp of plateau.ramps) expect(sampleFairyRamp(x, z, ramp).distance - radius)
          .toBeGreaterThanOrEqual(ramp.halfWidth + ramp.shoulder + 1);
      }
      for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) expect(Math.hypot(x - clearing.position[0], z - clearing.position[1]) - radius)
        .toBeGreaterThanOrEqual(clearing.radius + 3);
      for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) expect(sampleFairyRamp(x, z, ramp).distance - radius)
        .toBeGreaterThanOrEqual(ramp.halfWidth + ramp.shoulder + 1);
      const ownRoads = points.includes(point) ? roads : rimRoads;
      for (const road of ownRoads) for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!, dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
        expect(Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) - radius)
          .toBeGreaterThanOrEqual(Math.max(3, road.halfWidth) + .9);
      }
      for (const region of FAIRY_REGIONS) {
        for (const group of region.enemyGroups) if (group.boss) expect(Math.hypot(x - group.centre[0], z - group.centre[1]) - radius).toBeGreaterThanOrEqual(28);
        for (const gate of region.gates) expect(Math.hypot(x - gate.position[0], z - gate.position[1]) - radius).toBeGreaterThanOrEqual(7);
      }
      for (const site of WORLD_SITES) if (site.regionId === 'gloamgarden' || site.regionId === 'faeholme') {
        const dx = x - site.centre[0], dz = z - site.centre[1], c = Math.cos(site.rotationY), s = Math.sin(site.rotationY);
        expect(Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - site.extent[0]),
          Math.max(0, Math.abs(dx * s + dz * c) - site.extent[1])) - radius).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
