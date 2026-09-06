import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId, Vec3 } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import { WorldScene, type GrassSpritePlacement, type Rect, type ScatterPlacement } from "../game/src/render/scene.js";
import type { ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import {
  ExclusionZones, scatterTilesForBounds, scatterWorldTile,
  type RegionScatterSpec, type ScatterLayerSpec,
} from "../game/src/world/scatter.js";

const point = (x: number, z: number, y = 0): Vec3 => [x, y, z];

describe("tree clearance footprints", () => {
  it("expands a point by the sum of body and trunk radii, including contact", () => {
    const zones = new ExclusionZones();
    expect(zones.addTreeClearance([point(3, -4, 50)], 0.75, "resident")).toBe(zones);
    expect(zones.blocksTreeClearance(3, -4, 0)).toBe(true);
    expect(zones.blocksTreeClearance(4.25, -4, 0.5)).toBe(true);
    expect(zones.blocksTreeClearance(4.2501, -4, 0.5)).toBe(false);
    expect(zones.blocksTreeClearance(3.9, -4, 0)).toBe(false);
    expect(zones.blocksTreeClearance(3.9, -4, 0.2)).toBe(true);
    const zero = new ExclusionZones().addTreeClearance([point(1, 2)], 0);
    expect(zero.blocksTreeClearance(1, 2, 0)).toBe(true);
    expect(zero.blocksTreeClearance(1.0001, 2, 0)).toBe(false);
  });

  it("covers the full segment and its rounded ends without widening its corners", () => {
    const zones = new ExclusionZones().addTreeClearance([point(-3, -4), point(3, 4)], 0.6);
    // A perpendicular offset from the middle of this 3-4-5 direction.
    expect(zones.blocksTreeClearance(0.8, -0.6, 0.4)).toBe(true);
    expect(zones.blocksTreeClearance(0.80008, -0.60006, 0.4)).toBe(false);
    expect(zones.blocksTreeClearance(3.6, 4.8, 0.4)).toBe(true);
    expect(zones.blocksTreeClearance(3.60006, 4.80008, 0.4)).toBe(false);
    expect(zones.blocksTreeClearance(-2, -8 / 3, 0)).toBe(true);
    expect(zones.blocksTreeClearance(3.8, 4.8, 0.4)).toBe(false);
  });

  it("uses the convex interior and exact edges for unordered points and either winding", () => {
    const points = [point(4, 4), point(-4, -4), point(0, 0), point(-4, 4), point(4, -4), point(4, 4)];
    const forward = new ExclusionZones().addTreeClearance(points, 0.6);
    const reverse = new ExclusionZones().addTreeClearance([...points].reverse(), 0.6);
    const queries: [number, number, boolean][] = [
      [0, 0, true], [3, -3, true], [4, 0, true], [5, 0, true], [5.0001, 0, false],
      [4.6, 4.8, true], [4.60006, 4.80008, false], [4.9, 4.9, false], [-4.6, -4.8, true],
    ];
    for (const [x, z, expected] of queries) {
      expect(forward.blocksTreeClearance(x, z, 0.4), `${x},${z}`).toBe(expected);
      expect(reverse.blocksTreeClearance(x, z, 0.4), `reverse ${x},${z}`).toBe(expected);
    }
    expect(points[0]).toEqual(point(4, 4));
  });

  it("handles empty, duplicate and collinear routes and clears all registered footprints", () => {
    const zones = new ExclusionZones().addTreeClearance([], 20);
    expect(zones.blocksTreeClearance(0, 0, 100)).toBe(false);
    zones.addTreeClearance([point(0, 0), point(2, 0), point(2, 0), point(-2, 0), point(1, 0)], 0.5);
    expect(zones.blocksTreeClearance(-1, 0.75, 0.25)).toBe(true);
    expect(zones.blocksTreeClearance(2.75, 0, 0.25)).toBe(true);
    expect(zones.blocksTreeClearance(2.7501, 0, 0.25)).toBe(false);
    zones.addTreeClearance([point(10, 10), point(10, 10)], 0.2);
    expect(zones.blocksTreeClearance(10, 10, 0)).toBe(true);
    zones.addCircle(30, 30, 2);
    zones.clear();
    expect(zones.blocksTreeClearance(0, 0, 100)).toBe(false);
    expect(zones.blocks(30, 30)).toBe(false);
  });

  it("keeps tree clearances separate from general planting density and early exclusions", () => {
    const zones = new ExclusionZones().addCircle(20, 0, 2, "road")
      .addOrientedRect(-20, 0, 4, 8, Math.PI / 4, 1, "building");
    const profile = { base: { hard: 1, fade: 3 } };
    const queries = [point(0, 0), point(20, 0), point(24, 0), point(-20, 0), point(-14, 0)];
    const before = queries.map(([x, , z]) => [zones.densityAt(x, z, profile), zones.blocks(x, z)]);
    zones.addTreeClearance([point(-30, -10), point(30, -10), point(0, 20)], 2, "herd");
    expect(queries.map(([x, , z]) => [zones.densityAt(x, z, profile), zones.blocks(x, z)])).toEqual(before);
    expect(zones.blocksTreeClearance(0, 0, 0)).toBe(true);
    expect(zones.densityAt(0, 0, profile)).toBe(1);
    expect(zones.blocks(0, 0)).toBe(false);
  });
});

const BOUNDS: Rect = { minX: 1000, maxX: 1036, minZ: 1000, maxZ: 1036 };
const NATIVE_TREE = /^corealm_(oak|pine)_\d+$/;
const TRUNK_RADIUS: Readonly<Record<string, number>> = { corealm_oak_1: 0.28, corealm_pine_2: 0.23 };
type TreePlacement = ScatterPlacement & { forestTree?: ForestTreeDescriptor };
interface MeshRow { assetId: string; placement: TreePlacement; matrix: number[] }

function entry(id: string, size: AssetEntry["size"], base?: AssetEntry["base"]): AssetEntry {
  return { id, file: `${id}.glb`, pack: "fixture", category: "nature", is: "plant", tags: [], bytes: 1,
    size, base: base ?? { x: -size.x / 2, y: 0, z: -size.z / 2 }, animations: [], materials: [] };
}

function harness(exclusions = new ExclusionZones(), options: { nativeOnly?: boolean; decorative?: boolean } = {}) {
  const entries = new Map([
    entry("tree_common_5", { x: 6, y: 8, z: 4 }, { x: 2.5, y: -0.2, z: -3 }),
    entry("tree_pine_5", { x: 3, y: 10, z: 3 }, { x: 2, y: 0, z: -2 }),
    entry("corealm_oak_1", { x: 6, y: 7, z: 6 }, { x: -2.5, y: -0.3, z: -3.7 }),
    entry("corealm_pine_2", { x: 4, y: 8, z: 4 }, { x: -2.3, y: -0.1, z: -1.6 }),
    entry("tree_dead_5", { x: 3, y: 6, z: 3 }),
    entry("grass_common_short", { x: 0.5, y: 0.8, z: 0.5 }),
    entry("corealm_fern_1", { x: 1.4, y: 1, z: 1.2 }),
    entry("corealm_shrub_1", { x: 1.8, y: 1.3, z: 1.5 }),
    entry("fixture_stone", { x: 0.7, y: 0.4, z: 0.6 }),
  ].map((asset) => [asset.id, asset]));
  const material = new THREE.MeshBasicMaterial();
  const sources = new Map([...entries.values()].map((asset) => {
    const geometry = new THREE.BoxGeometry(asset.size.x, asset.size.y, asset.size.z);
    geometry.translate(asset.base!.x + asset.size.x / 2, asset.base!.y + asset.size.y / 2, asset.base!.z + asset.size.z / 2);
    const source = new THREE.Mesh(geometry, material);
    source.name = asset.id;
    return [asset.id, source] as const;
  }));
  const rows: MeshRow[] = [];
  const grass: GrassSpritePlacement[] = [];
  const trees: ForestTreeDescriptor[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  const receiver = { scatterGroup: new THREE.Group(), scatterVisibility: { add: () => undefined }, registerScatter: () => undefined };
  const terrainGroup = new THREE.Group();
  terrainGroup.add(new THREE.Object3D());
  const semanticBounds = options.decorative ? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    : { minX: 980, maxX: 1056, minZ: 980, maxZ: 1056 };
  const scene = {
    terrainGroup, getScatterBounds: () => BOUNDS,
    describeRegions: () => [{ regionId: "fallowmarch" as const }],
    getRegionRect: () => semanticBounds,
    getWaterBodies: () => [], getRoadPolylines: () => [],
    scatterSurfaceAt: (x: number, z: number) => ({ height: x * 0.001 + z * 0.002, normal: [0.2, 0.97, -0.1] as const, slope: 0.03, density: 1 }),
    regionWeightAt: () => 1, meshHeightAt: (x: number, z: number) => x * 0.001 + z * 0.002,
    normalAt: () => [0.2, 0.97, -0.1] as const,
    scatterGrassSprites: (placements: readonly GrassSpritePlacement[]) => { grass.push(...structuredClone(placements)); return []; },
    scatterInstanced: (source: THREE.Object3D, placements: TreePlacement[], name: string, drawOptions: { regionId: RegionId }) => {
      const built = WorldScene.prototype.scatterInstanced.call(receiver as never, source, placements, name, drawOptions);
      meshes.push(...built);
      placements.forEach((placement, slot) => {
        const matrix = new THREE.Matrix4();
        built[0]!.getMatrixAt(slot, matrix);
        rows.push({ assetId: source.name, placement: structuredClone(placement), matrix: [...matrix.elements] });
      });
      return built;
    },
  };
  const assets = {
    entry: (id: string) => entries.get(id), assetSize: (id: string) => entries.get(id)?.size ?? null,
    byTags: () => [], instance: (id: string) => sources.get(id)!, loadMany: async () => undefined,
  };
  const layer: ScatterLayerSpec = {
    id: "mixed-habitat", assetIds: options.nativeOnly ? ["corealm_oak_1", "corealm_pine_2"] : [
      "tree_common_5", "tree_pine_5", "grass_common_short", "corealm_fern_1", "corealm_shrub_1", "tree_dead_5", "fixture_stone",
    ],
    spacing: 1, maxCount: 280, scale: options.nativeOnly ? [2, 2] : [0.7, 1.4], tilt: 0.6, mirror: true, bleed: 0,
    exclusion: { base: { hard: 0, fade: 0 }, authored: { hard: -10_000, fade: 0 } },
  };
  const spec: RegionScatterSpec = { regionId: "fallowmarch", rect: BOUNDS, exclusions, layers: [layer] };
  const clear = () => {
    rows.length = 0; grass.length = 0; trees.length = 0;
    for (const mesh of meshes) mesh.dispose();
    meshes.length = 0; receiver.scatterGroup.clear();
  };
  return { scene, assets, rows, grass, trees, spec, clear, dispose() {
    clear(); for (const source of sources.values()) source.geometry.dispose(); material.dispose();
  } };
}

type Fixture = ReturnType<typeof harness>;
async function populate(fixture: Fixture) {
  const results = [];
  for (const tile of scatterTilesForBounds(BOUNDS)) results.push(...await scatterWorldTile(
    fixture.scene as never, fixture.assets as never, 24_981, tile, { fallowmarch: fixture.spec },
    { onTree: (tree) => { fixture.trees.push(structuredClone(tree)); }, yieldToMain: async () => undefined },
  ));
  return results;
}
const bytes = (rows: readonly unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
const isTree = (row: MeshRow) => NATIVE_TREE.test(row.assetId);
const sourceXZ = (tree: ForestTreeDescriptor) => tree.id.split(":").slice(-2).map(Number);
function pointBlocks(row: MeshRow, centre: Vec3, bodyRadius: number): boolean {
  if (!isTree(row)) return false;
  const scale = row.placement.scale;
  if (typeof scale !== "number") throw new Error("Native tree fixture must compose a uniform scale");
  return Math.hypot(row.placement.position[0] - centre[0], row.placement.position[2] - centre[2])
    <= bodyRadius + TRUNK_RADIUS[row.assetId]! * scale;
}

describe("tree clearance through production scatter", () => {
  it("only removes intersecting composed native trees from a mixed layer without refills or stream changes", async () => {
    const baseline = harness();
    const exclusions = new ExclusionZones();
    const cleared = harness(exclusions);
    try {
      const before = await populate(baseline);
      expect(baseline.trees.length).toBeGreaterThan(30);
      expect(baseline.grass.length).toBeGreaterThan(20);
      expect(baseline.rows.some((row) => row.assetId === "corealm_fern_1")).toBe(true);
      expect(baseline.rows.some((row) => row.assetId === "corealm_shrub_1")).toBe(true);
      const centres = [baseline.trees[0]!, baseline.trees[15]!, baseline.trees[30]!].map((tree) => tree.position);
      for (const centre of centres) exclusions.addTreeClearance([centre], 1.2, "resident");
      const rejected = baseline.rows.filter((row) => centres.some((centre) => pointBlocks(row, centre, 1.2)));
      const rejectedIds = new Set(rejected.map((row) => row.placement.forestTree!.id));
      expect(rejected.length).toBeGreaterThanOrEqual(3);
      expect(rejected.length).toBeLessThan(baseline.trees.length);
      const after = await populate(cleared);
      expect(bytes(cleared.rows)).toEqual(bytes(baseline.rows.filter((row) => !rejected.includes(row))));
      expect(bytes(cleared.trees)).toEqual(bytes(baseline.trees.filter((tree) => !rejectedIds.has(tree.id))));
      expect(bytes(cleared.grass)).toEqual(bytes(baseline.grass));
      expect(bytes(cleared.rows.filter((row) => !isTree(row)))).toEqual(bytes(baseline.rows.filter((row) => !isTree(row))));
      expect(after.reduce((sum, result) => sum + result.placed, 0)).toBe(before.reduce((sum, result) => sum + result.placed, 0) - rejected.length);
      expect(after.reduce((sum, result) => sum + result.rejected, 0)).toBe(before.reduce((sum, result) => sum + result.rejected, 0) + rejected.length);
    } finally { baseline.dispose(); cleared.dispose(); }
  });

  it("checks the relocated trunk origin instead of the encoded source candidate", async () => {
    const baseline = harness();
    const atTrunk = harness();
    const atCandidate = harness();
    try {
      await populate(baseline);
      const tree = baseline.trees.find((candidate) => {
        const [x, z] = sourceXZ(candidate);
        return Math.hypot(candidate.position[0] - x!, candidate.position[2] - z!) > candidate.trunkRadius + 1;
      })!;
      expect(tree).toBeDefined();
      const [sourceX, sourceZ] = sourceXZ(tree);
      atTrunk.spec.exclusions!.addTreeClearance([tree.position], 0.1);
      atCandidate.spec.exclusions!.addTreeClearance([point(sourceX!, sourceZ!)], 0.1);
      await populate(atTrunk); await populate(atCandidate);
      expect(atTrunk.trees.some((entry) => entry.id === tree.id)).toBe(false);
      expect(atCandidate.trees.find((entry) => entry.id === tree.id)).toEqual(tree);
      expect(atCandidate.rows.find((row) => row.placement.forestTree?.id === tree.id))
        .toEqual(baseline.rows.find((row) => row.placement.forestTree?.id === tree.id));
    } finally { baseline.dispose(); atTrunk.dispose(); atCandidate.dispose(); }
  });

  it("uses the scaled native trunk radius for direct oak and pine recipes", async () => {
    const baseline = harness(new ExclusionZones(), { nativeOnly: true });
    const clearances = new ExclusionZones();
    const cleared = harness(clearances, { nativeOnly: true });
    try {
      await populate(baseline);
      const selected = ["corealm_oak_1", "corealm_pine_2"].map((assetId) => baseline.trees.find((tree) => tree.assetId === assetId)!);
      for (const tree of selected) {
        expect(tree.trunkRadius).toBeGreaterThan(TRUNK_RADIUS[tree.assetId]! * 1.5);
        clearances.addTreeClearance([point(tree.position[0] + tree.trunkRadius + 0.2 - 0.0001, tree.position[2])], 0.2);
      }
      await populate(cleared);
      for (const tree of selected) expect(cleared.trees.some((entry) => entry.id === tree.id)).toBe(false);
      for (const tree of cleared.trees) expect(baseline.trees.find((entry) => entry.id === tree.id)).toEqual(tree);
    } finally { baseline.dispose(); cleared.dispose(); }
  });

  it("also clears decorative native trunks beyond semantic bounds", async () => {
    const baseline = harness(new ExclusionZones(), { nativeOnly: true, decorative: true });
    const clearances = new ExclusionZones();
    const cleared = harness(clearances, { nativeOnly: true, decorative: true });
    try {
      await populate(baseline);
      expect(baseline.trees).toEqual([]);
      expect(baseline.rows.length).toBeGreaterThan(30);
      const centre = baseline.rows[0]!.placement.position;
      clearances.addTreeClearance([centre], 0.4);
      await populate(cleared);
      expect(bytes(cleared.rows)).toEqual(bytes(baseline.rows.filter((row) => !pointBlocks(row, centre, 0.4))));
      expect(cleared.rows.length).toBeLessThan(baseline.rows.length);
      expect(cleared.trees).toEqual([]);
    } finally { baseline.dispose(); cleared.dispose(); }
  });

  it("applies new clearances to a cached mixed tile and restores its exact placements after clear", async () => {
    const exclusions = new ExclusionZones();
    const fixture = harness(exclusions);
    try {
      await populate(fixture);
      const originalRows = structuredClone(fixture.rows);
      const originalTrees = structuredClone(fixture.trees);
      const originalGrass = structuredClone(fixture.grass);
      const centre = fixture.trees[0]!.position;
      fixture.clear(); exclusions.addTreeClearance([centre], 1.2);
      await populate(fixture);
      expect(bytes(fixture.rows)).toEqual(bytes(originalRows.filter((row) => !pointBlocks(row, centre, 1.2))));
      expect(fixture.rows.length).toBeLessThan(originalRows.length);
      expect(bytes(fixture.grass)).toEqual(bytes(originalGrass));
      fixture.clear(); exclusions.clear();
      await populate(fixture);
      expect(bytes(fixture.rows)).toEqual(bytes(originalRows));
      expect(bytes(fixture.trees)).toEqual(bytes(originalTrees));
      expect(bytes(fixture.grass)).toEqual(bytes(originalGrass));
    } finally { fixture.dispose(); }
  });
});
