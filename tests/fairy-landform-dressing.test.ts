import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { resolveFairyDressing } from '../game/src/app/fairyDressing.js';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { WorldScene } from '../game/src/render/scene.js';
import { Solids } from '../game/src/systems/solids.js';
import {
  buildFairyLandformDressing, FAIRY_LANDFORM_DRESSING, FAIRY_ROCK_NATIVE_BOUNDS,
  fairyDressingBodyRadius, fairyDressingFootprint, fairyDressingClearance, type FairyLandformDressing,
} from '../game/src/world/fairyLandformDressing.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, FAIRY_LANDFORMS, FAIRY_VILLAGE_BANKS, FAIRY_LANDFORM_PROBES,
  type FairyLandformPoint } from '../game/src/world/fairyLandforms.js';
import { organicDistance, organicRadiusScale } from '../game/src/world/organicFields.js';
import { FAIRY_GARDEN_LANDINGS } from '../game/src/world/fairyRegionalRelief.js';

function lineDistance(p: FairyLandformPoint, a: FairyLandformPoint, b: FairyLandformPoint): number {
  const v = [b[0] - a[0], b[1] - a[1]];
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * v[0]! + (p[1] - a[1]) * v[1]!)
    / Math.max(1e-9, v[0]! ** 2 + v[1]! ** 2)));
  return Math.hypot(p[0] - a[0] - v[0]! * u, p[1] - a[1] - v[1]! * u);
}

function boxDistance(point: FairyLandformPoint, centre: FairyLandformPoint,
  halfX: number, halfZ: number, yaw: number): number {
  const c = Math.cos(yaw), s = Math.sin(yaw), x = point[0] - centre[0], z = point[1] - centre[1];
  return Math.hypot(Math.max(0, Math.abs(x * c - z * s) - halfX),
    Math.max(0, Math.abs(x * s + z * c) - halfZ));
}

/** Independent 2D separating-axis check on the actual uniform native boxes. */
function nativeBoxesOverlap(a: FairyLandformDressing, b: FairyLandformDressing): boolean {
  const axes = (entry: FairyLandformDressing): readonly (readonly [number, number])[] => [
    [Math.cos(entry.rotationY), -Math.sin(entry.rotationY)],
    [Math.sin(entry.rotationY), Math.cos(entry.rotationY)],
  ];
  const aa = axes(a), ba = axes(b), delta = [b.position[0] - a.position[0], b.position[1] - a.position[1]];
  const projection = (entry: FairyLandformDressing, basis: readonly (readonly [number, number])[], axis: readonly [number, number]) => {
    const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
    return Math.abs(axis[0] * basis[0]![0] + axis[1] * basis[0]![1]) * bounds[0] * entry.scale / 2
      + Math.abs(axis[0] * basis[1]![0] + axis[1] * basis[1]![1]) * bounds[2] * entry.scale / 2;
  };
  return [...aa, ...ba].every(axis => Math.abs(delta[0]! * axis[0] + delta[1]! * axis[1])
    < projection(a, aa, axis) + projection(b, ba, axis));
}

