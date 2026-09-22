import * as THREE from "three/webgpu";
import { expect, it, vi } from "vitest";
import { PlayerSilhouette } from "../game/src/render/playerSilhouette.js";
import { PlayerDepthVisibility } from "../game/src/render/playerDepthVisibility.js";

it("shows substantial obstruction immediately, ignores small overlaps, and clears immediately", () => {
  const silhouette = new PlayerSilhouette();
  expect(silhouette.shouldShow(3)).toBe(false);
  expect(silhouette.shouldShow(4)).toBe(true);
  expect(silhouette.shouldShow(5)).toBe(true);
  expect(silhouette.shouldShow(0)).toBe(false);
  expect(silhouette.shouldShow(5)).toBe(true);
  expect(silhouette.shouldShow(3)).toBe(false);
  silhouette.dispose();
});

it("fades in and out over 100ms without an activation delay", () => {
  const silhouette = new PlayerSilhouette();
  expect(silhouette.updateOpacity(0, 0)).toBe(0);
  expect(silhouette.updateOpacity(5, 16)).toBeGreaterThan(0);
  expect(silhouette.updateOpacity(5, 50)).toBeCloseTo(0.12);
  expect(silhouette.updateOpacity(5, 100)).toBeCloseTo(0.24);
  expect(silhouette.updateOpacity(2, 116)).toBeCloseTo(0.2016);
  expect(silhouette.updateOpacity(2, 150)).toBeCloseTo(0.12);
  expect(silhouette.updateOpacity(2, 200)).toBeCloseTo(0);
  silhouette.dispose();
});

it("submits five independent depth samples together and reads only completed render-context results", () => {
  const visibility = new PlayerDepthVisibility();
  const source = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  let inRender = false;
  let hidden = 0;
  let index = 0;
  let samples: THREE.Mesh[] = [];
  const renderer = {
    autoClear: true, info: { autoReset: true },
    isOccluded: vi.fn(() => {
      expect(inRender).toBe(true);
      return index++ < hidden;
    }),
    render: vi.fn((scene: THREE.Scene) => {
      inRender = true;
      index = 0;
      try {
        scene.onBeforeRender(renderer as never, scene, camera, null as never, null as never, null as never);
        samples = scene.children.filter(object => object.occlusionTest) as THREE.Mesh[];
        const end = scene.children.find(object => !object.occlusionTest) as THREE.Mesh;
        expect(end.frustumCulled).toBe(false);
        expect(end.renderOrder).toBe(Number.MAX_SAFE_INTEGER);
        expect(end.material).toMatchObject({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false });
        expect(samples).toHaveLength(5);
        expect(new Set(samples).size).toBe(5);
        expect(samples.every(sample => sample.occlusionTest && !sample.frustumCulled)).toBe(true);
        expect(renderer.autoClear).toBe(false);
      } finally { inRender = false; }
    }),
  };
  expect(visibility.sample(renderer as never, camera, source)).toBe(0);
  hidden = 4;
  expect(visibility.sample(renderer as never, camera, source)).toBe(4);
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(renderer.autoClear).toBe(true);
  expect(renderer.info.autoReset).toBe(true);
  // Every probe sits in front of the player's body toward the camera.
  expect(samples.every(sample => sample.position.z > 0)).toBe(true);
  source.visible = false;
  expect(visibility.sample(renderer as never, camera, source)).toBe(0);
  expect(renderer.render).toHaveBeenCalledTimes(2);
  visibility.dispose();
});

it("warms the animated player's mask and fill pipelines before the first obstruction", async () => {
  const silhouette = new PlayerSilhouette();
  silhouette.source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
  const materials: THREE.Material[] = [];
  const renderer = { compileAsync: vi.fn(async (scene: THREE.Scene) => {
    if (scene.overrideMaterial) materials.push(scene.overrideMaterial);
  }) };
  await silhouette.compile(renderer as never, new THREE.PerspectiveCamera());
  expect(renderer.compileAsync).toHaveBeenCalledTimes(3);
  expect(materials.map(material => material.depthFunc)).toEqual([THREE.LessEqualDepth, THREE.GreaterDepth]);
  expect(materials.every(material => (material as THREE.NodeMaterial).isNodeMaterial)).toBe(true);
  silhouette.dispose();
});
