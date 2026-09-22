import * as THREE from "three";
import { expect, it, vi } from "vitest";
import { Renderer } from "../game/src/render/renderer.js";
import { prepareShaderMeshes } from "../game/src/render/shaderPreparation.js";

vi.mock("../game/src/render/shaderPreparation.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../game/src/render/shaderPreparation.js")>();
  return { ...actual, prepareShaderMeshes: vi.fn(async () => {}) };
});

it("does not report the first frame complete until a newer gameplay submission and GPU completion", async () => {
  vi.useFakeTimers();
  try {
    let submitted = 3, finished = false;
    let complete!: () => void;
    const completeGpuWork = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      framePacer: { snapshot: () => ({ submitted, failed: false }) }, completeGpuWork,
    }) as Renderer;
    const ready = renderer.waitForFrame(3).then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(24);
    expect(completeGpuWork).not.toHaveBeenCalled();
    submitted++;
    await vi.advanceTimersByTimeAsync(8);
    expect(completeGpuWork).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    complete(); await ready;
    expect(finished).toBe(true);
  } finally { vi.useRealTimers(); }
});

it("rejects first-frame readiness after submission failure or timeout", async () => {
  vi.useFakeTimers();
  try {
    for (const failed of [false, true]) {
      const renderer = Object.assign(Object.create(Renderer.prototype), {
        framePacer: { snapshot: () => ({ submitted: 0, failed }) },
        completeGpuWork: vi.fn(),
      }) as Renderer;
      const result = expect(renderer.waitForFrame(0)).rejects.toThrow("first game frame");
      if (!failed) await vi.advanceTimersByTimeAsync(30_000);
      await result;
    }
  } finally { vi.useRealTimers(); }
});

it("prepares shared geometry once and restores hidden interiors before asynchronous compilation", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), hidden = new THREE.Group();
  const material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry();
  const visible = new THREE.Mesh(geometry, material), duplicate = visible.clone();
  const interior = new THREE.Mesh(new THREE.SphereGeometry(), material);
  hidden.visible = false; hidden.add(interior); scene.add(visible, duplicate, hidden);
  const frameTarget = new THREE.RenderTarget(), fake = {};
  let finishGlow!: () => void;
  const prepareGlow = vi.fn(() => new Promise<void>(resolve => { finishGlow = resolve; }));
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, renderer: fake, frameTarget, warmupMaterials: [],
    initialized: true, requiredEffectRoots: new Set(), deferredEffectRoots: new Set(),
    magicGlow: { prepare: prepareGlow },
  }) as Renderer;
  const prepare = vi.mocked(prepareShaderMeshes);
  prepare.mockClear();
  prepare.mockImplementationOnce(async (_renderer, _scene, _camera, objects) => {
    expect(hidden.visible).toBe(false);
    expect(interior.parent).toBe(hidden);
    expect(scene.children).toEqual([visible, duplicate, hidden]);
    expect(objects).toEqual([visible, interior]);
    expect(renderer.getPreparationState()).toMatchObject({ compiling: true, ready: false });
    await Promise.resolve();
  });
  const warming = renderer.warmup({ temporarilyVisible: [hidden] });
  await vi.waitFor(() => expect(prepareGlow).toHaveBeenCalledOnce());
  expect(renderer.getPreparationState()).toMatchObject({ compiling: true, ready: false });
  finishGlow(); await warming;
  expect(renderer.getPreparationState()).toMatchObject({ compiling: false, ready: true });
  expect(prepare).toHaveBeenCalledWith(fake, scene, camera, [visible, interior], { renderTarget: frameTarget, batchSize: 4 });
  geometry.dispose(); interior.geometry.dispose(); material.dispose(); frameTarget.dispose();
});

