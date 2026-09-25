import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createEntityBatchMesh } from "../game/src/render/entityBatchMesh.js";

interface DrawList { _multiDrawCount: number; _indirectTexture: THREE.DataTexture }

/** Instance ids the backend will draw: the first `_multiDrawCount` entries of the indirect map. */
function drawnInstances(mesh: THREE.BatchedMesh): number[] {
  const list = mesh as unknown as DrawList;
  return [...(list._indirectTexture.image.data as Uint32Array).subarray(0, list._multiDrawCount)];
}

/** One box in view of the gameplay camera and one only inside the sun's shadow box. */
function scene(mesh: THREE.BatchedMesh) {
  const box = mesh.addGeometry(new THREE.BoxGeometry(2, 2, 2));
  const inView = mesh.addInstance(box);
  mesh.setMatrixAt(inView, new THREE.Matrix4().makeTranslation(50, 0, 0));
  const inShadow = mesh.addInstance(box);
  mesh.setMatrixAt(inShadow, new THREE.Matrix4().makeTranslation(-50, 0, 0));
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(50, 4, 12);
  camera.lookAt(50, 0, 0);
  camera.updateMatrixWorld(true);
  const sun = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 100);
  sun.position.set(-50, 40, 0);
  sun.lookAt(-50, 0, 0);
  sun.updateMatrixWorld(true);
  return { inView, inShadow, camera, sun };
}

/**
 * The WebGPU renderer's order for the first shadow-receiving object of the camera pass: its
 * `onBeforeRender`, then the nested shadow render (`onBeforeShadow`, `onBeforeRender` for the light
 * camera, the shadow draw, `onAfterShadow`), then the camera draw.
 */
function cameraPassAroundNestedShadow(mesh: THREE.BatchedMesh, camera: THREE.Camera, sun: THREE.Camera): number {
  const renderer = null as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const material = mesh.material as THREE.Material;
  const group = null as unknown as THREE.Group;
  mesh.onBeforeRender(renderer, scene, camera, mesh.geometry, material, group);
  mesh.onBeforeShadow(renderer, scene, sun, sun, mesh.geometry, material, group);
  mesh.onBeforeRender(renderer, scene, sun, mesh.geometry, material, group);
  expect(drawnInstances(mesh)).toHaveLength(1);
  const uploadedForShadow = (mesh as unknown as DrawList)._indirectTexture.version;
  mesh.onAfterShadow(renderer, scene, sun, sun, mesh.geometry, material, group);
  return uploadedForShadow;
}

describe("entity batches under the nested sun-shadow pass", () => {
  it("draws the camera's culled instances, not the shadow camera's", () => {
    const mesh = createEntityBatchMesh(4, 64, 128, new THREE.MeshStandardMaterial());
    const { inView, camera, sun } = scene(mesh);
    const indirect = (mesh as unknown as DrawList)._indirectTexture;
    const uploadedForShadow = cameraPassAroundNestedShadow(mesh, camera, sun);
    expect(drawnInstances(mesh)).toEqual([inView]);
    // The shadow pass uploaded its own list, so the restored one must be marked for upload again
    // or the camera pass binds the shadow camera's instance map.
    expect(indirect.version).toBeGreaterThan(uploadedForShadow);
  });

  it("is the difference from a plain BatchedMesh, which keeps the shadow camera's list", () => {
    const mesh = new THREE.BatchedMesh(4, 64, 128, new THREE.MeshStandardMaterial());
    const { inShadow, camera, sun } = scene(mesh);
    cameraPassAroundNestedShadow(mesh, camera, sun);
    expect(drawnInstances(mesh)).toEqual([inShadow]);
  });
});
