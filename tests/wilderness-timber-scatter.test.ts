import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RegionId, Vec3 } from "../game/src/contracts.js";
import type { AssetEntry } from "../game/src/render/assets.js";
import { WorldScene, type GrassSpritePlacement, type Rect, type ScatterPlacement } from "../game/src/render/scene.js";
import type { ForestTreeDescriptor } from "../game/src/world/forestResources.js";
import {
  DEFAULT_SCATTER, ExclusionZones, scatterTilesForBounds, scatterWorldTile,
  type RegionScatterSpec, type ScatterLayerSpec,
} from "../game/src/world/scatter.js";


const ids = ['corealm_teak_lastroot', 'corealm_teak_embershelter', 'corealm_magic_starwood', 'corealm_magic_moonvein'];
const BOUNDS: Rect = { minX: -384, maxX: 384, minZ: 460, maxZ: 940 };
type TreePlacement = ScatterPlacement & { forestTree?: ForestTreeDescriptor };
interface MeshRow { assetId: string; placement: TreePlacement; matrix: number[] }

function entry(id: string, size: AssetEntry["size"], base?: AssetEntry["base"]): AssetEntry {
  return { id, file: `${id}.glb`, pack: "fixture", category: "nature", is: "plant", tags: [], bytes: 1,
    size, base: base ?? { x: -size.x / 2, y: 0, z: -size.z / 2 }, animations: [], materials: [] };
}

function harness(exclusions = new ExclusionZones()) {
  const entries = new Map(ids.map(id => [id, { ...entry(id, { x: 8, y: 11, z: 8 }), trunkRadius: .4 }]));
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
  const semanticBounds = BOUNDS;
  const scene = {
    terrainGroup, getScatterBounds: () => BOUNDS,
    describeRegions: () => [{ regionId: "wilderness" as const }],
    getRegionRect: () => semanticBounds, regionAt: () => "wilderness" as const,
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
  const layer = { ...DEFAULT_SCATTER.wilderness.layers.find(layer => layer.id === 'wandering_timber')! };
  const spec: RegionScatterSpec = { regionId: 'wilderness', layers: [layer], exclusions };
  const clear = () => {
    rows.length = 0; grass.length = 0; trees.length = 0;
    for (const mesh of meshes) mesh.dispose();
    meshes.length = 0; receiver.scatterGroup.clear();
  };
  return { scene, assets, rows, grass, trees, spec, clear, dispose() {
    clear(); for (const source of sources.values()) source.geometry.dispose(); material.dispose();
  } };
}


async function populate(fixture: ReturnType<typeof harness>) {
  for (const tile of scatterTilesForBounds(BOUNDS)) await scatterWorldTile(
    fixture.scene as never, fixture.assets as never, 24981, tile, { wilderness: fixture.spec },
    { onTree: tree => fixture.trees.push(structuredClone(tree)), yieldToMain: async () => undefined },
  );
}
describe('solitary Wilderness timber', () => {
  it('thins individual trees, mixes both tiers with a local majority, and repeats saved identities', async () => {
    const f = harness(new ExclusionZones().addCircle(0, 600, 35, "road"));
    try {
      expect(f.spec.layers[0]!.cluster).toBeUndefined();
      await populate(f);
      expect(f.trees.length).toBeGreaterThan(50);
      expect(f.trees.every(tree => Math.hypot(tree.position[0], tree.position[2] - 600) > 35)).toBe(true);
      expect(new Set(f.trees.map(tree => tree.assetId)).size).toBe(4);
      for (const tier of [50, 70]) {
        const trees = f.trees.filter(tree => tree.resourceId === `tree_wilderness_${tier === 50 ? 'teak' : 'magic'}`);
        expect(trees.length).toBeGreaterThan(15);
        expect(trees.some(tree => tree.position[0] < -150)).toBe(true);
        expect(trees.some(tree => tree.position[0] > 150)).toBe(true);

      }
      for (const deep of [false, true]) {
        const band = f.trees.filter(tree => (tree.position[2] >= 700) === deep);
        const local = band.filter(tree => tree.resourceId === `tree_wilderness_${deep ? 'magic' : 'teak'}`);
        expect(local.length / band.length).toBeGreaterThan(.6);
        expect(local.length / band.length).toBeLessThan(.95);
      }
      const old = harness(new ExclusionZones().addCircle(0, 600, 35, "road"));
      try {
        Object.assign(old.spec.layers[0]!, { spacing: 42, maxCount: 280 });
        await populate(old);
        expect(f.trees.length / old.trees.length).toBeLessThan(.8);
        expect(f.trees.length / old.trees.length).toBeGreaterThan(.4);
        console.log(`Solitary timber fixture: ${old.trees.length} -> ${f.trees.length} trees`);
      } finally { old.dispose(); }
      const before = structuredClone(f.trees); f.clear(); await populate(f);
      expect(f.trees).toEqual(before);
    } finally { f.dispose(); }
  });
});
