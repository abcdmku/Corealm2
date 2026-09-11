import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MagicGlow, registerMagicGlow } from "../game/src/render/magicGlow.js";

function harness() {
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
  const initialTarget = new THREE.WebGLCubeRenderTarget(64);
  let target: THREE.WebGLRenderTarget | null = initialTarget, cubeFace = 2, mipLevel = 1;
  const colour = new THREE.Color(0x345678);
  let alpha = 0.4, failComposite = false;
  const calls: { object: THREE.Object3D; material: string; target: THREE.WebGLRenderTarget | null;
    bodyWrites: boolean; emitterWrites: boolean; emission: number }[] = [];
  const fake = {
    autoClear: true, info: { autoReset: true }, shadowMap: { autoUpdate: true, needsUpdate: true },
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(640, 360),
    getRenderTarget: () => target,
    getActiveCubeFace: () => cubeFace,
    getActiveMipmapLevel: () => mipLevel,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null, face = 0, level = 0) => {
      target = next; cubeFace = face; mipLevel = level;
    },
    getClearColor: (result: THREE.Color) => result.copy(colour),
    getClearAlpha: () => alpha,
    setClearColor: (next: THREE.ColorRepresentation, opacity: number) => { colour.set(next); alpha = opacity; },
    copyFramebufferToTexture: () => {},
    clear: () => {},
    render: (object: THREE.Object3D) => {
      const material = object instanceof THREE.Mesh ? object.material as THREE.Material : null;
      calls.push({ object, material: material?.uuid ?? "scene", target,
        bodyWrites: body.material.colorWrite, emitterWrites: emitter.material.colorWrite, emission: emission.value });
      if (failComposite && material?.name === "Magic glow composite") throw new Error("driver draw failed");
    },
  };
  const renderer = fake as unknown as THREE.WebGLRenderer;
  const state = () => ({ target, cubeFace, mipLevel, colour: colour.getHex(), alpha,
    autoClear: fake.autoClear, autoReset: fake.info.autoReset, shadow: { ...fake.shadowMap },
    background: scene.background, bodyWrites: body.material.colorWrite,
    emitterWrites: emitter.material.colorWrite, emission: emission.value });
  return {
    glow, scene, camera, renderer, calls, state,
    fail: () => { failComposite = true; },
    dispose: () => { glow.dispose(); initialTarget.dispose(); body.geometry.dispose(); body.material.dispose();
      emitter.geometry.dispose(); emitter.material.dispose(); },
  };
}

describe("magic glow preparation", () => {
  it("runs the real empty-selection pipeline and reuses its buffers and bloom passes for the first effect", () => {
    const h = harness();
    let unregister: (() => void) | undefined;
    try {
      const before = h.state();
      // No glow root is registered. Preparation must still exercise HDR scene
      // occlusion and the actual UnrealBloomPass, without inventing a cast.
      h.glow.prepare(h.renderer, h.scene, h.camera);
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
      h.glow.prepare(h.renderer, h.scene, h.camera);
      expect(h.glow.snapshot()).toEqual(snapshot);
      expect(h.state()).toEqual(before);
    } finally { unregister?.(); h.dispose(); }
  });

  it("restores scene, renderer and idle counters when preparation fails during the final composite", () => {
    const h = harness();
    try {
      h.glow.enabled = false;
      const before = h.state();
      h.fail();
      expect(() => h.glow.prepare(h.renderer, h.scene, h.camera)).toThrow("driver draw failed");
      expect(h.state()).toEqual(before);
      expect(h.glow.snapshot()).toMatchObject({ enabled: false, activeMeshes: 0, rendered: false });
    } finally { h.dispose(); }
  });
});
