/**
 * World-space health bars: one over the player and one over every creature in the fight.
 *
 * Which creatures are "in the fight" is not this file's call. `state.combat.targetId` and
 * `state.combat.engagedBy` already answer it - the same two fields `api/gameApi.ts` folds into
 * `PlayerView.inCombat` - so a bar appears for exactly the creatures the sim says are engaged and
 * for nobody else. A creature that merely wandered past never gets one; a creature that aggroed
 * from behind gets one before its first blow lands, because `systems/enemyAI.ts` engages on aggro.
 *
 * Pure presentation, like `render/vfx.ts`: the bars read the store and the entity views, and write
 * only DOM. Deleting this file makes a fight harder to read, not different.
 *
 * DOM rather than sprites for the same reason `.world-label` and `.vfx-float` are DOM: a crisp
 * 1 px border at every zoom, no texture atlas, and it composes with the rest of the HUD's styling.
 * The cost is one projection per bar per frame, and there are never more than a handful.
 *
 * The bar sits just above the drawn silhouette, which is measured from the entity views rather
 * than authored: `content/regions.ts` gives every creature the same 2.2 m label height, and a frog
 * is not 2.2 m tall. Measuring is a full bounds walk, so it is sampled on a slow cadence and
 * cached; the walk cycle bobs the top by a few centimetres, and re-measuring that every frame would
 * be paying for jitter.
 */
import * as THREE from "three";
import type { EntityId, SemanticEntity, Vec3 } from "../contracts.js";
import { PLAYER_HEIGHT } from "../app/config.js";

/** The slice of the sim the bars read each frame. */
export interface PlayerVitals {
  health: number;
  maxHealth: number;
  targetId: EntityId | null;
  engagedBy: readonly EntityId[];
}

export interface HealthBarDeps {
  camera: THREE.Camera;
  /** Where the bars are mounted. One container is appended here and removed on dispose. */
  root: HTMLElement;
  /** Semantic state for a creature: its vitals, its name and whether it has died. */
  entity(entityId: EntityId): SemanticEntity | null;
  /** Where the entity is DRAWN this frame, interpolated, so the bar does not step at the sim rate. */
  drawnPosition(entityId: EntityId): Vec3 | null;
  /**
   * Top of the drawn silhouette in metres above `drawnPosition`, or null when nothing is drawn yet.
   * Allowed to be expensive: it is polled at `TOP_SAMPLE_INTERVAL_MS`, not per frame.
   */
  drawnTop(entityId: EntityId): number | null;
  /**
   * Top of the player's drawn rig in metres above its feet, or null when there is no rig. Same
   * cadence as `drawnTop`. Without it the bar assumes the configured player height, which the
   * drawn body does not reach: its head sits lower, and a bar at 1.8 m plus clearance floats.
   */
  playerTop?(): number | null;
  player(): PlayerVitals;
}

interface Bar {
  element: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  isPlayer: boolean;
  /** The last ratio written to the fill, so an unchanged frame writes nothing. */
  ratio: number;
  /** The pale trail behind the fill: where health WAS, sliding down to where it is. */
  ghostRatio: number;
  /** When the ratio last dropped, so the trail holds for a beat before it follows. */
  hitAtMs: number;
  /** Metres above the drawn position, cached from `drawnTop`. */
  top: number;
  topSampledAtMs: number;
  /** Null while the bar is wanted; otherwise when the linger ends and the bar is removed. */
  hideAtMs: number | null;
  /** Everything written to `style`/`classList` last frame, to skip identical writes. */
  signature: string;
  visible: boolean;
}

/** How long a bar stays after its fight ends, so a kill reads as "empty" rather than "gone". */
export const LINGER_MS = 1500;
/** The last part of the linger fades. */
const FADE_MS = 450;
/** How long the ghost trail holds after a hit before sliding down to the fill. */
const GHOST_HOLD_MS = 240;
/** Ghost slide speed in ratio units per second: a full bar drains in about 1.2 s. */
const GHOST_RATE_PER_S = 0.85;
/** Re-measure the drawn top this often. Between samples the cached value is used. */
export const TOP_SAMPLE_INTERVAL_MS = 500;
/**
 * Clear air between the top of the silhouette and the bar, in metres. Small on purpose: the bar
 * has to read as belonging to the head under it, and at the default camera 0.1 m is about 8 px.
 */
const CREATURE_LIFT_METRES = 0.18;
const PLAYER_LIFT_METRES = 0.2;
/** A measured top outside this range is a broken bounds walk, not a creature; fall back. */
const MIN_TOP_METRES = 0.35;
const MAX_TOP_METRES = 9;
/** Past this the bar would be a few pixels over a speck, and reads as noise. */
const MAX_DISTANCE_METRES = 48;
/** More creature bars than this at once is a mob, and the bars stop being individually readable. */
const MAX_CREATURE_BARS = 24;
/** Width scales gently with body radius, so a bear's bar is not a frog's. */
const BAR_WIDTH_MIN_PX = 54;
const BAR_WIDTH_MAX_PX = 96;
const BAR_WIDTH_PER_RADIUS_PX = 28;

