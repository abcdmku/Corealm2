/**
 * The continuing-activity spine.
 *
 * Exactly one activity at a time, held in `state.activity` (see `ActivityState` in state/store.ts).
 * This file owns the *lifecycle*: starting, stopping with a reason, the universal interruptions,
 * and the `ActivitySummary` the API hands to the UI and to an agent. The per-kind rules live in
 * drivers registered by gathering, production, agility, eating, and campfire systems.
 *
 * Why this shape matters: one human click and one agent tool call both land in
 * `GameApi.interact -> InteractionDispatcher.run -> handler -> ActivitySystem.start`. There is no
 * second start path, so agent parity is a property of the wiring rather than a claim.
 *
 * Combat is deliberately NOT an activity. It lives in `state.combat`, so a player can eat, or an
 * agent can issue a bank call, while auto-attacks keep resolving.
 */
import type { ActivitySummary, EntityId, ItemId, Result, SemanticEntity, SkillId } from "../contracts.js";
import type { ActivityState, GameState } from "../state/store.js";
import type { Store } from "../state/store.js";
import { addSkillXp } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../core/time.js";
import { productionSummary } from "./production.js";

/** The five activity kinds the frozen `ActivityState` union allows. */
export type ActivityKind = ActivityState["kind"];

/**
 * Why an activity ended. These strings go out on `activity.stopped` as `data.reason`, so they are
 * part of the observable surface: tests and agents match on them.
 *
 * PRD 2.5/2.7: an activity ends on depletion, a full inventory, player movement, damage taken, or
 * an explicit cancel. The rest are structural (the target vanished, a new activity replaced this
 * one, the player died).
 */
export type ActivityStopReason =
  | "completed"
  | "cancelled"
  | "depleted"
  | "inventory-full"
  | "moved"
  | "damaged"
  | "dead"
  | "failed"
  | "gone"
  | "station-expired"
  | "replaced";

export type ActivityTickResult = { done: false } | { done: true; reason: ActivityStopReason };

/** Shared "keep going" result, so drivers do not allocate one per tick. */
export const CONTINUE: ActivityTickResult = { done: false };

export function stopWith(reason: ActivityStopReason): ActivityTickResult {
  return { done: true, reason };
}

/**
 * One kind of activity's rules.
 *
 * Drivers take the whole `ActivityState` union and narrow it themselves. That costs one guard per
 * method and buys a driver table with no casts in it, which is the trade this codebase wants.
 *
 * Drivers must be stateless with respect to the activity: everything they need lives in the
 * `ActivityState` record or the store. `GameApi.stop()` clears `state.activity` directly (it is a
 * frozen file), so a driver holding private per-activity scratch would silently leak.
 */
export interface ActivityDriver {
  readonly kind: ActivityKind;
  tick(activity: ActivityState, state: GameState, deltaMs: number, atMs: number): ActivityTickResult;
  summary(activity: ActivityState, state: GameState, atMs: number): ActivitySummary;
  /** Optional cleanup. Not called when the activity is cleared behind the system's back. */
  onStop?(activity: ActivityState, state: GameState, reason: ActivityStopReason, atMs: number): void;
}

/** The subset of `world/entities.ts` every activity system needs. Injected, never imported. */
export interface EntityLookup {
  get(id: EntityId): SemanticEntity | undefined;
}

/**
 * The inventory seam. Gathering and production talk to it through this port and the root wires
 * the real thing at integration.
 *
 * `addItem` returns the quantity actually added, so a partial stack fill is visible rather than
 * silently lost.
 */
export interface InventoryPort {
  addItem(itemId: ItemId, quantity: number): Result<number>;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
  countItem(itemId: ItemId): number;
  freeSlots(): number;
  /** True when `quantity` of `itemId` would fit right now, stacking rules included. */
  hasRoomFor(itemId: ItemId, quantity: number): boolean;
}

/**
 * Kinds that a step of player movement cancels.
 *
 * "traversing" is exempt because an Agility traversal *is* a displacement; "eating" is exempt
 * because PRD 2.7 has eating block attacks for 1.8 s, not pin the player in place.
 */
