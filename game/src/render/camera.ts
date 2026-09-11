/**
 * Elevated third-person MMO camera: orbit yaw, adjustable pitch, zoom, smooth follow.
 * Readable framing over twitch responsiveness, per the brief.
 *
 * Two round-1 additions. The follow smoothing is frame-rate independent — the round-0 fixed lerp
 * per frame meant the camera lagged twice as far at 30 FPS as at 60, which shows up as inconsistent
 * screenshots. And there is an occlusion spring: when something solid sits between the player and
 * the camera, the camera pulls in rather than filming the inside of a Karrowmoor terrace.
 *
 * What changed in the world-polish wave, and why. `CAMERA.defaultPitch` dropped from 0.72 to 0.52.
 * At 0.72 and distance 18 the camera sat sin(0.72) * 18 = 11.9 m above the player, which is above
 * every roofline in the game, so the probe segment cleared every building: 0 occluded frames of
 * 3,449 around Coldbrace square, 0 of 1,202 under the Vellenwood canopy, 0 of 1,001 inside the
 * Gravelmaw chamber. At 0.52 the camera lives in the world, so the spring now fires constantly and
 * three things that did not matter at 11.9 m of clearance suddenly do: a single centre-line probe
 * lets the camera's edges bury themselves in a wall the centre ray misses; a blocker that clears
 * for one frame makes the camera lurch back out; and vertical follow that tracks the player exactly
 * turns every terrace step into a visible bob because the horizon is now near the middle of frame.
 * All three are handled below.
 *
 * What changed in the second polish wave, and why. The occlusion probe is a PHYSICS raycast, and
 * the physics world does not contain the roofs you walk under. `prefabCollision("porch")` emits a
 * back wall and two 0.4 m posts and no canopy; `"arcade"` emits a back wall and nothing else;
 * `"forge"` emits three walls and no roof; `"well"` emits a 1.6 m curb under a 3.3 m roof. That is
 * deliberate — those five prefabs exist precisely because they have no doorway to erode — but it
 * means the camera could not see the one thing it kept parking inside. Measured at the `bank`
 * pose: the probe reported its first blocker at 5.865 m, which is the vault tower's east face at
 * x = -165, and the camera settled at 5.415 m and y = 4.91, while the bank porch's canopy sits at
 * y 3.87..4.25 across x -164.72..-162.28. 80% of the frame was the underside of a roof the camera
 * had no way to know about. `OVERHEAD_COVER` below closes that hole analytically.
 */
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import { CAMERA } from "../app/config.js";
import { clamp } from "../core/math.js";
import { REGIONS, type PrefabId } from "../content/regions.js";
import type { KitId } from "./buildings.js";

/**
 * Line-of-sight query the camera uses to decide whether it can see the player.
 *
 * Contract, and the root owns every part of it:
 *  - `from` is the player's head, roughly 1.1 m above the feet. `to` is where the camera WANTS to
 *    sit this frame, already at the current yaw/pitch/zoom.
 *  - Return the distance IN METRES from `from` to the first solid hit along that segment, or
 *    `null` when the line is clear. Anything non-finite, negative, or beyond the segment is
 *    ignored, so a physics raycast that reports "no hit" as `Infinity` is safe to pass through.
 *  - The probe must exclude the player's own collider, or the camera will jam at the minimum
 *    distance permanently.
 *  - It is called five times when the requested pose is usable and twenty-five at worst, and must
 *    not allocate. It was one call per frame until the centre ray proved insufficient at pitch
 *    0.52: four of the five are parallel offsets that keep the camera's edges out of a wall the
 *    centre ray slips past, and the pose is re-probed once per `PITCH_STEPS` candidate. The worst
 *    case only happens on a frame the authored pose cannot see the player from.
 */
export type OcclusionProbe = (from: Vec3, to: Vec3) => number | null;

// ------------------------------------------------------- overhead cover (walk-under roofs)

/**
 * One roof you can walk under, as an oriented box the camera treats as solid.
 *
 * Y is stored as metres ABOVE THE SETTLEMENT'S GROUND rather than as a world height, because this
 * file cannot read the terrain: `render/camera.ts` is handed a `THREE.PerspectiveCamera` and a
 * raycast closure and nothing else. The player's own feet supply the ground reference, which is
 * exact inside a settlement — every one of them stands on a flattened pad, and the worst measured
 * disagreement is 0.086 m (Coldbrace's pad reads 0.894 and the player at `bank_interior` stands at
 * 0.980). `COVER_RANGE_METRES` keeps that assumption honest by ignoring anything further away.
 */
interface CoverSlab {
  readonly ownerId: string;
  /** World centre of the covered rectangle, including the prefab's own local offset. */
  readonly cx: number;
  readonly cz: number;
  /** Half extents along the building's local width and depth axes. */
  readonly hx: number;
  readonly hz: number;
  /** The building's `rotationY`, precomputed. */
  readonly cos: number;
  readonly sin: number;
  /** Underside and top of the canopy, metres above the pad. */
  readonly soffit: number;
  readonly top: number;
}

/**
 * Only cover within this range of the player is considered.
 *
 * Two reasons, and both are real. The slab's Y band is relative to the player's own ground, so a
 * canopy on a terrace 20 m below would be tested at the wrong height entirely. And the camera
 * never sits further than `CAMERA.maxAuthoredDistance` 34 m from the player, so a roof 26 m away
 * can only be on the sight line when it is nearly behind the camera.
 */
const COVER_RANGE_METRES = 26;

/**
 * The world's walk-under roofs, in world space. Built once, from authored data, with no RNG.
 *
 * The bands below are measured, in the running game, with `__gameDebug.getDrawnBounds` on the
 * emitted part entities minus `__gameDebug.groundHeight` at the building's own origin — see
 * runs/corealm/audit/cam-cover2.ts. `world/regionBuilder.ts` now emits each authored part scale
 * unchanged, so these rectangles use the same 1:1 dimensions as the building generator.
 */
let coverCache: readonly CoverSlab[] | null = null;

