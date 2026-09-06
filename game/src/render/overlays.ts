/**
 * The assistance overlay layer — Corealm's RuneLite-style annotation system.
 *
 * Four kinds, deliberately: highlight, path, marker, label. An agent drives these through
 * `corealm_overlay`, which is what turns "the agent knows something" into "the player can see what
 * the agent means". The same layer serves the human UI's quest markers and route previews.
 *
 * Overlays are pure presentation. Drawing one never changes gameplay state, and clearing them all
 * never breaks anything — that separation is what makes it safe to let an agent write here.
 *
 * Everything here CONFORMS TO THE GROUND. Rings and route lines used to be flat geometry parked at
 * whatever Y the caller happened to pass, which on Karrowmoor's terraces buries a highlight ring in
 * the hillside and puts a nav path up to 4.46 m under the surface it is meant to describe
 * (runs/corealm/diagnosis/animation-and-movement-feel.md: paths carry 2-3 corners over 50 m with Y
 * linearly interpolated between them). An annotation inside the terrain annotates nothing, so every
 * ground-plane vertex here is sampled against the terrain field instead of trusted from the caller.
 *
 * This class draws; it does not decide. Which marker gets a route, when a route is re-planned and
 * when a marker has been reached is `app/guidance.ts`, which calls `setRoute` and `setReached`
 * here. Keeping that split is what lets this file stay a renderer with no idea where the player is.
 */
import * as THREE from "three";
import type { EntityId, OverlaySpec, Vec3 } from "../contracts.js";
import {
  RIBBON_HALF_WIDTH, buildRibbonGeometry, createRibbonMaterial, projectAlong, type RibbonUniforms,
} from "./pathRibbon.js";
import type { WorldScene } from "./scene.js";

/**
 * The mesh-exact height sampler `render/scene.ts` gains in this same wave.
 *
 * Declared optional so this file compiles against the scene exactly as it is today and picks the
 * better sampler up the moment it lands, with no second edit here. `meshHeightAt` beats
 * `heightAtXZ` because it interpolates the SAME 2 m lattice the terrain mesh is built from; the
 * analytic field disagrees with the drawn surface by up to half a quad's relief, which is exactly
 * the gap a ring lying on the ground is trying to close.
 */
interface MeshHeightSampler {
  meshHeightAt?(x: number, z: number): number;
}

type OverlayStyle = "default" | "walkDestination" | "reached";

interface LiveOverlay {
  spec: OverlaySpec;
  object: THREE.Object3D;
  style: OverlayStyle;
  /** Sim time this was created, for the styles that animate over their lifetime. */
  bornAtMs: number;
  /** Sim time at which this disappears, or null for "until cleared". */
  expiresAtMs: number | null;
  /** Kept so a followed entity's overlay tracks it as it moves. */
  entityId?: EntityId;
  element?: HTMLElement;
  /** Metres above the anchor the label floats: clear of a pin, just off the ground otherwise. */
  labelLift: number;
  /** The marker's pin, which bobs. */
  bob?: THREE.Object3D;
  /** A ribbon attached by `setRoute`. World-space, so it lives beside the object, not under it. */
  route?: Ribbon;
  /** Ground-plane rings that need re-seating when they move. Empty for kinds that have none. */
  conform: ConformRing[];
  /** Where the conform was last computed, so a stationary overlay never resamples. */
  conformedAt: THREE.Vector3;
  conformedAtMs: number;
}

interface Ribbon {
  mesh: THREE.Mesh;
  uniforms: RibbonUniforms;
  /** The centreline, for sliding the head along it. */
  centre: Float32Array;
  length: number;
}

/** A ring whose vertices are pushed onto the terrain in the owning object's local frame. */
interface ConformRing {
  mesh: THREE.Mesh;
  /** Local XZ of each vertex, captured once at build time. */
  localX: Float32Array;
  localZ: Float32Array;
  /** Metres above the sampled surface. */
  lift: number;
}

