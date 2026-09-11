import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WILDERNESS } from '../game/src/content/wilderness.js';
import { DEEP_WILDERNESS_LOCATIONS, DEEP_WILDERNESS_ROADS } from '../game/src/content/wildernessExpansion.js';
import { lavaClearanceAt, sampleLavaChannel, WILDERNESS_LAVA_CHANNELS } from '../game/src/content/wildernessLava.js';
import { Scene } from 'three';
import { WorldScene } from '../game/src/render/scene.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { collectRoadStamps, prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WILDERNESS_EXPANSION_SITES } from '../game/src/content/wildernessDepth.js';
import type { Vec3 } from '../game/src/contracts.js';
import { lavaObstacles } from '../game/src/world/lavaObstacles.js';

// Both proofs use one fully built and road-graded production lattice.
const scene = new WorldScene(new Scene());
const terrainSpec = buildWorldTerrainSpec();
beforeAll(() => scene.buildWorld(terrainSpec, prepareWorldSurface), 30000);
afterAll(() => scene.dispose());

it('supports every rotated fortress footprint on one production terrain floor', () => {
  for (const site of WILDERNESS_EXPANSION_SITES) {
    const floor = scene.meshHeightAt(site.position[0], site.position[1]);
    const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
    for (let x = -site.footprint[0] / 2; x <= site.footprint[0] / 2; x += 2) {
      for (let z = -site.footprint[1] / 2; z <= site.footprint[1] / 2; z += 2) {
        const wx = site.position[0] + x * cos + z * sin, wz = site.position[1] - x * sin + z * cos;
        expect(Math.abs(scene.meshHeightAt(wx, wz) - floor), `${site.id} floor at ${x},${z}`).toBeLessThan(.12);
      }
    }
  }
});

const sceneSource = readFileSync(new URL('../game/src/render/scene.ts', import.meta.url), 'utf8');
function roadConstant(name: string): number {
  const match = sceneSource.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!match) throw new Error(`Review the full dry road width after production ${name} changed`);
  return Number(match[1]);
}
const defaultWidth = roadConstant('ROAD_DEFAULT_WORN_WIDTH');
const fade = roadConstant('ROAD_FADE_METRES');
const verge = roadConstant('ROAD_VERGE_METRES');
const widthDrift = roadConstant('ROAD_WIDTH_DRIFT');
const SAMPLE_SPACING = .5;
// Half the grid diagonal covers the gaps between half-meter probes across and along the road.
const DRY_MARGIN = SAMPLE_SPACING / Math.sqrt(2);
function exactNearBankClearance(x: number, z: number): number {
  const conservative = lavaClearanceAt(x, z);
  if (conservative >= DRY_MARGIN) return conservative;
  // Outside a channel AABB the fast production query returns a conservative lower bound.
  // Resolve its real bank before reporting a collision with that empty bounding-box corner.
  return Math.min(...WILDERNESS_LAVA_CHANNELS.map(channel =>
    sampleLavaChannel(channel, x, z).signedDistance - channel.bankWidth));
}
const atEndpoint = (point: Vec3, expected: readonly [number, number]): boolean =>
  Math.abs(point[0] - expected[0]) < 1e-6 && Math.abs(point[2] - expected[1]) < 1e-6;