describe('fairy native cliff dressing', () => {
  it('uses promoted native bounds and preserves full uniform dimensions', () => {
    for (const [assetId, expected] of Object.entries(FAIRY_ROCK_NATIVE_BOUNDS)) {
      const bytes = readFileSync(`game/public/assets/models/fairy/${assetId}.glb`);
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
      for (let axis = 0; axis < 3; axis += 1) {
        expect(position.max[axis] - position.min[axis], `${assetId} axis${axis}`).toBeCloseTo(expected[axis]!, 4);
      }
      expect(position.min[1], assetId).toBeCloseTo(0, 5);
    }
    for (const entry of FAIRY_LANDFORM_DRESSING) {
      expect(typeof entry.scale).toBe('number');
      const radius = fairyDressingBodyRadius(entry);
      for (const corner of fairyDressingFootprint(entry)) {
        expect(Math.hypot(corner[0] - entry.position[0], corner[1] - entry.position[1])).toBeLessThanOrEqual(radius + 1e-9);
      }
    }
  });

  it('covers existing risers with overlapping moss crags within the world instance budget', () => {
    expect(buildFairyLandformDressing()).toEqual(FAIRY_LANDFORM_DRESSING);
    expect(FAIRY_LANDFORM_DRESSING.length).toBeGreaterThanOrEqual(200);
    expect(FAIRY_LANDFORM_DRESSING.length).toBeLessThanOrEqual(400);
    expect(new Set(FAIRY_LANDFORM_DRESSING.map(entry => entry.id)).size).toBe(FAIRY_LANDFORM_DRESSING.length);
    const villageIds = new Set(FAIRY_VILLAGE_BANKS.map(bank => bank.id));
    for (const entry of FAIRY_LANDFORM_DRESSING) {
      expect(entry.assetId === 'fairy_rounded_bank_0' || entry.assetId === 'fairy_rounded_bank_1', entry.id).toBe(true);
      expect(villageIds.has(entry.landformId), entry.id).toBe(false);
      const landform = FAIRY_LANDFORMS.find(form => form.id === entry.landformId)!;
      const exposedHeight = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId][1] * entry.scale - entry.sink;
      expect(entry.sink / entry.scale, entry.id).toBeGreaterThanOrEqual(.08 - 1e-10);
      if (landform.clearingRadius > 0) expect(exposedHeight, entry.id).toBeCloseTo(landform.rise, 8);
      else {
        expect(exposedHeight, entry.id).toBeGreaterThanOrEqual(2.55);
        expect(exposedHeight, entry.id).toBeLessThanOrEqual(4.1);
      }
      const x = entry.position[0] - landform.centre[0], z = entry.position[1] - landform.centre[1];
      const radius = landform.radius * organicRadiusScale(Math.atan2(z, x), landform.shape);
      // The receiving hill contains the crags; an outside foot ring would leave the smooth face visible.
      expect(Math.hypot(x, z), entry.id).toBeLessThan(radius);
      if (landform.clearingRadius > 0) {
        for (const point of fairyDressingFootprint(entry)) {
          expect(organicDistance(point[0] - landform.centre[0], point[1] - landform.centre[1],
            landform.shape) - landform.radius, `${entry.id} low moat reserve`).toBeLessThanOrEqual(2.25);
        }
      }
    }
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      const pieces = FAIRY_LANDFORM_DRESSING.filter(entry => entry.landformId === plateau.id);
      // The rounded compounds are wider at the same height. Measure dressed face length rather than an old mesh count.
      const faceLength = pieces.reduce((sum, entry) => sum + FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId][0] * entry.scale, 0);
      expect(faceLength, `${plateau.id} source stone coverage`).toBeGreaterThanOrEqual(plateau.radius * Math.PI * .9);
    }
    const touching = FAIRY_LANDFORM_DRESSING.filter(entry => FAIRY_LANDFORM_DRESSING.some(other =>
      entry.id !== other.id && entry.landformId === other.landformId && nativeBoxesOverlap(entry, other)));
    expect(touching.length / FAIRY_LANDFORM_DRESSING.length).toBeGreaterThan(.95);
  });

  it('reserves the full native body around ramp tubes, resident clearings, buildings and resource floors', () => {
    for (const entry of FAIRY_LANDFORM_DRESSING) {
      const radius = fairyDressingBodyRadius(entry), p = entry.position;
      for (const plateau of FAIRY_COMBAT_PLATEAUS) {
        expect(Math.hypot(p[0] - plateau.centre[0], p[1] - plateau.centre[1]) - radius, entry.id)
          .toBeGreaterThanOrEqual(plateau.clearingRadius + 1);
        for (const ramp of plateau.ramps) for (let index = 1; index < ramp.points.length; index += 1) {
          expect(lineDistance(p, ramp.points[index - 1]!.position, ramp.points[index]!.position) - radius, entry.id)
            .toBeGreaterThanOrEqual(ramp.halfWidth + ramp.shoulder + 1);
        }
      }
      for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) {
        expect(Math.hypot(p[0] - clearing.position[0], p[1] - clearing.position[1]) - radius, entry.id)
          .toBeGreaterThanOrEqual(clearing.radius + 1);
      }
      for (const region of FAIRY_REGIONS) for (const building of region.settlement?.buildings ?? []) {
        expect(boxDistance(p, building.position, building.footprint[0] / 2, building.footprint[1] / 2,
          building.rotationY) - radius, `${entry.id} beside ${building.id}`).toBeGreaterThanOrEqual(2);
      }
      for (const site of WORLD_SITES) if (site.regionId === 'gloamgarden' || site.regionId === 'faeholme') {
        expect(boxDistance(p, site.centre, site.extent[0], site.extent[1], site.rotationY) - radius,
          `${entry.id} beside ${site.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('grounds final bodies against the production mesh and leaves every resolved walking lane clear', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      const resolvedRoads = scene.getRoadPolylines().map(line => ({
        points: line.map(p => [p[0], p[2]] as const), halfWidth: 1.6, allowSway: false,
      }));
      const entries = buildFairyLandformDressing((x, z) => scene.meshHeightAt(x, z), resolvedRoads);
      expect(entries.length).toBeGreaterThanOrEqual(200);
      expect(entries.length).toBeLessThanOrEqual(400);
      const roads = scene.getRoadPolylines();
      for (const entry of entries) {
        const p = entry.position, radius = fairyDressingBodyRadius(entry);
        expect(fairyDressingClearance(entry, resolvedRoads), entry.id).toBeGreaterThanOrEqual(0);
        const base = scene.meshHeightAt(p[0], p[1]) + entry.heightOffset - entry.sink;
        const corners = fairyDressingFootprint(entry);
        const plateau = FAIRY_COMBAT_PLATEAUS.find(form => form.id === entry.landformId);
        if (plateau) {
          // Inward seating preserves the original lower base instead of lifting the source crown.
          const lowestGround = Math.min(...corners.map(corner => scene.meshHeightAt(corner[0], corner[1])));
          expect(base + entry.sink, entry.id).toBeLessThanOrEqual(lowestGround + 1e-8);
          for (const corner of corners) expect(organicDistance(corner[0] - plateau.centre[0],
            corner[1] - plateau.centre[1], plateau.shape) - plateau.radius, entry.id).toBeLessThanOrEqual(2.25);
        } else {
          expect(corners.some(corner => Math.abs(base + entry.sink - scene.meshHeightAt(corner[0], corner[1])) < 1e-5), entry.id).toBe(true);
        }
        for (const corner of corners) expect(base, entry.id).toBeLessThan(scene.meshHeightAt(corner[0], corner[1]));
        for (const road of roads) for (let index = 1; index < road.length; index += 1) {
          const a = road[index - 1]!, b = road[index]!;
          expect(lineDistance(p, [a[0], a[2]], [b[0], b[2]]) - radius, entry.id).toBeGreaterThanOrEqual(2.3);
        }
      }
      // Use the production volume list: a ring box once ejected Lantern Crown's low
      // approach onto the high opposite bank before the attempted climb even began.
      const solids = new Solids(resolveFairyDressing(scene).solids);
      for (const probe of FAIRY_LANDFORM_PROBES) {
        const point = [probe.flankFoot[0], scene.meshHeightAt(...probe.flankFoot), probe.flankFoot[1]] as const;
        expect(solids.contains(point), `${probe.id} flank foot occupied`).toBe(false);
        expect(solids.resolve(point, point, .9), `${probe.id} flank foot displaced`).toEqual(point);
      }
      for (const landing of FAIRY_GARDEN_LANDINGS) {
        const dx = landing.to[0] - landing.from[0], dz = landing.to[1] - landing.from[1];
        const length = Math.hypot(dx, dz), steps = Math.ceil(length / .25);
        const points: FairyLandformPoint[] = [];
        for (let step = 0; step <= steps; step++) for (const offset of [-3, -1.5, 0, 1.5, 3]) {
          points.push([landing.from[0] + dx * step / steps - dz / length * offset,
            landing.from[1] + dz * step / steps + dx / length * offset]);
        }
        for (const end of [landing.from, landing.to]) for (let sample = 0; sample < 32; sample++) {
          const angle = sample / 32 * Math.PI * 2;
          points.push([end[0] + Math.cos(angle) * landing.halfWidth, end[1] + Math.sin(angle) * landing.halfWidth]);
        }
        for (const [x, z] of points) {
          const point = [x, scene.meshHeightAt(x, z), z] as const;
          expect(solids.contains(point), `${landing.id} landing occupied at ${x},${z}`).toBe(false);
          expect(solids.resolve(point, point, .9), `${landing.id} landing displaced at ${x},${z}`).toEqual(point);
        }
      }
    } finally {
      scene.clear();
    }
  });
});
