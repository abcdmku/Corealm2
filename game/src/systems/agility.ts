/**
 * Agility shortcuts.
 *
 * Per architecture correction R2, an obstacle is **not** a navmesh off-mesh link. Traversal is a
 * gameplay step, and it is exactly three things:
 *
 *   1. be at the entrance (the dispatcher already enforced range),
 *   2. play the traversal presentation without predicting its success roll,
 *   3. validate the current landing and resolve the outcome after the authored duration.
 *
 * Compact crossings move the rendered rig while gameplay stays at the safe entrance. Distant
 * passages cover placement with an opaque painted frame and reveal after destination rendering.
 *
 *   agilityXp(tier)   = round(10 * tier ^ 0.55 * 1.8)
 *   successChance     = clamp(0.60 + 0.02 * (agilityLevel - obstacle.reqLevel), 0.50, 1.00)
 *   onFail            = randomInt(2, 6) damage, no XP, player stays at the entrance
 *
 * Planned route shortcuts enter through the same dispatcher and activity driver as direct
 * climb, vault and enter interactions. Movement waits for this driver to finish before taking
 * the next route leg, so a route cannot skip the duration, failure roll or XP receipt.
 *
 * The failure placement is the entrance, not a `failPoint`: the frozen `SemanticEntity.obstacle`
 * shape has no such field, and inventing one would be a contract change.
 */
import type { ActivitySummary, EntityId, InteractionId, Result, SemanticEntity, SkillId, Vec3 } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Rng, RngStreams } from "../core/rng.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { ActivityDriver, ActivityTickResult, EntityLookup } from "./activity.js";
import type { ActivitySystem } from "./activity.js";
import { CONTINUE, awardXp, progressToward, stopWith } from "./activity.js";
import type { TickSystem } from "../app/loop.js";
import { agilitySuccessChance, agilityXp } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import { sampleTraversal, type TraversalPresentationPort } from "./traversalMotion.js";

/** PRD 2.8: a botched climb costs 2 to 6 health. */
const FAIL_DAMAGE_RANGE: readonly [number, number] = [2, 6];

/** Fallback when an obstacle omits `durationMs`. PRD 2.8 puts traversals between 2.0 s and 4.0 s. */
const DEFAULT_DURATION_MS = 3000;

/** The navmesh snap this system needs. Injected so agility never imports the navigation system. */
export interface NavSnap {
  closestPoint(point: Vec3): Vec3 | null;
}

/** Validates graph direction and derives the landing from the live authored obstacle. */
export function resolveShortcutEndpoints(
  entity: SemanticEntity,
  entry: Vec3,
  exit: Vec3,
  nav: NavSnap,
): { entryPosition: Vec3; exitPosition: Vec3 } | null {
  if (!entity.obstacle) return null;
  const first = entity.interactionPosition ?? entity.position;
  const second = entity.obstacle.exitPosition;
  const firstSnap = nav.closestPoint(first);
  const secondSnap = nav.closestPoint(second);
  const matches = (point: Vec3, authored: Vec3, snapped: Vec3 | null): boolean =>
    closeEndpoint(point, authored) || (snapped !== null && closeEndpoint(point, snapped));
  if (matches(entry, first, firstSnap) && matches(exit, second, secondSnap)) {
    return { entryPosition: first, exitPosition: second };
  }
  if (entity.meta?.oneWay !== true && matches(entry, second, secondSnap) && matches(exit, first, firstSnap)) {
    return { entryPosition: second, exitPosition: first };
  }
  return null;
}

function closeEndpoint(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 0.01;
}

export interface AgilityDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  entities: EntityLookup;
  activity: ActivitySystem;
  dispatcher: InteractionDispatcher;
  nav: NavSnap;
  presentation?: TraversalPresentationPort;
  isLandingSafe?(point: Vec3): boolean;
}

export class AgilitySystem implements TickSystem {
  readonly name = "agility";

  /**
   * PRD section 3 row 6 ("Activity"), just after the spine at 60.
   *
   * The traversal itself is advanced by `ActivitySystem` through `this.driver`, so this system's
   * own tick has nothing to do. It still implements `TickSystem` so the root registers all four
   * round-2 systems the same way instead of special-casing one of them.
   */
  readonly order = 65;

