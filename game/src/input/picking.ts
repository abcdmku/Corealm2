/**
 * Screen point -> world pick. The one raycast everybody shares.
 *
 * Three callers need the same answer — hover feedback, left click, right click — and if they each
 * rolled their own ray they would eventually disagree, which shows up as the highlight naming one
 * thing while the click does another. So there is one Picker per input controller.
 *
 * The pickable-object lookup is INJECTED. `input/` must never import `render/entityViews.ts`: the
 * render layer owns meshes, the input layer owns intent, and the root ties the two together at
 * boot. That also keeps this module testable without a scene.
 */
import * as THREE from "three";
import type { EntityId, Vec3 } from "../contracts.js";

export interface Pick {
  /** `null` means the ray landed on walkable ground rather than on an interactable entity. */
  entityId: EntityId | null;
  point: Vec3;
  /** Metres from the camera to the hit. Used to resolve entity-in-front-of-terrain. */
  distance: number;
  /** Present when the pick came from a scene raycast rather than an injected source. */
  object?: THREE.Object3D;
}

/**
 * A pick source turns a configured ray into a hit, or null. The root wires the entity source to
 * A2's entity views; the ground source defaults to raycasting the terrain meshes.
 */
export type PickSource = (raycaster: THREE.Raycaster, context?: boolean) => Pick | null;

export interface PickerDeps {
  camera: THREE.Camera;
  /** Scene root. Only the default ground source reads it. */
  scene: THREE.Object3D;
  /** Element the client coordinates are relative to. Usually the canvas. */
  element: HTMLElement;
}

export interface PickerSources {
  /**
   * Preferred entity wiring: one call that already knows about instancing and label offsets.
   * Root does: picker.setEntitySource((ray) => entityViews.pick(ray)).
   */
  pickEntity?: PickSource | null;
  /**
   * Alternative entity wiring, for when the render layer would rather hand over objects than run
   * the ray itself. Both shapes are supported so integration does not need to negotiate one.
   */
  entityObjects?: (() => readonly THREE.Object3D[]) | null;
  entityIdOf?: ((object: THREE.Object3D, instanceId: number | undefined) => EntityId | null) | null;
  /** Overrides the default terrain raycast. */
  pickGround?: PickSource | null;
  /** Names searched for the default ground source. */
  groundObjectNames?: readonly string[];
}

const DEFAULT_GROUND_NAMES: readonly string[] = ["terrain"];

/** Hover runs off the frame loop, not off mousemove, and even then only this often. */
export const HOVER_THROTTLE_MS = 70;

/** An entity this much further away than the ground hit is behind the hill, not on it. */
const ENTITY_DEPTH_BIAS = 0.05;

