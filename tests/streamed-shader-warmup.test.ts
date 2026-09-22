import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { expect, it, vi } from "vitest";
import { StreamedShaderWarmup } from "../game/src/render/streamedShaderWarmup.js";

function fixture() {
  const scene = new THREE.Scene();
  const compile = vi.fn(async (_view: THREE.Object3D) => {});
  const renderer = { init: async () => {}, compileAsync: compile, initTexture: () => {},
    backend: { isWebGPUBackend: true, device: { queue: { onSubmittedWorkDone: async () => {} } } },
  } as unknown as WebGPURenderer;
  const gate = new StreamedShaderWarmup(renderer, scene, new THREE.PerspectiveCamera());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  return { scene, gate, mesh, compile };
}

async function settle(gate: StreamedShaderWarmup) {
  await vi.waitFor(() => {
    gate.prepare(); gate.restore();
    expect(gate.getState()).toMatchObject({ waiting: 0, queued: 0, compiling: false, textures: 0 });
  });
}

it("enrolls hidden attached interiors once and preserves the original parent and visibility", async () => {
  const { scene, gate, mesh, compile } = fixture();
  const root = new THREE.Group(); root.add(mesh); root.visible = false; scene.add(root);
  gate.enqueue(root); gate.enqueue(root);
  expect(gate.getState().waiting).toBe(1);
  gate.prepare(); expect(mesh.visible).toBe(false); gate.restore();
  expect(root.visible).toBe(false); expect(mesh.parent).toBe(root);
  await settle(gate);
  gate.enqueue(root); expect(gate.hasPending(root)).toBe(false);
  expect(compile).toHaveBeenCalledOnce(); expect(root.visible).toBe(false);
  gate.dispose();
});

it("keeps ordinary actors visible while deferring sampled replacements and covered destinations", async () => {
  const { scene, gate, mesh, compile } = fixture();
  let finish!: () => void;
  compile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  mesh.userData.entityId = "creature"; scene.add(mesh);
  gate.prepare(); expect(mesh.visible).toBe(true); gate.restore();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  gate.deferGameplayDraws = true;
  gate.prepare(); expect(mesh.visible).toBe(false); gate.restore();
  gate.deferGameplayDraws = false; mesh.userData.deferFirstDraw = true;
  gate.prepare(); expect(mesh.visible).toBe(false); gate.restore();
  finish(); await settle(gate);
  gate.prepare(); expect(mesh.visible).toBe(true); gate.restore(); gate.dispose();
});

it("runs only one bounded batch and continues receiving additions while a pipeline is pending", async () => {
  const { scene, gate, compile } = fixture();
  let finish!: () => void;
  const sizes: number[] = [];
  compile.mockImplementationOnce(view => {
    sizes.push(view.children.length);
    return new Promise<void>(resolve => { finish = resolve; });
  }).mockImplementation(async view => { sizes.push(view.children.length); });
  for (let index = 0; index < 5; index++) scene.add(new THREE.Mesh());
  gate.prepare(); gate.restore();
  await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  for (let frame = 0; frame < 10; frame++) { gate.prepare(); gate.restore(); }
  expect(compile).toHaveBeenCalledOnce(); expect(gate.getState().queued).toBe(1);
  scene.add(new THREE.Points());
  finish(); await settle(gate);
  expect(sizes).toEqual([1, 1, 1, 1, 1, 1]); gate.dispose();
});

it("drains successive bounded batches without needing another gameplay frame", async () => {
  const { scene, gate, compile } = fixture();
  let active = 0, maximum = 0;
  const sizes: number[] = [];
  compile.mockImplementation(async view => {
    active++; maximum = Math.max(maximum, active); sizes.push(view.children.length);
    await new Promise(resolve => setTimeout(resolve, 0));
    active--;
  });
  for (let index = 0; index < 13; index++) scene.add(new THREE.Mesh());
  gate.prepare(); gate.restore();
  await vi.waitFor(() => expect(gate.getState()).toMatchObject({ waiting: 0, queued: 0, compiling: false }));
  expect(sizes).toEqual(Array(13).fill(1));
  expect(maximum).toBe(1);
  gate.dispose();
});