it('keeps every resolved northern road and its full worn, feathered and gravel width on dry ground', () => {
  const locations = new Map([...WILDERNESS.locations, ...DEEP_WILDERNESS_LOCATIONS].map(row => [row.id, row]));
  const lines = scene.getRoadPolylines();
  const stamps = collectRoadStamps(scene);
  expect(terrainSpec.lavaChannels).toEqual(WILDERNESS_LAVA_CHANNELS);
  // These are the same boxes and round joints added to built.solids by production boot.
  const obstacles = lavaObstacles(terrainSpec.lavaChannels!, (x, z) => scene.meshHeightAt(x, z)).map(solid => {
    const yaw = solid.kind === 'box' ? solid.rotationY : 0;
    const radius = solid.kind === 'box' ? Math.hypot(solid.size[0], solid.size[2]) / 2 : solid.radius;
    return { solid, radius, cos: Math.cos(yaw), sin: Math.sin(yaw) };
  });
  expect(obstacles.length).toBeGreaterThan(WILDERNESS_LAVA_CHANNELS.length);
  const matchedLines = new Set<readonly Vec3[]>();
  const failures: { road: string; minimumLavaClearance: number; point: number[]; maximumMeander: number;
    dryWidth: number; resolvedPoints: number; unsafeTerrain: number; unsafeSamples: number;
    minimumSolidClearance: number; closestSolid: string; unsafeSolidSamples: number }[] = [];
  let greatestMeander = 0;
  for (const road of DEEP_WILDERNESS_ROADS) {
    const from = locations.get(road.from)?.position, to = locations.get(road.to)?.position;
    expect(from, road.from).toBeDefined(); expect(to, road.to).toBeDefined();
    const matches = lines.filter(line => line.length > 1 && atEndpoint(line[0]!, from!) && atEndpoint(line.at(-1)!, to!));
    expect(matches, `${road.from} -> ${road.to}: exact production endpoints`).toHaveLength(1);
    const line = matches[0]!;
    matchedLines.add(line);
    const matchingStamps = stamps.filter(stamp => atEndpoint(stamp.points[0]!, from!) && atEndpoint(stamp.points.at(-1)!, to!));
    expect(matchingStamps, `${road.from} -> ${road.to}: production worn width`).toHaveLength(1);
    const width = matchingStamps[0]!.width ?? defaultWidth;
    // Cover the maximum local production width, including both broad width-drift waves.
    const halfWidth = (width / 2 + (fade + verge) * width / defaultWidth) * (1 + widthDrift);
    const lateralSteps = Math.ceil(halfWidth * 2 / SAMPLE_SPACING);
    const minX = Math.min(...line.map(point => point[0])) - halfWidth;
    const maxX = Math.max(...line.map(point => point[0])) + halfWidth;
    const minZ = Math.min(...line.map(point => point[2])) - halfWidth;
    const maxZ = Math.max(...line.map(point => point[2])) + halfWidth;
    const nearbyObstacles = obstacles.filter(({ solid, radius }) =>
      solid.position[0] + radius + DRY_MARGIN >= minX && solid.position[0] - radius - DRY_MARGIN <= maxX
      && solid.position[2] + radius + DRY_MARGIN >= minZ && solid.position[2] - radius - DRY_MARGIN <= maxZ);
    const chordX = to![0] - from![0], chordZ = to![1] - from![1];
    const chordLength = Math.hypot(chordX, chordZ);
    const maximumMeander = Math.max(...line.map(point => Math.abs(
      (point[0] - from![0]) * chordZ - (point[2] - from![1]) * chordX) / chordLength));
    greatestMeander = Math.max(greatestMeander, maximumMeander);
    let minimumLavaClearance = Infinity, worstPoint = [0, 0], unsafeTerrain = 0, unsafeSamples = 0;
    let minimumSolidClearance = Infinity, closestSolid = '', unsafeSolidSamples = 0;
    const probe = (x: number, z: number): void => {
      const clearance = exactNearBankClearance(x, z);
      if (clearance < minimumLavaClearance) { minimumLavaClearance = clearance; worstPoint = [x, z]; }
      if (clearance < DRY_MARGIN) unsafeSamples++;
      const terrain = scene.sampleWorld(x, z);
      if (!terrain.playable || terrain.waterBodyId !== null || !Number.isFinite(terrain.height)
        || (terrain.coast && terrain.height < terrain.coast.seaLevel + DRY_MARGIN)) unsafeTerrain++;
      for (const { solid, cos, sin } of nearbyObstacles) {
        const dx = x - solid.position[0], dz = z - solid.position[2];
        const gap = solid.kind === 'box'
          ? Math.hypot(Math.max(0, Math.abs(dx * cos - dz * sin) - solid.size[0] / 2),
            Math.max(0, Math.abs(dx * sin + dz * cos) - solid.size[2] / 2))
          : Math.hypot(dx, dz) - solid.radius;
        if (gap < minimumSolidClearance) { minimumSolidClearance = gap; closestSolid = solid.id; }
        if (gap < DRY_MARGIN) unsafeSolidSamples++;
      }
    };
    for (let segment = 1; segment < line.length; segment++) {
      const a = line[segment - 1]!, b = line[segment]!;
      const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
      if (length < 1e-8) continue;
      const steps = Math.ceil(length / SAMPLE_SPACING);
      for (let step = 0; step <= steps; step++) {
        const centreX = a[0] + dx * step / steps, centreZ = a[2] + dz * step / steps;
        for (let lateral = 0; lateral <= lateralSteps; lateral++) {
          const offset = -halfWidth + halfWidth * 2 * lateral / lateralSteps;
          const x = centreX - dz / length * offset, z = centreZ + dx / length * offset;
          probe(x, z);
        }
      }
    }
    // Road segments have round ends. Fill their joints and both final caps at the same spacing,
    // including the outside of each bend that a transverse-only strip would miss.
    const rings = Math.ceil(halfWidth / SAMPLE_SPACING);
    for (const point of line) for (let ring = 1; ring <= rings; ring++) {
      const radius = halfWidth * ring / rings;
      const angles = Math.ceil(Math.PI * 2 * radius / SAMPLE_SPACING);
      for (let angle = 0; angle < angles; angle++) probe(point[0] + Math.cos(angle / angles * Math.PI * 2) * radius,
        point[2] + Math.sin(angle / angles * Math.PI * 2) * radius);
    }
    if (unsafeSamples || unsafeTerrain || unsafeSolidSamples) failures.push({ road: `${road.from} -> ${road.to}`,
      minimumLavaClearance: Number(minimumLavaClearance.toFixed(3)), point: worstPoint.map(value => Number(value.toFixed(3))),
      maximumMeander: Number(maximumMeander.toFixed(3)), dryWidth: Number((halfWidth * 2).toFixed(3)),
      resolvedPoints: line.length, unsafeTerrain, unsafeSamples,
      minimumSolidClearance: Number(minimumSolidClearance.toFixed(3)), closestSolid, unsafeSolidSamples });
  }
  expect(matchedLines.size).toBe(DEEP_WILDERNESS_ROADS.length);
  // This fixture must exercise the production meander, not degenerate back to endpoint chords.
  expect(greatestMeander).toBeGreaterThan(1);
  expect(failures).toEqual([]);
}, 15000);
