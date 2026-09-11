import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import { WorldScene, type GrassSpritePlacement, type Rect, type ScatterPlacement } from "../game/src/render/scene.js";
import type { ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import {
  ExclusionZones, scatterRegion, scatterTilesForBounds, scatterWorldTile,
  type RegionScatterSpec, type ScatterLayerSpec, type ScatterTile,
} from "../game/src/world/scatter.js";

const FERN = "corealm_fern_1";
const SHRUB = "corealm_shrub_1";
const GRASS = "grass_common_short";
const TREE = "tree_common_5";
const PROP = "fixture_dry_branch";
const SEED = 4_207;
const NATIVE = /^corealm_(fern|shrub)_\d+$/;
const plainId = (id: string) => NATIVE.test(id) ? `fixture_${id}` : id;
type Specs = Partial<Record<RegionId, RegionScatterSpec>>;
type Surface = { height: number; normal: readonly [number, number, number]; slope: number; density: number };
const flat = (): Surface => ({ height: 0, normal: [0, 1, 0], slope: 0, density: 1 });
const ordinaryBounds: Rect = { minX: 1000, maxX: 1036, minZ: 1000, maxZ: 1036 };

interface MeshRow {
  assetId: string;
  regionId: RegionId;
  tileId: string;
  placement: ScatterPlacement;
  matrix: number[];
  radius: number;
}

function manifestEntry(id: string, size = { x: 2.8, y: 1.7, z: 1.9 }, base?: AssetEntry["base"]): AssetEntry {
  return {
    id, file: `${id}.glb`, pack: "deterministic-fixture", category: "nature", is: "plant", tags: [],
    bytes: 1, size, base: base ?? { x: -size.x / 2, y: 0, z: -size.z / 2 }, animations: [], materials: [],
  };
}

function layer(id = "mixed-cover", overrides: Partial<ScatterLayerSpec> = {}): ScatterLayerSpec {
  return {
    id, assetIds: [FERN, SHRUB], spacing: 0.8, maxCount: 320, scale: [0.7, 1.3],
    tilt: 0.65, mirror: true, bleed: 0,
    // Isolate authored recipes from buildings in the real world's REGIONS data.
    exclusion: { base: { hard: 0, fade: 0 }, authored: { hard: -10_000, fade: 0 } },
    ...overrides,
  };
}

function recipes(bounds = ordinaryBounds, layers = [layer()], regions: RegionId[] = ["fallowmarch"]): Specs {
  return Object.fromEntries(regions.map((regionId) => [regionId, {
    regionId, rect: bounds, layers, exclusions: new ExclusionZones(),
  } satisfies RegionScatterSpec]));
}

function surrogateSpecs(specs: Specs): Specs {
  return Object.fromEntries(Object.entries(specs).map(([region, spec]) => [region, {
    ...spec,
    layers: spec!.layers.map((entry) => ({
      ...entry, assetIds: entry.assetIds?.map(plainId),
      species: entry.species?.map((species) => ({ ...species, assetId: plainId(species.assetId) })),
    })),
  }]));
}

function harness(bounds = ordinaryBounds, regionIds: RegionId[] = ["fallowmarch"], replacements: AssetEntry[] = []) {
  const entries = new Map<string, AssetEntry>();
  const defaults = [
    manifestEntry(FERN), manifestEntry(SHRUB, { x: 3.5, y: 2.1, z: 2.4 }),
    manifestEntry(TREE, { x: 2, y: 8, z: 2 }),
    manifestEntry("corealm_oak_1", { x: 6, y: 7, z: 6 }, { x: -3.2, y: -0.2, z: -2.7 }),
    manifestEntry(GRASS, { x: 0.5, y: 0.8, z: 0.5 }),
    manifestEntry(PROP, { x: 0.8, y: 0.6, z: 0.4 }),
  ];
  for (const entry of [...defaults, ...replacements]) entries.set(entry.id, entry);
  for (const entry of [...entries.values()]) {
    if (NATIVE.test(entry.id)) entries.set(plainId(entry.id), { ...entry, id: plainId(entry.id) });
  }
  const material = new THREE.MeshBasicMaterial();
  const sources = new Map<string, THREE.Mesh>();
  for (const entry of entries.values()) {
    const { size, base } = entry;
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometry.translate((base?.x ?? -size.x / 2) + size.x / 2,
      (base?.y ?? 0) + size.y / 2, (base?.z ?? -size.z / 2) + size.z / 2);
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = entry.id;
    sources.set(entry.id, mesh);
  }
  const rows: MeshRow[] = [];
  const grass: { regionId: RegionId; placement: GrassSpritePlacement }[] = [];
  const trees: ForestTreeDescriptor[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const terrainGroup = new THREE.Group();
  terrainGroup.add(new THREE.Object3D());
  let surfaceAt = (_x: number, _z: number): Surface | null => flat();
  let failLoads = 0;
  let capture = true;
  let surfaceCalls = 0;
  const waters: { closed: boolean; centre: readonly [number, number]; contour: readonly (readonly [number, number])[]; level: number }[] = [];
  const roads: (readonly [number, number, number])[][] = [];
  const receiver = {
    scatterGroup: new THREE.Group(), scatterVisibility: { add: () => undefined }, registerScatter: () => undefined,
  };
  const scene = {
    terrainGroup,
    getScatterBounds: () => bounds,
    describeRegions: () => regionIds.map((regionId) => ({ regionId })),
    getRegionRect: (_regionId: RegionId) => bounds,
    getWaterBodies: () => waters, getRoadPolylines: () => roads,
    scatterSurfaceAt: (x: number, z: number) => { surfaceCalls += 1; return surfaceAt(x, z); },
    regionWeightAt: () => 1,
    regionAt: () => regionIds[0]!,
    meshHeightAt: (x: number, z: number) => surfaceAt(x, z)?.height ?? 0,
    normalAt: (x: number, z: number) => surfaceAt(x, z)?.normal ?? [0, 1, 0] as const,
    scatterGrassSprites: (next: readonly GrassSpritePlacement[], _name: string, options: { regionId: RegionId }) => {
      if (capture) grass.push(...next.map((placement) => ({ regionId: options.regionId, placement: structuredClone(placement) })));
      return [];
    },
    scatterInstanced: (source: THREE.Object3D, next: ScatterPlacement[], name: string, options: { regionId: RegionId }) => {
      if (!capture) return [];
      // The production renderer supplies the matrix oracle, including ground-normal tilt.
      const built = WorldScene.prototype.scatterInstanced.call(receiver as never, source, next, name, options);
      meshes.push(...built);
      const mesh = built[0]!;
      const box = mesh.geometry.boundingBox!;
      next.forEach((placement, slot) => {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(slot, matrix);
        let radius = 0;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const corner = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
          radius = Math.max(radius, Math.hypot(corner.x - placement.position[0], corner.z - placement.position[2]));
        }
        rows.push({ assetId: source.name, regionId: options.regionId, tileId: /-g(-?\d+:-?\d+)-/.exec(name)![1]!,
          placement: structuredClone(placement), matrix: [...matrix.elements], radius });
      });
      return built;
    },
  };
  const assets = {
    entry: (id: string) => entries.get(id), assetSize: (id: string) => entries.get(id)?.size ?? null,
    byTags: () => [], instance: (id: string) => sources.get(id)!,
    loadMany: async () => { await Promise.resolve(); if (failLoads > 0) { failLoads -= 1; throw new Error("fixture transient asset failure"); } },
  };
  const clear = () => {
    rows.length = 0; grass.length = 0; trees.length = 0;
    for (const mesh of meshes) mesh.dispose();
    meshes.length = 0; receiver.scatterGroup.clear();
  };
  return {
    scene, assets, entries, rows, grass, trees, waters, roads, clear,
    onTree: (tree: ForestTreeDescriptor) => { trees.push(structuredClone(tree)); },
    setSurface: (next: typeof surfaceAt) => { surfaceAt = next; },
    failNextLoad: () => { failLoads += 1; },
    setCapture: (next: boolean) => { capture = next; },
    takeSurfaceCalls: () => { const count = surfaceCalls; surfaceCalls = 0; return count; },
    regenerate: () => { terrainGroup.clear(); terrainGroup.add(new THREE.Object3D()); },
    dispose: () => { clear(); for (const source of sources.values()) source.geometry.dispose(); material.dispose(); },
  };
}

type Harness = ReturnType<typeof harness>;
async function populate(f: Harness, specs: Specs, seed = SEED, tiles = scatterTilesForBounds(f.scene.getScatterBounds()), concurrent = false) {
  const load = (tile: ScatterTile) => scatterWorldTile(f.scene as never, f.assets as never, seed, tile, specs,
    { onTree: f.onTree, yieldToMain: async () => { await Promise.resolve(); } });
  if (concurrent) return (await Promise.all(tiles.map(load))).flat();
  const results = [];
  for (const tile of tiles) results.push(...await load(tile));
  return results;
}

function fingerprint(f: Harness, plantsOnly = false): string[] {
  return f.rows.filter((row) => !plantsOnly || NATIVE.test(row.assetId))
    .map(({ assetId, regionId, tileId, placement, matrix }) => JSON.stringify({ assetId: plainId(assetId), regionId, tileId, placement, matrix })).sort();
}

const nativeRows = (f: Harness) => f.rows.filter((row) => NATIVE.test(row.assetId));
const distance = (a: MeshRow, b: MeshRow) => Math.hypot(a.placement.position[0] - b.placement.position[0], a.placement.position[2] - b.placement.position[2]);
function pairs(rows: readonly MeshRow[]): [MeshRow, MeshRow][] {
  const result: [MeshRow, MeshRow][] = [];
  for (let a = 0; a < rows.length; a += 1) for (let b = a + 1; b < rows.length; b += 1) result.push([rows[a]!, rows[b]!]);
  return result;
}
function expectSeparated(rows: readonly MeshRow[], footprints = true) {
  expect(rows.length).toBeGreaterThan(1);
  for (const [a, b] of pairs(rows)) {
    expect(distance(a, b), `${a.assetId} ${a.tileId} / ${b.assetId} ${b.tileId}`)
      .toBeGreaterThanOrEqual(Math.max(1.5, footprints ? 0.85 * (a.radius + b.radius) : 0) - 0.0005);
  }
}

describe("native understory spacing through production tile placement", () => {
  it("only removes fully composed native candidates from a layer shared with trees, grass and props", async () => {
    const specs = recipes(ordinaryBounds, [layer("mixed-cover", {
      species: [{ assetId: TREE }, { assetId: FERN, weight: 3 }, { assetId: GRASS, weight: 2 },
        { assetId: SHRUB, weight: 3 }, { assetId: PROP }], maxCount: 520,
    })]);
    const native = harness(); const baseline = harness();
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(native.trees.length).toBeGreaterThan(10);
      expect(native.trees).toEqual(baseline.trees);
      expect(native.grass.length).toBeGreaterThan(10);
      expect(native.grass).toEqual(baseline.grass);
      const untouched = (f: Harness) => f.rows.filter((row) => row.assetId === "corealm_oak_1" || row.assetId === PROP);
      expect(untouched(native)).toEqual(untouched(baseline));
      const raw = fingerprint(baseline);
      for (const kept of fingerprint(native)) expect(raw).toContain(kept);
      expect(nativeRows(native).length).toBeGreaterThan(5);
      expect(native.rows.length).toBeLessThan(baseline.rows.length);
      expectSeparated(nativeRows(native));
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("retains an isolated native candidate with its exact original transform", async () => {
    const bounds = { minX: 1000, maxX: 1006, minZ: 1000, maxZ: 1006 };
    const specs = recipes(bounds, [layer("isolated", { assetIds: [FERN], maxCount: 1 })]);
    const native = harness(bounds); const baseline = harness(bounds);
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(nativeRows(native)).toHaveLength(1);
      expect(fingerprint(native)).toEqual(fingerprint(baseline));
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("keeps the 1.5 m center minimum even for tiny native models", async () => {
    const bounds = { minX: 1000, maxX: 1012, minZ: 1000, maxZ: 1012 };
    const entries = [manifestEntry(FERN, { x: 0.1, y: 0.1, z: 0.1 })];
    const specs = recipes(bounds, [layer("tiny", { assetIds: [FERN], spacing: 0.3, maxCount: 240, scale: [1, 1] })]);
    const native = harness(bounds, undefined, entries); const baseline = harness(bounds, undefined, entries);
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(pairs(baseline.rows).some(([a, b]) => distance(a, b) < 1.5)).toBe(true);
      expectSeparated(nativeRows(native), false);
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("uses actual drawn bounds after nonuniform scale, yaw, off-center origin and terrain tilt", async () => {
    const entries = [manifestEntry(FERN, { x: 2.2, y: 5.5, z: 1.3 }, { x: 0.8, y: 0.2, z: -1.1 })];
    const specs = recipes(ordinaryBounds, [layer("leaning", { assetIds: [FERN], tilt: 1, scale: [0.6, 1.8], maxCount: 220 })]);
    const f = harness(ordinaryBounds, undefined, entries);
    f.setSurface((x, z) => ({ height: x * 0.15 + z * 0.2, normal: [-0.15, 1, -0.2], slope: 0.25, density: 1 }));
    try {
      await populate(f, specs);
      expect(nativeRows(f).some((row) => row.radius > 3)).toBe(true);
      expect(nativeRows(f).some((row) => row.matrix[1] !== 0 && row.matrix[9] !== 0)).toBe(true);
      expectSeparated(nativeRows(f));
    } finally { f.dispose(); }
  });

  it("measures the resolved native model after a legacy plant alias changes its scale", async () => {
    const entries = [manifestEntry("fern_1", { x: 5.6, y: 3.4, z: 3.8 })];
    const specs = recipes(ordinaryBounds, [layer("aliased", { assetIds: ["fern_1"], scale: [0.3, 0.6], maxCount: 300 })]);
    const equivalent = recipes(ordinaryBounds, [layer("aliased", { assetIds: [plainId(FERN)], scale: [0.6, 1.2], maxCount: 300 })]);
    const native = harness(ordinaryBounds, undefined, entries); const baseline = harness(ordinaryBounds, undefined, entries);
    try {
      await populate(native, specs); await populate(baseline, equivalent);
      expect(new Set(native.rows.map((row) => row.assetId))).toEqual(new Set([FERN]));
      expect(native.rows.length).toBeLessThan(baseline.rows.length);
      const raw = fingerprint(baseline);
      for (const kept of fingerprint(native)) expect(raw).toContain(kept);
      expectSeparated(nativeRows(native));
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("derives a halo wide enough for footprints two generation tiles apart", async () => {
    const bounds = { minX: 960, maxX: 1248, minZ: 1000, maxZ: 1006 };
    const regions: RegionId[] = ["fallowmarch", "vellenwood"];
    const specs = recipes(bounds, [layer("wide", { assetIds: [FERN], maxCount: 1, scale: [1, 1], tilt: 0 })], regions);
    specs.fallowmarch!.rect = { ...bounds, minX: 1050, maxX: 1056 };
    specs.vellenwood!.rect = { ...bounds, minX: 1152, maxX: 1158 };
    const entries = [manifestEntry(FERN, { x: 160, y: 1, z: 1 })];
    const native = harness(bounds, regions, entries); const baseline = harness(bounds, regions, entries);
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(baseline.rows).toHaveLength(2);
      const [a, b] = baseline.rows as [MeshRow, MeshRow];
      expect(Math.abs(Number(a.tileId.split(":")[0]) - Number(b.tileId.split(":")[0]))).toBe(2);
      expect(distance(a, b)).toBeLessThan(0.85 * (a.radius + b.radius));
      expect(native.rows).toHaveLength(1);
      expect(fingerprint(baseline)).toContain(fingerprint(native)[0]);
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("competes across species, separate layers and overlapping visual biomes", async () => {
    const regions: RegionId[] = ["fallowmarch", "vellenwood"];
    const specs = recipes(ordinaryBounds, [layer("ferns", { assetIds: [FERN], maxCount: 200 }),
      layer("shrubs", { assetIds: [SHRUB], maxCount: 200 })], regions);
    const native = harness(ordinaryBounds, regions); const baseline = harness(ordinaryBounds, regions);
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(new Set(native.rows.map((row) => row.regionId)).size).toBe(2);
      expect(new Set(native.rows.map((row) => row.assetId)).size).toBe(2);
      for (const distinct of [(a: MeshRow, b: MeshRow) => a.assetId !== b.assetId,
        (a: MeshRow, b: MeshRow) => a.regionId !== b.regionId]) {
        expect(pairs(baseline.rows).some(([a, b]) => distinct(a, b) && distance(a, b) < a.radius + b.radius)).toBe(true);
      }
      expectSeparated(nativeRows(native));
    } finally { native.dispose(); baseline.dispose(); }
  });

  it.each([[96, 96], [-96, -96], [96, -96], [-96, 96]])("keeps clustered footprints apart at the %i, %i tile corner", async (x, z) => {
    const bounds = { minX: x - 12, maxX: x + 12, minZ: z - 12, maxZ: z + 12 };
    const specs = recipes(bounds, [layer("corner-clusters", {
      maxCount: 200, scale: [0.45, 0.75], cluster: { spacing: 9, radius: [4, 5], memberSpacing: 0.65, accept: 1, falloff: 0 },
    })]);
    const native = harness(bounds); const baseline = harness(bounds);
    try {
      await populate(native, specs); await populate(baseline, surrogateSpecs(specs));
      expect(new Set(native.rows.map((row) => row.tileId)).size).toBe(4);
      expect(new Set(native.rows.map((row) => `${row.placement.position[0] < x}:${row.placement.position[2] < z}`)).size).toBe(4);
      const crossSeam = pairs(baseline.rows).filter(([a, b]) => a.tileId !== b.tileId && distance(a, b) < a.radius + b.radius);
      expect(crossSeam.length).toBeGreaterThan(0);
      expectSeparated(nativeRows(native));
    } finally { native.dispose(); baseline.dispose(); }
  });

  it("is stable under forward, reverse, concurrent, retried and regenerated tile loads", async () => {
    const bounds = { minX: 84, maxX: 108, minZ: 84, maxZ: 108 };
    const specs = recipes(bounds, [layer("order", { maxCount: 180 })]);
    const tiles = scatterTilesForBounds(bounds);
    const forward = harness(bounds); const reverse = harness(bounds); const concurrent = harness(bounds); const retry = harness(bounds);
    try {
      await populate(forward, specs);
      const expected = fingerprint(forward);
      expect(expected.length).toBeGreaterThan(5);
      await populate(reverse, specs, SEED, [...tiles].reverse());
      await populate(concurrent, specs, SEED, tiles, true);
      expect(fingerprint(reverse)).toEqual(expected);
      expect(fingerprint(concurrent)).toEqual(expected);
      retry.failNextLoad();
      await expect(populate(retry, specs, SEED, [tiles[0]!])).rejects.toThrow("fixture transient asset failure");
      retry.clear();
      await populate(retry, specs);
      expect(fingerprint(retry)).toEqual(expected);
      forward.clear(); forward.regenerate();
      await populate(forward, specs);
      expect(fingerprint(forward)).toEqual(expected);
      forward.clear();
      await scatterRegion(forward.scene as never, forward.assets as never, "fallowmarch", specs.fallowmarch!, SEED);
      expect(fingerprint(forward)).toEqual(expected);
    } finally { forward.dispose(); reverse.dispose(); concurrent.dispose(); retry.dispose(); }
  });

  it("invalidates cached candidates when terrain, seed, assets or recipe identity changes", async () => {
    const specs = recipes();
    const f = harness();
    try {
      await populate(f, specs);
      const original = fingerprint(f);
      f.clear();
      await populate(f, recipes());
      expect(fingerprint(f)).toEqual(original);
      f.clear();
      specs.fallowmarch!.exclusions!.addCircle(1018, 1018, 100, "custom", "new-building");
      await populate(f, specs);
      expect(f.rows).toEqual([]);
      specs.fallowmarch!.exclusions!.clear();
      await populate(f, specs);
      expect(fingerprint(f)).toEqual(original);
      f.clear();
      await populate(f, specs, SEED + 1);
      expect(fingerprint(f)).not.toEqual(original);
      f.clear();
      const sparse = recipes(ordinaryBounds, [layer("mixed-cover", { maxCount: 1 })]);
      await populate(f, sparse);
      expect(nativeRows(f)).toHaveLength(1);
      f.clear(); f.setSurface(() => null); f.regenerate();
      await populate(f, specs);
      expect(f.rows).toEqual([]);
      f.clear(); f.setSurface(flat); f.regenerate();
      await populate(f, specs);
      expect(fingerprint(f)).toEqual(original);
      f.clear();
      const alternate = harness();
      try {
        const noPlants = { ...alternate.assets, entry: (id: string) => NATIVE.test(id) ? undefined : alternate.assets.entry(id) };
        await scatterWorldTile(f.scene as never, noPlants as never, SEED, scatterTilesForBounds(ordinaryBounds)[0]!, specs);
        expect(f.rows).toEqual([]);
      } finally { alternate.dispose(); }
    } finally { f.dispose(); }
  });

  it("allows equivalent immutable recipes to plan different tiles concurrently on one scene", async () => {
    const bounds = { minX: 84, maxX: 108, minZ: 84, maxZ: 108 };
    const tiles = scatterTilesForBounds(bounds);
    const immutableRecipes = () => {
      const specs = recipes(bounds, [layer("immutable-concurrent", { maxCount: 180 })]);
      for (const spec of Object.values(specs)) {
        for (const entry of spec.layers) {
          Object.freeze(entry.assetIds);
          Object.freeze(entry.scale);
          Object.freeze(entry);
        }
        Object.freeze(spec.layers);
        Object.freeze(spec);
      }
      return Object.freeze(specs);
    };
    const sequential = harness(bounds); const concurrent = harness(bounds);
    try {
      for (const tile of tiles) await populate(sequential, immutableRecipes(), SEED, [tile]);
      await Promise.all(tiles.map((tile) => populate(concurrent, immutableRecipes(), SEED, [tile])));
      expect(new Set(concurrent.rows.map((row) => row.tileId)).size).toBe(4);
      expect(fingerprint(concurrent)).toEqual(fingerprint(sequential));
      expectSeparated(nativeRows(concurrent));
    } finally { sequential.dispose(); concurrent.dispose(); }
  });

  it("rebuilds an evicted distant tile without changing its contents", async () => {
    const bounds = { minX: 960, maxX: 4416, minZ: 960, maxZ: 968 };
    const specs = recipes(bounds, [layer("long-travel", { assetIds: [FERN], spacing: 8, maxCount: 180 })]);
    const f = harness(bounds);
    const tiles = scatterTilesForBounds(bounds);
    try {
      expect(tiles).toHaveLength(36);
      await populate(f, specs, SEED, [tiles[0]!]);
      const first = fingerprint(f);
      expect(first.length).toBeGreaterThan(0);
      f.clear(); f.setCapture(false);
      await populate(f, specs, SEED, tiles.slice(1));
      f.setCapture(true); f.takeSurfaceCalls();
      await populate(f, specs, SEED, [tiles[0]!]);
      // Replaying a cached owner's five transforms alone costs five surface reads.
      expect(f.takeSurfaceCalls()).toBeGreaterThan(5);
      expect(fingerprint(f)).toEqual(first);
    } finally { f.dispose(); }
  });

  it("reuses raw plans for adjacent and repeated owners while terrain rebuilds preserve every stream", async () => {
    const bounds = { minX: 84, maxX: 108, minZ: 84, maxZ: 108 };
    const specs = recipes(bounds, [layer("cached-mixed", {
      species: [{ assetId: FERN, weight: 3 }, { assetId: GRASS }, { assetId: TREE }], maxCount: 240,
    })]);
    const f = harness(bounds);
    const tiles = scatterTilesForBounds(bounds);
    const snapshot = () => ({ rows: fingerprint(f), grass: structuredClone(f.grass), trees: structuredClone(f.trees) });
    try {
      await populate(f, specs, SEED, [tiles[0]!]);
      const expected = snapshot();
      expect(expected.grass.length).toBeGreaterThan(0);
      expect(expected.trees.length).toBeGreaterThan(0);
      const coldCalls = f.takeSurfaceCalls();
      f.clear();
      await populate(f, specs, SEED, [tiles[1]!]);
      const adjacentCalls = f.takeSurfaceCalls();
      f.clear();
      await populate(f, specs, SEED, [tiles[0]!]);
      const revisitCalls = f.takeSurfaceCalls();
      expect(adjacentCalls).toBeGreaterThan(0);
      expect(adjacentCalls).toBeLessThan(coldCalls / 2);
      expect(revisitCalls).toBeLessThan(coldCalls / 2);
      expect(snapshot()).toEqual(expected);
      f.clear(); f.regenerate();
      await populate(f, specs, SEED, [tiles[0]!]);
      expect(f.takeSurfaceCalls()).toBeGreaterThan(revisitCalls);
      expect(snapshot()).toEqual(expected);
    } finally { f.dispose(); }
  });

  it("rejects an in-flight stale terrain plan before publishing instances", async () => {
    const f = harness();
    const specs = recipes();
    let changed = false;
    try {
      await expect(scatterWorldTile(f.scene as never, f.assets as never, SEED,
        scatterTilesForBounds(ordinaryBounds)[0]!, specs, { yieldToMain: async () => {
          if (!changed) { changed = true; f.regenerate(); }
          await Promise.resolve();
        } })).rejects.toThrow("invalidated by changed world inputs");
      expect(f.rows).toEqual([]);
      await populate(f, specs);
      expect(nativeRows(f).length).toBeGreaterThan(0);
      expectSeparated(nativeRows(f));
    } finally { f.dispose(); }
  });

  it("keeps dry-land, water, road and gameplay exclusions authoritative", async () => {
    const bounds = { minX: 1000, maxX: 1090, minZ: 1000, maxZ: 1090 };
    const specs = recipes(bounds, [layer("protected", { maxCount: 900, spacing: 1.1 })]);
    specs.fallowmarch!.exclusions!.addCircle(1042, 1022, 7, "road", "fixture-road")
      .addCircle(1062, 1022, 7, "custom", "fixture-gameplay");
    const f = harness(bounds);
    f.waters.push({ closed: true, centre: [1022, 1022], contour: [[1030, 1022], [1022, 1030], [1014, 1022], [1022, 1014]], level: 0 });
    f.setSurface((x, z) => x >= 1080 ? null : { ...flat(), density: z < 1080 ? 1 : 0 });
    try {
      await populate(f, specs);
      expect(nativeRows(f).length).toBeGreaterThan(15);
      for (const row of nativeRows(f)) {
        const [x, , z] = row.placement.position;
        expect(x).toBeLessThan(1080); expect(z).toBeLessThan(1080);
        expect(Math.hypot(x - 1022, z - 1022)).toBeGreaterThanOrEqual(9.2);
        expect(Math.hypot(x - 1042, z - 1022)).toBeGreaterThan(7);
        expect(Math.hypot(x - 1062, z - 1022)).toBeGreaterThan(7);
      }
      expectSeparated(nativeRows(f));
    } finally { f.dispose(); }
  });
});

it.skipIf(process.env.SCATTER_SPACING_TIMING !== "1")("reports production CPU tile-planning timings on a synthetic surface", async () => {
  const bounds = { minX: 960, maxX: 1248, minZ: 960, maxZ: 1248 };
  const specs = recipes(bounds, [layer("timed-cover", { maxCount: 9_000, spacing: 1.2 }),
    layer("timed-shrubs", { assetIds: [SHRUB], maxCount: 2_700, spacing: 2.2 })]);
  const reports = [];
  for (const [label, active] of [["native", specs], ["surrogate baseline", surrogateSpecs(specs)]] as const) {
    const f = harness(bounds);
    f.setCapture(false);
    try {
      const tiles = scatterTilesForBounds(bounds);
      for (const [phase, tile] of [["first", tiles[4]!], ["adjacent", tiles[5]!], ["revisit", tiles[4]!]] as const) {
        f.takeSurfaceCalls();
        const start = performance.now();
        const results = await populate(f, active, SEED, [tile]);
        reports.push({ label, phase, tileId: tile.id, elapsedMs: Number((performance.now() - start).toFixed(2)),
          placed: results.reduce((total, result) => total + result.placed, 0), surfaceCalls: f.takeSurfaceCalls() });
      }
    } finally { f.dispose(); }
  }
  console.log(JSON.stringify({ fixture: "synthetic flat surface, production scatterWorldTile, asset loading and render submission stubbed", reports }));
}, 10_000);
