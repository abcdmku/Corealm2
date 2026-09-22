import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { texture as textureNode } from "three/tsl";
import { expect, it, vi } from "vitest";
import { prepareShaderMeshes, graphicsValidationState, validateGraphicsSubmission, waitForGraphicsValidation } from "../game/src/render/shaderPreparation.js";

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  let target: THREE.RenderTarget | null = null;
  const compile = vi.fn(async (_view: THREE.Object3D, _camera: THREE.Camera, _scene: THREE.Scene) => {});
  const initTexture = vi.fn((_texture: THREE.Texture) => {});
  const completed = vi.fn(async () => {});
  const renderer = {
    init: async () => {}, compileAsync: compile, initTexture,
    backend: { isWebGPUBackend: true, device: { queue: { onSubmittedWorkDone: completed } } },
    getRenderTarget: () => target, setRenderTarget: (value: THREE.RenderTarget | null) => { target = value; },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
  } as unknown as WebGPURenderer;
  return { scene, camera, renderer, compile, initTexture, completed };
}

it("uses real children and the live scene cache, restoring hidden hierarchies and output before await", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const root = new THREE.Group(), mesh = new THREE.Mesh(), child = new THREE.Mesh();
  root.position.set(7, 2, 1); root.visible = false; root.add(mesh); mesh.add(child); scene.add(root);
  mesh.visible = false; mesh.layers.set(3);
  const originalChildren = mesh.children, target = new THREE.RenderTarget(1, 1);
  let finish!: () => void;
  compile.mockImplementation((view, viewCamera, liveScene) => {
    expect(view.children).toEqual([mesh, child]);
    expect(viewCamera).toBe(camera); expect(liveScene).toBe(scene);
    expect(mesh.parent).toBe(root); expect(child.parent).toBe(mesh);
    expect(mesh.children).toEqual([]); expect(mesh.visible).toBe(true);
    expect(mesh.frustumCulled).toBe(false); expect(mesh.layers.mask).toBe(camera.layers.mask);
    expect(mesh.matrixWorld.elements[12]).toBe(7);
    expect(renderer.getRenderTarget()).toBe(target);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const preparation = prepareShaderMeshes(renderer, scene, camera, [mesh, child], { renderTarget: target, batchSize: 2 });
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  expect(mesh.visible).toBe(false); expect(root.visible).toBe(false);
  expect(mesh.children).toBe(originalChildren); expect(mesh.layers.mask).toBe(1 << 3);
  expect(renderer.getRenderTarget()).toBeNull();
  finish(); await preparation;
  target.dispose();
});

it("bounds batches to four objects and serializes concurrent requests for the same renderer", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const objects = Array.from({ length: 7 }, () => new THREE.Mesh());
  const batches: THREE.Object3D[][] = [];
  let running = 0, peak = 0;
  compile.mockImplementation(async view => {
    running++; peak = Math.max(peak, running); batches.push([...view.children]);
    await new Promise(resolve => setTimeout(resolve, 1)); running--;
  });
  await Promise.all([
    prepareShaderMeshes(renderer, scene, camera, objects, { batchSize: 20 }),
    prepareShaderMeshes(renderer, scene, camera, [objects[0]!]),
  ]);
  expect(batches.map(batch => batch.length)).toEqual([4, 3, 1]);
  expect(peak).toBe(1);
});

it("waits for each texture upload, discovers TSL maps, and reuses only unchanged live versions", async () => {
  const { scene, camera, renderer, compile, initTexture, completed } = fixture();
  const maps = [new THREE.DataTexture(new Uint8Array(4), 1, 1), new THREE.DataTexture(new Uint8Array(4), 1, 1)];
  const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: maps[0] }));
  const nodeMaterial = new MeshBasicNodeMaterial(); nodeMaterial.colorNode = textureNode(maps[1]!);
  const second = new THREE.Mesh(first.geometry, nodeMaterial);
  let finish!: () => void;
  completed.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const preparation = prepareShaderMeshes(renderer, scene, camera, [first, second]);
  await vi.waitFor(() => expect(initTexture).toHaveBeenCalledTimes(1));
  expect(compile).not.toHaveBeenCalled();
  finish(); await preparation;
  expect(initTexture.mock.calls.map(call => call[0])).toEqual(maps);
  await prepareShaderMeshes(renderer, scene, camera, [first, second]);
  expect(initTexture).toHaveBeenCalledTimes(2);
  maps[0]!.needsUpdate = true; maps[1]!.dispose();
  await prepareShaderMeshes(renderer, scene, camera, [first, second]);
  expect(initTexture).toHaveBeenCalledTimes(4);
});

