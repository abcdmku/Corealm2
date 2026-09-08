import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId, Vec3 } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import type { ScatterPlacement } from "../game/src/render/scene.js";
import type { ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import { ExclusionZones, scatterTilesForBounds, scatterWorldTile, type RegionScatterSpec } from "../game/src/world/scatter.js";
import { ScatterStreamingController } from "../game/src/world/scatterStreaming.js";

const bounds = { minX: 1000, maxX: 1192, minZ: 1000, maxZ: 1096 };

function harness(sourceAsset = "tree_common_5") {
  const entries = new Map<string, AssetEntry>();
  for (const id of ["tree_common_5", "tree_common_3", "tree_pine_5", "tree_dead_5", "corealm_oak_1", "corealm_oak_3", "corealm_pine_2", "corealm_willow_1"]) {
    const native = id.startsWith("corealm_");
    entries.set(id, {
      id, file: `${id}.glb`, pack: "fixture", category: "nature", is: "tree", tags: ["tree"], bytes: 1,
      size: native ? { x: 6, y: 7, z: 6 } : { x: 2, y: 8, z: 2 },
      base: native ? { x: -3.2, y: -0.2, z: -2.7 } : { x: -1, y: -0.2, z: -1 },
      animations: [], materials: ["Bark_Corealm", "Leaves_Corealm"],
    });
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  const batches: { assetId: string; placements: readonly ScatterPlacement[]; meshes: THREE.InstancedMesh[] }[] = [];
  const loaded = new Set<string>();
  const assets = {
    entry: (id: string) => entries.get(id), byTags: () => [],
    loadMany: async (ids: readonly string[]) => { for (const id of ids) loaded.add(id); },
    instance: (id: string) => ({ name: id }),
  };
  const scene = {
    getScatterBounds: () => bounds,
    describeRegions: () => [{ regionId: "fallowmarch" as const }, { regionId: "vellenwood" as const }],
    regionAt: (x: number) => x < 1096 ? "fallowmarch" as const : "vellenwood" as const,
    getRegionRect: (regionId: RegionId) => ({
      ...bounds, minX: regionId === "fallowmarch" ? 1000 : 1096,
      maxX: regionId === "fallowmarch" ? 1096 : 1144,
    }),
    getWaterBodies: (): { closed: boolean; centre: [number, number]; level: number; contour: [number, number][] }[] => [], getRoadPolylines: () => [],
    scatterSurfaceAt: (x: number) => ({ height: 3 + x * 0.002, normal: [0, 1, 0] as const, slope: 0, density: 1 }),
    regionWeightAt: () => 1, meshHeightAt: (x: number) => 3 + x * 0.002,
    normalAt: () => [0, 1, 0] as const,
    scatterInstanced: (source: { name: string }, placements: readonly ScatterPlacement[]) => {
      const meshes = [0, 1].map((part) => {
        const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
        const local = new THREE.Matrix4().makeTranslation(part * 0.2, part * 2, 0);
        placements.forEach((placement, slot) => {
          const scale = typeof placement.scale === "number" ? new THREE.Vector3().setScalar(placement.scale) : new THREE.Vector3(...placement.scale);
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...placement.position),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY), scale,
          ).multiply(local);
          mesh.setMatrixAt(slot, matrix);
        });
        return mesh;
      });
      batches.push({ assetId: source.name, placements, meshes });
      return meshes;
    },
  };
  const spec: RegionScatterSpec = {
    regionId: "fallowmarch", rect: bounds, exclusions: new ExclusionZones(), layers: [{
      id: "forest", assetIds: [sourceAsset], spacing: 9, maxCount: 200, scale: [1, 1], bleed: 0,
      exclusion: { base: { hard: 0, fade: 0 } }, castShadow: true,
    }],
  };
  const registered: { descriptor: ForestTreeDescriptor; setVisible: (visible: boolean) => void }[] = [];
  const onTree = (descriptor: ForestTreeDescriptor, setVisible: (visible: boolean) => void) => {
    expect(batches.at(-1)!.meshes).toHaveLength(2);
    registered.push({ descriptor, setVisible });
  };
  return { assets, scene, batches, spec, registered, loaded, onTree, dispose() {
    for (const batch of batches) for (const mesh of batch.meshes) mesh.dispose();
    geometry.dispose(); material.dispose();
  } };
}

async function populate(f: ReturnType<typeof harness>, reverse = false) {
  const tiles = scatterTilesForBounds(bounds);
  for (const tile of reverse ? tiles.reverse() : tiles) await scatterWorldTile(
    f.scene as never, f.assets as never, 801, tile, { fallowmarch: f.spec }, { onTree: f.onTree },
  );
}

