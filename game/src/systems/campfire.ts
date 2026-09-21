/**
 * Portable player campfires.
 *
 * Building is a three-second activity. The carried log stays in the inventory until the activity
 * completes, so cancelling, moving, taking damage, or dying cannot eat an ingredient. A finished
 * fire is one ordinary semantic production station with the reserved id `player_campfire`.
 *
 * Fire lifetime uses `state.meta.playSeconds`, not a wall-clock deadline. Saves therefore pause the
 * countdown while the game is closed. `tick` runs before the activity spine so an expiring fire is
 * removed before Cooking tries to complete its next batch item.
 */
import type {
  ActivitySummary, EntityId, ItemId, RegionId, Result, SemanticEntity, Vec3,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../core/time.js";
import { INTERACT_RANGE } from "../app/config.js";
import type { CampfireFuelDef, GatheringProductionTierDef } from "../content/index.js";
import type {
  ActivityDriver, ActivityTickResult,
} from "./activity.js";
import { CONTINUE, awardXp, progressToward, stopWith } from "./activity.js";

export const CAMPFIRE_ENTITY_ID = "player_campfire";
/** Stable save-record id. This is intentionally distinct from the live semantic entity id. */
export const CAMPFIRE_SAVE_ID = "campfire:player";
export const CAMPFIRE_BUILD_TIME_MS = 3_000;
export const CAMPFIRE_CLEARANCE_METRES = 1;
export const CAMPFIRE_MAX_SLOPE_DEGREES = 15;

const FORWARD_DISTANCE_METRES = 1.5;
const OUTER_DISTANCE_METRES = 2.1;
const INNER_DISTANCE_METRES = 1.2;
const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Played time is accumulated from fractional simulation ticks. Normalize the subtraction to the
 * save format's millisecond precision before displaying or comparing it. Without this, a Duskoak
 * fire built at 18.799999999999997 seconds has a mathematical 120-second lifetime but JavaScript
 * subtracts it as 120.00000000000001; `Math.ceil` then shows 121 and expiry runs a tick late.
 */
function remainingPlayedMilliseconds(deadlineSeconds: number, playedSeconds: number): number {
  return Math.max(0, Math.round((deadlineSeconds - playedSeconds) * 1_000));
}

function remainingPlayedSeconds(deadlineSeconds: number, playedSeconds: number): number {
  return Math.ceil(remainingPlayedMilliseconds(deadlineSeconds, playedSeconds) / 1_000);
}

/**
 * The activity slice used by this system. `ActivitySystem` satisfies it directly.
 */
export interface CampfireActivityPort {
  register(driver: ActivityDriver): void;
  start(activity: ActivityState, atMs: number, extra?: Record<string, unknown>): void;
  current(): ActivityState | null;
  isBusy(): boolean;
}

/** Inventory operations needed to build a fire. */
export interface CampfireInventoryPort {
  countItem(itemId: ItemId): number;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
}

/** Mutable entity operations supplied by `EntityStore`. */
export interface CampfireEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  add(entity: SemanticEntity): void;
  remove(id: EntityId): boolean;
}

export interface CampfireGroundHit {
  y: number;
  /** Unit length is preferred, but the system normalises defensively. */
  normal: Vec3;
}

/**
 * World-specific placement questions.
 *
 * The root adapter should answer these from the canonical terrain, solved water surfaces, static
 * collision, buildings, and interactable resource nodes. `clearAt` must leave the supplied radius
 * free around the candidate.
 */
export interface CampfirePlacementProbes {
  groundAt(regionId: RegionId, x: number, z: number): CampfireGroundHit | null;
  withinPlayableBounds(regionId: RegionId, position: Vec3): boolean;
  distanceToWater(regionId: RegionId, position: Vec3): number;
  clearAt(regionId: RegionId, position: Vec3, radius: number): boolean;
}

export interface CampfireDeps {
  entityId?: EntityId;
  store: Store;
  events: EventBus;
  activity: CampfireActivityPort;
  inventory: CampfireInventoryPort;
  entities: CampfireEntityPort;
  placement: CampfirePlacementProbes;
  /** Canonical tier-catalog lookup. Tests may inject a small table through this same seam. */
  fuelFor(logItemId: ItemId): CampfireFuelDef | undefined;
  /** Current simulation milliseconds, used only for activity and event timestamps. */
  now(): number;
  interactionRange?: number;
}

/**
 * Builds a fuel lookup from the canonical tier rows without creating a second campfire table.
 */
