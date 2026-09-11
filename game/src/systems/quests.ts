/**
 * The quest system: stage predicates, reward application, and the `talk`-adjacent world writes.
 *
 * Satisfies `SystemHooks.quests` (`summaries(): QuestSummary[]`) and PRD section 3 row 12, so its
 * tick order is 120: after gathering (110), before the event flush that the loop
 * deliberately runs last. That ordering is why a `level.gained` and the `quest.updated` it causes
 * land in the same tick and in causal order.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW PROGRESS IS DRIVEN
 * ---------------------------------------------------------------------------------------------
 * Not by polling systems and not by other systems calling in. Two inputs, and only two:
 *
 *  1. **The event stream.** The system subscribes to `EventBus` and turns events into counters on
 *     the quest record: `item.received` feeds `gather:<itemId>`, `combat.ended` with
 *     `reason: "killed"` feeds `kill:<family>` (the family comes off the dead entity's
 *     `meta.family`), `production.completed` feeds `produce:<recipeId>`, and `resource.depleted`
 *     feeds `deplete:<itemId>` plus the `last_seam_yield` figure Dorn's Tally is built around.
 *     Any event at all also marks the system dirty.
 *  2. **The state itself.** `have`, `banked`, `equipped`, `skill`, `traverse`, `entityState`,
 *     `reach` and `nearEntity` are read straight off `GameState` and the entity table when the
 *     system evaluates, so they need no event of their own and cannot drift out of sync with the
 *     thing they describe.
 *
 * Evaluation runs when dirty, plus a 500 ms heartbeat so that walking somewhere with WASD - which
 * emits nothing - still satisfies a `reach` stage. That is the whole polling budget: eight
 * predicates across at most nine quests, twice a second, in the worst case.
 *
 * Counters are monotonic per quest. A stage that counts something snapshots a baseline when it
 * begins (`@base:<counter>`), so "kill 4 rats" in stage 4 and "kill 2 bears" in stage 7
 * do not contaminate each other and a stage can never be pre-completed by work done before it.
 *
 * ---------------------------------------------------------------------------------------------
 * REWARDS
 * ---------------------------------------------------------------------------------------------
 * Everything leaves through injected ports. This file imports no other worker's system.
 * A reward that will not fit is not lost: the shortfall is parked in a `pending:<itemId>` counter
 * on the quest record, which is a plain number and therefore survives save and reload, and the
 * next evaluation delivers it as soon as there is room.
 */
import type {
  EntityId, ItemId, QuestId, QuestSummary, Result, SemanticEntity, SkillId, Vec3,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { TickSystem } from "../app/loop.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { QuestDef, QuestGrant, QuestPredicate, QuestStageDef } from "../content/quests.js";
import { QUESTS, quest } from "../content/quests.js";
import { findLocation } from "../content/regions.js";

// -------------------------------------------------------------------- ports

/**
 * The inventory seam. `systems/inventory.ts` belongs to another worker; `InventorySystem` already
 * satisfies this shape member for member, so the root hands it over with no adapter.
 */
export interface QuestInventoryPort {
  addItem(itemId: ItemId, quantity: number): Result<number>;
  removeItem(itemId: ItemId, quantity: number): Result<number>;
  countItem(itemId: ItemId): number;
  hasRoomFor(itemId: ItemId, quantity: number): boolean;
  addCurrency(amount: number): Result<number>;
}

/** XP goes through here so quests never decide how a level-up is announced. */
export interface QuestXpPort {
  award(skill: SkillId, amount: number): void;
}

/** The slice of the entity table quests need: read state, and write the two dungeon doors. */
export interface QuestEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  /** Returns false when the entity is unknown. Never throws. */
  setState(id: EntityId, state: string, lockedReason?: string): boolean;
}

export interface QuestDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  entities: QuestEntityPort;
  inventory: QuestInventoryPort;
  xp: QuestXpPort;
  dispatcher: InteractionDispatcher;
}