const DEFAULT_COLOUR = "#ffd98a";
const MAX_OVERLAYS = 64;
/** Re-sample the ground under a moving overlay once it has travelled this far, in metres. */
const CONFORM_MOVE_METRES = 0.2;
/** ...and at worst this often, which bounds the cost of a ring that is chasing a running enemy. */
const CONFORM_INTERVAL_MS = 400;
/**
 * Metres between ground samples along a route ribbon. Half the terrain lattice, so the strip's
 * edges land on the mesh between lattice rows too; stretched for a route that would otherwise blow
 * the sample cap, rather than truncating the route short of its destination.
 */
const PATH_SAMPLE_METRES = 1;
/** How high the route ribbon rides. Clears 2 m quad relief; low enough to still read as ground paint. */
const PATH_LIFT_METRES = 0.22;
/** A cap, because an agent can hand in a path of any length and every sample is a terrain query. */
const MAX_PATH_SAMPLES = 512;
/** Where the marker's pin hangs, and how far it bobs. */
const PIN_HEIGHT = 3.2;
const PIN_BOB_METRES = 0.16;
/** The "reached" flourish: a ring that swells and fades over this long. */
const REACHED_TTL_MS = 650;

export interface OverlayDeps {
  scene: WorldScene;
  camera: THREE.Camera;
  /** Current world position of an entity, so a followed overlay stays attached. */
  entityPosition(entityId: EntityId): Vec3 | null;
  /** Where world-space labels are mounted. */
  labelRoot: HTMLElement;
}

export class Overlays {
  private readonly live = new Map<string, LiveOverlay>();
  private readonly group = new THREE.Group();
  private readonly projected = new THREE.Vector3();
  private readonly terrain: WorldScene & MeshHeightSampler;

  constructor(private readonly deps: OverlayDeps) {
    this.group.name = "overlays";
    this.deps.scene.overlayGroup.add(this.group);
    this.terrain = this.deps.scene;
  }

  /** Creates or replaces an overlay. Returns the number now active. */
  set(spec: OverlaySpec, nowMs: number): number {
    return this.setStyled(spec, nowMs, "default");
  }

  /** A compact ground decal for human click-to-walk feedback. */
  setWalkDestination(id: string, position: Vec3, nowMs: number, colour = "#d2c07a"): number {
    const existing = this.live.get(id);
    if (existing?.style === "walkDestination" && existing.spec.colour === colour) {
      existing.spec.position = position;
      existing.object.position.set(position[0], position[1], position[2]);
      return this.live.size;
    }
    return this.setStyled({ id, kind: "highlight", position, colour }, nowMs, "walkDestination");
  }

  /**
   * The moment of arrival: a ring at the spot that swells and fades out. Short-lived by
   * construction, so a caller can fire it and forget it.
   */
  setReached(id: string, position: Vec3, nowMs: number, colour = DEFAULT_COLOUR): number {
    return this.setStyled({ id, kind: "highlight", position, colour, ttlMs: REACHED_TTL_MS }, nowMs, "reached");
  }

  /**
   * Attaches a ground route to an existing overlay, replacing any it had; null takes it away.
   * The route is drawn in world space beside the anchor rather than under it, so a marker that
   * follows a moving entity does not drag the whole ribbon along with it. Returns false when
   * there is no such overlay.
   */
  setRoute(id: string, points: readonly Vec3[] | null): boolean {
    const entry = this.live.get(id);
    // A path's ribbon is the overlay itself, not an attachment; replace the overlay instead.
    if (!entry || entry.spec.kind === "path") return false;
    if (entry.route) {
      this.disposeObject(entry.route.mesh);
      delete entry.route;
    }
    if (!points || points.length < 2) return true;
    const colour = new THREE.Color(entry.spec.colour ?? DEFAULT_COLOUR);
    const route = this.makeRibbon(points, colour);
    if (!route) return true;
    entry.route = route;
    this.group.add(route.mesh);
    return true;
  }

