import { FAIRY_REGIONS } from '../content/fairyRegions.js';
import { WORLD_SITES } from '../content/worldSites.js';
import { Rng } from '../core/rng.js';
import {
  applyFairyLandforms, FAIRY_ASCENT_ROUTES, FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS,
  FAIRY_LANDFORMS, FAIRY_VALLEY_ROUTE_CONTROLS, FAIRY_VILLAGE_BANKS, sampleFairyRamp,
  type FairyLandformPoint, type FairyLandformRegion, type FairyLandformSpec,
} from './fairyLandforms.js';
import { organicDistance, organicRadiusScale, seedFromText } from './organicFields.js';
import { FAIRY_GARDEN_LANDINGS } from './fairyRegionalRelief.js';

/** Accepted Pure Nature LOD0 bounds after rigid centring and grounding, with native detail intact. */
export const FAIRY_ROCK_NATIVE_BOUNDS = {
  fairy_rounded_bank_0: [6.851807117462158, 3.049999952316284, 6.978183269500732],
  fairy_rounded_bank_1: [7.1101720333099365, 2.950000047683716, 6.063823223114014],
  fairy_moss_bank_0: [7.09381591796875, 4.525413055419922, 5.415751342773437],
  fairy_moss_bank_1: [7.4940390625, 4.80681005859375, 6.894029052734375],
  fairy_boulder_4: [7.378790283203125, 7.988142700195312, 6.01126708984375],
  fairy_boulder_0: [3.360489196777344, 7.96428955078125, 3.0133221435546877],
} as const;

export type FairyRockAsset = keyof typeof FAIRY_ROCK_NATIVE_BOUNDS;

export interface FairyLandformDressing {
  readonly id: string;
  readonly landformId: string;
  readonly regionId: FairyLandformRegion;
  readonly assetId: FairyRockAsset;
  readonly position: FairyLandformPoint;
  readonly rotationY: number;
  readonly scale: number;
  readonly sink: number;
  /** Render y = groundHeight(position) + heightOffset - sink. */
  readonly heightOffset: number;
}

export interface FairyDressingRoad {
  readonly points: readonly FairyLandformPoint[];
  readonly halfWidth: number;
  /** Authored chords allow the production road's bounded sway. Resolved curves set this false. */
  readonly allowSway: boolean;
}

/** Roads include the mine apron overrides, village lanes and every explicit plateau ascent. */
export const FAIRY_DRESSING_AUTHORED_ROADS: readonly FairyDressingRoad[] = [
  ...FAIRY_REGIONS.flatMap(region => region.roads.flatMap(road => {
    const override = FAIRY_VALLEY_ROUTE_CONTROLS.find(entry => entry.from === road.from && entry.to === road.to);
    if (override) return [{ points: override.points, halfWidth: 1.3, allowSway: true }];
    const from = region.locations.find(location => location.id === road.from);
    const to = region.locations.find(location => location.id === road.to);
    return from && to ? [{ points: [from.position, to.position], halfWidth: 1.3, allowSway: true }] : [];
  })),
  ...FAIRY_ASCENT_ROUTES.map(route => ({ points: route.points, halfWidth: route.width / 2, allowSway: true })),
];

/** A containing circle reserves the complete scaled native box, including its far corners. */
export function fairyDressingBodyRadius(entry: Pick<FairyLandformDressing, 'assetId' | 'scale'>): number {
  const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
  return Math.hypot(bounds[0], bounds[2]) * entry.scale / 2;
}

export function fairyDressingFootprint(entry: Pick<FairyLandformDressing, 'assetId' | 'scale' | 'position' | 'rotationY'>): readonly FairyLandformPoint[] {
  const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId];
  const halfX = bounds[0] * entry.scale / 2, halfZ = bounds[2] * entry.scale / 2;
  const cosine = Math.cos(entry.rotationY), sine = Math.sin(entry.rotationY);
  const points: FairyLandformPoint[] = [];
  // Large cliff pieces span more than ten metres. Sample their whole native box at
  // sub-metre cadence so a low crease between the corners cannot leave an exposed underside.
  const columns = Math.max(2, Math.ceil(halfX * 2 / .75));
  const rows = Math.max(2, Math.ceil(halfZ * 2 / .75));
  for (let column = 0; column <= columns; column += 1) for (let row = 0; row <= rows; row += 1) {
    const x = -halfX + column / columns * halfX * 2;
    const z = -halfZ + row / rows * halfZ * 2;
    points.push([entry.position[0] + x * cosine + z * sine,
      entry.position[1] - x * sine + z * cosine]);
  }
  return points;
}

