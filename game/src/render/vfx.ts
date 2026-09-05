/**
 * The feedback layer: damage numbers, yields, boss telegraphs and world ambience.
 *
 * All of it is driven by the event stream or by a read-only port rather than by systems calling in.
 * That keeps the dependency pointing one way — systems emit facts, the renderer reacts — and it
 * means an action taken by an agent produces exactly the same feedback as the same action taken by
 * a human, because both go through the same events.
 *
 * Nothing here owns gameplay state. Deleting this file would make the game ugly, not wrong.
 *
 * THREE THINGS IN HERE WERE DEAD BEFORE THIS PASS, all of the same shape the phase 1 report calls
 * out — a comment claiming a caller that did not exist:
 *
 *  - `telegraph()` had no callers project-wide, and `systems/enemyAI.ts:406` still says
 *    "`render/overlays.ts` and the HUD both poll this". Neither ever did. The Sunder-Warden's
 *    6.0 m ground slam therefore landed with no warning of any kind. Replaced by
 *    `setTelegraphSource`, which is polled every frame.
 *  - the `item.received` branch read `event.data.xp`, and no emitter of `item.received` anywhere in
 *    the project writes an `xp` field — grepped all seven emit sites. `xp > 0` was therefore always
 *    false and `xpDrop()` was unreachable from events. There is no xp event in the contract at all
 *    (`ui/hud.ts:361` says the same), so XP is now diffed from an optional skill port, and
 *    `item.received` paints what it actually carries: the gathering yield.
 *  - `case "combat.started": break;` was an empty case that `default` already handled.
 */
import * as THREE from "three";
import type { GameEvent, SkillId, Vec3 } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { MOVEMENT } from "../app/config.js";
import { LevelUpVfx } from "./levelUpVfx.js";

interface FloatingText {
  element: HTMLElement;
  world: THREE.Vector3;
  bornAtMs: number;
  lifetimeMs: number;
  riseMetres: number;
  /** Screen-space fan offset, so two numbers in the same frame do not print on top of each other. */
  offsetPx: number;
}

interface Telegraph {
  id: string;
  group: THREE.Group;
  boundary: THREE.Mesh;
  fuse: THREE.Mesh;
  radius: number;
  seenThisFrame: boolean;
}

/**
 * One live boss telegraph, in the terms the renderer needs and nothing more.
 *
 * `progress` rather than timestamps on purpose: `systems/enemyAI.ts` keeps telegraph times in SIM
 * milliseconds and this class ticks on the REAL clock, so anything that subtracted one from the
 * other would be wrong by however far the accumulator happens to be. The caller owns the clock it
 * measured with.
 */
export interface TelegraphSnapshot {
  id: string;
  centre: Vec3;
  radius: number;
  /** 0 the instant the wind-up starts, 1 the instant the damage lands. */
  progress: number;
}

export interface VfxDeps {
  camera: THREE.Camera;
  /** Where floating text is mounted. */
  root: HTMLElement;
  parent: THREE.Object3D;
  /** Current world position of an entity, for anchoring a number to the thing that took the hit. */
  entityPosition(entityId: string): Vec3 | null;
  playerPosition(): Vec3;
  /**
   * Terrain height, so a telegraph ring lies on the arena floor rather than on a plane through the
   * boss's origin. Optional: boot compiles unchanged without it and the ring falls back to the
   * centre's own Y.
   */
  groundHeightAt?(x: number, z: number): number;
  /**
   * Total XP per skill. Optional, and OFF unless supplied — `ui/hud.ts` already runs the same diff
   * for its corner feed, so wiring this is a choice about whether XP should also read in the world.
   */
  skillXp?(): Readonly<Partial<Record<SkillId, number>>>;
}

const DAMAGE_LIFETIME_MS = 1100;
const XP_LIFETIME_MS = 1400;
const MAX_FLOATERS = 40;
/** Lateral spread of the fan that keeps simultaneous numbers apart, in CSS pixels. */
const FAN_STEP_PX = 15;
const FAN_WIDTH = 5;
/** Poll cadence for the XP diff. Faster than this just re-reads unchanged numbers. */
const XP_POLL_MS = 200;
/** Speed is averaged over this long, because the sim only moves the player 10 times a second. */
const FOOTFALL_WINDOW_MS = 250;
/** One puff per stride at 4.2 m/s, which is roughly this. */
const FOOTFALL_INTERVAL_MS = 300;

