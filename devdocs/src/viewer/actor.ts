import * as THREE from 'three';
import type { SemanticEntity } from '../../../game/src/contracts.js';
import type { AssetRegistry } from '../../../game/src/render/assets.js';
import { EntityViews } from '../../../game/src/render/entityViews.js';
import { MaterialLibrary } from '../../../game/src/render/materials.js';
import { viewerRegistry } from './registry.js';
import { creatureClipGroups, initialCreatureClip } from './clips.js';
import { actorSpec } from './actorEntity.js';
import { CREATURE_STATES, type CreatureState, type ViewerAppearance, type ViewerModel, type ViewerSource, type ViewerStateInfo } from './types.js';

/** What the core reads off a model that plays itself: the clip on screen and its clock. */
export interface ActorPlayback { clip: string | null; time: number; duration: number }
/** A `ViewerModel` driven by the game's `EntityViews` rather than the core's mixer. */
export interface ActorModel extends ViewerModel {
  playback(): ActorPlayback;
  /** The drawn actor's current bounds in stage space. Its instanced fallback batches are not the actor. */
  bounds(): THREE.Box3;
}
export function isActorModel(model: ViewerModel): model is ActorModel { return 'playback' in model; }

const ORIGIN = new THREE.Vector3();
/** Seconds of idle between repeats of a one-shot state, so a reviewer sees attack and hit again and again. */
const REPLAY_GAP = .7;
const HIT_SIDE = { hit: 'front', hitLeft: 'left', hitRight: 'right' } as const;
type HitState = keyof typeof HIT_SIDE;
const isHit = (state: string): state is HitState => state in HIT_SIDE;

let library: MaterialLibrary | undefined;
/** Tier variants and dead-state materials are cached here across records, like the game's one scene library. */
function viewerMaterials(): MaterialLibrary { return library ??= new MaterialLibrary(); }

/**
 * One game actor on a stage of its own: the production `EntityViews` with an entity at the origin.
 * Owned by one model; `dispose` tears down its rig, batches and tinted materials.
 */
export class ActorStage {
  readonly scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  readonly views: EntityViews;
  readonly entity: SemanticEntity;

  constructor(readonly assets: AssetRegistry, entity: SemanticEntity) {
    this.entity = structuredClone(entity);
    this.views = new EntityViews(this.scene, assets, viewerMaterials(), { maxUniqueViews: 2, maxUniqueDrawCalls: 100_000, maxAnimatedViews: 2 });
  }

  /** Loads the model and builds its live rig. */
  async build(): Promise<void> {
    const prepared = await this.views.prepare([this.entity]);
    if (prepared.missing.length) throw new Error(`Missing model ${prepared.missing.join(', ')}`);
    this.views.updateActiveArea([0, 0, 0], 50);
    this.views.sync([this.entity]);
    this.views.update(0, ORIGIN);
    if (!this.views.has(this.entity.id)) throw new Error(`EntityViews did not draw ${this.entity.id}`);
  }

  snapshot() { return this.views.motionSnapshot(this.entity.id); }
  update(dt: number): void { this.views.update(dt, ORIGIN); }

  setAlive(alive: boolean): void {
    const state = alive ? 'alive' : 'dead';
    if (this.entity.state === state) return;
    this.entity.state = state;
    this.views.sync([this.entity]);
  }

  /** Locomotion intent, re-sent even when unchanged so a revived actor takes it again. */
  locomote(motion: 'idle' | 'walk' | 'run'): boolean {
    this.views.clearLocomotion(this.entity.id);
    return this.views.setLocomotion(this.entity.id, motion);
  }

  /**
   * Every creature state as this rig plays it. Walk, run, attack and hit are asked of EntityViews
   * itself (the clip it would choose, or none), then the actor is settled back on idle.
   */
  probeStates(): ViewerStateInfo[] {
    const id = this.entity.id;
    const idle = this.snapshot()?.clip ?? null;
    const states = new Map<CreatureState, ViewerStateInfo>();
    states.set('idle', { name: 'idle', clip: idle, available: idle !== null });
    for (const motion of ['walk', 'run'] as const) {
      const played = this.locomote(motion);
      const clip = played ? this.snapshot()?.clip ?? null : null;
      // `run` on a rig with no run cycle is its walk, which the game plays; say so.
      const fallback = motion === 'run' && clip !== null && clip === states.get('walk')?.clip && !/run/i.test(clip);
      states.set(motion, { name: motion, clip, available: clip !== null, ...(fallback ? { synthetic: true } : {}) });
    }
    this.locomote('idle');
    const attack = this.views.playAction(id, 'attack') ? this.snapshot()?.clip ?? null : null;
    states.set('attack', { name: 'attack', clip: attack, available: attack !== null });
    this.views.cancelAttack(id);
    const front = this.hitClip('front');
    for (const [name, side] of Object.entries(HIT_SIDE) as [HitState, typeof HIT_SIDE[HitState]][]) {
      const clip = side === 'front' ? front : this.hitClip(side);
      // A procedural recoil (`missingCreatureHit`) or a side falling back to the front hit.
      const synthetic = clip !== null && (clip === 'Hit_Fallback' || (side !== 'front' && clip === front));
      states.set(name, { name, clip, available: clip !== null, ...(synthetic ? { synthetic: true } : {}) });
    }
    const death = this.deathClip();
    // Without a death clip the game freezes the last pose instead of falling.
    states.set('death', { name: 'death', clip: death, available: true, ...(death ? {} : { synthetic: true }) });
    this.locomote('idle');
    this.update(0);
    return CREATURE_STATES.map(name => states.get(name)!);
  }