// ------------------------------------------------------------------ helpers

type QuestRecord = GameState["quests"][string];

const HEARTBEAT_MS = 500;
const TALK_FLAG_PREFIX = "@talk:";
const BASE_PREFIX = "@base:";
const PENDING_PREFIX = "pending:";

/** Default radii for the two positional predicates, in metres. */
const REACH_RADIUS = 14;
const NEAR_RADIUS = 12;

function horizontalDistance(from: Vec3, x: number, z: number): number {
  const dx = from[0] - x;
  const dz = from[2] - z;
  return Math.sqrt(dx * dx + dz * dz);
}

function counterKey(predicate: QuestPredicate): string | null {
  switch (predicate.kind) {
    case "gather": return `gather:${predicate.itemId}`;
    case "kill": return `kill:${predicate.enemyFamily}`;
    case "produce": return `produce:${predicate.recipeId}`;
    case "deplete": return `deplete:${predicate.itemId}`;
    default: return null;
  }
}

function counterKeysOf(predicate: QuestPredicate, into: string[]): void {
  if (predicate.kind === "all") {
    for (const child of predicate.of) counterKeysOf(child, into);
    return;
  }
  const key = counterKey(predicate);
  if (key) into.push(key);
}

function visitFlag(stageIndex: number, locationId: string): string {
  return `@visit:${JSON.stringify([stageIndex, locationId])}`;
}

// ------------------------------------------------------------------- system

export class QuestSystem implements TickSystem {
  readonly name = "quests";

  /** PRD section 3 row 12. After gathering (110), before the event flush. */
  readonly order = 120;

