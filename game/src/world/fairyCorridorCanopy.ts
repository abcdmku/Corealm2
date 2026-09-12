import { FAIRY_REGIONS } from '../content/fairyRegions.js';
import { WORLD_SITES } from '../content/worldSites.js';
import { Rng } from '../core/rng.js';
import { sampleFairyBankHeight } from './fairyBankHeightmaps.js';
import { FAIRY_ROCK_NATIVE_BOUNDS, type FairyDressingRoad, type FairyLandformDressing } from './fairyLandformDressing.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, sampleFairyRamp,
  type FairyLandformPoint, type FairyLandformRegion } from './fairyLandforms.js';
import { FAIRY_GARDEN_LANDINGS, FAIRY_UPPER_GARDEN_RAMPS } from './fairyRegionalRelief.js';
import { organicRadiusScale, seedFromText } from './organicFields.js';

type Ground = (x: number, z: number) => number;
type TreeAsset = `fairy_hero_${'gloam' | 'fae'}_sheltered` | `fairy_canopy_${'gloam' | 'fae'}_${1 | 2}`;
export interface FairyCorridorCanopyPoint {
  readonly id: string;
  readonly regionId: FairyLandformRegion;
  readonly assetId: TreeAsset;
  readonly position: FairyLandformPoint;
  readonly scale: number;
  readonly rotationY: number;
  /** Supporting surface minus final terrain. Scatter applies native groundY separately. */
  readonly heightOffset: number;
  readonly sink: number;
}

const MAX_PER_REGION = 450;
const TREE_SPACING = 6.5;
// The outer village heroes reach 46.5m from the town centre. This leaves them 8m of room.
const TOWN_RESERVE = 55;
const FOOT_SLOPE_LIMIT = .55;

function nativeTrunkRadius(assetId: TreeAsset): number {
  return assetId.includes('_hero_') ? 1.75 : assetId.endsWith('_1') ? 1.37 : .95;
}

function nearestRoad(point: FairyLandformPoint, roads: readonly FairyDressingRoad[]) {
  let distance = Infinity, position: FairyLandformPoint = point;
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!, dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz)
      / Math.max(.000001, dx * dx + dz * dz)));
    const x = a[0] + dx * t, z = a[1] + dz * t, d = Math.hypot(point[0] - x, point[1] - z);
    if (d < distance) { distance = d; position = [x, z]; }
  }
  return { distance, position };
}

function rectangleDistance(point: FairyLandformPoint, centre: FairyLandformPoint,
  hx: number, hz: number, yaw: number): number {
  const dx = point[0] - centre[0], dz = point[1] - centre[1], c = Math.cos(yaw), s = Math.sin(yaw);
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - hx), Math.max(0, Math.abs(dx * s + dz * c) - hz));
}

/** Highest real support at XZ, using the exact same rock base and uniform transform as rendering. */
function supportingSurface(ground: Ground, rocks: readonly FairyLandformDressing[]): Ground {
  const fitted = rocks.flatMap(rock => {
    if (rock.assetId !== 'fairy_rounded_bank_0' && rock.assetId !== 'fairy_rounded_bank_1'
      && rock.assetId !== 'fairy_moss_bank_0' && rock.assetId !== 'fairy_moss_bank_1') return [];
    const bounds = FAIRY_ROCK_NATIVE_BOUNDS[rock.assetId];
    return [{ ...rock, assetId: rock.assetId, cosine: Math.cos(rock.rotationY), sine: Math.sin(rock.rotationY),
      halfX: bounds[0] * rock.scale / 2, halfZ: bounds[2] * rock.scale / 2,
      reach: Math.hypot(bounds[0], bounds[2]) * rock.scale / 2,
      base: ground(...rock.position) + rock.heightOffset - rock.sink }];
  });
  const buckets = new Map<string, typeof fitted>();
  for (const rock of fitted) {
    for (let x = Math.floor((rock.position[0] - rock.reach) / 24); x <= Math.floor((rock.position[0] + rock.reach) / 24); x++) {
      for (let z = Math.floor((rock.position[1] - rock.reach) / 24); z <= Math.floor((rock.position[1] + rock.reach) / 24); z++) {
        const key = `${x}:${z}`, list = buckets.get(key) ?? [];
        list.push(rock); buckets.set(key, list);
      }
    }
  }
  return (x, z) => {
    let surface = ground(x, z);
    if (!Number.isFinite(surface)) throw new Error(`Invalid canopy terrain at ${x},${z}`);
    for (const rock of buckets.get(`${Math.floor(x / 24)}:${Math.floor(z / 24)}`) ?? []) {
      const dx = x - rock.position[0], dz = z - rock.position[1];
      const lx = dx * rock.cosine - dz * rock.sine, lz = dx * rock.sine + dz * rock.cosine;
      if (Math.abs(lx) > rock.halfX || Math.abs(lz) > rock.halfZ) continue;
      const top = sampleFairyBankHeight(rock.assetId, lx / rock.scale, lz / rock.scale);
      if (top !== null) surface = Math.max(surface, rock.base + top * rock.scale);
    }
    return surface;
  };
}

