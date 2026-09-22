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
  expect(compile).toHaveBeenCalledOnce(); expect(gate.getState().queued).toBe(3);
  scene.add(new THREE.Points());
  finish(); await settle(gate);
  expect(sizes).toEqual([2, 2, 2]); gate.dispose();
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

it("retains failed readiness and cancels further batches when disposed during preparation", async () => {
  const { scene, gate, mesh, compile } = fixture();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    compile.mockRejectedValueOnce(new Error("pipeline failed"));
    scene.add(mesh); gate.prepare(); gate.restore();
    await vi.waitFor(() => expect(gate.getState()).toMatchObject({ failed: 1, compiling: false, error: "pipeline failed" }));
    expect(gate.hasPending(scene)).toBe(true); expect(error).toHaveBeenCalledOnce();
    let finish!: () => void;
    compile.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    scene.add(new THREE.Mesh(), new THREE.Mesh(), new THREE.Mesh());
    gate.prepare(); gate.restore(); await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(2));
    gate.dispose(); finish();
    await new Promise(resolve => setTimeout(resolve, 10));
    gate.prepare(); expect(compile).toHaveBeenCalledTimes(2);
    expect(gate.getState().waiting).toBe(0); expect(mesh.visible).toBe(true);
  } finally { error.mockRestore(); gate.dispose(); }
});
