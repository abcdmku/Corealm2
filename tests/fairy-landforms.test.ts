import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NAV_CONFIG, PLAYER_RADIUS } from '../game/src/app/config.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WorldScene } from '../game/src/render/scene.js';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { LANTERN_REST, LANTERN_REST_LOCATIONS } from '../game/src/content/settlements/lanternRest.js';
import { PRISM_HOLLOW, PRISM_HOLLOW_LOCATIONS } from '../game/src/content/settlements/prismHollow.js';
import {
  applyFairyLandforms, FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS,
  FAIRY_LANDFORMS, FAIRY_MINIBOSS_SOCKETS, FAIRY_ASCENT_ROUTES, FAIRY_VALLEY_ROUTE_CONTROLS, sampleFairyRamp,
  FAIRY_VILLAGE_BANKS, fairyLandformRiseAt,
  type FairyLandformPoint,
} from '../game/src/world/fairyLandforms.js';
import { organicRadiusScale } from '../game/src/world/organicFields.js';
import { FAIRY_VILLAGE_CRAGS, sampleFairyVillageBank, sampleFairyVillageSurface,
  sampleFairyVillageUnderlay, sampleFairyVillageEarth, sampleFairyVillageTerrain } from '../game/src/world/fairyVillageGeology.js';

const FAIRY_GRID_METRES = buildFairyTerrainSpec().metresPerQuad;

// Sample landforms on the production lattice, without natural terrain, roads or building footings.
// Village floors need WorldScene below because their local footings override receiving banks.
function meshSample(x: number, z: number): { height: number; slope: number } {
  const grid = FAIRY_GRID_METRES;
  const x0 = Math.floor(x / grid) * grid, z0 = Math.floor(z / grid) * grid;
  const tx = (x - x0) / grid, tz = (z - z0) / grid;
  const h00 = applyFairyLandforms(x0, z0, -120), h10 = applyFairyLandforms(x0 + grid, z0, -120);
  const h01 = applyFairyLandforms(x0, z0 + grid, -120), h11 = applyFairyLandforms(x0 + grid, z0 + grid, -120);
  return tx + tz <= 1
    ? { height: h00 + (h10 - h00) * tx + (h01 - h00) * tz, slope: Math.hypot(h10 - h00, h01 - h00) / grid }
    : { height: h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz), slope: Math.hypot(h11 - h01, h11 - h10) / grid };
}

function samplesBetween(from: FairyLandformPoint, to: FairyLandformPoint, spacing = .4): FairyLandformPoint[] {
  const count = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / spacing);
  return Array.from({ length: count + 1 }, (_, i) => [
    from[0] + (to[0] - from[0]) * i / count, from[1] + (to[1] - from[1]) * i / count,
  ]);
}

function productionTriangleGrade(scene: WorldScene, x: number, z: number): number {
  const grid = FAIRY_GRID_METRES;
  const x0 = Math.floor(x / grid) * grid, z0 = Math.floor(z / grid) * grid;
  const vertices: FairyLandformPoint[] = (x - x0 + z - z0) / grid > 1
    ? [[x0 + grid, z0 + grid], [x0, z0 + grid], [x0 + grid, z0]]
    : [[x0, z0], [x0 + grid, z0], [x0, z0 + grid]];
  const heights = vertices.map(vertex => scene.meshHeightAt(...vertex));
  return Math.hypot(heights[1]! - heights[0]!, heights[2]! - heights[0]!) / grid;
}

