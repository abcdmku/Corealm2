import { FAIRY_REGIONS } from '../content/fairyRegions.js';
import { Rng } from '../core/rng.js';
import { FAIRY_BANK_HEIGHTMAPS, sampleFairyBankHeight } from './fairyBankHeightmaps.js';
import {
  FAIRY_ROCK_NATIVE_BOUNDS, fairyDressingBodyRadius, fairyDressingClearance, fairyDressingFootprint,
  fairyDressingLandingClearance, fairyDressingRectangleDistance as rectangleRoadDistance,
  type FairyDressingRoad, type FairyLandformDressing,
} from './fairyLandformDressing.js';
import { sampleFairyRamp, type FairyLandformPoint, type FairyLandformRegion } from './fairyLandforms.js';
import { FAIRY_UPPER_GARDEN_RAMPS } from './fairyRegionalRelief.js';
import { seedFromText } from './organicFields.js';

type Ground = (x: number, z: number) => number;
type RoundedAsset = 'fairy_rounded_bank_0' | 'fairy_rounded_bank_1';
type RoadFrame = { position: FairyLandformPoint; tangent: FairyLandformPoint };
type RoadLength = { road: FairyDressingRoad; cumulative: number[]; length: number };

const PER_REGION_LIMIT = 180;
const ASSETS: readonly RoundedAsset[] = ['fairy_rounded_bank_0', 'fairy_rounded_bank_1'];
const WALKING_HALF_WIDTH = 2.5;
const WALKER_RADIUS = .9;
function surfaceProbes(assetId: RoundedAsset): readonly (readonly [number, number, number])[] {
  const map = FAIRY_BANK_HEIGHTMAPS[assetId];
  const samples: [number, number, number][] = [];
  for (let ix = 0; ix < (map.width - 1) * 2; ix++) for (let iz = 0; iz < (map.depth - 1) * 2; iz++) {
    const x = map.origin[0] + ix * map.spacing / 2, z = map.origin[1] + iz * map.spacing / 2;
    const height = sampleFairyBankHeight(assetId, x, z);
    if (height !== null) samples.push([x, z, height]);
  }
  return samples;
}
const SURFACE_PROBES: Record<RoundedAsset, readonly (readonly [number, number, number])[]> = {
  fairy_rounded_bank_0: surfaceProbes('fairy_rounded_bank_0'),
  fairy_rounded_bank_1: surfaceProbes('fairy_rounded_bank_1'),
};

function pointSegmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(1e-10, dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

function corridorClear(entry: FairyLandformDressing, roads: readonly FairyDressingRoad[]): boolean {
  const radius = fairyDressingBodyRadius(entry);
  // Protected structures, resource sites, combat crowns and their ramps retain the conservative circle.
  if (fairyDressingClearance(entry, []) < .02) return false;
  if (fairyDressingLandingClearance(entry) < 0) return false;
  for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
    if (sampleFairyRamp(...entry.position, ramp).distance < ramp.halfWidth + ramp.shoulder + radius + 1) return false;
    const top = ramp.points[ramp.points.length - 1]!.position;
    if (Math.hypot(entry.position[0] - top[0], entry.position[1] - top[1]) < radius + 6) return false;
  }
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!;
    const sway = road.allowSway ? Math.min(9, Math.max(0, Math.hypot(b[0] - a[0], b[1] - a[1]) - 14) * .11) : 0;
    const reserve = Math.max(WALKING_HALF_WIDTH, road.halfWidth) + WALKER_RADIUS + .05 + sway;
    if (pointSegmentDistance(...entry.position, ...a, ...b) > radius + reserve) continue;
    if (rectangleRoadDistance(entry, a, b) < reserve) return false;
  }
  return true;
}

function roadLengths(road: FairyDressingRoad): RoadLength {
  const cumulative = [0];
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { road, cumulative, length: cumulative[cumulative.length - 1]! };
}

function roadFrame(line: RoadLength, distance: number): RoadFrame | null {
  if (distance < 1 || distance > line.length - 1) return null;
  for (let i = 1; i < line.cumulative.length; i++) {
    const start = line.cumulative[i - 1]!, end = line.cumulative[i]!;
    if (end < distance || end - start < .00001) continue;
    const a = line.road.points[i - 1]!, b = line.road.points[i]!, t = (distance - start) / (end - start);
    return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      tangent: [(b[0] - a[0]) / (end - start), (b[1] - a[1]) / (end - start)] };
  }
  return null;
}