  readonly driver: ActivityDriver;

  private readonly rng: Rng;

  constructor(private readonly deps: AgilityDeps) {
    // "misc", not "gather": an agility roll must never shift the gather sequence, or the Mining
    // 1-to-10 timing stops being reproducible from a seed.
    this.rng = deps.rng.get("misc");

    this.driver = {
      kind: "traversing",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
      onStop: (_activity, state, reason) => deps.presentation?.end(reason, state.player.position),
    };
    deps.activity.register(this.driver);

    for (const interaction of ["climb", "vault"] as const) {
      deps.dispatcher.registerHandler(interaction, (context) => this.begin(context));
    }
  }

  /** Nothing to do: `ActivitySystem` drives the traversal. See the `order` comment. */
  tick(_deltaMs: number, _atMs: number): void {
    // intentionally empty
  }

  // ------------------------------------------------------------------ start

  /** Route entry uses the same live entity, reach, requirements and handler as a direct click. */
  beginRoute(obstacleId: EntityId, entry: Vec3, exit: Vec3): Result<{ started: string }> {
    const entity = this.deps.entities.get(obstacleId);
    if (!entity) return err("NOT_FOUND", `No obstacle with id ${obstacleId}`, obstacleId);
    if (!entity.obstacle) return err("INVALID_ARGUMENT", `${entity.name} is not an obstacle.`, obstacleId);
    const interaction = entity.interactions.find((verb) => verb === "climb" || verb === "vault" || verb === "enter");
    if (!interaction) return err("INVALID_ARGUMENT", `${entity.name} has no traversal interaction.`, obstacleId);
    const endpoints = resolveShortcutEndpoints(entity, entry, exit, this.deps.nav);
    if (!endpoints) return err("INVALID_ARGUMENT", `${entity.name} does not connect those endpoints.`, obstacleId);
    return this.beginAt(entity, interaction, endpoints.entryPosition, endpoints.exitPosition);
  }

  /** Movement replacement owns cancellation of a traversal, never another activity kind. */
  cancelTraversal(atMs: number, reason: "replaced" | "cancelled"): boolean {
    return this.deps.store.get().activity?.kind === "traversing"
      ? this.deps.activity.stop(reason, atMs)
      : false;
  }

  begin(context: InteractionContext): Result<{ started: string }> {
    return this.beginAt(context.entity, context.interaction, context.entity.interactionPosition ?? context.entity.position);
  }

  private beginAt(
    entity: SemanticEntity,
    interaction: InteractionId,
    entry: Vec3,
    exitPosition?: Vec3,
  ): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;

    if (state.player.health <= 0) return err("DEAD", "The player is dead", entity.id);

    const obstacle = entity.obstacle;
    if (!obstacle) {
      return err("INVALID_ARGUMENT", `${entity.name} is not an obstacle.`, entity.id);
    }

    // Base requirement, checked again here for the same reason gathering re-checks its own: this
    // is the file that owns the rule, and the dispatcher is a general gate.
    if (state.skills.agility.level < obstacle.reqLevel) {
      return err(
        "REQUIREMENTS_NOT_MET",
        `${entity.name} needs Agility ${obstacle.reqLevel}.`,
        entity.id,
      );
    }

    for (const [skill, level] of Object.entries(entity.requirements ?? {})) {
      if (state.skills[skill as SkillId].level < level) {
        return err("REQUIREMENTS_NOT_MET", `${entity.name} needs ${skill} ${level}.`, entity.id);
      }
    }
    const range = this.deps.dispatcher.rangeFor(interaction, entity.id);
    if (distanceXZ(state.player.position, entry) > range) {
      return err("OUT_OF_RANGE", `Move within ${range} m of ${entity.name}'s entrance.`, entity.id);
    }

    if (state.player.movement.mode !== "idle") {
      return err("BUSY", "Stop moving before you take the shortcut.", entity.id);
    }

    const running = state.activity;
    if (running && running.kind === "traversing") {
      return running.obstacleId === entity.id
        ? ok({ started: `already on ${entity.name}` })
        : err("BUSY", "You are already on an obstacle.", entity.id);
    }

