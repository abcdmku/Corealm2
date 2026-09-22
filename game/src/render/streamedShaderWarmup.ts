import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { prepareShaderMeshes } from "./shaderPreparation.js";

/** Prepare newly resident pipelines and uploads before their first gameplay draw. */
export class StreamedShaderWarmup {
  /** A covered destination may defer new actors; ordinary play must keep actors visible. */
  deferGameplayDraws = false;
  private readonly waiting = new Set<THREE.Object3D>();
  private readonly enrolled = new WeakSet<THREE.Object3D>();
  private readonly pendingRoots = new Map<THREE.Object3D, number>();
  private readonly pendingAncestors = new Map<THREE.Object3D, THREE.Object3D[]>();
  private readonly queued = new Set<THREE.Object3D>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly hidden: THREE.Object3D[] = [];
  private readonly failed = new Set<THREE.Object3D>();
  private lastError: string | null = null;
  private pending = false;
  private pendingTextures = 0;
  private disposed = false;
  private readonly added = (event: { child: THREE.Object3D }) => this.watch(event.child, true);
  private readonly removed = (event: { child: THREE.Object3D }) => {
    event.child.traverse(object => {
      this.watched.delete(object);
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
      this.queued.delete(object);
      this.releaseWaiting(object);
    });
  };

  constructor(private renderer: WebGPURenderer, private scene: THREE.Scene, private camera: THREE.Camera,
    private renderTarget?: THREE.RenderTarget | null) {
    // Existing meshes were covered by startup warmup. Listen before background residency expands.
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
      this.addWaiting(object);
      this.queued.add(object);
    });
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
        this.addWaiting(object);
        this.queued.add(object);
      }
    });
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
    this.failed.delete(object);
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
    if (!this.pending && this.queued.size) this.compileNext();
    for (const object of this.waiting) {
      // Keep sampled actors and input feedback visible while detailed replacements prepare.
      if (!this.deferGameplayDraws && ((object.userData.entityId !== undefined && !object.userData.deferFirstDraw)
        || object.parent?.userData.keepVisibleDuringWarmup === true)) continue;
      if (!object.visible) continue;
      object.visible = false;
      this.hidden.push(object);
    }
  }

  restore(): void {
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
  }

  private compileNext(): void {
    const batch = [...this.queued].slice(0, 1);
    for (const object of batch) this.queued.delete(object);
    this.pending = true;
    let succeeded = false;
    void prepareShaderMeshes(this.renderer, this.scene, this.camera, batch, {
      batchSize: 1,
      renderTarget: this.renderTarget,
      isCancelled: () => this.disposed,
      onPendingTextures: count => { this.pendingTextures = count; },
    }).then(() => { succeeded = true; }).catch(error => {
      if (!this.disposed) {
        this.lastError = error instanceof Error ? error.message : String(error);
        for (const object of batch) if (this.waiting.has(object) && !this.queued.has(object)) this.failed.add(object);
        console.error("Streamed shader preparation failed", error);
      }
    }).finally(() => {
      // A moved mesh may already belong to the next batch. Preserve that enrollment.
      for (const object of batch) if (succeeded && !this.queued.has(object)) this.releaseWaiting(object);
      this.pendingTextures = 0;
      this.pending = false;
    });
  }

  getState() { return { waiting: this.waiting.size, queued: this.queued.size, compiling: this.pending,
    textures: this.pendingTextures, failed: this.failed.size, error: this.lastError }; }
  hasPending(root: THREE.Object3D): boolean { return this.pendingRoots.has(root); }

  dispose(): void {
    this.disposed = true;
    this.restore();
    for (const object of this.watched) {
      object.removeEventListener("childadded", this.added);
      object.removeEventListener("childremoved", this.removed);
    }
    this.watched.clear(); this.queued.clear(); this.waiting.clear(); this.failed.clear();
    this.pendingRoots.clear(); this.pendingAncestors.clear();
    this.pendingTextures = 0;
    this.pending = false;
  }
}