it("prepares every instance, sampled draw, skeleton, and batch while deduplicating ordinary meshes", async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const ordinary = new THREE.Mesh(geometry, material), duplicate = ordinary.clone();
  const instances = [new THREE.InstancedMesh(geometry, material, 4), new THREE.InstancedMesh(geometry, material, 4)];
  const skeletons = [new THREE.SkinnedMesh(geometry, material), new THREE.SkinnedMesh(geometry, material)];
  const batches = [new THREE.BatchedMesh(1, 24, 36, material), new THREE.BatchedMesh(1, 24, 36, material)];
  for (const batch of batches) { batch.geometry.dispose(); batch.geometry = geometry; }
  const counted = [Object.assign(ordinary.clone(), { count: 2 }), Object.assign(ordinary.clone(), { count: 2 })];
  scene.add(ordinary, duplicate, ...instances, ...skeletons, ...batches, ...counted);
  const frameTarget = new THREE.RenderTarget(), fake = {};
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, renderer: fake, frameTarget, warmupMaterials: [],
    magicGlow: { prepare: async () => {} },
  }) as Renderer;
  const prepare = vi.mocked(prepareShaderMeshes); prepare.mockClear();
  await renderer.warmup();
  expect(prepare).toHaveBeenCalledWith(fake, scene, camera,
    [ordinary, ...instances, ...skeletons, ...batches, ...counted], { renderTarget: frameTarget, batchSize: 4 });
  geometry.dispose(); material.dispose(); frameTarget.dispose();
});

it("reports the actual graphics backend and initialization state", () => {
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    renderer: { backend: { isWebGPUBackend: true } }, initialized: false,
  }) as Renderer;
  expect(renderer.getBackendState()).toEqual({ api: "webgpu", thread: "main", ready: false });
  Object.assign(renderer, { initialized: true });
  expect(renderer.getBackendState().ready).toBe(true);
  Object.assign(renderer.renderer.backend, { isWebGPUBackend: false });
  expect(renderer.getBackendState().api).toBe("webgl2");
});

it("draws all game passes into HDR, presents once, and restores the caller's output state", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const frameTarget = new THREE.RenderTarget(), background = new THREE.Color(0x123456);
  scene.background = background;
  const sky = { enabled: true, mesh: new THREE.Mesh() }; scene.add(sky.mesh);
  let target: THREE.RenderTarget | null = null;
  const order: string[] = [];
  const fake = {
    toneMapping: THREE.ACESFilmicToneMapping, info: { reset: vi.fn() },
    getRenderTarget: () => target, setRenderTarget: (next: THREE.RenderTarget | null) => { target = next; },
  };
  const pass = (name: string) => () => { expect(target).toBe(frameTarget); order.push(name); };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    renderer: fake, scene, camera, frameTarget,
    elementalRefraction: { render: pass("refraction") }, playerSilhouette: { render: pass("silhouette") },
    biomeAtmosphere: { sky, render: pass("atmosphere") }, screenAntialiasing: { render: pass("aa") },
    magicGlow: { render: pass("glow"), renderBase: () => {
      expect(scene.background).toBeNull(); pass("world")();
    } },
    presentation: { render: () => { expect(target).toBeNull(); expect(fake.toneMapping).toBe(THREE.NoToneMapping); order.push("present"); } },
  }) as Renderer;
  renderer.drawFrame();
  expect(order).toEqual(["world", "refraction", "silhouette", "atmosphere", "glow", "aa", "present"]);
  expect(scene.background).toBe(background);
  expect(fake.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  expect(target).toBeNull();
  frameTarget.dispose();
});

it("keeps deferred effects unready until their asynchronous pipeline preparation finishes", async () => {
  let complete!: () => void;
  const root = new THREE.Group();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    requiredEffectRoots: new Set(), deferredEffectRoots: new Set(), compilingEffects: false,
    deferredEffectsDone: null, effectPreparation: Promise.resolve(),
    submitEffects: () => new Promise<void>(resolve => { complete = resolve; }),
  }) as Renderer;
  renderer.compileEffects(root, { deferred: true });
  expect(renderer.effectsReady).toBe(false);
  const finished = renderer.finishDeferredEffects();
  await Promise.resolve();
  expect(renderer.effectsReady).toBe(false);
  complete(); await finished;
  expect(renderer.effectsReady).toBe(true);
});
