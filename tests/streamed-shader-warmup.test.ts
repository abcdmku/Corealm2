import * as THREE from "three";
import { expect, it } from "vitest";
import { StreamedShaderWarmup } from "../game/src/render/streamedShaderWarmup.js";

function fixture() {
  const scene = new THREE.Scene();
  let target: THREE.WebGLRenderTarget | null = null;
  const calls: { material: THREE.Material; linear: boolean }[] = [];
  const programs = [{ program: { ready: false }, getUniforms: () => ({}), getAttributes: () => ({}) }, { program: { ready: false }, getUniforms: () => ({}), getAttributes: () => ({}) }];
  const renderer = {
    info: { programs },
    getContext: () => ({ getExtension: () => ({ COMPLETION_STATUS_KHR: 1 }), isProgram: () => true,
      getProgramParameter: (program: { ready: boolean }) => program.ready }),
    getRenderTarget: () => target,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => { target = value; },
    compile: (view: THREE.Object3D) => {
      view.traverse(object => { if (object instanceof THREE.Mesh) calls.push({ material: object.material as THREE.Material,
        linear: target !== null }); });
    },
  } as unknown as THREE.WebGLRenderer;
  const gate = new StreamedShaderWarmup(renderer, scene, new THREE.PerspectiveCamera());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  return { scene, calls, gate, mesh, renderer, programs };
}

it("keeps a replacement gameplay actor drawable while its shaders prepare", () => {
  const { scene, gate, mesh } = fixture();
  mesh.userData.entityId = "nearby-creature";
  scene.add(mesh);gate.prepare();
  expect(gate.getState().waiting).toBe(1);
  expect(mesh.visible).toBe(true);
  gate.restore();gate.dispose();mesh.geometry.dispose();mesh.material.dispose();
});

it("waits for every program, restores materials and visibility between frames", () => {
  const { scene, calls, gate, mesh, renderer, programs } = fixture();
  const material = mesh.material;
  scene.add(mesh);gate.prepare();
  expect(mesh.visible).toBe(false);
  expect(gate.hasPending(scene)).toBe(true);
  expect(gate.hasPending(new THREE.Group())).toBe(false);
  expect(mesh.material).toBe(material);
  expect(calls[0]!.material).not.toBe(material);
  expect(calls[1]!.linear).toBe(true);
  expect(renderer.getRenderTarget()).toBeNull();
  gate.restore();expect(mesh.visible).toBe(true);
  programs[1]!.program.ready = true;
  gate.prepare();expect(mesh.visible).toBe(false);gate.restore();
  programs[0]!.program.ready = true;
  gate.prepare();expect(mesh.visible).toBe(true);expect(gate.getState().waiting).toBe(0);
  expect(gate.hasPending(scene)).toBe(false);
  gate.dispose();mesh.geometry.dispose();material.dispose();
});

it("preserves requeued meshes until their new batch completes and cancels pending work on disposal", () => {
  const { scene, calls, gate, mesh, programs } = fixture();
  scene.add(mesh);gate.prepare();gate.restore();
  scene.remove(mesh);expect(gate.getState().waiting).toBe(0);
  scene.add(mesh);
  for (const program of programs) program.program.ready = true;
  gate.prepare();gate.restore();
  expect(gate.getState().waiting).toBe(1);
  expect(calls).toHaveLength(4);
  let disposed = false;calls[0]!.material.addEventListener("dispose", () => { disposed = true; });
  mesh.material.dispose();expect(disposed).toBe(false);
  gate.dispose();expect(disposed).toBe(true);
  gate.prepare();expect(mesh.visible).toBe(true);mesh.geometry.dispose();
});


it("prepares custom creature shadow materials with the production alpha and side settings", () => {
  const { scene, calls, gate, mesh } = fixture();
  mesh.castShadow = true;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mesh.customDepthMaterial.customProgramCacheKey = () => "sampled-skeleton-v2";
  mesh.material.alphaTest = 0.4;
  scene.add(mesh);gate.prepare();gate.restore();
  const shadow = calls.at(-1)!.material as THREE.MeshDepthMaterial;
  expect(shadow.isMeshDepthMaterial).toBe(true);
  expect(shadow.side).toBe(THREE.BackSide);
  expect(shadow.alphaTest).toBe(0.4);
  expect(shadow.customProgramCacheKey()).toBe("sampled-skeleton-v2");
  expect(mesh.material.isMeshStandardMaterial).toBe(true);
  gate.dispose();mesh.geometry.dispose();mesh.material.dispose();mesh.customDepthMaterial.dispose();
});

it("does not retain stale program handles after renderer caches are replaced", () => {
  const { scene, gate, mesh, renderer } = fixture();
  scene.add(mesh);gate.prepare();gate.restore();
  renderer.info.programs = [];
  gate.prepare();expect(mesh.visible).toBe(true);
  expect(gate.getState().waiting).toBe(0);
  gate.dispose();mesh.geometry.dispose();mesh.material.dispose();
});
