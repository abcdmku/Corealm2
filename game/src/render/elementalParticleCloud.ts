import * as THREE from "three";
import type { MeshBasicNodeMaterial } from "three/webgpu";
import type { ParticleKind } from "../contracts.js";
import { abs, attribute, sin, vec4 } from "three/tsl";

import { releaseEffectMaterial } from "./sharedEffectMaterial.js";
import { acquireParticleMaterial, particleGeometry } from "./particleMaterial.js";

const particleColours = new Map<number, THREE.Color>();
function particleColour(hex: number): THREE.Color {
  let colour = particleColours.get(hex);
  if (!colour) { colour = new THREE.Color(hex); particleColours.set(hex, colour); }
  return colour;
}

/** All motes are three-dimensional meshes. No camera-facing cards or particle atlases. */
export class ElementalParticleCloud {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    MeshBasicNodeMaterial
  >;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly colours: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private count = 0;
  private readonly clock = { value: 0 };
  private energyGain = 1;
  dropped = 0;
  readonly capacity: number;
  constructor(
    parent: THREE.Object3D,
    kind: ParticleKind,
    capacity: number,
  ) {
    this.capacity = capacity;
    const geometry = particleGeometry(kind);
    this.centres = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.colours = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 2),
      2,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("centreSize", this.centres);
    geometry.setAttribute("tintAlpha", this.colours);
    geometry.setAttribute("particleShape", this.shapes);
    geometry.instanceCount = 0;
    const material = acquireParticleMaterial(kind, "authored", () => {
      const motion = attribute("particleShape", "vec2" as const);
      return {
        centre: attribute("centreSize", "vec4" as const),
        tint: attribute("tintAlpha", "vec4" as const),
        shape: vec4(motion.x.mul(.71), abs(sin(motion.x.mul(3))).mul(.6).add(.55), motion.y, motion.x),
      };
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.userData["effectClock"] = this.clock;
    this.mesh.frustumCulled = false;
    this.mesh.name = `elemental-3d-${kind}`;
    this.mesh.userData["magicGlow"] = kind === "light";
    this.mesh.userData["magicGlowOnly"] = kind === "light";
    this.mesh.renderOrder =
      kind === "fragment" ? 0 : kind === "smoke" ? 10 : 11;
    parent.add(this.mesh);
  }
  begin(seconds: number, energyGain = 1): void {
    this.energyGain = energyGain;
    this.count = 0;
    this.dropped = 0;
    this.clock.value = seconds;
  }
  put(
    x: number,
    y: number,
    z: number,
    size: number,
    hex: number,
    alpha: number,
    seed: number,
    stretch = 1,
    energy = 1,
  ): void {
    if (size < 0.001 || alpha < 0.006) return;
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.centres.setXYZW(i, x, y, z, size);
    const colour = particleColour(hex), gain = energy * this.energyGain;
    this.colours.setXYZW(i, colour.r * gain, colour.g * gain, colour.b * gain, alpha);
    this.shapes.setXY(i, seed, stretch);
  }
  get instances(): number {
    return this.count;
  }
  end(): void {
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.instanceCount = this.count;
    if (this.count === 0) return;
    for (const attr of [this.centres, this.colours, this.shapes]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    releaseEffectMaterial(this.mesh.material);
  }
}