const CANCELLED_BY_MOVEMENT: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  "gathering", "production", "building_campfire",
]);

/**
 * Kinds that damage cancels. A traversal is 2 to 4 s and ends in a placement, so interrupting it
 * halfway would leave the player in a state the obstacle never defines.
 */
const CANCELLED_BY_DAMAGE: ReadonlySet<ActivityKind> = new Set<ActivityKind>([
  "gathering", "production", "building_campfire",
]);

export class ActivitySystem implements TickSystem {
  readonly name = "activity";

  /**
   * PRD section 3, row 6 ("Activity"), scaled by ten so later systems can slot between rows.
   * Runs after navigation and physics (which the loop does itself) and before enemy AI, combat and
   * health, so a gather roll and the damage that interrupts it land in that order.
   */
  readonly order = 60;

  private readonly drivers = new Map<ActivityKind, ActivityDriver>();
  private lastHealth: number;
  private lastAtMs = 0;
  /** Set by a driver in the tick it finishes, merged into that stop's event payload. */
  private pendingStopData: Record<string, unknown> | null = null;

  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {
    this.lastHealth = store.get().player.health;
  }

  /** Registering twice replaces, which is what a hot reload and a test harness both want. */
  register(driver: ActivityDriver): void {
    this.drivers.set(driver.kind, driver);
  }

  current(): ActivityState | null {
    return this.store.get().activity;
  }

  isBusy(): boolean {
    return this.store.get().activity !== null;
  }

  /** True when the running activity is on this entity. Used to make a repeat click idempotent. */
  isWorkingOn(entityId: EntityId): boolean {
    const activity = this.store.get().activity;
    return activity !== null && entityIdOf(activity) === entityId;
  }

  // ------------------------------------------------------------------ start

  /**
   * Replaces whatever is running and emits `activity.started`.
   *
   * `extra` is merged into the event payload so a caller can carry the facts a listener needs
   * (item id, obstacle duration, crop) without the spine knowing about any of them.
   */
  start(activity: ActivityState, atMs: number, extra: Record<string, unknown> = {}): void {
    const state = this.store.get();
    if (state.activity) this.stop("replaced", atMs);

    state.activity = activity;
    this.lastHealth = state.player.health;
    // `summary()` is answered between ticks too (the API is synchronous), so keep the clock the
    // summary reads current from the moment the activity exists.
    if (atMs > this.lastAtMs) this.lastAtMs = atMs;
    this.store.markDirty();

    const entityId = entityIdOf(activity);
    this.events.emit(
      "activity.started",
      { kind: activity.kind, skill: skillOf(activity), entityId, ...extra },
      entityId,
      atMs,
    );
  }

  // ------------------------------------------------------------------- stop

  /**
   * Facts about *how* the current activity ended, to be merged into its `activity.stopped` payload.
   *
   * A driver calls this immediately before returning a `done` result. It exists so an agility fail
   * can report its damage, and a gather can report its yield, on the one event that fires — rather
   * than every driver emitting a second, near-duplicate `activity.stopped` of its own.
   */
  noteStopData(data: Record<string, unknown>): void {
    this.pendingStopData = { ...this.pendingStopData, ...data };
  }

  /** Returns false when nothing was running. Emits `activity.stopped` with the reason. */
  stop(reason: ActivityStopReason, atMs: number): boolean {
    const state = this.store.get();
    const activity = state.activity;
    if (!activity) return false;

    const driver = this.drivers.get(activity.kind);
    const summary = driver?.summary(activity, state, atMs);
    const extra = this.pendingStopData ?? {};
    this.pendingStopData = null;

    state.activity = null;
    this.store.markDirty();

    driver?.onStop?.(activity, state, reason, atMs);

    const entityId = entityIdOf(activity);
    this.events.emit(
      "activity.stopped",
      {
        kind: activity.kind,
        skill: skillOf(activity),
        reason,
        entityId,
        completed: summary?.completed ?? 0,
        remaining: summary?.remaining ?? 0,
        ...extra,
      },
      entityId,
      atMs,
    );
    return true;
  }

  /** The player-facing cancel. `GameApi.stop()` has its own copy of this; both are safe. */
  cancel(atMs = this.lastAtMs): boolean {
    return this.stop("cancelled", atMs);
  }