export function campfireFuelLookup(
  tiers: readonly GatheringProductionTierDef[],
): (logItemId: ItemId) => CampfireFuelDef | undefined {
  const byLog = new Map<ItemId, CampfireFuelDef>();
  for (const tier of tiers) byLog.set(tier.campfire.logItemId, tier.campfire);
  return (logItemId) => byLog.get(logItemId);
}

/**
 * Candidate offsets in deterministic priority order. The first point is 1.5 metres directly in
 * front of the player. The remaining points fan left and right before trying a slightly nearer and
 * farther ring. No point is farther away than the interaction range.
 */
export function campfirePlacementCandidates(
  origin: Vec3,
  facingRad: number,
  interactionRange = INTERACT_RANGE,
): Vec3[] {
  const maxRange = Math.max(0, interactionRange);
  const radii = uniqueNumbers([
    Math.min(FORWARD_DISTANCE_METRES, maxRange),
    Math.min(INNER_DISTANCE_METRES, maxRange),
    Math.min(OUTER_DISTANCE_METRES, maxRange),
  ]).filter((radius) => radius > 0);
  const angleOffsets = [0, -25, 25, -50, 50, -70, 70] as const;
  const out: Vec3[] = [];

  for (const radius of radii) {
    for (const offset of angleOffsets) {
      const angle = facingRad + offset * DEGREES_TO_RADIANS;
      out.push([
        origin[0] + Math.sin(angle) * radius,
        origin[1],
        origin[2] + Math.cos(angle) * radius,
      ]);
    }
  }
  return out;
}

export class CampfireSystem implements TickSystem {
  private get entityId(): EntityId { return this.deps.entityId ?? CAMPFIRE_ENTITY_ID; }
  readonly name = "campfire";

  /** Expiry must be visible before ActivitySystem (order 60) advances a Cooking batch. */
  readonly order = 55;

  readonly driver: ActivityDriver;

  constructor(private readonly deps: CampfireDeps) {
    this.driver = {
      kind: "building_campfire",
      tick: (activity, state, deltaMs, atMs) => this.advanceBuild(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summariseBuild(activity, state, atMs),
      onStop: (_activity, _state, _reason, _atMs) => {
        // The ingredient is deliberately untouched here. Only `completeBuild` consumes it.
      },
    };
    deps.activity.register(this.driver);

    // Boot may construct this before or after the static entity load. Doing the work here makes the
    // latter case immediate; the first tick repeats it for the former case.
    this.reconstruct();
  }

  /** Shape registered as `SystemHooks.campfire`. */
  hook(): {
    build(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }>;
  } {
    return { build: (logItemId) => this.build(logItemId) };
  }

  /**
   * Starts a build at the first valid candidate. It never accepts caller-provided coordinates.
   */
  build(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }> {
    const state = this.deps.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (isInCombat(state)) return err("BUSY", "A campfire cannot be built during combat");
    if (this.deps.activity.isBusy()) return err("BUSY", "Another activity is already in progress");

    const fuel = this.deps.fuelFor(logItemId);
    if (!fuel) return err("INVALID_ARGUMENT", `${logItemId} is not a campfire fuel`);
    if (this.deps.inventory.countItem(logItemId) < 1) {
      return err("NOT_ENOUGH_ITEMS", `A ${logItemId} is required to build this fire`);
    }

    const position = this.firstValidPlacement(state);
    if (!position) {
      return err(
        "NOT_REACHABLE",
        "No dry, level, clear campfire placement is available within reach",
      );
    }

    const atMs = this.deps.now();
    const activity: ActivityState = {
      kind: "building_campfire",
      logItemId,
      tier: fuel.tier,
      regionId: state.player.regionId,
      position,
      buildTimeMs: fuel.buildTimeMs,
      lifetimeMs: fuel.lifetimeMs,
      endsAtMs: atMs + fuel.buildTimeMs,
    };
    this.deps.activity.start(activity, atMs, {
      logItemId,
      tier: fuel.tier,
      durationMs: fuel.buildTimeMs,
      lifetimeMs: fuel.lifetimeMs,
      position,
    });

    return ok({ entityId: this.entityId, lifetimeMs: fuel.lifetimeMs, position });
  }

  /**
   * Restores the semantic station from persisted state. Safe to call repeatedly and after a world
   * entity reload.
   */
  reconstruct(): boolean {
    const state = this.deps.store.get();
    const persisted = state.world.campfire;

    if (!persisted) {
      const stale = this.deps.entities.get(this.entityId);
      if (stale?.meta?.campfire === true) this.deps.entities.remove(this.entityId);
      return false;
    }

    if (remainingPlayedMilliseconds(persisted.expiresAtPlaySeconds, state.meta.playSeconds) === 0) {
      this.expire(state, this.deps.now());
      return false;
    }

    const fuel = this.deps.fuelFor(persisted.logItemId);
    if (!fuel) return false;
    this.ensureEntity(state, fuel);
    return true;
  }

  /** Handles played-time expiry and refreshes the UI-readable countdown. */
  tick(_deltaMs: number, atMs: number): void {
    const state = this.deps.store.get();
    const persisted = state.world.campfire;
    if (!persisted) {
      const stale = this.deps.entities.get(this.entityId);
      if (stale?.meta?.campfire === true) this.deps.entities.remove(this.entityId);
      return;
    }

    if (remainingPlayedMilliseconds(persisted.expiresAtPlaySeconds, state.meta.playSeconds) === 0) {
      this.expire(state, atMs);
      return;
    }

    const fuel = this.deps.fuelFor(persisted.logItemId);
    if (!fuel) return;
    const entity = this.ensureEntity(state, fuel);
    if (entity.meta) {
      entity.meta.remainingSeconds = remainingPlayedSeconds(
        persisted.expiresAtPlaySeconds,
        state.meta.playSeconds,
      );
    }
  }

  private advanceBuild(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "building_campfire") return stopWith("failed");
    if (atMs < activity.endsAtMs) return CONTINUE;
    return this.completeBuild(activity, state, atMs);
  }

