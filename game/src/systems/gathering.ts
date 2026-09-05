/**
 * Mining, Woodcutting and Fishing — one shared model, per PRD 2.5.
 *
 * There is no per-skill branch anywhere below. A node is a semantic entity with a `resource` block;
 * the verb (`mine` / `chop` / `fish`) only picks which skill gets the XP. That is the point of the
 * PRD's tier-independent formula: an agent reads one line and can predict every gather in the game.
 *
 *   gatherTickMs   = 1800
 *   effectiveLevel = skillLevel + tool.gatherBonus
 *   successChance  = clamp(0.30 + 0.016 * (effectiveLevel - node.reqLevel), 0.05, 0.95)
 *
 * At the node's own requirement level that is exactly 0.30, i.e. 6.0 s per yield.
 *
 * Two things that are easy to get wrong and are enforced here:
 *
 *  - A tool raises the *effective* level but never the *base* requirement. A Mining 1 player with a
 *    +9 pickaxe is still refused a Mining 10 seam with REQUIREMENTS_NOT_MET.
 *  - `entity.resource.remaining` and `state.world.nodes[id].remaining` are two views of one number.
 *    The store view persists; the entity view is what `InteractionDispatcher` and the renderer read.
 *    Every write goes through `nodeRuntime()` and `setRemaining()` so they cannot drift.
 *
 * The class is a `TickSystem` whose own tick runs *respawn timers only* (PRD section 3 row 11,
 * "World"). The gather roll happens in `this.driver`, which `ActivitySystem` calls at row 6. Two
 * rows of one ordered list means two objects; pretending otherwise is how update order rots.
 */
import type {
  ActivitySummary, EntityId, InteractionId, ItemId, Result, SemanticEntity, SkillId,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, ResourceNodeState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import { GATHER_TICK_MS } from "../core/time.js";
import type { RngStreams } from "../core/rng.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { ActivityDriver, ActivityTickResult, EntityLookup, InventoryPort } from "./activity.js";
import type { ActivitySystem } from "./activity.js";
import { CONTINUE, awardXp, clamp01, stopWith } from "./activity.js";
import type { TickSystem } from "../app/loop.js";
import type { ItemMoveOptions } from "./inventory.js";
import type { ResourceDef } from "../content/index.js";
import {
  content, gatherSuccessChance, gatherXp, respawnSeconds, toolBonus, yieldRange,
} from "../content/index.js";

export type { EntityLookup, InventoryPort } from "./activity.js";

/** Inventory adds owned by gathering suppress the inventory layer's generic receipt event. */
export interface GatheringInventoryPort extends InventoryPort {
  addItem(itemId: ItemId, quantity: number, options?: ItemMoveOptions): Result<number>;
}

/** The gathering verbs and the skill each one trains. */
const GATHER_SKILL: Readonly<Record<string, SkillId>> = {
  mine: "mining",
  chop: "woodcutting",
  fish: "fishing",
};

/**
 * Upper bound on catch-up rolls in one tick.
 *
 * `__gameDebug.advanceGameTime(3600)` jumps the sim clock an hour in a single step, and the gather
 * loop has to honour that or the Mining proof cannot be tested at speed. Depletion and a full
 * inventory both break the loop long before this cap; it exists so a pathological jump cannot hang
 * a frame.
 */
const MAX_CATCHUP_ROLLS = 4000;

/** The live runtime record for one node is also its exact persisted shape. */
export type NodeRuntime = ResourceNodeState;

export interface GatheringDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  rng: RngStreams;
  entities: EntityLookup;
  inventory: GatheringInventoryPort;
  activity: ActivitySystem;
  dispatcher: InteractionDispatcher;
}

export class GatheringSystem implements TickSystem {
  readonly name = "gathering";

  /**
   * PRD section 3 row 11 ("World: node respawn timers"), scaled by ten so later systems can slot
   * between rows. Respawn runs after combat and health on purpose: a node must not pop back into
   * existence in the middle of a swing that is still resolving.
   */
  readonly order = 110;