/** Green while it is fine, brass while it is going, red while it matters: the HUD's own rule. */
export function healthColour(ratio: number): string {
  return ratio > 0.6 ? "#6b9c52" : ratio > 0.3 ? "#c9a227" : "#c9553d";
}

export class HealthBars {
  private readonly bars = new Map<string, Bar>();
  private readonly container: HTMLElement;
  private readonly projected = new THREE.Vector3();
  private readonly cameraPosition = new THREE.Vector3();
  private lastFrameAtMs: number | null = null;

  constructor(private readonly deps: HealthBarDeps) {
    this.container = document.createElement("div");
    this.container.className = "hp-bars is-passive";
    this.deps.root.appendChild(this.container);
  }

  /** How many bars are showing, for tests and the debug surface. */
  count(): number {
    return this.bars.size;
  }

  /** Entity ids with a live bar, "player" included. */
  ids(): string[] {
    return [...this.bars.keys()];
  }

  /**
   * Per frame. `playerRenderPosition` is the player as DRAWN this frame, interpolated between sim
   * ticks; the store's own position steps ten times a second and the bar would step with it.
   */
  update(nowMs: number, playerRenderPosition: Vec3): void {
    const deltaS = this.lastFrameAtMs === null ? 0 : Math.max(0, (nowMs - this.lastFrameAtMs) / 1000);
    this.lastFrameAtMs = nowMs;

    const vitals = this.deps.player();
    const wanted = new Set<EntityId>();
    if (vitals.targetId !== null) wanted.add(vitals.targetId);
    for (const id of vitals.engagedBy) {
      if (wanted.size >= MAX_CREATURE_BARS) break;
      wanted.add(id);
    }
    const inCombat = wanted.size > 0;

    // Wanted bars are created or kept; everything else starts its linger.
    for (const id of wanted) this.want(id, false);
    if (inCombat) this.want("player", true);
    for (const [key, bar] of this.bars) {
      const stillWanted = bar.isPlayer ? inCombat : wanted.has(key);
      if (!stillWanted && bar.hideAtMs === null) bar.hideAtMs = nowMs + LINGER_MS;
    }

    this.cameraPosition.setFromMatrixPosition(this.deps.camera.matrixWorld);

    for (const [key, bar] of this.bars) {
      if (bar.hideAtMs !== null && nowMs >= bar.hideAtMs) {
        this.remove(key);
        continue;
      }

      let health: number;
      let maxHealth: number;
      let position: Vec3 | null;
      let targeted = false;
      let dead = false;
      let bodyRadius = 0;
      if (bar.isPlayer) {
        health = vitals.health;
        maxHealth = vitals.maxHealth;
        position = playerRenderPosition;
        if (nowMs - bar.topSampledAtMs >= TOP_SAMPLE_INTERVAL_MS) {
          bar.topSampledAtMs = nowMs;
          bar.top = this.measurePlayerTop();
        }
      } else {
        const entity = this.deps.entity(key);
        // A creature that left the world (region change, lab respawn) takes its bar with it.
        if (!entity || !entity.combat) {
          this.remove(key);
          continue;
        }
        health = entity.combat.health;
        maxHealth = entity.combat.maxHealth;
        dead = entity.state === "dead" || health <= 0;
        targeted = vitals.targetId === key;
        bodyRadius = entity.combat.bodyRadius ?? 0;
        position = this.deps.drawnPosition(key) ?? entity.position;
        if (nowMs - bar.topSampledAtMs >= TOP_SAMPLE_INTERVAL_MS) {
          bar.topSampledAtMs = nowMs;
          bar.top = this.measureTop(key, entity);
        }
      }

      const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 0;
      if (ratio < bar.ratio) bar.hitAtMs = nowMs;
      bar.ratio = ratio;
      // The ghost holds where the health was, then slides down. A heal snaps it up: a trail above
      // the fill is "damage you just took", and a heal is not that.
      if (ratio >= bar.ghostRatio) bar.ghostRatio = ratio;
      else if (nowMs - bar.hitAtMs >= GHOST_HOLD_MS) {
        bar.ghostRatio = Math.max(ratio, bar.ghostRatio - GHOST_RATE_PER_S * deltaS);
      }

      // Project the anchor. Behind the camera or too far away: hidden, not removed, because the
      // camera can swing back next frame.
      this.projected.set(position[0], position[1] + bar.top, position[2]);
      const distance = this.projected.distanceTo(this.cameraPosition);
      this.projected.project(this.deps.camera);
      const offscreen = this.projected.z > 1 || distance > MAX_DISTANCE_METRES
        || this.projected.x < -1.1 || this.projected.x > 1.1 || this.projected.y < -1.1 || this.projected.y > 1.1;
      if (offscreen) {
        if (bar.visible) {
          bar.element.style.display = "none";
          bar.visible = false;
        }
        continue;
      }
      if (!bar.visible) {
        bar.element.style.display = "block";
        bar.visible = true;
      }
      const x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;
      bar.element.style.left = `${x.toFixed(1)}px`;
      bar.element.style.top = `${y.toFixed(1)}px`;

      const opacity = bar.hideAtMs === null ? 1
        : Math.max(0, Math.min(1, (bar.hideAtMs - nowMs) / FADE_MS));
      const width = bar.isPlayer ? 0
        : Math.round(Math.max(BAR_WIDTH_MIN_PX, Math.min(BAR_WIDTH_MAX_PX, BAR_WIDTH_MIN_PX + bodyRadius * BAR_WIDTH_PER_RADIUS_PX)));
      const signature = `${ratio.toFixed(3)}|${bar.ghostRatio.toFixed(3)}|${opacity.toFixed(2)}|${targeted}|${dead}|${width}`;
      if (signature === bar.signature) continue;
      bar.signature = signature;

      bar.fill.style.width = `${(ratio * 100).toFixed(1)}%`;
      bar.ghost.style.width = `${(bar.ghostRatio * 100).toFixed(1)}%`;
      bar.element.style.setProperty("--bar-colour", healthColour(ratio));
      bar.element.style.opacity = opacity === 1 ? "" : opacity.toFixed(2);
      if (width > 0) bar.element.style.width = `${width}px`;
      bar.element.classList.toggle("is-target", targeted);
      bar.element.classList.toggle("is-dead", dead);
      bar.element.classList.toggle("is-low", ratio <= 0.3 && !dead);
      bar.element.setAttribute("aria-valuenow", String(Math.max(0, Math.round(health))));
      bar.element.setAttribute("aria-valuemax", String(Math.round(maxHealth)));
    }
  }