  private completeBuild(
    activity: Extract<ActivityState, { kind: "building_campfire" }>,
    state: GameState,
    atMs: number,
  ): ActivityTickResult {
    const fuel = this.deps.fuelFor(activity.logItemId);
    if (
      !fuel
      || fuel.tier !== activity.tier
      || fuel.buildTimeMs !== activity.buildTimeMs
      || fuel.lifetimeMs !== activity.lifetimeMs
    ) {
      return stopWith("failed");
    }

    // Travel and debug teleports can replace the player's region or position without presenting a
    // movement tick to ActivitySystem. The site can also become blocked during the build. Repeat
    // every placement probe at the selected coordinates before touching the log or either XP total.
    if (state.player.regionId !== activity.regionId) return stopWith("failed");
    const position = this.validPlacementAt(activity.regionId, activity.position);
    if (!position) return stopWith("failed");
    const interactionRange = this.deps.interactionRange ?? INTERACT_RANGE;
    if (distanceXZ(state.player.position, position) > interactionRange) return stopWith("failed");

    // This is the single consumption point. A missing log leaves the old fire and both XP totals
    // untouched.
    const removed = this.deps.inventory.removeItem(activity.logItemId, 1);
    if (!removed.ok || removed.value !== 1) return stopWith("failed");

    const previous = state.world.campfire;
    const expiresAtPlaySeconds = state.meta.playSeconds + activity.lifetimeMs / 1_000;
    state.world.campfire = {
      id: CAMPFIRE_SAVE_ID,
      position,
      regionId: activity.regionId,
      logItemId: activity.logItemId,
      tier: activity.tier,
      expiresAtPlaySeconds,
    };

    // The id is stable, but remove first so EntityStore's spatial index cannot retain the old
    // position after a replacement.
    this.deps.entities.remove(this.entityId);
    this.deps.entities.add(this.semanticEntity(state.world.campfire, fuel, state));
    this.deps.store.markDirty();

    if (previous) {
      this.deps.events.emit(
        "campfire.replaced",
        {
          previousLogItemId: previous.logItemId,
          previousTier: previous.tier,
          logItemId: activity.logItemId,
          tier: activity.tier,
          position,
        },
        this.entityId,
        atMs,
      );
    }
    this.deps.events.emit(
      "campfire.built",
      {
        logItemId: activity.logItemId,
        tier: activity.tier,
        lifetimeMs: activity.lifetimeMs,
        expiresAtPlaySeconds,
        position,
      },
      this.entityId,
      atMs,
    );

    awardXp(state, this.deps.events, "fletching", fuel.buildXp.fletching, atMs);
    awardXp(state, this.deps.events, "crafting", fuel.buildXp.crafting, atMs);
    return stopWith("completed");
  }

  private summariseBuild(
    activity: ActivityState,
    _state: GameState,
    atMs: number,
  ): ActivitySummary {
    if (activity.kind !== "building_campfire") {
      return { kind: "building_campfire", progress: 0, completed: 0, remaining: 0 };
    }
    return {
      kind: activity.kind,
      entityId: this.entityId,
      progress: progressToward(atMs, activity.endsAtMs, activity.buildTimeMs),
      completed: 0,
      remaining: 1,
    };
  }