  /** The activity-side half. Registered with `ActivitySystem` in the constructor. */
  readonly driver: ActivityDriver;

  /** itemId -> ResourceDef. Built lazily: content registers after this object is constructed. */
  private resourceByItem: Map<ItemId, ResourceDef> | null = null;

  constructor(private readonly deps: GatheringDeps) {
    this.driver = {
      kind: "gathering",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
    };
    deps.activity.register(this.driver);

    for (const interaction of ["mine", "chop", "fish"] as const) {
      deps.dispatcher.registerHandler(interaction, (context) => this.handle(context));
    }

    // The world is built before the save is loaded, so its entities still carry freshly rolled
    // node state at this point. Apply the persisted records now. Waiting for interaction would
    // draw an exhausted seam, stump, or fishing spot as available until the player touched it.
    this.hydratePersistedNodes();
  }

  /** Satisfies `SystemHooks.gathering` in api/gameApi.ts. */
  hook(): { start(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> } {
    return { start: (entityId, interaction) => this.deps.dispatcher.run(entityId, interaction) };
  }

  // ------------------------------------------------------------ world tick

  /**
   * Respawn timers. A depleted node comes back with a freshly rolled yield count (PRD 2.6), which
   * is what stops a five-node cluster settling into a fixed rotation.
   */
  tick(_deltaMs: number, _atMs: number): void {
    const state = this.deps.store.get();
    const playedAtMs = state.meta.playSeconds * 1_000;
    let changed = false;

    for (const [entityId, node] of Object.entries(state.world.nodes)) {
      const entity = this.deps.entities.get(entityId);
      if (entity?.resource) this.syncNodeView(entity, node);
      if (node.state !== "depleted") continue;
      if (node.respawnAtMs === null || playedAtMs < node.respawnAtMs) continue;

      const tier = entity?.tier ?? 1;
      const authored = entity?.resource
        ? this.resourceDefFor(entity, entity.resource.itemId)?.yieldRange
        : undefined;
      const [min, max] = authored ?? yieldRange(tier);
      const size = entity?.meta?.forestYieldFactor;
      const sizeFactor = entity?.meta?.forestTree === true && typeof size === "number" && Number.isFinite(size)
        ? Math.min(1.5, Math.max(0.65, size)) : 1;
      const rolled = Math.max(1, Math.round(this.deps.rng.get("gather").int(min, max) * sizeFactor));

      node.remaining = rolled;
      node.maxYields = rolled;
      node.state = "available";
      node.respawnAtMs = null;

      if (entity?.resource) this.syncNodeView(entity, node);
      changed = true;
    }

    if (changed) this.deps.store.markDirty();
  }

  // ------------------------------------------------------------------ start

  /**
   * The `mine` / `chop` / `fish` handler.
   *
   * The dispatcher has already checked existence, the verb, requirements, range, and "is it
   * depleted". What is left is the gathering-specific refusal set: no resource block, a full
   * inventory, and the tools-never-bypass-requirements re-check.
   */
  private handle(context: InteractionContext): Result<{ started: string }> {
    return this.begin(context.entity, context.interaction);
  }

  begin(entity: SemanticEntity, interaction: InteractionId): Result<{ started: string }> {
    const state = this.deps.store.get();
    const atMs = this.deps.clock.elapsedMs;

    const resource = entity.resource;
    if (!resource) {
      return err("INVALID_ARGUMENT", `${entity.name} has nothing to gather from.`, entity.id);
    }

    const skill = GATHER_SKILL[interaction] ?? skillOfNode(entity);
    if (!skill) {
      return err("INVALID_ARGUMENT", `${entity.name} does not answer to "${interaction}".`, entity.id);
    }

    // Requirements again, against the BASE level. The dispatcher already ran this check, but "a
    // tool never bypasses a requirement" is a gathering rule and this is the file that owns it.
    const required = entity.requirements?.[skill] ?? 1;
    if (state.skills[skill].level < required) {
      return err(
        "REQUIREMENTS_NOT_MET",
        `${entity.name} needs ${skillLabel(skill)} ${required}. A tool raises your effective level, never the requirement.`,
        entity.id,
      );
    }

    const node = this.nodeRuntime(state, entity);
    if (node.state === "depleted" || node.remaining <= 0) {
      return err("DEPLETED", `${entity.name} is worked out.`, entity.id);
    }

    if (!this.deps.inventory.hasRoomFor(resource.itemId, 1)) {
      this.deps.events.emit("inventory.full", { itemId: resource.itemId }, entity.id, atMs);
      return err("INVENTORY_FULL", "Your inventory is full.", entity.id);
    }

    // A second click on the node you are already working is a no-op, not a restart. Restarting
    // would reset `nextRollAtMs`, and a click-spamming player or agent would gather faster.
    const running = state.activity;
    if (running && running.kind === "gathering" && running.entityId === entity.id) {
      return ok({ started: `already working ${entity.name}` });
    }

    const activity: ActivityState = {
      kind: "gathering",
      skill,
      entityId: entity.id,
      nodeTier: entity.tier,
      startedAtMs: atMs,
      nextRollAtMs: atMs + GATHER_TICK_MS,
      yieldsThisSession: 0,
    };
    this.deps.activity.start(activity, atMs, {
      op: interaction,
      itemId: resource.itemId,
      remaining: node.remaining,
      tier: entity.tier,
      tickMs: GATHER_TICK_MS,
      successChance: round3(gatherSuccessChance(this.effectiveLevel(state, skill), required)),
    });

    return ok({ started: `${interaction} ${entity.name}` });
  }

  // ------------------------------------------------------- activity driver

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ActivityTickResult {
    if (activity.kind !== "gathering") return stopWith("cancelled");

    const entity = this.deps.entities.get(activity.entityId);
    if (!entity || !entity.resource) return stopWith("gone");

    const node = this.nodeRuntime(state, entity);
    if (node.state === "depleted" || node.remaining <= 0) return stopWith("depleted");

    const required = entity.requirements?.[activity.skill] ?? 1;
    const itemId = entity.resource.itemId;

    let rolls = 0;
    let gained = false;

    while (atMs >= activity.nextRollAtMs && rolls < MAX_CATCHUP_ROLLS) {
      rolls += 1;
      activity.nextRollAtMs += GATHER_TICK_MS;

      const chance = gatherSuccessChance(this.effectiveLevel(state, activity.skill), required);
      if (!this.deps.rng.get("gather").chance(chance)) continue;

      // Room is checked per success rather than once at the start: a stack fills mid-session.
      if (!this.deps.inventory.hasRoomFor(itemId, 1)) {
        this.deps.events.emit("inventory.full", { itemId }, entity.id, atMs);
        return stopWith("inventory-full");
      }
      const added = this.deps.inventory.addItem(itemId, 1, {
        eventData: { source: "gather", skill: activity.skill },
        eventEntityId: entity.id,
        eventAtMs: atMs,
      });
      if (!added.ok || added.value <= 0) {
        this.deps.events.emit("inventory.full", { itemId }, entity.id, atMs);
        return stopWith("inventory-full");
      }
      awardXp(state, this.deps.events, activity.skill, gatherXp(entity.tier), atMs);
      activity.yieldsThisSession += 1;
      gained = true;

      this.setRemaining(entity, node, node.remaining - 1);
      this.rollBonusDrops(entity, itemId, atMs);

      if (node.remaining <= 0) {
        this.deplete(entity, node, atMs);
        return stopWith("depleted");
      }
    }

    if (gained) this.deps.store.markDirty();
    return CONTINUE;
  }

  private summarise(activity: ActivityState, state: GameState, atMs: number): ActivitySummary {
    if (activity.kind !== "gathering") {
      return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
    }
    const entity = this.deps.entities.get(activity.entityId);
    const node = entity ? this.nodeRuntime(state, entity) : undefined;
    return {
      kind: "gathering",
      skill: activity.skill,
      entityId: activity.entityId,
      progress: clamp01(1 - (activity.nextRollAtMs - atMs) / GATHER_TICK_MS),
      completed: activity.yieldsThisSession,
      remaining: node?.remaining ?? 0,
    };
  }

  // -------------------------------------------------------------- internals

  /**
   * The store record for a node, created on first touch from whatever the world builder rolled.
   * Once it exists the store is authoritative, so a reload restores a half-worked seam rather than
   * a fresh one — and the entity view is re-synced from it on every read.
   */
  nodeRuntime(state: GameState, entity: SemanticEntity): NodeRuntime {
    const existing = state.world.nodes[entity.id];
    if (existing) {
      this.syncNodeView(entity, existing);
      return existing;
    }
    const created: NodeRuntime = {
      remaining: entity.resource?.remaining ?? 0,
      maxYields: entity.resource?.maxYields ?? entity.resource?.remaining ?? 0,
      state: entity.state === "depleted" ? "depleted" : "available",
      respawnAtMs: null,
    };
    state.world.nodes[entity.id] = created;
    return created;
  }

  private setRemaining(entity: SemanticEntity, node: NodeRuntime, value: number): void {
    node.remaining = Math.max(0, value);
    if (entity.resource) entity.resource.remaining = node.remaining;
  }

  /**
   * Test-only: empty a node through the real depletion path.
   *
   * Deliberately routed through `deplete` rather than writing `remaining = 0` directly, so a test
   * observes the same events, the same state transition and the same respawn timer a player would.
   * A shortcut that bypasses the system proves nothing about the system.
   */
  forceDeplete(entityId: EntityId, atMs: number): boolean {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity?.resource) return false;
    const node = this.nodeRuntime(state, entity);
    this.deplete(entity, node, atMs);
    return true;
  }