  private hitClip(side: 'front' | 'left' | 'right'): string | null {
    if (!this.views.playAction(this.entity.id, 'hit', { impactSide: side })) return null;
    const overlay = this.snapshot()?.hitOverlay;
    // Let the overlay run out so the next probe (and the first frame) starts clean.
    if (overlay) this.update(overlay.duration + .05);
    return overlay ? overlay.clip.replace(/_MaskedOverlay$/, '') : null;
  }

  /** The asset's own death clip if it fits, or the humanoid library's; EntityViews picks the same. */
  private deathClip(): string | null {
    const assetId = this.entity.view!.assetId;
    const own = this.assets.entry(assetId)?.animations ?? [];
    if (own.length) return own.find(name => /^death/i.test(name)) ?? null;
    return this.assets.clip('Death01') ? 'Death01' : null;
  }

  /** The dye and tier colour the game multiplied into this actor's materials, as `#rrggbb`, or null. */
  async measuredTint(): Promise<string | null> {
    const source = await this.assets.load(this.entity.view!.assetId);
    const authored = new Map<string, THREE.Color>();
    source.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const color = (material as THREE.MeshStandardMaterial).color;
        if (color && !authored.has(material.name)) authored.set(material.name, color);
      }
    });
    let tint: string | null = null;
    this.scene.entityGroup.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (tint || !mesh.isMesh || !mesh.visible) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const drawn = (material as THREE.MeshStandardMaterial).color;
        const base = authored.get(material.name);
        if (!drawn || !base || drawn.equals(base)) continue;
        const ratio = (d: number, b: number) => b > 1e-4 ? Math.min(1, d / b) : d;
        tint = `#${new THREE.Color(ratio(drawn.r, base.r), ratio(drawn.g, base.g), ratio(drawn.b, base.b)).getHexString()}`;
        return;
      }
    });
    return tint;
  }

  dispose(): void {
    this.views.dispose();
    this.scene.entityGroup.removeFromParent();
  }
}

/** A creature definition as the game draws it, with every motion state playable in place. */
export async function loadActorModel(source: Extract<ViewerSource, { mode: 'actor' }>): Promise<ActorModel> {
  const assets = await viewerRegistry();
  const stage = new ActorStage(assets, actorSpec(source.creatureId).entity);
  try {
    await stage.build();
    return await actorModel(stage, source.creatureId);
  } catch (error) { stage.dispose(); throw error; }
}

/** The viewer model over a built stage. The model owns the stage from here on. */
export async function actorModel(stage: ActorStage, creatureId: string): Promise<ActorModel> {
  const { assets, entity } = stage;
  const states = stage.probeStates();
  const motion = stage.snapshot();
  const assetId = entity.view!.assetId;
  const appearance: ViewerAppearance = {
    creatureId, assetId, scale: motion?.drawnStrideScale ?? entity.view!.scale ?? 1, tint: await stage.measuredTint(),
  };
  const clips = assets.clipsOf(assetId);
  const names = clips.map(clip => clip.name);
  let current: string = 'idle';
  let replayIn = Infinity;
  const trigger = (name: string): boolean => {
    if (name === 'death') { stage.setAlive(true); stage.locomote('idle'); stage.update(0); stage.setAlive(false); return true; }
    stage.setAlive(true);
    if (name === 'idle' || name === 'walk' || name === 'run') return stage.locomote(name);
    stage.locomote('idle');
    if (name === 'attack') return stage.views.playAction(entity.id, 'attack');
    if (isHit(name)) return stage.views.playAction(entity.id, 'hit', { impactSide: HIT_SIDE[name] });
    return false;
  };
  return {
    root: stage.scene.entityGroup, animationRoot: stage.scene.entityGroup, clips, clipGroups: creatureClipGroups(names),
    initialClip: initialCreatureClip(names), manifestSize: assets.entry(assetId)?.size, parts: [], attachments: [], missingBones: [],
    appearance, states, initialState: 'idle',
    setState(name) {
      current = name;
      replayIn = Infinity;
      trigger(name);
      stage.update(0);
      return true;
    },
    update(dt) {
      stage.update(dt);
      // Attack and hit loop: once the one-shot has finished, idle for REPLAY_GAP and play it again.
      if (current !== 'attack' && !isHit(current)) return;
      const snapshot = stage.snapshot();
      const busy = current === 'attack' ? snapshot?.motion === 'attack' : Boolean(snapshot?.hitOverlay);
      if (busy) { replayIn = Infinity; return; }
      if (replayIn === Infinity) replayIn = REPLAY_GAP;
      replayIn -= dt;
      if (replayIn <= 0) { replayIn = Infinity; trigger(current); stage.update(0); }
    },
    playback() {
      const snapshot = stage.snapshot();
      const overlay = snapshot?.hitOverlay;
      if (overlay && isHit(current)) return { clip: overlay.clip, time: overlay.time, duration: overlay.duration };
      return { clip: snapshot?.clip ?? null, time: snapshot?.time ?? 0, duration: snapshot?.duration ?? 0 };
    },
    bounds() {
      const drawn = stage.views.drawnBounds(entity.id, true);
      return drawn ? new THREE.Box3(new THREE.Vector3(...drawn.min), new THREE.Vector3(...drawn.max)) : new THREE.Box3();
    },
    dispose() { stage.dispose(); },
  };
}
