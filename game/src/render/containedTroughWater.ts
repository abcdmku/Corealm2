import * as THREE from "three";
import type { MeshPhysicalNodeMaterial } from "three/webgpu";
import { cloneNodeMaterial } from "./nodeMaterials.js";

type PhysicalWaterMaterial = THREE.MeshPhysicalMaterial | MeshPhysicalNodeMaterial;

/** Reflective contained water avoids a second world render; the authored source stays unchanged. */
export function createContainedTroughWater(source: PhysicalWaterMaterial): MeshPhysicalNodeMaterial {
  const material = cloneNodeMaterial(source) as MeshPhysicalNodeMaterial;
  material.name = `${source.name}@contained-opaque-v2`;
  material.transmission = 0;
  // Authored vertex colour is near-white #f5fbf7. Lift diffuse body response while
  // retaining the same geometric ripple normals and grazing reflection settings.
  material.color.set("#4b6861");
  material.metalness = 0;
  material.roughness = .16;
  material.ior = 1.333;
  material.clearcoat = .6;
  material.clearcoatRoughness = .12;
  material.clearcoatNormalMap = source.normalMap;
  material.clearcoatNormalScale.copy(source.normalScale);
  material.envMapIntensity = 1;
  return material;
}

export function containedWaterMaterialSnapshot(material: PhysicalWaterMaterial) {
  return { name: material.name, uuid: material.uuid, color: material.color.getHexString(), transmission: material.transmission,
    roughness: material.roughness, metalness: material.metalness, ior: material.ior, clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness, envMapIntensity: material.envMapIntensity,
    normalMap: material.normalMap?.uuid ?? null, vertexColors: material.vertexColors, side: material.side };
}