  /**
   * Test-only: bring a node back now.
   *
   * Expires the timer rather than re-rolling the node here, so the next tick runs the identical
   * respawn path a player would see — including the fresh yield roll from the seeded stream.
   */
  forceRespawn(entityId: EntityId, _atMs: number): boolean {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    if (!entity?.resource) return false;
    const node = this.nodeRuntime(state, entity);
    if (node.state !== "depleted") return false;
    node.respawnAtMs = state.meta.playSeconds * 1_000;
    return true;
  }

  /** Debug-only resource fast-forward. It deliberately leaves global played time unchanged. */
  fastForwardRespawns(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const state = this.deps.store.get();
    const playedAtMs = state.meta.playSeconds * 1_000;
    const shiftMs = seconds * 1_000;
    let changed = false;

    for (const node of Object.values(state.world.nodes)) {
      if (node.state !== "depleted" || node.respawnAtMs === null) continue;
      node.respawnAtMs = Math.max(playedAtMs, node.respawnAtMs - shiftMs);
      changed = true;
    }
    if (changed) this.deps.store.markDirty();

    // Use the normal roll, state transition, view sync, and dirty path for anything now due.
    this.tick(0, this.deps.clock.elapsedMs);
  }

  private deplete(entity: SemanticEntity, node: NodeRuntime, atMs: number): void {
    const seconds = entity.resource?.respawnSeconds ?? respawnSeconds(entity.tier);
    const yieldsTaken = Math.max(0, Math.floor(node.maxYields));
    node.remaining = 0;
    node.state = "depleted";
    // This field keeps its save-compatible name, but its clock is cumulative played time. Session
    // timestamps reset on every boot and made a saved node wait too long or respawn immediately.
    // Played time survives reload and advances only while the simulation runs.
    node.respawnAtMs = this.deps.store.get().meta.playSeconds * 1_000 + seconds * 1_000;

    entity.state = "depleted";
    if (entity.resource) entity.resource.remaining = 0;

    this.deps.events.emit(
      "resource.depleted",
      {
        entityId: entity.id,
        itemId: entity.resource?.itemId,
        tier: entity.tier,
        respawnInSeconds: seconds,
        yieldsTaken,
        // Kept for existing HUD and audio consumers while the canonical event field is
        // `respawnInSeconds`.
        respawnSeconds: seconds,
        respawnAtMs: node.respawnAtMs,
      },
      entity.id,
      atMs,
    );
    this.deps.store.markDirty();
  }

