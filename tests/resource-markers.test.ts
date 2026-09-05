import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";

async function fixture(archetype: "tree" | "ore") {
  const bark = new THREE.MeshStandardMaterial({ name: "Bark_Corealm" });
  const leaves = new THREE.MeshStandardMaterial({ name: "Leaves_Corealm" });
  const stone = new THREE.MeshStandardMaterial({ name: "Stone_Corealm" });
  const geometry = [
    new THREE.BoxGeometry(0.8, 4, 0.8).translate(0, 2, 0),
    new THREE.BoxGeometry(12, 3, 8).translate(0, 5, 0),
    new THREE.BoxGeometry(0.7, 0.5, 0.8).translate(0, 0.25, 0),
    new THREE.BoxGeometry(0.6, 0.8, 0.5).translate(0, 0.4, 0),
  ];
  const tree = new THREE.Group();
  tree.add(new THREE.Mesh(geometry[0], bark), new THREE.Mesh(geometry[1], leaves));
  const stump = new THREE.Group();
  stump.add(new THREE.Mesh(geometry[2], bark));
  const ore = new THREE.Group();
  ore.add(new THREE.Mesh(geometry[3], stone));
  const source = (id: string) => id.includes("stump") ? stump : id.startsWith("corealm_ore_") ? ore : tree;
  const assets = {
    entry: (id: string) => ({ id, animations: [], size: id.startsWith("corealm_ore_") ? { x: 0.6, y: 0.8, z: 0.5 } : { x: 12, y: 6.5, z: 8 } }),
    isLoaded: () => true,
    load: async (id: string) => source(id),
    instance: (id: string) => source(id).clone(true),
    clipOf: () => undefined,
    clip: () => undefined,
  };
  const scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  const materials = new MaterialLibrary();
  const views = new EntityViews(scene, assets as never, materials);
  const entity: SemanticEntity = {
    id: "resource", name: "Resource", archetype, tier: 1, regionId: "fallowmarch", position: [0, 0, 0],
    state: "available", interactions: ["inspect", archetype === "tree" ? "chop" : "mine"],
    view: { assetId: archetype === "tree" ? "corealm_oak_1" : "corealm_ore_test", scale: 1 / tierSilhouetteScale(1), labelHeight: 8,
      ...(archetype === "tree" ? { depletedAssetId: "corealm_stump_oak" } : {}) },
    ...(archetype === "tree" ? { meta: { trunkRadius: 0.4 } } : {}),
  };
  await views.prepare([entity]);
  views.sync([entity]);
  views.setHighlight(entity.id);
  const marker = scene.overlayGroup.getObjectByName("highlight-resource")!;
  return {
    views, entity, scene, materials, marker,
    dispose() {
      views.dispose(); materials.dispose();
      for (const item of geometry) item.dispose();
      for (const material of [bark, leaves, stone]) material.dispose();
    },
  };
}

describe("resource contact markers", () => {
  it("marks a tree's trunk without shrinking its selectable canopy", async () => {
    const f = await fixture("tree");
    try {
      const ring = f.marker.getObjectByName("ring") as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      const pip = f.marker.getObjectByName("pip")!;
      expect(ring.scale.x).toBeCloseTo(0.58);
      expect(ring.geometry.parameters.outerRadius - ring.geometry.parameters.innerRadius).toBeLessThan(0.05);
      expect(ring.material.opacity).toBe(0.46);
      expect(f.materials.highlight("#ffd98a").opacity).toBe(0.85);
      expect(pip.scale.x * 0.32).toBeCloseTo(0.1344);
      f.scene.entityGroup.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(new THREE.Vector3(5, 5, 10), new THREE.Vector3(0, 0, -1));
      expect(f.views.pick(ray)).toBe("resource");
    } finally { f.dispose(); }
  });

  it("lowers the selected pip to the stump and resizes its ring on actual depletion", async () => {
    const f = await fixture("tree");
    try {
      const before = f.marker.getObjectByName("pip")!.position.y;
      f.entity.state = "depleted";
      f.views.sync([f.entity]);
      expect(f.marker.getObjectByName("ring")!.scale.x).toBeCloseTo(0.5);
      expect(f.marker.getObjectByName("pip")!.position.y).toBeCloseTo(0.66);
      expect(f.marker.getObjectByName("pip")!.position.y).toBeLessThan(before - 5);
      expect(f.marker.getObjectByName("pip")!.scale.x * 0.32).toBeCloseTo(0.1344);
    } finally { f.dispose(); }
  });

  it("uses a small ore node's real footprint instead of the character marker minimum", async () => {
    const f = await fixture("ore");
    try {
      expect(f.marker.getObjectByName("ring")!.scale.x).toBeCloseTo(0.4);
      expect(f.marker.getObjectByName("pip")!.position.y).toBeCloseTo(0.96);
      expect(f.marker.scale.toArray()).toEqual([1, 1, 1]);
    } finally { f.dispose(); }
  });
});
