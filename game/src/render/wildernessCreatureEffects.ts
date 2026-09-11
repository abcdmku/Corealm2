import * as THREE from 'three';
import { ElementalParticleCloud } from './elementalParticleCloud.js';

export type WildernessCreaturePalette = 'arcane' | 'ember';

/** Supply living, resident creatures only. Positions use world metres at the actor's feet. */
export interface WildernessCreatureEmitter {
  readonly id: string;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  /** Body size relative to a roughly two-metre creature, rather than its source GLB unit scale. */
  readonly scale?: number;
  readonly hero?: boolean;
  readonly palette?: WildernessCreaturePalette;
}

export interface WildernessCreatureEffectsState {
  ready: boolean;
  enabled: boolean;
  seconds: number;
  emitterBudget: number;
  particleBudget: number;
  liveParticles: number;
  nearbyCandidates: number;
  budgetCulled: number;
  emitters: {
    id: string;
    position: { x: number; y: number; z: number };
    scale: number;
    palette: WildernessCreaturePalette;
    hero: boolean;
    particles: number;
  }[];
}

const EMITTER_LIMIT = 16;
const PARTICLE_LIMIT = 384;
const CULL_DISTANCE = 36;
const FADE_DISTANCE = 24;
const TWO_PI = Math.PI * 2;
const ARCANE_COLOURS = [0x617de8, 0x9060dd, 0x659fc6] as const;
const EMBER_COLOURS = [0xda672c, 0xee8638, 0xae422b] as const;

interface SelectedEmitter {
  actor: WildernessCreatureEmitter | null;
  distanceSquared: number;
  scale: number;
  particles: number;
}

function idSeed(id: string): number {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed >>> 0;
}