function overheadCover(): readonly CoverSlab[] {
  if (coverCache) return coverCache;
  const slabs: CoverSlab[] = [];
  for (const region of REGIONS) {
    if (!region.settlement) continue;
    const kit = region.settlement.kit;
    for (const building of region.settlement.buildings) {
      const rect = coverRect(building.prefab, building.footprint, kit);
      if (!rect) continue;
      const cos = Math.cos(building.rotationY);
      const sin = Math.sin(building.rotationY);
      // Local -> world is (x, z) => (cos*lx + sin*lz, -sin*lx + cos*lz), matching `emitParts`.
      slabs.push({
        ownerId: building.id,
        cx: building.position[0] + sin * rect.dz,
        cz: building.position[1] + cos * rect.dz,
        hx: rect.hx,
        hz: rect.hz,
        cos,
        sin,
        soffit: rect.soffit,
        top: rect.top,
      });
    }
  }
  coverCache = slabs;
  return slabs;
}

/**
 * The canopy of one walk-under prefab, in its own local frame. `null` for anything whose collision
 * box already includes its roof volume, which is every other prefab.
 *
 * Measured bands, above the building's own ground:
 *   porch/arcade, plaster or timber  canopy soffit 2.68, top 3.03
 *   porch/arcade, stone              slab 3.13..3.39 over a separate wall
 *   well                              roof soffit 2.03, top 3.30
 *   gatehouse passage                 deck soffit 3.113, top 3.133
 * The 2.68 soffit is buildings.ts's own measurement of both canopy meshes ("both canopies soffit
 * at 2.68 or higher"); the drawn bounds cannot supply it, because `overhang_plaster` is one mesh
 * holding the wall and the canopy together and its box therefore starts at the ground.
 *
 * Two prefabs are deliberately absent, and both for the same reason: a box is only honest about a
 * FLAT canopy.
 *
 * `forge` was in here and was taken back out after it was measured. Its roof is a gable — Coldbrace
 * draws 2.40..8.28 m over a 7.66 x 10.52 m plan — and a box from eave to ridge claims 5.9 m of
 * solid air that the tent shape does not occupy. Measured cost at the `highcairn` pose: the sight
 * line crosses the forge at z = -70 and y = 31.35, which is under the 33.74 m ridge but well clear
 * of the roof surface there, and the box cut the shot from 26 m to 2.6 m. The forge already
 * collides on three walls at full height, so the only ray it misses is one that clears a 6.12 m
 * wall and comes back down through the roof; that residual is much cheaper than the over-block.
 *
 * `market_row` has never been authored by any settlement, so there is nothing to measure, and its
 * awnings are per-pitch with walkable gaps between them.
 */
function coverRect(
  prefab: PrefabId,
  footprint: readonly [number, number],
  kit: KitId,
): { dz: number; hx: number; hz: number; soffit: number; top: number } | null {
  const width = footprint[0];
  const depth = footprint[1];
  switch (prefab) {
    case "gatehouse":
      // Only the first passage deck is a flat overhead slab. The new pitched crown is deliberately
      // excluded: representing its whole ridge as a box would pull the camera in through empty air.
      return { dz: 0, hx: Math.min(2, width / 2), hz: depth / 2, soffit: 3.113, top: 3.133 };
    case "porch":
    case "arcade": {
      // The canopy hangs off the back wall and stops 2 m out (`CANOPY_DEPTH_METRES`). On a 3 m
      // footprint the front 0.8 m is open sky, and covering it would make the camera duck lower
      // than the real eave needs.
      const back = -depth / 2 - 0.25;
      const front = -depth / 2 + 2 + 0.25;
      const band = kit === "stone"
        // `coveredBay` puts `overhang_brick` at STOREY_METRES + 0.324 = 3.447, and the slab hangs
        // below its pivot. These are the resulting authored-scale bounds.
        ? { soffit: 3.129, top: 3.393 }
        : { soffit: 2.68, top: 3.03 };
      return { dz: (back + front) / 2, hx: width / 2 + 0.2, hz: (front - back) / 2, ...band };
    }
    case "well":
      // Both the paired plank canopy and the compact tiled variant stay inside 1.8 x 2.4 m. The
      // old footprint + 0.6 box claimed an extra 0.7 m2 of empty air and made the camera duck when
      // it passed beside, rather than beneath, a well roof.
      return { dz: 0, hx: 0.9, hz: 1.2, soffit: 2.03, top: 3.3 };
    default:
      return null;
  }
}

/** Metres of clearance kept in front of whatever the probe hit, so the near plane never enters it. */
const OCCLUSION_PADDING = 0.45;

/**
 * Lateral offsets for the extra probes, as fractions of the camera's own right and up axes.
 *
 * Sized to the near plane, not to a notional camera body. At FOV 55, aspect 1.78 and near 0.1 the
 * near plane's corner radius is 0.106 m, so 0.18 covers it with margin. The first attempt used
 * 0.4 m and it over-fired: a roof edge grazing 0.4 m off the sight line pulled the whole camera
 * from 15 m to 4.35 m at the Coldbrace bank, for an obstacle that was never in frame.
 */
const PROBE_OFFSET_METRES = 0.18;
const PROBE_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** Per-60 Hz-frame rates for prompt, smooth collision recovery. */
const PULL_IN_RATE = 0.4;
const EASE_OUT_RATE = 0.3;

/**
 * Extra pitch the camera is allowed to climb when something blocks the shot, in radians.
 *
 * Measured need: standing at the Coldbrace bank at pitch 0.52 and distance 18, the camera wants to
 * sit 11 m up and 15.6 m back, and the ray to it passes through a roofline 5 m behind the player.
 * The spring alone answers that by pulling in to 4.5 m, which is a shoulder-cam in a street the
 * player is trying to read. Climbing instead is what the old 0.72 pitch did for free, and it keeps
 * the frame. Tried in order, first one that clears wins, so the flat shot is always preferred.
 *
 * Capped at 0.24 rad (13.7 degrees) deliberately. An earlier version allowed 0.44 and the
 * `town_center` shot climbed from its authored 0.62 to 1.06, which is a map view: the square read
 * as a plan drawing and the player was four pixels tall. The colliders are boxes that include the
 * roof volume, so the probe reports blockers a rendered roofline does not have, and an unbounded
 * climb turns every one of those into a bird's-eye frame. 0.24 was enough for every pose measured:
 * `karrowmoor_terraces` recovers its full 34 m at +0.12.
 *
 * The last two entries are new, and they go DOWN. Climbing is the wrong answer under a roof you
 * are standing beneath: over the Coldbrace bank porch the camera has to reach pitch 0.80 before a
 * probe ray clears the 4.25 m canopy, and inside the forge no pitch clears the roof at all.
 * Dropping under the eave is what a player would do with the mouse. -0.28 rad is 16 degrees, which
 * at the authored pitches (0.34-0.62) still leaves the camera above `CAMERA.minPitch` 0.18.
 *
 * The second number is how bad the flat pose has to be, as a fraction of the requested distance,
 * before that step is allowed at all: the worse the shot, the more freedom the camera gets. A
 * mildly blocked pose is allowed one 7-degree nudge and nothing more, because a 14-degree jump on
 * a shot that was already mostly working is how an authored frame becomes a plan drawing.
 *
 * Measured flat clearance at the four authored poses the probe actually fires on, as a fraction of
 * the requested distance:
 *
 *   bank                 2.80 of 14  (0.20)   nothing clears; it stays flat and pulls in
 *   highcairn            6.27 of 26  (0.24)   +0.24 recovers the full 26 m
 *   town_center         10.12 of 26  (0.39)   climbs are found and the gain gate rejects them
 *   karrowmoor_terraces 23.52 of 34  (0.69)   +0.12 recovers the full 34 m
 *   gravelmaw_entrance  19.65 of 24  (0.82)   above the trigger; no search runs at all
 *
 * `karrowmoor_terraces` is why the trigger is 0.75 and not lower. At 0.65 that pose stopped
 * searching, kept its authored 0.38 rad, and the frame came back 90% one tan boulder
 * (runs/corealm/screenshots/camA-karrowmoor_terraces.png).
 */
