import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createEntityBatchMesh } from "../game/src/render/entityBatchMesh.js";

interface NativeRenderObject {
  initialCacheKey: number;
  getCacheKey(): number;
}
interface NativeRenderObjects {
  get(object: THREE.Object3D, material: THREE.Material, scene: THREE.Scene, camera: THREE.Camera,
    lightsNode: object, renderContext: object, clippingContext: null, passId?: string): NativeRenderObject;
}
const renderObjectsModule = "three/src/renderers/common/RenderObjects.js";
const RenderObjects = (await import(renderObjectsModule) as {
  default: new (renderer: object, nodes: object, geometries: object, pipelines: object, bindings: object, info: object) => NativeRenderObjects;
}).default;

/**
 * The WebGPU renderer's render-object cache with its GPU-facing collaborators stubbed out. `get` is
 * the lookup every draw goes through: it keeps a compiled draw until the material's version or the
 * lighting/context key changes, and only then compares the full cache key.
 */
function renderObjects() {
  const renderer = { backend: { isWebGPUBackend: true }, contextNode: { id: 1, version: 0 }, _currentSourceMaterial: null };
  const nodes = { getCacheKey: () => 0, delete: () => undefined };
  const cache = new RenderObjects(renderer, nodes, {}, { delete: () => undefined }, { deleteForRender: () => undefined }, {});
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), lights = {}, context = { id: 1 };
  return (mesh: THREE.BatchedMesh) => cache.get(mesh, mesh.material as THREE.Material, scene, camera, lights, context, null);
}

describe("entity batches that grow after their first draw", () => {
  it("draw through a render object built for the grown batch's textures", () => {
    const mesh = createEntityBatchMesh(2, 64, 128, new THREE.MeshStandardMaterial());
    const box = mesh.addGeometry(new THREE.BoxGeometry(1, 1, 1));
    mesh.addInstance(box);
    mesh.addInstance(box);
    const draw = renderObjects();
    const before = draw(mesh);

    // Growing replaces the matrices and indirect textures the compiled draw's shader reads.
    mesh.setInstanceCount(4);
    mesh.addInstance(box);
    const after = draw(mesh);

    // A draw kept from before the growth binds the old textures: its instance map and matrices stay
    // frozen, so parts are drawn with other instances' transforms (the Oakwood "phantom shells").
    expect(after).not.toBe(before);
    expect(after.getCacheKey()).toBe(after.initialCacheKey);
  });
});
