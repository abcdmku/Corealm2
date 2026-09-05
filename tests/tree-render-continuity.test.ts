import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { scatterWindMargin } from "../game/src/render/scatterBounds.js";

async function fixture() {
  const bark = new THREE.MeshStandardMaterial({ name: "Bark_Corealm", color: 0x80603c, vertexColors: true });
  const leaves = new THREE.MeshStandardMaterial({ name: "Leaves_Corealm", color: 0x5f853c, vertexColors: true });
  const cutwood = new THREE.MeshStandardMaterial({ name: "Cutwood_Corealm", color: 0xc6a277 });
  const trunkGeometry = new THREE.BoxGeometry(0.4, 4, 0.4).translate(0, 2, 0);
  const leafGeometry = new THREE.BoxGeometry(4, 3, 4).translate(2, 4.5, 0);
  const stumpGeometry = new THREE.BoxGeometry(0.8, 0.5, 0.8).translate(0, 0.25, 0);
  for (const geometry of [trunkGeometry, leafGeometry, stumpGeometry]) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  const tree = new THREE.Group();
  tree.add(new THREE.Mesh(trunkGeometry, bark), new THREE.Mesh(leafGeometry, leaves));
  const stump = new THREE.Group();
  stump.add(new THREE.Mesh(stumpGeometry, cutwood));
  const assets = {
    entry: (id: string) => ({ id, animations: [], size: { x: 4, y: 6, z: 4 } }),
    isLoaded: () => true,
    load: async (id: string) => id === "corealm_stump_oak" ? stump : tree,
    instance: (id: string) => (id === "corealm_stump_oak" ? stump : tree).clone(true),
    clipOf: () => undefined,
    clip: () => undefined,
  };
  const scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  const materials = new MaterialLibrary();
  const views = new EntityViews(scene, assets as never, materials);
  const entities: SemanticEntity[] = [1, 10].map((tier) => ({
    id: `tree-${tier}`, name: "Oak", archetype: "tree", tier,
    regionId: "fallowmarch", position: [tier * 2, 7, 3], state: "available",
    interactions: ["inspect", "chop"],
    view: { assetId: "corealm_oak_1", depletedAssetId: "corealm_stump_oak", scale: 2 / tierSilhouetteScale(tier), rotationY: 0.6 },
  }));
  await views.prepare(entities);
  views.sync(entities);
  return {
    views, scene, materials, entities, bark, leaves, cutwood, leafGeometry,
    dispose() {
      views.dispose(); materials.dispose();
      for (const geometry of [trunkGeometry, leafGeometry, stumpGeometry]) geometry.dispose();
      for (const material of [bark, leaves, cutwood]) material.dispose();
    },
  };
}

describe("native forest render continuity", () => {
  it("uses scatter's exact palette, organic treatment, wind material and placement across resource tiers", async () => {
    const f = await fixture();
    try {
      const batches = f.scene.entityGroup.getObjectsByProperty("isBatchedMesh", true) as THREE.BatchedMesh[];
      expect(batches).toHaveLength(2);
      expect(batches.map((batch) => batch.material)).toContain(f.materials.organic(f.bark, "bark"));
      const scatterLeaves = f.materials.wind(f.materials.organic(f.leaves, "foliage"), 0.035);
      const leafBatch = batches.find((batch) => batch.material === scatterLeaves)!;
      expect(leafBatch).toBeDefined();
      expect(leafBatch.castShadow).toBe(true);
      expect(leafBatch.customDepthMaterial).toBe(f.materials.windShadow(scatterLeaves, 0.035, "depth"));
      expect(leafBatch.customDistanceMaterial).toBe(f.materials.windShadow(scatterLeaves, 0.035, "distance"));
      const actual = new THREE.Matrix4();
      for (const [index, entity] of f.entities.entries()) {
        leafBatch.getMatrixAt(index, actual);
        const expected = new THREE.Matrix4().compose(
          new THREE.Vector3(...entity.position),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6),
          new THREE.Vector3(2, 2, 2),
        );
        actual.elements.forEach((value, element) => expect(value).toBeCloseTo(expected.elements[element]!, 5));
      }
    } finally { f.dispose(); }
  });

  it("pads per-instance camera and shadow bounds for wind without changing source geometry", async () => {
    const f = await fixture();
    try {
      const expectedMaterial = f.materials.wind(f.materials.organic(f.leaves, "foliage"), 0.035);
      const batch = f.scene.entityGroup.getObjectsByProperty("isBatchedMesh", true)
        .find((node) => (node as THREE.BatchedMesh).material === expectedMaterial) as THREE.BatchedMesh;
      const bounds = new THREE.Box3();
      batch.getBoundingBoxAt(0, bounds);
      const margin = scatterWindMargin(new THREE.Matrix4(), 0.035);
      expect(bounds.min.x).toBeCloseTo(-margin);
      expect(bounds.max.x).toBeCloseTo(4 + margin);
      expect(f.leafGeometry.boundingBox!.min.x).toBe(0);
      expect(f.leafGeometry.boundingBox!.max.x).toBe(4);
      const sphere = new THREE.Sphere();
      batch.getBoundingSphereAt(0, sphere);
      expect(sphere.radius).toBeCloseTo(f.leafGeometry.boundingSphere!.radius + margin);
    } finally { f.dispose(); }
  });

  it("keeps a native stump rooted at the trunk beneath an asymmetric crown", async () => {
    const f = await fixture();
    try {
      f.entities[0]!.state = "depleted";
      f.views.sync(f.entities);
      const bounds = f.views.drawnBounds("tree-1")!;
      expect((bounds.min[0] + bounds.max[0]) / 2).toBeCloseTo(2);
      expect((bounds.min[2] + bounds.max[2]) / 2).toBeCloseTo(3);
      expect(bounds.min[1]).toBeCloseTo(7);
      expect(bounds.max[1]).toBeCloseTo(8);
      expect(f.scene.entityGroup.getObjectsByProperty("isBatchedMesh", true)
        .some((node) => (node as THREE.BatchedMesh).material === f.cutwood)).toBe(true);
    } finally { f.dispose(); }
  });
});