const PITCH_STEPS: readonly (readonly [step: number, allowedBelow: number])[] = [
  [0.12, 0.75], [-0.14, 0.75], [0.24, 0.45], [-0.28, 0.45],
];

/** The loosest entry in `PITCH_STEPS`. Above this no step is legal, so the search is skipped. */
const PITCH_SEARCH_TRIGGER_FRACTION = 0.75;

/**
 * Metres of daylight kept under an eave when the camera ducks beneath one. See `eavePitch`.
 *
 * The soffit heights in `coverRect` are asset measurements, and the reference they are stated
 * against is the player's own feet, which is exact on a settlement pad to a worst measured 0.086 m.
 * 0.35 m is four times that and it is also enough that the near plane's 0.106 m corner radius
 * clears the beam rather than grazing it.
 */
const EAVE_CLEARANCE_METRES = 0.35;

/** A climb only counts as having worked if it recovers this much of the requested distance. */
const CLIMB_ACCEPT_FRACTION = 0.8;

/**
 * How much clearance a climb has to buy before it is taken: this many metres, or this fraction of
 * the requested distance, whichever is larger.
 *
 * The fraction is what stops a marginal climb from wrecking a frame. Measured at `town_center`: the
 * flat pose clears 11.2 m of a requested 26 and a climb to 0.86 rad clears 12.7, so a flat 1.5 m
 * threshold took the climb — and traded a readable square at pitch 0.62 for a near-plan view of
 * empty ground for 1.5 m of nothing. At 25% the same case keeps its authored pitch, while
 * `karrowmoor_terraces` still climbs, because there the gain is 13.2 m of a requested 34.
 *
 * Without any gate at all the camera answers a wall it cannot clear by going BOTH steep and close —
 * measured at the Coldbrace bank as pitch 0.96 with distance 4.35.
 */
const CLIMB_MIN_GAIN_METRES = 1.5;
const CLIMB_MIN_GAIN_FRACTION = 0.25;

/** Distance change below this is not worth acting on; it only produces visible jitter. */
const OCCLUSION_DEAD_ZONE = 0.05;

/**
 * Vertical follow runs slower than horizontal follow.
 *
 * The focus point is the player's head, and the player's head steps up and down every terrace,
 * ramp and doorstep in Karrowmoor. At the old 0.72 pitch that motion was mostly along the view
 * axis and invisible; at 0.52 it moves the whole frame vertically. 0.55 of the horizontal rate
 * smooths the step without letting the player drift out of frame — a full 4 m terrace step still
 * settles inside 0.2 s.
 */
const VERTICAL_FOLLOW_SCALE = 0.55;

/**
 * Where the camera aims, above the player's feet. Roughly the head of a 1.8 m rig.
 *
 * Named because `resolveOcclusion` has to subtract it back off to recover the ground the player is
 * standing on, which is the reference every `CoverSlab` height is stated against.
 */
const FOCUS_HEIGHT_METRES = 1.1;

/** A relocation must not ease the focus through the terrain between the two locations. */
const FOLLOW_RELOCATION_METRES = 8;

export class OrbitCamera {
  yaw = Math.PI * 0.15;
  pitch = CAMERA.defaultPitch;
  distance = CAMERA.defaultDistance;

  private readonly focus = new THREE.Vector3();
  private readonly smoothed = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly freeTarget = new THREE.Vector3();
  private freeMove = false;
  /** Preallocated probe scratch. The probe contract forbids allocating; so does calling it. */
  private readonly probeRight = new THREE.Vector3();
  private readonly probeUp = new THREE.Vector3();
  private readonly probeFrom: [number, number, number] = [0, 0, 0];
  private readonly probeTo: [number, number, number] = [0, 0, 0];
  /** `[tMin, tMax]` for the overhead-cover slab test. Scratch, for the same no-allocation reason. */
  private readonly slabRange: [number, number] = [0, 1];
  private initialised = false;
  private lastUpdateMs = 0;
  private occlusionProbe: OcclusionProbe | null = null;
  /** Sees only geometry no cutaway can open, so fixed follow can still refuse to sit inside rock. */
  private hardOcclusionProbe: OcclusionProbe | null = null;
  /** Set for the duration of one hard-blocker clearance pass. */
  private hardProbeOnly = false;
  /** Production follow uses building cutaways instead of changing the player's chosen framing. */
  fixedFollow = false;
  private hiddenRoofs: ReadonlySet<string> = new Set();
  /** The distance actually used this frame, after occlusion. */
  private effectiveDistance = CAMERA.defaultDistance;
  /** Whether the probe reported a blocker on the most recent update. Read by the debug snapshot. */
  private occluded = false;
  /**
   * Whether the LAST `clearance()` call was blocked by a walk-under roof rather than by physics.
   *
   * The two want opposite corrections and only one of them has a closed-form answer, so the pitch
   * search has to be able to tell them apart. See `eavePitch`.
   */
  private coverBlocked = false;
  /** The pitch actually used this frame, after any climb over or duck under an occluder. */
  private effectivePitch = CAMERA.defaultPitch;
  /**
   * What the AUTHORED pitch could see this frame, before any pitch search.
   *
   * Reported in the debug snapshot because "the camera moved" and "the camera had to move" are
   * different facts, and a snapshot that only carries the resolved pose cannot separate them —
   * exactly the hole that hid the `highcairn` climb until a screenshot showed a plan view.
   */
  private flatClearance = CAMERA.defaultDistance;
  private effectiveYaw = this.yaw;
  private probeYaw = this.yaw;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /**
   * Vertical orbit inversion, as a player preference.
   *
   * Applied here rather than at the mouse layer so every route into the camera — drag, keys, a
   * future gamepad — obeys it without each one remembering to.
   */
  invertPitch = false;