  /**
   * Slides an attached route's visible head to the player's position. Returns where that
   * position sits against the route — how far along it and how far off it — or null when the
   * overlay has no route. Cheap enough to call every frame, which is the point.
   */
  setRouteHead(id: string, position: Vec3): { along: number; lateral: number; remaining: number } | null {
    const entry = this.live.get(id);
    if (!entry?.route || entry.spec.kind === "path") return null;
    const { along, lateral } = projectAlong(entry.route.centre, position[0], position[2]);
    entry.route.uniforms.uHead.value = along;
    return { along, lateral, remaining: entry.route.length - along };
  }

  private setStyled(spec: OverlaySpec, nowMs: number, style: OverlayStyle): number {
    const position = this.resolvePosition(spec);
    // GameApi rejects unresolved anchors. Keep the renderer defensive too, since click feedback
    // and future presentation code can call this class directly. A missing target must never fall
    // through to Three.js's default [0, 0, 0] position.
    if (spec.kind !== "path" && !position) return this.live.size;

    this.clear(spec.id);

    // A hard cap, because an agent in a loop can otherwise fill the scene with rings.
    if (this.live.size >= MAX_OVERLAYS) {
      const oldest = this.live.keys().next();
      if (!oldest.done) this.clear(oldest.value);
    }

    const colour = new THREE.Color(spec.colour ?? DEFAULT_COLOUR);

    let object: THREE.Object3D | null = null;
    let element: HTMLElement | undefined;
    let bob: THREE.Object3D | undefined;
    let route: LiveOverlay["route"];
    let labelLift = 2.2;
    const conform: ConformRing[] = [];

    switch (spec.kind) {
      case "highlight":
        object = style === "walkDestination"
          ? this.makeWalkDestination(colour, conform)
          : style === "reached"
            ? this.makeReached(colour, conform)
            : this.makeHighlight(colour, conform);
        break;
      case "marker": {
        const marker = this.makeMarker(colour, conform);
        object = marker.group;
        bob = marker.pin;
        labelLift = PIN_HEIGHT + 1.1;
        if (spec.text) element = this.makeLabel(spec.text, spec.colour ?? DEFAULT_COLOUR);
        break;
      }
      case "path": {
        const ribbon = this.makeRibbon(spec.path ?? [], colour);
        if (ribbon) {
          object = ribbon.mesh;
          // Held as the entry's route too, so its time uniform ticks with the attached ones.
          route = ribbon;
        }
        break;
      }
      case "label":
        object = new THREE.Object3D();
        element = this.makeLabel(spec.text ?? "", spec.colour ?? DEFAULT_COLOUR);
        break;
    }

    if (!object) return this.live.size;
    // A path is built in world coordinates, so it is the one kind that is never moved to a point.
    if (spec.kind !== "path" && position) object.position.set(position[0], position[1], position[2]);
    this.group.add(object);

    const entry: LiveOverlay = {
      spec,
      object,
      style,
      bornAtMs: nowMs,
      expiresAtMs: spec.ttlMs && spec.ttlMs > 0 ? nowMs + spec.ttlMs : null,
      ...(spec.entityId ? { entityId: spec.entityId } : {}),
      ...(element ? { element } : {}),
      labelLift,
      ...(bob ? { bob } : {}),
      ...(route ? { route } : {}),
      conform,
      conformedAt: new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
      conformedAtMs: Number.NEGATIVE_INFINITY,
    };
    this.conformRings(entry, nowMs, true);
    this.live.set(spec.id, entry);
    return this.live.size;
  }

  /** Clears one overlay by id, or all of them. Returns the number remaining. */
  clear(id?: string): number {
    if (id === undefined) {
      for (const entry of this.live.values()) this.dispose(entry);
      this.live.clear();
      return 0;
    }
    const entry = this.live.get(id);
    if (entry) {
      this.dispose(entry);
      this.live.delete(id);
    }
    return this.live.size;
  }

