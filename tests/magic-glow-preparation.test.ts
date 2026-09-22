import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { MagicGlow, registerMagicGlow } from "../game/src/render/magicGlow.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

function harness(native = false) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const background = new THREE.Color(0x123456);
  scene.background = background;
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const emitter = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const emission = { value: 0.25 };
  emitter.userData["magicGlow"] = true;
  emitter.material.userData["magicEmissionPass"] = emission;
  scene.add(body, emitter);
  const glow = new MagicGlow();
  const initialTarget = new THREE.RenderTarget(640, 360, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 4 });
  let target: THREE.RenderTarget | null = initialTarget, cubeFace = 2, mipLevel = 1;
  const colour = new THREE.Color(0x345678);
  let alpha = 0.4, failComposite = false;
  let renderObjectFunction: ReturnType<THREE.WebGPURenderer['getRenderObjectFunction']> = null;
  const drawn: THREE.Object3D[] = [], clears: boolean[][] = [];
  const baseTexture = initialTarget.texture;
  const calls: { object: THREE.Object3D; material: string; target: THREE.RenderTarget | null;
    bodyWrites: boolean; emitterWrites: boolean; emission: number }[] = [];
  const fake = {
    toneMapping: THREE.ACESFilmicToneMapping,
    autoClear: true, info: { autoReset: true }, shadowMap: { autoUpdate: true, needsUpdate: true },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(640, 360),
    getRenderTarget: () => target,
    getActiveCubeFace: () => cubeFace,
    getActiveMipmapLevel: () => mipLevel,
    setRenderTarget: (next: THREE.RenderTarget | null, face = 0, level = 0) => {
      target = next; cubeFace = face; mipLevel = level;
    },
    getClearColor: (result: THREE.Color) => result.copy(colour),
    getClearAlpha: () => alpha,
    setClearColor: (next: THREE.ColorRepresentation, opacity: number) => { colour.set(next); alpha = opacity; },
    init: async () => {}, backend: { isWebGPUBackend: true, isWebGLBackend: !native, device: { queue: { onSubmittedWorkDone: async () => {} } } }, initTexture: () => {},
    compileAsync: async () => {},
    copyFramebufferToTexture: () => {},
    clear: (color: boolean, depth: boolean, stencil: boolean) => {
      clears.push([color, depth, stencil]);
      if (native) { expect(target).toBe(initialTarget); expect(target?.texture).not.toBe(baseTexture); }
    },
    getRenderObjectFunction: () => renderObjectFunction,
    setRenderObjectFunction: (callback: typeof renderObjectFunction) => { renderObjectFunction = callback; },
    renderObject: (object: THREE.Object3D) => { drawn.push(object); },
    render: (object: THREE.Object3D) => {
      if (object === scene && renderObjectFunction) object.traverseVisible(child => {
        if ((child as THREE.Mesh).isMesh) renderObjectFunction!(child, scene, camera, (child as THREE.Mesh).geometry,
          (child as THREE.Mesh).material as THREE.Material, null, null as never, null as never);
      });
      const material = object instanceof THREE.Mesh ? object.material as THREE.Material : null;
      calls.push({ object, material: material?.uuid ?? "scene", target,
        bodyWrites: body.material.colorWrite, emitterWrites: emitter.material.colorWrite, emission: emission.value });
      if (failComposite && material?.name === "Magic glow composite") throw new Error("driver draw failed");
    },
  };
  const renderer = fake as unknown as THREE.WebGPURenderer;
  const state = () => ({ target, cubeFace, mipLevel, colour: colour.getHex(), alpha,
    autoClear: fake.autoClear, autoReset: fake.info.autoReset, shadow: { ...fake.shadowMap },
    background: scene.background, bodyWrites: body.material.colorWrite,
    emitterWrites: emitter.material.colorWrite, emission: emission.value });
  return {
    glow, scene, camera, renderer, calls, state, drawn, clears, body, emitter, baseTexture, initialTarget,
    fail: () => { failComposite = true; },
    dispose: () => { glow.dispose(); initialTarget.dispose(); body.geometry.dispose(); body.material.dispose();
      emitter.geometry.dispose(); emitter.material.dispose(); },
  };
}

