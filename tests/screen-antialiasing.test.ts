import * as THREE from "three/webgpu";
import { expect, it, vi } from "vitest";
import { ScreenAntialiasing } from "../game/src/render/screenAntialiasing.js";

function fixture() {
  const target = new THREE.RenderTarget(1280, 720, { type: THREE.HalfFloatType });
  const renderer = {
    autoClear: true, info: { autoReset: true }, toneMapping: THREE.ACESFilmicToneMapping,
    getDrawingBufferSize: (size: THREE.Vector2) => size.set(1280, 720),
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(),
    compileAsync: vi.fn(async () => {}),
    copyFramebufferToTexture: vi.fn((frame: THREE.FramebufferTexture) => {
      expect(renderer.getRenderTarget().texture.type).toBe(THREE.HalfFloatType);
      expect(frame.image.width).toBe(1280);
      expect(frame.image.height).toBe(720);
      expect(frame.colorSpace).toBe(THREE.NoColorSpace);
    }),
    render: vi.fn((quad: THREE.QuadMesh, camera: THREE.Camera) => {
      expect(renderer.copyFramebufferToTexture).toHaveBeenCalledOnce();
      expect(renderer.autoClear).toBe(false);
      expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
      expect((quad.material as THREE.NodeMaterial).isNodeMaterial).toBe(true);
      quad.onBeforeRender(renderer as never, quad as never, camera, quad.geometry, quad.material, null as never);
    }),
  };
  return { renderer, effect: new ScreenAntialiasing() };
}

it("copies the bound linear framebuffer before the effects draw and restores frame state", () => {
  const { renderer, effect } = fixture();
  effect.render(renderer as never);
  expect(renderer.copyFramebufferToTexture).toHaveBeenCalledOnce();
  expect(renderer.autoClear).toBe(true);
  expect(renderer.info.autoReset).toBe(true);
  expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  effect.enabled = false;
  effect.render(renderer as never);
  expect(renderer.render).toHaveBeenCalledOnce();
  effect.dispose();
});

it("compiles asynchronously without reading a framebuffer or applying tone mapping twice", async () => {
  const { renderer, effect } = fixture();
  renderer.compileAsync.mockImplementation(async () => { expect(renderer.toneMapping).toBe(THREE.NoToneMapping); });
  await effect.compile(renderer as never);
  expect(renderer.compileAsync).toHaveBeenCalledOnce();
  expect(renderer.copyFramebufferToTexture).not.toHaveBeenCalled();
  expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  expect(renderer.setRenderTarget).not.toHaveBeenCalled();
  effect.dispose();
});