  rotate(deltaYaw: number, deltaPitch: number): void {
    if (this.invertPitch) deltaPitch = -deltaPitch;
    this.yaw += deltaYaw;
    const oldPitch = this.pitch;
    this.pitch = clamp(this.pitch + deltaPitch, this.freeMove ? -1.4 : CAMERA.minPitch, CAMERA.maxPitch);
    this.effectivePitch += this.pitch - oldPitch;
  }

  zoom(delta: number): void {
    const oldDistance = this.distance;
    this.distance = clamp(this.distance + delta, CAMERA.minDistance, CAMERA.maxDistance);
    this.effectiveDistance += this.distance - oldDistance;
  }

  /** Detaches camera focus from the player while retaining the production orbit camera. */
  setFreeTarget(position: Vec3 | null): void {
    this.freeMove = position !== null;
    if (position) this.freeTarget.set(position[0], position[1], position[2]);
    else this.pitch = clamp(this.pitch, CAMERA.minPitch, CAMERA.maxPitch);
    this.initialised = false;
  }

  /** Screen-space middle-drag pan projected onto the world XZ plane. */
  panPixels(deltaX: number, deltaY: number, viewportHeight: number): void {
    if (!this.freeMove) return;
    const metresPerPixel = (
      2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)
    ) / Math.max(1, viewportHeight);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const backX = Math.sin(this.yaw);
    const backZ = Math.cos(this.yaw);
    this.freeTarget.x += (-deltaX * rightX + deltaY * backX) * metresPerPixel;
    this.freeTarget.z += (-deltaX * rightZ + deltaY * backZ) * metresPerPixel;
  }

  setPose(
    yaw: number,
    pitch: number,
    distance: number,
    minDistance = CAMERA.minDistance,
  ): void {
    this.yaw = yaw;
    // Free inspection needs to see ceilings and the underside of structures.
    this.pitch = clamp(pitch, this.freeMove ? -1.4 : CAMERA.minPitch, CAMERA.maxPitch);
    this.distance = clamp(distance, minDistance, CAMERA.maxAuthoredDistance);
  }

  /**
   * Wire this to `Physics.raycast` to get the occlusion spring. Left unset, the camera behaves
   * exactly as it did in round 0, so nothing depends on physics being present.
   *
   * Root does:
   *   camera.setOcclusionProbe((from, to) => physics.raycast(from, to, { exclude: playerCollider }));
   *
   * The probe can only report what the physics world contains. Measured at the
   * `karrowmoor_terraces` pose: the spring fires and pulls distance 34 -> 20.76, and the frame is
   * STILL two thirds filled by a tan boulder, because the scatter and landmark rocks carry no
   * collider at all. A camera fix cannot cover for a missing collider; see `OccluderFade` for the
   * part that can be done from here.
   */
  /**
   * The subset of `setOcclusionProbe`'s world that a building cutaway can never remove.
   *
   * Fixed follow deliberately ignores town obstructions, because roofs and walls are opened by the
   * cutaway instead of moving the player's chosen framing. Cave and dungeon rock has no cutaway, so
   * without this the camera sat outside the shell and drew a slab over the player. Leaving it unset
   * keeps the previous fixed-follow behaviour exactly.
   */
  setHardOcclusionProbe(probe: OcclusionProbe | null): void {
    this.hardOcclusionProbe = probe;
  }

  setOcclusionProbe(probe: OcclusionProbe | null): void {
    this.occlusionProbe = probe;
    if (!probe) this.occluded = false;
  }

  /** Ignore analytic canopy slabs for the currently occupied building. */
  setHiddenRoofs(buildingIds: ReadonlySet<string>): void {
    this.hiddenRoofs = buildingIds;
  }

  /** The unobstructed follow seat, used to decide when overhead structures can safely return. */
  requestedPosition(target: Vec3): Vec3 {
    if (this.freeMove) return [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    const horizontal = Math.cos(this.pitch) * this.distance;
    return [target[0] + Math.sin(this.yaw) * horizontal,
      target[1] + FOCUS_HEIGHT_METRES + Math.sin(this.pitch) * this.distance,
      target[2] + Math.cos(this.yaw) * horizontal];
  }

  /** True when the last update pulled the camera in because something blocked the player. */
  isOccluded(): boolean {
    return this.occluded;
  }

  /** Follows the player. `snap` skips smoothing, for teleports and screenshot poses. */
  update(targetX: number, targetY: number, targetZ: number, snap = false): void {
    const now = typeof performance === "undefined" ? 0 : performance.now();
    const deltaMs = this.lastUpdateMs === 0 ? 16.7 : clamp(now - this.lastUpdateMs, 0, 250);
    this.lastUpdateMs = now;

    // Compare consecutive player targets, not the smoothed focus. Ordinary follow lag must not
    // trigger a snap, and a respawn must discard the old location's obstruction spring immediately.
    const relocated = this.initialised && !this.freeMove && Math.hypot(
      targetX - this.focus.x,
      targetY + FOCUS_HEIGHT_METRES - this.focus.y,
      targetZ - this.focus.z,
    ) > FOLLOW_RELOCATION_METRES;
    snap = snap || !this.initialised || relocated;

    if (this.freeMove) {
      this.focus.set(this.freeTarget.x, this.freeTarget.y + FOCUS_HEIGHT_METRES, this.freeTarget.z);
    } else {
      this.focus.set(targetX, targetY + FOCUS_HEIGHT_METRES, targetZ);
    }
    if (!this.initialised || snap) {
      this.smoothed.copy(this.focus);
      this.effectiveDistance = this.distance;
      this.effectivePitch = this.pitch;
      this.initialised = true;
    } else {
      // CAMERA.followLerp is authored as "per 60 Hz frame"; convert it to a per-second rate so the
      // lag is the same wall-clock duration at any frame rate.
      const alpha = 1 - Math.pow(1 - CAMERA.followLerp, deltaMs / 16.667);
      const verticalAlpha = 1 - Math.pow(1 - CAMERA.followLerp * VERTICAL_FOLLOW_SCALE, deltaMs / 16.667);
      this.smoothed.x += (this.focus.x - this.smoothed.x) * alpha;
      this.smoothed.z += (this.focus.z - this.smoothed.z) * alpha;
      this.smoothed.y += (this.focus.y - this.smoothed.y) * verticalAlpha;
    }

    const fixedPose = this.freeMove || this.fixedFollow;
    const resolved = fixedPose
      ? { distance: this.distance, pitch: this.pitch, yaw: this.yaw }
      : this.resolveFollowOcclusion(this.distance);
    if (fixedPose) {
      this.occluded = false;
      this.flatClearance = this.distance;
    }
    this.effectiveYaw = resolved.yaw;

    // Manual orbit and zoom follow input directly. Collision corrections recover without a hold.
    if (snap || fixedPose) {
      this.effectiveDistance = resolved.distance;
      this.effectivePitch = resolved.pitch;
    } else {
      const rate = resolved.distance < this.effectiveDistance ? PULL_IN_RATE : EASE_OUT_RATE;
      const alpha = 1 - Math.pow(1 - rate, deltaMs / 16.667);
      if (Math.abs(resolved.distance - this.effectiveDistance) > OCCLUSION_DEAD_ZONE) {
        this.effectiveDistance += (resolved.distance - this.effectiveDistance) * alpha;
      }
      this.effectivePitch += (resolved.pitch - this.effectivePitch) * alpha;
    }

    // The interpolated pitch is a different segment from the winning candidate. Validate the
    // actual seat as well, and never ease through a wall while the spring catches up.
    //
    // Fixed follow keeps the player's chosen framing and skips the pose search above, but it still
    // may not seat the lens inside rock. It repeats this check against hard blockers only, so town
    // obstructions keep their fixed framing while a cave shell still pulls the camera in.
    if (fixedPose && !this.freeMove && this.hardOcclusionProbe) {
      this.hardProbeOnly = true;
      this.probeYaw = this.effectiveYaw;
      this.aim(this.effectivePitch, this.effectiveDistance);
      const safeDistance = this.clearance(this.effectiveDistance);
      this.hardProbeOnly = false;
      if (safeDistance < this.effectiveDistance) {
        this.effectiveDistance = safeDistance;
        this.occluded = true;
      }
    }
    if (!fixedPose) {
      this.probeYaw = this.effectiveYaw;
      this.aim(this.effectivePitch, this.effectiveDistance);
      const safeDistance = this.clearance(this.effectiveDistance);
      if (safeDistance < this.effectiveDistance) {
        this.effectiveDistance = safeDistance;
        this.occluded = true;
      }
    }
    const horizontal = Math.cos(this.effectivePitch) * this.effectiveDistance;
    this.camera.position.set(
      this.smoothed.x + Math.sin(this.effectiveYaw) * horizontal,
      this.smoothed.y + Math.sin(this.effectivePitch) * this.effectiveDistance,
      this.smoothed.z + Math.cos(this.effectiveYaw) * horizontal,
    );
    this.camera.lookAt(this.smoothed);
  }

  private resolveFollowOcclusion(requested: number): { distance: number; pitch: number; yaw: number } {
    // Never swing sideways or reverse the view to get around an obstruction.
    this.probeYaw = this.yaw;
    return { ...this.resolveOcclusion(requested), yaw: this.yaw };
  }

  /**
   * The pose that is actually reachable: the requested zoom and pitch, or a climb over whatever is
   * in the way, or a duck under it, or a shortened distance when nothing clears it.
   *
   * Returns the request untouched when neither a probe nor any overhead cover applies, so this is
   * a no-op for a caller that has not opted in.
   *
   * Every candidate is scored on its FULL clearance, centre ray and offsets together. Scoring the
   * candidates on the centre ray alone and only then running the offsets is what produced the
   * measured `town_center` regression: the climbed pitch had a clear centre line at the full 26 m,
   * won on that, and then an offset ray grazing a roof edge cut it to 12.7 m — worse than the flat
   * pose it beat.
   *
   * Cost: five probes when the authored pose is usable, which is the overwhelmingly common case,
   * and twenty-five when it is not. The flat pose is now measured FIRST and on its own, so the
   * search only runs at all below `PITCH_SEARCH_TRIGGER_FRACTION`.
   */
  private resolveOcclusion(requested: number): { distance: number; pitch: number } {
    this.occluded = false;
    if (!this.occlusionProbe && overheadCover().length === 0) {
      this.flatClearance = requested;
      return { distance: requested, pitch: this.pitch };
    }

    this.aim(this.pitch, requested);
    const flatClear = this.clearance(requested);
    this.flatClearance = flatClear;

    // Captured before any further probing, because `clearance` rewrites it on every call.
    const flatCover = this.coverBlocked;

    let bestPitch = this.pitch;
    let bestClear = flatClear;
    if (flatClear < requested * PITCH_SEARCH_TRIGGER_FRACTION) {
      // A walk-under roof is the one blocker whose answer can be SOLVED instead of searched, and
      // `PITCH_STEPS` cannot reach it: the porch at the Coldbrace bank needs the pitch to come down
      // from 0.62 to 0.27 to get the sight line out under its eave, and the largest step in the
      // table is -0.28 applied to a pitch that is already being asked to clear a 2.98 m soffit
      // 5.4 m away. Tried FIRST, so a shot that can be saved by ducking is never instead answered
      // by climbing over the roof the player is standing under.
      if (flatCover) {
        const duck = this.eavePitch();
        if (duck !== null && Math.abs(duck - this.pitch) > 1e-4) {
          this.aim(duck, requested);
          const clear = this.clearance(requested);
          if (clear > bestClear) {
            bestClear = clear;
            bestPitch = duck;
          }
        }
      }
      for (const [step, allowedBelow] of PITCH_STEPS) {
        if (bestClear >= requested * CLIMB_ACCEPT_FRACTION) break;
        if (flatClear >= requested * allowedBelow) continue;
        const pitch = clamp(this.pitch + step, CAMERA.minPitch, CAMERA.maxPitch);
        // The clamp can land a candidate back on the pitch already measured; do not pay for it.
        if (Math.abs(pitch - this.pitch) < 1e-4) continue;
        this.aim(pitch, requested);
        const clear = this.clearance(requested);
        if (clear > bestClear) {
          bestClear = clear;
          bestPitch = pitch;
        }
        if (clear >= requested * CLIMB_ACCEPT_FRACTION) break;
      }

      const gainNeeded = Math.max(CLIMB_MIN_GAIN_METRES, requested * CLIMB_MIN_GAIN_FRACTION);
      if (bestClear < flatClear + gainNeeded) {
        bestPitch = this.pitch;
        bestClear = flatClear;
      }
    }

    this.occluded = bestClear < requested;
    return { distance: bestClear, pitch: bestPitch };
  }

  /**
   * How far the camera can sit along the current aim before anything is in the way.
   *
   * `requested` when the line is clear. The four offset rays are what stop the camera's edges
   * burying themselves in a wall the centre ray slips past. Each ray answers against the physics
   * world AND against `OVERHEAD_COVER`, whichever is nearer.
   */
  private clearance(requested: number): number {
    this.coverBlocked = false;
    let nearest: number | null = this.probeSegment(0, 0, requested);
    for (const [right, up] of PROBE_OFFSETS) {
      const hit = this.probeSegment(right * PROBE_OFFSET_METRES, up * PROBE_OFFSET_METRES, requested);
      if (hit !== null && (nearest === null || hit < nearest)) nearest = hit;
    }
    if (nearest === null) return requested;
    // No comfort floor can override a wall. For an extremely close hit, retain half the free
    // segment instead of asking for more padding than exists or placing the lens beyond the hit.
    return nearest - Math.min(OCCLUSION_PADDING, nearest / 2);
  }

  /** Points `desired` and the probe basis at the camera seat for a given pitch and distance. */
  private aim(pitch: number, distance: number): void {
    const horizontal = Math.cos(pitch) * distance;
    this.desired.set(
      this.smoothed.x + Math.sin(this.probeYaw) * horizontal,
      this.smoothed.y + Math.sin(pitch) * distance,
      this.smoothed.z + Math.cos(this.probeYaw) * horizontal,
    );
    // Right and up of the segment, so the offset probes bracket the camera rather than the world.
    // The segment is never vertical (pitch is clamped to 1.32 rad), so a fixed world-up reference
    // cannot degenerate here.
    this.probeRight.set(this.desired.x - this.smoothed.x, 0, this.desired.z - this.smoothed.z);
    const planar = Math.hypot(this.probeRight.x, this.probeRight.z) || 1;
    this.probeRight.set(this.probeRight.z / planar, 0, -this.probeRight.x / planar);
    this.probeUp.set(0, 1, 0);
  }

  /**
   * One probe, offset sideways and vertically from the centre line by the given metres.
   *
   * Returns the hit distance, or null for a clear line. A probe is allowed to report "clear" as
   * null, Infinity, or a distance past the segment. Anything nonsensical (NaN, negative) is treated
   * as clear rather than jamming the camera at the floor, because a wedged camera is far harder to
   * notice in a screenshot than a clipped one.
   */
  private probeSegment(right: number, up: number, requested: number, lensUp = up): number | null {
    const dx = this.probeRight.x * right;
    const dz = this.probeRight.z * right;
    const dy = this.probeUp.y * up;
    this.probeFrom[0] = this.smoothed.x + dx;
    this.probeFrom[1] = this.smoothed.y + dy;
    this.probeFrom[2] = this.smoothed.z + dz;
    this.probeTo[0] = this.desired.x + dx;
    this.probeTo[1] = this.desired.y + lensUp;
    this.probeTo[2] = this.desired.z + dz;

    let nearest: number | null = null;
    const segmentLength = Math.hypot(
      this.probeTo[0] - this.probeFrom[0], this.probeTo[1] - this.probeFrom[1], this.probeTo[2] - this.probeFrom[2],
    );
    const probe = this.hardProbeOnly ? this.hardOcclusionProbe : this.occlusionProbe;
    if (probe) {
      const hit = probe(this.probeFrom, this.probeTo);
      if (hit !== null && Number.isFinite(hit) && hit > 0 && hit < segmentLength) nearest = hit;
    }
    // Walk-under cover is authored building geometry, which the cutaway owns. A hard-blocker pass
    // is asking a narrower question and must not answer it with a roof.
    const roof = this.hardProbeOnly ? null : this.coverSegment(segmentLength);
    if (roof !== null) {
      this.coverBlocked = true;
      if (nearest === null || roof < nearest) nearest = roof;
    }
    return nearest === null ? null : nearest * requested / segmentLength;
  }

  /**
   * The pitch that takes the sight line out from UNDER a walk-under roof, solved rather than
   * searched.
   *
   * The geometry is small: pitch is constant along the whole segment, and a canopy only matters
   * over its own footprint, so the binding constraint is "be below the soffit by the time you leave
   * the footprint". Cast the horizontal bearing through each nearby slab's XZ rectangle, take the
   * far intersection as the exit distance, and the answer is
   * `atan2(soffit - focus height - clearance, exit)`. The most restrictive slab wins.
   *
   * Worked, at the `bank` pose, against the numbers this file already records: the Coldbrace bank
   * porch soffits at 2.68 m and the sight line leaves its 6 x 3 footprint 5.4 m out. The solved
   * pitch is atan(1.23 / 5.4) = 0.22 rad against an authored 0.62. At 19 m that seats the camera
   * 4.2 m above focus, looking under the porch's front edge instead of parking its lens in the
   * beams.
   *
   * Never RAISES the pitch: clamped to the authored pitch above and `CAMERA.minPitch` below. A
   * canopy the segment already clears returns the authored pitch and the caller skips it. The
   * result is still scored by `clearance` like every other candidate and still has to pass the
   * gain gate, so a duck that trades one blocker for another is rejected on measurement rather
   * than believed on construction.
   */
  private eavePitch(): number | null {
    const slabs = overheadCover();
    if (slabs.length === 0) return null;
    const ax = this.smoothed.x;
    const az = this.smoothed.z;
    // The same horizontal bearing `aim` builds the seat on, as a unit vector, so the slab test's
    // parametric range comes out in metres.
    const dx = Math.sin(this.probeYaw);
    const dz = Math.cos(this.probeYaw);

    let best: number | null = null;
    for (const slab of slabs) {
      if (this.hiddenRoofs.has(slab.ownerId)) continue;
      const ox = ax - slab.cx;
      const oz = az - slab.cz;
      if (ox * ox + oz * oz > COVER_RANGE_METRES * COVER_RANGE_METRES) continue;
      const lox = slab.cos * ox - slab.sin * oz;
      const loz = slab.sin * ox + slab.cos * oz;
      const ldx = slab.cos * dx - slab.sin * dz;
      const ldz = slab.sin * dx + slab.cos * dz;

      this.slabRange[0] = 0;
      this.slabRange[1] = COVER_RANGE_METRES;
      if (!this.narrow(lox, ldx, -slab.hx, slab.hx)) continue;
      if (!this.narrow(loz, ldz, -slab.hz, slab.hz)) continue;
      const exit = this.slabRange[1];
      if (exit <= 1e-3) continue;

      // Both heights are stated above the pad, and the focus point is FOCUS_HEIGHT_METRES above
      // it, so the ground term cancels and this is a pure asset measurement.
      const headroom = slab.soffit - FOCUS_HEIGHT_METRES - EAVE_CLEARANCE_METRES;
      const pitch = Math.atan2(headroom, exit);
      if (best === null || pitch < best) best = pitch;
    }
    if (best === null) return null;
    return clamp(best, CAMERA.minPitch, this.pitch);
  }

  /**
   * The same segment, against the walk-under roofs the physics world does not carry.
   *
   * Runs in each slab's own local frame, which is a rotate-and-slab-test with no allocation. The
   * candidate set is `OVERHEAD_COVER` filtered to `COVER_RANGE_METRES` of the player, which is 0-3
   * slabs anywhere in the game and 13 in total, so the whole thing is cheaper than the one physics
   * raycast it rides alongside.
   *
   * A segment that STARTS inside a slab reports 0, and `probeSegment`'s caller treats that as no
   * hit — deliberately. The origin is the player's head; if it is genuinely inside a canopy the
   * player is clipping through a roof, and jamming the camera at the floor would hide that rather
   * than show it.
   */
  private coverSegment(requested: number): number | null {
    const slabs = overheadCover();
    if (slabs.length === 0) return null;
    const ax = this.probeFrom[0];
    const ay = this.probeFrom[1];
    const az = this.probeFrom[2];
    const dx = this.probeTo[0] - ax;
    const dy = this.probeTo[1] - ay;
    const dz = this.probeTo[2] - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return null;
    // Every slab height is stated above the pad the player is standing on.
    const groundY = this.smoothed.y - FOCUS_HEIGHT_METRES;

    let nearest: number | null = null;
    for (const slab of slabs) {
      if (this.hiddenRoofs.has(slab.ownerId)) continue;
      const ox = ax - slab.cx;
      const oz = az - slab.cz;
      if (ox * ox + oz * oz > COVER_RANGE_METRES * COVER_RANGE_METRES) continue;
      // World -> local is the inverse of `emitParts`: lx = cos*X - sin*Z, lz = sin*X + cos*Z.
      const lox = slab.cos * ox - slab.sin * oz;
      const loz = slab.sin * ox + slab.cos * oz;
      const ldx = slab.cos * dx - slab.sin * dz;
      const ldz = slab.sin * dx + slab.cos * dz;

      this.slabRange[0] = 0;
      this.slabRange[1] = 1;
      if (!this.narrow(lox, ldx, -slab.hx, slab.hx)) continue;
      if (!this.narrow(ay, dy, groundY + slab.soffit, groundY + slab.top)) continue;
      if (!this.narrow(loz, ldz, -slab.hz, slab.hz)) continue;

      const hit = this.slabRange[0] * length;
      if (hit > 0 && hit < requested && (nearest === null || hit < nearest)) nearest = hit;
    }
    return nearest;
  }

  /**
   * One axis of the slab test, narrowing `slabRange` in place.
   *
   * Returns false the moment the interval empties, which is what makes 13 boxes cost nothing: a
   * segment that misses on its first axis never touches the other two.
   */
  private narrow(origin: number, delta: number, low: number, high: number): boolean {
    if (Math.abs(delta) < 1e-9) return origin >= low && origin <= high;
    const inverse = 1 / delta;
    let near = (low - origin) * inverse;
    let far = (high - origin) * inverse;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    if (near > this.slabRange[0]) this.slabRange[0] = near;
    if (far < this.slabRange[1]) this.slabRange[1] = far;
    return this.slabRange[0] <= this.slabRange[1];
  }

  /** Frames a point from a fixed pose, immediately. Screenshot poses use this. */
  focusOn(position: Vec3, yaw = this.yaw, pitch = this.pitch, distance = this.distance): void {
    this.setPose(yaw, pitch, distance);
    this.update(position[0], position[1], position[2], true);
  }

  /**
   * JSON-safe, for the debug API. The harness asserts every value here is finite.
   *
   * `distance` is what the camera actually used; `requestedDistance` is what zoom asked for. Round
   * 1 could not tell the two apart, which is how "distance: 18 in every snapshot in both scenario
   * files" went unnoticed as evidence that the spring was never running.
   */
  snapshot(): {
    position: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    distance: number;
    requestedDistance: number;
    effectivePitch: number;
    effectiveYaw: number;
    flatDistance: number;
    occluded: boolean;
    occlusionProbe: boolean;
    freeMove: boolean;
    target: { x: number; y: number; z: number };
  } {
    return {
      position: {
        x: Math.round(this.camera.position.x * 1000) / 1000,
        y: Math.round(this.camera.position.y * 1000) / 1000,
        z: Math.round(this.camera.position.z * 1000) / 1000,
      },
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      distance: Math.round(this.effectiveDistance * 1000) / 1000,
      requestedDistance: Math.round(this.distance * 1000) / 1000,
      // `pitch` is what the player asked for; this is what the pitch search actually used.
      effectivePitch: Math.round(this.effectivePitch * 1000) / 1000,
      effectiveYaw: Math.round(this.effectiveYaw * 1000) / 1000,
      // What the authored pitch could see. `flatDistance < distance` never happens; the gap
      // between them is exactly what the pitch search bought, in metres.
      flatDistance: Math.round(this.flatClearance * 1000) / 1000,
      occluded: this.occluded,
      occlusionProbe: this.occlusionProbe !== null,
      freeMove: this.freeMove,
      target: {
        x: Math.round(this.smoothed.x * 1000) / 1000,
        y: Math.round(this.smoothed.y * 1000) / 1000,
        z: Math.round(this.smoothed.z * 1000) / 1000,
      },
    };
  }

  reset(): void {
    this.yaw = Math.PI * 0.15;
    this.pitch = CAMERA.defaultPitch;
    this.distance = CAMERA.defaultDistance;
    this.effectiveDistance = CAMERA.defaultDistance;
    this.effectivePitch = CAMERA.defaultPitch;
    this.effectiveYaw = this.yaw;
    this.flatClearance = CAMERA.defaultDistance;
    this.occluded = false;
    this.initialised = false;
    this.lastUpdateMs = 0;
  }
}