function segmentDistance(point: FairyLandformPoint, from: FairyLandformPoint, to: FairyLandformPoint): number {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz)
    / Math.max(.000001, dx * dx + dz * dz)));
  return Math.hypot(point[0] - from[0] - dx * t, point[1] - from[1] - dz * t);
}

function rectangleDistance(point: FairyLandformPoint, centre: FairyLandformPoint,
  halfX: number, halfZ: number, rotation: number): number {
  const dx = point[0] - centre[0], dz = point[1] - centre[1];
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return Math.hypot(Math.max(0, Math.abs(dx * cosine - dz * sine) - halfX),
    Math.max(0, Math.abs(dx * sine + dz * cosine) - halfZ));
}

/** Positive clearance means the full native body stays outside every walking/interaction reserve. */
export function fairyDressingClearance(entry: Pick<FairyLandformDressing, 'assetId' | 'scale' | 'position'>,
  roads: readonly FairyDressingRoad[] = FAIRY_DRESSING_AUTHORED_ROADS): number {
  const radius = fairyDressingBodyRadius(entry), [x, z] = entry.position;
  let clearance = Math.min(x - 2000, 2600 - x, z + 200, 460 - z) - radius;
  for (const plateau of FAIRY_COMBAT_PLATEAUS) {
    clearance = Math.min(clearance, Math.hypot(x - plateau.centre[0], z - plateau.centre[1])
      - plateau.clearingRadius - radius - 1);
    for (const ramp of plateau.ramps) clearance = Math.min(clearance,
      sampleFairyRamp(x, z, ramp).distance - ramp.halfWidth - ramp.shoulder - radius - 1);
  }
  for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) clearance = Math.min(clearance,
    Math.hypot(x - clearing.position[0], z - clearing.position[1]) - clearing.radius - radius - 1);
  for (const road of roads) for (let index = 1; index < road.points.length; index += 1) {
    const from = road.points[index - 1]!, to = road.points[index]!;
    const sway = road.allowSway ? Math.min(9, Math.max(0, Math.hypot(to[0] - from[0], to[1] - from[1]) - 14) * .11) : 0;
    clearance = Math.min(clearance, segmentDistance(entry.position, from, to) - radius - road.halfWidth - sway - 1);
  }
  for (const region of FAIRY_REGIONS) {
    for (const building of region.settlement?.buildings ?? []) clearance = Math.min(clearance,
      rectangleDistance(entry.position, building.position, building.footprint[0] / 2,
        building.footprint[1] / 2, building.rotationY) - radius - 2);
    for (const location of region.locations) if (location.kind !== 'junction') clearance = Math.min(clearance,
      Math.hypot(x - location.position[0], z - location.position[1]) - radius - 3);
    for (const gate of region.gates) clearance = Math.min(clearance,
      Math.hypot(x - gate.position[0], z - gate.position[1]) - radius - 5);
  }
  for (const site of WORLD_SITES) {
    if (site.regionId !== 'gloamgarden' && site.regionId !== 'faeholme') continue;
    // Mine roads travel around the back of the authored cut before returning to its open apron.
    const margin = site.kind === 'mine' ? 16 : 3;
    clearance = Math.min(clearance, rectangleDistance(entry.position, site.centre,
      site.extent[0] + margin, site.extent[1] + margin, site.rotationY) - radius);
  }
  return clearance;
}

type GroundSampler = (x: number, z: number) => number;
const analyticGround: GroundSampler = (x, z) => applyFairyLandforms(x, z, 0);

/** Native skirt depth that makes each crag broad at the terrain intersection. */
const CRAG_BURIAL = { fairy_rounded_bank_0: .08, fairy_rounded_bank_1: .08 } as const;

