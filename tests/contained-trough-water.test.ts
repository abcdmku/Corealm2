import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { uniform, vec3 } from "three/tsl";
import { createContainedTroughWater } from "../game/src/render/containedTroughWater.js";

it("preserves authored source/detail, caches the candidate, and restores exact material identity", () => {
  const library = new MaterialLibrary();
  const source = new THREE.MeshPhysicalMaterial({ transmission: .94, roughness: .085, vertexColors: true });
  source.name = "Corealm farm water@capillary-transmission-v2";
  source.normalMap = new THREE.Texture();
  const sourceDispose = vi.spyOn(source, "dispose");
  const candidate = library.containedTroughWater(source);
  expect(library.forContainedTrough("corealm_water_trough", source)).toBe(candidate);
  expect(library.forContainedTrough("world_water", source)).toBe(source);
  const timber = new THREE.MeshPhysicalMaterial();timber.name = "Corealm farm timber";
  expect(library.forContainedTrough("corealm_water_trough", timber)).toBe(timber);
  expect(library.containedTroughWater(source)).toBe(candidate);
  expect(candidate.normalMap).toBe(source.normalMap);
  expect((candidate as unknown as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial).toBe(true);
  expect(candidate.vertexColors).toBe(source.vertexColors);
  expect(candidate.transmission).toBe(0);
  expect(source.transmission).toBe(.94); expect(source.roughness).toBe(.085);
  const geometry = new THREE.BoxGeometry();
  const mesh = new THREE.Mesh(geometry, source);
  const views = Object.create(EntityViews.prototype) as EntityViews;
  Object.defineProperties(views, {
    materials: { value: library }, containedWaterOriginals: { value: new Map() },
    batches: { value: new Map([["water", { mesh, owners: [{ group: { assetId: "corealm_water_trough" } }] }]]) },
  });
  expect(views.setContainedTroughWater(true).meshes).toHaveLength(1);
  expect(mesh.material).toBe(candidate); expect(mesh.geometry).toBe(geometry);
  views.setContainedTroughWater(false); expect(mesh.material).toBe(source);
  const batches = (views as unknown as { batches: Map<string, { owners: { group: { assetId: string } }[] }> }).batches;
  batches.get("water")!.owners.push({ group: { assetId: "world_water" } });
  expect(views.setContainedTroughWater(true).meshes).toHaveLength(0);
  expect(mesh.material).toBe(source);
  library.dispose(); expect(sourceDispose).not.toHaveBeenCalled();
  source.normalMap.dispose(); source.dispose(); timber.dispose(); geometry.dispose();
});

it("retains an authored node ripple graph while making an independent opaque material", () => {
  const source = new MeshPhysicalNodeMaterial({ transmission: .94, roughness: .085, vertexColors: true });
  const clock = uniform(0);
  source.normalNode = vec3(clock.sin().mul(.02), 0, 1).normalize();
  source.positionNode = vec3(0, clock.sin().mul(.003), 0);
  source.normalMap = new THREE.Texture();
  const candidate = createContainedTroughWater(source);
  expect(candidate).not.toBe(source);
  expect(candidate.normalNode).toBe(source.normalNode);
  expect(candidate.positionNode).toBe(source.positionNode);
  expect(candidate.normalMap).toBe(source.normalMap);
  expect(candidate.clearcoatNormalMap).toBe(source.normalMap);
  expect(candidate.transmission).toBe(0);
  expect(candidate.color.getHexString()).toBe("4b6861");
  expect(source.transmission).toBe(.94);
  candidate.dispose(); source.normalMap.dispose(); source.dispose();
});