  dispose(): void {
    for (const key of [...this.bars.keys()]) this.remove(key);
    this.container.remove();
  }

  private want(key: string, isPlayer: boolean): void {
    const existing = this.bars.get(key);
    if (existing) {
      // Re-engaged mid-linger: the same bar comes back rather than a fresh one popping in.
      existing.hideAtMs = null;
      return;
    }
    const element = document.createElement("div");
    element.className = isPlayer ? "hp-bar hp-bar--player" : "hp-bar hp-bar--creature";
    element.dataset["entityId"] = key;
    element.setAttribute("role", "progressbar");
    element.setAttribute("aria-valuemin", "0");
    element.style.display = "none";
    const ghost = document.createElement("div");
    ghost.className = "hp-bar__ghost";
    const fill = document.createElement("div");
    fill.className = "hp-bar__fill";
    element.appendChild(ghost);
    element.appendChild(fill);
    this.container.appendChild(element);

    // Seeded at the current ratio so the first frame draws a full-width ghost under a full fill,
    // not a trail sliding down from 100% on a creature that was already hurt.
    const initial = isPlayer ? this.deps.player() : this.deps.entity(key)?.combat ?? null;
    const ratio = initial && initial.maxHealth > 0
      ? Math.max(0, Math.min(1, initial.health / initial.maxHealth)) : 1;
    this.bars.set(key, {
      element, fill, ghost, isPlayer,
      ratio, ghostRatio: ratio, hitAtMs: Number.NEGATIVE_INFINITY,
      top: PLAYER_HEIGHT + PLAYER_LIFT_METRES, topSampledAtMs: Number.NEGATIVE_INFINITY,
      hideAtMs: null, signature: "", visible: false,
    });
  }

  private measurePlayerTop(): number {
    const measured = this.deps.playerTop?.() ?? null;
    if (measured !== null && Number.isFinite(measured) && measured >= MIN_TOP_METRES && measured <= MAX_TOP_METRES) {
      return measured + PLAYER_LIFT_METRES;
    }
    return PLAYER_HEIGHT + PLAYER_LIFT_METRES;
  }

  private measureTop(entityId: EntityId, entity: SemanticEntity): number {
    const measured = this.deps.drawnTop(entityId);
    if (measured !== null && Number.isFinite(measured) && measured >= MIN_TOP_METRES && measured <= MAX_TOP_METRES) {
      return measured + CREATURE_LIFT_METRES;
    }
    return (entity.view?.labelHeight ?? 1.6) + CREATURE_LIFT_METRES;
  }

  private remove(key: string): void {
    const bar = this.bars.get(key);
    if (!bar) return;
    bar.element.remove();
    this.bars.delete(key);
  }
}
