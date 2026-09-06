import * as THREE from "three";

/** Opt-in art candidate for contained trough water; the authored source is never changed. */
export function createContainedTroughWater(source: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  const material = source.clone();
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
  material.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(source, shader, renderer);
  material.customProgramCacheKey = () => `${source.customProgramCacheKey()}|contained-opaque-v2`;
  return material;
}

export function containedWaterMaterialSnapshot(material: THREE.MeshPhysicalMaterial) {
  return { name: material.name, uuid: material.uuid, color: material.color.getHexString(), transmission: material.transmission,
    roughness: material.roughness, metalness: material.metalness, ior: material.ior, clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness, envMapIntensity: material.envMapIntensity,
    normalMap: material.normalMap?.uuid ?? null, vertexColors: material.vertexColors, side: material.side };
}