it("gives painting priority after a slow frame before continuing the drain", async () => {
  const { scene, gate, compile } = fixture();
  const frames: FrameRequestCallback[] = [];
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try {
    gate.prepare(); gate.restore();
    now.mockReturnValue(160);
    gate.prepare(); gate.restore();
    for (let index = 0; index < 5; index++) scene.add(new THREE.Mesh());
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    expect(compile).not.toHaveBeenCalled();
    frames.shift()!(160);
    await vi.waitFor(() => expect(gate.getState()).toMatchObject({ compiling: false, queued: 1 }), { interval: 2, timeout: 90 });
    expect(compile).toHaveBeenCalledTimes(4);
    expect(frames).toHaveLength(1);
    frames.shift()!(176);
    await vi.waitFor(() => expect(gate.getState().waiting).toBe(0));
    expect(compile).toHaveBeenCalledTimes(5);
  } finally { gate.dispose(); now.mockRestore(); vi.unstubAllGlobals(); }
});

it("updates pending ancestors after reparenting and retains objects requeued during compilation", async () => {
  const { scene, gate, mesh, compile } = fixture();
  const first = new THREE.Group(), second = new THREE.Group(); scene.add(first, second); first.add(mesh);
  let finish!: () => void;
  compile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  gate.prepare(); gate.restore(); await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  second.add(mesh);
  expect(gate.hasPending(first)).toBe(false); expect(gate.hasPending(second)).toBe(true);
  finish(); await settle(gate);
  expect(compile).toHaveBeenCalledTimes(2);
  expect(gate.hasPending(scene)).toBe(false); gate.dispose();
});

it("keeps feedback visible and skips already prewarmed feedback while scenery waits", async () => {
  const { scene, gate, mesh } = fixture(); scene.add(mesh);
  const ordinary = new THREE.Group(), prewarmed = new THREE.Group();
  ordinary.userData.keepVisibleDuringWarmup = true;
  prewarmed.userData.prewarmedInputFeedback = true;
  const ring = new THREE.Mesh(), readyRing = new THREE.Mesh();
  ordinary.add(ring); prewarmed.add(readyRing); scene.add(ordinary, prewarmed);
  gate.prepare();
  expect(mesh.visible).toBe(false); expect(ring.visible).toBe(true); expect(readyRing.visible).toBe(true);
  expect(gate.hasPending(prewarmed)).toBe(false); gate.restore();
  await settle(gate); gate.dispose();
});

it("retains failed readiness instead of revealing an invalid pipeline", async () => {
  const { scene, gate, mesh, compile } = fixture();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    compile.mockRejectedValueOnce(new Error("pipeline failed"));
    scene.add(mesh); gate.prepare(); gate.restore();
    await vi.waitFor(() => expect(gate.getState()).toMatchObject({ failed: 1, compiling: false,
      error: expect.stringContaining("pipeline failed") }));
    expect(gate.hasPending(scene)).toBe(true); expect(error).toHaveBeenCalledOnce();
  } finally { error.mockRestore(); gate.dispose(); }
});

it("cancels further batches when disposed during preparation", async () => {
  const { scene, gate, mesh, compile } = fixture();
  let finish!: () => void;
  compile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  scene.add(mesh, new THREE.Mesh(), new THREE.Mesh());
  gate.prepare(); gate.restore(); await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
  gate.dispose(); finish();
  await new Promise(resolve => setTimeout(resolve, 10));
  gate.prepare(); expect(compile).toHaveBeenCalledOnce();
  expect(gate.getState().waiting).toBe(0); expect(mesh.visible).toBe(true);
});

it("cancels a scheduled drain before its first native preparation starts", async () => {
  const { scene, gate, mesh, compile } = fixture();
  scene.add(mesh);
  gate.dispose();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(compile).not.toHaveBeenCalled();
  expect(gate.getState()).toMatchObject({ waiting: 0, queued: 0, compiling: false });
});
