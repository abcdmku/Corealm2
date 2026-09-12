import * as THREE from "three";

/** Repeated tiles share geometry and materials, and therefore the same compiler inputs. */
export function shaderGeometryKey(mesh: THREE.Mesh): string {
  const instanced = mesh as THREE.InstancedMesh;
  return `${mesh.type}:${mesh.geometry.uuid}:${mesh.receiveShadow}:${Boolean(instanced.instanceColor)}:${Boolean(instanced.morphTexture)}`;
}

/** Compile real caster meshes with their depth hooks and the scene's shadow-light counts. */
export function compileShadowMeshes(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  meshes: readonly THREE.Mesh[],
  compilationMaterial: (source: THREE.Material) => THREE.Material,
  defaultDepth: THREE.MeshDepthMaterial,
): void {
  const shadowScene = new THREE.Scene(), lights: THREE.Light[] = [];
  scene.traverseVisible(object => { if ((object as THREE.Light).isLight) lights.push(object as THREE.Light); });
  // Depth rendering uses real light counts, without colour-pass fog or environment.
  shadowScene.traverseVisible = callback => {
    callback(shadowScene);
    for (const light of lights) callback(light);
  };
  const seen = new Set<string>();
  for (const mesh of meshes) {
    if (!mesh.castShadow) continue;
    const original = mesh.material;
    try {
      for (const surface of Array.isArray(original) ? original : [original]) {
        const key = `${shaderGeometryKey(mesh)}:${surface.uuid}:${mesh.customDepthMaterial?.uuid ?? "depth"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const depth = compilationMaterial(mesh.customDepthMaterial ?? defaultDepth) as THREE.MeshDepthMaterial;
        const source = surface as THREE.MeshStandardMaterial;
        depth.side = surface.shadowSide ?? (surface.side === THREE.FrontSide ? THREE.BackSide
          : surface.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
        depth.map = source.map; depth.alphaMap = source.alphaMap;
        depth.alphaTest = surface.alphaToCoverage ? 0.5 : surface.alphaTest;
        depth.displacementMap = source.displacementMap;
        depth.displacementScale = source.displacementScale; depth.displacementBias = source.displacementBias;
        depth.clippingPlanes = surface.clippingPlanes; depth.clipShadows = surface.clipShadows;
        depth.clipIntersection = surface.clipIntersection; depth.wireframe = source.wireframe;
        mesh.material = depth;
        const view = new THREE.Group();
        view.traverse = callback => { callback(view); callback(mesh); };
        const beforeCompile = depth.onBeforeCompile;
        const cacheKey = depth.customProgramCacheKey, programKey = cacheKey.call(depth);
        // Actual shadow draws keep object.material as the surface. Some custom
        // depth hooks call that surface hook, so preserve the same callback context.
        depth.onBeforeCompile = function(shader, activeRenderer) {
          mesh.material = original;
          try { beforeCompile.call(this, shader, activeRenderer); }
          finally { mesh.material = depth; }
        };
        // The temporary callback must not create a different shader-cache variant.
        depth.customProgramCacheKey = () => programKey;
        try { renderer.compile(view, camera, shadowScene); }
        finally { depth.onBeforeCompile = beforeCompile; depth.customProgramCacheKey = cacheKey; }
      }
    } finally { mesh.material = original; }
  }
}