    const landing = this.validLanding(exitPosition ?? obstacle.exitPosition);
    if (!landing) {
      return err("INVALID_ARGUMENT", "The shortcut landing is blocked or outside navigation.", entity.id);
    }
    const durationMs = agilityDurationOf(entity);
    const chance = agilitySuccessChance(state.skills.agility.level, obstacle.reqLevel);

    this.deps.activity.start(
      { kind: "traversing", obstacleId: entity.id, endsAtMs: atMs + durationMs,
        ...(exitPosition ? { exitPosition: [...exitPosition] as Vec3 } : {}) },
      atMs,
      {
        op: interaction,
        durationMs,
        reqLevel: obstacle.reqLevel,
        savesMeters: obstacle.savesMeters,
        successChance: Math.round(chance * 1000) / 1000,
        xp: agilityXp(entity.tier),
      },
    );

    this.deps.presentation?.begin(sampleTraversal(entity, state.player.position, landing, 0));
    return ok({ started: `${interaction} ${entity.name}` });
  }

  // ------------------------------------------------------- activity driver

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "traversing") return stopWith("cancelled");

    const entity = this.deps.entities.get(activity.obstacleId);
    const obstacle = entity?.obstacle;
    if (!entity || !obstacle) return stopWith("gone");

    const exit = activity.exitPosition ?? obstacle.exitPosition;
    const landing = this.validLanding(exit);
    if (!landing) {
      this.deps.activity.noteStopData({ damage: 0, xp: 0, landingBlocked: true });
      return stopWith("failed");
    }
    this.deps.presentation?.update(sampleTraversal(entity, state.player.position, landing,
      progressToward(atMs, activity.endsAtMs, agilityDurationOf(entity))));
    if (atMs < activity.endsAtMs || this.deps.presentation?.readyToCommit?.() === false) return CONTINUE;
    const chance = agilitySuccessChance(state.skills.agility.level, obstacle.reqLevel);
    const succeeded = this.rng.chance(chance);

    if (!succeeded) {
      const damage = this.rng.int(FAIL_DAMAGE_RANGE[0], FAIL_DAMAGE_RANGE[1]);
      state.player.health = Math.max(0, state.player.health - damage);
      this.deps.store.markDirty();
      // Rides out on the spine's single `activity.stopped` rather than a second, near-identical
      // event of its own. Damage is the number a player or an agent actually reacts to.
      this.deps.activity.noteStopData({ damage, xp: 0, health: state.player.health });
      return stopWith("failed");
    }

    state.player.position = [landing[0], landing[1], landing[2]];
    state.player.movement.mode = "idle";
    state.player.movement.path = null;
    state.player.movement.pathIndex = 0;
    state.player.movement.destination = null;
    state.player.movement.destinationEntityId = null;

    state.world.obstaclesUsed[entity.id] = (state.world.obstaclesUsed[entity.id] ?? 0) + 1;
    const xp = agilityXp(entity.tier);
    awardXp(state, this.deps.events, "agility", xp, atMs);
    this.deps.store.markDirty();

    this.deps.activity.noteStopData({ xp, damage: 0, exitPosition: state.player.position });
    return stopWith("completed");
  }

  private validLanding(exit: Vec3): Vec3 | null {
    if (!exit.every(Number.isFinite)) return null;
    const landing = this.deps.nav.closestPoint(exit);
    if (!landing || !landing.every(Number.isFinite)
      || Math.hypot(...landing.map((v, i) => v - exit[i]!)) > 2
      || this.deps.isLandingSafe?.(landing) === false) return null;
    return landing;
  }

  private summarise(activity: ActivityState, state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "traversing") {
      return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
    }
    const entity = this.deps.entities.get(activity.obstacleId);
    const durationMs = agilityDurationOf(entity);
    return {
      kind: "traversing",
      skill: "agility",
      entityId: activity.obstacleId,
      progress: progressToward(atMs, activity.endsAtMs, durationMs),
      completed: state.world.obstaclesUsed[activity.obstacleId] ?? 0,
      remaining: 1,
    };
  }
}

export function agilityDurationOf(entity: SemanticEntity | undefined): number {
  const durationMs = entity?.obstacle?.durationMs;
  return durationMs && durationMs > 0 ? durationMs : DEFAULT_DURATION_MS;
}
