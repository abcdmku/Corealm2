import { FAIRY_REGIONS } from '../content/fairyRegions.js';
import { WORLD_SITES } from '../content/worldSites.js';
import { Rng } from '../core/rng.js';
import { sampleFairyBankHeight } from './fairyBankHeightmaps.js';
import type { FairyCorridorCanopyPoint } from './fairyCorridorCanopy.js';
import { FAIRY_GARDEN_SHOULDERS } from './fairyGardenShoulders.js';
import { FAIRY_ROCK_NATIVE_BOUNDS, type FairyDressingRoad, type FairyLandformDressing } from './fairyLandformDressing.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, sampleFairyRamp, type FairyLandformPoint } from './fairyLandforms.js';
import { FAIRY_GARDEN_LANDINGS, FAIRY_UPPER_GARDEN_RAMPS } from './fairyRegionalRelief.js';
import { seedFromText } from './organicFields.js';

type Ground = (x: number, z: number) => number;
type Tree = FairyCorridorCanopyPoint;
const SPACING = 6.5;
const MAX_PER_GARDEN = 14;
const trunkRadius = (assetId: Tree['assetId'], scale: number): number =>
  (assetId.includes('_hero_') ? 1.75 : assetId.endsWith('_1') ? 1.37 : .95) * scale;

function segmentDistance(point: FairyLandformPoint, a: FairyLandformPoint, b: FairyLandformPoint): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / Math.max(.000001, dx * dx + dz * dz)));
  return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
}

function protectedFloor(position: FairyLandformPoint, radius: number, roads: readonly FairyDressingRoad[]): boolean {
  const [x, z] = position;
  if (x - radius < 2000 || x + radius > 2600 || z - radius < -200 || z + radius > 460) return true;
  for (const landing of FAIRY_GARDEN_LANDINGS) if (segmentDistance(position, landing.from, landing.to) < landing.halfWidth + radius + .9) return true;
  for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
    if (sampleFairyRamp(x, z, ramp).distance < ramp.halfWidth + ramp.shoulder + radius + 1) return true;
    if (Math.hypot(x - ramp.points.at(-1)!.position[0], z - ramp.points.at(-1)!.position[1]) < 6 + radius) return true;
  }
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    if (segmentDistance(position, road.points[i - 1]!, road.points[i]!) < Math.max(3, road.halfWidth) + radius + .9 + (road.allowSway ? 9 : 0)) return true;
  }
  for (const plateau of FAIRY_COMBAT_PLATEAUS) {
    if (Math.hypot(x - plateau.centre[0], z - plateau.centre[1]) < plateau.clearingRadius + 6 + radius) return true;
    for (const ramp of plateau.ramps) if (sampleFairyRamp(x, z, ramp).distance < ramp.halfWidth + ramp.shoulder + radius + 1) return true;
  }
  for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) if (Math.hypot(x - clearing.position[0], z - clearing.position[1]) < clearing.radius + 3 + radius) return true;
  for (const region of FAIRY_REGIONS) {
    if (region.settlement && Math.hypot(x - region.settlement.centre[0], z - region.settlement.centre[1]) < 55 + radius) return true;
    for (const group of region.enemyGroups) if (group.boss && Math.hypot(x - group.centre[0], z - group.centre[1]) < 28 + radius) return true;
    for (const gate of region.gates) if (Math.hypot(x - gate.position[0], z - gate.position[1]) < 7 + radius) return true;
  }
  for (const site of WORLD_SITES) {
    if (site.regionId !== 'gloamgarden' && site.regionId !== 'faeholme') continue;
    const dx = x - site.centre[0], dz = z - site.centre[1], c = Math.cos(site.rotationY), s = Math.sin(site.rotationY);
    if (Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - site.extent[0]),
      Math.max(0, Math.abs(dx * s + dz * c) - site.extent[1])) < radius + 4) return true;
  }
  return false;
}

function supportingSurface(ground: Ground, rocks: readonly FairyLandformDressing[]): Ground {
  const fitted = rocks.flatMap(rock => {
    if (rock.assetId !== 'fairy_rounded_bank_0' && rock.assetId !== 'fairy_rounded_bank_1'
      && rock.assetId !== 'fairy_moss_bank_0' && rock.assetId !== 'fairy_moss_bank_1') return [];
    // Only nearby rock bodies can support these nine small authored groves.
    const bounds = FAIRY_ROCK_NATIVE_BOUNDS[rock.assetId], reach = Math.hypot(bounds[0], bounds[2]) * rock.scale / 2;
    if (!FAIRY_GARDEN_SHOULDERS.some(shoulder => Math.hypot(rock.position[0] - shoulder.centre[0], rock.position[1] - shoulder.centre[1])
      < Math.max(...shoulder.radii) * 1.15 + reach + 2)) return [];
    return [{ ...rock, assetId: rock.assetId, cosine: Math.cos(rock.rotationY), sine: Math.sin(rock.rotationY),
      halfX: bounds[0] * rock.scale / 2, halfZ: bounds[2] * rock.scale / 2,
      base: ground(...rock.position) + rock.heightOffset - rock.sink }];
  });
  return (x, z) => {
    let highest = ground(x, z);
    if (!Number.isFinite(highest)) throw new Error(`Invalid garden grove terrain at ${x},${z}`);
    for (const rock of fitted) {
      const dx = x - rock.position[0], dz = z - rock.position[1];
      const lx = dx * rock.cosine - dz * rock.sine, lz = dx * rock.sine + dz * rock.cosine;
      if (Math.abs(lx) > rock.halfX || Math.abs(lz) > rock.halfZ) continue;
      const top = sampleFairyBankHeight(rock.assetId, lx / rock.scale, lz / rock.scale);
      if (top !== null) highest = Math.max(highest, rock.base + top * rock.scale);
    }
    return highest;
  };
}