function regionAt([x, z]: FairyLandformPoint): FairyLandformRegion | null {
  const region = FAIRY_REGIONS.find(region => x >= region.bounds.min[0] && x <= region.bounds.max[0]
    && z >= region.bounds.min[1] && z <= region.bounds.max[1]);
  return region?.id === 'gloamgarden' || region?.id === 'faeholme' ? region.id : null;
}

/** Sample the receiving ground across the entire rotated native box, including its corners. */
function groundRange(entry: FairyLandformDressing, ground: Ground): readonly [number, number] {
  let minimum = Infinity, maximum = -Infinity;
  const sample = (x: number, z: number) => {
    const height = ground(x, z);
    if (!Number.isFinite(height)) throw new Error(`Invalid terrain under ${entry.id}`);
    minimum = Math.min(minimum, height); maximum = Math.max(maximum, height);
  };
  for (const [x, z] of fairyDressingFootprint(entry)) sample(x, z);
  // The final fairy terrain is a one-metre triangle lattice. Its minimum within an OBB
  // lies at a contained lattice vertex or where the box edge crosses a triangle edge.
  // Include those exact points so a crease between ordinary footprint samples cannot float.
  const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId], hx = bounds[0] * entry.scale / 2,
    hz = bounds[2] * entry.scale / 2, c = Math.cos(entry.rotationY), s = Math.sin(entry.rotationY);
  const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) =>
    [entry.position[0] + x! * c + z! * s, entry.position[1] - x! * s + z! * c] as const);
  for (let x = Math.ceil(Math.min(...corners.map(p => p[0]))); x <= Math.floor(Math.max(...corners.map(p => p[0]))); x++) {
    for (let z = Math.ceil(Math.min(...corners.map(p => p[1]))); z <= Math.floor(Math.max(...corners.map(p => p[1]))); z++) {
      const dx = x - entry.position[0], dz = z - entry.position[1];
      if (Math.abs(dx * c - dz * s) <= hx && Math.abs(dx * s + dz * c) <= hz) sample(x, z);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!, b = corners[(i + 1) % 4]!;
    for (const [nx, nz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const start = a[0] * nx! + a[1] * nz!, end = b[0] * nx! + b[1] * nz!;
      if (Math.abs(end - start) < 1e-9) continue;
      for (let edge = Math.ceil(Math.min(start, end)); edge <= Math.floor(Math.max(start, end)); edge++) {
        const t = (edge - start) / (end - start);
        sample(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      }
    }
  }
  return [minimum, maximum];
}

/** Only native rock that actually emerges along the lane-facing half earns an instance. */
function visibleFace(entry: FairyLandformDressing, assetId: RoundedAsset, ground: Ground,
  base: number, outward: FairyLandformPoint): { score: number; extraBurial: number } | null {
  const c = Math.cos(entry.rotationY), s = Math.sin(entry.rotationY);
  let maximum = 0;
  const facing: number[] = [];
  for (const [x, z, top] of SURFACE_PROBES[assetId]) {
    const dx = (x * c + z * s) * entry.scale, dz = (-x * s + z * c) * entry.scale;
    const exposure = base + top * entry.scale - ground(entry.position[0] + dx, entry.position[1] + dz);
    maximum = Math.max(maximum, exposure);
    if (dx * outward[0] + dz * outward[1] <= .3 * entry.scale) facing.push(exposure);
  }
  // Extra burial preserves a low skyline even where a tilted receiving face exposes a high lobe.
  // Dense native samples target 2.1m, leaving 0.4m for between-sample relief below the 2.5m limit.
  const extraBurial = Math.max(0, maximum - 2.1);
  let visible = 0, total = 0, frontMaximum = 0;
  for (const raw of facing) {
    const exposure = raw - extraBurial;
    frontMaximum = Math.max(frontMaximum, exposure);
    if (exposure > .18) { visible++; total += exposure; }
  }
  if (frontMaximum < .7 || visible / facing.length < .1) return null;
  return { score: total / facing.length + Math.min(1.8, frontMaximum) * .2, extraBurial };
}

/**
 * Authored full-world placement of lab-accepted rounded rocks. The shared regional terrain
 * remains the bank; these short, separated groups expose native stone along selected walls.
 * Pass the production mesh sampler and resolved road curves, including hollow routes.
 */
export function buildFairyCorridorDressing(ground: Ground,
  roads: readonly FairyDressingRoad[]): FairyLandformDressing[] {
  const groups: { key: string; seed: number; line: RoadLength; distance: number;
    regionId: FairyLandformRegion; side: number }[] = [];
  for (const [roadIndex, road] of roads.entries()) {
    if (road.points.length < 2) continue;
    const line = roadLengths(road), first = road.points[0]!, last = road.points[road.points.length - 1]!;
    const key = `fairy_corridor_${first.join('_')}_${last.join('_')}_${roadIndex}`;
    const rng = new Rng(seedFromText(key));
    for (let distance = rng.float(6, 11), station = 0; distance < line.length - 4; distance += rng.float(10.5, 14), station++) {
      const frame = roadFrame(line, distance), regionId = frame && regionAt(frame.position);
      if (!regionId || rng.chance(.16)) continue;
      const groupKey = `${key}_${station}`, seed = seedFromText(groupKey), side = (seed & 1) ? 1 : -1;
      groups.push({ key: groupKey, seed, line, distance, regionId, side });
      // Selected stretches also receive a staggered opposite outcrop, leaving asymmetric gaps.
      if (seed % 10 < 7) {
        const oppositeKey = `${groupKey}_opposite`;
        groups.push({ key: oppositeKey, seed: seedFromText(oppositeKey), line,
          distance: distance + 3 + seed % 5, regionId, side: -side });
      }
    }
  }
  // Stable shuffled priority distributes the capped budget over both regions and all roads.
  groups.sort((a, b) => a.seed - b.seed);
  const entries: FairyLandformDressing[] = [];
  const counts: Record<FairyLandformRegion, number> = { gloamgarden: 0, faeholme: 0 };
  for (const group of groups) {
    if (counts[group.regionId] >= PER_REGION_LIMIT) continue;
    const rng = new Rng(group.seed), side = group.side;
    const pieces = rng.chance(.32) ? 3 : 2, spacing = rng.float(5.5, 7.4);
    for (let piece = 0; piece < pieces && counts[group.regionId] < PER_REGION_LIMIT; piece++) {
      const frame = roadFrame(group.line, group.distance + (piece - (pieces - 1) / 2) * spacing);
      if (!frame) continue;
      const assetId = ASSETS[rng.int(0, 1)]!;
      const outward: FairyLandformPoint = [-frame.tangent[1] * side, frame.tangent[0] * side];
      const wallRise = ground(frame.position[0] + outward[0] * 18, frame.position[1] + outward[1] * 18) - ground(...frame.position);
      const scale = Math.min(2.3, Math.max(1.3, (wallRise + .5) / 3 * rng.float(.84, 1.01)));
      const rotationY = Math.atan2(-frame.tangent[1], frame.tangent[0]) + (side < 0 ? Math.PI : 0) + rng.float(-.35, .35);
      const radius = fairyDressingBodyRadius({ assetId, scale });
      const bounds = FAIRY_ROCK_NATIVE_BOUNDS[assetId], c = Math.cos(rotationY), s = Math.sin(rotationY);
      const normalExtent = (Math.abs(outward[0] * c - outward[1] * s) * bounds[0]
        + Math.abs(outward[0] * s + outward[1] * c) * bounds[2]) * scale / 2;
      let best: FairyLandformDressing | null = null, bestScore = -Infinity;
      for (const inset of [.08, .45, .95, 1.5]) {
        const distance = normalExtent + Math.max(WALKING_HALF_WIDTH, group.line.road.halfWidth) + WALKER_RADIUS + .05 + inset;
        const position: FairyLandformPoint = [frame.position[0] + outward[0] * distance, frame.position[1] + outward[1] * distance];
        if (regionAt(position) !== group.regionId) continue;
        const entry: FairyLandformDressing = { id: `${group.key}_stone_${piece}`, landformId: group.key,
          regionId: group.regionId, assetId, position, rotationY, scale, sink: .18 * scale + .06, heightOffset: 0 };
        if (!corridorClear(entry, roads)) continue;
        if (entries.some(other => other.landformId !== group.key
          && Math.hypot(position[0] - other.position[0], position[1] - other.position[1])
            < Math.min(radius, fairyDressingBodyRadius(other)) * .74)) continue;
        const [floor, ceiling] = groundRange(entry, ground), origin = ground(...position);
        if (!Number.isFinite(origin)) throw new Error(`Invalid terrain under ${entry.id}`);
        // Flat ridge caps and isolated valley-floor boulders do not dress a receiving wall.
        if (ceiling - floor < .7 || ceiling - ground(...frame.position) < 2) continue;
        const fit = visibleFace(entry, assetId, ground, floor - entry.sink, outward);
        if (!fit) continue;
        const score = fit.score - inset * .06;
        if (score > bestScore) {
          bestScore = score;
          best = { ...entry, sink: entry.sink + fit.extraBurial, heightOffset: floor - origin };
        }
      }
      if (best) { entries.push(best); counts[group.regionId]++; }
    }
  }
  return entries;
}