  /** Per-frame: expire, follow entities, animate, re-seat rings on the terrain, project labels. */
  update(nowMs: number): void {
    // Animation runs on wall time so the chevrons keep drifting while the sim is paused; a frozen
    // route reads as a stalled renderer, not a paused game.
    const animSeconds = performance.now() / 1000;
    for (const [id, entry] of [...this.live]) {
      if (entry.expiresAtMs !== null && nowMs >= entry.expiresAtMs) {
        this.dispose(entry);
        this.live.delete(id);
        continue;
      }

      // A path is world-space geometry. Translating it by the followed entity's absolute position
      // used to fling the whole route out to twice its own coordinates, so `path` opts out.
      if (entry.entityId && entry.spec.kind !== "path") {
        const position = this.deps.entityPosition(entry.entityId);
        if (position) entry.object.position.set(position[0], position[1], position[2]);
      }

      // A slow pulse so a highlight reads as an annotation rather than as part of the world.
      //
      // Only X and Z pulse. Y now carries the conformed terrain profile, and scaling that would
      // make the ring breathe into and out of the hillside. The old `rotation.y += 0.004` is gone:
      // a RingGeometry is rotationally symmetric about Y, so it changed no pixel at any frame rate,
      // and being per-frame rather than per-second it also made every overlay recompute its world
      // matrix on every frame for that nothing.
      if (entry.spec.kind === "highlight") {
        if (entry.style === "reached") {
          // Swell and fade over the TTL. X/Z only, for the same reason as the pulse.
          const progress = Math.min(1, (nowMs - entry.bornAtMs) / REACHED_TTL_MS);
          const eased = 1 - (1 - progress) * (1 - progress);
          const swell = 1 + eased * 1.9;
          entry.object.scale.set(swell, 1, swell);
          for (const ring of entry.conform) (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - eased) * 0.9;
        } else {
          const strength = entry.style === "walkDestination" ? 0.018 : 0.06;
          const pulse = 1 + Math.sin(nowMs / 320) * strength;
          entry.object.scale.set(pulse, 1, pulse);
        }
      }

      if (entry.bob) entry.bob.position.y = PIN_HEIGHT + Math.sin(animSeconds * 2.4) * PIN_BOB_METRES;
      if (entry.route) entry.route.uniforms.uTime.value = animSeconds;

      this.conformRings(entry, nowMs, false);
      if (entry.element) this.positionLabel(entry);
    }
  }