  private dirty = true;
  private sinceHeartbeatMs = 0;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: QuestDeps) {
    this.unsubscribe = deps.events.subscribe((event) => this.onEvent(event.type, event.entityId, event.data));

    // Doors are the only world objects a quest owns outright, so the `open` verb is registered
    // here rather than in a system that has no idea why a door is shut.
    deps.dispatcher.registerHandler("open", (context) => this.handleOpen(context));
  }

  /** For a hot reload or a test harness. The loop never calls this. */
  dispose(): void {
    this.unsubscribe();
  }

  // ------------------------------------------------------------- tick system

  tick(deltaMs: number, _atMs: number): void {
    this.sinceHeartbeatMs += deltaMs;
    if (!this.dirty && this.sinceHeartbeatMs < HEARTBEAT_MS) return;
    this.dirty = false;
    this.sinceHeartbeatMs = 0;
    this.evaluate();
  }

  // ------------------------------------------------------------- public API

  /**
   * `SystemHooks.quests`. Every quest the player could know about.
   *
   * This used to be every quest in the content table, so a fresh character's journal — and any
   * agent reading it — listed all ten names, their regions and their skill requirements, including
   * the Kilnhalt chain three regions away. The redaction of objective text below was honest, but
   * the list itself was the leak: it is a map of the game's structure handed out before a step is
   * taken. An unstarted quest is now visible only once the player has set foot in its region and
   * finished whatever it chains from — the same moment a human could have met the giver.
   * Started and finished quests are always listed.
   */
  summaries(): QuestSummary[] {
    const state = this.deps.store.get();
    return QUESTS
      .filter((def) => this.isKnown(state, def))
      .map((def) => this.summaryOf(state, def));
  }

  private isKnown(state: GameState, def: QuestDef): boolean {
    const status = state.quests[def.id]?.status ?? "unstarted";
    if (status !== "unstarted") return true;
    if (!state.discovery.regions.includes(def.regionId)) return false;
    for (const prerequisite of def.prerequisiteQuestIds) {
      if ((state.quests[prerequisite]?.status ?? "unstarted") !== "complete") return false;
    }
    return true;
  }

  summary(questId: QuestId): QuestSummary | undefined {
    const def = quest(questId);
    if (!def) return undefined;
    return this.summaryOf(this.deps.store.get(), def);
  }

  status(questId: QuestId): "unstarted" | "active" | "complete" {
    return this.deps.store.get().quests[questId]?.status ?? "unstarted";
  }

  stage(questId: QuestId): number {
    return this.deps.store.get().quests[questId]?.stage ?? 0;
  }

  flag(questId: QuestId, flag: string): boolean {
    return this.deps.store.get().quests[questId]?.flags[flag] === true;
  }

  counter(questId: QuestId, counter: string): number {
    return this.deps.store.get().quests[questId]?.counters[counter] ?? 0;
  }

  /** Unstarted, prerequisites complete, and every skill requirement met. */
  canOffer(questId: QuestId): boolean {
    const def = quest(questId);
    if (!def) return false;
    const state = this.deps.store.get();
    if ((state.quests[questId]?.status ?? "unstarted") !== "unstarted") return false;
    for (const prerequisite of def.prerequisiteQuestIds) {
      if ((state.quests[prerequisite]?.status ?? "unstarted") !== "complete") return false;
    }
    return this.requirementsMet(state, def);
  }

  /** The first unmet requirement as plain text, or undefined. Feeds a disabled option's reason. */
  requirementProblem(questId: QuestId): string | undefined {
    const def = quest(questId);
    if (!def) return `No quest with id ${questId}`;
    const state = this.deps.store.get();
    for (const key of Object.keys(def.requirements) as SkillId[]) {
      const needed = def.requirements[key];
      if (needed !== undefined && state.skills[key].level < needed) {
        return `Requires ${key} ${needed}`;
      }
    }
    for (const prerequisite of def.prerequisiteQuestIds) {
      if ((state.quests[prerequisite]?.status ?? "unstarted") !== "complete") {
        return `Requires the quest "${quest(prerequisite)?.name ?? prerequisite}" first`;
      }
    }
    return undefined;
  }

  /**
   * Starts a quest. Idempotent: starting an active or complete quest is not an error, it is a
   * no-op, because a dialogue option can be chosen twice in a laggy frame.
   */
  start(questId: QuestId): Result<QuestSummary> {
    const def = quest(questId);
    if (!def) return err("NOT_FOUND", `No quest with id ${questId}`);

    const state = this.deps.store.get();
    const existing = state.quests[questId];
    if (existing && existing.status !== "unstarted") return ok(this.summaryOf(state, def));

    const problem = this.requirementProblem(questId);
    if (problem) return err("REQUIREMENTS_NOT_MET", problem);

    const record: QuestRecord = { status: "active", stage: 0, counters: {}, flags: {} };
    state.quests[questId] = record;

    if (def.onStart) this.applyGrant(record, def.onStart);
    this.snapshotBaselines(def, record, 0);

    this.deps.store.markDirty();
    this.emitUpdate(def, record);
    this.dirty = true;
    return ok(this.summaryOf(state, def));
  }

  /**
   * Jumps a quest to a stage, applying every prior stage's flags and grants. `__gameDebug`
   * `setQuestStage` and the `quest_longcairn_stage4` scenario both land here.
   */
  setStage(questId: QuestId, stage: number): Result<QuestSummary> {
    const def = quest(questId);
    if (!def) return err("NOT_FOUND", `No quest with id ${questId}`);
    if (!Number.isFinite(stage) || stage < 0) return err("INVALID_ARGUMENT", "Stage must be at least 0");

    const state = this.deps.store.get();
    const target = Math.min(Math.floor(stage), def.stages.length);
    const record: QuestRecord = { status: "active", stage: 0, counters: {}, flags: {} };
    state.quests[questId] = record;
    if (def.onStart) this.applyGrant(record, def.onStart);

    for (let index = 0; index < target; index += 1) {
      const stageDef = def.stages[index];
      if (!stageDef) continue;
      for (const reaction of stageDef.onFlag ?? []) this.applyGrant(record, reaction.grant);
      if (stageDef.grants) this.applyGrant(record, stageDef.grants);
    }
    record.stage = target;

    if (target >= def.stages.length) {
      this.completeQuest(def, record);
    } else {
      this.snapshotBaselines(def, record, target);
      this.emitUpdate(def, record);
    }

    this.deps.store.markDirty();
    this.dirty = true;
    return ok(this.summaryOf(state, def));
  }

  // ---------------------------------------------------- dialogue-facing hooks

  /**
   * Called by `systems/dialogue.ts` every time the player arrives at a node. Recorded as a flag on
   * every active quest so a `talk` predicate can be satisfied without the dialogue system knowing
   * what a quest is.
   */
  noteDialogueNode(npcId: EntityId, nodeId: string): void {
    const state = this.deps.store.get();
    for (const def of QUESTS) {
      const record = state.quests[def.id];
      if (!record || record.status !== "active") continue;
      record.flags[`${TALK_FLAG_PREFIX}${npcId}:${nodeId}`] = true;
    }
    this.deps.store.markDirty();
    this.dirty = true;
  }

  setFlag(questId: QuestId, flag: string, value = true): void {
    const record = this.deps.store.get().quests[questId];
    if (!record) return;
    record.flags[flag] = value;
    this.deps.store.markDirty();
    this.dirty = true;
  }

  bumpCounter(questId: QuestId, counter: string, by = 1): void {
    const record = this.deps.store.get().quests[questId];
    if (!record) return;
    record.counters[counter] = (record.counters[counter] ?? 0) + by;
    this.deps.store.markDirty();
    this.dirty = true;
  }

  /** Runs a full pass immediately. Dialogue calls this so a choice advances a stage in-line. */
  evaluateNow(): void {
    this.dirty = false;
    this.sinceHeartbeatMs = 0;
    this.evaluate();
  }

  /** Restores derived world entities after rebuilding them, without paying any quest grant. */
  rehydrateWorldState(): void {
    const write = (grant: Pick<QuestGrant, "worldState"> | undefined): void => {
      for (const state of grant?.worldState ?? []) {
        this.deps.entities.setState(state.entityId, state.state, state.lockedReason);
      }
    };
    for (const def of QUESTS) {
      const record = this.deps.store.get().quests[def.id];
      if (!record || record.status === "unstarted") continue;
      write(def.onStart);
      for (const stage of def.stages) {
        if (stage.index > record.stage && record.status !== "complete") break;
        for (const reaction of stage.onFlag ?? []) {
          if (record.flags[`@reacted:${stage.index}:${reaction.flag}`] === true) write(reaction.grant);
        }
        if (record.status === "complete" || stage.index < record.stage) write(stage.grants);
      }
      if (record.status === "complete") write(def.rewards);
    }
  }

  // -------------------------------------------------------- interaction: open

  /**
   * The `open` verb.
   *
   * `InteractionDispatcher` has already refused the call if the door's state is "locked" or
   * "sealed", so anything arriving here is a door the world has decided is openable. The Three-
   * Lever Door reaches "unbarred" only when The Long Cairn's stage 5 flag `lever_order_known` is
   * set, which happens when the player works out Ode's ordering. The check is repeated here so a
   * hand-edited save cannot walk through it.
   */
  private handleOpen(context: InteractionContext): Result<{ started: string }> {
    const entity = context.entity;

    if (entity.id === "gravelmaw_stone_door") {
      if (!this.flag("long_cairn", "lever_order_known")) {
        return err(
          "INVALID_ARGUMENT",
          "Three stone levers hold this door and you do not know their order. Cairnkeeper Ode "
          + "(entity npc_cairnkeeper_ode, at Hillcrest) knows it.",
          entity.id,
        );
      }
      if (entity.state !== "open") {
        this.deps.entities.setState(entity.id, "open", "The three levers are thrown. The door stands open.");
        this.deps.store.markDirty();
        this.dirty = true;
        this.evaluateNow();
      }
      return ok({ started: "The three levers throw in order and the stone door grinds open." });
    }

    if (entity.id === "ordrun_gate") {
      return ok({ started: "The Quarry Warden's Gate stands open. What is beyond it is awake." });
    }

    if (entity.archetype !== "door" && entity.archetype !== "portal") {
      return err("INVALID_ARGUMENT", `${entity.name} is not something you can open.`, entity.id);
    }
    return ok({ started: `${entity.name} is open.` });
  }

  // ------------------------------------------------------------- event input

  private onEvent(type: string, entityId: EntityId | undefined, data: Record<string, unknown>): void {
    this.dirty = true;

    const state = this.deps.store.get();
    const active: QuestRecord[] = [];
    for (const def of QUESTS) {
      const record = state.quests[def.id];
      if (record && record.status === "active") active.push(record);
    }
    if (active.length === 0) return;

    const bump = (key: string, by: number): void => {
      if (by <= 0) return;
      for (const record of active) record.counters[key] = (record.counters[key] ?? 0) + by;
    };

    switch (type) {
      case "item.received": {
        const itemId = typeof data.itemId === "string" ? data.itemId : null;
        if (!itemId) break;
        const quantity = typeof data.quantity === "number" ? data.quantity : 1;
        bump(`gather:${itemId}`, quantity);
        break;
      }
      case "combat.ended": {
        // `reason`, not `outcome`, and `enemyId`, not `targetId`. Both of those names were invented
        // here and never existed on the event: `systems/combat.ts` emits
        // `{ reason: "killed", enemyId, name, xp }`. So the guard never passed, no `kill:<family>`
        // counter was ever incremented, and EVERY kill predicate in the game was unsatisfiable —
        // Cold Iron stage 4, the Long Cairn stages 4 and 7, Eleven Empty Days stage 1. Four of the
        // nine quests could not be finished by anybody, human or agent.
        //
        // It survived three rounds because nothing had played a quest past its opening stages: the
        // gate proved Cold Iron to stage 0 and the Long Cairn to stage 2, and both of those sit
        // before the first kill. A predicate nobody has ever satisfied is not a tested predicate.
        if (data.reason !== "killed") break;
        const targetId = typeof data.enemyId === "string" ? data.enemyId : entityId;
        const family = this.familyOf(targetId, data);
        if (family) bump(`kill:${family}`, 1);
        break;
      }
      case "production.completed": {
        if (data.burnt === true) break;
        const recipeId = typeof data.recipeId === "string" ? data.recipeId : null;
        if (!recipeId) break;
        const quantity = typeof data.quantity === "number" ? data.quantity : 1;
        bump(`produce:${recipeId}`, quantity);
        break;
      }
      case "resource.depleted": {
        const itemId = typeof data.itemId === "string" ? data.itemId : null;
        if (itemId) bump(`deplete:${itemId}`, 1);
        // Dorn's Tally is decided by this figure, so it is recorded rather than counted: the
        // question is "what did that seam give", not "how many seams have you emptied".
        const taken = typeof data.yieldsTaken === "number" ? data.yieldsTaken : null;
        if (taken !== null) {
          for (const record of active) record.counters.last_seam_yield = taken;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Enemy families live on the entity's `meta.family`, set by `world/regionBuilder.ts`. */
  private familyOf(targetId: EntityId | undefined, data: Record<string, unknown>): string | null {
    if (typeof data.family === "string") return data.family;
    if (!targetId) return null;
    const entity = this.deps.entities.get(targetId);
    const family = entity?.meta?.family;
    return typeof family === "string" ? family : null;
  }

  // -------------------------------------------------------------- evaluation

  private evaluate(): void {
    const state = this.deps.store.get();
    let changed = false;

    for (const def of QUESTS) {
      const record = state.quests[def.id];
      if (!record || record.status === "unstarted") continue;

      // Completion can owe physical rewards after paying XP and marks. Deliver that saved debt
      // without re-entering stages or applying the completion grant again.
      if (this.flushPending(record)) changed = true;
      if (record.status !== "active") continue;

      // Bounded on purpose: a chain of stages that all read true at once still terminates.
      for (let guard = 0; guard <= def.stages.length; guard += 1) {
        if (record.status !== "active") break;
        const stageDef = def.stages[record.stage];
        if (!stageDef) {
          this.completeQuest(def, record);
          changed = true;
          break;
        }

        if (this.applyStageReactions(def, record, stageDef)) changed = true;
        if (this.collectVisits(state, record, stageDef.completion)) changed = true;

        if (!this.satisfied(state, record, stageDef.completion)) break;

        if (stageDef.grants) this.applyGrant(record, stageDef.grants);
        record.stage += 1;
        this.clearTalkFlags(record);
        changed = true;

        if (record.stage >= def.stages.length) {
          this.completeQuest(def, record);
          break;
        }
        this.snapshotBaselines(def, record, record.stage);
        this.emitUpdate(def, record);
      }
    }

    if (changed) this.deps.store.markDirty();
  }

  /** Mid-stage `onFlag` reactions, applied at most once each. */
  private applyStageReactions(def: QuestDef, record: QuestRecord, stageDef: QuestStageDef): boolean {
    let applied = false;
    for (const reaction of stageDef.onFlag ?? []) {
      const marker = `@reacted:${stageDef.index}:${reaction.flag}`;
      if (record.flags[marker] === true) continue;
      if (record.flags[reaction.flag] !== true) continue;
      this.applyGrant(record, reaction.grant);
      record.flags[marker] = true;
      applied = true;
    }
    return applied;
  }

  private completeQuest(def: QuestDef, record: QuestRecord): void {
    record.status = "complete";
    record.stage = def.stages.length;
    this.applyGrant(record, {
      xp: def.rewards.xp,
      items: def.rewards.items,
      currency: def.rewards.currency,
      unlocks: def.rewards.unlocks,
      ...(def.rewards.worldState ? { worldState: def.rewards.worldState } : {}),
    });
    this.clearTalkFlags(record);
    this.emitUpdate(def, record);
  }

  // -------------------------------------------------------------- predicates

  /** Visit every leaf before testing `all`, so its first false child cannot hide later stops. */
  private collectVisits(state: GameState, record: QuestRecord, predicate: QuestPredicate): boolean {
    if (state.player.health <= 0) return false;
    if (predicate.kind === "all") {
      let changed = false;
      for (const child of predicate.of) {
        if (this.collectVisits(state, record, child)) changed = true;
      }
      return changed;
    }
    if (predicate.kind !== "visit") return false;
    const key = visitFlag(record.stage, predicate.locationId);
    if (record.flags[key]) return false;
    const radius = predicate.radius ?? REACH_RADIUS;
    const marker = this.deps.entities.get(`${predicate.locationId}_marker`);
    let reached = false;
    if (marker) {
      // The same three-dimensional marker geometry as reach, including dungeon floor height.
      reached = state.player.regionId === marker.regionId && Math.hypot(
        state.player.position[0] - marker.position[0],
        state.player.position[1] - marker.position[1],
        state.player.position[2] - marker.position[2],
      ) <= radius;
    } else {
      const entry = findLocation(predicate.locationId);
      reached = entry !== undefined && state.player.regionId === entry.regionId
        && horizontalDistance(state.player.position, ...entry.location.position) <= radius;
    }
    if (!reached) return false;
    record.flags[key] = true;
    return true;
  }

  private satisfied(state: GameState, record: QuestRecord, predicate: QuestPredicate): boolean {
    switch (predicate.kind) {
      case "all":
        return predicate.of.every((child) => this.satisfied(state, record, child));

      case "visit":
        return record.flags[visitFlag(record.stage, predicate.locationId)] === true;

      case "talk":
        return record.flags[`${TALK_FLAG_PREFIX}${predicate.npcId}:${predicate.dialogueNodeId}`] === true;

      case "have":
        return this.deps.inventory.countItem(predicate.itemId) >= predicate.quantity
          || (predicate.orAwakenedAltarId !== undefined
            && state.magic.awakenedAltars[predicate.orAwakenedAltarId] === true);

      case "banked": {
        let held = 0;
        for (const slot of state.bank.slots) if (slot.itemId === predicate.itemId) held += slot.quantity;
        return held >= predicate.quantity;
      }

      case "equipped": {
        for (const stack of Object.values(state.equipment)) {
          if (stack && stack.itemId === predicate.itemId) return true;
        }
        return false;
      }

      case "gather":
      case "kill":
      case "produce":
      case "deplete": {
        const key = counterKey(predicate);
        if (!key) return false;
        const base = record.counters[`${BASE_PREFIX}${key}`] ?? 0;
        return (record.counters[key] ?? 0) - base >= predicate.count;
      }

      case "reach": {
        const radius = predicate.radius ?? REACH_RADIUS;

        // Dungeon chambers sit under Karrowmoor's terraces, so an XZ-only test would let a player
        // standing on the moor 24 m above chamber 2 satisfy "reach The Collapse". Every chamber has
        // a brazier marker entity at `<chamberId>_marker`, and measuring to that in three
        // dimensions is the difference between being in the room and being over it.
        const marker = this.deps.entities.get(`${predicate.locationId}_marker`);
        if (marker) {
          const from = state.player.position;
          const dx = from[0] - marker.position[0];
          const dy = from[1] - marker.position[1];
          const dz = from[2] - marker.position[2];
          return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius;
        }

        const entry = findLocation(predicate.locationId);
        if (!entry) return false;
        const [x, z] = entry.location.position;
        return horizontalDistance(state.player.position, x, z) <= radius;
      }

      case "nearEntity": {
        const entity = this.deps.entities.get(predicate.entityId);
        if (!entity) return false;
        const radius = predicate.radius ?? NEAR_RADIUS;
        return horizontalDistance(state.player.position, entity.position[0], entity.position[2]) <= radius;
      }

      case "traverse":
        return (state.world.obstaclesUsed[predicate.obstacleId] ?? 0) > 0;

      case "entityState": {
        const entity = this.deps.entities.get(predicate.entityId);
        return entity?.state === predicate.state;
      }

      case "skill":
        return state.skills[predicate.skill].level >= predicate.level;

      case "flag":
        return (record.flags[predicate.flag] === true) === (predicate.value ?? true);

      case "counter":
        return (record.counters[predicate.counter] ?? 0) >= predicate.atLeast;

      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ grants

  private applyGrant(record: QuestRecord, grant: QuestGrant): void {
    for (const key of Object.keys(grant.xp ?? {}) as SkillId[]) {
      const amount = grant.xp?.[key];
      if (amount !== undefined && amount > 0) this.deps.xp.award(key, amount);
    }

    for (const stack of grant.takeItems ?? []) {
      // A missing delivery item is not an error: the dialogue option that hands things over has
      // already gated on holding them, and a quest must never fail because a bag was emptied.
      this.deps.inventory.removeItem(stack.itemId, stack.quantity);
    }

    for (const stack of grant.items ?? []) this.giveOrPark(record, stack.itemId, stack.quantity);

    if (grant.currency !== undefined && grant.currency > 0) {
      this.deps.inventory.addCurrency(grant.currency);
    }

    for (const flag of grant.flags ?? []) record.flags[flag] = true;

    for (const write of grant.worldState ?? []) {
      this.deps.entities.setState(write.entityId, write.state, write.lockedReason);
    }
  }

  /** Adds what fits and parks the rest on the quest record, where it survives a reload. */
  private giveOrPark(record: QuestRecord, itemId: ItemId, quantity: number): void {
    if (quantity <= 0) return;
    const result = this.deps.inventory.addItem(itemId, quantity);
    const added = result.ok ? result.value : 0;
    const shortfall = quantity - added;
    if (shortfall > 0) {
      record.counters[`${PENDING_PREFIX}${itemId}`] =
        (record.counters[`${PENDING_PREFIX}${itemId}`] ?? 0) + shortfall;
      this.deps.events.emit(
        "inventory.full",
        { blockedItemId: itemId, pending: shortfall, source: "quest" },
        undefined,
        this.deps.clock.elapsedMs,
      );
    }
  }

  /** Retries parked rewards. Called every evaluation, which is why a full bag never loses one. */
  private flushPending(record: QuestRecord): boolean {
    let changed = false;
    for (const key of Object.keys(record.counters)) {
      if (!key.startsWith(PENDING_PREFIX)) continue;
      const owed = record.counters[key] ?? 0;
      if (owed <= 0) {
        delete record.counters[key];
        continue;
      }
      const itemId = key.slice(PENDING_PREFIX.length);
      // Waiting for space is ordinary state, not a fresh failed pickup every heartbeat.
      if (!this.deps.inventory.hasRoomFor(itemId, 1)) continue;
      let fits = 1;
      let upper = owed;
      while (fits < upper) {
        const middle = Math.ceil((fits + upper) / 2);
        if (this.deps.inventory.hasRoomFor(itemId, middle)) fits = middle;
        else upper = middle - 1;
      }
      const result = this.deps.inventory.addItem(itemId, fits);
      const added = result.ok ? result.value : 0;
      if (added <= 0) continue;
      const left = owed - added;
      if (left > 0) record.counters[key] = left;
      else delete record.counters[key];
      changed = true;
    }
    return changed;
  }

  // ------------------------------------------------------------- bookkeeping

  private snapshotBaselines(def: QuestDef, record: QuestRecord, stageIndex: number): void {
    const stageDef = def.stages[stageIndex];
    if (!stageDef) return;
    const keys: string[] = [];
    counterKeysOf(stageDef.completion, keys);
    for (const key of keys) {
      record.counters[`${BASE_PREFIX}${key}`] = record.counters[key] ?? 0;
    }
  }

  private clearTalkFlags(record: QuestRecord): void {
    for (const key of Object.keys(record.flags)) {
      if (key.startsWith(TALK_FLAG_PREFIX)) delete record.flags[key];
    }
  }

  private requirementsMet(state: GameState, def: QuestDef): boolean {
    for (const key of Object.keys(def.requirements) as SkillId[]) {
      const needed = def.requirements[key];
      if (needed !== undefined && state.skills[key].level < needed) return false;
    }
    return true;
  }

  private summaryOf(state: GameState, def: QuestDef): QuestSummary {
    const record = state.quests[def.id];
    const status = record?.status ?? "unstarted";
    const stage = record?.stage ?? 0;
    const stageDef = def.stages[stage];
    return {
      id: def.id,
      name: def.name,
      regionId: def.regionId,
      status,
      stage,
      stageCount: def.stages.length,
      // An unstarted quest reports no objective: the stage text is content the player has not been
      // told yet, and PRD F13 forbids leaking it through the docs index.
      currentObjective: status === "active" && stageDef ? stageDef.objective : null,
      // The ids the objective talks about, for an agent. The sentence itself carries none.
      currentObjectiveRefs: status === "active" && stageDef ? [...(stageDef.refs ?? [])] : [],
      requirements: def.requirements,
    };
  }

  private emitUpdate(def: QuestDef, record: QuestRecord): void {
    const stageDef = def.stages[record.stage];
    this.deps.events.emit(
      "quest.updated",
      {
        questId: def.id,
        status: record.status,
        stage: record.stage,
        stageCount: def.stages.length,
        objective: record.status === "active" && stageDef ? stageDef.objective : null,
        objectiveRefs: record.status === "active" && stageDef ? [...(stageDef.refs ?? [])] : [],
      },
      undefined,
      this.deps.clock.elapsedMs,
    );
  }
}