function noise(seed: number): number {
  let value = Math.imul(seed ^ seed >>> 16, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

/**
 * Small fragments rise from fissures around the body. Absolute time and stable actor IDs choose
 * their paths, so streaming an actor out and back does not restart a synchronized burst.
 */
export class WildernessCreatureEffects {
  readonly group = new THREE.Group();
  private readonly particles: ElementalParticleCloud;
  private readonly viewer = new THREE.Vector3();
  private readonly projectionView = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly selected: SelectedEmitter[] = Array.from({ length: EMITTER_LIMIT }, () => ({
    actor: null, distanceSquared: Infinity, scale: 1, particles: 0,
  }));
  private selectedCount = 0;
  private nearbyCandidates = 0;
  private seconds = 0;
  private enabled = true;
  private disposed = false;

  constructor(parent: THREE.Object3D) {
    this.group.name = 'wilderness-creature-effects';
    this.particles = new ElementalParticleCloud(this.group, 'light', PARTICLE_LIMIT);
    this.particles.mesh.name = 'wilderness-creature-fissure-fragments';
    // These faint fragments use the existing 3D shape but do not keep the full-scene HDR bloom
    // pass active during ordinary exploration. The creatures' authored veins supply body light.
    this.particles.mesh.userData['magicGlow'] = false;
    this.particles.mesh.userData['magicGlowOnly'] = false;
    this.particles.end();
    parent.add(this.group);
  }

  update(seconds: number, camera: THREE.Camera, actors: readonly WildernessCreatureEmitter[]): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    this.seconds = seconds;
    if (!this.enabled) return;
    this.selectedCount = 0;
    this.nearbyCandidates = 0;
    camera.getWorldPosition(this.viewer);
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    // Insertion into sixteen reusable slots avoids sorting or retaining the world actor list.
    for (const actor of actors) {
      const { x, y, z } = actor.position;
      if (!actor.id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const scale = Number.isFinite(actor.scale) ? Math.max(.4, Math.min(5, actor.scale!)) : 1;
      const dx = x - this.viewer.x, dy = y - this.viewer.y, dz = z - this.viewer.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared >= CULL_DISTANCE * CULL_DISTANCE) continue;
      this.sphere.center.set(x, y + 1.25 * scale, z);
      this.sphere.radius = 2 * scale;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      let duplicate = false;
      for (let i = 0; i < this.selectedCount; i++) {
        if (this.selected[i]!.actor!.id === actor.id) { duplicate = true; break; }
      }
      if (duplicate) continue;
      this.nearbyCandidates++;
      let index = this.selectedCount;
      for (let i = 0; i < this.selectedCount; i++) {
        const row = this.selected[i]!;
        if (distanceSquared < row.distanceSquared
          || (distanceSquared === row.distanceSquared && actor.id < row.actor!.id)) {
          index = i;
          break;
        }
      }
      if (index >= EMITTER_LIMIT) continue;
      const slot = this.selected[Math.min(this.selectedCount, EMITTER_LIMIT - 1)]!;
      for (let i = Math.min(this.selectedCount, EMITTER_LIMIT - 1); i > index; i--) {
        this.selected[i] = this.selected[i - 1]!;
      }
      slot.actor = actor;
      slot.distanceSquared = distanceSquared;
      slot.scale = scale;
      slot.particles = 0;
      this.selected[index] = slot;
      this.selectedCount = Math.min(EMITTER_LIMIT, this.selectedCount + 1);
    }

    this.particles.begin(seconds);
    for (let i = 0; i < this.selectedCount; i++) this.emit(this.selected[i]!, seconds);
    this.particles.end();
    // Release actor references when the next set has fewer occupants.
    for (let i = this.selectedCount; i < EMITTER_LIMIT; i++) this.selected[i]!.actor = null;
  }

  private emit(row: SelectedEmitter, seconds: number): void {
    const actor = row.actor!;
    const seed = idSeed(actor.id);
    const count = actor.hero ? 24 : 18;
    const colours = actor.palette === 'ember' ? EMBER_COLOURS : ARCANE_COLOURS;
    const distanceFade = Math.min(1, (CULL_DISTANCE - Math.sqrt(row.distanceSquared))
      / (CULL_DISTANCE - FADE_DISTANCE));
    const before = this.particles.instances;
    for (let index = 0; index < count; index++) {
      const particleSeed = (seed + Math.imul(index + 1, 2654435761)) >>> 0;
      const lifetime = 1.8 + noise(particleSeed + 11) * 1.5;
      const phase = seconds / lifetime + noise(particleSeed + 23);
      const age = phase - Math.floor(phase);
      const cycleSeed = (particleSeed + Math.imul(Math.floor(phase), 2246822519)) >>> 0;
      const angle = noise(cycleSeed + 31) * TWO_PI;
      const radius = .35 + noise(cycleSeed + 41) * .3;
      // The birth sites change only between lifetimes. Drift is linear and rising, never an orbit.
      const driftX = (noise(cycleSeed + 53) - .5) * .45 * age;
      const driftZ = (noise(cycleSeed + 67) - .5) * .45 * age;
      const x = actor.position.x + (Math.cos(angle) * radius + driftX) * row.scale;
      const z = actor.position.z + (Math.sin(angle) * radius * .8 + driftZ) * row.scale;
      const y = actor.position.y + (.28 + noise(cycleSeed + 79) * 1.1 + age * .8) * row.scale;
      const envelope = Math.min(1, age / .16) * Math.pow(1 - age, 1.5);
      const alpha = envelope * distanceFade * (actor.hero ? .7 : .5);
      const size = (.105 + noise(particleSeed + 89) * .08) * Math.sqrt(row.scale)
        * (actor.hero ? 1.16 : 1) * (.8 + .2 * envelope);
      this.particles.put(x, y, z, size, colours[index % colours.length]!, alpha,
        noise(particleSeed + 97) * TWO_PI, 1.6 + noise(particleSeed + 101), actor.hero ? .24 : .18);
    }
    row.particles = this.particles.instances - before;
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    this.group.visible = enabled;
    if (!enabled) this.clear();
  }

  private clear(): void {
    this.selectedCount = 0;
    this.nearbyCandidates = 0;
    for (const row of this.selected) { row.actor = null; row.particles = 0; }
    this.particles.begin(this.seconds);
    this.particles.end();
  }

  getState(): WildernessCreatureEffectsState {
    return {
      ready: !this.disposed, enabled: this.enabled, seconds: this.seconds,
      emitterBudget: EMITTER_LIMIT, particleBudget: PARTICLE_LIMIT,
      liveParticles: this.particles.instances, nearbyCandidates: this.nearbyCandidates,
      budgetCulled: Math.max(0, this.nearbyCandidates - this.selectedCount),
      emitters: this.selected.slice(0, this.selectedCount).map(({ actor, scale, particles }) => ({
        id: actor!.id, position: { ...actor!.position }, scale,
        palette: actor!.palette ?? 'arcane', hero: !!actor!.hero, particles,
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.enabled = false;
    this.disposed = true;
    this.group.removeFromParent();
    this.particles.dispose();
  }
}