export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private pickEntitySource: PickSource | null = null;
  private pickGroundSource: PickSource | null = null;
  private entityObjects: (() => readonly THREE.Object3D[]) | null = null;
  private entityIdOf: ((object: THREE.Object3D, instanceId: number | undefined) => EntityId | null) | null = null;
  private groundNames: readonly string[] = DEFAULT_GROUND_NAMES;

  /** Cached terrain lookups. Revalidated by a parent check, so a rebuilt world re-resolves. */
  private groundCache: THREE.Object3D[] = [];

  private lastPickAtMs = Number.NEGATIVE_INFINITY;
  private lastPick: Pick | null = null;

  constructor(private readonly deps: PickerDeps, sources: PickerSources = {}) {
    this.configure(sources);
  }

  configure(sources: PickerSources): void {
    if (sources.pickEntity !== undefined) this.pickEntitySource = sources.pickEntity;
    if (sources.entityObjects !== undefined) this.entityObjects = sources.entityObjects;
    if (sources.entityIdOf !== undefined) this.entityIdOf = sources.entityIdOf;
    if (sources.pickGround !== undefined) this.pickGroundSource = sources.pickGround;
    if (sources.groundObjectNames !== undefined) this.groundNames = sources.groundObjectNames;
    this.groundCache = [];
    this.invalidate();
  }

  /** Root convenience. Same thing as configure({ pickEntity }). */
  setEntitySource(source: PickSource | null): void {
    this.pickEntitySource = source;
    this.invalidate();
  }

  setGroundSource(source: PickSource | null): void {
    this.pickGroundSource = source;
    this.groundCache = [];
    this.invalidate();
  }

  /** Drops the throttle cache. Call after the world changes under a stationary cursor. */
  invalidate(): void {
    this.lastPickAtMs = Number.NEGATIVE_INFINITY;
    this.lastPick = null;
  }

  /**
   * Nearest of the entity hit and the ground hit. Entities win ties, because a trunk drawn in
   * front of a hillside should stay clickable right up to its silhouette edge.
   */
  pickAt(clientX: number, clientY: number, context = false): Pick | null {
    this.aim(clientX, clientY);
    const entity = this.rayEntity(context);
    const ground = this.rayGround();
    if (entity && ground) return entity.distance <= ground.distance + ENTITY_DEPTH_BIAS ? entity : ground;
    return entity ?? ground;
  }

  /** Entity-only pick, for callers that must not fall back to ground. */
  pickEntityAt(clientX: number, clientY: number): Pick | null {
    this.aim(clientX, clientY);
    return this.rayEntity();
  }

  /** Ground-only pick, for click-to-move. */
  pickGroundAt(clientX: number, clientY: number): Pick | null {
    this.aim(clientX, clientY);
    return this.rayGround();
  }

  /**
   * Hover pick: entities only, occlusion-checked.
   *
   * Cheaper than `pickAt` in the case that actually runs continuously. The entity ray usually
   * misses, and when it misses there is nothing to highlight, so the terrain — the most expensive
   * mesh in the scene — never gets rayed at all. Ground is only consulted to reject an entity that
   * is really behind a hill.
   */
  pickHoverAt(clientX: number, clientY: number): Pick | null {
    this.aim(clientX, clientY);
    const entity = this.rayEntity();
    if (!entity) return null;
    const ground = this.rayGround();
    if (ground && ground.distance + ENTITY_DEPTH_BIAS < entity.distance) return null;
    return entity;
  }

  /**
   * Throttled hover. Cheap by construction: the ray fires at most once per `intervalMs`, so
   * sweeping the cursor across a canopy does not raycast 120 times a second.
   */
  pickThrottled(clientX: number, clientY: number, nowMs: number, intervalMs = HOVER_THROTTLE_MS): Pick | null {
    if (nowMs - this.lastPickAtMs < intervalMs) return this.lastPick;
    this.lastPickAtMs = nowMs;
    this.lastPick = this.pickHoverAt(clientX, clientY);
    return this.lastPick;
  }

  /** Normalised device coordinates for a client point, relative to the picking element. */
  toNdc(clientX: number, clientY: number, out = new THREE.Vector2()): THREE.Vector2 {
    const rect = this.deps.element.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    out.set(((clientX - rect.left) / width) * 2 - 1, -((clientY - rect.top) / height) * 2 + 1);
    return out;
  }

  /** True when the point is inside the picking element. Guards edge-of-screen drags. */
  containsPoint(clientX: number, clientY: number): boolean {
    const rect = this.deps.element.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  private aim(clientX: number, clientY: number): void {
    this.toNdc(clientX, clientY, this.ndc);
    this.raycaster.setFromCamera(this.ndc, this.deps.camera);
  }

  private rayEntity(context = false): Pick | null {
    if (this.pickEntitySource) return this.pickEntitySource(this.raycaster, context);
    if (!this.entityObjects || !this.entityIdOf) return null;

    const objects = this.entityObjects();
    if (objects.length === 0) return null;
    const hits = this.raycaster.intersectObjects(objects as THREE.Object3D[], true);
    for (const hit of hits) {
      const entityId = this.entityIdOf(hit.object, hit.instanceId);
      // A hit on scatter or an overlay maps to no entity; keep walking the sorted list.
      if (entityId) return toPick(entityId, hit);
    }
    return null;
  }

  private rayGround(): Pick | null {
    if (this.pickGroundSource) return this.pickGroundSource(this.raycaster);

    const objects = this.resolveGround();
    if (objects.length === 0) return null;
    const hit = this.raycaster.intersectObjects(objects, true)[0];
    return hit ? toPick(null, hit) : null;
  }

  private resolveGround(): THREE.Object3D[] {
    // Cheap revalidation: a detached object means the world was rebuilt under us.
    const stale = this.groundCache.length !== this.groundNames.length
      || this.groundCache.some((object) => object.parent === null);
    if (!stale) return this.groundCache;

    const found: THREE.Object3D[] = [];
    for (const name of this.groundNames) {
      const object = this.deps.scene.getObjectByName(name);
      if (object) found.push(object);
    }
    this.groundCache = found;
    return found;
  }
}

function toPick(entityId: EntityId | null, hit: THREE.Intersection<THREE.Object3D>): Pick {
  const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
  return { entityId, point, distance: hit.distance, object: hit.object };
}