/**
 * A hard black outline in eight directions, set inline so it beats the class rule.
 *
 * `ui/styles.css` gives `.vfx-float` a one-sided drop shadow plus a soft glow, which reads on the
 * dark dungeon floor and disappears into bright grass — a yellow "12" over lit Fallowmarch turf is
 * a yellow smear. A true outline is the only thing that works on both, and it cannot live in the
 * stylesheet from here: `ui/styles.css` belongs to another owner this wave.
 */
const OUTLINE =
  "-1px -1px 0 #0b0a08, 1px -1px 0 #0b0a08, -1px 1px 0 #0b0a08, 1px 1px 0 #0b0a08,"
  + " 0 -1px 0 #0b0a08, 0 1px 0 #0b0a08, -1px 0 0 #0b0a08, 1px 0 0 #0b0a08,"
  + " 0 2px 5px rgba(0, 0, 0, 0.85)";

export class Vfx {
  /**
   * Floating combat numbers, as a player preference.
   *
   * Off means the numbers are never created, not created-and-hidden: on a busy fight that is the
   * difference between a few dozen DOM nodes a second and none.
   */
  damageNumbers = true;
  private floaters: FloatingText[] = [];
  private telegraphs = new Map<string, Telegraph>();
  private telegraphSource: (() => readonly TelegraphSnapshot[]) | null = null;
  private ambience: Ambience | null = null;
  private readonly projected = new THREE.Vector3();
  private readonly group = new THREE.Group();
  private readonly levelUp: LevelUpVfx;
  private readonly viewer = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private fanIndex = 0;
  private xpBaseline: Partial<Record<SkillId, number>> = {};
  private xpSeeded = false;
  private xpPolledAtMs = Number.NEGATIVE_INFINITY;
  private footfallSample: { x: number; z: number; atMs: number } | null = null;
  private lastFootfallAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: VfxDeps) {
    this.group.name = "vfx";
    this.deps.parent.add(this.group);
    this.levelUp = new LevelUpVfx({
      parent: this.group,
      camera: this.deps.camera,
      playerPosition: this.deps.playerPosition,
    });
  }

  /**
   * Reacts to one game event. Wire this to `EventBus.subscribe` at boot.
   * Unknown event types are ignored on purpose: a new event should never crash the renderer.
   */
  handle(event: GameEvent, nowMs: number): void {
    switch (event.type) {
      case "item.received": {
        // What this event actually carries, verified against all seven emit sites: `itemId`,
        // `quantity`, sometimes `name`, sometimes `source`. Gathering and production
        // attach the node or station as `entityId`; a shop purchase, a loot sweep and a quest
        // reward do not. Keying on `entityId` is therefore what separates "a yield came out of that
        // rock" from "your pack changed", and only the first is worth a number in the world.
        if (!event.entityId) break;
        const data = event.data as Record<string, unknown>;
        const quantity = typeof data["quantity"] === "number" ? data["quantity"] : 0;
        if (quantity <= 0) break;
        const at = this.deps.entityPosition(event.entityId);
        if (!at) break;
        const name = typeof data["name"] === "string"
          ? data["name"]
          : prettyItemName(typeof data["itemId"] === "string" ? data["itemId"] : "");
        this.floatAt(at, `+${quantity} ${name}`.trimEnd(), "vfx-xp", nowMs, XP_LIFETIME_MS, 1.4);
        if (data["source"] === "gather" && data["skill"] === "fishing") {
          this.ambience?.burst("splash", [at[0], at[1] + 0.08, at[2]], 6, nowMs);
        }
        break;
      }
      case "level.gained": {
        const skill = event.data.skill as SkillId | undefined;
        const level = event.data.level as number | undefined;
        if (skill && typeof level === "number") {
          const position = this.deps.playerPosition();
          this.floatAt(position, `${SKILLS[skill]?.name ?? skill} ${level}`, "vfx-level", nowMs, 2200, 2.6);
          this.levelUp.burst(nowMs, event.seq);
        }
        break;
      }
      case "health.low":
        this.floatAt(this.deps.playerPosition(), "Low health", "vfx-warning", nowMs, 1600, 1.6);
        break;
      case "player.died":
        this.floatAt(this.deps.playerPosition(), "You died", "vfx-warning", nowMs, 2600, 2.0);
        break;
      case "resource.depleted":
        if (event.entityId) {
          const at = this.deps.entityPosition(event.entityId);
          if (at) this.floatAt(at, "Depleted", "vfx-muted", nowMs, 1200, 1.0);
        }
        break;
      case "inventory.full":
        this.floatAt(this.deps.playerPosition(), "Inventory full", "vfx-warning", nowMs, 1800, 1.8);
        break;
      default:
        break;
    }
  }

  /** A damage number over whoever took the hit. Fed by `app/loop.ts` from `combat.consumeHits()`. */
  damage(entityId: string | null, amount: number, kind: "melee" | "magic" | "incoming", nowMs: number): void {
    if (!this.damageNumbers) return;
    const at = entityId ? this.deps.entityPosition(entityId) : this.deps.playerPosition();
    if (!at) return;
    const label = amount <= 0 ? "miss" : String(amount);
    const className = amount <= 0
      ? "vfx-miss"
      : kind === "incoming" ? "vfx-damage-in" : kind === "magic" ? "vfx-damage-magic" : "vfx-damage";
    this.floatAt(at, label, className, nowMs, DAMAGE_LIFETIME_MS, 1.5);
  }

  xpDrop(skill: SkillId, xp: number, nowMs: number): void {
    const element = this.floatAt(
      this.deps.playerPosition(),
      `+${Math.round(xp)} ${SKILLS[skill]?.name ?? skill}`,
      "vfx-xp",
      nowMs,
      XP_LIFETIME_MS,
      1.9,
    );
    if (element) element.style.color = SKILLS[skill]?.colour ?? "#f2ece0";
  }

  /**
   * Where boss telegraphs come from. Polled every frame; nothing is drawn until this is set.
   *
   * A push listener would have been fewer lines, but a telegraph has to keep being drawn for the
   * whole wind-up, and `onTelegraph` on the AI fires once. Polling also means a dropped frame
   * cannot leave a ring on the ground after the slam has landed.
   */
  setTelegraphSource(read: () => readonly TelegraphSnapshot[]): void {
    this.telegraphSource = read;
  }

  /** Instanced world ambience, ticked from this class's own update so `app/loop.ts` is untouched. */
  setAmbience(ambience: Ambience): void {
    this.ambience = ambience;
  }

  /**
   * Draws or updates one telegraph.
   *
   * Shape corrected. The old ring started at 0.35x scale and grew to 1.0x over the wind-up, so for
   * most of the warning it drew a SMALLER area than the one that was about to hurt: a player who
   * read the ring and stood just outside it got hit anyway. The boundary is now full size from the
   * first frame — that is the whole promise of a telegraph — and a filled disc races out to meet it
   * as the timer runs, which is what carries "how long have I got".
   */
  showTelegraph(id: string, centre: Vec3, radius: number, progress: number): void {
    let entry = this.telegraphs.get(id);
    if (!entry || entry.radius !== radius) {
      if (entry) this.clearTelegraph(id);
      entry = this.buildTelegraph(id, radius);
    }
    const y = (this.deps.groundHeightAt?.(centre[0], centre[2]) ?? centre[1]) + 0.06;
    entry.group.position.set(centre[0], y, centre[2]);
    entry.seenThisFrame = true;

    const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    entry.fuse.scale.setScalar(Math.max(0.001, t));
    (entry.fuse.material as THREE.MeshBasicMaterial).opacity = 0.14 + t * 0.36;
    // The boundary brightens rather than moves, so "it is about to fire" is legible peripherally.
    (entry.boundary.material as THREE.MeshBasicMaterial).opacity = 0.45 + t * 0.45;
  }

  clearTelegraph(id: string): void {
    const existing = this.telegraphs.get(id);
    if (!existing) return;
    existing.group.removeFromParent();
    for (const mesh of [existing.boundary, existing.fuse]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.telegraphs.delete(id);
  }

  /** Per-frame: age floaters, project them to screen space, poll telegraphs and XP, tick ambience. */
  update(nowMs: number): void {
    for (let index = this.floaters.length - 1; index >= 0; index -= 1) {
      const floater = this.floaters[index]!;
      const age = nowMs - floater.bornAtMs;
      if (age >= floater.lifetimeMs) {
        floater.element.remove();
        this.floaters.splice(index, 1);
        continue;
      }

      const progress = age / floater.lifetimeMs;
      this.projected.copy(floater.world);
      this.projected.y += floater.riseMetres * progress;
      this.projected.project(this.deps.camera);

      if (this.projected.z > 1) {
        floater.element.style.display = "none";
        continue;
      }
      floater.element.style.display = "block";
      floater.element.style.left = `${(this.projected.x * 0.5 + 0.5) * window.innerWidth + floater.offsetPx}px`;
      floater.element.style.top = `${(-this.projected.y * 0.5 + 0.5) * window.innerHeight}px`;
      // Hold full opacity for the first half, then fade, so a number is readable before it goes.
      floater.element.style.opacity = String(progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2);
    }

    this.pollTelegraphs();
    this.pollXp(nowMs);
    this.pollFootfalls(nowMs);
    this.levelUp.update(nowMs);

    if (this.ambience) {
      this.deps.camera.getWorldPosition(this.viewer);
      this.deps.camera.getWorldQuaternion(this.facing);
      this.ambience.update(nowMs, this.viewer, this.facing);
    }
  }

  activeFloaters(): number {
    return this.floaters.length;
  }

  activeTelegraphs(): number {
    return this.telegraphs.size;
  }

  activeLevelParticles(): number {
    return this.levelUp.liveParticles();
  }

  dispose(): void {
    for (const floater of this.floaters) floater.element.remove();
    this.floaters = [];
    for (const id of [...this.telegraphs.keys()]) this.clearTelegraph(id);
    this.ambience?.dispose();
    this.levelUp.dispose();
    this.group.removeFromParent();
  }

  // ------------------------------------------------------------- internals

  private pollTelegraphs(): void {
    if (!this.telegraphSource) return;
    for (const entry of this.telegraphs.values()) entry.seenThisFrame = false;
    for (const snapshot of this.telegraphSource()) {
      this.showTelegraph(snapshot.id, snapshot.centre, snapshot.radius, snapshot.progress);
    }
    for (const [id, entry] of [...this.telegraphs]) {
      if (!entry.seenThisFrame) this.clearTelegraph(id);
    }
  }

  /**
   * World-space XP, diffed rather than evented.
   *
   * There is no xp.gained event in the contract — `systems/activity.ts:awardXp` emits `level.gained`
   * and nothing else — so a diff is the only source, and it is also the more robust one: it catches
   * XP from a system that forgets to emit anything.
   */
  private pollXp(nowMs: number): void {
    const read = this.deps.skillXp;
    if (!read) return;
    if (nowMs - this.xpPolledAtMs < XP_POLL_MS) return;
    this.xpPolledAtMs = nowMs;

    const current = read();
    if (!this.xpSeeded) {
      this.xpBaseline = { ...current };
      this.xpSeeded = true;
      return;
    }
    for (const key of Object.keys(current) as SkillId[]) {
      const now = current[key] ?? 0;
      const before = this.xpBaseline[key] ?? 0;
      this.xpBaseline[key] = now;
      // A drop means the world was reset under us; reseat rather than paint a negative.
      if (now > before) this.xpDrop(key, now - before, nowMs);
    }
  }

  /**
   * Dust off the player's feet while they are actually running.
   *
   * Speed is measured over a 250 ms window, NOT frame to frame. The sim runs on a fixed 100 ms tick
   * with no interpolation, so only 1.54% of rendered frames contain any player displacement at all
   * (runs/corealm/diagnosis/animation-and-movement-feel.md) — a per-frame delta reads 0 on 98.5% of
   * frames and 190 m/s on the rest, which is the same mistake that makes the player rig stutter
   * between idle and run twenty times a second.
   */
  private pollFootfalls(nowMs: number): void {
    if (!this.ambience) return;
    const position = this.deps.playerPosition();
    const last = this.footfallSample;
    if (!last) {
      this.footfallSample = { x: position[0], z: position[2], atMs: nowMs };
      return;
    }
    const elapsed = nowMs - last.atMs;
    if (elapsed < FOOTFALL_WINDOW_MS) return;
    const speed = Math.hypot(position[0] - last.x, position[2] - last.z) / (elapsed / 1000);
    this.footfallSample = { x: position[0], z: position[2], atMs: nowMs };

    // Walking raises nothing. The threshold is the same one the rig uses to pick a jog over a walk,
    // so dust and the running animation start on the same stride.
    if (speed < MOVEMENT.walkPoseThreshold) return;
    if (nowMs - this.lastFootfallAtMs < FOOTFALL_INTERVAL_MS) return;
    this.lastFootfallAtMs = nowMs;
    const groundY = this.deps.groundHeightAt?.(position[0], position[2]) ?? position[1];
    this.ambience.burst("dust", [position[0], Math.max(position[1], groundY) + 0.02, position[2]], 2, nowMs);
  }

  private buildTelegraph(id: string, radius: number): Telegraph {
    const group = new THREE.Group();

    const boundaryGeometry = new THREE.RingGeometry(radius * 0.9, radius, 48);
    boundaryGeometry.rotateX(-Math.PI / 2);
    const boundary = new THREE.Mesh(
      boundaryGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xff8a4c, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    boundary.renderOrder = 9;

    const fuseGeometry = new THREE.CircleGeometry(radius, 48);
    fuseGeometry.rotateX(-Math.PI / 2);
    const fuse = new THREE.Mesh(
      fuseGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xd0552f, transparent: true, opacity: 0.14,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    fuse.renderOrder = 8;
    fuse.position.y = -0.01;

    group.add(boundary, fuse);
    this.group.add(group);
    const entry: Telegraph = { id, group, boundary, fuse, radius, seenThisFrame: true };
    this.telegraphs.set(id, entry);
    return entry;
  }

  private floatAt(
    world: Vec3,
    text: string,
    className: string,
    nowMs: number,
    lifetimeMs: number,
    riseMetres: number,
  ): HTMLElement | null {
    // Cap rather than queue: in a long fight the newest numbers are the ones worth reading.
    while (this.floaters.length >= MAX_FLOATERS) {
      const oldest = this.floaters.shift();
      oldest?.element.remove();
    }

    const element = document.createElement("div");
    element.className = `vfx-float ${className}`;
    element.textContent = text;
    element.style.textShadow = OUTLINE;
    this.deps.root.appendChild(element);

    // Numbers that land in the same frame on the same target project to the same pixel and stack
    // into an unreadable blur. A fixed five-wide fan spreads them deterministically — no rng, and
    // the same sequence of hits always lays out the same way.
    const slot = this.fanIndex % FAN_WIDTH;
    this.fanIndex += 1;
    const offsetPx = (slot - (FAN_WIDTH - 1) / 2) * FAN_STEP_PX;

    this.floaters.push({
      element,
      world: new THREE.Vector3(world[0], world[1] + 1.4, world[2]),
      bornAtMs: nowMs,
      lifetimeMs,
      riseMetres,
      offsetPx,
    });
    return element;
  }
}

/** "copper_ore" -> "Copper ore". Item names are not always on the event, ids always are. */
function prettyItemName(itemId: string): string {
  if (!itemId) return "";
  const words = itemId.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Contact shadows are NOT here. They live in `render/scene.ts` as `buildContactDecals`, which is
// the right home: it seats each quad on the DRAWN surface via `meshHeightAt` and tilts it to
// `normalAt`, and this file can reach neither. A second copy here would have bought one feature at
// the price of two permanent draw calls. Measured on the hollowcut_seam pose with a stand-in
// version of the layer: mean luminance in a 300 x 45 px band at a boulder base goes 42.17 -> 36.78,
// a 12.8% darkening, which is what stops the six boulders reading as stickers on the grass.

// ===========================================================================
// Ambience
// ===========================================================================

export type AmbienceKind = "smoke" | "dust" | "leaf" | "spark" | "splash" | "ripple" | "flame";

export interface AmbienceEmitter {
  id: string;
  kind: AmbienceKind;
  /** Where the effect comes out of, in world metres. A chimney top, a forge, a fishing spot. */
  position: Vec3;
  /** Particles alive at once. Defaults per kind. */
  count?: number;
  /** Beyond this distance from the viewer the emitter contributes nothing at all. */
  cullMetres?: number;
  /** Scales sizes and travel distances. */
  scale?: number;
}

interface Burst {
  kind: AmbienceKind;
  x: number;
  y: number;
  z: number;
  seed: number;
  count: number;
  bornAtMs: number;
}

interface KindProfile {
  lifeMs: number;
  /** Metres, start and end. */
  size: readonly [number, number];
  /** Linear RGB. Light for additive kinds, pigment for alpha-blended dust. */
  colour: readonly [number, number, number];
  defaultCount: number;
  cullMetres: number;
  /** Lies flat on the ground instead of facing the camera. */
  flat?: boolean;
  /** Dust fades its alpha instead of adding light to the ground beneath it. */
  alphaBlend?: boolean;
  /** Billboard height relative to its width. */
  aspect?: number;
  /** Local offset at phase p, given three stable hashes in 0..1. */
  motion(p: number, a: number, b: number, c: number): readonly [number, number, number];
  /** Brightness envelope over the particle's life. */
  fade(p: number): number;
}

const TAU = Math.PI * 2;

/**
 * Every ambience kind, as pure functions of (phase, three hashes).
 *
 * Stateless on purpose: a particle's position is computed from its index and the render clock, so
 * there is no simulation to step, no allocation per particle, and — the part that matters for
 * rule 5 — NOT ONE DRAW FROM ANY RNG STREAM. Adding or removing an emitter cannot shift a seeded
 * sequence, so nothing here can make an acceptance check flap.
 */
const PROFILES: Record<AmbienceKind, KindProfile> = {
  smoke: {
    lifeMs: 5200, size: [0.6, 3.2], colour: [0.40, 0.37, 0.33], defaultCount: 8, cullMetres: 75,
    motion: (p, a, b) => [
      (a - 0.5) * 0.9 + p * 1.5,
      p * 3.4,
      (b - 0.5) * 0.9 + p * 0.6,
    ],
    fade: (p) => Math.min(1, p * 7) * (1 - p) * (1 - p),
  },
  dust: {
    lifeMs: 400, size: [0.12, 0.38], colour: [0.16, 0.135, 0.095], defaultCount: 2, cullMetres: 30,
    alphaBlend: true, aspect: 0.45,
    motion: (p, a, b) => [
      Math.cos(a * TAU) * (0.03 + p * 0.18),
      0.018 + p * 0.09,
      Math.sin(a * TAU) * (0.03 + p * 0.18) + (b - 0.5) * 0.05,
    ],
    fade: (p) => Math.min(1, p * 9) * (1 - p) * (1 - p) * 0.32,
  },
  // Reads as backlit motes drifting down through the canopy rather than as opaque leaf
  // silhouettes; an opaque leaf needs alpha blending, which needs the second draw call this layer
  // exists to avoid. Screenshotted at vellenwood_canopy — it sells "the wood is alive", which is
  // the job, and it costs nothing.
  leaf: {
    lifeMs: 7000, size: [0.2, 0.2], colour: [0.38, 0.30, 0.10], defaultCount: 10, cullMetres: 55,
    motion: (p, a, b, c) => [
      Math.cos(a * TAU + p * 5.5) * (1.4 + b * 2.2) + (c - 0.5) * 4,
      (1 - p) * (5.5 + b * 2.5),
      Math.sin(a * TAU + p * 5.5) * (1.4 + b * 2.2) + (a - 0.5) * 4,
    ],
    fade: (p) => Math.min(1, p * 8) * Math.min(1, (1 - p) * 6),
  },
  spark: {
    lifeMs: 900, size: [0.1, 0.03], colour: [1.0, 0.42, 0.09], defaultCount: 14, cullMetres: 35,
    motion: (p, a, b) => [
      Math.cos(a * TAU) * (0.25 + b * 0.5) * p,
      p * (1.5 + b * 1.1) - p * p * 2.6,
      Math.sin(a * TAU) * (0.25 + b * 0.5) * p,
    ],
    fade: (p) => (1 - p) * (1 - p),
  },
  splash: {
    lifeMs: 700, size: [0.12, 0.05], colour: [0.42, 0.55, 0.62], defaultCount: 9, cullMetres: 45,
    motion: (p, a, b) => [
      Math.cos(a * TAU) * (0.2 + b * 0.35) * p,
      p * 1.5 - p * p * 2.4,
      Math.sin(a * TAU) * (0.2 + b * 0.35) * p,
    ],
    fade: (p) => Math.min(1, p * 8) * (1 - p),
  },
  ripple: {
    lifeMs: 2600, size: [0.35, 2.6], colour: [0.20, 0.26, 0.29], defaultCount: 3, cullMetres: 55,
    flat: true,
    motion: (_p, a, b) => [(a - 0.5) * 0.7, 0.02, (b - 0.5) * 0.7],
    fade: (p) => Math.min(1, p * 6) * (1 - p) * (1 - p),
  },
  flame: {
    lifeMs: 620, size: [0.42, 0.12], colour: [1.0, 0.52, 0.14], defaultCount: 5, cullMetres: 30,
    motion: (p, a) => [(a - 0.5) * 0.09, 0.05 + p * 0.34, (a - 0.5) * 0.07],
    fade: (p) => Math.min(1, p * 4) * (1 - p),
  },
};

/** Hard cap on live particles. 640 quads is 1,280 triangles — noise against a 3.77 M frame. */
const MAX_PARTICLES = 640;
const MAX_BURSTS = 48;

/**
 * World ambience uses one additive batch for smoke, sparks, leaf motes, splashes and flame.
 * Footstep dust uses one small alpha-blended batch so overlapping puffs cannot emit bright light.
 * Both batches disappear when empty and share the existing total particle cap.
 *
 * Dust uses Three's built-in RGBA vertex colours on an instanced attribute. Its opacity can fade
 * per particle without a custom shader or changing the other effects' additive material.
 */
export class Ambience {
  private readonly mesh: THREE.InstancedMesh;
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly dustColours: THREE.InstancedBufferAttribute;
  private readonly emitters = new Map<string, AmbienceEmitter>();
  private readonly bursts: Burst[] = [];
  private readonly cullScale: number;
  private live = 0;
  private additiveLive = 0;
  private dustLive = 0;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly billboard = new THREE.Quaternion();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly colour = new THREE.Color();

  constructor(parent: THREE.Object3D, options: { maxParticles?: number; cullScale?: number } = {}) {
    const capacity = Math.max(1, Math.min(options.maxParticles ?? MAX_PARTICLES, 4096));
    this.cullScale = options.cullScale ?? 1;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: softSpriteTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Fog on an additive sprite ADDS the fog colour on top of the world instead of fading the
      // sprite into it, so a distant puff prints brighter than a near one. Fog is Fog(0xb8cfe0,
      // 30, 300), so the 75 m smoke cull is well past its near plane and this matters.
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = "ambience";
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 7;
    // The instances span the world, so a bounding sphere would cover it; the test would never cull
    // and would cost a recompute every frame the set changes.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    parent.add(this.mesh);

    const dustGeometry = new THREE.PlaneGeometry(1, 1);
    // `instanceColor` is RGB-only. An instanced geometry colour attribute with four components
    // selects USE_COLOR_ALPHA in Three's built-in material shader instead.
    this.dustColours = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.dustColours.setUsage(THREE.DynamicDrawUsage);
    dustGeometry.setAttribute("color", this.dustColours);
    const dustMaterial = new THREE.MeshBasicMaterial({
      map: material.map,
      vertexColors: true,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      fog: true,
      toneMapped: true,
    });
    this.dustMesh = new THREE.InstancedMesh(dustGeometry, dustMaterial, capacity);
    this.dustMesh.name = "ambience-dust";
    this.dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dustMesh.castShadow = false;
    this.dustMesh.receiveShadow = false;
    this.dustMesh.renderOrder = 6;
    this.dustMesh.frustumCulled = false;
    this.dustMesh.count = 0;
    this.dustMesh.visible = false;
    parent.add(this.dustMesh);
  }

  addEmitter(emitter: AmbienceEmitter): void {
    this.emitters.set(emitter.id, emitter);
  }

  removeEmitter(id: string): void {
    this.emitters.delete(id);
  }

  clearEmitters(): void {
    this.emitters.clear();
    this.bursts.length = 0;
  }

  /** A one-shot puff: a footfall, a rod hitting the water, a hammer landing on the anvil. */
  burst(kind: AmbienceKind, position: Vec3, count: number, nowMs: number): void {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({
      kind,
      x: position[0], y: position[1], z: position[2],
      // The seed is the birth millisecond, so two bursts at the same spot in the same frame share
      // a shape and consecutive ones do not. `Math.imul` because `nowMs * 2654435761` is past 2^53
      // within a minute of page load and silently loses its low bits. No rng stream is touched.
      seed: Math.imul(Math.round(nowMs), 2654435761) >>> 0,
      count: Math.max(1, Math.min(count, 32)),
      bornAtMs: nowMs,
    });
  }

  /**
   * Rewrites every live instance. Called from `Vfx.update`, so it ticks on the render clock.
   *
   * `facing` is the camera's world rotation; every non-flat particle copies it verbatim, which is
   * a screen-aligned billboard and costs one quaternion copy per instance instead of a look-at.
   */
  update(nowMs: number, viewer: THREE.Vector3, facing?: THREE.Quaternion): void {
    if (facing) this.billboard.copy(facing);
    this.live = 0;
    this.additiveLive = 0;
    this.dustLive = 0;
    const capacity = this.mesh.instanceMatrix.count;

    for (const emitter of this.emitters.values()) {
      const profile = PROFILES[emitter.kind];
      const cull = (emitter.cullMetres ?? profile.cullMetres) * this.cullScale;
      const dx = emitter.position[0] - viewer.x;
      const dz = emitter.position[2] - viewer.z;
      if (dx * dx + dz * dz > cull * cull) continue;

      const seed = hashString(emitter.id);
      const count = emitter.count ?? profile.defaultCount;
      const emitterScale = emitter.scale ?? 1;
      for (let index = 0; index < count && this.live < capacity; index += 1) {
        const offset = hash01(seed, index, 0);
        const phase = fract(nowMs / profile.lifeMs + offset);
        this.writeParticle(profile, phase, seed, index, emitter.position, emitterScale);
      }
    }

    for (let slot = this.bursts.length - 1; slot >= 0; slot -= 1) {
      const burst = this.bursts[slot]!;
      const profile = PROFILES[burst.kind];
      const phase = (nowMs - burst.bornAtMs) / profile.lifeMs;
      if (phase >= 1 || phase < 0) {
        this.bursts.splice(slot, 1);
        continue;
      }
      const dx = burst.x - viewer.x;
      const dz = burst.z - viewer.z;
      const cull = profile.cullMetres * this.cullScale;
      if (dx * dx + dz * dz > cull * cull) continue;
      for (let index = 0; index < burst.count && this.live < capacity; index += 1) {
        this.writeParticle(profile, phase, burst.seed, index, [burst.x, burst.y, burst.z], 1);
      }
    }

    this.mesh.count = this.additiveLive;
    this.mesh.visible = this.additiveLive > 0;
    if (this.additiveLive > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.dustMesh.count = this.dustLive;
    this.dustMesh.visible = this.dustLive > 0;
    if (this.dustLive > 0) {
      this.dustMesh.instanceMatrix.needsUpdate = true;
      this.dustColours.needsUpdate = true;
    }
  }

  /** Live particle count. 0 means the layer costs nothing at all this frame. */
  liveParticles(): number {
    return this.live;
  }

  emitterCount(): number {
    return this.emitters.size;
  }

  /** One draw per nonempty batch, with a second batch only while dust is alive. */
  drawCalls(): number {
    return Number(this.mesh.visible) + Number(this.dustMesh.visible);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.dustMesh.removeFromParent();
    this.dustMesh.geometry.dispose();
    (this.dustMesh.material as THREE.Material).dispose();
    this.dustMesh.dispose();
    this.emitters.clear();
    this.bursts.length = 0;
  }

  private writeParticle(
    profile: KindProfile,
    phase: number,
    seed: number,
    index: number,
    origin: Vec3,
    emitterScale: number,
  ): void {
    const a = hash01(seed, index, 1);
    const b = hash01(seed, index, 2);
    const c = hash01(seed, index, 3);
    const offset = profile.motion(phase, a, b, c);
    const brightness = profile.fade(phase);
    if (brightness <= 0.004) return;

    const size = (profile.size[0] + (profile.size[1] - profile.size[0]) * phase)
      * emitterScale * (0.75 + a * 0.5);
    this.position.set(
      origin[0] + offset[0] * emitterScale,
      origin[1] + offset[1] * emitterScale,
      origin[2] + offset[2] * emitterScale,
    );
    this.scale.set(size, size * (profile.aspect ?? 1), size);
    this.matrix.compose(this.position, profile.flat ? this.flat : this.billboard, this.scale);
    if (profile.alphaBlend) {
      this.dustMesh.setMatrixAt(this.dustLive, this.matrix);
      this.dustColours.setXYZW(
        this.dustLive, profile.colour[0], profile.colour[1], profile.colour[2], brightness,
      );
      this.dustLive += 1;
    } else {
      this.mesh.setMatrixAt(this.additiveLive, this.matrix);
      this.colour.setRGB(
        profile.colour[0] * brightness,
        profile.colour[1] * brightness,
        profile.colour[2] * brightness,
      );
      this.mesh.setColorAt(this.additiveLive, this.colour);
      this.additiveLive += 1;
    }
    this.live += 1;
  }
}

/** A 32 x 32 soft round sprite. White with a squared radial falloff; 4 KB, generated once. */
function softSpriteTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const falloff = clamp01(1 - Math.hypot(dx, dy));
      const value = Math.round(falloff * falloff * 255);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = value;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** FNV-1a over the emitter id, so the same chimney smokes the same way on every reload. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Integer hash to 0..1. Deterministic, allocation-free, and not an rng stream draw. */
function hash01(seed: number, index: number, salt: number): number {
  let hash = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97) >>> 0;
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}
