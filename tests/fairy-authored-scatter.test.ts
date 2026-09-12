import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RegionId, SolidVolume } from '../game/src/contracts.js';
import type { AssetEntry, AssetRegistry } from '../game/src/render/assets.js';
import { WorldScene, type Rect, type ScatterPlacement } from '../game/src/render/scene.js';
import { resolveFairyDressing } from '../game/src/app/fairyDressing.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { collectRoadStamps, prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { FAIRY_REGIONS } from '../game/src/content/fairyRegions.js';
import { treeSpeciesForAsset } from '../game/src/content/treeSpecies.js';
import { FAIRY_ROCK_NATIVE_BOUNDS } from '../game/src/world/fairyLandformDressing.js';
import type { ForestTreeDescriptor } from '../game/src/world/forestResources.js';
import { ExclusionZones, scatterTileAt, scatterTilesForBounds, scatterWorldTile, type RegionScatterSpec, type ScatterLayerSpec } from '../game/src/world/scatter.js';
import { MemoryGenerationCache } from './support/generation-cache.js';

type AuthoredPoint = NonNullable<ScatterLayerSpec['authoredPoints']>[number];
type Draw = { assetId: string; placement: ScatterPlacement & { forestTree?: ForestTreeDescriptor };
  matrix: THREE.Matrix4; tileName: string; mesh: THREE.InstancedMesh; slot: number };
const ground = (x: number, z: number) => -120 + (x - 2000) * 0.08 + z * 0.03;
const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8')) as { assets: AssetEntry[] };
const villageTreeEntries = manifest.assets.filter(entry => /^(fairy_canopy_(gloam|fae)_[12]|fairy_hero_(gloam|fae)_sheltered)$/.test(entry.id));

function harness(bounds: Rect, rejectTerrainReads = false, extraEntries: readonly AssetEntry[] = []) {
  const actual = new WorldScene(new THREE.Scene());
  const draws: Draw[] = [];
  const requested: string[] = [];
  const sources = new Map<string, THREE.Mesh>();
  const entries = new Map<string, AssetEntry>();
  for (const [id, size] of Object.entries(FAIRY_ROCK_NATIVE_BOUNDS)) {
    const geometry = new THREE.BoxGeometry(...size).translate(0, size[1] / 2, 0);
    const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xa7aa93 }));
    source.name = id;
    sources.set(id, source);
    entries.set(id, { id, file: `${id}.glb`, pack: 'test-native-rock', category: 'rock', is: 'rock', tags: [], bytes: 100,
      size: { x: size[0], y: size[1], z: size[2] }, base: { x: -size[0] / 2, y: 0, z: -size[2] / 2 }, animations: [], materials: [] });
  }
  for (const entry of extraEntries) {
    const { size, base = { x: 0, y: 0, z: 0 } } = entry;
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
      .translate(base.x + size.x / 2, base.y + size.y / 2, base.z + size.z / 2);
    const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    source.name = entry.id;
    sources.set(entry.id, source);
    entries.set(entry.id, entry);
  }
  const height = (x: number, z: number) => {
    if (rejectTerrainReads) throw new Error('Baked authored placements must load without sampling terrain again');
    return ground(x, z);
  };
  const scene = {
    getWorldBounds: () => bounds,
    getTerrainBuildStats: () => ({ restampPassCount: 0 }),
    getScatterBounds: () => bounds,
    describeRegions: () => [{ regionId: 'gloamgarden' as const }, { regionId: 'faeholme' as const }],
    getRegionRect: () => bounds,
    getWaterBodies: () => [],
    getRoadPolylines: () => [],
    meshHeightAt: height,
    scatterSurfaceAt: (x: number, z: number) => ({ height: height(x, z), normal: [0.2, 0.9, 0.3] as const, slope: 0.3, density: 1 }),
    normalAt: () => [0.2, 0.9, 0.3] as const,
    regionWeightAt: () => 1,
    regionAt: (_x: number, z: number) => z < 130 ? 'gloamgarden' : 'faeholme',
    scatterInstanced: (source: THREE.Object3D, placements: ScatterPlacement[], name: string,
      options: Parameters<WorldScene['scatterInstanced']>[3]) => {
      const meshes = actual.scatterInstanced(source, placements, name, options);
      expect(meshes).toHaveLength(1);
      placements.forEach((placement, index) => {
        const matrix = new THREE.Matrix4();
        meshes[0]!.getMatrixAt(index, matrix);
        draws.push({ assetId: source.name, placement: structuredClone(placement), matrix, tileName: name,
          mesh: meshes[0]!, slot: index });
      });
      return meshes;
    },
  } as unknown as WorldScene;
  const assets = {
    entry: (id: string) => entries.get(id),
    byTags: () => [],
    assetSize: (id: string) => entries.get(id)?.size ?? null,
    loadMany: async (ids: string[]) => { requested.push(...ids); },
    instance: (id: string) => {
      expect(requested, `${id} is loaded before an instance is created`).toContain(id);
      return sources.get(id)!;
    },
  } as unknown as AssetRegistry;
  return { scene, assets, draws, requested, dispose: () => {
    actual.dispose();
    for (const source of sources.values()) { source.geometry.dispose(); (source.material as THREE.Material).dispose(); }
  } };
}