  // ------------------------------------------------------------------- tick

  tick(deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
    const state = this.store.get();
    const activity = state.activity;

    if (!activity) {
      // Nothing running: keep the damage baseline current so the next activity does not open on a
      // stale health value and cancel itself on tick one.
      this.lastHealth = state.player.health;
      return;
    }

    const health = state.player.health;
    const tookDamage = health < this.lastHealth;
    this.lastHealth = health;

    if (health <= 0) {
      this.stop("dead", atMs);
      return;
    }
    if (tookDamage && CANCELLED_BY_DAMAGE.has(activity.kind)) {
      this.stop("damaged", atMs);
      return;
    }
    if (CANCELLED_BY_MOVEMENT.has(activity.kind) && state.player.movement.mode !== "idle") {
      this.stop("moved", atMs);
      return;
    }

    const driver = this.drivers.get(activity.kind);
    if (!driver) return;

    const result = driver.tick(activity, state, deltaMs, atMs);
    if (result.done) this.stop(result.reason, atMs);
  }

  // ---------------------------------------------------------------- summary

  /** Satisfies `SystemHooks.activity` in api/gameApi.ts. */
  summary(): ActivitySummary | null {
    const state = this.store.get();
    const activity = state.activity;
    if (!activity) return null;

    const driver = this.drivers.get(activity.kind);
    if (driver) return driver.summary(activity, state, this.lastAtMs);

    return {
      kind: activity.kind,
      skill: skillOf(activity),
      entityId: entityIdOf(activity),
      progress: 0,
      completed: 0,
      remaining: 0,
    };
  }

  /** The exact object shape `api.register("activity", ...)` wants. */
  hook(): { summary(): ActivitySummary | null } {
    return { summary: () => this.summary() };
  }
}

// ---------------------------------------------------------------- helpers

/**
 * The summary of a replicated activity, for a page. The host's `ActivitySystem` asks each activity's
 * driver. A page has no drivers, only the activity record and the host's clock, and production is the
 * one kind whose record carries more than a name: how many are made and how many are left.
 */
export function activitySummary(activity: ActivityState | null, atMs: number): ActivitySummary | null {
  if (!activity) return null;
  if (activity.kind === "production") return productionSummary(activity, atMs);
  return { kind: activity.kind, skill: skillOf(activity), entityId: entityIdOf(activity), progress: 0, completed: 0, remaining: 0 };
}

/** The entity an activity is aimed at, whatever the kind calls its field. */
export function entityIdOf(activity: ActivityState): EntityId | undefined {
  switch (activity.kind) {
    case "gathering": return activity.entityId;
    case "production": return activity.stationId;
    case "traversing": return activity.obstacleId;
    case "building_campfire": return "player_campfire";
    case "eating": return undefined;
  }
}

/** The skill an activity trains, for the summary and the event payload. */
export function skillOf(activity: ActivityState): SkillId | undefined {
  switch (activity.kind) {
    case "gathering": return activity.skill;
    case "production": return activity.skill;
    case "traversing": return "agility";
    case "building_campfire": return "fletching";
    case "eating": return undefined;
  }
}

/**
 * The one XP path for every activity system.
 *
 * Goes through `addSkillXp` so the level-up happens on the real curve, then emits `level.gained`
 * inside the same tick. Events flush last, so the quest system sees the level before the player
 * does — which is the ordering PRD section 3 calls load-bearing.
 */
export function awardXp(
  state: GameState,
  events: EventBus,
  skill: SkillId,
  amount: number,
  atMs: number,
): number {
  if (amount <= 0) return 0;
  const result = addSkillXp(state, skill, amount);
  if (result.levelsGained > 0) {
    events.emit(
      "level.gained",
      { skill, level: result.newLevel, levelsGained: result.levelsGained },
      undefined,
      atMs,
    );
  }
  return result.levelsGained;
}

/** 0..1 progress toward a deadline, given the unit of work's full duration. */
export function progressToward(atMs: number, endsAtMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const remaining = endsAtMs - atMs;
  return clamp01(1 - remaining / durationMs);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