/** Opacity a faded occluder settles at. Low enough to see through, high enough to keep the roof. */
const FADE_OPACITY = 0.25;

/** Per-60 Hz-frame fade rates. Out fast so the player is never hidden; back in gently. */
const FADE_OUT_RATE = 0.3;
const FADE_IN_RATE = 0.12;

/** Below this the material is put back in the opaque pass; above it, it is treated as clear. */
const FADE_SETTLED = 0.995;

interface FadeState {
  material: THREE.Material;
  opacity: number;
  target: number;
  originalTransparent: boolean;
  originalOpacity: number;
  originalDepthWrite: boolean;
}

/**
 * Fades whatever stands between the camera and the player.
 *
 * Dormant by default and opt-in: nothing constructs it unless root does. Why it exists: at
 * `CAMERA.defaultPitch` 0.72 the camera cleared every roof in the game, so a building was never
 * between it and the player. At 0.52 it is, constantly, and the occlusion spring alone cannot solve
 * it — pulling the camera to 2.6 m inside a settlement just puts the wall closer to the lens.
 *
 * Cost, measured against the shape of the scene rather than guessed: three's `Raycaster` rejects a
 * mesh on its bounding sphere before touching a triangle, so the per-frame cost is one sphere test
 * per candidate mesh (39 building boxes' worth of parts) plus triangle tests for the one or two
 * meshes actually on the ray. `PROBE_INTERVAL_MS` throttles even that to 20 Hz; the fade itself
 * interpolates every frame, so the throttle is invisible.
 *
 * The one real cost is the shader: `transparent` is part of three's program cache key, so the first
 * frame a material fades would compile a new program. `Renderer.warmup({ transparentVariants })`
 * exists to pay that at boot instead. Wire both or neither.
 */
