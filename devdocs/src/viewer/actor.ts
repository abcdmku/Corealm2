import * as THREE from 'three';
import type { SemanticEntity } from '../../../game/src/contracts.js';
import type { AssetRegistry } from '../../../game/src/render/assets.js';
import { EntityViews } from '../../../game/src/render/entityViews.js';
import { MaterialLibrary } from '../../../game/src/render/materials.js';
import { viewerRegistry } from './registry.js';
import { creatureClipGroups, initialCreatureClip } from './clips.js';
import { actorSpec, crowdLayout } from './actorEntity.js';
import { cloneNodeMaterial } from '../../../game/src/render/nodeMaterials.js';
import { tierSilhouetteScale } from '../../../game/src/core/math.js';
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
 * Game actors on a stage of their own: the production `EntityViews` with one entity at the origin,
 * or a crowd of individuals in rows. Owned by one model; `dispose` tears down its rigs, batches,
 * tinted materials and draft maps. The first entity is the one probed, played back and reported.
 */
export class ActorStage {
  readonly scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  readonly views: EntityViews;
  readonly entities: SemanticEntity[];
  private readonly draftMaps: DraftMaps;

  constructor(readonly assets: AssetRegistry, entities: SemanticEntity | readonly SemanticEntity[], maps?: Record<string, string>) {
    this.entities = (Array.isArray(entities) ? entities : [entities]).map(entity => structuredClone(entity));
    // Every individual gets a live rig: the crowd is small and all of it is on screen.
    const rigs = this.entities.length + 1;
    this.views = new EntityViews(this.scene, assets, viewerMaterials(), { maxUniqueViews: rigs, maxUniqueDrawCalls: 100_000, maxAnimatedViews: rigs });
    this.draftMaps = new DraftMaps(maps ?? {});
  }

  get entity(): SemanticEntity { return this.entities[0]!; }

  /** Loads the model, lays the crowd out by its footprint, and builds the live rigs. */
  async build(): Promise<void> {
    const [prepared] = await Promise.all([this.views.prepare(this.entities), this.draftMaps.load()]);
    if (prepared.missing.length) throw new Error(`Missing model ${prepared.missing.join(', ')}`);
    if (this.entities.length > 1) this.layOut();
    this.views.updateActiveArea([0, 0, 0], 50);
    this.views.sync(this.entities);
    this.views.update(0, ORIGIN);
    for (const entity of this.entities) if (!this.views.has(entity.id)) throw new Error(`EntityViews did not draw ${entity.id}`);
    this.draftMaps.apply(this.scene.entityGroup);
  }

  /** Rows facing the camera, one footprint of the largest individual (plus a gap) apart. */
  private layOut(): void {
    const size = this.assets.entry(this.entity.view!.assetId)?.size;
    const largest = Math.max(...this.entities.map(entity => (entity.view!.scale ?? 1) * tierSilhouetteScale(entity.tier ?? 1)));
    const footprint = size ? Math.max(size.x, size.z) * largest : largest;
    const slots = crowdLayout(this.entities.length, Math.max(footprint * 1.2, .3));
    this.entities.forEach((entity, index) => { const [x, z] = slots[index]!; entity.position = [x, 0, z]; });
  }

  snapshot(id = this.entity.id) { return this.views.motionSnapshot(id); }
  update(dt: number): void {
    this.views.update(dt, ORIGIN);
    this.draftMaps.apply(this.scene.entityGroup);
  }

  setAlive(alive: boolean): void {
    const state = alive ? 'alive' : 'dead';
    if (this.entity.state === state) return;
    for (const entity of this.entities) entity.state = state;
    this.views.sync(this.entities);
    this.draftMaps.apply(this.scene.entityGroup);
  }

  /** Locomotion intent for every individual, re-sent even when unchanged so a revived actor takes it again. The answer is the first's. */
  locomote(motion: 'idle' | 'walk' | 'run'): boolean {
    return this.entities.map(entity => this.locomoteOne(entity.id, motion))[0]!;
  }

  /** An action for every individual; the answer is the first's. */
  playAction(action: 'attack' | 'hit', options?: Parameters<EntityViews['playAction']>[2]): boolean {
    return this.entities.map(entity => this.views.playAction(entity.id, action, options))[0]!;
  }

  private locomoteOne(id: string, motion: 'idle' | 'walk' | 'run'): boolean {
    this.views.clearLocomotion(id);
    return this.views.setLocomotion(id, motion);
  }