it("prepares corpse transparency without changing live material or skinning across an await", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const material = new MeshBasicNodeMaterial();
  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
  mesh.bind(new THREE.Skeleton([new THREE.Bone()]));
  mesh.userData.prepareCorpseFade = true; scene.add(mesh);
  const skeleton = mesh.skeleton;
  let fadeMaterial: THREE.Material | undefined;
  compile.mockImplementation(async view => {
    const item = view.children[0] as THREE.SkinnedMesh;
    expect(item).toBe(mesh); expect(item.skeleton).toBe(skeleton); expect(item.parent).toBe(scene);
    const compiled = item.material as THREE.Material;
    if (compiled.transparent) {
      fadeMaterial = compiled; expect(compiled.depthWrite).toBe(false);
      await Promise.resolve();
      expect(mesh.material).toBe(material); expect(material.transparent).toBe(false);
      expect(compiled.transparent).toBe(true);
    }
  });
  await prepareShaderMeshes(renderer, scene, camera, [mesh]);
  expect(compile).toHaveBeenCalledTimes(2); expect(fadeMaterial).not.toBe(material);
  expect(mesh.material).toBe(material);
});

it("restores live state on compilation failure and keeps readiness failed", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const mesh = new THREE.Mesh(); mesh.visible = false;
  compile.mockImplementationOnce(() => { throw new Error("pipeline failed"); });
  await expect(prepareShaderMeshes(renderer, scene, camera, [mesh])).rejects.toThrow("pipeline failed");
  expect(mesh.visible).toBe(false); expect(mesh.frustumCulled).toBe(true);
  await expect(prepareShaderMeshes(renderer, scene, camera, [mesh])).rejects.toThrow("pipeline failed");
  expect(compile).toHaveBeenCalledTimes(1);
  expect(graphicsValidationState(renderer).failed).toBeGreaterThan(0);
});


it("rejects native pipeline failures even when Three catches them and resolves compileAsync", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const device = renderer.backend as unknown as { device: {
    pushErrorScope: ReturnType<typeof vi.fn>; popErrorScope: ReturnType<typeof vi.fn>;
    createRenderPipelineAsync: (descriptor: { label: string }) => Promise<unknown>;
  } };
  const popErrorScope = vi.fn(async () => null);
  Object.assign(device.device, {
    pushErrorScope: vi.fn(), popErrorScope,
    createRenderPipelineAsync: vi.fn(async () => { throw new Error("invalid vertex binding"); }),
  });
  compile.mockImplementation(async () => {
    // This is Three's real failure policy: log the rejected pipeline and resolve compilation.
    await device.device.createRenderPipelineAsync({ label: "creature" }).catch(() => {});
  });
  await expect(prepareShaderMeshes(renderer, scene, camera, [new THREE.Mesh()])).rejects.toThrow("invalid vertex binding");
  expect(graphicsValidationState(renderer).failed).toBe(1);
  expect(device.device.pushErrorScope).toHaveBeenCalledTimes(3);
  expect(popErrorScope).toHaveBeenCalledTimes(3);
});

it("captures asynchronous validation errors before preparation reports success", async () => {
  const { scene, camera, renderer } = fixture();
  const device = (renderer.backend as unknown as { device: object }).device;
  Object.assign(device, { pushErrorScope: vi.fn(), popErrorScope: vi.fn()
    .mockResolvedValueOnce({ message: "texture format mismatch" }).mockResolvedValue(null) });
  await expect(prepareShaderMeshes(renderer, scene, camera, [new THREE.Mesh()])).rejects.toThrow("texture format mismatch");
  expect(graphicsValidationState(renderer).failed).toBe(1);
});

it("balances synchronous frame scopes while an asynchronous preparation scope is open", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const scopes: string[] = [];
  const device = (renderer.backend as unknown as { device: {
    pushErrorScope(filter: string): void; popErrorScope(): Promise<null>;
  } }).device;
  Object.assign(device, {
    pushErrorScope: (filter: string) => { scopes.push(filter); },
    popErrorScope: async () => { expect(scopes.length).toBeGreaterThan(0); scopes.pop(); return null; },
  });
  let finish!: () => void;
  compile.mockImplementation(async () => {
    device.pushErrorScope("validation");
    await new Promise<void>(resolve => { finish = resolve; });
    await device.popErrorScope();
  });
  const preparing = prepareShaderMeshes(renderer, scene, camera, [new THREE.Mesh()]);
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  expect(scopes).toHaveLength(4);
  validateGraphicsSubmission(renderer, "Gameplay frame", () => { expect(scopes).toHaveLength(7); });
  expect(scopes).toHaveLength(4);
  finish(); await preparing;
  await waitForGraphicsValidation(renderer);
  expect(scopes).toHaveLength(0);
  expect(graphicsValidationState(renderer).failed).toBe(0);
});
