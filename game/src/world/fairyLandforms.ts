import { sampleFairyVillageTerrain } from './fairyVillageGeology.js';
import { organicDistance, organicRadiusScale, seedFromText, smoothNoise2D, type OrganicShapeSpec } from './organicFields.js';

export type FairyLandformRegion = 'gloamgarden' | 'faeholme';
export type FairyLandformPoint = readonly [number, number];

export interface FairyRampPoint {
  readonly position: FairyLandformPoint;
  /** Metres above the surrounding valley, never a second world-space height sampler. */
  readonly rise: number;
}

export interface FairyRamp {
  readonly id: string;
  readonly halfWidth: number;
  readonly shoulder: number;
  readonly points: readonly FairyRampPoint[];
}

export interface FairyLandformSpec {
  readonly id: string;
  readonly regionId: FairyLandformRegion;
  readonly centre: FairyLandformPoint;
  readonly radius: number;
  readonly rise: number;
  readonly cliffWidth: number;
  readonly shape: OrganicShapeSpec;
  readonly ramps: readonly FairyRamp[];
  /** Mob groups use this clear, nearly level disc. The irregular rim lies beyond it. */
  readonly clearingRadius: number;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function makeRamp(landform: Omit<FairyLandformSpec, 'ramps'>, direction: number, index: number): FairyRamp {
  const radialScale = organicRadiusScale(direction, landform.shape);
  const outer = landform.radius * radialScale + 4;
  const inner = landform.clearingRadius + 4.5;
  const cosine = Math.cos(direction), sine = Math.sin(direction);
  const positions = Array.from({ length: 25 }, (_, step): FairyLandformPoint => {
    const t = step / 24;
    const radial = outer + (inner - outer) * t;
    // A shallow S in the cut makes the ascent visible from below while leaving room for turns.
    // Keep the bend inside the walking core even where Recast shortens an inner corner.
    // Wider bends produced paths along the cliff shoulder that direct movement rejected.
    const across = Math.sin(t * Math.PI * 2) * 1.8;
    return [landform.centre[0] + radial * cosine - across * sine,
      landform.centre[1] + radial * sine + across * cosine];
  });
  const lengths = positions.map((position, index) => index === 0 ? 0
    : Math.hypot(position[0] - positions[index - 1]![0], position[1] - positions[index - 1]![1]));
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  let travelled = 0;
  const points = positions.map((position, index): FairyRampPoint => {
    travelled += lengths[index]!;
    return { position, rise: landform.rise * smoothstep(travelled / totalLength) };
  });
  return { id: `${landform.id}_ascent_${index + 1}`, halfWidth: 3, shoulder: 1.5, points };
}

function plateau(
  id: string, regionId: FairyLandformRegion, centre: FairyLandformPoint,
  radius: number, rise: number, directions: readonly number[], rotation: number,
): FairyLandformSpec {
  const landform: Omit<FairyLandformSpec, 'ramps'> = {
    id, regionId, centre, radius, rise, cliffWidth: 2.4,
    shape: { seed: seedFromText(`corealm:fairy-landform:${id}`), irregularity: .13, lobes: 5,
      aspectRatio: .9, rotation },
    clearingRadius: 17,
  };
  return { ...landform, ramps: directions.map((direction, index) => makeRamp(landform, direction, index)) };
}

/** Authored terrain relief, independent of the semantic region rectangles and visual biome field. */
export const FAIRY_COMBAT_PLATEAUS: readonly FairyLandformSpec[] = [
  plateau('moonpetal_table', 'gloamgarden', [2170, -40], 45, 6, [Math.PI / 2], .2),
  plateau('lantern_crown', 'gloamgarden', [2382, -22], 59, 8, [Math.PI, .35], -.3),
  plateau('southern_bloom_table', 'gloamgarden', [2350, -157], 40, 6, [Math.PI / 2], .6),
  plateau('prism_table', 'faeholme', [2300, 215], 46, 7, [0], -.2),
  plateau('starroot_crown', 'faeholme', [2183, 327], 53, 8, [-Math.PI / 2], .4),
  plateau('orchid_crown', 'faeholme', [2532, 248], 54, 8, [Math.PI], -.45),
];

function bank(
  id: string, regionId: FairyLandformRegion, centre: FairyLandformPoint,
  radius: number, rise: number, aspectRatio = .86, rotation = 0,
): FairyLandformSpec {
  const bankRise = rise > 8 ? rise * .48 : rise;
  return {
    id, regionId, centre, radius, rise: bankRise, cliffWidth: 5.4, clearingRadius: 0, ramps: [],
    shape: { seed: seedFromText(`corealm:fairy-landform:${id}`), irregularity: .17, lobes: 5,
      aspectRatio, rotation },
  };
}

/** Small banks leave doors on the valley floor and tuck the rear walls into the hillside. */
export const FAIRY_VILLAGE_BANKS: readonly FairyLandformSpec[] = [
  bank('lantern_west_bank', 'gloamgarden', [2060, -101], 13, 3.8, .65, Math.PI / 2),
  bank('lantern_northwest_bank', 'gloamgarden', [2068, -76], 13, 3.8, .60, 0),
  bank('lantern_northeast_bank', 'gloamgarden', [2094, -76], 13, 3.8, .60, 0),
  bank('lantern_east_bank', 'gloamgarden', [2103, -99], 12, 3.8, .65, Math.PI / 2),
  bank('lantern_south_bank', 'gloamgarden', [2097, -132], 12, 3.4, .62, 0),
  bank('lantern_forge_bank', 'gloamgarden', [2059, -130], 12, 3.0, .68, 0),
  bank('lantern_foreground_garden', 'gloamgarden', [2072, -109], 4.2, 2.7, .8, -.2),
  bank('lantern_bank_garden', 'gloamgarden', [2080.3, -120.35], 6.5, 2.5, .70, Math.PI / 4),
  bank('lantern_market_garden', 'gloamgarden', [2081, -88], 8, 3.8, .86, 0),
  bank('prism_west_toe', 'faeholme', [2289, 178], 12.5, 2.5, .82, -.25),
  bank('prism_east_toe', 'faeholme', [2316, 183], 14, 2.5, .82, .2),
  bank('prism_root_garden', 'faeholme', [2282, 144], 12, 3, .65, Math.PI / 2),
  bank('prism_orchid_garden', 'faeholme', [2318, 151], 12, 3, .65, Math.PI / 2),
  bank('prism_moon_garden', 'faeholme', [2301, 168], 12, 3, .65, 0),
  bank('prism_bank_garden', 'faeholme', [2315, 135.65], 6, 2, .7, Math.PI / 2),
];

/** Unequal shoulders divide the meadows into winding, connected hollows between the larger tables. */
export const FAIRY_VALLEY_BANKS: readonly FairyLandformSpec[] = [
  bank('west_dewsong_bank', 'gloamgarden', [2038, -32], 32, 16),
  bank('dewglass_south_bank', 'gloamgarden', [2136, -174], 28, 12, .82, -.4),
  bank('moonpetal_south_bank', 'gloamgarden', [2263, -168], 32, 17, .82, .2),
  bank('willow_south_bank', 'gloamgarden', [2470, -171], 34, 18),
  bank('lantern_east_shoulder', 'gloamgarden', [2556, -86], 36, 17, .84, -.6),
  bank('seam_east_shoulder', 'gloamgarden', [2570, 40], 37, 19, .85, .4),
  bank('dewsong_north_bank', 'gloamgarden', [2158, 94], 36, 17),
  bank('moonpath_north_bank', 'gloamgarden', [2335, 78], 33, 14, .8, -.6),
  bank('threshold_east_bank', 'faeholme', [2500, 137], 39, 18, .9, .2),
  bank('amethyst_west_bank', 'faeholme', [2082, 199], 40, 19, .82, .4),
  bank('twilight_south_bank', 'faeholme', [2098, 285], 31, 15),
  bank('prism_east_bank', 'faeholme', [2400, 263], 27, 15, .76, -.6),
  bank('sovereign_inner_bank', 'faeholme', [2420, 373], 27, 14, .8, .5),
  bank('sovereign_outer_bank', 'faeholme', [2554, 414], 36, 20),
  bank('twilight_north_bank', 'faeholme', [2120, 437], 33, 17),
  bank('starroot_north_bank', 'faeholme', [2300, 445], 32, 18, .88, -.3),
  bank('moonpetal_inner_shoulder', 'gloamgarden', [2234, -8], 21, 13, .85, .7),
  bank('dewsong_inner_shoulder', 'gloamgarden', [2237, 48], 20, 12, .88, -.3),
  bank('moonpath_west_shoulder', 'gloamgarden', [2262, 96], 23, 14, .8, .4),
  bank('southern_moonpath_shoulder', 'gloamgarden', [2300, -116], 22, 15, .82, -.6),
  bank('willow_path_shoulder', 'gloamgarden', [2420, -137], 24, 15, .78, -.5),
  bank('lantern_path_shoulder', 'gloamgarden', [2520, -32], 22, 14, .86, .2),
  bank('dewsong_outer_shoulder', 'gloamgarden', [2060, 98], 31, 17, .8, -.1),
  bank('prism_west_shoulder', 'faeholme', [2245, 147], 18, 6.5, .88, .6),
  bank('amethyst_inner_shoulder', 'faeholme', [2200, 187], 26, 16, .85, -.3),
  bank('threshold_orchid_shoulder', 'faeholme', [2437, 123], 26, 16, .86, .4),
  bank('twilight_outer_shoulder', 'faeholme', [2037, 385], 29, 18, .84, -.2),
  bank('twilight_court_shoulder', 'faeholme', [2195, 423], 18, 13, .88, -.4),
  bank('sovereign_path_shoulder', 'faeholme', [2370, 363], 20, 14, .85, .8),
  bank('sovereign_north_shoulder', 'faeholme', [2360, 433], 25, 16, .84, -.2),
];

export const FAIRY_LANDFORMS: readonly FairyLandformSpec[] = [
  ...FAIRY_VILLAGE_BANKS, ...FAIRY_VALLEY_BANKS, ...FAIRY_COMBAT_PLATEAUS,
];

/** These wider valley pockets are away from Lantern Rest and can hold ordinary path encounters. */
export const FAIRY_DEEP_PATH_CLEARINGS = [
  { id: 'moonpath_hollow', regionId: 'gloamgarden', position: [2290, 10], radius: 19 },
  { id: 'lantern_willow_hollow', regionId: 'gloamgarden', position: [2420, -94], radius: 19 },
  { id: 'bloomheart_hollow', regionId: 'gloamgarden', position: [2460, 83], radius: 17 },
  { id: 'prism_hollow', regionId: 'faeholme', position: [2367, 305], radius: 20 },
  { id: 'twilight_hollow', regionId: 'faeholme', position: [2240, 384], radius: 19 },
  { id: 'orchid_hollow', regionId: 'faeholme', position: [2480, 304], radius: 19 },
] as const;

export const FAIRY_MINIBOSS_SOCKETS = [
  { id: 'gloam_south_table', regionId: 'gloamgarden', position: [2350, -157] },
  { id: 'gloam_lantern_table', regionId: 'gloamgarden', position: [2382, -22] },
  { id: 'gloam_deep_hollow', regionId: 'gloamgarden', position: [2460, 83] },
  { id: 'fae_orchid_table', regionId: 'faeholme', position: [2532, 248] },
  { id: 'fae_starroot_table', regionId: 'faeholme', position: [2183, 327] },
  { id: 'fae_deep_hollow', regionId: 'faeholme', position: [2480, 304] },
] as const;

export interface FairyValleyRoute {
  readonly from: string;
  readonly to: string;
  readonly points: readonly FairyLandformPoint[];
}

/** The three old straight chords that would otherwise cut across receiving banks. */
export const FAIRY_VALLEY_ROUTE_CONTROLS: readonly FairyValleyRoute[] = [
  { from: 'lantern_rest_east_lane', to: 'dewglass_workings',
    // Go around the southern tailings bank and enter the working floor from its east apron.
    points: [[2104, -111], [2113, -123], [2122, -134], [2148, -143], [2168, -161],
      [2194, -157], [2194, -140], [2190.5, -135], [2184.75, -135], [2179, -135], [2175, -135]] },
  { from: 'lantern_rest_north_lane', to: 'dewsong_copse',
    points: [[2086, -72], [2084, -49], [2084, -29], [2094, -7], [2115, 40]] },
  { from: 'star_amethyst_cut', to: 'twilight_copse',
    // The mine faces east. Leave its apron before turning west around the cut's northern end.
    points: [[2170, 240], [2174, 240], [2179.75, 240], [2185.5, 240], [2185.5, 275],
      [2133, 275], [2134, 302], [2109, 335], [2075, 350]] },
];

const ASCENT_APPROACHES: Readonly<Record<string, readonly FairyLandformPoint[]>> = {
  moonpetal_table_ascent_1: [[2170, 30.6]],
  lantern_crown_ascent_1: [[2290, 10], [2308, -7]],
  lantern_crown_ascent_2: [[2450, 62], [2452, 29]],
  southern_bloom_table_ascent_1: [[2350, -80]],
  prism_table_ascent_1: [[2420, 210], [2370, 214]],
  starroot_crown_ascent_1: [[2195, 247.5]],
  orchid_crown_ascent_1: [[2420, 210], [2450, 238]],
};

/** Explicit roads from the existing valley network to each sole permitted ascent. */
export const FAIRY_ASCENT_ROUTES = FAIRY_COMBAT_PLATEAUS.flatMap(landform => landform.ramps.map(ramp => ({
  id: ramp.id,
  plateauId: landform.id,
  regionId: landform.regionId,
  width: 3.2,
  points: [...ASCENT_APPROACHES[ramp.id]!, ...ramp.points.map(point => point.position)],
})));

/** Acceptance stances stay at the foot of the same hills that the player can climb. */
export const FAIRY_LANDFORM_PROBES = FAIRY_COMBAT_PLATEAUS.map(landform => {
  const ramp = landform.ramps[0]!;
  const direction = Math.atan2(ramp.points[0]!.position[1] - landform.centre[1],
    ramp.points[0]!.position[0] - landform.centre[0]);
  const flankAngle = direction + Math.PI / 2;
  const flankRadius = (landform.radius - landform.cliffWidth / 2) * organicRadiusScale(flankAngle, landform.shape);
  return {
    id: landform.id,
    approach: ramp.points[0]!.position,
    summit: ramp.points.at(-1)!.position,
    centre: landform.centre,
    flankFoot: [landform.centre[0] + Math.cos(flankAngle) * (flankRadius + 6),
      landform.centre[1] + Math.sin(flankAngle) * (flankRadius + 6)] as const,
    flankTop: [landform.centre[0] + Math.cos(flankAngle) * (flankRadius - 6),
      landform.centre[1] + Math.sin(flankAngle) * (flankRadius - 6)] as const,
  };
});

interface RampSample { distance: number; rise: number }

export function sampleFairyRamp(x: number, z: number, ramp: FairyRamp): RampSample {
  let bestDistanceSquared = Infinity, rise = 0;
  for (let index = 1; index < ramp.points.length; index += 1) {
    const from = ramp.points[index - 1]!, to = ramp.points[index]!;
    const dx = to.position[0] - from.position[0], dz = to.position[1] - from.position[1];
    const lengthSquared = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - from.position[0]) * dx + (z - from.position[1]) * dz) / lengthSquared));
    const distanceSquared = (x - from.position[0] - dx * t) ** 2 + (z - from.position[1] - dz * t) ** 2;
    if (distanceSquared >= bestDistanceSquared) continue;
    bestDistanceSquared = distanceSquared;
    rise = from.rise + (to.rise - from.rise) * t;
  }
  return { distance: Math.sqrt(bestDistanceSquared), rise };
}

