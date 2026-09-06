/**
 * Enemy behaviour: aggro, pursuit, leash, respawn, and Ordrun's two phases.
 *
 * Three behaviours, straight from the content row:
 *
 *  - `passive`      never initiates. It fights back once struck, and stops when the player leaves.
 *  - `aggressive`   attacks anything alive inside `aggroRadius` (content authors 6 m to 14 m).
 *  - `territorial`  attacks only once attacked, and then pursues.
 *
 * All three leash at 28 m from their spawn point and walk home, which is the rule that makes a
 * dungeon chamber a place rather than a conga line.
 *
 * This file decides *who is fighting whom and where they stand*. `systems/combat.ts` decides *what
 * a swing does*, and the two are separate objects because PRD section 3 has them as separate rows:
 * AI is row 7, combat is row 8. The one exception is Ordrun's ground slam, which is a special
 * attack owned here and applied through `CombatSystem.damagePlayer`, so it lands on the same
 * clamps and the same hit log as an ordinary swing.
 *
 * The boss telegraph is exposed as readable state, never as a render call: `bossPhase` in
 * `state.world.enemies[id]`, plus `telegraphs()` and `onTelegraph()` on this class. Nothing here
 * knows a mesh exists.
 */
import type { EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../app/loop.js";
import { CREATURE_RUN_SPEED } from "../app/config.js";
import { distanceXZ, turnToward } from "../core/math.js";
import { Rng } from "../core/rng.js";
import type { BossPhase } from "../content/enemies.js";
import { ORDRUN_PHASES } from "../content/enemies.js";
import { REGIONS, WORLD_BOUNDS } from "../content/regions.js";
import { enemyPursuitSpeedMps } from "../content/index.js";
import { habitatForGroup, type HabitatDef } from "../content/worldHabitats.js";
import { habitatIdleTargets, hashId } from "../world/habitatMovement.js";
export { hashId } from "../world/habitatMovement.js";
import type { CombatEntityPort, CombatSystem } from "./combat.js";
import {
  cloneVec3, combatRealmOf as realmOf, enemyHoldMetres, sameCombatRealm as sameRealm, spawnPositionOf,
} from "./combat.js";

// ------------------------------------------------------------------ tunables

/** PRD 2.4: enemies leash at 28 m from their spawn point. */
export const LEASH_METRES = 28;

/** Legacy speed retained only for the unauthored walking-speed fallback. */
export const ENEMY_SPEED_MPS = 3.1;

/**
 * Radians per second a creature may turn.
 *
 * The player's path-following is capped at 7 rad/s (`systems/movement.ts: MAX_TURN_RATE`) and this
 * is the same number for the same reason: an uncapped `atan2` assignment turns a body all the way
 * round inside one 100 ms tick, which the renderer can only draw as a snap. A wander destination
 * picked behind a cow used to spin it 180 degrees at 1800 deg/s against the player's own 400.
 */
export const ENEMY_TURN_RATE_RAD_PER_S = 7;

/**
 * Heading error above which a creature pivots in place before it walks, in radians (60 degrees).
 *
 * A capped turn alone still translates the body toward a target it has not turned to face, and
 * for the half second a 180-degree pivot takes that reads as a moonwalk. Real animals turn first,
 * then go. Errors below this are walked off mid-stride, which is what ordinary cornering looks
 * like, so the gate only bites on genuine reversals — a new wander leg, a leash turn-around, the
 * player stepping behind.
 */
export const TURN_IN_PLACE_RAD = Math.PI / 3;

/**
 * How far the drawn terrain may disagree with a step's Y before the terrain is ignored, in metres.
 *
 * Same constant, same reasoning, and same measurements as `GROUND_SNAP_MAX` in
 * `systems/movement.ts`: the navmesh floats 0.147-0.417 m above the drawn ground and the float
 * changes as a creature walks, so an animal standing on the NAVMESH is an animal hovering in the
 * air. 1.2 m is 3x the worst measured float and far below any dungeon offset, so grounding can
 * never fire a Gravelmaw creature up through the chamber roof to the surface terrain.
 */
const GROUND_SNAP_MAX_METRES = 1.2;

/**
 * How fast an enemy is allowed to be pushed out of another one, metres per second.
 *
 * Well under any pursuit speed, so giving way never outruns chasing and two animals cannot shove
 * each other across the field. It only has to resolve an overlap over a handful of ticks.
 */
const SEPARATION_SPEED_MPS = 1.1;

/**
 * The footprint assumed for an enemy whose asset is not in the manifest.
 *
 * `world/regionBuilder.ts` measures the real one for everything that ships. This is the value that
 * keeps a content gap from collapsing separation entirely, and it is deliberately small: crowding
 * slightly is a better failure than shoving apart two things that were never touching.
 */
const DEFAULT_BODY_RADIUS = 0.4;

/**
 * How far to move ONE of two overlapping enemies, along the line between them.
 *
 * Exported and pure so the rule can be pinned by a test without standing up a store, a navmesh and
 * a combat system. The caller applies this to the second of the pair and its negation to the first.
 *
 * `want` is the sum of the two body radii and `limit` is one tick of separation travel. Half the
 * overlap each, so neither creature is privileged and the pair converges on touching rather than
 * one of them being walked backwards out of the other.
 *
 * `tie` only matters when the two are exactly coincident, which has no direction to push along and
 * whose normalisation is a NaN. It picks a fixed angle, so the same frame always resolves the same
 * way - a random one would be a thing a replay could not reproduce.
 */
export function separationPush(
  dx: number,
  dz: number,
  want: number,
  limit: number,
  tie: number,
): { x: number; z: number } | null {
  const gap = Math.sqrt(dx * dx + dz * dz);
  if (gap >= want) return null;

  // Direction and distance are taken apart here rather than normalising in place, because the
  // coincident case has a distance of zero and only the direction needs inventing. Folding the two
  // together - substituting a unit gap to keep the division alive - would also quietly shrink the
  // overlap it thinks it is resolving, from the whole body down to whatever that unit was.
  let ux = 0;
  let uz = 0;
  if (gap < 1e-4) {
    const angle = (((tie % 360) + 360) % 360) * (Math.PI / 180);
    ux = Math.cos(angle);
    uz = Math.sin(angle);
  } else {
    ux = dx / gap;
    uz = dz / gap;
  }

  const push = Math.min(limit, (want - gap) / 2);
  return { x: ux * push, z: uz * push };
}
/**
 * The shared pursuit and return speed: 90% of the player's run.
 *
 * This is the CEILING and the fallback, not the speed every creature moves at. `content/index.ts`
 * solves each animal's `moveSpeedMps` from its own walk cycle so its legs stay under the cadence
 * ceiling, and `enemyPursuitSpeedMps` keeps that solution. Only the rigs with no stride of their
 * own — the humanoid raiders on the player's shared jog — actually travel at this number. A
 * creature walks home at the same speed it chased at; returning faster than you can chase was an
 * artefact of this constant and `ENEMY_SPEED_MPS` drifting apart.
 */
export const ENEMY_RETURN_SPEED_MPS = CREATURE_RUN_SPEED;

/**
 * How fast this creature potters, in metres per second.
 *
 * Falls back to a third of its pursuit speed when content gives no walk speed, which is roughly the
 * walk-to-run ratio across the measured roster (the bear is 0.74 against 2.25, the goat 0.52
 * against 1.84) — a defensible amble rather than a creature strolling at a sprint.
 */
function wanderSpeed(entity: SemanticEntity): number {
  return entity.combat?.walkSpeedMps ?? (entity.combat?.moveSpeedMps ?? ENEMY_SPEED_MPS) / 3;
}

/**
 * Picks a point to amble to, somewhere in the ring around a creature's spawn.
 *
 * A RING rather than a disc: `WANDER_MIN_METRES` is a floor as well as a radius, because a
 * destination the creature is already standing on produces a one-step shuffle and a creature that
 * appears to twitch rather than walk. Y is copied from the spawn rather than computed; the caller
 * snaps the result to the navmesh, which is what actually decides the height.
 *
 * Pure, and takes its `Rng` rather than making one, so the caller's per-creature stream stays the
 * thing that keeps a flock out of lockstep.
 */
export function wanderDestination(spawn: Vec3, rng: Rng): Vec3 {
  const angle = rng.float(0, Math.PI * 2);
  const radius = rng.float(WANDER_MIN_METRES, WANDER_RADIUS_METRES);
  return [spawn[0] + Math.cos(angle) * radius, spawn[1], spawn[2] + Math.sin(angle) * radius];
}

/**
 * Absolute shortest-way-round difference between two headings, in radians.
 *
 * Exported and pure so the turn-in-place gate can be pinned without a store, a navmesh and a
 * combat system, exactly like `separationPush`. The wrap is a loop for the reason
 * `core/math.turnToward` gives: the inputs are near the principal range and a `%` on a negative
 * angle needs a correction term that is easy to get wrong.
 */
export function headingGap(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

// Where an enemy stops closing is no longer one constant: `combat.enemyStandoffMetres` adds the
// creature's own measured half-length, so a cow squares up muzzle-to-sword-point instead of
// muzzle-inside-player. The swing range in `systems/combat.ts` is derived from the same function,
// so the standoff always remains inside it.

/**
 * Idle drift, so a field of animals is not a field of statues.
 *
 * Metres from the SPAWN point, not from wherever the creature currently is, so a flock cannot
 * random-walk across the map over ten minutes. The floor stops a creature from picking a
 * destination it is already standing on and playing a one-step shuffle.
 */
export const WANDER_RADIUS_METRES = 6;
export const WANDER_MIN_METRES = 1.5;
/** Close enough to have arrived. Matches the tolerance `stepToward` uses for walking home. */
const WANDER_ARRIVE_METRES = 0.6;
/**
 * How long a creature stands still between strolls.
 *
 * Long, and randomised per creature. The read wanted here is "that hen just moved", not "the
 * scenery is drifting", so the pause has to dominate the stroll rather than merely match it: the
 * slowest creature in the game walks 1.2 m/s, which crosses the full 6 m radius in five seconds, so
 * a five-second floor would leave it moving half the time. At eight to eighteen it moves between 13
 * and 28 percent of the time depending on its gait, which puts a couple of any flock in motion at
 * once and the rest standing — what a field of animals actually looks like.
 */
export const WANDER_PAUSE_MIN_MS = 8_000;
export const WANDER_PAUSE_MAX_MS = 18_000;

/** A provoked enemy stays interested this long after it last saw or was hit by the player. */
export const PROVOKE_MEMORY_MS = 12_000;

/**
 * The smallest movement worth taking, in metres.
 *
 * Below this a step is noise: the navmesh snap alone moves a candidate by more than this, so a
 * shorter "step" says nothing about whether the enemy actually got anywhere. Both the progress test
 * and the arrival test read it, and they have to read the same number — see `stepToward`.
 */
const STEP_EPSILON_METRES = 0.001;

/** Only enemies this close to the player are simulated. Everything else idles for free. */
export const AI_ACTIVE_RADIUS = 70;

/** The enemy list is rebuilt on this cadence rather than every 100 ms tick. */
const ENEMY_SCAN_INTERVAL_MS = 2_000;

const HABITAT_NAV_TOLERANCE = 0.1;
const HABITAT_PAUSES: Readonly<Record<HabitatDef["activity"], readonly [number, number]>> = {
  graze: [10_000, 22_000], forage: [4_000, 10_000], prowl: [2_000, 6_000], patrol: [800, 2_400],
};

function worldHabitat(entity: SemanticEntity): HabitatDef | null {
  if (entity.archetype !== "enemy" || entity.meta?.featureLab === true
    || entity.meta?.galleryMotion === true || entity.id.startsWith("feature-lab:")
    || entity.id.startsWith("lab:")) return null;
  const groupId = entity.meta?.groupId;
  const habitat = typeof groupId === "string" ? habitatForGroup(groupId) : null;
  return habitat?.regionId === entity.regionId ? habitat : null;
}

function insideHabitat(habitat: HabitatDef, position: Vec3): boolean {
  const [x, , z] = position;
  const bounds = REGIONS.find((region) => region.id === habitat.regionId)?.bounds;
  return bounds !== undefined && Number.isFinite(x) && Number.isFinite(z)
    && x >= WORLD_BOUNDS.min[0] && x <= WORLD_BOUNDS.max[0]
    && z >= WORLD_BOUNDS.min[1] && z <= WORLD_BOUNDS.max[1]
    && x >= bounds.min[0] && x <= bounds.max[0] && z >= bounds.min[1] && z <= bounds.max[1]
    && Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) <= habitat.radius;
}

// ------------------------------------------------------------- boss tuning

/**
 * Boss phase scripts, keyed by entity id.
 *
 * The numbers are content's, not this file's: `ORDRUN_PHASES` in `content/enemies.ts` carries the
 * health fraction, the phase armour, the phase cadence, the phase max hit and the telegraph shape,
 * because `EnemyDef` is frozen and has no room for them. Phase 2 dropping Ordrun's armour from 62
 * to 50 is what keeps the second half winnable at the DPS the first half establishes.
 */
const BOSS_PHASES: Readonly<Record<string, readonly BossPhase[]>> = {
  ordrun: ORDRUN_PHASES,
};

/** Gap between ground slams once a phase unlocks one. */
export const SLAM_INTERVAL_MS = 12_000;

/** How long the scorched circle stays readable after it fires. */
export const SLAM_LINGER_MS = 600;

/** Fallbacks for a phase that names a telegraph without giving it a shape. */
export const SLAM_WINDUP_MS = 1_500;
export const SLAM_RADIUS_METRES = 5.0;

/** Slam damage as a multiple of the boss's phase max hit. */
export const SLAM_DAMAGE_MULTIPLIER = 1.5;

// -------------------------------------------------------------------- types

export type TelegraphStage = "windup" | "active";

/**
 * A telegraphed boss attack, in world terms only. The render layer reads this to draw the ground
 * ring; the UI reads it to warn. Neither is allowed to change it.
 */
export interface BossTelegraph {
  enemyId: EntityId;
  kind: "ground_slam";
  stage: TelegraphStage;
  centre: Vec3;
  radius: number;
  startedAtMs: number;
  /** When the damage lands. During `windup`, this is in the future. */
  firesAtMs: number;
  endsAtMs: number;
  phase: number;
}

/** Optional navmesh snapping, so a chasing enemy does not walk through a cliff. */
export interface EnemyNavPort {
  nearestWalkable(point: Vec3, maxDistance?: number): Vec3 | null;
}

export interface EnemyAiDeps {
  store: Store;
  events: EventBus;
  entities: CombatEntityPort;
  combat: CombatSystem;
  nav?: EnemyNavPort;
  /**
   * Height of the DRAWN ground at a point, for planting feet on it. The navmesh keeps XZ
   * authority; see `ground`. Optional for the same reason `nav` is: the system must run in tests
   * that stand up no scene.
   */
  groundHeightAt?: (x: number, z: number) => number;
  /** Explicit encounter habitats use the same movement rules as the authored world. */
  habitatForEntity?: (entity: SemanticEntity) => HabitatDef | null;
}

type AiMode = "idle" | "aggro" | "returning";

interface AiRecord {
  mode: AiMode;
  provokedUntilMs: number;
  nextSlamAtMs: number;
  telegraph: BossTelegraph | null;
  /** Where this creature is currently ambling, or null while it is standing still. */
  wanderTarget: Vec3 | null;
  /** Sim time the current pause ends. Only read while `wanderTarget` is null. */
  wanderUntilMs: number;
  /** Last selected authored anchor; patrols continue around the same route after each pause. */
  habitatAnchorIndex: number | null;
  wanderStuckMs: number;
  /** Seeded from the entity id, so a flock does not move in lockstep and a replay is a replay. */
  rng: Rng;
}

// ------------------------------------------------------------------- system

export class EnemyAiSystem implements TickSystem {
  readonly name = "enemyAI";

  /** PRD section 3, row 7 ("Enemy AI"), scaled by ten. Before combat (80). */
  readonly order = 70;

  private readonly records = new Map<EntityId, AiRecord>();
  private readonly telegraphListeners: ((telegraph: BossTelegraph) => void)[] = [];

  private enemies: SemanticEntity[] = [];
  private nextScanAtMs = -1;
  private scannedRealm: RegionId | null | undefined;

  constructor(private readonly deps: EnemyAiDeps) {
    // Being struck provokes, whatever the behaviour says. This is what makes `territorial` work
    // and what stops a `passive` frog standing still while it is beaten to death.
    deps.combat.onEnemyProvoked((enemyId, atMs) => this.provoke(enemyId, atMs));
  }

  private pursuitHabitat(entity: SemanticEntity): HabitatDef | null {
    const groupId = entity.meta?.groupId;
    if (typeof groupId !== "string" || !groupId.startsWith("pack_")) return null;
    const habitat = this.habitat(entity);
    if (!habitat) return null;
    return { ...habitat, radius: Math.max(0.5, habitat.radius - (entity.combat?.bodyRadius ?? 0) - 0.45) };
  }

  private habitat(entity: SemanticEntity): HabitatDef | null {
    return this.deps.habitatForEntity?.(entity) ?? worldHabitat(entity);
  }

  // -------------------------------------------------------------------- tick

  tick(deltaMs: number, atMs: number): void {
    const state = this.deps.store.get();

    this.rescanIfDue(atMs);
    this.respawnDead(state, atMs);

    const playerAlive = state.player.health > 0;
    const playerPos = state.player.position;

    for (const entity of this.enemies) {
      const inPlayerRealm = sameRealm(state.player.regionId, entity.regionId);
      const previous = this.records.get(entity.id);
      // A cached idle actor must stop immediately when the player changes floors. Existing
      // pursuers remain simulated only long enough to disengage and finish walking home.
      if (!inPlayerRealm && previous?.mode !== "aggro" && previous?.mode !== "returning") continue;
      const runtime = this.deps.combat.runtimeFor(state, entity);
      if (runtime.state === "dead") {
        continue;
      }

      const record = this.recordFor(entity.id);
      const def = this.deps.combat.defFor(entity);
      const spawn = runtime.spawnPos;
      const pursuitHabitat = this.pursuitHabitat(entity);
      const playerInHabitat = !pursuitHabitat || insideHabitat(pursuitHabitat, playerPos);
      const distanceToPlayer = distanceXZ(playerPos, entity.position);
      const distanceFromSpawn = distanceXZ(spawn, entity.position);

      // Cancel the swing and any pending slam before boss damage is resolved on this tick.
      if (!inPlayerRealm && record.mode === "aggro") this.leash(state, entity, record, atMs);
      const phases = BOSS_PHASES[entity.id];
      if (phases && inPlayerRealm) this.updateBoss(state, entity, runtime, record, phases, atMs);

      // 1. leash. Nothing outruns 28 m from home, including a boss mid-telegraph.
      if (record.mode === "aggro" && (distanceFromSpawn > LEASH_METRES || !playerInHabitat)) {
        this.leash(state, entity, record, atMs);
      }

      // 2. return home.
      if (record.mode === "returning") {
        const arrived = this.stepToward(entity, spawn, enemyPursuitSpeedMps(def, entity.combat?.moveSpeedMps, CREATURE_RUN_SPEED), deltaMs, 0.6);
        if (arrived) {
          record.mode = "idle";
          runtime.state = "idle";
          // A leashed enemy heals up. Without this, a player can chip a boss down in safe pieces.
          runtime.health = entity.combat?.maxHealth ?? def.maxHealth;
          if (entity.combat) entity.combat.health = runtime.health;
          if (entity.state !== "dead") this.setEntityState(entity, "alive");
          this.deps.store.markDirty();
        }
        continue;
      }

      // 3. acquire.
      if (record.mode === "idle" && playerAlive && playerInHabitat) {
        const provoked = atMs < record.provokedUntilMs;
        const inAggro = distanceToPlayer <= def.aggroRadius;
        const initiates = def.behaviour === "aggressive" && inAggro;
        if (provoked || initiates) this.engage(state, entity, record, runtime, atMs);
      }

      // 3b. potter about.
      //
      // Still idle after the acquire check above, so nothing has noticed the player. Standing a
      // flock of hens perfectly still is what makes a field read as a diorama; a few of them
      // shuffling a couple of metres every ten seconds is what makes it read as a field.
      if (record.mode === "idle") this.wander(entity, record, runtime, atMs, deltaMs);

      // 4. chase and hold.
      if (record.mode === "aggro") {
        if (!playerAlive || (atMs >= record.provokedUntilMs && distanceToPlayer > def.aggroRadius + 6)) {
          this.leash(state, entity, record, atMs);
          continue;
        }
        if (this.deps.combat.isAttackCommitted(entity.id)) {
          // The attack owns its planted stance until recovery. Chasing here slides the clip.
          this.faceless(entity, playerPos, deltaMs);
          continue;
        }
        // The same `?? 0` fallback `combat.bodyRadiusOf` uses, NOT `DEFAULT_BODY_RADIUS`: the
        // standoff and the swing gate must be computed from the same radius or a content gap
        // could park a creature outside its own reach.
        const standoff = enemyHoldMetres(def, entity.combat?.bodyRadius ?? 0);
        if (distanceToPlayer > standoff) {
          this.stepToward(entity, playerPos, enemyPursuitSpeedMps(def, entity.combat?.moveSpeedMps, CREATURE_RUN_SPEED), deltaMs, standoff, pursuitHabitat);
        } else {
          // At standoff there is no displacement for stepToward to face along. Keep looking at the
          // player while the combat system swings.
          this.faceless(entity, playerPos, deltaMs);
        }
      }
    }

    // 5. give way. Last, because it is a correction to where everything ended up this tick.
    this.separate(deltaMs);
  }

  /**
   * Pushes enemies that are standing inside each other apart.
   *
   * Every animal that aggros steers at the SAME point - the player - and steering alone has no
   * opinion about the other animals doing it. So a sett of bears converges on one spot and arrives
   * as one lump of fur: measured with `tools/animals/overlap.ts --chase`, a Gravelmaw rat finished
   * a chase 0.02 m from a reaver, inside a body 1.2 m across. Nothing about the spawn scatter is
   * wrong - at rest not one pair in the world overlaps - so the fix belongs here, on the movement,
   * not on the placement.
   *
   * Pairwise over the ACTIVE list, which `refreshActive` has already cut to what is near the
   * player, so this is a few hundred distance checks a tick rather than a sweep of the world.
   *
   * The push is along the line between the two, which on a standoff ring is close to tangential -
   * so it spreads them around the player rather than fighting the pursuit that is pulling them in.
   * It is also speed-limited like any other movement and snapped to the navmesh, because an enemy
   * shoved through a wall to make room is worse than one standing too close.
   */
  private separate(deltaMs: number): void {
    const active = this.enemies;
    const limit = (SEPARATION_SPEED_MPS * deltaMs) / 1000;
    const state = this.deps.store.get();

    for (let i = 0; i < active.length; i += 1) {
      const a = active[i]!;
      if (state.world.enemies[a.id]?.state === "dead") continue;
      if (!sameRealm(state.player.regionId, a.regionId) && this.records.get(a.id)?.mode !== "returning") continue;
      const ra = a.combat?.bodyRadius ?? DEFAULT_BODY_RADIUS;
      const aCommitted = this.deps.combat.isAttackCommitted(a.id);

      for (let j = i + 1; j < active.length; j += 1) {
        const b = active[j]!;
        if (state.world.enemies[b.id]?.state === "dead") continue;
        if (!sameRealm(a.regionId, b.regionId)) continue;
        if (!sameRealm(state.player.regionId, b.regionId) && this.records.get(b.id)?.mode !== "returning") continue;
        const bCommitted = this.deps.combat.isAttackCommitted(b.id);
        if (aCommitted && bCommitted) continue;
        const want = ra + (b.combat?.bodyRadius ?? DEFAULT_BODY_RADIUS);
        // One movable neighbor takes the full overlap, with the same speed cap as before.
        const yieldFactor = aCommitted || bCommitted ? 2 : 1;

        const push = separationPush(
          b.position[0] - a.position[0], b.position[2] - a.position[2],
          want, limit / yieldFactor, i * 31 + j * 17,
        );
        if (!push) continue;
        if (!aCommitted) this.nudge(a, -push.x * yieldFactor, -push.z * yieldFactor);
        if (!bCommitted) this.nudge(b, push.x * yieldFactor, push.z * yieldFactor);
      }
    }
  }

  /** One separation step for one enemy, refused rather than forced when the navmesh says no. */
  private nudge(entity: SemanticEntity, dx: number, dz: number): void {
    const from = entity.position;
    const wanted: Vec3 = [from[0] + dx, from[1], from[2] + dz];
    const habitat = this.pursuitHabitat(entity)
      ?? (this.records.get(entity.id)?.mode === "idle" ? this.habitat(entity) : null);
    const snapped = habitat ? this.snapHabitatStep(wanted, habitat) : this.snapStep(wanted);
    // No `faceDirection` here on purpose: a creature being shoved aside is still looking at what it
    // is chasing, and turning it to face the shove is what made the animals spin.
    if (!snapped || distanceXZ(from, snapped) <= 0.001) return;
    entity.position = snapped;
    this.deps.entities.setPosition?.(entity.id, snapped);
    this.deps.store.markDirty();
  }

  // ------------------------------------------------------------- engagement

  /** Marks an enemy as interested in the player. Called on every hit the player lands. */
  provoke(enemyId: EntityId, atMs: number): void {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(enemyId);
    if (!entity || !sameRealm(state.player.regionId, entity.regionId)) return;
    const habitat = this.pursuitHabitat(entity);
    if (habitat && !insideHabitat(habitat, state.player.position)) return;
    const runtime = this.deps.combat.runtimeFor(state, entity);
    if (runtime.state === "dead") return;

    const record = this.recordFor(enemyId);
    record.provokedUntilMs = atMs + PROVOKE_MEMORY_MS;
    if (record.mode !== "aggro") this.engage(state, entity, record, runtime, atMs);
  }

  private engage(
    state: GameState,
    entity: SemanticEntity,
    record: AiRecord,
    runtime: GameState["world"]["enemies"][string],
    atMs: number,
  ): void {
    if (!runtime) return;
    record.mode = "aggro";
    // Whatever it was strolling toward stops mattering the moment it has a player to deal with,
    // and a stale target would otherwise resume the instant the fight ended.
    record.wanderTarget = null;
    record.provokedUntilMs = Math.max(record.provokedUntilMs, atMs + PROVOKE_MEMORY_MS);
    runtime.state = "aggro";
    this.setEntityState(entity, "aggro");
    this.deps.combat.engageEnemy(entity.id, atMs);
    this.deps.store.markDirty();
  }

  /** Authored browse patches and patrol routes use the creature's measured walking gait. */
  private wander(
    entity: SemanticEntity,
    record: AiRecord,
    runtime: { spawnPos: Vec3 },
    atMs: number,
    deltaMs: number,
  ): void {
    if (entity.archetype === "boss") return;
    const habitat = this.habitat(entity);
    const pause: readonly [number, number] = habitat ? HABITAT_PAUSES[habitat.activity]
      : [WANDER_PAUSE_MIN_MS, WANDER_PAUSE_MAX_MS];
    const [pauseMin, pauseMax] = pause;

    const target = record.wanderTarget;
    if (target) {
      const before = entity.position;
      const arrived = this.stepToward(
        entity, target, wanderSpeed(entity), deltaMs, habitat ? 0.3 : WANDER_ARRIVE_METRES, habitat,
      );
      record.wanderStuckMs = distanceXZ(before, entity.position) > STEP_EPSILON_METRES
        ? 0 : record.wanderStuckMs + deltaMs;
      if (arrived || (habitat && record.wanderStuckMs >= 3_000)) {
        record.wanderTarget = null;
        record.wanderStuckMs = 0;
        record.wanderUntilMs = atMs + record.rng.int(pauseMin, pauseMax);
      }
      return;
    }

    if (atMs < record.wanderUntilMs) return;
    // First tick of this creature's life lands here with `wanderUntilMs` still 0, which would send
    // every creature in the world walking on the same tick. Stagger the first pause instead.
    if (record.wanderUntilMs === 0) {
      record.wanderUntilMs = atMs + record.rng.int(0, pauseMax);
      return;
    }

    const landed = habitat
      ? this.habitatDestination(entity, record, runtime.spawnPos, habitat)
      : this.snapStep(wanderDestination(runtime.spawnPos, record.rng));
    if (!landed || distanceXZ(entity.position, landed) < (habitat ? 0.6 : WANDER_MIN_METRES)) {
      record.wanderUntilMs = atMs + record.rng.int(pauseMin, pauseMax);
      return;
    }
    record.wanderTarget = landed;
    record.wanderStuckMs = 0;
  }

  private habitatDestination(
    entity: SemanticEntity, record: AiRecord, spawn: Vec3, habitat: HabitatDef,
  ): Vec3 | null {
    const { ranging, nearestAnchorIndex, candidates } = habitatIdleTargets(entity.id, spawn, habitat);
    const count = candidates.length;
    if (count === 0) return null;
    const first = ranging ? (record.habitatAnchorIndex ?? nearestAnchorIndex!) + 1
      : record.rng.int(0, count - 1);
    for (let attempt = 0; attempt < count; attempt += 1) {
      const { anchorIndex: index, position: wanted } = candidates[(first + attempt) % count]!;
      const anchor = habitat.anchors[index]!;
      if (!insideHabitat(habitat, [anchor[0], spawn[1], anchor[1]])) continue;
      const landed = this.snapHabitatStep(wanted, habitat);
      if (!landed || distanceXZ(entity.position, landed) < 0.6) continue;
      record.habitatAnchorIndex = index;
      return landed;
    }
    return null;
  }

  private leash(state: GameState, entity: SemanticEntity, record: AiRecord, atMs: number): void {
    record.mode = "returning";
    record.provokedUntilMs = 0;
    record.telegraph = null;
    record.wanderTarget = null;
    record.habitatAnchorIndex = null;
    record.wanderStuckMs = 0;
    const runtime = state.world.enemies[entity.id];
    if (runtime) runtime.state = "returning";
    this.setEntityState(entity, "returning");
    this.deps.combat.disengageEnemy(state, entity.id, atMs);
    this.deps.store.markDirty();
  }

  // ---------------------------------------------------------------- respawn

  /** Dead enemies come back at their spawn point on the timer combat stamped on them. */
  private respawnDead(state: GameState, atMs: number): void {
    for (const [entityId, runtime] of Object.entries(state.world.enemies)) {
      if (!runtime || runtime.state !== "dead") continue;
      if (runtime.respawnAtMs === null || atMs < runtime.respawnAtMs) continue;

      const entity = this.deps.entities.get(entityId);
      if (!entity) {
        runtime.respawnAtMs = atMs + 30_000;
        continue;
      }
      const def = this.deps.combat.defFor(entity);
      runtime.health = entity.combat?.maxHealth ?? def.maxHealth;
      runtime.state = "idle";
      runtime.respawnAtMs = null;
      delete runtime.bossPhase;
      // Both halves, or the renderer keeps fading a creature that is alive again.
      delete runtime.diedAtMs;
      if (entity.view) delete entity.view.diedAtMs;

      if (entity.combat) entity.combat.health = runtime.health;
      this.deps.entities.setPosition?.(entityId, cloneVec3(runtime.spawnPos));
      entity.position = cloneVec3(runtime.spawnPos);
      this.setEntityState(entity, "alive");

      const record = this.recordFor(entityId);
      record.mode = "idle";
      record.provokedUntilMs = 0;
      record.telegraph = null;
      record.nextSlamAtMs = 0;
      // A respawned creature stands on its spawn point for a beat before it starts pottering again.
      record.wanderTarget = null;
      record.habitatAnchorIndex = null;
      record.wanderStuckMs = 0;
      record.wanderUntilMs = atMs + record.rng.int(WANDER_PAUSE_MIN_MS, WANDER_PAUSE_MAX_MS);
      this.deps.combat.setEnemyOverride(entityId, null);
      this.deps.store.markDirty();
    }
  }

  // ------------------------------------------------------------------- boss

  /**
   * Ordrun. Phase 1 is a plain slugging match; at 55% health he drops to phase 2 - lighter armour,
   * a 2.4 s swing instead of 3.0 s, a higher max hit - and starts telegraphing a ground slam every
   * 12 s: 1.8 s of wind-up, then damage to anyone still standing in a 6 m circle.
   *
   * Every number here comes from `ORDRUN_PHASES`. This file owns *when* a phase applies and how the
   * telegraph is published; content owns *what* the phase is.
   *
   * The whole fight is readable from state: `bossPhase` on the enemy record, `telegraphs()` here.
   */
  private updateBoss(
    state: GameState,
    entity: SemanticEntity,
    runtime: NonNullable<GameState["world"]["enemies"][string]>,
    record: AiRecord,
    phases: readonly BossPhase[],
    atMs: number,
  ): void {
    const base = this.deps.combat.baseDefFor(entity);
    const maxHealth = entity.combat?.maxHealth ?? base.maxHealth;
    const fraction = maxHealth > 0 ? runtime.health / maxHealth : 1;

    let index = 0;
    for (let i = 0; i < phases.length; i += 1) {
      const candidate = phases[i];
      if (candidate && fraction <= candidate.atHealthFraction) index = i;
    }
    const phase = phases[index];
    if (!phase) return;
    const phaseNumber = index + 1;

    if (runtime.bossPhase !== phaseNumber) {
      runtime.bossPhase = phaseNumber;
      this.deps.combat.setEnemyOverride(entity.id, {
        armour: phase.armour,
        attackSpeedMs: phase.attackSpeedMs,
        maxHit: phase.maxHit,
      });
      this.deps.store.markDirty();
      // The frozen `GameEventType` has no boss verb, so a phase change rides on `combat.started`
      // with a discriminated `event` payload. See the report: a contract gap, not a preference.
      this.deps.events.emit(
        "combat.started",
        { event: "boss.phase", enemyId: entity.id, name: entity.name, phase: phaseNumber },
        entity.id,
        atMs,
      );
      record.nextSlamAtMs = phase.telegraphId
        ? atMs + (phase.telegraphWindupMs ?? SLAM_WINDUP_MS)
        : 0;
    }

    const telegraph = record.telegraph;
    if (telegraph) {
      if (telegraph.stage === "windup" && atMs >= telegraph.firesAtMs) {
        telegraph.stage = "active";
        this.fireSlam(state, entity, telegraph, phase, atMs);
        this.publishTelegraph(telegraph);
      } else if (telegraph.stage === "active" && atMs >= telegraph.endsAtMs) {
        record.telegraph = null;
      }
      return;
    }

    if (!phase.telegraphId || record.mode !== "aggro") return;
    if (record.nextSlamAtMs === 0) record.nextSlamAtMs = atMs + SLAM_INTERVAL_MS;
    if (atMs < record.nextSlamAtMs) return;

    const windupMs = phase.telegraphWindupMs ?? SLAM_WINDUP_MS;
    const next: BossTelegraph = {
      enemyId: entity.id,
      kind: "ground_slam",
      stage: "windup",
      centre: cloneVec3(entity.position),
      radius: phase.telegraphRadiusM ?? SLAM_RADIUS_METRES,
      startedAtMs: atMs,
      firesAtMs: atMs + windupMs,
      endsAtMs: atMs + windupMs + SLAM_LINGER_MS,
      phase: phaseNumber,
    };
    record.telegraph = next;
    record.nextSlamAtMs = next.endsAtMs + SLAM_INTERVAL_MS;
    this.deps.events.emit(
      "combat.started",
      {
        event: "boss.telegraph", enemyId: entity.id, name: entity.name, kind: phase.telegraphId,
        centre: next.centre, radius: next.radius, firesAtMs: next.firesAtMs, phase: phaseNumber,
      },
      entity.id,
      atMs,
    );
    this.publishTelegraph(next);
  }

  private fireSlam(
    state: GameState,
    entity: SemanticEntity,
    telegraph: BossTelegraph,
    phase: BossPhase,
    atMs: number,
  ): void {
    const inside = distanceXZ(state.player.position, telegraph.centre) <= telegraph.radius;
    const peak = Math.max(1, Math.round(phase.maxHit * SLAM_DAMAGE_MULTIPLIER));
    const damage = inside ? peak : 0;
    if (damage > 0) this.deps.combat.damagePlayer(damage, entity.id, atMs, "special", peak);
    this.deps.events.emit(
      "combat.started",
      {
        event: "boss.slam", enemyId: entity.id, name: entity.name,
        centre: telegraph.centre, radius: telegraph.radius, damage, hit: inside,
      },
      entity.id,
      atMs,
    );
  }

  // -------------------------------------------------------------- read-only

  /** Every live telegraph. `render/overlays.ts` and the HUD both poll this. */
  telegraphs(): BossTelegraph[] {
    const out: BossTelegraph[] = [];
    for (const record of this.records.values()) {
      if (record.telegraph) out.push(record.telegraph);
    }
    return out;
  }

  telegraphFor(enemyId: EntityId): BossTelegraph | undefined {
    return this.records.get(enemyId)?.telegraph ?? undefined;
  }

  /** Push notification for the same data, for a renderer that would rather not poll. */
  onTelegraph(listener: (telegraph: BossTelegraph) => void): () => void {
    this.telegraphListeners.push(listener);
    return () => {
      const index = this.telegraphListeners.indexOf(listener);
      if (index >= 0) this.telegraphListeners.splice(index, 1);
    };
  }

  /** Clears every provocation. `systems/death.ts` calls this so respawning is not a re-ambush. */
  resetOnPlayerDeath(atMs: number): void {
    const state = this.deps.store.get();
    for (const [entityId, record] of this.records) {
      if (record.mode === "aggro") {
        const entity = this.deps.entities.get(entityId);
        if (entity) this.leash(state, entity, record, atMs);
      }
      record.provokedUntilMs = 0;
      record.telegraph = null;
    }
  }

  /** Live AI mode, for `__gameDebug` and the round's acceptance checks. */
  modeOf(enemyId: EntityId): AiMode | undefined {
    return this.records.get(enemyId)?.mode;
  }

  // -------------------------------------------------------------- internals

  private publishTelegraph(telegraph: BossTelegraph): void {
    for (const listener of this.telegraphListeners) listener(telegraph);
  }

  private recordFor(entityId: EntityId): AiRecord {
    const existing = this.records.get(entityId);
    if (existing) return existing;
    const created: AiRecord = {
      mode: "idle", provokedUntilMs: 0, nextSlamAtMs: 0, telegraph: null,
      wanderTarget: null, wanderUntilMs: 0, rng: new Rng(hashId(entityId)),
      habitatAnchorIndex: null, wanderStuckMs: 0,
    };
    this.records.set(entityId, created);
    return created;
  }

  /**
   * Rebuilds the simulated set. Enemies far from the player do nothing at all, so a 700-entity
   * world costs one filtered pass every two seconds rather than a distance check per tick.
   */
  private rescanIfDue(atMs: number): void {
    const state = this.deps.store.get();
    const realm = realmOf(state.player.regionId);
    if (this.nextScanAtMs > atMs && this.scannedRealm === realm) return;
    this.nextScanAtMs = atMs + ENEMY_SCAN_INTERVAL_MS;
    this.scannedRealm = realm;

    const from = state.player.position;
    const next: SemanticEntity[] = [];
    for (const entity of this.deps.entities.all()) {
      if (entity.archetype !== "enemy" && entity.archetype !== "boss") continue;
      if (entity.meta?.galleryMotion === true) continue;
      const record = this.records.get(entity.id);
      const busy = record !== undefined && record.mode !== "idle";
      if (!busy && !sameRealm(state.player.regionId, entity.regionId)) continue;
      const runtime = state.world.enemies[entity.id];
      const dead = runtime?.state === "dead";
      if (!busy && !dead && distanceXZ(from, entity.position) > AI_ACTIVE_RADIUS) continue;
      next.push(entity);
    }
    this.enemies = next;
  }

  /**
   * Straight-line steering, clamped to the enemy's speed and snapped to the navmesh when one is
   * wired. Enemies are not path-followers on purpose: chase distances are short, and a full
   * Detour query per enemy per tick is well outside the 3 ms sim budget.
   */
  private stepToward(
    entity: SemanticEntity,
    target: Vec3,
    speed: number,
    deltaMs: number,
    stopWithin: number,
    habitat: HabitatDef | null = null,
  ): boolean {
    const from = entity.position;
    const dx = target[0] - from[0];
    const dz = target[2] - from[2];
    const gap = Math.sqrt(dx * dx + dz * dz);
    // The same epsilon `madeProgress` rejects a step by, and it has to be the same one.
    //
    // The step below is clamped to `gap - stopWithin`, so the last step of a walk home is however
    // much is left. Once that remainder falls under a millimetre, `madeProgress` rejects the
    // candidate for not moving far enough, rejects both axis slides for the same reason, and
    // `stepToward` returns false — forever. The enemy freezes a fraction of a millimetre outside
    // its own arrival threshold and never arrives.
    //
    // That is not cosmetic. `returning` only ends when this returns true, and arriving is what
    // restores a leashed enemy to full health. A boss stuck here stays in `returning` and stays
    // damaged, which is exactly the "chip it down in safe pieces" the leash heal exists to stop.
    // Measured in the feature lab: a Redsill Cow walking home settled at 0.6001 m against a 0.6 m
    // threshold and sat there for the rest of the session.
    if (gap - stopWithin <= STEP_EPSILON_METRES) return true;

    // Turn before walking. With only the rate cap, a creature whose destination is behind it
    // walks toward the new point while its body is still coming round — half a second of a cow
    // sliding sideways. Spending those ticks pivoting on the spot instead is both what an animal
    // does and what keeps every drawn frame's velocity aligned with its facing.
    const current = entity.view?.rotationY;
    const desired = Math.atan2(dx, dz);
    if (current !== undefined && headingGap(current, desired) > TURN_IN_PLACE_RAD) {
      this.turnTo(entity, desired, deltaMs);
      return false;
    }

    const step = Math.min(gap - stopWithin, (speed * deltaMs) / 1000);
    if (step <= 0) return false;

    const nx = from[0] + (dx / gap) * step;
    const nz = from[2] + (dz / gap) * step;
    const wanted: Vec3 = [nx, from[1], nz];
    let snapped = habitat ? this.snapHabitatStep(wanted, habitat) : this.snapStep(wanted);

    // Detour returns the current boundary point when the direct candidate falls inside a carved
    // solid. Retrying that point forever is the enemy version of walking into a wall. Sliding one
    // axis at a time is cheap, deterministic, and gets around the ordinary building and rock
    // corners without a full path query per enemy per tick.
    if (!this.madeProgress(from, snapped, target, gap)) {
      const candidates = [
        habitat ? this.snapHabitatStep([nx, from[1], from[2]], habitat)
          : this.snapStep([nx, from[1], from[2]]),
        habitat ? this.snapHabitatStep([from[0], from[1], nz], habitat)
          : this.snapStep([from[0], from[1], nz]),
      ].filter((candidate): candidate is Vec3 => this.madeProgress(from, candidate, target, gap));
      candidates.sort((a, b) => distanceXZ(a, target) - distanceXZ(b, target));
      snapped = candidates[0] ?? null;
    }

    if (!snapped) return false;
    const movedX = snapped[0] - from[0];
    const movedZ = snapped[2] - from[2];
    entity.position = snapped;
    this.deps.entities.setPosition?.(entity.id, snapped);
    // Publish the speed this body is ACTUALLY being stepped at, so the renderer retimes the
    // locomotion cycle against it. Before this existed the renderer fell back to the authored
    // pursuit speed, which differs from the authored amble. Pursuit and return now share speed.
    if (entity.view) entity.view.gaitSpeedMps = speed;
    this.faceDirection(entity, movedX, movedZ, deltaMs);
    this.deps.store.markDirty();
    return distanceXZ(snapped, target) <= stopWithin;
  }

  /** Uses raw steering only when no nav port exists. A nav miss is a blocker, not permission. */
  private snapStep(wanted: Vec3): Vec3 | null {
    const snapped = this.deps.nav ? this.deps.nav.nearestWalkable(wanted, 2) : wanted;
    return snapped ? this.ground(snapped) : null;
  }

  /** A nearby polygon across a fence or shore is not the requested habitat footing. */
  private snapHabitatStep(wanted: Vec3, habitat: HabitatDef): Vec3 | null {
    if (!insideHabitat(habitat, wanted)) return null;
    const snapped = this.deps.nav
      ? this.deps.nav.nearestWalkable(wanted, HABITAT_NAV_TOLERANCE) : wanted;
    if (!snapped || distanceXZ(wanted, snapped) > HABITAT_NAV_TOLERANCE
      || !insideHabitat(habitat, snapped)) return null;
    return this.ground(snapped);
  }

  /**
   * Replaces the navmesh's Y with the drawn terrain height, when the two agree closely enough to
   * be talking about the same surface. Keeps the navmesh authoritative for XZ.
   *
   * The player's movement has done exactly this since the float was measured; enemies never did,
   * which is why every animal stood 0.15-0.42 m above its own shadow the moment it took a step.
   */
  private ground(point: Vec3): Vec3 {
    const heightAt = this.deps.groundHeightAt;
    if (!heightAt) return point;
    const groundY = heightAt(point[0], point[2]);
    if (!Number.isFinite(groundY)) return point;
    if (Math.abs(groundY - point[1]) > GROUND_SNAP_MAX_METRES) return point;
    return [point[0], groundY, point[2]];
  }

  /** A useful snap moves at least `STEP_EPSILON_METRES` and does not take the enemy further away. */
  private madeProgress(from: Vec3, candidate: Vec3 | null, target: Vec3, oldGap: number): boolean {
    if (!candidate || distanceXZ(from, candidate) <= STEP_EPSILON_METRES) return false;
    return distanceXZ(candidate, target) < oldGap - STEP_EPSILON_METRES;
  }

  /** Faces the direction the navmesh actually allowed, including an axis fallback. */
  private faceDirection(entity: SemanticEntity, dx: number, dz: number, deltaMs: number): void {
    if (Math.hypot(dx, dz) <= 0.001) return;
    this.turnTo(entity, Math.atan2(dx, dz), deltaMs);
  }

  /** Points an enemy at the player. Purely cosmetic, and cosmetics live in `meta`, not in a mesh. */
  private faceless(entity: SemanticEntity, target: Vec3, deltaMs: number): void {
    this.turnTo(
      entity,
      Math.atan2(target[0] - entity.position[0], target[2] - entity.position[2]),
      deltaMs,
    );
  }

  /** Every facing write goes through the one capped turn, so nothing can reintroduce the snap. */
  private turnTo(entity: SemanticEntity, desired: number, deltaMs: number): void {
    const view = entity.view;
    if (!view) return;
    view.rotationY = turnToward(
      view.rotationY ?? desired, desired, ENEMY_TURN_RATE_RAD_PER_S, deltaMs,
    );
  }

  private setEntityState(entity: SemanticEntity, state: string): void {
    entity.state = state;
    this.deps.entities.setState?.(entity.id, state);
  }
}