  activeCount(): number {
    return this.live.size;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  list(): OverlaySpec[] {
    return [...this.live.values()].map((entry) => entry.spec);
  }

  // ------------------------------------------------------------- factories

  private resolvePosition(spec: OverlaySpec): Vec3 | null {
    if (spec.entityId) {
      const found = this.deps.entityPosition(spec.entityId);
      if (found) return found;
    }
    return spec.position ?? null;
  }

  /** Terrain height, from the mesh-exact sampler when the scene has one. */
  private groundY(x: number, z: number): number {
    return this.terrain.meshHeightAt?.(x, z) ?? this.terrain.heightAtXZ(x, z);
  }

  /** A ground ring. Reads at a distance without hiding the thing it marks. */
  private makeHighlight(colour: THREE.Color, conform: ConformRing[]): THREE.Object3D {
    const ring = this.makeGroundRing(colour, 0.85, 1.15, 40, 0.75, 0.06);
    conform.push(ring.conform);
    return ring.mesh;
  }

  /** A small tinted patch with a fine edge. This marks a clicked tile without becoming scenery. */
  private makeWalkDestination(colour: THREE.Color, conform: ConformRing[]): THREE.Object3D {
    const group = new THREE.Group();

    const fill = this.makeGroundDisc(colour, 0.62, 32, 0.12, 0.055);
    conform.push(fill.conform);
    group.add(fill.mesh);

    const edge = this.makeGroundRing(colour, 0.6, 0.69, 32, 0.62, 0.065);
    conform.push(edge.conform);
    group.add(edge.mesh);

    return group;
  }

  /** A floating pin, for a destination the player cannot see yet. */
  private makeMarker(colour: THREE.Color, conform: ConformRing[]): { group: THREE.Group; pin: THREE.Object3D } {
    const group = new THREE.Group();
    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.4, 10),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }),
    );
    pin.rotation.x = Math.PI;
    pin.position.y = PIN_HEIGHT;
    pin.renderOrder = 10;
    group.add(pin);

    const base = this.makeGroundRing(colour, 0.5, 0.72, 28, 0.9, 0.06);
    conform.push(base.conform);
    group.add(base.mesh);

    return { group, pin };
  }

  /** The arrival ring. Starts at the marker's base size; `update` swells and fades it. */
  private makeReached(colour: THREE.Color, conform: ConformRing[]): THREE.Object3D {
    const ring = this.makeGroundRing(colour, 0.5, 0.72, 28, 0.9, 0.07);
    conform.push(ring.conform);
    return ring.mesh;
  }

  /**
   * A flat annulus plus the bookkeeping that lets `conformRings` re-seat it on the terrain.
   *
   * Segment count is the whole cost of conforming: a rebuild samples 2 x (segments + 1) heights, so
   * the 40-segment highlight is 82 samples and rebuilds at most 2.5 times a second while moving.
   */
  private makeGroundRing(
    colour: THREE.Color,
    inner: number,
    outer: number,
    segments: number,
    opacity: number,
    lift: number,
  ): { mesh: THREE.Mesh; conform: ConformRing } {
    const geometry = new THREE.RingGeometry(inner, outer, segments);
    geometry.rotateX(-Math.PI / 2);
    // Annotation paint on every overlay material: exempt from the scene's tone mapping so the
    // colour an agent asked for is the colour on the ground (see `pathRibbon.ts`).
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 10;
    // Conformed geometry has real relief, and the bounding sphere is only computed from the flat
    // bind pose, so a frustum test can cull a ring that is still on screen. These are a few dozen
    // triangles; skipping the test is cheaper than keeping the bounds honest every conform.
    mesh.frustumCulled = false;

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const localX = new Float32Array(position.count);
    const localZ = new Float32Array(position.count);
    for (let index = 0; index < position.count; index += 1) {
      localX[index] = position.getX(index);
      localZ[index] = position.getZ(index);
    }
    return { mesh, conform: { mesh, localX, localZ, lift } };
  }

  private makeGroundDisc(
    colour: THREE.Color,
    radius: number,
    segments: number,
    opacity: number,
    lift: number,
  ): { mesh: THREE.Mesh; conform: ConformRing } {
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.renderOrder = 9;
    mesh.frustumCulled = false;

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const localX = new Float32Array(position.count);
    const localZ = new Float32Array(position.count);
    for (let index = 0; index < position.count; index += 1) {
      localX[index] = position.getX(index);
      localZ[index] = position.getZ(index);
    }
    return { mesh, conform: { mesh, localX, localZ, lift } };
  }

  /**
   * A route ribbon laid just above the ground.
   *
   * The caller's Y is discarded rather than trusted. Nav paths carry 2-3 corners over 50 m with Y
   * linearly interpolated between them, so a straight segment across a terrace cuts through the
   * hill — the measured worst case on one Karrowmoor path is 4.46 m below the surface. Long
   * segments are subdivided every PATH_SAMPLE_METRES and each sample is seated on the terrain.
   */
  private makeRibbon(points: readonly Vec3[], colour: THREE.Color): Ribbon | null {
    if (points.length < 2) return null;
    const samples = this.resamplePath(points);
    const built = buildRibbonGeometry(samples, (x, z) => this.groundY(x, z), RIBBON_HALF_WIDTH, PATH_LIFT_METRES);
    if (!built) return null;
    const uniforms: RibbonUniforms = {
      uTime: { value: performance.now() / 1000 },
      uLength: { value: built.length },
      uHead: { value: 0 },
    };
    const mesh = new THREE.Mesh(built.geometry, createRibbonMaterial(colour, uniforms));
    // Under the rings, so a destination ring sits on top of the ribbon's end.
    mesh.renderOrder = 8;
    return { mesh, uniforms, centre: built.centre, length: built.length };
  }

  /**
   * Corner list to an XZ polyline sampled densely enough to follow the ground. A route longer
   * than the sample budget is sampled more coarsely rather than cut short of its destination.
   */
  private resamplePath(points: readonly Vec3[]): [number, number][] {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![2] - points[index - 1]![2]);
    }
    const spacing = Math.max(PATH_SAMPLE_METRES, total / MAX_PATH_SAMPLES);
    const first = points[0]!;
    const out: [number, number][] = [[first[0], first[2]]];
    let budget = MAX_PATH_SAMPLES;
    for (let index = 1; index < points.length && budget > 0; index += 1) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const span = Math.hypot(to[0] - from[0], to[2] - from[2]);
      if (span < 1e-3) continue;
      const steps = Math.max(1, Math.min(budget, Math.ceil(span / spacing)));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        out.push([from[0] + (to[0] - from[0]) * t, from[2] + (to[2] - from[2]) * t]);
      }
      budget -= steps;
    }
    return out;
  }

  /**
   * Pushes every conformed ring's vertices onto the terrain, in the owning object's local frame.
   *
   * Throttled on movement and on time because the samplers are not free: a highlight following a
   * running enemy resamples 2.5 times a second, and a stationary one resamples exactly once.
   */
  private conformRings(entry: LiveOverlay, nowMs: number, force: boolean): void {
    if (entry.conform.length === 0) return;
    const origin = entry.object.position;
    if (
      !force
      && nowMs - entry.conformedAtMs < CONFORM_INTERVAL_MS
      && entry.conformedAt.distanceToSquared(origin) < CONFORM_MOVE_METRES * CONFORM_MOVE_METRES
    ) {
      return;
    }
    entry.conformedAt.copy(origin);
    entry.conformedAtMs = nowMs;

    for (const ring of entry.conform) {
      const attribute = ring.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < attribute.count; index += 1) {
        const worldX = origin.x + ring.localX[index]!;
        const worldZ = origin.z + ring.localZ[index]!;
        attribute.setY(index, this.groundY(worldX, worldZ) - origin.y + ring.lift);
      }
      attribute.needsUpdate = true;
    }
  }

  private makeLabel(text: string, colour: string): HTMLElement {
    const element = document.createElement("div");
    element.className = "world-label";
    element.textContent = text;
    element.style.borderColor = colour;
    this.deps.labelRoot.appendChild(element);
    return element;
  }

  /** Projects a world-space label into screen space, hiding it when behind the camera. */
  private positionLabel(entry: LiveOverlay): void {
    if (!entry.element) return;
    this.projected.copy(entry.object.position);
    this.projected.y += entry.labelLift;
    this.projected.project(this.deps.camera);

    const behind = this.projected.z > 1;
    if (behind) {
      entry.element.style.display = "none";
      return;
    }
    entry.element.style.display = "block";
    entry.element.style.left = `${(this.projected.x * 0.5 + 0.5) * window.innerWidth}px`;
    entry.element.style.top = `${(-this.projected.y * 0.5 + 0.5) * window.innerHeight}px`;
  }

  private dispose(entry: LiveOverlay): void {
    this.disposeObject(entry.object);
    // A path's ribbon IS its object, already disposed above; an attached route is a second object.
    if (entry.route && entry.route.mesh !== entry.object) this.disposeObject(entry.route.mesh);
    entry.element?.remove();
  }

  private disposeObject(object: THREE.Object3D): void {
    object.removeFromParent();
    const seen = new Set<THREE.Material>();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) {
        if (seen.has(item)) continue;
        seen.add(item);
        item.dispose();
      }
    });
  }
}