export class OccluderFade {
  private readonly raycaster = new THREE.Raycaster();
  private readonly origin = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly states = new Map<THREE.Material, FadeState>();
  private candidates: THREE.Object3D[] = [];
  private sinceProbeMs = Number.POSITIVE_INFINITY;
  private lastFaded = new Set<THREE.Material>();

  /** How often the ray is cast. The fade interpolates every frame regardless. */
  private static readonly PROBE_INTERVAL_MS = 50;

  /**
   * Roots to test. Pass the building group, not the whole scene: fading an `InstancedMesh` fades
   * every instance sharing that material, so scatter rocks and trees are exactly the wrong
   * candidates — one boulder on the ray would take every boulder in the region with it.
   */
  setCandidates(objects: readonly THREE.Object3D[]): void {
    // Copied rather than aliased: `intersectObjects` wants a mutable array and copying once here is
    // cheaper than copying every frame to satisfy it.
    this.candidates = [...objects];
  }

  /** Whether anything was wired. False means `update` is a no-op and costs one comparison. */
  hasCandidates(): boolean {
    return this.candidates.length > 0;
  }

  /**
   * `from` is the player's head and `to` is the camera. Call once per rendered frame, after the
   * camera has been positioned.
   */
  update(from: THREE.Vector3, to: THREE.Vector3, deltaMs: number): void {
    if (this.candidates.length === 0) return;

    this.sinceProbeMs += deltaMs;
    if (this.sinceProbeMs >= OccluderFade.PROBE_INTERVAL_MS) {
      this.sinceProbeMs = 0;
      this.repick(from, to);
    }

    for (const state of this.states.values()) {
      const rate = state.target < state.opacity ? FADE_OUT_RATE : FADE_IN_RATE;
      const alpha = 1 - Math.pow(1 - rate, deltaMs / 16.667);
      state.opacity += (state.target - state.opacity) * alpha;
      this.apply(state);
    }
  }