  private firstValidPlacement(state: GameState): Vec3 | null {
    const regionId = state.player.regionId;
    const candidates = campfirePlacementCandidates(
      state.player.position,
      state.player.facingRad,
      this.deps.interactionRange ?? INTERACT_RANGE,
    );

    for (const candidate of candidates) {
      const grounded = this.validPlacementAt(regionId, candidate);
      if (grounded) return grounded;
    }
    return null;
  }

  /** Runs the full placement contract at one XZ coordinate and returns its current ground point. */
  private validPlacementAt(regionId: RegionId, candidate: Vec3): Vec3 | null {
    if (!Number.isFinite(candidate[0]) || !Number.isFinite(candidate[2])) return null;
    const hit = this.deps.placement.groundAt(regionId, candidate[0], candidate[2]);
    if (!hit || !Number.isFinite(hit.y)) return null;
    if (slopeDegrees(hit.normal) > CAMPFIRE_MAX_SLOPE_DEGREES) return null;

    const grounded: Vec3 = [candidate[0], hit.y, candidate[2]];
    if (!this.deps.placement.withinPlayableBounds(regionId, grounded)) return null;
    const waterDistance = this.deps.placement.distanceToWater(regionId, grounded);
    // Infinity is the honest answer when a region has no nearby water. NaN means the probe could
    // not solve the question and is rejected conservatively.
    if (Number.isNaN(waterDistance) || waterDistance < CAMPFIRE_CLEARANCE_METRES) return null;
    if (!this.deps.placement.clearAt(regionId, grounded, CAMPFIRE_CLEARANCE_METRES)) return null;
    return grounded;
  }

  private ensureEntity(state: GameState, fuel: CampfireFuelDef): SemanticEntity {
    const persisted = state.world.campfire;
    if (!persisted) throw new Error("Cannot materialise a campfire without persisted state");

    const existing = this.deps.entities.get(this.entityId);
    const sameFire = existing?.meta?.campfire === true
      && existing.regionId === persisted.regionId
      && existing.tier === persisted.tier
      && existing.meta.logItemId === persisted.logItemId
      && existing.meta.expiresAtPlaySeconds === persisted.expiresAtPlaySeconds
      && samePosition(existing.position, persisted.position);
    if (existing && sameFire) return existing;

    if (existing) this.deps.entities.remove(this.entityId);
    const entity = this.semanticEntity(persisted, fuel, state);
    this.deps.entities.add(entity);
    return entity;
  }

  private semanticEntity(
    persisted: NonNullable<GameState["world"]["campfire"]>,
    fuel: CampfireFuelDef,
    state: GameState,
  ): SemanticEntity {
    return {
      id: this.entityId,
      archetype: "station",
      name: "Player Campfire",
      tier: persisted.tier,
      regionId: persisted.regionId,
      position: persisted.position,
      state: "lit",
      interactions: ["produce"],
      station: { kind: "campfire", skill: "cooking", recipeIds: [] },
      view: {
        assetId: fuel.visualLogAssetId,
        // The source logs are about 2.5 m long. At this scale the crossed-log and stone-ring
        // composition is roughly 1.6 m across, inside the placement rule's one-metre clear radius.
        scale: 0.42,
        materialTier: persisted.tier,
        labelHeight: 1.15,
      },
      meta: {
        campfire: true,
        logItemId: persisted.logItemId,
        visualLogAssetId: fuel.visualLogAssetId,
        expiresAtPlaySeconds: persisted.expiresAtPlaySeconds,
        remainingSeconds: remainingPlayedSeconds(
          persisted.expiresAtPlaySeconds,
          state.meta.playSeconds,
        ),
      },
    };
  }

  private expire(state: GameState, atMs: number): void {
    const expired = state.world.campfire;
    if (!expired) return;
    this.deps.entities.remove(this.entityId);
    state.world.campfire = null;
    this.deps.store.markDirty();
    this.deps.events.emit(
      "campfire.expired",
      {
        logItemId: expired.logItemId,
        tier: expired.tier,
        position: expired.position,
      },
      this.entityId,
      atMs,
    );
  }
}

function isInCombat(state: GameState): boolean {
  return state.combat.targetId !== null || state.combat.engagedBy.length > 0;
}

function slopeDegrees(normal: Vec3): number {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!Number.isFinite(length) || length <= 0) return Number.POSITIVE_INFINITY;
  const up = Math.max(-1, Math.min(1, normal[1] / length));
  return Math.acos(up) / DEGREES_TO_RADIANS;
}

function samePosition(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function uniqueNumbers(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (!out.some((candidate) => Math.abs(candidate - value) < 1e-9)) out.push(value);
  }
  return out;
}