  /**
   * Effective level = skill level + the best matching tool bonus.
   *
   * Gathering tools are carried inventory items rather than wearable equipment. Scanning the pack
   * also keeps the roll and the fishing rod shown by CharacterRig on the same selection rule.
   */
  effectiveLevel(state: GameState, skill: SkillId): number {
    return state.skills[skill].level + this.toolBonusFor(state, skill);
  }

  toolBonusFor(state: GameState, skill: SkillId): number {
    let best = 0;
    for (const stack of state.inventory.slots) {
      if (!stack) continue;
      const def = content.item(stack.itemId);
      const tool = def?.tool;
      if (!tool || tool.skill !== skill) continue;
      // The authored bonus wins. The PRD's general rule is the fallback, so a table gap degrades to
      // a sensible number instead of silently costing the player their pickaxe.
      const bonus = Number.isFinite(tool.gatherBonus) && tool.gatherBonus > 0
        ? tool.gatherBonus
        : toolBonus(def?.tier ?? 1);
      if (bonus > best) best = bonus;
    }
    return best;
  }

  /** Secondary drops, rolled independently per successful gather (`ResourceDef.bonus`). */
  private rollBonusDrops(entity: SemanticEntity, itemId: ItemId, atMs: number): void {
    const bonuses = this.resourceDefFor(entity, itemId)?.bonus;
    if (!bonuses || bonuses.length === 0) return;

    for (const drop of bonuses) {
      // Bonus drops stay on the loot stream so they never shift the gather sequence.
      if (!this.deps.rng.get("loot").chance(drop.chance)) continue;
      if (!this.deps.inventory.hasRoomFor(drop.itemId, 1)) continue;
      const added = this.deps.inventory.addItem(drop.itemId, 1, {
        eventData: { source: "gather-bonus" },
        eventEntityId: entity.id,
        eventAtMs: atMs,
      });
      if (!added.ok || added.value <= 0) continue;
    }
  }