/** Terrain offset for one table. Cliff and ramp are one continuous mesh, with no invisible blocker. */
export function fairyLandformRiseAt(x: number, z: number, landform: FairyLandformSpec): number {
  if (FAIRY_VILLAGE_BANKS.includes(landform)) return sampleFairyVillageTerrain(x, z, landform.id);
  const dx = x - landform.centre[0], dz = z - landform.centre[1];
  if (Math.abs(dx) > landform.radius + 10 || Math.abs(dz) > landform.radius + 10) return 0;
  const distance = organicDistance(dx, dz, landform.shape);
  if (landform.clearingRadius === 0) {
    // Ordinary banks are rounded receiving shoulders. Only combat tables keep a level crown
    // and a narrow, unwalkable rim. The two noise scales use the existing shared field helper.
    const crown = 1 - smoothstep((distance / landform.radius - .12) / .88);
    if (crown <= 0) return 0;
    const relief = smoothNoise2D(dx / 11.5, dz / 11.5, landform.shape.seed) * .55
      + smoothNoise2D(dx / 4.8, dz / 4.8, landform.shape.seed ^ 0x68bc_21eb) * .16;
    const rimRelief = crown * (.35 + .65 * smoothstep(distance / landform.radius));
    return Math.max(0, landform.rise * crown + relief * rimRelief);
  }
  const face = 1 - smoothstep((distance - landform.radius + landform.cliffWidth) / landform.cliffWidth);
  let rise = landform.rise * face;
  for (const ramp of landform.ramps) {
    const sample = sampleFairyRamp(x, z, ramp);
    if (sample.distance >= ramp.halfWidth + ramp.shoulder) continue;
    const blend = 1 - smoothstep((sample.distance - ramp.halfWidth) / ramp.shoulder);
    rise += (sample.rise - rise) * blend;
  }
  return rise;
}

/**
 * Run after generic flats/automatic haul corridors and before authored mine/grove cuts. Keep the
 * underlying woodland amplitude around 1.5 m: this adds relief but does not invent a second biome
 * or ground-height field. The mesh, navigation, material slope and scatter then see this same y.
 */
export function applyFairyLandforms(x: number, z: number, height: number, landforms = FAIRY_LANDFORMS): number {
  let rise = 0;
  for (const landform of landforms) rise = Math.max(rise, fairyLandformRiseAt(x, z, landform));
  return height + rise;
}
