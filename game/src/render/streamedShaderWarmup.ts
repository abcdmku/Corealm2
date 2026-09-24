import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { COVERED_PIPELINE_CONCURRENCY, isPreparedScenery, prepareShaderMeshes, ShaderPreparationError } from "./shaderPreparation.js";
import { GameplayWork } from "./gameplayWork.js";
import { yieldToMainThread } from "../core/yield.js";

// Native preparation seeds unknown scenery layouts alone, then groups at most eight cached
// clusters within its upload byte budget. A larger outer job amortizes the live light index.
const DRAIN_BATCH_SIZE = 32;
const COVERED_DRAIN_BATCH_SIZE = 256;

const isActorMesh = (object: THREE.Object3D): boolean =>
  object.userData.deferFirstDraw === true || object.userData.sampledActor === true;

const describe = (object: THREE.Object3D): string => {
  const material = (object as THREE.Mesh).material;
  const materials = (Array.isArray(material) ? material : [material]).filter(Boolean)
    .map(material => material.name || material.type).join(", ");
  return `${object.name || object.type} (${materials || "no material"})`;
};

/** Prepare newly resident pipelines and uploads before their first gameplay draw. */
export class StreamedShaderWarmup {
  /** A covered destination may defer new actors; ordinary play must keep actors visible. */
  deferGameplayDraws = false;
  private readonly waiting = new Set<THREE.Object3D>();
  private readonly enrolled = new WeakSet<THREE.Object3D>();
  private readonly pendingRoots = new Map<THREE.Object3D, number>();
  private readonly pendingAncestors = new Map<THREE.Object3D, THREE.Object3D[]>();
  private readonly queued = new Set<THREE.Object3D>();
  /** Objects of a failed batch, each prepared again alone to find which of them failed. */
  private readonly retrying = new Set<THREE.Object3D>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly hidden: THREE.Object3D[] = [];
  /** Failed alone or by their own pipeline. Never drawn until they leave the scene and return. */
  private readonly failed = new Map<THREE.Object3D, string>();
  private pending = false;
  private scheduled = false;
  private lastFrameAt = 0;
  private readonly pacing = new GameplayWork();
  private pendingTextures = 0;
  private disposed = false;
  private readonly added = (event: { child: THREE.Object3D }) => this.watch(event.child, true);
  private readonly removed = (event: { child: THREE.Object3D }) => {
    event.child.traverse(object => {
      this.watched.delete(object);
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
      this.queued.delete(object);
      this.retrying.delete(object);
      this.failed.delete(object);
      this.releaseWaiting(object);
    });
  };

  constructor(private renderer: WebGPURenderer, private scene: THREE.Scene, private camera: THREE.Camera,
    private renderTarget?: THREE.RenderTarget | null) {
    // Existing meshes were covered by startup warmup. Listen before background residency expands.
    this.pacing.setInteractive(true);
    this.watch(scene, false);
  }

  private isDrawable(object: THREE.Object3D): boolean {
    const drawable = object as THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite;
    return drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite;
  }

  /** Queue attached hidden interiors before revealing them. */
  enqueue(root: THREE.Object3D): void {
    if (this.disposed) return;
    root.traverse(object => {
      if (!this.isDrawable(object) || this.enrolled.has(object)) return;
      this.enroll(object);
    });
    this.scheduleNext();
  }

