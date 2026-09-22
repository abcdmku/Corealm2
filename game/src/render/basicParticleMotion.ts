import * as THREE from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, cos, float, max, mix, reference, sin, vec3, vec4 } from 'three/tsl';
import type { SpellElement, Vec3 } from '../contracts.js';
import type { ElementalCast } from '../systems/elementalAttacks.js';
import { BASIC_SPELL_VARIANTS } from '../content/basicSpellVariants.js';
import { ELEMENTAL_ENERGY } from './elementalEnergyStyles.js';
import { acquireParticleMaterial, particleGeometry, type ParticleMaterialInputs } from './particleMaterial.js';
import { releaseEffectMaterial } from './sharedEffectMaterial.js';

type Phase = 'flight' | 'impact';
const maxDensity = Math.max(...Object.values(BASIC_SPELL_VARIANTS).map(value => value.particles));
const capacities = { flight: Math.round(180 * maxDensity), impact: Math.round(320 * maxDensity) };
const random = (i: number, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const elements: Record<SpellElement, number> = { wind: 0, earth: 1, water: 2, fire: 3 };

/** Prefix range queries count the live candidates in O(log² capacity), without scanning particles. */
class PhaseCounts {
  private readonly size: number;
  private readonly sorted: number[][];
  constructor(values: readonly number[]) {
    this.size = 2 ** Math.ceil(Math.log2(values.length));
    this.sorted = Array.from({ length: this.size * 2 }, () => []);
    values.forEach((value, index) => { this.sorted[this.size + index] = [value]; });
    for (let index = this.size - 1; index > 0; index--)
      this.sorted[index] = [...this.sorted[index * 2]!, ...this.sorted[index * 2 + 1]!].sort((a, b) => a - b);
  }
  count(prefix: number, threshold: number): number {
    let left = this.size, right = this.size + prefix, count = 0;
    const below = (values: readonly number[]) => {
      let lo = 0, hi = values.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid]! <= threshold) lo = mid + 1; else hi = mid; }
      return lo;
    };
    while (left < right) {
      if (left & 1) count += below(this.sorted[left++]!);
      if (right & 1) count += below(this.sorted[--right]!);
      left >>= 1; right >>= 1;
    }
    return count;
  }
}

let phases: { flight: PhaseCounts; impact: PhaseCounts } | undefined;
function phaseCounts() {
  return phases ??= {
    flight: new PhaseCounts(Array.from({ length: capacities.flight }, (_, index) => random(index) * .14)),
    impact: new PhaseCounts(Array.from({ length: capacities.impact }, (_, index) => -(1 - random(index, 8) * .5))),
  };
}

/** The two shared graphs resolve cast uniforms and immutable seed attributes from each draw. */
export function basicParticleInputs(phase: Phase): ParticleMaterialInputs {
  const motion = attribute('basicMotion', 'vec4' as const), shape = attribute('basicShape', 'vec4' as const);
  const fireColor = attribute('basicFireColor', 'vec3' as const), weight = attribute('basicWeight', 'float' as const);
  const timing = reference('userData.basicParticle.timing', 'vec4', null);
  const release = reference('userData.basicParticle.release', 'vec4', null);
  const impact = reference('userData.basicParticle.impact', 'vec3', null);
  const basis = reference('userData.basicParticle.basis', 'vec2', null);
  const edge = reference('userData.basicParticle.edge', 'color', null);
  const core = reference('userData.basicParticle.core', 'color', null);
  const element = reference('userData.basicParticle.element', 'float', null);
  const gain = reference('userData.basicParticle.energyGain', 'float', null);
  const age = timing.x, local = age.sub(timing.z);
  const fire = element.equal(3), wind = element.equal(0);
  if (phase === 'flight') {
    const u = age.sub(timing.y).div(timing.z.sub(timing.y)).clamp(0, 1);
    const raw = u.sub(motion.x), v = raw.clamp(0, 1);
    const path = mix(release.xyz, impact, v).add(vec3(0, release.w.mul(4).mul(v).mul(float(1).sub(v)), 0));
    const angle = motion.y.add(age.mul(15)), radial = cos(angle).mul(motion.z);
    const centre = path.add(vec3(basis.y.mul(radial), sin(angle).mul(motion.z), basis.x.negate().mul(radial)));
    const energy = wind.or(fire).select(1.1, 1.7).mul(gain);
    const tint = fire.select(fireColor, mix(edge, core, weight)).mul(energy);
    return { centre: vec4(centre, motion.w), tint: vec4(tint, raw.greaterThanEqual(0).select(.7, 0)), shape };
  }
  const distance = local.mul(motion.y);
  const rising = impact.y.add(local.mul(motion.z.mul(1.5).add(.3)));
  const falling = max(timing.w.add(.03), impact.y.add(local.mul(motion.z.mul(2))).sub(local.mul(local).mul(3.8)));
  const centre = vec3(impact.x.add(cos(motion.x).mul(distance)), fire.select(rising, falling), impact.z.add(sin(motion.x).mul(distance)));
  const fadeTime = local.div(.88).clamp(0, 1);
  const fade = float(1).sub(fadeTime.mul(fadeTime).mul(float(3).sub(fadeTime.mul(2))));
  const energy = wind.select(1, fire.select(1.1, 1.8)).mul(gain);
  return { centre: vec4(centre, motion.w), tint: vec4(fire.select(fireColor, edge).mul(energy), fade.mul(weight)), shape };
}

