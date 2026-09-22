import * as THREE from "three/webgpu";
import { rtt, texture } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";

export const SCREEN_AA_MATERIAL = "Final frame antialiasing";

/** Smooth subpixel foliage detail after MSAA has resolved the leaf coverage samples. */
export class ScreenAntialiasing {
  enabled = true;
  timingEnabled = false;
  private readonly size = new THREE.Vector2();
  private readonly frame = new THREE.FramebufferTexture(1, 1);
  private readonly frameNode = texture(this.frame);
  // The common renderer's framebuffer contains linear display colour, even when the
  // canvas is sRGB. FXAA measures display-space contrast, then returns linear colour
  // for the renderer's single final sRGB conversion.
  private readonly display = rtt(this.frameNode.workingToColorSpace(THREE.SRGBColorSpace), null, null,
    { type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });
  private readonly material = new THREE.NodeMaterial();
  private readonly quad = new THREE.QuadMesh(this.material);

  constructor() {
    this.frame.name = "Resolved linear display colour for antialiasing";
    this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    this.frame.colorSpace = THREE.NoColorSpace;
    this.material.name = SCREEN_AA_MATERIAL;
    this.material.fragmentNode = fxaa(this.display).colorSpaceToWorking(THREE.SRGBColorSpace);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = THREE.NoBlending;
    this.material.toneMapped = false;
  }

  async compile(renderer: THREE.WebGPURenderer): Promise<void> {
    const toneMapping = renderer.toneMapping;
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      await renderer.compileAsync(this.quad, this.quad.camera);
    } finally {
      renderer.toneMapping = toneMapping;
    }
  }

  render(renderer: THREE.WebGPURenderer): void {
    if (!this.enabled) return;
    renderer.getDrawingBufferSize(this.size);
    if (this.size.x < 1 || this.size.y < 1) return;
    if (this.frame.image.width !== this.size.x || this.frame.image.height !== this.size.y) {
      this.frame.image.width = this.size.x;
      this.frame.image.height = this.size.y;
      this.frame.needsUpdate = true;
    }
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset, toneMapping = renderer.toneMapping;
    try {
      // The explicit frame target remains bound throughout the effects chain, so
      // Three copies its actual HDR format before the display-space RTT executes.
      renderer.copyFramebufferToTexture(this.frame);
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.toneMapping = THREE.NoToneMapping;
      this.quad.render(renderer);
    } finally {
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
      renderer.toneMapping = toneMapping;
    }
  }

  getTiming(): { supported: boolean; milliseconds: number | null; completed: number; pending: number } {
    // Backend timestamps are measured by the renderer; this pass never obtains a
    // synchronous WebGL context or waits for a GPU result.
    return { supported: false, milliseconds: null, completed: 0, pending: 0 };
  }

  dispose(): void {
    this.frame.dispose();
    this.display.renderTarget?.dispose();
    this.material.dispose();
  }
}