/** Keep the complete native body in the cliff mass, outside the surrounding low walking moat. */
function seatCombatFace(entry: FairyLandformDressing, plateau: FairyLandformSpec): FairyLandformDressing | null {
  const dx = entry.position[0] - plateau.centre[0], dz = entry.position[1] - plateau.centre[1];
  const distance = Math.hypot(dx, dz);
  const maximumShift = Math.min(plateau.radius * .28, fairyDressingBodyRadius(entry) * 1.35 + 2);
  for (let inward = 0; inward <= maximumShift; inward += .25) {
    const candidate = { ...entry, position: [entry.position[0] - dx / distance * inward,
      entry.position[1] - dz / distance * inward] as const };
    if (fairyDressingFootprint(candidate).every(point => organicDistance(point[0] - plateau.centre[0],
      point[1] - plateau.centre[1], plateau.shape) - plateau.radius <= 2.25)) return candidate;
  }
  return null;
}

/** Exact shortest distance between a segment and the complete rotated native body. */
export function fairyDressingRectangleDistance(
  entry: Pick<FairyLandformDressing, 'assetId' | 'position' | 'rotationY' | 'scale'>,
  a: FairyLandformPoint, b: FairyLandformPoint): number {
  const bounds = FAIRY_ROCK_NATIVE_BOUNDS[entry.assetId], hx = bounds[0] * entry.scale / 2,
    hz = bounds[2] * entry.scale / 2, c = Math.cos(entry.rotationY), s = Math.sin(entry.rotationY);
  const local = (p: FairyLandformPoint): FairyLandformPoint => {
    const x = p[0] - entry.position[0], z = p[1] - entry.position[1];
    return [x * c - z * s, x * s + z * c];
  };
  const [ax, az] = local(a), [bx, bz] = local(b);
  let low = 0, high = 1;
  for (const [origin, delta, extent] of [[ax, bx - ax, hx], [az, bz - az, hz]]) {
    if (Math.abs(delta!) < 1e-10) {
      if (Math.abs(origin!) > extent!) { low = 2; break; }
    } else {
      const first = (-extent! - origin!) / delta!, last = (extent! - origin!) / delta!;
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
    }
  }
  if (low <= high) return 0;
  let distance = Math.min(Math.hypot(Math.max(0, Math.abs(ax) - hx), Math.max(0, Math.abs(az) - hz)),
    Math.hypot(Math.max(0, Math.abs(bx) - hx), Math.max(0, Math.abs(bz) - hz)));
  for (const x of [-hx, hx]) for (const z of [-hz, hz]) {
    distance = Math.min(distance, segmentDistance([x, z], [ax, az], [bx, bz]));
  }
  return distance;
}

/** Forest entrances stay open beyond the crest, including a full player body at each edge. */
export function fairyDressingLandingClearance(
  entry: Pick<FairyLandformDressing, 'assetId' | 'position' | 'rotationY' | 'scale'>): number {
  return Math.min(...FAIRY_GARDEN_LANDINGS.map(landing =>
    fairyDressingRectangleDistance(entry, landing.from, landing.to) - landing.halfWidth - .9));
}

function nearestLaneDirection(centre: FairyLandformPoint, roads: readonly FairyDressingRoad[]): number {
  let nearest = Infinity, direction = 0;
  for (const road of roads) for (let index = 1; index < road.points.length; index += 1) {
    const from = road.points[index - 1]!, to = road.points[index]!;
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const t = Math.max(0, Math.min(1, ((centre[0] - from[0]) * dx + (centre[1] - from[1]) * dz)
      / Math.max(.000001, dx * dx + dz * dz)));
    const x = from[0] + dx * t - centre[0], z = from[1] + dz * t - centre[1];
    const distance = Math.hypot(x, z);
    if (distance < nearest) { nearest = distance; direction = Math.atan2(z, x); }
  }
  return direction;
}

/**
 * Continuous source-crag faces replace the old isolated pale boulder ring. Plateau pieces
 * reach the existing crown height; rounded valley banks receive one overlapping lane-facing
 * rock face with their soil shoulders still above. Village geology is authored separately.
 */
