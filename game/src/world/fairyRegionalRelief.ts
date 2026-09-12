import type { Vec3 } from '../contracts.js';
import type { WorldSite } from '../content/worldSites.js';
import { LANTERN_REST } from '../content/settlements/lanternRest.js';
import { PRISM_HOLLOW } from '../content/settlements/prismHollow.js';
import { FAIRY_NPC_STANDS } from '../content/fairyNpcs.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS, sampleFairyRamp, type FairyRamp } from './fairyLandforms.js';
import { organicDistance, seedFromText, smoothNoise2D } from './organicFields.js';
import { fairyGardenShoulderRise } from './fairyGardenShoulders.js';

const SEED = seedFromText('corealm:fairy-connected-highlands');
const ease = (v: number): number => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
type Segment = { ax: number; az: number; dx: number; dz: number; length2: number };
const CELL = 24;

/** Walking access to eight additional raised gardens, beyond the six combat destinations. */
export const FAIRY_UPPER_GARDEN_RAMPS: readonly FairyRamp[] = [
  ['dewsong_west_garden', 2078, 10, 2054, 18],
  ['dewsong_high_garden', 2177, 72, 2167, 98],
  ['southern_moss_garden', 2230, -141, 2238, -174],
  ['lantern_east_garden', 2534, -76, 2558, -66],
  ['amethyst_west_garden', 2120, 228, 2092, 226],
  ['prism_inner_garden', 2283, 307, 2262, 284],
  ['starroot_north_garden', 2320, 409, 2310, 437],
  ['sovereign_east_garden', 2551, 381, 2579, 394],
].map(([id, ax, az, bx, bz]) => {
  const x0 = Number(ax), z0 = Number(az), dx = Number(bx) - x0, dz = Number(bz) - z0;
  const length = Math.hypot(dx, dz);
  return { id: String(id), halfWidth: 3, shoulder: 1.4, points: Array.from({ length: 25 }, (_, i) => {
    const t = i / 24, bend = Math.sin(t * Math.PI * 2) * 1.05;
    return { position: [x0 + dx * t - dz / length * bend, z0 + dz * t + dx / length * bend] as const,
      rise: ease(t) };
  }) };
});

/** Keep the first twelve metres of each upper garden entrance clear of native rock and trunks. */
export const FAIRY_GARDEN_LANDINGS = FAIRY_UPPER_GARDEN_RAMPS.map(ramp => {
  const from = ramp.points.at(-1)!.position, previous = ramp.points.at(-2)!.position;
  const dx = from[0] - previous[0], dz = from[1] - previous[1], length = Math.hypot(dx, dz);
  return { id: ramp.id, from, to: [from[0] + dx / length * 12, from[1] + dz / length * 12] as const,
    halfWidth: 3 };
});

/** Additional low routes divide the regional roof into irregular, connected garden masses. */
export const FAIRY_HOLLOW_ROUTES: readonly (readonly (readonly [number, number])[])[] = [
  [[2084, -49], [2071, -24], [2078, 10], [2092, 27], [2115, 40]],
  [[2115, 40], [2129, 68], [2177, 72], [2210, 51], [2238, 29], [2290, 10]],
  [[2104, -111], [2109, -111], [2112, -104], [2112, -92], [2110, -60], [2130, -18], [2144, 17], [2170, 30.6], [2200, 43]],
  [[2175, -135], [2200, -162], [2230, -141], [2260, -127], [2290, -145], [2306, -172]],
  [[2250, -55], [2272, -80], [2308, -92], [2350, -80], [2380, -94], [2420, -94], [2470, -110]],
  [[2470, -110], [2499, -138], [2530, -121], [2534, -76], [2504, -40], [2498, 1], [2505, 60]],
  [[2390, 65], [2420, 92], [2460, 83], [2505, 60]],
  [[2300, 120], [2300, 140]],
  [[2278, 152], [2257, 170], [2226, 161], [2191, 174], [2150, 195], [2120, 228], [2132, 259], [2133, 275]],
  [[2323, 140], [2360, 159], [2388, 137], [2425, 157], [2470, 173], [2516, 181], [2578, 203], [2590, 245], [2588, 285], [2540, 313], [2480, 304]],
  [[2420, 210], [2400, 236], [2390, 274], [2367, 305], [2320, 285]],
  [[2320, 285], [2283, 307], [2260, 342], [2240, 384], [2195, 385], [2140, 395]],
  [[2075, 350], [2057, 386], [2078, 415], [2140, 395]],
  [[2240, 384], [2270, 415], [2320, 409], [2350, 390], [2387, 409], [2420, 420], [2450, 420]],
  [[2480, 304], [2507, 327], [2534, 343], [2551, 381], [2523, 413], [2450, 420]],
];

function rectangleDistance(x: number, z: number, cx: number, cz: number, halfX: number, halfZ: number, yaw: number): number {
  const dx = x - cx, dz = z - cz, c = Math.cos(yaw), s = Math.sin(yaw);
  const a = Math.abs(dx * c - dz * s) - halfX, b = Math.abs(dx * s + dz * c) - halfZ;
  return Math.hypot(Math.max(0, a), Math.max(0, b)) + Math.min(0, Math.max(a, b));
}

/**
 * Returns the final relief operator after roads have resolved their real curves. It receives
 * the original valley and authored bank heights; it never samples its own raised result.
 * WorldScene applies this to its one shared lattice before terrain, physics or navigation exist.
 */
