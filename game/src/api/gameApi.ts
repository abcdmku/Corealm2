/**
 * The canonical game API — the ONLY write path into the world.
 *
 * `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through this class. A human click
 * and a WebMCP call reach the identical function, which is what makes agent parity a property of
 * the architecture rather than a claim in a document.
 *
 * Nothing here throws across the boundary. Failures come back as `Result<T>`.
 *
 * FROZEN. Only the root edits this file.
 */
import type {
  ActivitySummary, BankView, DialogueView, DocHit, EntityId, EquipSlot, EquipmentBonuses, EventBatch,
  GameApi as GameApiContract, GameEventType, InteractionId, InventorySlot, ItemId,
  ItemStack, LootTakeResult, MoveTarget, ObserveFilter, ObservedEntity, PathPlan, PlayerView, QuestSummary, RecipeId, TimeView,
  Result, SemanticEntity, SkillId, SkillView, SpellbookView, SpellCastLock, SpellElement, SpellId, SpellRow, StateRevision, Vec3,
  OverlaySpec,
} from "../contracts.js";
import { EQUIP_SLOTS, SKILL_IDS, err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { Navigation, RouteLeg } from "../systems/navigation.js";
import { ARRIVE_EPSILON, ENTITY_ARRIVAL_ALLOWANCE, type Movement, type MovementPathPlan } from "../systems/movement.js";
import { equipmentTotalsOf } from "../systems/equipment.js";
import { agilityDurationOf, resolveShortcutEndpoints } from "../systems/agility.js";
import type { SimClock } from "../core/time.js";
import { levelProgress, xpToNextLevel } from "../content/xp.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";
import { content } from "../content/index.js";
import { magicMaxHit } from "../systems/combat.js";
import { SPELL_RUNES } from "../content/spells.js";
import {
  ESSENCE_BY_ELEMENT, RELEASED_MAGIC_ELEMENTS, equippedMagicWeaponView, spellBlockReason, spellRunesCarried,
} from "../systems/essence.js";

/**
 * Metres of reach given up when walking into range of a ranged interaction.
 *
 * Stopping exactly on the range boundary puts the player one footstep from being out of it, and a
 * wandering enemy would then bounce them between "in range" and "walk closer" for the whole fight.
 */
const RANGED_APPROACH_SLACK = 1.5;
/** Keeps short interactions inside reach even when movement finishes within its 0.35 m tolerance. */
const INTERACTION_APPROACH_SLACK = 0.5;

/**
 * One player-facing answer for a destination that neither the navmesh nor route graph can reach.
 *
 * `moveTo` returns this error to its immediate caller and emits `navigation.failed` for listeners.
 * The HUD receives both paths after a human click, so the wording must stay identical or one bad
 * click fills the message log with two versions of the same failure.
 */
export const UNREACHABLE_DESTINATION_MESSAGE = "There is no route to that place.";

/** The terminal result of an interaction that first had to walk into range. */
export interface PendingInteractionOutcome {
  entityId: EntityId;
  interaction: InteractionId;
  result: Result<{ started: string }>;
}

interface MovementCandidate extends MovementPathPlan {
  /** Empty for a direct navmesh path. */
  legs: RouteLeg[];
}

/** Total quantity of one item across inventory slots, ignoring the empty ones. */
function countIn(slots: readonly (InventorySlot | null)[], itemId: ItemId): number {
  let total = 0;
  for (const slot of slots) if (slot && slot.itemId === itemId) total += slot.quantity;
  return total;
}

/**
 * Systems register themselves here as they come online in later build rounds. The API surface is
 * frozen now; the implementations behind these hooks arrive per round. A hook that is not yet
 * registered returns UNAVAILABLE rather than throwing, so the contract holds from round 0.
 */
export interface SystemHooks {
  entities?: {
    get(id: EntityId): SemanticEntity | undefined;
    all(): SemanticEntity[];
    observe(filter: ObserveFilter, from: Vec3): ObservedEntity[];
  };
  gathering?: { start(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> };
  inventory?: {
    slots(): (InventorySlot | null)[];
    freeSlots(): number;
    use(itemId: ItemId, target?: { itemId: ItemId }): Result<{ effect: string }>;
  };
  equipment?: {
    slots(): Record<EquipSlot, ItemStack | null>;
    totals(): EquipmentBonuses;
    equip(itemId: ItemId, targetSlot?: EquipSlot): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
    unequip(slot: EquipSlot): Result<{ itemId: ItemId }>;
  };
  production?: {
    produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;
    produceAt(
      stationId: EntityId,
      recipeId: RecipeId,
      quantity: number,
    ): Result<{ queued: number; durationMs: number }>;
  };
  campfire?: {
    build(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }>;
  };
  combat?: {
    attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
    cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
    castNow(spellId: SpellId): Result<{ targetId: EntityId; castMs: number }>;
    castArea(spellId: SpellId, point: Vec3): Result<{ castMs: number; victims: number }>;
    setPreferredSpell(spellId: SpellId | null): void;
    /** The advanced invocation still resolving, if any. Drives the action bar's slot lock. */
    castLock(): SpellCastLock | null;
  };
  dialogue?: { op(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> };
  bank?: {
    op(op: "list" | "deposit" | "withdraw" | "depositAll", args?: { itemId?: ItemId; quantity?: number; filter?: string }): Result<BankView>;
  };
  shop?: {
    op(op: "list" | "buy" | "sell", args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number }): Result<ShopViewLike>;
  };
  quests?: { summaries(): QuestSummary[] };
  overlays?: { set(spec: OverlaySpec): number; clear(id?: string): number };
  docs?: { search(query: string, limit: number): Promise<DocHit[]> };
  activity?: { summary(): ActivitySummary | null };
  interactions?: {
    run(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
    /**
     * How close this verb needs the player before its handler runs.
     *
     * `world/interactions.ts` has owned per-verb reach since round 4 and `interact` did not consult
     * it: it walked to a hardcoded INTERACT_RANGE for everything, so a nine-metre spell marched the
     * caster into melee before the first cast and the dispatcher's own SPELL_RANGE never came into
     * play. Optional, so a partially-registered hook still behaves exactly as before.
     */
    rangeFor?(interaction: InteractionId, entityId?: EntityId): number;
  };
  loot?: {
    take(entityId: EntityId, stackIndex?: number): Result<LootTakeResult>;
  };
}

type ShopViewLike = import("../contracts.js").ShopView;

export class CorealmGameApi implements GameApiContract {
  readonly hooks: SystemHooks = {};
  private movementCommandsEnabled = true;

  /**
   * The interaction to re-fire once the player finishes walking into range.
   *
   * Without this, "click a distant ore" walked the player there and then stopped — the single most
   * important affordance in the game, silently half-implemented. It is held here rather than in the
   * movement system because it is an API-level affordance: one call means "get there and do it",
   * for a human click and an agent tool call alike.
   */
  private pending: { entityId: EntityId; interaction: InteractionId; expiresAtMs: number } | null = null;
  private readonly pendingResultListeners = new Set<(outcome: PendingInteractionOutcome) => void>();

  constructor(
    private readonly store: Store,
    private readonly eventBus: EventBus,
    private readonly nav: Navigation,
    private readonly movement: Movement,
    private readonly clock: SimClock,
  ) {}

  register<K extends keyof SystemHooks>(key: K, hook: NonNullable<SystemHooks[K]>): void {
    this.hooks[key] = hook;
  }

  /** Runtime authoring surfaces can suspend every API path that would start navigation. */
  setMovementCommandsEnabled(enabled: boolean): void {
    this.movementCommandsEnabled = enabled;
    if (enabled) return;
    this.pending = null;
    if (this.movement.stop(this.store.get(), this.clock.elapsedMs, "movement-disabled")) {
      this.store.markDirty();
    }
  }

  /**
   * Receives the real handler result after a routed interaction reaches its target.
   *
   * The initial `interact` call can only report that walking began. Boot uses this callback to put
   * a later rejection, such as an altar refusing an already-full weapon, in the same notice channel as
   * an interaction that started in range. Listener failures are isolated from gameplay.
   */
  subscribePendingResult(listener: (outcome: PendingInteractionOutcome) => void): () => void {
    this.pendingResultListeners.add(listener);
    return () => this.pendingResultListeners.delete(listener);
  }

  // ------------------------------------------------------------------ state

  getPlayer(): PlayerView {
    const state = this.store.get();
    const player = state.player;
    return {
      position: [...player.position] as unknown as Vec3,
      regionId: player.regionId,
      health: player.health,
      maxHealth: player.maxHealth,
      facingRad: player.facingRad,
      // A live fight, not the regen window. An agent that waits for `inCombat === false` after a
      // kill used to hang for the full eight-second no-regen stamp; that stamp is `regenBlocked`.
      inCombat: state.combat.targetId !== null || state.combat.engagedBy.length > 0,
      regenBlocked: state.combat.inCombatUntilMs > this.clock.elapsedMs,
      targetId: state.combat.targetId,
      engagedBy: [...state.combat.engagedBy],
      dead: player.health <= 0,
      moving: player.movement.mode !== "idle",
      activityKind: state.activity?.kind ?? null,
      combatLevelEstimate: Math.max(
        1,
        Math.floor((state.skills.melee.level + state.skills.magic.level) / 2),
      ),
    };
  }

  getTime(): TimeView {
    return {
      simMs: this.clock.elapsedMs,
      tick: this.clock.tick,
      timeScale: this.clock.timeScale,
      paused: this.clock.paused,
    };
  }

  getRevision(): StateRevision {
    return {
      revision: this.store.revision(),
      eventSeq: this.eventBus.currentSeq(),
      simMs: this.clock.elapsedMs,
      tick: this.clock.tick,
    };
  }

  getSkills(): Record<SkillId, SkillView> {
    const state = this.store.get();
    const out = {} as Record<SkillId, SkillView>;
    for (const id of SKILL_IDS) {
      const entry = state.skills[id];
      out[id] = { level: entry.level, xp: entry.xp, xpToNext: xpToNextLevel(entry.xp) };
    }
    return out;
  }

  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number } {
    const hook = this.hooks.inventory;
    if (hook) return { slots: hook.slots(), freeSlots: hook.freeSlots() };
    const slots = this.store.get().inventory.slots;
    return { slots: [...slots], freeSlots: slots.filter((slot) => slot === null).length };
  }

  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses } {
    const hook = this.hooks.equipment;
    if (hook) return { slots: hook.slots(), totals: hook.totals() };
    const slots = {} as Record<EquipSlot, ItemStack | null>;
    for (const slot of EQUIP_SLOTS) slots[slot] = this.store.get().equipment[slot];
    // Derive the totals rather than answering zero. An agent or a panel asking what the player is
    // wearing used to get a confident all-zero `EquipmentBonuses` whenever the equipment hook was
    // absent, which is indistinguishable from wearing nothing — the worst of the three possible
    // answers, because it is wrong and it looks right. `equipmentTotalsOf` is the same derivation
    // the hook runs, over the slots this branch has already read out of the store.
    return { slots, totals: equipmentTotalsOf(slots) };
  }

  getActivity(): ActivitySummary | null {
    const hook = this.hooks.activity;
    if (hook) return hook.summary();
    const activity = this.store.get().activity;
    if (!activity) return null;
    return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
  }

  getQuests(): QuestSummary[] {
    return this.hooks.quests?.summaries() ?? [];
  }

  getCurrency(): number {
    return this.store.get().currency;
  }

  // ------------------------------------------------------------ observation

  observe(filter: ObserveFilter): ObservedEntity[] {
    const hook = this.hooks.entities;
    if (!hook) return [];
    return hook.observe(filter, this.store.get().player.position);
  }

  inspect(entityId: EntityId): Result<SemanticEntity> {
    const entity = this.hooks.entities?.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);
    return ok(entity);
  }

  async searchDocs(query: string, limit = 5): Promise<DocHit[]> {
    return this.hooks.docs?.search(query, Math.max(1, Math.min(limit, 25))) ?? [];
  }

  // --------------------------------------------------------------- movement

  moveTo(target: MoveTarget): Result<{ pathLength: number; etaMs: number }> {
    return this.walkTo(target, 0);
  }

  /**
   * `moveTo`, but allowed to stop short.
   *
   * `stopDistance` is metres of the tail to leave unwalked, which `Movement.startPath` implements by
   * trimming the path. Gathering and other short interactions need a reachable stand point
   * outside the target's solid footprint; ranged interactions stop at their longer verb reach.
   */
  private walkTo(target: MoveTarget, stopDistance: number): Result<{ pathLength: number; etaMs: number }> {
    if (!this.movementCommandsEnabled) {
      return err("UNAVAILABLE", "Walking is disabled in the building workbench");
    }
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (!this.nav.isReady()) return err("UNAVAILABLE", "Navigation is not ready");

    let destination: Vec3 | null = null;
    let entityId: EntityId | null = null;
    let locationId: string | null = null;

    if ("position" in target) {
      destination = target.position;
    } else if ("entityId" in target) {
      const entity = this.hooks.entities?.get(target.entityId);
      if (!entity) return err("NOT_FOUND", `No entity with id ${target.entityId}`, target.entityId);
      destination = entity.interactionPosition ?? entity.position;
      entityId = entity.id;
    } else {
      const node = this.nav.routeNode(target.locationId);
      if (!node) return err("NOT_FOUND", `No known location ${target.locationId}`);
      destination = node.position;
      locationId = target.locationId;
    }

    if (!destination) return err("INVALID_ARGUMENT", "No destination resolved");

    // A new destination owns the arrival. `interact` installs its next action after this succeeds.
    this.pending = null;

    const candidate = this.selectMovementCandidate(state, destination, entityId, locationId, stopDistance);
    if (candidate && candidate.legs.length > 0) {
      const started = this.movement.startRoute(state, candidate.legs, this.clock.elapsedMs, entityId, {
        stopDistance,
        arrivalAllowance: entityId !== null ? ENTITY_ARRIVAL_ALLOWANCE : 0,
      });
      this.store.markDirty();
      // Movement reports a failed route leg itself. Do not emit a second failure for that journey.
      return started
        ? ok({ pathLength: Math.round(candidate.pathLength * 100) / 100, etaMs: Math.round(candidate.etaMs) })
        : err("NOT_REACHABLE", UNREACHABLE_DESTINATION_MESSAGE);
    }
    if (candidate) {
      const started = this.movement.startPath(state, destination, entityId, this.clock.elapsedMs, {
        quietFailure: true,
        stopDistance,
      }, candidate);
      if (started) {
        this.store.markDirty();
        return ok(started);
      }
    } else {
      this.movement.replaceIntent(state, this.clock.elapsedMs);
    }

    // Planning has no events. A destination neither candidate can reach fails exactly once here.
    this.store.markDirty();
    this.eventBus.emit(
      "navigation.failed",
      { reason: "unreachable", to: destination },
      entityId ?? undefined,
      this.clock.elapsedMs,
    );
    return err("NOT_REACHABLE", UNREACHABLE_DESTINATION_MESSAGE);
  }

  /**
   * Compare executable walking time and crossing durations before starting either journey.
   * The graph's authored costs choose a candidate; real prepared paths decide whether it saves time.
   */
  private selectMovementCandidate(
    state: GameState,
    destination: Vec3,
    entityId: EntityId | null,
    locationId: string | null,
    stopDistance = 0,
  ): MovementCandidate | null {
    const direct = this.movement.planPath(state.player.position, destination, entityId, { stopDistance });
    const directCandidate: MovementCandidate | null = direct ? { ...direct, legs: [] } : null;
    const routed = this.planGraphCandidate(state, destination, entityId, locationId, stopDistance, direct?.pathLength);
    return routed && (!directCandidate || routed.etaMs < directCandidate.etaMs) ? routed : directCandidate;
  }

  private planGraphCandidate(
    state: GameState,
    destination: Vec3,
    entityId: EntityId | null,
    locationId: string | null,
    stopDistance: number,
    directLength?: number,
  ): MovementCandidate | null {
    const agility = state.skills.agility.level;
    // Graph entry/exit walking alone cannot exceed the complete direct walk and still win.
    // Include the trimmed tail and anchor arrival tolerances so the bound stays conservative.
    const options = directLength === undefined ? {} : {
      maxWalkingMetres: directLength + stopDistance + 2 * ENTITY_ARRIVAL_ALLOWANCE + 2,
    };
    const plan = locationId !== null
      ? this.nav.planRouteVia(state.player.position, { locationId }, agility, options)
      : this.nav.planRouteVia(
        state.player.position,
        entityId !== null ? { position: destination, id: entityId } : { position: destination },
        agility,
        options,
      );
    if (!plan || plan.legs.length === 0) return null;
    const legs = plan.legs.map((leg) => ({ ...leg }));
    const last = legs.at(-1)!;
    // The graph omits target tails up to 0.5 m. Price and finish at the requested destination;
    // an interaction's stand radius is also measured around that point, rather than its anchor.
    if (last.kind === "walk") {
      legs[legs.length - 1] = { ...last, to: destination, toId: entityId ?? last.toId };
    } else if (distanceXZ(last.to, destination) > 0.001) {
      legs.push({
        kind: "walk", from: last.to, to: destination, fromId: last.toId,
        toId: entityId ?? last.toId, cost: 0,
      });
    }
    const points: Vec3[] = [[...state.player.position] as Vec3];
    let cursor = state.player.position;
    let arrivalTolerance = 0;
    let pathLength = 0;
    let etaMs = 0;
    for (const [index, leg] of legs.entries()) {
      if (leg.kind === "walk") {
        const prepared = this.movement.planPath(cursor, leg.to, null, {
          arrivalAllowance: index === legs.length - 1 && entityId === null ? 0 : ENTITY_ARRIVAL_ALLOWANCE,
          stopDistance: index === legs.length - 1 ? stopDistance : 0,
        });
        if (!prepared) return null;
        leg.cost = prepared.etaMs / 1000;
        leg.path = prepared.points;
        pathLength += prepared.pathLength;
        etaMs += prepared.etaMs;
        points.push(...prepared.points.map((point) => [...point] as Vec3));
        cursor = prepared.points.at(-1)!;
        arrivalTolerance = ARRIVE_EPSILON;
        continue;
      }

      let durationMs: number;
      if (leg.kind === "shortcut") {
        const entity = leg.obstacleId ? this.hooks.entities?.get(leg.obstacleId) : undefined;
        const obstacle = entity?.obstacle;
        if (!entity || !obstacle || agility < obstacle.reqLevel || agility < (leg.reqLevel ?? 0)) return null;
        if (Object.entries(entity.requirements ?? {}).some(([skill, level]) => state.skills[skill as SkillId].level < level)) return null;
        const verb = entity.interactions.find((interaction) => interaction === "climb" || interaction === "vault" || interaction === "enter");
        if (!verb) return null;
        const endpoints = resolveShortcutEndpoints(entity, leg.from, leg.to, this.nav);
        if (!endpoints) return null;
        const reach = this.hooks.interactions?.rangeFor?.(verb, entity.id) ?? INTERACT_RANGE;
        // A walk can finish slightly before its prepared endpoint; crossings place the player exactly.
        if (distanceXZ(cursor, endpoints.entryPosition) + arrivalTolerance > reach) return null;
        leg.from = endpoints.entryPosition;
        leg.to = endpoints.exitPosition;
        durationMs = agilityDurationOf(entity);
        leg.reqLevel = obstacle.reqLevel;
      } else {
        durationMs = leg.durationMs ?? 0;
      }
      leg.durationMs = durationMs;
      leg.cost = durationMs / 1000;
      etaMs += durationMs;
      cursor = this.nav.closestPoint(leg.to) ?? leg.to;
      arrivalTolerance = 0;
      points.push([...cursor] as Vec3);
    }
    return { points, pathLength, etaMs, legs };
  }

  /**
   * The read-only twin of `walkTo`, using the same candidate selection without starting movement.
   */
  planPath(target: MoveTarget): Result<PathPlan> {
    if (!this.nav.isReady()) return err("UNAVAILABLE", "Navigation is not ready");
    const state = this.store.get();

    let destination: Vec3;
    let entityId: EntityId | null = null;
    let locationId: string | null = null;
    if ("position" in target) {
      destination = target.position;
    } else if ("entityId" in target) {
      const entity = this.hooks.entities?.get(target.entityId);
      if (!entity) return err("NOT_FOUND", `No entity with id ${target.entityId}`, target.entityId);
      destination = entity.interactionPosition ?? entity.position;
      entityId = entity.id;
    } else {
      const node = this.nav.routeNode(target.locationId);
      if (!node) return err("NOT_FOUND", `No known location ${target.locationId}`);
      destination = node.position;
      locationId = target.locationId;
    }

    const candidate = this.selectMovementCandidate(state, destination, entityId, locationId);
    if (!candidate) return err("NOT_REACHABLE", UNREACHABLE_DESTINATION_MESSAGE);
    return ok({
      points: candidate.points.map((point) => [...point] as Vec3),
      pathLength: Math.round(candidate.pathLength * 100) / 100,
      etaMs: Math.round(candidate.etaMs),
      legs: candidate.legs.map((leg) => ({
        kind: leg.kind,
        fromId: leg.fromId,
        toId: leg.toId,
        ...(leg.reqLevel !== undefined ? { reqLevel: leg.reqLevel } : {}),
      })),
    });
  }

  stop(): Result<{ stopped: string[] }> {
    const state = this.store.get();
    const stopped: string[] = [];
    this.pending = null;
    const activityBeforeMovement = state.activity;
    if (this.movement.stop(state, this.clock.elapsedMs, "cancelled")) stopped.push("navigation");
    if (state.activity) {
      this.eventBus.emit("activity.stopped", { kind: state.activity.kind, reason: "cancelled" }, undefined, this.clock.elapsedMs);
      stopped.push(state.activity.kind);
      state.activity = null;
    } else if (activityBeforeMovement) {
      stopped.push(activityBeforeMovement.kind);
    }
    if (state.combat.targetId) {
      this.eventBus.emit("combat.ended", { reason: "disengaged" }, state.combat.targetId, this.clock.elapsedMs);
      state.combat.targetId = null;
      stopped.push("combat");
    }
    state.combat.activeSpellId = null;
    this.store.markDirty();
    return ok({ stopped });
  }

  // ------------------------------------------------------------ interaction

  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> {
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");

    const entity = this.hooks.entities?.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);
    if (!entity.interactions.includes(interaction)) {
      return err("INVALID_ARGUMENT", `${entity.name} has no "${interaction}" interaction`, entityId);
    }
    if (state.activity?.kind === "traversing" && state.activity.obstacleId === entityId
      && (interaction === "climb" || interaction === "vault" || interaction === "enter")) {
      return ok({ started: `already on ${entity.name}` });
    }

    // The VERB's reach, not one constant for all of them. A staff attack is allowed to start from
    // nine metres; a chop still needs the player at the tree.
    const reach = this.hooks.interactions?.rangeFor?.(interaction, entityId) ?? INTERACT_RANGE;
    const gap = distanceXZ(state.player.position, entity.interactionPosition ?? entity.position);
    if (gap > reach) {
      // One click walks into range and THEN acts. The interaction is remembered and re-fired by
      // `resumePending` when navigation completes.
      //
      // Leave a stand point outside the target instead of asking navigation to enter its trunk,
      // rock or station. Ranged verbs keep more slack for targets that move during the approach.
      const moved = this.walkTo(
        { entityId },
        Math.max(0, reach - (reach > INTERACT_RANGE ? RANGED_APPROACH_SLACK : INTERACTION_APPROACH_SLACK)),
      );
      if (!moved.ok) return moved as Result<{ started: string }>;
      this.pending = {
        entityId,
        interaction,
        // Generous, but bounded: a stale intent must not fire minutes later after the player has
        // wandered off and forgotten they ever clicked.
        expiresAtMs: this.clock.elapsedMs + moved.value.etaMs + 10_000,
      };
      return ok({ started: `walking to ${entity.name}` });
    }

    this.pending = null;
    const runner = this.hooks.interactions;
    if (!runner) return err("UNAVAILABLE", "Interaction system is not available yet");
    if (this.movement.replaceIntent(state, this.clock.elapsedMs)) this.store.markDirty();
    return runner.run(entityId, interaction);
  }

  takeLoot(entityId: EntityId, stackIndex?: number): Result<LootTakeResult> {
    const state = this.store.get();
    if (state.player.health <= 0) return err("DEAD", "The player is dead");

    const entity = this.hooks.entities?.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);
    if (entity.archetype !== "loot" && entity.archetype !== "recovery_cache") {
      return err("INVALID_ARGUMENT", `${entity.name} is not a loot container.`, entityId);
    }
    if (distanceXZ(state.player.position, entity.position) > INTERACT_RANGE) {
      return err("OUT_OF_RANGE", `Move closer to ${entity.name} first.`, entityId);
    }

    const hook = this.hooks.loot;
    if (!hook) return err("UNAVAILABLE", "Loot system is not available yet", entityId);
    return hook.take(entityId, stackIndex);
  }

  useItem(itemId: ItemId, target?: { itemId: ItemId }): Result<{ effect: string }> {
    const hook = this.hooks.inventory;
    if (!hook) return err("UNAVAILABLE", "Inventory system is not available yet");

    return hook.use(itemId, target);
  }

  equipItem(itemId: ItemId, targetSlot?: EquipSlot): Result<{ slot: EquipSlot; replaced: ItemId | null }> {
    const hook = this.hooks.equipment;
    if (!hook) return err("UNAVAILABLE", "Equipment system is not available yet");
    return hook.equip(itemId, targetSlot);
  }

  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }> {
    const hook = this.hooks.equipment;
    if (!hook) return err("UNAVAILABLE", "Equipment system is not available yet");
    return hook.unequip(slot);
  }

  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> {
    const hook = this.hooks.production;
    if (!hook) return err("UNAVAILABLE", "Production system is not available yet");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 28) {
      return err("INVALID_ARGUMENT", "Quantity must be between 1 and 28");
    }
    return hook.produce(recipeId, Math.floor(quantity));
  }

  produceAt(
    stationId: EntityId,
    recipeId: RecipeId,
    quantity: number,
  ): Result<{ queued: number; durationMs: number }> {
    const hook = this.hooks.production;
    if (!hook) return err("UNAVAILABLE", "Production system is not available yet");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 28) {
      return err("INVALID_ARGUMENT", "Quantity must be between 1 and 28");
    }
    return hook.produceAt(stationId, recipeId, Math.floor(quantity));
  }

  buildCampfire(logItemId: ItemId): Result<{ entityId: EntityId; lifetimeMs: number; position: Vec3 }> {
    const hook = this.hooks.campfire;
    if (!hook) return err("UNAVAILABLE", "Campfire building is not available yet");
    return hook.build(logItemId);
  }

  // ----------------------------------------------------------------- combat

  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    return hook.attack(entityId);
  }

  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    return hook.cast(spellId, entityId);
  }

  castNow(spellId: SpellId): Result<{ targetId: EntityId; castMs: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    if (!content.spell(spellId)) return err("NOT_FOUND", `No spell with id ${spellId}`);
    return hook.castNow(spellId);
  }

  castArea(spellId: SpellId, point: Vec3): Result<{ castMs: number; victims: number }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    if (!content.spell(spellId)) return err("NOT_FOUND", `No spell with id ${spellId}`);
    if (!Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value))) {
      return err("INVALID_ARGUMENT", "point must be a finite [x, y, z]");
    }
    return hook.castArea(spellId, [point[0], point[1], point[2]]);
  }

  /**
   * The whole spellbook, resolved against the player standing here right now.
   *
   * Assembled in this class rather than in `ui/spellbookPanel.ts` for the reason the header gives:
   * a human opening the panel and an agent calling the tool must see the SAME sixteen rows with the
   * same max hits. Doing the arithmetic in the UI would put the agent one refactor away from a
   * different answer.
   *
   * `maxHit` reuses `magicMaxHit` from `systems/combat.ts` rather than restating PRD 2.4's formula,
   * because a second copy of a damage formula is a second thing to get wrong.
   */
  getSpellbook(): SpellbookView {
    const state = this.store.get();
    const magicLevel = state.skills.magic.level;
    const gear = equipmentTotalsOf(state.equipment);
    const inventory = this.hooks.inventory;

    const slots = inventory ? inventory.slots() : state.inventory.slots;
    const essence: Record<SpellElement, number> = { wind: 0, earth: 0, water: 0, fire: 0 };
    for (const element of Object.keys(ESSENCE_BY_ELEMENT) as SpellElement[]) {
      const itemId = ESSENCE_BY_ELEMENT[element];
      if (itemId) essence[element] = countIn(slots, itemId);
    }

    const mainHandId = state.equipment.mainHand?.itemId;
    const mainHand = mainHandId ? content.item(mainHandId) : undefined;

    const spells = content.allSpells().map((spell): SpellRow => {
      const unlocked = magicLevel >= spell.reqLevel;
      const blockedBy = spellBlockReason(state, spell);
      return {
        id: spell.id,
        name: spell.name,
        element: spell.element,
        rung: spell.rung,
        reqLevel: spell.reqLevel,
        maxHit: magicMaxHit(magicLevel, gear.magicPower, spell),
        baseXp: spell.baseXp,
        castMs: mainHand?.magicWeapon ? (mainHand.equip?.attackSpeedMs ?? spell.castMs) : spell.castMs,
        requiredElement: spell.cost.element,
        fuelCost: spell.cost.charges,
        rank: spell.rank ?? 0,
        aoe: spell.aoe === true,
        runes: spellRunesCarried(state, spell),
        unlocked,
        castable: blockedBy === null,
        blockedBy,
        description: spell.description,
      };
    });

    const preferredSpellId = state.combat.preferredSpellId ?? null;
    const preferred = spells.find((row) => row.id === preferredSpellId);
    // What "Cast at" would throw: the standing choice when it is castable, else the strongest BASIC
    // that is. This mirrors `CombatSystem.preferredSpellId` and the two must not drift; the panel
    // prints this as "automatic", so a wrong answer here teaches the player something false.
    const active = preferred?.castable
      ? preferred
      : spells.reduce<SpellRow | undefined>(
        (best, row) => (row.castable && row.rank === 0 && (!best || row.reqLevel > best.reqLevel) ? row : best),
        undefined,
      );

    return {
      spells,
      preferredSpellId,
      activeSpellId: active?.id ?? null,
      magicLevel,
      equippedWeapon: equippedMagicWeaponView(state),
      essence,
      releasedElements: [...RELEASED_MAGIC_ELEMENTS],
      runes: SPELL_RUNES.map((rune) => ({
        itemId: rune.itemId,
        name: rune.name,
        tier: rune.tier,
        carried: countIn(slots, rune.itemId),
        description: rune.description,
      })),
      castLock: this.hooks.combat?.castLock() ?? null,
    };
  }

  setPreferredSpell(spellId: SpellId | null): Result<{ preferredSpellId: SpellId | null }> {
    const hook = this.hooks.combat;
    if (!hook) return err("UNAVAILABLE", "Combat system is not available yet");
    if (spellId !== null && !content.spell(spellId)) {
      return err("NOT_FOUND", `No spell with id ${spellId}`);
    }
    const spell = spellId ? content.spell(spellId) : undefined;
    if (spell && (spell.rank ?? 0) > 0) {
      return err("INVALID_ARGUMENT", `${spell.name} is an invocation: cast it from the action bar rather than setting it as the standing spell.`);
    }
    hook.setPreferredSpell(spellId);
    return ok({ preferredSpellId: spellId });
  }

  // ------------------------------------------------------- npc, bank, shop

  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null> {
    const hook = this.hooks.dialogue;
    if (!hook) return err("UNAVAILABLE", "Dialogue system is not available yet");
    return hook.op(op, optionId);
  }

  bank(
    op: "list" | "deposit" | "withdraw" | "depositAll",
    args?: { itemId?: ItemId; quantity?: number; filter?: string },
  ): Result<BankView> {
    const hook = this.hooks.bank;
    if (!hook) return err("UNAVAILABLE", "Banking system is not available yet");
    return hook.op(op, args);
  }

  shop(
    op: "list" | "buy" | "sell",
    args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number },
  ): Result<ShopViewLike> {
    const hook = this.hooks.shop;
    if (!hook) return err("UNAVAILABLE", "Shop system is not available yet");
    return hook.op(op, args);
  }

  // --------------------------------------------------------------- overlays

  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }> {
    const hook = this.hooks.overlays;
    if (!hook) return err("UNAVAILABLE", "Overlay system is not available yet");
    if (op === "set") {
      if (!spec) return err("INVALID_ARGUMENT", "overlay('set') needs a spec");
      if (spec.kind === "path") {
        if (!spec.path || spec.path.length < 2) {
          return err("INVALID_ARGUMENT", "A path overlay needs at least two points");
        }
        return ok({ activeCount: hook.set(spec) });
      }

      let resolved = spec;
      if (spec.entityId) {
        const entity = this.hooks.entities?.get(spec.entityId);
        if (!entity) {
          // Known-place rows deliberately share ObservedEntity's shape. For a place with no
          // backing entity, its `id` is a location id. Treating that id as an entity is an easy
          // agent mistake, so resolve it as a location before rejecting it.
          const location = this.nav.routeNode(spec.entityId);
          if (location) {
            // The location id is kept beside the position: a marker plans its ground route by
            // location, which is how it gets the portal and shortcut legs a raw position cannot.
            const { entityId: _entityId, ...rest } = spec;
            resolved = { ...rest, locationId: spec.entityId, position: location.position };
          } else if (!spec.position) {
            return err(
              "NOT_FOUND",
              `No entity or location with id ${spec.entityId}`,
              spec.entityId,
            );
          }
        }
      } else if (spec.locationId) {
        const location = this.nav.routeNode(spec.locationId);
        if (!location) return err("NOT_FOUND", `No location with id ${spec.locationId}`);
        resolved = { ...spec, position: location.position };
      } else if (!spec.position) {
        return err(
          "INVALID_ARGUMENT",
          `${spec.kind} overlay needs an entityId, locationId, or position`,
        );
      }

      return ok({ activeCount: hook.set(resolved) });
    }
    return ok({ activeCount: hook.clear(spec?.id) });
  }

  // ----------------------------------------------------------------- events

  events(sinceSeq: number, filter?: GameEventType[], timeoutMs?: number): Promise<EventBatch> {
    if (timeoutMs === undefined || timeoutMs <= 0) {
      return Promise.resolve(this.eventBus.since(sinceSeq, filter));
    }
    return this.eventBus.wait(sinceSeq, filter, timeoutMs);
  }

  /**
   * Runs the remembered interaction now that the player has arrived.
   * Called by the loop when navigation completes. Returns what happened, or null if nothing waited.
   */
  resumePending(): Result<{ started: string }> | null {
    const pending = this.pending;
    if (!pending) return null;
    this.pending = null;
    if (this.clock.elapsedMs > pending.expiresAtMs) {
      return this.publishPendingResult(pending, err(
        "TIMEOUT",
        "That interaction expired before you reached it. Try again.",
        pending.entityId,
      ));
    }

    const entity = this.hooks.entities?.get(pending.entityId);
    if (!entity) {
      return this.publishPendingResult(pending, err(
        "NOT_FOUND",
        `No entity with id ${pending.entityId}`,
        pending.entityId,
      ));
    }
    // The world moves while the player walks: a node can deplete or an enemy die en route, and a
    // click that lands minutes later on something that has wandered off is worse than no click.
    //
    // Measured against the VERB's reach, not one constant. This used to be `INTERACT_RANGE * 1.6`
    // (3.84 m) for everything, which was invisible while every walk ended on top of its target — and
    // became a silent dead end the moment ranged approach landed: a caster walked thirty metres,
    // stopped correctly at the edge of spell range, and had the queued attack thrown away here
    // because 13.5 m is not 3.84 m. The click did nothing at all, with no error.
    //
    // The 1.6 slack is kept as-is. It is a "has the world moved too much" guard, not a range check;
    // `world/interactions.ts` applies the real range immediately below.
    const reach = this.hooks.interactions?.rangeFor?.(pending.interaction, entity.id) ?? INTERACT_RANGE;
    const gap = distanceXZ(this.store.get().player.position, entity.interactionPosition ?? entity.position);
    if (gap > reach * 1.6) {
      return this.publishPendingResult(pending, err(
        "OUT_OF_RANGE",
        `${entity.name} moved out of range before the interaction could start.`,
        entity.id,
      ));
    }

    const runner = this.hooks.interactions;
    if (!runner) {
      return this.publishPendingResult(pending, err(
        "UNAVAILABLE",
        "Interaction system is not available yet",
        pending.entityId,
      ));
    }
    return this.publishPendingResult(pending, runner.run(pending.entityId, pending.interaction));
  }

  /** Drops any remembered interaction. Called when the player cancels or is interrupted. */
  clearPending(): void {
    this.pending = null;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  private publishPendingResult(
    pending: Pick<PendingInteractionOutcome, "entityId" | "interaction">,
    result: Result<{ started: string }>,
  ): Result<{ started: string }> {
    const outcome: PendingInteractionOutcome = {
      entityId: pending.entityId,
      interaction: pending.interaction,
      result,
    };
    for (const listener of this.pendingResultListeners) {
      try {
        listener(outcome);
      } catch {
        // A feedback subscriber must not turn a valid gameplay result into an exception.
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- helpers

  /** Convenience for UI progress bars. Not part of the frozen contract. */
  skillProgress(skill: SkillId): number {
    return levelProgress(this.store.get().skills[skill].xp);
  }
}

export function emptyBonuses(): EquipmentBonuses {
  return { meleeAccuracy: 0, meleePower: 0, defence: 0, magicAccuracy: 0, magicPower: 0, health: 0, vitality: 0 };
}
