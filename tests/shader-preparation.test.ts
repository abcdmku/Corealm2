import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { texture as textureNode } from "three/tsl";
import { expect, it, vi } from "vitest";
import { prepareShaderMeshes, shaderPreparationState, graphicsValidationState, validateGraphicsSubmission, waitForGraphicsValidation } from "../game/src/render/shaderPreparation.js";
import { SceneryInstances } from '../game/src/render/sceneryInstances.js';

function fixture() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  let target: THREE.RenderTarget | null = null;
  const compile = vi.fn(async (_view: THREE.Object3D, _camera: THREE.Camera, _scene: THREE.Scene) => {});
  const initTexture = vi.fn((_texture: THREE.Texture) => {});
  const completed = vi.fn(async () => {});
  const renderer = {
    _initialized: true, init: async () => {}, compileAsync: compile, initTexture,
    _pipelines: { getForRender: () => {} },
    backend: { isWebGPUBackend: true, createRenderPipeline: () => {}, device: {
      queue: { onSubmittedWorkDone: completed }, pushErrorScope: () => {}, popErrorScope: async () => null,
      createRenderPipelineAsync: async () => ({}),
    } },
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

it('seeds scenery alone, then groups at most eight prepared layouts without releasing readiness before the fence', async () => {
  const { scene, camera, renderer, compile, completed } = fixture();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const meshes = Array.from({ length: 18 }, () => new SceneryInstances(geometry, material, 4));
  const sizes: number[] = [];
  let active = 0, maximum = 0, finish!: () => void;
  compile.mockImplementation(async view => {
    active++; maximum = Math.max(maximum, active); sizes.push(view.children.length);
    await Promise.resolve(); active--;
  });
  completed.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const preparing = prepareShaderMeshes(renderer, scene, camera, meshes);
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(sizes).toEqual([1]);
  expect(shaderPreparationState(renderer).pendingMeshes).toBe(18);
  finish(); await preparing;
  expect(sizes).toEqual([1, 8, 8, 1]);
  expect(completed).toHaveBeenCalledTimes(4);
  expect(maximum).toBe(1);
  expect(shaderPreparationState(renderer).pendingMeshes).toBe(0);
  for (const mesh of meshes) mesh.dispose();
});

it('limits grouped scenery to 256 KiB of new buffers and counts shared source attributes only after their first fence', async () => {
  const { scene, camera, renderer, compile, completed } = fixture();
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(30_000), 3));
  const material = new THREE.MeshStandardMaterial();
  // Each named transform buffer is 80 KiB. Four attribute columns must count it once.
  const meshes = Array.from({ length: 8 }, () => new SceneryInstances(geometry, material, 1280));
  const sizes: number[] = [];
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  await prepareShaderMeshes(renderer, scene, camera, meshes);
  expect(sizes).toEqual([1, 3, 3, 1]);
  expect(completed).toHaveBeenCalledTimes(4);
  for (const mesh of meshes) mesh.dispose();
});

it.each([1, 1280])('allows startup scenery seeds in groups of four within the existing upload cap (capacity %i)', async capacity => {
  const { scene, camera, renderer, compile, completed } = fixture();
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(30_000), 3));
  const meshes = Array.from({ length: 8 }, () => new SceneryInstances(geometry, new THREE.MeshStandardMaterial(), capacity));
  const sizes: number[] = [];
  let finish!: () => void;
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  completed.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const preparing = prepareShaderMeshes(renderer, scene, camera, meshes, { pipelineConcurrency: 2 });
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(shaderPreparationState(renderer).pendingMeshes).toBe(8);
  expect(sizes).toEqual([capacity === 1 ? 4 : 1]);
  finish(); await preparing;
  expect(sizes).toEqual(capacity === 1 ? [4, 4] : [1, 3, 3, 1]);
  expect(shaderPreparationState(renderer).pendingMeshes).toBe(0);
  for (const mesh of meshes) mesh.dispose();
});