function rootSupport(position: FairyLandformPoint, radius: number, surface: Ground) {
  const centre = surface(...position);
  let minimum = centre, slope = 0;
  const sample = (dx: number, dz: number): void => {
    const height = surface(position[0] + dx, position[1] + dz), distance = Math.hypot(dx, dz);
    minimum = Math.min(minimum, height);
    if (distance > .01) slope = Math.max(slope, Math.abs(height - centre) / distance);
  };
  const steps = Math.ceil(radius / .25);
  for (let ix = -steps; ix <= steps; ix++) for (let iz = -steps; iz <= steps; iz++) {
    const dx = ix * radius / steps, dz = iz * radius / steps;
    if (Math.hypot(dx, dz) <= radius) sample(dx, dz);
  }
  for (let i = 0; i < 32; i++) sample(Math.cos(i * Math.PI / 16) * radius, Math.sin(i * Math.PI / 16) * radius);
  return { minimum, slope };
}

/** Authored-world composition: accepted native trees rooted in the final shared terrain and rock meshes. */
export function buildFairyGardenGroves(ground: Ground, roads: readonly FairyDressingRoad[],
  rocks: readonly FairyLandformDressing[], existingTrees: readonly Pick<Tree, 'position'>[]): Tree[] {
  const surface = supportingSurface(ground, rocks), result: Tree[] = [];
  const groups = new Map<string, { point: Tree; score: number }[][]>();
  for (const shoulder of FAIRY_GARDEN_SHOULDERS) {
    const rng = new Rng(seedFromText(`fairy_grove_${shoulder.id}`)), candidates: { point: Tree; score: number }[] = [];
    const palette = shoulder.regionId === 'gloamgarden' ? 'gloam' : 'fae';
    // Offset rings supply flat crowns and quieter outer flanks; selection breaks the ring into clumps.
    let index = 0;
    for (const band of [0, .24, .42, .62, .82, 1.02]) {
      const count = band === 0 ? 1 : Math.ceil(14 + band * 30), phase = rng.float(0, Math.PI * 2);
      for (let step = 0; step < count; step++) {
        const angle = phase + step * Math.PI * 2 / count + rng.float(-.05, .05), radial = band === 0 ? 0 : band + rng.float(-.04, .04);
        const position: FairyLandformPoint = [shoulder.centre[0] + Math.cos(angle) * shoulder.radii[0] * radial,
          shoulder.centre[1] + Math.sin(angle) * shoulder.radii[1] * radial];
        const hero = rng.chance(.8), assetId: Tree['assetId'] = hero ? `fairy_hero_${palette}_sheltered` : `fairy_canopy_${palette}_${rng.chance(.5) ? 1 : 2}`;
        const scale = hero ? rng.float(.8, 1) : rng.float(.9, 1.1), rotationY = rng.float(0, Math.PI * 2), priority = rng.next();
        const id = `fairy_grove_${shoulder.id}_${index++}`, radius = trunkRadius(assetId, scale);
        if (protectedFloor(position, radius, roads)) continue;
        if (existingTrees.some(tree => Math.hypot(position[0] - tree.position[0], position[1] - tree.position[1]) < SPACING)) continue;
        const support = rootSupport(position, radius, surface);
        // Leave a little margin for terrain-triangle creases between the radial foot probes.
        if (support.slope >= .5) continue;
        candidates.push({ point: { id, regionId: shoulder.regionId, assetId, position, scale, rotationY,
          heightOffset: support.minimum - ground(...position), sink: .03 },
        score: priority * .4 + (1 - Math.min(1, radial)) * .7 + (hero ? .15 : 0) + (.55 - support.slope) * .3 });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.point.id.localeCompare(b.point.id));
    const group = shoulder.id.slice(0, shoulder.id.indexOf('_')), queues = groups.get(group) ?? [];
    queues.push(candidates); groups.set(group, queues);
  }
  // Round-robin knolls keep both flanks and the saddle represented before adding depth.
  for (const queues of groups.values()) {
    let selected = 0, progress = true;
    while (selected < MAX_PER_GARDEN && progress) {
      progress = false;
      for (const queue of queues) {
        while (queue.length && selected < MAX_PER_GARDEN) {
          const candidate = queue.shift()!.point;
          if (result.some(tree => Math.hypot(candidate.position[0] - tree.position[0], candidate.position[1] - tree.position[1]) < SPACING)) continue;
          result.push(candidate); selected++; progress = true; break;
        }
      }
    }
  }
  return result;
}