function seedGeometry(phase: Phase): THREE.InstancedBufferGeometry {
  const geometry = particleGeometry('light'), capacity = capacities[phase];
  const motion = new Float32Array(capacity * 4), shape = new Float32Array(capacity * 4);
  const fire = new Float32Array(capacity * 3), weights = new Float32Array(capacity);
  const dark = new THREE.Color(phase === 'flight' ? 0xc43b08 : 0xc73a09), hot = new THREE.Color(0xffb654);
  for (let index = 0; index < capacity; index++) {
    motion.set(phase === 'flight'
      ? [random(index) * .14, random(index, 1) * Math.PI * 2, .035 + random(index, 2) * .10, .014 + random(index, 3) * .019]
      : [random(index, 4) * Math.PI * 2, .5 + random(index, 5) * 2, random(index, 6), .013 + random(index, 7) * .020], index * 4);
    shape.set([index * .71, .55 + Math.abs(Math.sin(index * 3)) * .6, phase === 'flight' ? 1.2 : 1.3, index], index * 4);
    (index % (phase === 'flight' ? 9 : 11) ? dark : hot).toArray(fire, index * 3);
    weights[index] = phase === 'flight' ? Number(index % 5 === 0) : 1 - random(index, 8) * .5;
  }
  for (const [name, values, width] of [['basicMotion', motion, 4], ['basicShape', shape, 4],
    ['basicFireColor', fire, 3], ['basicWeight', weights, 1]] as const)
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(values, width).setUsage(THREE.StaticDrawUsage));
  return geometry;
}

/** Static candidates move on the GPU; the CPU publishes only one cast's uniforms and draw counts. */
export class BasicParticleMotion {
  readonly meshes: Record<Phase, THREE.Mesh<THREE.InstancedBufferGeometry, MeshBasicNodeMaterial>>;
  private readonly clock = { value: 0 };
  private readonly state = { timing: new THREE.Vector4(), release: new THREE.Vector4(), impact: new THREE.Vector3(),
    basis: new THREE.Vector2(), edge: new THREE.Color(), core: new THREE.Color(), element: 0, energyGain: 1 };
  private readonly counts = phaseCounts();
  private disposed = false;
  liveCount = 0;
  dropped = 0;
  constructor(parent: THREE.Object3D) {
    const make = (phase: Phase) => {
      const material = acquireParticleMaterial('light', `basic-${phase}`, () => basicParticleInputs(phase));
      const mesh = new THREE.Mesh(seedGeometry(phase), material);
      mesh.name = `elemental-basic-${phase}-particles`;
      mesh.userData.effectClock = this.clock; mesh.userData.basicParticle = this.state;
      mesh.userData.magicGlow = true; mesh.userData.magicGlowOnly = true;
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 11; parent.add(mesh);
      return mesh;
    };
    this.meshes = { flight: make('flight'), impact: make('impact') };
  }
  begin(seconds: number, energyGain = 1): void {
    this.clock.value = seconds; this.state.energyGain = energyGain; this.liveCount = this.dropped = 0;
    for (const mesh of Object.values(this.meshes)) { mesh.visible = false; mesh.geometry.instanceCount = 0; }
  }
  update(cast: ElementalCast, now: number, element: SpellElement, release: Vec3, impact: Vec3,
    fx: number, fz: number, groundY: number): void {
    const age = now - cast.started, pulse = cast.pulses[0]!, local = (age - pulse.at) / 1000;
    if (age < 0 || local > .92) return;
    const palette = ELEMENTAL_ENERGY[cast.spellId], phase = local < 0 ? 'flight' : 'impact';
    this.state.timing.set(age / 1000, (cast.releaseAt ?? 100) / 1000, pulse.at / 1000, groundY);
    this.state.release.set(...release, Math.min(4.5, Math.hypot(impact[0] - release[0], impact[2] - release[2]) * .24));
    this.state.impact.set(...impact); this.state.basis.set(fx, fz);
    this.state.edge.setHex(palette.edge); this.state.core.setHex(palette.core); this.state.element = elements[element];
    const requested = Math.max(0, Math.round((phase === 'flight' ? 180 : cast.missed ? 32 : 320) * (cast.particleScale ?? 1)));
    const candidates = Math.min(requested, capacities[phase]);
    this.dropped = Math.max(0, requested - candidates);
    const u = clamp((age - (cast.releaseAt ?? 100)) / (pulse.at - (cast.releaseAt ?? 100)));
    const fade = 1 - smooth(local / .88);
    this.liveCount = phase === 'flight' ? this.counts.flight.count(candidates, u)
      : fade > 0 ? this.counts.impact.count(candidates, -.006 / fade) : 0;
    const mesh = this.meshes[phase]; mesh.visible = this.liveCount > 0; mesh.geometry.instanceCount = candidates;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const mesh of Object.values(this.meshes)) { mesh.removeFromParent(); mesh.geometry.dispose(); releaseEffectMaterial(mesh.material); }
  }
}
