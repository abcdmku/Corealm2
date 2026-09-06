import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { buildStructureCameraSources } from "../game/src/render/structureCameraSources.js";
import { StaticCameraQueries } from "../game/src/systems/staticCameraQueries.js";

function part(meta: SemanticEntity["meta"] = {featureLab:true, structureKind:"prefab"}): SemanticEntity {
  return {id:"porch#canopy", archetype:"landmark", name:"Porch", tier:5, regionId:"fallowmarch",
    position:[10,2,20], state:"present", interactions:[], meta,
    view:{assetId:"canopy", scale:2, scaleAxes:[1,0.5,1.5], rotationY:Math.PI/2}};
}

function registry() {
  const source = new THREE.Group();
  source.position.y = 0.25;
  const nested = new THREE.Group();
  nested.position.y = 3;
  source.add(nested);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4,0.2,3), new THREE.MeshBasicMaterial());
  nested.add(mesh);
  return {source, load:vi.fn(async (_id:string) => source), instance:vi.fn(() => source.clone(true))};
}

describe("camera-only structure sources", () => {
  it("preserves source hierarchy and anisotropic placed transforms without tier scaling", async () => {
    const assets = registry();
    const result = await buildStructureCameraSources(assets,[part()]);
    const bounds = new THREE.Box3().setFromObject(result.roots[0]!);
    expect(bounds.min.x).toBeCloseTo(5.5); expect(bounds.min.z).toBeCloseTo(16);
    expect(bounds.getCenter(new THREE.Vector3()).toArray()).toEqual([10,5.25,20]);
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(9); expect(size.y).toBeCloseTo(0.2); expect(size.z).toBeCloseTo(8);
    expect(assets.source.position.toArray()).toEqual([0,0.25,0]);
    expect(result.meshes[0]!.geometry).toBe((assets.source.children[0]!.children[0] as THREE.Mesh).geometry);
    expect(result.roots[0]!.parent).toBeNull();
  });

  it("blocks an upward camera ray at the actual canopy while preserving walk-under air", async () => {
    const result = await buildStructureCameraSources(registry(),[part()]);
    const query = new StaticCameraQueries();
    result.meshes.forEach(mesh => query.addStaticMesh(mesh));
    expect(query.raycast([10,3,20],[0,1,0],10)).toBeCloseTo(2.15,4);
    expect(query.raycast([10,3,14],[0,0,1],12)).toBeNull();
  });

  it("selects permanent and lab architecture but excludes scenery actors and composition foliage", async () => {
    const assets = registry();
    const entities = [part({buildingId:"house"}),part({wallRunId:"wall"}),part(),
      part({featureLab:true,structureKind:"composition"}),part({scenery:true}),
      {...part({buildingId:"house"}),archetype:"enemy" as const}];
    const result = await buildStructureCameraSources(assets,entities);
    expect(result.roots).toHaveLength(3);
    expect(assets.load).toHaveBeenCalledTimes(1);
  });
});