describe('fairy landform access', () => {
  const maxSlope = Math.tan(NAV_CONFIG.walkableSlopeAngle * Math.PI / 180);

  it('keeps the actual Prism Table Detour chord traversable between centreline samples', () => {
    // Captured from production navigation in the failing world traversal. The second chord
    // crosses an inner-corner triangle 1.25 m away from the ramp centreline.
    const route: readonly FairyLandformPoint[] = [
      [2345.541, 215], [2338.4, 218], [2336.6, 217.1],
      [2330.75, 213.95], [2328.05, 212.6], [2321.5, 215],
    ];
    const gradeAlongRoute = (scene: WorldScene): number => {
      let steepest = 0;
      for (let index = 1; index < route.length; index++) {
        const samples = samplesBetween(route[index - 1]!, route[index]!, .05);
        for (let step = 1; step < samples.length; step++) {
          const from = samples[step - 1]!, to = samples[step]!;
          steepest = Math.max(steepest, Math.abs(scene.meshHeightAt(...to) - scene.meshHeightAt(...from))
            / Math.hypot(to[0] - from[0], to[1] - from[1]));
        }
      }
      return steepest;
    };
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      expect(gradeAlongRoute(scene)).toBeLessThan(maxSlope - .1);

      // Recreate the previous 22 m shelf and 4.6 m bend in memory. The current low shelf may
      // safely accept a bend that failed at the former height; only the historical fixture
      // restores that height, so it cannot force production back to the rejected tall design.
      const prism = FAIRY_COMBAT_PLATEAUS.find(landform => landform.id === 'prism_table')!;
      const ramp = prism.ramps[0]!;
      const first = ramp.points[0]!.position, last = ramp.points.at(-1)!.position;
      const positions = ramp.points.map((_, index): FairyLandformPoint => {
        const t = index / (ramp.points.length - 1);
        return [first[0] + (last[0] - first[0]) * t, first[1] + Math.sin(t * Math.PI * 2) * 4.6];
      });
      const lengths = positions.map((point, index) => index === 0 ? 0
        : Math.hypot(point[0] - positions[index - 1]![0], point[1] - positions[index - 1]![1]));
      const length = lengths.reduce((sum, value) => sum + value, 0);
      let travelled = 0;
      const legacy = { ...prism, rise: 22, cliffWidth: 5.2, ramps: [{ ...ramp, points: positions.map((position, index) => {
        travelled += lengths[index]!;
        const t = travelled / length;
        return { position, rise: 22 * t * t * (3 - 2 * t) };
      }) }] };
      scene.clear();
      scene.buildWorld({ ...buildFairyTerrainSpec(), metresPerQuad: 2, fairyLandforms: FAIRY_LANDFORMS.map(
        landform => landform.id === prism.id ? legacy : landform,
      ) }, prepareWorldSurface);
      expect(gradeAlongRoute(scene)).toBeGreaterThan(maxSlope + .5);
    } finally {
      scene.clear();
    }
  });

  it('checks contained cross-corridor triangles within the usable core of every ascent', () => {
    // Reserve a 1.6 m half-width for walking inside each 3 m half-width cut. A triangle is
    // promised only when all its vertices stay in that core; mixed shoulder triangles remain
    // subject to navigation rejection. This tests every ramp, including the shortest tables.
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      for (const plateau of FAIRY_COMBAT_PLATEAUS) {
        for (const ramp of plateau.ramps) {
          const triangles = new Set<string>();
          let steepest = 0;
          for (let index = 1; index < ramp.points.length; index++) {
            const from = ramp.points[index - 1]!.position, to = ramp.points[index]!.position;
            const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
            const nx = -(to[1] - from[1]) / length, nz = (to[0] - from[0]) / length;
            for (const point of samplesBetween(from, to)) for (const offset of [-1.6, -1, 0, 1, 1.6]) {
              const x = point[0] + nx * offset, z = point[1] + nz * offset;
              const grid = FAIRY_GRID_METRES;
              const x0 = Math.floor(x / grid) * grid, z0 = Math.floor(z / grid) * grid;
              const upper = (x - x0 + z - z0) / grid > 1;
              const vertices: FairyLandformPoint[] = upper
                ? [[x0 + grid, z0 + grid], [x0, z0 + grid], [x0 + grid, z0]]
                : [[x0, z0], [x0 + grid, z0], [x0, z0 + grid]];
              if (vertices.some(vertex => sampleFairyRamp(...vertex, ramp).distance > 1.6)) continue;
              const key = `${x0}:${z0}:${upper}`;
              if (triangles.has(key)) continue;
              triangles.add(key);
              const heights = vertices.map(vertex => scene.meshHeightAt(...vertex));
              steepest = Math.max(steepest, Math.hypot(heights[1]! - heights[0]!, heights[2]! - heights[0]!) / grid);
            }
          }
          expect(triangles.size, ramp.id).toBeGreaterThan(5);
          expect(steepest, ramp.id).toBeLessThan(maxSlope - .1);
        }
      }
    } finally {
      scene.clear();
    }
  });

  it('keeps the captured Moonpetal Detour shortcut on walkable production triangles', () => {
    // The real path stopped at its first inner corner despite having a valid Detour route.
    // Centreline-only checks missed the shortcut across the former broad S bend.
    const route: readonly FairyLandformPoint[] = [
      [2170, 3.047], [2168.75, -2.05], [2168.75, -3.4], [2170, -18.5],
    ];
    const maxTriangleGrade = (scene: WorldScene): number => Math.max(...route.slice(1).flatMap((to, index) =>
      samplesBetween(route[index]!, to, .05).map(point => productionTriangleGrade(scene, ...point)),
    ));
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      expect(FAIRY_GRID_METRES).toBe(1);
      expect(maxTriangleGrade(scene)).toBeLessThan(maxSlope - .1);

      // Restore only the failed 4.6 m bend. This failure happened on the current low 6 m
      // Moonpetal shelf and 1 m mesh, independently of the older tall Prism regression.
      const moonpetal = FAIRY_COMBAT_PLATEAUS.find(landform => landform.id === 'moonpetal_table')!;
      const ramp = moonpetal.ramps[0]!;
      const first = ramp.points[0]!.position, last = ramp.points.at(-1)!.position;
      const positions = ramp.points.map((_, index): FairyLandformPoint => {
        const t = index / (ramp.points.length - 1);
        return [first[0] - Math.sin(t * Math.PI * 2) * 4.6, first[1] + (last[1] - first[1]) * t];
      });
      const lengths = positions.map((point, index) => index === 0 ? 0
        : Math.hypot(point[0] - positions[index - 1]![0], point[1] - positions[index - 1]![1]));
      const length = lengths.reduce((sum, value) => sum + value, 0);
      let travelled = 0;
      const legacy = { ...moonpetal, ramps: [{ ...ramp, points: positions.map((position, index) => {
        travelled += lengths[index]!;
        const t = travelled / length;
        return { position, rise: moonpetal.rise * t * t * (3 - 2 * t) };
      }) }] };
      scene.clear();
      scene.buildWorld({ ...buildFairyTerrainSpec(), fairyLandforms: FAIRY_LANDFORMS.map(
        landform => landform.id === moonpetal.id ? legacy : landform,
      ) }, prepareWorldSurface);
      expect(maxTriangleGrade(scene)).toBeGreaterThan(maxSlope);
    } finally {
      scene.clear();
    }
  });

  it('keeps direct approach-to-summit chords safe across the player body on every ascent', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      for (const plateau of FAIRY_COMBAT_PLATEAUS) for (const ramp of plateau.ramps) {
        const from = ramp.points[0]!.position, to = ramp.points.at(-1)!.position;
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const nx = -(to[1] - from[1]) / length, nz = (to[0] - from[0]) / length;
        let steepest = 0;
        for (const point of samplesBetween(from, to, .05)) {
          for (const offset of [-PLAYER_RADIUS, 0, PLAYER_RADIUS]) {
            const x = point[0] + nx * offset, z = point[1] + nz * offset;
            expect(sampleFairyRamp(x, z, ramp).distance, `${ramp.id} body stays in the cut`).toBeLessThan(ramp.halfWidth);
            // Check full triangle grade, including triangles that partly touch the shoulder.
            // They still support a player's foot here and must not be skipped by containment.
            steepest = Math.max(steepest, productionTriangleGrade(scene, x, z));
          }
        }
        expect(steepest, `${ramp.id} shortcut slope ${steepest}`).toBeLessThan(maxSlope - .1);
      }
    } finally {
      scene.clear();
    }
  });

  it('keeps actual native village banks at low reference scale above low earth shoulders', () => {
    const valleyY = -120;
    const ground = (x: number, z: number): number => valleyY + sampleFairyVillageTerrain(x, z);
    for (const bank of FAIRY_VILLAGE_BANKS) {
      expect(bank.rise, `${bank.id} metadata`).toBeGreaterThanOrEqual(2);
      expect(bank.rise, `${bank.id} metadata`).toBeLessThanOrEqual(3.8);
      const crags = FAIRY_VILLAGE_CRAGS.filter(([id]) => id === bank.id);
      if (crags.length === 0) {
        // The old Prism toe descriptors have no authored native bodies. Their metadata must
        // not recreate the discarded smooth hill or provide a second route onto the table.
        for (const dx of [-bank.radius, -bank.radius / 2, 0, bank.radius / 2, bank.radius]) {
          for (const dz of [-bank.radius, -bank.radius / 2, 0, bank.radius / 2, bank.radius]) {
            expect(fairyLandformRiseAt(bank.centre[0] + dx, bank.centre[1] + dz, bank), bank.id).toBe(0);
          }
        }
        continue;
      }
      for (const [, x, z] of crags) {
        expect(fairyLandformRiseAt(x, z, bank), `${bank.id} terrain reaches its authored crag at ${x},${z}`)
          .toBeCloseTo(sampleFairyVillageTerrain(x, z, bank.id), 8);
      }
      const minX = Math.floor(Math.min(...crags.map(([, x]) => x)) - 6);
      const maxX = Math.ceil(Math.max(...crags.map(([, x]) => x)) + 6);
      const minZ = Math.floor(Math.min(...crags.map(([, , z]) => z)) - 6);
      const maxZ = Math.ceil(Math.max(...crags.map(([, , z]) => z)) + 6);
      let peak = 0, peakPoint: FairyLandformPoint = bank.centre, exteriorSamples = 0, highestExterior = 0;
      for (let x = minX; x <= maxX; x += .25) for (let z = minZ; z <= maxZ; z += .25) {
        const visible = sampleFairyVillageBank(x, z, bank.id);
        if (visible > peak) { peak = visible; peakPoint = [x, z]; }
        if (visible === 0) {
          exteriorSamples += 1;
          highestExterior = Math.max(highestExterior, fairyLandformRiseAt(x, z, bank)
            - sampleFairyVillageEarth(x, z, bank.id));
        }
      }
      expect(peak, `${bank.id} native exposed peak`).toBeGreaterThanOrEqual(.9);
      expect(peak, `${bank.id} native exposed peak`).toBeLessThanOrEqual(3.8);
      expect(exteriorSamples, `${bank.id} exterior coverage`).toBeGreaterThan(100);
      expect(highestExterior, `${bank.id} exterior has only its authored low earth shoulder`).toBeLessThanOrEqual(.1);
      const plantedPeak = sampleFairyVillageSurface(...peakPoint, ground) - valleyY;
      expect(plantedPeak, `${bank.id} visible placement surface`).toBeGreaterThanOrEqual(peak - 1e-8);
      expect(plantedPeak, `${bank.id} visible placement surface`).toBeLessThanOrEqual(3.8);
      expect(sampleFairyVillageUnderlay(...peakPoint, bank.id), `${bank.id} hidden receiving terrain`).toBeLessThan(peak);
    }
  });

  it('holds four separated ordinary mobs on every raised clearing', () => {
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      expect(plateau.rise, `${plateau.id} stays at the requested low profile`).toBeGreaterThanOrEqual(6);
      expect(plateau.rise, `${plateau.id} stays at the requested low profile`).toBeLessThanOrEqual(8);
      const spawns = [[-9, -9], [9, -9], [-9, 9], [9, 9]] as const;
      expect(plateau.clearingRadius).toBeGreaterThanOrEqual(17);
      for (const [x, z] of spawns) {
        const sample = meshSample(plateau.centre[0] + x, plateau.centre[1] + z);
        expect(sample.height, plateau.id).toBeCloseTo(-120 + plateau.rise, 5);
        expect(sample.slope, plateau.id).toBeLessThan(.1);
      }
      for (let i = 0; i < spawns.length; i += 1) for (let j = i + 1; j < spawns.length; j += 1) {
        expect(Math.hypot(spawns[i]![0] - spawns[j]![0], spawns[i]![1] - spawns[j]![1])).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('keeps the one or two winding approaches below the actual navigation slope limit on the drawn mesh', () => {
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      expect(plateau.ramps.length).toBeGreaterThanOrEqual(1);
      expect(plateau.ramps.length).toBeLessThanOrEqual(2);
      for (const ramp of plateau.ramps) {
        expect(ramp.halfWidth * 2).toBeLessThanOrEqual(6);
        expect(Math.abs(meshSample(...ramp.points[0]!.position).height + 120), ramp.id).toBeLessThan(.15);
        expect(Math.abs(meshSample(...ramp.points.at(-1)!.position).height + 120 - plateau.rise), ramp.id).toBeLessThan(.15);
        let steepest = 0;
        for (let i = 1; i < ramp.points.length; i += 1) {
          for (const point of samplesBetween(ramp.points[i - 1]!.position, ramp.points[i]!.position)) {
            steepest = Math.max(steepest, meshSample(...point).slope);
          }
        }
        expect(steepest, `${ramp.id} slope ${steepest}`).toBeLessThan(maxSlope - .1);
      }
    }
  });

  it('blocks every sampled flank outside the authored ascent corridors on the production lattice', () => {
    for (const plateau of FAIRY_COMBAT_PLATEAUS) {
      let blockedFlanks = 0;
      for (let step = 0; step < 144; step += 1) {
        const angle = step / 144 * Math.PI * 2;
        const scale = organicRadiusScale(angle, plateau.shape);
        const rim = (plateau.radius - plateau.cliffWidth / 2) * scale;
        const x = plateau.centre[0] + Math.cos(angle) * rim, z = plateau.centre[1] + Math.sin(angle) * rim;
        if (plateau.ramps.some(ramp => sampleFairyRamp(x, z, ramp).distance < 10)) continue;
        let steepest = 0;
        for (let offset = -6; offset <= 6; offset += .5) {
          steepest = Math.max(steepest, meshSample(
            x + Math.cos(angle) * offset, z + Math.sin(angle) * offset,
          ).slope);
        }
        expect(steepest, `${plateau.id}, flank ${step} slope ${steepest}`).toBeGreaterThan(maxSlope + .15);
        blockedFlanks += 1;
      }
      expect(blockedFlanks).toBeGreaterThan(100);
    }
  });

  it('leaves the north cleft, resource floors and deeper encounter pockets on the valley floor', () => {
    const resources = [[2175, -135], [2505, 60], [2250, -55], [2470, -110], [2115, 40],
      [2170, 240], [2500, 370], [2420, 210], [2300, 365], [2075, 350]] as const;
    const exits = samplesBetween([2086, -72], [2084, -29]);
    for (const position of resources) {
      expect(meshSample(position[0], position[1]).height, `valley ${position}`).toBeCloseTo(-120, 4);
    }
    // The edge of a low earth skirt may soften the natural lane by a few centimetres.
    // Preserve the valley route rather than demanding a mathematically planar artificial cut.
    for (const position of exits) {
      expect(Math.abs(meshSample(position[0], position[1]).height + 120), `north lane ${position}`).toBeLessThan(.08);
    }
    for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) {
      expect(Math.hypot(clearing.position[0] - 2080, clearing.position[1] + 105)).toBeGreaterThan(180);
      for (const [dx, dz] of [[0, 0], [-9, -9], [9, -9], [-9, 9], [9, 9]]) {
        const sample = meshSample(clearing.position[0] + dx!, clearing.position[1] + dz!);
        expect(sample.height, clearing.id).toBeCloseTo(-120, 4);
        expect(sample.slope, clearing.id).toBeLessThan(.1);
      }
    }
  });

  it('connects the narrow ascents and village exits to the existing valley road network', () => {
    for (const route of [...FAIRY_ASCENT_ROUTES, ...FAIRY_VALLEY_ROUTE_CONTROLS]) {
      let steepest = 0;
      for (let index = 1; index < route.points.length; index += 1) {
        for (const point of samplesBetween(route.points[index - 1]!, route.points[index]!)) {
          steepest = Math.max(steepest, meshSample(...point).slope);
        }
      }
      const name = 'id' in route ? route.id : `${route.from} to ${route.to}`;
      expect(steepest, `${name} slope ${steepest}`).toBeLessThan(maxSlope - .1);
    }
  });

  it('keeps production roads traversable and village floors level after all terrain edits', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      for (const [index, road] of scene.getRoadPolylines().entries()) {
        let steepest = 0;
        for (let leg = 1; leg < road.length; leg += 1) {
          const from = road[leg - 1]!, to = road[leg]!;
          for (const [x, z] of samplesBetween([from[0], from[2]], [to[0], to[2]])) {
            // A small derivative step reads the triangle the player crosses, not an average
            // spanning several steep and flat triangles near the mine's exposed face.
            steepest = Math.max(steepest, scene.slopeAt(x, z, .01));
          }
        }
        expect(steepest, `production road ${index}: ${road[0]} to ${road.at(-1)}`).toBeLessThan(maxSlope - .1);
      }
      for (const region of FAIRY_REGIONS) for (const building of region.settlement?.buildings ?? []) {
        const centre = scene.meshHeightAt(...building.position);
        const cosine = Math.cos(building.rotationY), sine = Math.sin(building.rotationY);
        for (let x = -building.footprint[0] / 2; x <= building.footprint[0] / 2; x += .5) {
          for (let z = -building.footprint[1] / 2; z <= building.footprint[1] / 2; z += .5) {
            const ground = scene.meshHeightAt(building.position[0] + x * cosine + z * sine,
              building.position[1] - x * sine + z * cosine);
            expect(Math.abs(ground - centre), `${building.id} floor at ${x},${z}`).toBeLessThan(.2);
          }
        }
      }
      for (const [town, locations] of [
        [LANTERN_REST, LANTERN_REST_LOCATIONS], [PRISM_HOLLOW, PRISM_HOLLOW_LOCATIONS],
      ] as const) {
        const valleyHeight = scene.meshHeightAt(...town.centre);
        // Read current authored doors, approach nodes and services. Former cottage coordinates
        // can now lie behind walls on planted banks and no longer describe a player approach.
        for (const point of [...locations, town.bank, ...town.stations, ...town.shops]) {
          const height = scene.meshHeightAt(...point.position);
          expect(Math.abs(height - valleyHeight), `${point.id} stays on the village floor`).toBeLessThan(.75);
          expect(scene.slopeAt(...point.position, .01), `${point.id} ground slope`).toBeLessThan(maxSlope - .1);
        }
      }
    } finally {
      scene.clear();
    }
  });

  it('publishes safe distinct miniboss sockets and changes no terrain outside its authored landforms', () => {
    expect(new Set(FAIRY_LANDFORMS.map(landform => landform.id)).size).toBe(FAIRY_LANDFORMS.length);
    expect(new Set(FAIRY_MINIBOSS_SOCKETS.map(socket => socket.id)).size).toBe(FAIRY_MINIBOSS_SOCKETS.length);
    for (const socket of FAIRY_MINIBOSS_SOCKETS) {
      expect(meshSample(socket.position[0], socket.position[1]).slope, socket.id).toBeLessThan(.1);
    }
    for (const position of [[0, 0], [1990, -250], [2600, 500], [2200, -220]] as const) {
      expect(applyFairyLandforms(position[0], position[1], 7)).toBe(7);
    }
  });
});