  /** Puts every material back exactly as it was found. */
  releaseAll(): void {
    for (const state of this.states.values()) {
      state.opacity = 1;
      state.target = 1;
      this.apply(state);
    }
    this.states.clear();
    this.lastFaded.clear();
  }

  private repick(from: THREE.Vector3, to: THREE.Vector3): void {
    this.origin.copy(from);
    this.direction.copy(to).sub(from);
    const length = this.direction.length();
    if (length < 0.001) return;
    this.direction.divideScalar(length);
    this.raycaster.set(this.origin, this.direction);
    this.raycaster.near = 0;
    this.raycaster.far = length;

    const hits = this.raycaster.intersectObjects(this.candidates, true);
    const faded = new Set<THREE.Material>();
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      if (mesh.isMesh !== true) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) faded.add(material);
    }

    for (const material of faded) {
      const state = this.states.get(material) ?? this.track(material);
      state.target = FADE_OPACITY;
    }
    for (const material of this.lastFaded) {
      if (faded.has(material)) continue;
      const state = this.states.get(material);
      if (state) state.target = 1;
    }
    this.lastFaded = faded;
  }

  private track(material: THREE.Material): FadeState {
    const state: FadeState = {
      material,
      opacity: 1,
      target: 1,
      originalTransparent: material.transparent,
      originalOpacity: material.opacity,
      originalDepthWrite: material.depthWrite,
    };
    this.states.set(material, state);
    return state;
  }

  private apply(state: FadeState): void {
    const material = state.material;
    if (state.opacity >= FADE_SETTLED) {
      // Back to exactly what it was. Leaving a settled material in the transparent pass would cost
      // sorting and depth-write behaviour it never asked for.
      if (material.transparent !== state.originalTransparent) {
        material.transparent = state.originalTransparent;
        material.depthWrite = state.originalDepthWrite;
        material.needsUpdate = true;
      }
      material.opacity = state.originalOpacity;
      this.states.delete(material);
      return;
    }
    if (material.transparent !== true) {
      material.transparent = true;
      material.depthWrite = false;
      // Required: three caches the compiled program per material and only re-derives it when the
      // version changes, so without this the material keeps its OPAQUE program, which forces alpha
      // to 1 and the fade would silently do nothing.
      material.needsUpdate = true;
    }
    material.opacity = state.opacity * state.originalOpacity;
  }
}