describe("scatter forest resource bridge", () => {
  it("places shoreline-only willows on dry banks and none in a waterless forest", async () => {
    const dry = harness("corealm_willow_1");
    const lake = harness("corealm_willow_1");
    const centre: [number, number] = [1050, 1048];
    const radius = 18;
    lake.scene.getWaterBodies = () => [{ closed: true, centre, level: 3,
      contour: Array.from({ length: 64 }, (_, index) => {
        const angle = index / 64 * Math.PI * 2;
        return [centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius];
      }),
    }];
    for (const fixture of [dry, lake]) {
      fixture.spec.layers[0]!.species = [{ assetId: "corealm_willow_1", sources: ["shore"] }];
      fixture.spec.layers[0]!.shore = { band: [3, 10], perMetre: .5 };
      delete fixture.spec.layers[0]!.assetIds;
    }
    try {
      await populate(dry);
      await populate(lake);
      expect(dry.registered).toHaveLength(0);
      expect(lake.registered.length).toBeGreaterThan(20);
      for (const { descriptor } of lake.registered) {
        const distance = Math.hypot(descriptor.position[0] - centre[0], descriptor.position[2] - centre[1]);
        expect(descriptor.resourceId).toBe("tree_willow");
        expect(distance).toBeGreaterThan(radius + 2.9);
        expect(distance).toBeLessThanOrEqual(radius + 10);
      }
    } finally { dry.dispose(); lake.dispose(); }
  });

  it("keeps tree identities stable across tile order and replacement models", async () => {
    const forward = harness();
    const reverse = harness("tree_common_3");
    try {
      await populate(forward);
      await populate(reverse, true);
      const ids = (f: ReturnType<typeof harness>) => f.registered.map((entry) => entry.descriptor.id).sort();
      expect(ids(forward).length).toBeGreaterThan(30);
      expect(ids(reverse)).toEqual(ids(forward));
      expect(new Set(ids(forward)).size).toBe(ids(forward).length);
      expect(forward.loaded.has("corealm_oak_1")).toBe(true);
      expect(forward.loaded.has("tree_common_5")).toBe(false);
    } finally { forward.dispose(); reverse.dispose(); }
  });

  it("registers living coast trees with the nearest region and publishes grounded uniform transforms", async () => {
    const f = harness();
    try {
      await populate(f);
      expect(f.registered.some(({ descriptor }) => descriptor.regionId === "vellenwood")).toBe(true);
      expect(f.batches.flatMap((batch) => batch.placements).some((placement) => placement.position[0] > 1144)).toBe(true);
      const coast = f.registered.filter(({ descriptor }) => descriptor.position[0] > 1144);
      expect(coast.length).toBeGreaterThan(0);
      expect(coast.every(({ descriptor }) => descriptor.regionId === "vellenwood")).toBe(true);
      expect(f.registered.length).toBe(f.batches.flatMap(batch => batch.placements).length);
      for (const { descriptor: tree } of f.registered) {
        expect(tree.resourceId).toBe("tree_cairnpine");
        expect(tree.position[1] - tree.scale * 0.2).toBeCloseTo(f.scene.meshHeightAt(tree.position[0]));
        const placement = f.batches.flatMap((batch) => batch.placements).find((entry) => entry.position === tree.position)!;
        expect(placement.scale).toBe(tree.scale);
        expect(placement.rotationY).toBe(tree.rotationY);
        expect(placement.normal).toBeUndefined();
        expect(placement.tilt).toBe(0);
      }
    } finally { f.dispose(); }
  });

  it("suppresses every primitive and restores its exact original matrix idempotently", async () => {
    const f = harness();
    try {
      await populate(f);
      const tree = f.registered[0]!;
      const batch = f.batches.find((entry) => entry.placements.some((placement) => placement.position === tree.descriptor.position))!;
      const slot = batch.placements.findIndex((placement) => placement.position === tree.descriptor.position);
      const before = batch.meshes.map((mesh) => { const matrix = new THREE.Matrix4(); mesh.getMatrixAt(slot, matrix); return matrix.elements; });
      tree.setVisible(false);
      tree.setVisible(false);
      for (const mesh of batch.meshes) {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(slot, matrix);
        expect(matrix.determinant()).toBe(0);
        expect(mesh.instanceMatrix.version).toBe(1);
      }
      tree.setVisible(true);
      batch.meshes.forEach((mesh, part) => {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(slot, matrix);
        expect(matrix.elements).toEqual(before[part]);
      });
    } finally { f.dispose(); }
  });

  it("passes registration through streaming once and leaves deadwood decorative", async () => {
    const living = harness("tree_pine_5");
    const deadwood = harness("tree_dead_5");
    try {
      const controller = new ScatterStreamingController(living.scene as never, living.assets as never, 801, {
        specs: { fallowmarch: living.spec }, nearRing: 0, yieldToMain: async () => undefined, onTree: living.onTree,
      });
      await controller.forceFullResidency();
      const count = living.registered.length;
      await controller.forceFullResidency();
      expect(living.registered).toHaveLength(count);
      expect(count).toBeGreaterThan(30);
      expect(living.registered.every(({ descriptor }) => descriptor.resourceId === "tree_palewood")).toBe(true);
      await populate(deadwood);
      expect(deadwood.registered).toEqual([]);
      expect(deadwood.batches.length).toBeGreaterThan(0);
    } finally { living.dispose(); deadwood.dispose(); }
  });
});