  /** Apply every saved node record before the first interaction or render-sync tick. */
  private hydratePersistedNodes(): void {
    const state = this.deps.store.get();
    for (const [entityId, node] of Object.entries(state.world.nodes)) {
      const entity = this.deps.entities.get(entityId);
      if (entity?.resource) this.syncNodeView(entity, node);
    }
  }

  private syncNodeView(entity: SemanticEntity, node: NodeRuntime): void {
    if (entity.resource) {
      entity.resource.remaining = node.remaining;
      entity.resource.maxYields = node.maxYields;
    }
    entity.state = node.state;
  }

  /**
   * Finds the canonical ResourceDef behind a node. Region clusters stamp `meta.resourceId`; the
   * item fallback keeps hand-authored test entities useful without reviving cluster aliases.
   */
  private resourceDefFor(entity: SemanticEntity, itemId: ItemId): ResourceDef | undefined {
    const resourceId = entity.meta?.resourceId;
    if (typeof resourceId === "string") {
      const direct = content.resource(resourceId);
      if (direct) return direct;
    }
    if (!this.resourceByItem) {
      const index = new Map<ItemId, ResourceDef>();
      for (const row of content.allResources()) {
        if (!index.has(row.itemId)) index.set(row.itemId, row);
      }
      this.resourceByItem = index;
    }
    return this.resourceByItem.get(itemId);
  }
}

// ----------------------------------------------------------------- helpers

function skillOfNode(entity: SemanticEntity): SkillId | undefined {
  const meta = entity.meta?.skill;
  if (typeof meta === "string") return meta as SkillId;
  const requirements = entity.requirements;
  if (!requirements) return undefined;
  return (Object.keys(requirements) as SkillId[])[0];
}

function skillLabel(skill: SkillId): string {
  return skill.charAt(0).toUpperCase() + skill.slice(1);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