  /** Every individual's current bounds in stage space, together. Instanced fallback batches are not the actors. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const entity of this.entities) {
      const drawn = this.views.drawnBounds(entity.id, true);
      if (drawn) box.union(new THREE.Box3(new THREE.Vector3(...drawn.min), new THREE.Vector3(...drawn.max)));
    }
    return box;
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
      const played = this.locomoteOne(id, motion);
      const clip = played ? this.snapshot()?.clip ?? null : null;
      // `run` on a rig with no run cycle is its walk, which the game plays; say so.
      const fallback = motion === 'run' && clip !== null && clip === states.get('walk')?.clip && !/run/i.test(clip);
      states.set(motion, { name: motion, clip, available: clip !== null, ...(fallback ? { synthetic: true } : {}) });
    }
    this.locomoteOne(id, 'idle');
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
    this.locomoteOne(id, 'idle');
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
      if (tint || !mesh.isMesh || !mesh.visible || !this.ownedByFirst(mesh)) return;
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

  /** Whether a drawn mesh stands nearest the first individual, the one the stage reports on. */
  private ownedByFirst(mesh: THREE.Object3D): boolean {
    if (this.entities.length === 1) return true;
    const at = this.scene.entityGroup.worldToLocal(mesh.getWorldPosition(new THREE.Vector3()));
    const distance = (entity: SemanticEntity) => (entity.position[0] - at.x) ** 2 + (entity.position[2] - at.z) ** 2;
    return this.entities.every(entity => distance(this.entity) <= distance(entity));
  }

  dispose(): void {
    this.views.dispose();
    this.draftMaps.dispose();
    this.scene.entityGroup.removeFromParent();
  }
}

/**
 * Albedo maps not yet saved as a skin, drawn on the stage's actors. Each material that names one is
 * swapped for a stage-local clone carrying the draft map, so the scene library's shared materials,
 * other records and thumbnails never see it. Re-applied after every sync and frame, because
 * EntityViews may hand a mesh a fresh library material (death, a rig rebuild).
 */
class DraftMaps {
  private readonly images = new Map<string, ImageBitmap>();
  /** Source map -> the draft texture that stands in for it. */
  private readonly textures = new Map<THREE.Texture, THREE.Texture>();
  private readonly drafts = new Set<THREE.Texture>();
  private readonly clones = new Map<THREE.Material, THREE.Material>();

  constructor(private readonly urls: Record<string, string>) {}

  async load(): Promise<void> {
    await Promise.all(Object.entries(this.urls).map(async ([material, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Draft map for ${material} failed: ${response.status}`);
      // The options the game's asset loader decodes with, so the draft draws as a saved skin would.
      this.images.set(material, await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
    }));
  }

  apply(root: THREE.Object3D): void {
    if (!this.images.size) return;
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (Array.isArray(mesh.material)) {
        const next = mesh.material.map(material => this.draft(material));
        if (next.some((material, index) => material !== (mesh.material as THREE.Material[])[index])) mesh.material = next;
      } else mesh.material = this.draft(mesh.material);
    });
  }

  private draft(material: THREE.Material): THREE.Material {
    const map = (material as THREE.MeshStandardMaterial).map;
    // Already a draft (ours, or the viewer's own clone of ours), or nothing to replace.
    if (!map || this.drafts.has(map)) return material;
    const image = this.images.get(material.name.split('@', 1)[0]!);
    if (!image) return material;
    let clone = this.clones.get(material);
    if (!clone) {
      clone = cloneNodeMaterial(material);
      (clone as THREE.MeshStandardMaterial).map = this.texture(map, image);
      clone.needsUpdate = true;
      this.clones.set(material, clone);
    }
    return clone;
  }

  /** The source map's sampling (colour space, flipY, wrap, UV transform) over the draft image. */
  private texture(source: THREE.Texture, image: ImageBitmap): THREE.Texture {
    let texture = this.textures.get(source);
    if (!texture) {
      texture = source.clone();
      // clone() shares the Source; a new one leaves the model's own image untouched.
      texture.source = new THREE.Source(image);
      texture.needsUpdate = true;
      this.textures.set(source, texture);
      this.drafts.add(texture);
    }
    return texture;
  }

  dispose(): void {
    for (const clone of this.clones.values()) clone.dispose();
    for (const texture of this.drafts) texture.dispose();
    for (const image of this.images.values()) image.close();
    this.clones.clear(); this.textures.clear(); this.drafts.clear(); this.images.clear();
  }
}

/** A creature definition as the game draws it, with every motion state playable in place. */
export async function loadActorModel(source: Extract<ViewerSource, { mode: 'actor' }>): Promise<ActorModel> {
  const assets = await viewerRegistry();
  const stage = new ActorStage(assets, actorSpec(source.creatureId, source.draft).entities, source.draft?.maps);
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
    if (name === 'attack') return stage.playAction('attack');
    if (isHit(name)) return stage.playAction('hit', { impactSide: HIT_SIDE[name] });
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
    bounds() { return stage.bounds(); },
    dispose() { stage.dispose(); },
  };
}