it('keeps explicit WebGL fallback preparation serial when startup requests native overlap', async () => {
  const { scene, camera, renderer, compile } = fixture();
  Object.assign(renderer.backend, { isWebGPUBackend: false, isWebGLBackend: true, gl: {
    SYNC_GPU_COMMANDS_COMPLETE: 1, WAIT_FAILED: 2, TIMEOUT_EXPIRED: 3,
    isContextLost: () => false, fenceSync: () => ({}), flush: () => {}, deleteSync: () => {}, clientWaitSync: () => 4,
  } });
  const meshes = Array.from({ length: 3 }, () => new SceneryInstances(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 1));
  const sizes: number[] = [];
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  await prepareShaderMeshes(renderer, scene, camera, meshes, { pipelineConcurrency: 2 });
  expect(sizes).toEqual([1, 1, 1]);
  for (const mesh of meshes) mesh.dispose();
});

it.each(['version', 'disposed-wrapper', 'disposed-source'] as const)('recounts shared scenery buffers after %s', async change => {
  const { scene, camera, renderer, compile } = fixture();
  const position = new THREE.BufferAttribute(new Float32Array(90_000), 3);
  const geometry = new THREE.BufferGeometry().setAttribute('position', position);
  const material = new THREE.MeshStandardMaterial();
  const meshes = Array.from({ length: 3 }, () => new SceneryInstances(geometry, material, 1));
  await prepareShaderMeshes(renderer, scene, camera, [meshes[0]!]);
  if (change === 'version') position.needsUpdate = true;
  else if (change === 'disposed-source') geometry.dispose();
  else {
    const original = meshes[0]!.geometry;
    // The disposal callback must retain the original buffers even after mesh replacement.
    meshes[0]!.geometry = new THREE.InstancedBufferGeometry();
    original.dispose();
  }
  const sizes: number[] = [];
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  await prepareShaderMeshes(renderer, scene, camera, meshes.slice(1));
  // The unsplittable 360 KiB source runs alone. Its following cluster still completes.
  expect(sizes).toEqual([1, 1]);
  for (const mesh of meshes) mesh.dispose();
});

it('does not certify a replacement attribute array assigned while its upload fence is pending', async () => {
  const { scene, camera, renderer, compile, completed } = fixture();
  const position = new THREE.BufferAttribute(new Float32Array(3), 3);
  const geometry = new THREE.BufferGeometry().setAttribute('position', position), material = new THREE.MeshStandardMaterial();
  const meshes = Array.from({ length: 4 }, () => new SceneryInstances(geometry, material, 1));
  const sizes: number[] = [];
  let finish!: () => void;
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  completed.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const preparing = prepareShaderMeshes(renderer, scene, camera, meshes);
  await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  Object.assign(position, { array: new Float32Array(90_000), count: 30_000 });
  finish(); await preparing;
  expect(sizes).toEqual([1, 1, 2]);
  for (const mesh of meshes) mesh.dispose();
});

it('seeds a new or changed scenery material separately from previously prepared layouts', async () => {
  const { scene, camera, renderer, compile } = fixture();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const meshes = Array.from({ length: 4 }, () => new SceneryInstances(geometry, material, 1));
  await prepareShaderMeshes(renderer, scene, camera, [meshes[0]!]);
  (meshes[1]!.material as THREE.Material).needsUpdate = true;
  const sizes: number[] = [];
  compile.mockImplementation(async view => { sizes.push(view.children.length); });
  await prepareShaderMeshes(renderer, scene, camera, meshes.slice(1));
  expect(sizes).toEqual([1, 2]);
  for (const mesh of meshes) mesh.dispose();
});

