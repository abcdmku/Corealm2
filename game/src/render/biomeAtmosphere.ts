import * as THREE from "three";
import type { RegionId } from "../contracts.js";
import { BiomeSky, BIOME_MOOD_STRENGTH } from "./biomeSky.js";

export const BIOME_LOOKS = {
  fallowmarch: { name: "Fallowmarch · golden pasture", tint: [1.12, 1.045, 0.83], shade: [1.035, 1.01, 0.94], saturation: 1.04 },
  vellenwood: { name: "Vellenwood · woodland shade", tint: [0.84, 1.10, 0.96], shade: [0.73, 0.94, 0.90], saturation: 0.96 },
  karrowmoor: { name: "Karrowmoor · slate highlands", tint: [0.85, 0.98, 1.20], shade: [0.76, 0.88, 1.12], saturation: 0.86 },
  kilnhalt: { name: "Kilnhalt · ember haze", tint: [1.23, 0.99, 0.74], shade: [1.12, 0.83, 0.71], saturation: 0.88 },
  gravelmaw: { name: "Gravelmaw · mineral gloom", tint: [0.85, 0.91, 1.14], shade: [0.68, 0.77, 1.07], saturation: 0.77 },
  wilderness: { name: "Wilderness · moonlit wastes", tint: [.88, .96, 1.10], shade: [.79, .86, 1.05], saturation: .72 },
} as const satisfies Record<RegionId, unknown>;

export type BiomeWeights = Partial<Record<RegionId, number>>;

/** Normalized organic field weights, never semantic region rectangles. Empty input is neutral. */
export function blendBiomeLook(weights: BiomeWeights, wildernessMagic = 0) {
  const tint = [0, 0, 0], shade = [0, 0, 0];
  let total = 0, saturation = 0;
  for (const id of Object.keys(BIOME_LOOKS) as RegionId[]) {
    const weight = weights[id] ?? 0;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const look = BIOME_LOOKS[id];
    total += weight;
    saturation += weight * look.saturation;
    for (let i = 0; i < 3; i++) {
      tint[i]! += look.tint[i]! * weight;
      shade[i]! += look.shade[i]! * weight;
    }
  }
  const result = total > 0
    ? { tint: tint.map(v => v / total), shade: shade.map(v => v / total), saturation: saturation / total }
    : { tint: [1, 1, 1], shade: [1, 1, 1], saturation: 1 };
  const deep = total ? Math.max(0, Math.min(1, wildernessMagic)) * (weights.wilderness ?? 0) / total : 0;
  for (let i = 0; i < 3; i++) {
    result.tint[i]! += ([.96, .87, 1.2][i]! - result.tint[i]!) * deep;
    result.shade[i]! += ([.72, .68, 1.05][i]! - result.shade[i]!) * deep;
  }
  return result;
}

/** Grade the completed display frame so existing sky/fog, antialiasing and stencil stay intact.
 * One GPU framebuffer copy and one triangle. DOM UI is outside this pass.
 */
export class BiomeAtmosphere {
  readonly sky = new BiomeSky();
  private texture: THREE.FramebufferTexture | null = null;
  private readonly size = new THREE.Vector2();
  private readonly origin = new THREE.Vector2();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { frame: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) },
      shade: { value: new THREE.Vector3(1, 1, 1) }, saturation: { value: 1 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D frame;
      uniform vec3 tint, shade; uniform float saturation; varying vec2 vUv;
      void main() {
        vec4 source = texture2D(frame, vUv);
        float luma = dot(source.rgb, vec3(.2126, .7152, .0722));
        vec3 colour = mix(vec3(luma), source.rgb, saturation);
        // Split tone retains black and protects bright clouds and spell cores from clipping.
        vec3 balance = mix(shade, tint, smoothstep(.12, .75, luma));
        colour += ${(2 * BIOME_MOOD_STRENGTH).toFixed(2)} * (balance - 1.) * colour * (1. - colour);
        gl_FragColor = vec4(clamp(colour, 0., 1.), source.a);
      }`,
  });
  private readonly geometry = new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  private weights: BiomeWeights = {};
  private override: RegionId | "neutral" | null = null;
  private wildernessMagic = 0;

  constructor() {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  setWeights(weights: BiomeWeights): void { this.weights = { ...weights }; }
  setWildernessMagic(amount: number): void { this.wildernessMagic = Math.max(0, Math.min(1, amount)); }
  setPreview(region: RegionId | "neutral" | null): void { this.override = region; this.sky.enabled = true; }
  private activeWeights(): BiomeWeights { return this.override === "neutral" ? {} : this.override ? { [this.override]: 1 } : this.weights; }
  updateEnvironment(scene: THREE.Scene, deltaSeconds: number): void { this.sky.update(scene, this.activeWeights(), deltaSeconds, this.wildernessMagic); }
  snapshot() {
    return { preview: this.override, weights: { ...this.weights }, wildernessMagic: this.wildernessMagic, sky: this.sky.snapshot(),
      tint: this.material.uniforms.tint!.value.toArray(),
      shade: this.material.uniforms.shade!.value.toArray(), saturation: this.material.uniforms.saturation!.value };
  }

  render(renderer: THREE.WebGLRenderer, deltaSeconds: number): void {
    const look = blendBiomeLook(this.activeWeights(), this.wildernessMagic);
    const blend = 1 - Math.exp(-Math.min(Math.max(deltaSeconds, 0), 0.1) * 3);
    for (const key of ["tint", "shade"] as const) {
      const value = this.material.uniforms[key]!.value as THREE.Vector3;
      value.x += (look[key][0]! - value.x) * blend;
      value.y += (look[key][1]! - value.y) * blend;
      value.z += (look[key][2]! - value.z) * blend;
    }
    this.material.uniforms.saturation!.value += (look.saturation - this.material.uniforms.saturation!.value) * blend;
    renderer.getDrawingBufferSize(this.size);
    if (!this.texture || this.texture.image.width !== this.size.x || this.texture.image.height !== this.size.y) {
      this.texture?.dispose();
      this.texture = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.material.uniforms.frame!.value = this.texture;
    }
    renderer.copyFramebufferToTexture(this.texture, this.origin);
    const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    try { renderer.render(this.scene, this.camera); }
    finally { renderer.autoClear = autoClear; renderer.info.autoReset = autoReset; }
  }

  dispose(): void { this.sky.dispose(); this.texture?.dispose(); this.material.dispose(); this.geometry.dispose(); }
}