function expectedTransform(point: AuthoredPoint): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(point.position[0], ground(...point.position) + point.heightOffset - point.sink, point.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), point.rotationY),
    new THREE.Vector3().setScalar(point.scale),
  );
}

function assertExactDraw(draw: Draw, point: AuthoredPoint): void {
  expect(draw.assetId).toBe(point.assetId);
  expect(draw.placement).toEqual({ position: [point.position[0], ground(...point.position) + point.heightOffset - point.sink, point.position[1]],
    rotationY: point.rotationY, scale: point.scale, tilt: 0 });
  expectedTransform(point).elements.forEach((value, index) => {
    // Instance storage is Float32 even when authored coordinates and native bounds are doubles.
    expect(draw.matrix.elements[index]!, point.id).toBeCloseTo(value, 3);
  });
}

describe('authored fairy dressing scatter', () => {
  it('bakes exact transforms and loads adjacent tiles in reverse order without duplicating boundary points', async () => {
    const bounds = { minX: 2016, maxX: 2208, minZ: -96, maxZ: 0 };
    const points: AuthoredPoint[] = [
      { id: 'west', assetId: 'fairy_boulder_4', position: [2016, -45], rotationY: 0.73, scale: 0.4, sink: 0.6, heightOffset: -0.23 },
      { id: 'before-seam', assetId: 'fairy_boulder_0', position: [2111.999, -20], rotationY: -0.41, scale: 0.3, sink: 0.5, heightOffset: -0.37 },
      { id: 'on-seam', assetId: 'fairy_boulder_4', position: [2112, -96], rotationY: 1.27, scale: 0.47, sink: 0.7, heightOffset: -0.18 },
      { id: 'east', assetId: 'fairy_boulder_0', position: [2207, -12], rotationY: -1.19, scale: 0.36, sink: 0.44, heightOffset: -0.31 },
      { id: 'outside', assetId: 'fairy_boulder_4', position: [2208, -12], rotationY: 0.1, scale: 0.4, sink: 0.5, heightOffset: 0 },
    ];
    const spec: RegionScatterSpec = { regionId: 'gloamgarden', rect: bounds, exclusions: new ExclusionZones(), layers: [{
      id: 'fitted-boulders', assetIds: Object.keys(FAIRY_ROCK_NATIVE_BOUNDS), authoredPoints: points,
      maxCount: 0, scale: [4, 8], sink: 8, tilt: 1, mirror: true, castShadow: true,
    }] };
    const specs = { gloamgarden: spec }, tiles = scatterTilesForBounds(bounds), cache = new MemoryGenerationCache();
    const bake = harness(bounds), loaded = harness(bounds, true), fresh = harness(bounds);
    try {
      expect(tiles).toHaveLength(2);
      for (const tile of tiles) await scatterWorldTile(bake.scene, bake.assets, 1337, tile, specs, { cache, render: false });
      expect(bake.draws).toEqual([]);
      expect(bake.requested).toEqual([]);
      expect(cache.entries.size).toBe(2);
      for (const tile of [...tiles].reverse()) await scatterWorldTile(loaded.scene, loaded.assets, 1337, tile, specs, { cache });
      expect(cache.hits).toBe(2);
      expect(loaded.draws).toHaveLength(4);
      expect(new Set(loaded.draws.map(draw => `${draw.placement.position[0]}:${draw.placement.position[2]}`)).size).toBe(4);
      for (const point of points.filter(point => point.id !== 'outside')) {
        const draw = loaded.draws.find(draw => draw.placement.position[0] === point.position[0] && draw.placement.position[2] === point.position[1])!;
        expect(draw, point.id).toBeDefined();
        expect(draw.tileName, point.id).toContain(`-g${scatterTileAt(...point.position).id}-`);
        assertExactDraw(draw, point);
      }
      // Authored placements survive ordinary layer transform settings and an unrelated world seed.
      for (const tile of tiles) await scatterWorldTile(fresh.scene, fresh.assets, 9123, tile, specs);
      const fingerprint = (draws: Draw[]) => draws.map(draw => JSON.stringify([draw.assetId, draw.placement])).sort();
      expect(fingerprint(fresh.draws)).toEqual(fingerprint(loaded.draws));
    } finally { bake.dispose(); loaded.dispose(); fresh.dispose(); }
  });

  it('keeps resolved terrain burial and native collision boxes on the rendered instance transforms', async () => {
    const bounds = { minX: 2000, maxX: 2600, minZ: -200, maxZ: 460 };
    const source = harness(bounds), loaded = harness(bounds, true), cache = new MemoryGenerationCache();
    try {
      const resolved = resolveFairyDressing(source.scene);
      expect(resolved.points.length).toBeGreaterThan(10);
      expect(resolved.solids).toHaveLength(resolved.points.length);
      const specs: Partial<Record<RegionId, RegionScatterSpec>> = {};
      for (const regionId of ['gloamgarden', 'faeholme'] as const) {
        const layers = resolved.specs[regionId].layers.filter(layer => layer.id === 'fitted-boulders');
        expect(layers).toHaveLength(1);
        expect(layers[0]!.authoredPoints).toEqual(resolved.points.filter(point => point.regionId === regionId));
        specs[regionId] = { ...resolved.specs[regionId], rect: bounds, layers };
      }
      const occupied = new Map(resolved.points.map(point => {
        const tile = scatterTileAt(...point.position);
        return [tile.id, tile];
      }));
      const first = [...occupied.values()].find(tile => occupied.has(`${tile.col + 1}:${tile.row}`));
      expect(first, 'Actual resolved geology spans adjacent generation tiles').toBeDefined();
      const tiles = [first!, occupied.get(`${first!.col + 1}:${first!.row}`)!];
      const tileIds = new Set(tiles.map(tile => tile.id));
      const expected = resolved.points.filter(point => tileIds.has(scatterTileAt(...point.position).id));
      expect(expected.length).toBeGreaterThan(1);
      for (const tile of tiles) await scatterWorldTile(source.scene, source.assets, 1337, tile, specs, { cache, render: false });
      for (const tile of [...tiles].reverse()) await scatterWorldTile(loaded.scene, loaded.assets, 1337, tile, specs, { cache });
      expect(cache.hits).toBe(2);
      expect(loaded.draws).toHaveLength(expected.length);
      for (const point of expected) {
        const draw = loaded.draws.find(draw => draw.placement.position[0] === point.position[0] && draw.placement.position[2] === point.position[1])!;
        expect(draw, point.id).toBeDefined();
        assertExactDraw(draw, point);
        const solid = resolved.solids.find(solid => solid.id === point.id)! as Extract<SolidVolume, { kind: 'box' }>;
        expect(solid.kind).toBe('box');
        expect(solid.position).toEqual(draw.placement.position);
        expect(solid.rotationY).toBe(draw.placement.rotationY);
        const native = FAIRY_ROCK_NATIVE_BOUNDS[point.assetId];
        expect(solid.size).toEqual(native.map(value => value * point.scale));
        const collision = new THREE.Box3(), rendered = new THREE.Box3();
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), solid.rotationY);
        for (const x of [-0.5, 0.5]) for (const y of [0, 1]) for (const z of [-0.5, 0.5]) {
          rendered.expandByPoint(new THREE.Vector3(x * native[0], y * native[1], z * native[2]).applyMatrix4(draw.matrix));
          collision.expandByPoint(new THREE.Vector3(x * solid.size[0], y * solid.size[1], z * solid.size[2])
            .applyQuaternion(rotation).add(new THREE.Vector3(...solid.position)));
        }
        expect(rendered.min.distanceTo(collision.min), point.id).toBeLessThan(0.001);
        expect(rendered.max.distanceTo(collision.max), point.id).toBeLessThan(0.001);
      }
    } finally { source.dispose(); loaded.dispose(); }
  });

  it('loads every authored meadow asset when overlapping plants bypass procedural competition and cache each tile once', async () => {
    const bounds = { minX: 2016, maxX: 2208, minZ: -96, maxZ: 0 };
    const entries = manifest.assets.filter(entry => ['corealm_fern_1', 'corealm_shrub_1'].includes(entry.id));
    expect(entries).toHaveLength(2);
    const points: AuthoredPoint[] = [
      { id: 'bank-fern', assetId: 'corealm_fern_1', position: [2111.9, -45], rotationY: .4, scale: .48, sink: .025, heightOffset: 0 },
      { id: 'bank-shrub', assetId: 'corealm_shrub_1', position: [2111.9, -45], rotationY: 1.1, scale: .9, sink: .025, heightOffset: 0 },
      { id: 'lane-fern', assetId: 'corealm_fern_1', position: [2112, -45], rotationY: 1.3, scale: .44, sink: .025, heightOffset: 0 },
      { id: 'lane-shrub', assetId: 'corealm_shrub_1', position: [2112, -45], rotationY: 2.7, scale: 1.1, sink: .025, heightOffset: 0 },
    ];
    const spec: RegionScatterSpec = { regionId: 'gloamgarden', rect: bounds, exclusions: new ExclusionZones(),
      layers: [{ id: 'village-meadow', assetIds: entries.map(entry => entry.id), authoredPoints: points, maxCount: 0, scale: [1, 1] }] };
    const specs = { gloamgarden: spec }, tiles = scatterTilesForBounds(bounds), cache = new MemoryGenerationCache();
    const bake = harness(bounds, false, entries), loaded = harness(bounds, true, entries), fresh = harness(bounds, false, entries);
    try {
      expect(tiles).toHaveLength(2);
      for (const tile of tiles) await scatterWorldTile(bake.scene, bake.assets, 1337, tile, specs, { cache, render: false });
      for (const tile of [...tiles].reverse()) await scatterWorldTile(loaded.scene, loaded.assets, 1337, tile, specs, { cache });
      for (const tile of tiles) await scatterWorldTile(fresh.scene, fresh.assets, 1337, tile, specs);
      expect(cache.entries.size).toBe(2);
      expect(cache.hits).toBe(2);
      for (const current of [loaded, fresh]) {
        expect(current.draws).toHaveLength(points.length);
        expect(new Set(current.draws.map(draw => JSON.stringify(draw.placement))).size).toBe(points.length);
        for (const point of points) {
          const draw = current.draws.find(draw => draw.assetId === point.assetId && draw.placement.rotationY === point.rotationY)!;
          expect(draw, point.id).toBeDefined();
          assertExactDraw(draw, point);
          // A model that survives authored placement must be requested even when its
          // overlapping procedural candidate lost the understory spacing contest.
          expect(current.requested, `${point.id} model is loaded before its surviving instance`).toContain(point.assetId);
        }
      }
      const fingerprint = (draws: Draw[]) => draws.map(draw => JSON.stringify([draw.assetId, draw.placement])).sort();
      expect(fingerprint(fresh.draws)).toEqual(fingerprint(loaded.draws));
    } finally { bake.dispose(); loaded.dispose(); fresh.dispose(); }
  });

  it('restores every authored village tree as a stable harvestable forest instance with native grounding and trunk radius', async () => {
    const bounds = { minX: 2000, maxX: 2600, minZ: -200, maxZ: 460 };
    expect(villageTreeEntries).toHaveLength(6);
    // GroundY must win over the mesh minimum for the source tree's buried roots.
    // The hero fixture also covers older entries that only provide a mesh base.
    const entries = villageTreeEntries.map(entry => entry.id === 'fairy_canopy_gloam_1'
      ? { ...entry, base: { ...entry.base!, y: -0.37 } } : entry.id === 'fairy_hero_gloam_sheltered'
        ? { ...entry, groundY: undefined, base: { ...entry.base!, y: -0.22 } } : entry);
    expect(entries.filter(entry => (entry.groundY ?? 0) > 1)).toHaveLength(4);
    const bake = harness(bounds, false, entries), loaded = harness(bounds, true, entries);
    const fresh = harness(bounds, false, entries), cache = new MemoryGenerationCache();
    const registered = new Map<string, { descriptor: ForestTreeDescriptor; setVisible: (visible: boolean) => void }>();
    try {
      const resolved = resolveFairyDressing(bake.scene);
      const specs: Partial<Record<RegionId, RegionScatterSpec>> = {};
      const points: AuthoredPoint[] = [];
      for (const regionId of ['gloamgarden', 'faeholme'] as const) {
        const canopy = resolved.specs[regionId].layers.find(layer => layer.id === 'fairy_canopy')!;
        expect(canopy.authoredPoints!.filter(point => point.id.includes('_village_tree_')))
          .toHaveLength(regionId === 'gloamgarden' ? 20 : 7);
        points.push(...canopy.authoredPoints!);
        const exclusions = new ExclusionZones();
        for (const point of canopy.authoredPoints!) {
          // These trunks are authored on top of banks. Their 2D rock footprint is
          // deliberately reserved against procedural trees but must not cull them.
          exclusions.addTreeClearance([[point.position[0], 0, point.position[1]]], 2, `${point.id}_receiving_bank`);
          expect(exclusions.blocksTreeClearance(...point.position, 1)).toBe(true);
        }
        specs[regionId] = { ...resolved.specs[regionId], rect: bounds, exclusions,
          layers: [{ ...canopy, maxCount: 0 }] };
      }
      expect(new Set(points.map(point => point.id)).size).toBe(points.length);
      const tiles = [...new Map(points.map(point => {
        const tile = scatterTileAt(...point.position);
        return [tile.id, tile];
      })).values()];
      for (const tile of tiles) await scatterWorldTile(bake.scene, bake.assets, 1337, tile, specs, { cache, render: false });
      expect(bake.draws).toEqual([]);
      expect(bake.requested).toEqual([]);
      for (const tile of [...tiles].reverse()) await scatterWorldTile(loaded.scene, loaded.assets, 1337, tile, specs, {
        cache, onTree: (descriptor, setVisible) => {
          expect(registered.has(descriptor.id), 'Each authored tree has one forest registration').toBe(false);
          registered.set(descriptor.id, { descriptor, setVisible });
        },
      });
      expect(cache.hits).toBe(tiles.length);
      expect(loaded.draws).toHaveLength(points.length);
      expect(registered.size).toBe(points.length);
      for (const point of points) {
        const entry = entries.find(entry => entry.id === point.assetId)!;
        const id = `forest:1337:${point.id}`;
        const registration = registered.get(id)!;
        expect(registration, point.id).toBeDefined();
        const { descriptor, setVisible } = registration;
        expect(descriptor).toEqual({ id, assetId: point.assetId,
          resourceId: point.position[1] < 130 ? 'tree_gloam_willow' : 'tree_fae_yew',
          regionId: point.position[1] < 130 ? 'gloamgarden' : 'faeholme',
          position: [point.position[0], ground(...point.position) + point.heightOffset - point.sink
            - (entry.groundY ?? entry.base!.y) * point.scale, point.position[1]],
          rotationY: point.rotationY, scale: point.scale, trunkRadius: entry.trunkRadius! * point.scale });
        expect(descriptor.resourceId).toBe(treeSpeciesForAsset(point.assetId)!.resourceId);
        expect(descriptor.trunkRadius).toBeGreaterThan(0);
        const draw = loaded.draws.find(draw => draw.placement.forestTree?.id === id)!;
        expect(draw, id).toBeDefined();
        expect(draw.placement).toEqual({ position: descriptor.position, rotationY: point.rotationY,
          scale: point.scale, tilt: 0, forestTree: descriptor });
        const expected = new THREE.Matrix4().compose(new THREE.Vector3(...descriptor.position),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), point.rotationY),
          new THREE.Vector3().setScalar(point.scale));
        expected.elements.forEach((value, index) => expect(draw.matrix.elements[index]!, id).toBeCloseTo(value, 3));
        const root = new THREE.Vector3(0, entry.groundY ?? entry.base!.y, 0).applyMatrix4(draw.matrix);
        expect(root.y, `${id} authored soil line meets terrain`).toBeCloseTo(ground(...point.position) + point.heightOffset - point.sink, 4);
        // ForestResources uses this callback when harvesting activates the semantic tree or a
        // saved stump. The actual instanced geometry must disappear and restore at that slot.
        const matrix = new THREE.Matrix4();
        setVisible(false);
        draw.mesh.getMatrixAt(draw.slot, matrix);
        expect(Math.abs(matrix.determinant()), `${id} can hide its standing tree`).toBe(0);
        setVisible(true);
        draw.mesh.getMatrixAt(draw.slot, matrix);
        expect(matrix.elements, `${id} restores its authored pose`).toEqual(draw.matrix.elements);
      }
      // Cold regeneration and reverse-order cached loads publish identical resource identities.
      for (const tile of tiles) await scatterWorldTile(fresh.scene, fresh.assets, 1337, tile, specs);
      const descriptors = (draws: Draw[]) => draws.map(draw => draw.placement.forestTree!).sort((a, b) => a.id.localeCompare(b.id));
      expect(descriptors(fresh.draws)).toEqual(descriptors(loaded.draws));
    } finally { bake.dispose(); loaded.dispose(); fresh.dispose(); }
  });

  it('keeps village and upper-bank trunks clear of resolved roads and full rotated building footprints', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      const resolved = resolveFairyDressing(scene);
      const points = (['gloamgarden', 'faeholme'] as const).flatMap(regionId =>
        resolved.specs[regionId].layers.find(layer => layer.id === 'fairy_canopy')!.authoredPoints!);
      expect(points.filter(point => point.id.includes('_village_tree_'))).toHaveLength(27);
      expect(points.filter(point => !point.id.includes('_village_tree_')).length).toBeGreaterThanOrEqual(140);
      const roads = scene.getRoadPolylines(), stamps = collectRoadStamps(scene);
      expect(roads).toHaveLength(stamps.length);
      const buildings = FAIRY_REGIONS.flatMap(region => region.settlement?.buildings ?? []);
      expect(buildings).toHaveLength(12);
      const overlaps: string[] = [];
      for (const point of points) {
        const native = villageTreeEntries.find(entry => entry.id === point.assetId)!;
        expect(native.trunkRadius, point.assetId).toBeGreaterThan(0);
        const radius = native.trunkRadius! * point.scale;
        for (const [roadIndex, road] of roads.entries()) {
          const halfWidth = stamps[roadIndex]!.width! / 2;
          expect(halfWidth).toBeGreaterThan(0);
          for (let segment = 1; segment < road.length; segment++) {
            const a = road[segment - 1]!, b = road[segment]!;
            const dx = b[0] - a[0], dz = b[2] - a[2];
            const fraction = Math.max(0, Math.min(1, ((point.position[0] - a[0]) * dx
              + (point.position[1] - a[2]) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
            const distance = Math.hypot(point.position[0] - a[0] - fraction * dx,
              point.position[1] - a[2] - fraction * dz);
            if (distance - radius < halfWidth) overlaps.push(`${point.id} trunk overlaps road ${roadIndex}, segment ${segment}`
              + ` by ${(halfWidth + radius - distance).toFixed(3)} m at [${a[0]},${a[2]}] to [${b[0]},${b[2]}]`);
          }
        }
        // Reserve the trunk/root disk against the entire footprint, including the market and
        // bank roofs. A tree crown may overhang above a roof without its trunk entering it.
        for (const building of buildings) {
          const x = point.position[0] - building.position[0], z = point.position[1] - building.position[1];
          const cosine = Math.cos(building.rotationY), sine = Math.sin(building.rotationY);
          const distance = Math.hypot(Math.max(0, Math.abs(x * cosine - z * sine) - building.footprint[0] / 2),
            Math.max(0, Math.abs(x * sine + z * cosine) - building.footprint[1] / 2));
          if (distance < radius) overlaps.push(`${point.id} trunk overlaps ${building.id} by ${(radius - distance).toFixed(3)} m`);
        }
      }
      expect(overlaps).toEqual([]);
    } finally { scene.dispose(); }
  }, 20_000);
});