function rootSupport(position: FairyLandformPoint, radius: number, surface: Ground) {
  const centre = surface(...position);
  let minimum = centre, slope = 0;
  const sample = (x: number, z: number): void => {
    const height = surface(position[0] + x, position[1] + z), distance = Math.hypot(x, z);
    minimum = Math.min(minimum, height);
    if (distance > .01) slope = Math.max(slope, Math.abs(height - centre) / distance);
  };
  const steps = Math.ceil(radius / .3);
  for (let ix = -steps; ix <= steps; ix++) for (let iz = -steps; iz <= steps; iz++) {
    const x = ix * radius / steps, z = iz * radius / steps;
    if (Math.hypot(x, z) <= radius) sample(x, z);
  }
  for (let i = 0; i < 24; i++) sample(Math.cos(i * Math.PI / 12) * radius, Math.sin(i * Math.PI / 12) * radius);
  return { minimum, slope };
}

function protectedFloor(position: FairyLandformPoint, radius: number, roads: readonly FairyDressingRoad[]): boolean {
  const [x, z] = position;
  if (x - radius < 2000 || x + radius > 2600 || z - radius < -200 || z + radius > 460) return true;
  for (const region of FAIRY_REGIONS) {
    if (region.settlement && Math.hypot(x - region.settlement.centre[0], z - region.settlement.centre[1]) < TOWN_RESERVE + radius) return true;
    for (const group of region.enemyGroups) if (group.boss && Math.hypot(x - group.centre[0], z - group.centre[1]) < 28 + radius) return true;
    for (const gate of region.gates) if (Math.hypot(x - gate.position[0], z - gate.position[1]) < 7 + radius) return true;
  }
  for (const plateau of FAIRY_COMBAT_PLATEAUS) {
    if (Math.hypot(x - plateau.centre[0], z - plateau.centre[1]) < plateau.clearingRadius + 6 + radius) return true;
    for (const ramp of plateau.ramps) if (sampleFairyRamp(x, z, ramp).distance < ramp.halfWidth + ramp.shoulder + radius + 1) return true;
  }
  for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) {
    if (Math.hypot(x - clearing.position[0], z - clearing.position[1]) < clearing.radius + 3 + radius) return true;
  }
  for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
    if (sampleFairyRamp(x, z, ramp).distance < ramp.halfWidth + ramp.shoulder + radius + 1) return true;
    const top = ramp.points[ramp.points.length - 1]!.position;
    if (Math.hypot(x - top[0], z - top[1]) < 6 + radius) return true;
  }
  for (const landing of FAIRY_GARDEN_LANDINGS) {
    const distance = nearestRoad(position, [{ points: [landing.from, landing.to],
      halfWidth: landing.halfWidth, allowSway: false }]).distance;
    if (distance < landing.halfWidth + radius + .9) return true;
  }
  for (const site of WORLD_SITES) {
    if (site.regionId !== 'gloamgarden' && site.regionId !== 'faeholme') continue;
    if (rectangleDistance(position, site.centre, site.extent[0], site.extent[1], site.rotationY) < radius + 4) return true;
  }
  for (const road of roads) {
    const sway = road.allowSway ? 9 : 0;
    if (nearestRoad(position, [road]).distance < Math.max(3, road.halfWidth) + radius + .9 + sway) return true;
  }
  return false;
}