describe("magic glow preparation", () => {
  it('prepares only actual native emitters and reuses world depth with a color-only attachment swap', async () => {
    const h = harness(true), compiled: THREE.Object3D[] = [];
    const child = new THREE.Mesh(h.emitter.geometry, h.emitter.material);
    child.userData.magicGlow = true; h.body.add(child);
    const light = new THREE.DirectionalLight(); h.scene.add(light);
    const unregister = registerMagicGlow(h.scene);
    const previous = h.state();
    h.renderer.compileAsync = async root => { root.traverse(object => { if ((object as THREE.Mesh).isMesh) compiled.push(object); }); };
    const draw = h.renderer.render;
    h.renderer.render = function (scene, camera) {
      if (scene === h.scene) {
        expect(h.initialTarget.texture).not.toBe(h.baseTexture);
        expect(h.initialTarget.depthBuffer).toBe(true); expect(h.initialTarget.stencilBuffer).toBe(true);
        expect(h.initialTarget.samples).toBe(4);
        expect(light.parent).toBe(scene);
        expect(h.body.material.colorWrite).toBe(true);
      }
      return draw.call(this, scene, camera);
    };
    try {
      await h.glow.prepare(h.renderer, h.scene, h.camera, h.initialTarget);
      expect(compiled).toEqual([child, h.emitter]);
      expect(h.drawn).toEqual([child, h.emitter]);
      expect(h.clears).toEqual([[true, false, false]]);
      expect(h.initialTarget.texture).toBe(h.baseTexture);
      expect(h.renderer.getRenderObjectFunction()).toBeNull();
      expect(h.state()).toEqual(previous);
      h.fail();
      await expect(h.glow.prepare(h.renderer, h.scene, h.camera, h.initialTarget)).rejects.toThrow('driver draw failed');
      expect(h.initialTarget.texture).toBe(h.baseTexture);
      expect(h.renderer.getRenderObjectFunction()).toBeNull();
      expect(h.state()).toEqual(previous);
    } finally { unregister(); h.dispose(); }
  });

  it('restores native attachment and render callback when an emitter draw throws', () => {
    const h = harness(true), unregister = registerMagicGlow(h.scene);
    const previous = h.state();
    const hook: NonNullable<ReturnType<THREE.WebGPURenderer['getRenderObjectFunction']>> = () => { throw new Error('emitter failed'); };
    h.renderer.setRenderObjectFunction(hook);
    try {
      expect(() => h.glow.render(h.renderer, h.scene, h.camera)).toThrow('emitter failed');
      expect(h.initialTarget.texture).toBe(h.baseTexture);
      expect(h.renderer.getRenderObjectFunction()).toBe(hook);
      expect(h.state()).toEqual(previous);
    } finally { unregister(); h.dispose(); }
  });

  it('lowers every native bloom and composite material to WGSL', async () => {
    const h = harness(), shaders: string[] = [];
    h.renderer.compileAsync = async (object, camera) => {
      const shader = lowerToWgsl(object, h.scene, camera);
      shaders.push(shader.fragment);
    };
    try {
      await h.glow.compile(h.renderer);
      expect(shaders).toHaveLength(7);
      expect(shaders.every(shader => shader.includes('@fragment'))).toBe(true);
    } finally { h.dispose(); }
  });

  it('compiles the materials reused by the real bloom draw and restores the current target', async () => {
    const h = harness();
    const compiled = new Set<string>();
    h.renderer.compileAsync = async (scene) => {
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          if ((object as THREE.QuadMesh).isQuadMesh) expect(Object.keys(object.geometry.attributes).sort()).toEqual(['position','uv']);
          compiled.add((object.material as THREE.Material).uuid);
        }
      });

    };
    try {
      const before = h.state();
      await h.glow.compile(h.renderer);
      expect(h.state()).toEqual(before);
      expect(h.calls).toHaveLength(0);
      await h.glow.prepare(h.renderer, h.scene, h.camera);
      expect(h.calls.filter(call => call.material !== 'scene').every(call => compiled.has(call.material))).toBe(true);
      expect(compiled.size).toBeGreaterThanOrEqual(7);
      expect(h.state()).toEqual(before);
    } finally { h.dispose(); }
  });

  it('skips non-occluding effects while preserving their children, shared materials and layers on failure', async () => {
    const h = harness(), smoke = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ depthWrite: false }));
    smoke.layers.enable(4);
    const child = new THREE.Mesh(smoke.geometry, new THREE.MeshBasicMaterial()); smoke.add(child); h.scene.add(smoke);
    const mask = smoke.layers.mask, original = h.renderer.render;
    h.renderer.render = function(scene, camera) {
      if (scene === h.scene) {
        expect(smoke.layers.mask).toBe(0); expect(smoke.visible).toBe(true);
        expect(smoke.material.visible).toBe(true); expect(smoke.material.colorWrite).toBe(true);
        expect(child.layers.test(camera.layers)).toBe(true); expect(child.material.colorWrite).toBe(false);
      }
      return original.call(this, scene, camera);
    };
    try {
      await h.glow.prepare(h.renderer, h.scene, h.camera); expect(smoke.layers.mask).toBe(mask);
      h.fail(); await expect(h.glow.prepare(h.renderer, h.scene, h.camera)).rejects.toThrow('driver draw failed');
      expect(smoke.layers.mask).toBe(mask); expect(child.material.colorWrite).toBe(true);
    } finally { smoke.geometry.dispose(); smoke.material.dispose(); child.material.dispose(); h.dispose(); }
  });

  it("runs the real empty-selection pipeline and reuses its buffers and bloom passes for the first effect", async () => {
    const h = harness();
    let unregister: (() => void) | undefined;
    try {
      const before = h.state();
      // No glow root is registered. Preparation must still exercise HDR scene
      // occlusion and the actual node bloom pyramid, without inventing a cast.
      await h.glow.prepare(h.renderer, h.scene, h.camera);
      expect(h.state()).toEqual(before);
      expect(h.glow.snapshot()).toMatchObject({ activeMeshes: 0, rendered: false, width: 640, height: 360 });
      const prepared = [...h.calls];
      expect(prepared[0]).toMatchObject({ object: h.scene, bodyWrites: false, emitterWrites: false, emission: 0.25 });
      expect(prepared[0]!.target?.texture.type).toBe(THREE.HalfFloatType);
      expect(prepared.length).toBeGreaterThan(10);

      unregister = registerMagicGlow(h.scene);
      h.calls.length = 0;
      h.glow.render(h.renderer, h.scene, h.camera);
      expect(h.calls[0]).toMatchObject({ bodyWrites: false, emitterWrites: true, emission: 1 });
      expect(h.calls.map(({ material, target }) => ({ material, target })))
        .toEqual(prepared.map(({ material, target }) => ({ material, target })));
      expect(h.state()).toEqual(before);
      expect(h.glow.snapshot()).toMatchObject({ activeMeshes: 1, rendered: true });

      const snapshot = h.glow.snapshot();
      await h.glow.prepare(h.renderer, h.scene, h.camera);
      expect(h.glow.snapshot()).toEqual(snapshot);
      expect(h.state()).toEqual(before);
    } finally { unregister?.(); h.dispose(); }
  });

  it("restores scene, renderer and idle counters when preparation fails during the final composite", async () => {
    const h = harness();
    try {
      h.glow.enabled = false;
      const before = h.state();
      h.fail();
      await expect(h.glow.prepare(h.renderer, h.scene, h.camera)).rejects.toThrow("driver draw failed");
      expect(h.state()).toEqual(before);
      expect(h.glow.snapshot()).toMatchObject({ enabled: false, activeMeshes: 0, rendered: false });
    } finally { h.dispose(); }
  });
});
