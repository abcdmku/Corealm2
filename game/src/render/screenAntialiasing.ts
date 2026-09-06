import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { GpuTimer } from "./gpuTimer.js";

export const SCREEN_AA_MATERIAL = "Final frame antialiasing";

/** Smooth subpixel foliage detail after MSAA has resolved the leaf coverage samples. */
export class ScreenAntialiasing {
  enabled = true;
  private readonly size = new THREE.Vector2();
  private frame: THREE.FramebufferTexture | null = null;
  private gpuTimer: GpuTimer | null = null;
  private readonly material = new THREE.ShaderMaterial({
    name: SCREEN_AA_MATERIAL,
    uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: FXAAShader.vertexShader,
    // This copy has one mip. Explicit LOD also avoids undefined derivatives in FXAA's
    // per-pixel edge-search loops on ANGLE/D3D11.
    fragmentShader: FXAAShader.fragmentShader.replace("return texture( tex2D, uv );", "return textureLod( tex2D, uv, 0.0 );"),
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  private readonly quad = new FullScreenQuad(this.material);

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return;
    renderer.getDrawingBufferSize(this.size);
    if (this.size.x < 1 || this.size.y < 1) return;
    if (!this.frame || this.frame.image.width !== this.size.x || this.frame.image.height !== this.size.y) {
      this.frame?.dispose();
      this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.frame.name = "Resolved display colour for antialiasing";
      this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
      // The canvas already contains tone-mapped sRGB values. FXAA needs that display-space
      // contrast; do not decode, tone map or encode them again in this final pass.
      this.frame.colorSpace = THREE.NoColorSpace;
      this.material.uniforms.tDiffuse!.value = this.frame;
      this.material.uniforms.resolution!.value.set(1 / this.size.x, 1 / this.size.y);
    }
    const previousAutoClear = renderer.autoClear;
    const previousAutoReset = renderer.info.autoReset;
    // Sample separately from the whole-frame and shadow queries; never block for a result.
    // Coprime with the other timers' 20-frame cadence so diagnostic toggles cannot lock
    // this sampler onto a frame already owned by a whole-frame query.
    if (!this.gpuTimer) {
      const context = renderer.getContext();
      if ("createQuery" in context) this.gpuTimer = new GpuTimer(context, 31, 7);
    }
    this.gpuTimer?.begin();
    try {
      renderer.copyFramebufferToTexture(this.frame);
      // Preserve the scene depth and include this single triangle in frame statistics.
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      this.quad.render(renderer);
    } finally {
      this.gpuTimer?.end();
      renderer.autoClear = previousAutoClear;
      renderer.info.autoReset = previousAutoReset;
    }
  }

  getTiming(): ReturnType<GpuTimer["snapshot"]> {
    return this.gpuTimer?.snapshot() ?? { supported: false, milliseconds: null, completed: 0, pending: 0 };
  }

  dispose(): void {
    this.gpuTimer?.dispose();
    this.frame?.dispose();
    this.frame = null;
    this.material.dispose();
    this.quad.dispose();
  }
}