it("reports queued resident meshes until each complete batch finishes", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const releases: (() => void)[] = [];
  compile.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
  const first = prepareShaderMeshes(renderer, scene, camera, [new THREE.Mesh(), new THREE.Mesh()]);
  const second = prepareShaderMeshes(renderer, scene, camera, [new THREE.Mesh()]);
  expect(shaderPreparationState(renderer)).toEqual({ pendingMeshes: 3, pendingTextures: 0, compiling: true });
  for (let index = 0; index < 3; index++) {
    await vi.waitFor(() => expect(releases).toHaveLength(index + 1));
    expect(shaderPreparationState(renderer).pendingMeshes).toBe(3 - index);
    releases[index]!();
  }
  await Promise.all([first, second]);
  expect(shaderPreparationState(renderer)).toEqual({ pendingMeshes: 0, pendingTextures: 0, compiling: false });
});

it("indexes lights once per preparation while retaining live visibility, topology, and authored traversal", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const meshes = Array.from({ length: 16 }, () => new THREE.Mesh());
  const visible = new THREE.PointLight(), hidden = new THREE.PointLight(), added = new THREE.SpotLight();
  const hiddenRoot = new THREE.Group(); hiddenRoot.visible = false; hiddenRoot.add(hidden);
  scene.add(...meshes, visible, hiddenRoot);
  const authoredVisits: THREE.Object3D[][] = [];
  scene.onBeforeRender = () => {
    const visited: THREE.Object3D[] = []; scene.traverseVisible(object => visited.push(object));
    authoredVisits.push(visited);
  };
  const beforeRender = scene.onBeforeRender, traverseVisible = scene.traverseVisible;
  const traversal = vi.spyOn(scene, "traverse"), addListener = vi.spyOn(scene, "addEventListener"), removeListener = vi.spyOn(scene, "removeEventListener");
  const discovered: THREE.Object3D[][] = [];
  compile.mockImplementation(async (_view, viewCamera, liveScene) => {
    expect(liveScene).toBe(scene); expect(viewCamera).toBe(camera);
    Reflect.apply(liveScene.onBeforeRender, liveScene, [renderer, _view, viewCamera, null]);
    const lights: THREE.Object3D[] = [];
    liveScene.traverseVisible(object => {
      expect((object as THREE.Light).isLight).toBe(true);
      if (object.layers.test(viewCamera.layers)) lights.push(object);
    });
    discovered.push(lights);
    expect(scene.traverseVisible).toBe(traverseVisible);
    await Promise.resolve();
    expect(scene.onBeforeRender).toBe(beforeRender);
    expect(scene.traverseVisible).toBe(traverseVisible);
    if (discovered.length === 1) {
      hiddenRoot.visible = true; scene.remove(visible); hiddenRoot.add(added);
    } else if (discovered.length === 2) {
      hidden.visible = false; added.layers.set(3);
    }
  });
  await prepareShaderMeshes(renderer, scene, camera, meshes);
  expect(discovered).toEqual([[visible], [hidden, added], ...Array.from({ length: 14 }, () => [])]);
  expect(authoredVisits).toHaveLength(16);
  for (const visited of authoredVisits) for (const mesh of meshes) expect(visited).toContain(mesh);
  expect(traversal).toHaveBeenCalledOnce();
  for (const [type, listener] of addListener.mock.calls) expect(removeListener).toHaveBeenCalledWith(type, listener);
});

it("avoids whole-scene listener indexing for short streamed preparation jobs", async () => {
  const { scene, camera, renderer, compile } = fixture();
  const meshes = Array.from({ length: 4 }, () => new THREE.Mesh());
  scene.add(...meshes, new THREE.PointLight());
  const addListener = vi.spyOn(scene, "addEventListener");
  await prepareShaderMeshes(renderer, scene, camera, meshes, { batchSize: 1 });
  expect(compile).toHaveBeenCalledTimes(4);
  expect(addListener).not.toHaveBeenCalled();
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
  expect(shaderPreparationState(renderer)).toEqual({ pendingMeshes: 2, pendingTextures: 1, compiling: true });
  finish(); await preparation;
  expect(shaderPreparationState(renderer)).toEqual({ pendingMeshes: 0, pendingTextures: 0, compiling: false });
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
  expect(shaderPreparationState(renderer)).toEqual({ pendingMeshes: 0, pendingTextures: 0, compiling: false });
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