/**
 * Upper-bank tree placement is an authored-world exception: all tree assets already passed the lab.
 * Ground and native rock tops supply the supporting surface; buried rock rectangles do not exclude it.
 */
export function buildFairyCorridorCanopy(ground: Ground, roads: readonly FairyDressingRoad[],
  corridorRocks: readonly FairyLandformDressing[]): FairyCorridorCanopyPoint[] {
  return censusFairyCorridorCanopy(ground, roads, corridorRocks).points;
}

export interface FairyCorridorCanopyCensus {
  readonly points: FairyCorridorCanopyPoint[];
  readonly regions: Readonly<Record<FairyLandformRegion, {
    attempted: number; protected: number; unsupported: number;
    eligible: number; uncapped: number; selected: number; corridor: number; rim: number;
  }>>;
  readonly plateauRims: Readonly<Record<string, { eligible: number; uncapped: number; selected: number }>>;
}

/** CPU census shares the exact production selection, including counts before regional caps. */
export function censusFairyCorridorCanopy(ground: Ground, roads: readonly FairyDressingRoad[],
  corridorRocks: readonly FairyLandformDressing[]): FairyCorridorCanopyCensus {
  const surface = supportingSurface(ground, corridorRocks);
  const emptyRegion = () => ({ attempted: 0, protected: 0, unsupported: 0, eligible: 0, uncapped: 0, selected: 0, corridor: 0, rim: 0 });
  const regions = { gloamgarden: emptyRegion(), faeholme: emptyRegion() };
  const plateauRims: Record<string, { eligible: number; uncapped: number; selected: number }> = {};
  const candidates: { point: FairyCorridorCanopyPoint; score: number; plateauId?: string }[] = [];
  const consider = (id: string, position: FairyLandformPoint, rng: Rng, plateauId?: string, valleyHeight?: number): void => {
    const region = FAIRY_REGIONS.find(region => position[0] >= region.bounds.min[0] && position[0] <= region.bounds.max[0]
      && position[1] >= region.bounds.min[1] && position[1] <= region.bounds.max[1]);
    if (!region || (region.id !== 'gloamgarden' && region.id !== 'faeholme')) return;
    const counts = regions[region.id]; counts.attempted++;
    const palette = region.id === 'gloamgarden' ? 'gloam' : 'fae';
    const hero = rng.chance(.7), variant = rng.chance(.5) ? 1 : 2;
    const assetId: TreeAsset = hero ? `fairy_hero_${palette}_sheltered` : `fairy_canopy_${palette}_${variant}`;
    const scale = hero ? rng.float(.75, 1) : rng.float(.9, 1.1), radius = nativeTrunkRadius(assetId) * scale;
    const rotationY = rng.float(0, Math.PI * 2), priority = rng.next();
    const lane = nearestRoad(position, roads);
    if ((!plateauId && (lane.distance < 8 || lane.distance > 24)) || protectedFloor(position, radius, roads)) {
      counts.protected++; return;
    }
    const support = rootSupport(position, radius, surface), terrain = ground(...position);
    const receivingFloor = valleyHeight ?? ground(...lane.position);
    if (support.slope >= FOOT_SLOPE_LIMIT || support.minimum - receivingFloor < 3) { counts.unsupported++; return; }
    const point: FairyCorridorCanopyPoint = { id, regionId: region.id, assetId, position, scale, rotationY,
      heightOffset: support.minimum - terrain, sink: .03 };
    // The first shoulder receives priority, with quieter depth behind it. Plateau
    // bands get enough weight to frame each encounter rather than losing to long roads.
    const score = plateauId ? 1.1 + priority * .65 + (hero ? .1 : 0)
      : priority * .75 + Math.max(0, 14 - lane.distance) * .09 + (hero ? .15 : 0)
        + (support.minimum - terrain > .12 ? .2 : 0) + (FOOT_SLOPE_LIMIT - support.slope) * .2;
    candidates.push({ point, score, ...(plateauId ? { plateauId } : {}) }); counts.eligible++;
    if (plateauId) plateauRims[plateauId]!.eligible++;
  };
  for (const [roadIndex, road] of roads.entries()) {
    if (road.points.length < 2) continue;
    const key = `fairy_upper_canopy_${roadIndex}_${road.points[0]!.join('_')}`;
    const rng = new Rng(seedFromText(key));
    let travelled = 0, next = rng.float(3, 7), station = 0;
    for (let segment = 1; segment < road.points.length; segment++) {
      const a = road.points[segment - 1]!, b = road.points[segment]!, dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (length < .00001) continue;
      while (next < travelled + length) {
        const t = (next - travelled) / length, centre: FairyLandformPoint = [a[0] + dx * t, a[1] + dz * t];
        for (const side of [-1, 1]) for (const offset of [8.6, 10.5, 12.4, 15.5, 19, 22.5]) {
          const distance = offset + rng.float(-.45, .45);
          const position: FairyLandformPoint = [centre[0] - dz / length * side * distance, centre[1] + dx / length * side * distance];
          consider(`${key}_${station}_${side}_${offset}`, position, rng);
        }
        next += rng.float(6.5, 9.5); station++;
      }
      travelled += length;
    }
  }
  for (const plateau of FAIRY_COMBAT_PLATEAUS) {
    plateauRims[plateau.id] = { eligible: 0, uncapped: 0, selected: 0 };
    const rng = new Rng(seedFromText(`fairy_upper_rim_${plateau.id}`));
    const valleyHeight = Math.min(...plateau.ramps.map(ramp => ground(...ramp.points[0]!.position)));
    const inner = plateau.clearingRadius + 9;
    let station = 0;
    for (let angle = rng.float(0, .15); angle < Math.PI * 2; angle += rng.float(.15, .23)) {
      const outer = plateau.radius * organicRadiusScale(angle, plateau.shape) - plateau.cliffWidth - 3;
      for (const band of [0, .5, 1]) {
        const radial = inner + Math.max(0, outer - inner) * band + rng.float(-1.1, 1.1);
        const turn = angle + rng.float(-.025, .025);
        consider(`fairy_upper_rim_${plateau.id}_${station}_${band}`,
          [plateau.centre[0] + Math.cos(turn) * radial, plateau.centre[1] + Math.sin(turn) * radial], rng, plateau.id, valleyHeight);
      }
      station++;
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.point.id.localeCompare(b.point.id));
  const points: FairyCorridorCanopyPoint[] = [];
  const occupied = new Map<string, FairyCorridorCanopyPoint[]>();
  for (const { point, plateauId } of candidates) {
    const bx = Math.floor(point.position[0] / TREE_SPACING), bz = Math.floor(point.position[1] / TREE_SPACING);
    let crowded = false;
    for (let x = bx - 1; x <= bx + 1; x++) for (let z = bz - 1; z <= bz + 1; z++) {
      if ((occupied.get(`${x}:${z}`) ?? []).some(other =>
        Math.hypot(point.position[0] - other.position[0], point.position[1] - other.position[1]) < TREE_SPACING)) crowded = true;
    }
    if (crowded) continue;
    const bucket = occupied.get(`${bx}:${bz}`) ?? []; bucket.push(point); occupied.set(`${bx}:${bz}`, bucket);
    const counts = regions[point.regionId]; counts.uncapped++;
    if (plateauId) plateauRims[plateauId]!.uncapped++;
    if (counts.selected >= MAX_PER_REGION) continue;
    points.push(point); counts.selected++;
    if (plateauId) { counts.rim++; plateauRims[plateauId]!.selected++; } else counts.corridor++;
  }
  return { points, regions, plateauRims };
}