  private watch(root: THREE.Object3D, enqueue: boolean): void {
    root.traverse(object => {
      if (this.watched.has(object)) return;
      this.watched.add(object);
      object.addEventListener("childadded", this.added);
      object.addEventListener("childremoved", this.removed);
      if (enqueue && this.isDrawable(object)) {
        for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
          if (ancestor.userData.prewarmedInputFeedback === true) return;
        }
        this.enroll(object);
      }
    });
    if (enqueue) this.scheduleNext();
  }

  private enroll(object: THREE.Object3D): void {
    // Under cover, a cluster of an already compiled scenery layout just draws: its first
    // frame uploads its buffers behind the curtain, instead of a queued batch per cluster.
    if (this.deferGameplayDraws && !this.waiting.has(object) && isPreparedScenery(this.renderer, object)) return;
    this.addWaiting(object);
    this.queued.add(object);
  }

  private addWaiting(object: THREE.Object3D): void {
    if (this.waiting.has(object)) return;
    this.enrolled.add(object);
    this.waiting.add(object);
    const ancestors: THREE.Object3D[] = [];
    for (let root: THREE.Object3D | null = object; root; root = root.parent) {
      ancestors.push(root);
      this.pendingRoots.set(root, (this.pendingRoots.get(root) ?? 0) + 1);
    }
    this.pendingAncestors.set(object, ancestors);
  }

  private releaseWaiting(object: THREE.Object3D): void {
    if (!this.waiting.delete(object)) return;
    // childremoved arrives after detachment, so retain ancestry from enrollment.
    for (const root of this.pendingAncestors.get(object) ?? []) {
      const count = (this.pendingRoots.get(root) ?? 1) - 1;
      if (count) this.pendingRoots.set(root, count);
      else this.pendingRoots.delete(root);
    }
    this.pendingAncestors.delete(object);
  }

  /** Called before rendering. Each queue has only one asynchronous batch in flight. */
  prepare(): void {
    if (this.disposed) return;
    const now = performance.now();
    if (this.lastFrameAt > 0) this.pacing.reportFrame(now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.scheduleNext();
    for (const object of this.failed.keys()) this.hide(object);
    for (const object of this.waiting) {
      // Gameplay targets stay drawable: a sampled actor pays first-use pipeline work rather than
      // vanishing. Detailed rigs wait (their sampled pose keeps drawing), as does anything covered.
      if (!this.deferGameplayDraws && (object.userData.sampledActor === true
        || object.parent?.userData.keepVisibleDuringWarmup === true)) continue;
      this.hide(object);
    }
  }

  private hide(object: THREE.Object3D): void {
    if (!object.visible) return;
    object.visible = false;
    this.hidden.push(object);
  }

  private scheduleNext(): void {
    if (this.disposed || this.pending || this.scheduled || !(this.queued.size || this.retrying.size)) return;
    this.scheduled = true;
    const start = () => {
      this.scheduled = false;
      if (this.disposed || this.pending || !(this.queued.size || this.retrying.size)) return;
      this.compileNext();
    };
    // Keep draining completed native jobs without waiting for a later render call. Every
    // continuation yields a real task, and each individual upload/compile yields inside the
    // shared preparation path. After a slow frame, give painting priority before the next job.
    void (this.pacing.isUnderPressure()
      ? this.pacing.run(start, () => 2)
      : yieldToMainThread().then(start));
  }

  restore(): void {
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
  }

  private compileNext(): void {
    // Creatures first: their meshes stay hidden until prepared, so they must not wait behind
    // the scenery that arrives with them. A covered destination drains in larger jobs.
    const covered = this.deferGameplayDraws;
    const limit = covered ? COVERED_DRAIN_BATCH_SIZE : DRAIN_BATCH_SIZE;
    const batch: THREE.Object3D[] = [];
    const retry = this.retrying.values().next();
    if (!retry.done) {
      batch.push(retry.value);
      this.retrying.delete(retry.value);
    } else for (const actors of [true, false]) for (const object of this.queued) {
      if (batch.length === limit) break;
      if (isActorMesh(object) === actors) batch.push(object);
    }
    for (const object of batch) this.queued.delete(object);
    this.pending = true;
    void prepareShaderMeshes(this.renderer, this.scene, this.camera, batch, {
      batchSize: 4,
      pipelineConcurrency: covered ? COVERED_PIPELINE_CONCURRENCY : 1,
      renderTarget: this.renderTarget,
      isCancelled: () => this.disposed,
      onPendingTextures: count => { this.pendingTextures = count; },
      onPreparedBatch: prepared => {
        // Reveal a completed actor without waiting for unrelated work in this outer job.
        // A moved mesh may already belong to the next job. Preserve that enrollment.
        for (const object of prepared) if (!this.queued.has(object)) this.releaseWaiting(object);
      },
    }).catch(error => {
      if (this.disposed) return;
      // A batch shares its scopes and fences, so its failure names no single object unless the
      // device rejected an object's own pipeline. Everything else is prepared again alone.
      const own = new Set(error instanceof ShaderPreparationError ? error.failed : []);
      const failed: THREE.Object3D[] = [];
      let retried = 0;
      for (const object of batch) {
        // Released by an earlier completed sub-batch, or moved and already enrolled again.
        if (!this.waiting.has(object) || this.queued.has(object)) continue;
        if (batch.length === 1 || own.has(object)) failed.push(object);
        else { this.retrying.add(object); retried++; }
      }
      const message = error instanceof Error ? error.message : String(error);
      if (retried) console.warn(`Shader preparation failed in a batch of ${batch.length}; preparing ${retried} alone: ${message}`);
      for (const object of failed) {
        this.releaseWaiting(object);
        this.failed.set(object, message);
      }
      if (failed.length) console.error(`Shader preparation failed for ${failed.map(describe).join("; ")}: ${message}`);
    }).finally(() => {
      this.pendingTextures = 0;
      this.pending = false;
      this.scheduleNext();
    });
  }

  getState() { return { waiting: this.waiting.size, queued: this.queued.size + this.retrying.size, compiling: this.pending,
    textures: this.pendingTextures, failed: this.failed.size, error: this.failed.values().next().value ?? null }; }
  pendingKinds() {
    const kinds = { scenery: 0, instanced: 0, skinned: 0, ordinary: 0 };
    for (const object of this.waiting) {
      const mesh = object as THREE.Mesh & { isSceneryInstances?: boolean; isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
      if (mesh.isSceneryInstances) kinds.scenery++;
      else if (mesh.isInstancedMesh) kinds.instanced++;
      else if (mesh.isSkinnedMesh) kinds.skinned++;
      else kinds.ordinary++;
    }
    return kinds;
  }
  hasPending(root: THREE.Object3D): boolean { return this.pendingRoots.has(root); }

  dispose(): void {
    this.disposed = true;
    this.restore();
    for (const object of this.watched) {
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
    }
    this.watched.clear(); this.queued.clear(); this.retrying.clear(); this.waiting.clear(); this.failed.clear();
    this.pendingRoots.clear(); this.pendingAncestors.clear();
    this.pendingTextures = 0;
    this.pending = false;
    this.scheduled = false;
  }
}