export function createFairyRegionalRelief(roads: readonly (readonly Vec3[])[], sites: readonly WorldSite[]) {
  const buckets = new Map<string, Segment[]>();
  for (const line of roads) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const segment: Segment = { ax: a[0], az: a[2], dx: b[0] - a[0], dz: b[2] - a[2], length2: (b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2 };
    for (let cx = Math.floor((Math.min(a[0], b[0]) - 12) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + 12) / CELL); cx++) {
      for (let cz = Math.floor((Math.min(a[2], b[2]) - 12) / CELL); cz <= Math.floor((Math.max(a[2], b[2]) + 12) / CELL); cz++) {
        const key = `${cx}:${cz}`, list = buckets.get(key) ?? [];
        list.push(segment); buckets.set(key, list);
      }
    }
  }
  const settlements = [LANTERN_REST, PRISM_HOLLOW];
  const buildings = settlements.flatMap(settlement => settlement.buildings);
  const pockets = [...FAIRY_DEEP_PATH_CLEARINGS,
    ...settlements.flatMap(town => [town.bank, ...town.stations, ...town.shops].map(service => ({ position: service.position, radius: 2.6 }))),
    ...FAIRY_NPC_STANDS.map(npc => ({ position: npc.position, radius: 2.2 })),
    { position: [2080, -105], radius: 6 }, { position: [2300, 146], radius: 4.5 },
    { position: [2068, -128], radius: 4 },
    // A turning pocket at the west ascent keeps the ordinary follow camera in the valley.
    { position: [2317, -22], radius: 5 },
    { position: [2390, 65], radius: 23 }, { position: [2450, 420], radius: 25 }];
  return (x: number, z: number, valley: number, authored: number): number => {
    let edge = Infinity;
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      const reach = plateau.radius + 20;
      if (Math.abs(x - plateau.centre[0]) > reach || Math.abs(z - plateau.centre[1]) > reach) continue;
      const rimDistance = organicDistance(x - plateau.centre[0], z - plateau.centre[1], plateau.shape) - plateau.radius;
      // The full original plateau, its rim and the start of its ascending cut remain authoritative.
      if (rimDistance <= 4.5) return authored;
      edge = Math.min(edge, rimDistance - 7.5);
    }
    let roadDistance = Infinity;
    for (const segment of buckets.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) ?? []) {
      const t = Math.max(0, Math.min(1, ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) / Math.max(.000001, segment.length2)));
      roadDistance = Math.min(roadDistance, Math.hypot(x - segment.ax - segment.dx * t, z - segment.az - segment.dz * t));
    }
    const width = 2.7 + .45 * smoothNoise2D(x / 16, z / 16, SEED ^ 0x2814);
    edge = Math.min(edge, roadDistance - width);
    for (const pocket of pockets) edge = Math.min(edge, Math.hypot(x - pocket.position[0]!, z - pocket.position[1]!) - pocket.radius);
    for (const building of buildings) {
      if (Math.abs(x - building.position[0]) > 16 || Math.abs(z - building.position[1]) > 16) continue;
      edge = Math.min(edge, rectangleDistance(x, z, ...building.position, building.footprint[0] / 2 + .8,
        building.footprint[1] / 2 + .8, building.rotationY));
    }
    for (const site of sites) {
      if (Math.abs(x - site.centre[0]) > 60 || Math.abs(z - site.centre[1]) > 60) continue;
      edge = Math.min(edge, rectangleDistance(x, z, ...site.centre, site.extent[0] + 2, site.extent[1] + 2, site.rotationY));
    }
    const townDistance = Math.min(...settlements.map(town => Math.hypot(x - town.centre[0], z - town.centre[1])));
    const regional = 7.2 + smoothNoise2D(x / 85, z / 85, SEED) * 1.5 + smoothNoise2D(x / 23, z / 23, SEED ^ 0x4129) * .55;
    const rise = 4.7 + (regional - 4.7) * ease((townDistance - 25) / 55);
    // Rounded toes meet a steep receiving face, with broader fractured shoulders in the wilderness.
    const fracture = smoothNoise2D(x / 4.2, z / 4.2, SEED ^ 0x5713) * .8
      + smoothNoise2D(x / 9.5, z / 9.5, SEED ^ 0x37ab) * .55;
    const shapedEdge = edge + fracture * ease(edge / 1.6);
    const wall = ease(shapedEdge / (3.0 + ease((townDistance - 30) / 60) * .9));
    let relief = Math.max(rise, authored - valley) * wall;
    for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) {
      const first = ramp.points[0]!.position, last = ramp.points.at(-1)!.position;
      if (x < Math.min(first[0], last[0]) - 9 || x > Math.max(first[0], last[0]) + 9
        || z < Math.min(first[1], last[1]) - 9 || z > Math.max(first[1], last[1]) + 9) continue;
      const sample = sampleFairyRamp(x, z, ramp);
      const influence = 1 - ease((sample.distance - ramp.halfWidth) / ramp.shoulder);
      relief += (rise * sample.rise - relief) * influence;
      // The road's rounded end also carves a low moat. Carry its crest across that end cap
      // into the receiving high ground, so the ascent joins the garden on every side.
      const previous = ramp.points.at(-2)!.position;
      const dx = last[0] - previous[0], dz = last[1] - previous[1];
      const forward = ((x - last[0]) * dx + (z - last[1]) * dz) / Math.hypot(dx, dz);
      const landing = (1 - ease((Math.hypot(x - last[0], z - last[1]) - 6) / 3))
        * ease((forward + 4) / 4);
      relief += (Math.max(rise, authored - valley) - relief) * landing;
    }
    return valley + relief + fairyGardenShoulderRise(x, z, FAIRY_GARDEN_LANDINGS)
      * ease((roadDistance - 3.2) / 2);
  };
}