export function buildFairyLandformDressing(heightAt: GroundSampler = analyticGround,
  roads: readonly FairyDressingRoad[] = FAIRY_DRESSING_AUTHORED_ROADS): readonly FairyLandformDressing[] {
  const villageIds = new Set(FAIRY_VILLAGE_BANKS.map(bank => bank.id));
  const entries: FairyLandformDressing[] = [];
  for (const landform of FAIRY_LANDFORMS) {
    if (villageIds.has(landform.id)) continue;
    const plateau = landform.clearingRadius > 0;
    const rng = new Rng(seedFromText(`corealm:fairy-crag-faces:${landform.id}`));
    const averageNativeWidth = (FAIRY_ROCK_NATIVE_BOUNDS.fairy_rounded_bank_0[0]
      + FAIRY_ROCK_NATIVE_BOUNDS.fairy_rounded_bank_1[0]) / 2;
    const averageExposedNativeHeight = ((FAIRY_ROCK_NATIVE_BOUNDS.fairy_rounded_bank_0[1] - CRAG_BURIAL.fairy_rounded_bank_0)
      + (FAIRY_ROCK_NATIVE_BOUNDS.fairy_rounded_bank_1[1] - CRAG_BURIAL.fairy_rounded_bank_1)) / 2;
    const targetHeight = plateau ? landform.rise : Math.min(4.1, Math.max(2.8, landform.rise * .50));
    const nominalScale = targetHeight / averageExposedNativeHeight;
    // Neighbours overlap their actual broad sides instead of reserving a gap between boulders.
    const cadence = averageNativeWidth * nominalScale * .80;
    const count = plateau ? Math.ceil(Math.PI * 2 * landform.radius * .95 / cadence)
      : landform.radius >= 30 ? 8 : 7;
    const faceDirection = plateau ? rng.float(0, Math.PI * 2) : nearestLaneDirection(landform.centre, roads);
    const faceRadius = landform.radius * .67;
    const angleStep = plateau ? Math.PI * 2 / count : cadence / faceRadius;
    for (let index = 0; index < count; index += 1) {
      const angle = faceDirection + (plateau ? index : index - (count - 1) / 2) * angleStep
        + rng.float(-.035, .035);
      // Alternate the two rounded source compounds; yaw variation avoids repeating their broadest face.
      const assetId = index % 3 === 1 ? 'fairy_rounded_bank_1' as const : 'fairy_rounded_bank_0' as const;
      const bounds = FAIRY_ROCK_NATIVE_BOUNDS[assetId], burial = CRAG_BURIAL[assetId];
      const exposedHeight = plateau ? targetHeight : targetHeight * rng.float(.93, 1);
      const scale = exposedHeight / (bounds[1] - burial);
      const rim = landform.radius * organicRadiusScale(angle, landform.shape);
      const radius = plateau ? rim - 2 + rng.float(-.45, .45) : rim * rng.float(.63, .71);
      let position: FairyLandformPoint = [landform.centre[0] + Math.cos(angle) * radius,
        landform.centre[1] + Math.sin(angle) * radius];
      let entry: FairyLandformDressing = {
        id: `${landform.id}_moss_face_${index + 1}`, landformId: landform.id,
        regionId: landform.regionId, assetId, position,
        rotationY: Math.PI / 2 - angle + rng.float(-.10, .10), scale,
        sink: burial * scale, heightOffset: 0,
      };
      // Translation into the cliff must not raise the bank's crown. Keep its prior low
      // footing while allowing the receiving terrain to bury more of the source body.
      const priorFloor = plateau
        ? Math.min(...fairyDressingFootprint(entry).map(point => heightAt(point[0], point[1]))) : Infinity;
      if (plateau) {
        const seated = seatCombatFace(entry, landform);
        if (!seated) continue;
        entry = seated; position = seated.position;
      }
      if (fairyDressingClearance(entry, roads) < 0) continue;
      if (fairyDressingLandingClearance(entry) < 0) continue;
      // Adjacent faces deliberately overlap; only nearly coincident cross-bank placements are culled.
      if (entries.some(other => other.landformId !== entry.landformId
        && Math.hypot(position[0] - other.position[0], position[1] - other.position[1])
          < Math.min(fairyDressingBodyRadius(entry), fairyDressingBodyRadius(other)) * .72)) continue;
      const originY = heightAt(position[0], position[1]);
      const floorY = Math.min(priorFloor, ...fairyDressingFootprint(entry).map(point => heightAt(point[0], point[1])));
      if (!Number.isFinite(originY) || !Number.isFinite(floorY)) throw new Error(`Invalid ground under ${entry.id}`);
      entries.push({ ...entry, heightOffset: floorY - originY });
    }
  }
  return entries;
}

/** Default authoring preview; final-world callers should resolve burial against the actual mesh. */
export const FAIRY_LANDFORM_DRESSING = buildFairyLandformDressing();
