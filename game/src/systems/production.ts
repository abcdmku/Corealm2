/**
 * Production: Smithing, Crafting, Cooking and Fletching — PRD 2.7.
 *
 * One model for all four. A recipe names its inputs, its output, its duration, its XP and the
 * station kind it needs; the player has to be standing at a matching station entity. There is no
 * per-skill branch below except the one the PRD asks for: **Cooking is the only skill that can
 * fail**, and a failure yields the recipe's `burntItemId` for 0 XP.
 *
 *   burnChance = clamp(0.45 - 0.030 * (cookingLevel - recipe.reqLevel), 0.00, 0.45)
 *
 * Production **is** an activity, so it lives in `state.activity` and goes through the activity
 * spine, which already enforces the universal interruptions: player movement, damage taken, death
 * and cancel. This file adds the two that are its own — a missing ingredient and a full inventory —
 * and checks that the player is still standing at the station.
 *
 * `systems/activity.ts` belongs to another owner, so it arrives as the injected `ProductionActivityPort`
 * rather than an import. The driver object below is structurally an `ActivityDriver`; the root
 * hands it straight to `ActivitySystem.register`.
 */
import type {
  ActivitySummary, EntityId, RecipeId, Result, SemanticEntity, SkillId,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ActivityState, GameState, Store } from "../state/store.js";
import { addSkillXp } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { RngStreams } from "../core/rng.js";
import type { TickSystem } from "../core/time.js";
import type { InteractionDispatcher } from "../world/interactions.js";
import { distance } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";
import type { RecipeDef } from "../content/index.js";
import { burnChance, content } from "../content/index.js";
import type { CombatEntityPort, CombatInventoryPort } from "./combat.js";
import { MAX_STACK } from "./inventory.js";

/**
 * How far the player may drift from the station before the batch stops. Slightly looser than the
 * walk-into-range threshold so standing at an anvil and turning does not cancel a 20-bar smelt.
 */
export const STATION_RANGE = INTERACT_RANGE + 0.6;

/** Ceiling on batch repetitions caught up in one tick, so a debug time jump cannot hang a frame. */
const MAX_CATCHUP_REPETITIONS = 500;

// -------------------------------------------------------------------- ports

/**
 * The subset of `systems/activity.ts` production needs.
 *
 * `register` takes this file's driver, and `ActivitySystem.register` takes the wider
 * `ActivityDriver`; method parameters are bivariant, so the real system satisfies this port and
 * the driver is still accepted at the call site.
 */
export interface ProductionActivityPort {
  register(driver: ProductionDriver): void;
  start(activity: ActivityState, atMs: number, extra?: Record<string, unknown>): void;
  stop(reason: ProductionStopReason, atMs: number): boolean;
  current(): ActivityState | null;
  isBusy(): boolean;
}

/** The subset of `ActivityStopReason` production can produce. A strict subset, so it is assignable. */
export type ProductionStopReason =
  | "completed" | "cancelled" | "inventory-full" | "moved" | "failed" | "gone"
  | "station-expired" | "replaced";

export type ProductionTickResult =
  | { done: false }
  | { done: true; reason: ProductionStopReason };

/** Structurally an `ActivityDriver` for `kind: "production"`. */
export interface ProductionDriver {
  readonly kind: "production";
  tick(activity: ActivityState, state: GameState, deltaMs: number, atMs: number): ProductionTickResult;
  summary(activity: ActivityState, state: GameState, atMs: number): ActivitySummary;
}

const CONTINUE: ProductionTickResult = { done: false };

export interface ProductionDeps {
  store: Store;
  events: EventBus;
  rng: RngStreams;
  entities: CombatEntityPort;
  inventory: ProductionInventoryPort;
  activity: ProductionActivityPort;
  dispatcher: InteractionDispatcher;
  /** Registers a `produce` interaction handler for station entities. Defaults to true. */
  registerInteraction?: boolean;
}

/** Inventory mutations are silent until a whole repetition has committed. */
export interface ProductionInventoryPort extends CombatInventoryPort {
  addItem(itemId: string, quantity: number, options?: { silent?: boolean }): Result<number>;
  removeItem(itemId: string, quantity: number, options?: { silent?: boolean }): Result<number>;
}

// ------------------------------------------------------------------- system

export class ProductionSystem implements TickSystem {
  readonly name = "production";

  /**
   * PRD section 3, row 6 ("Activity"), one past `ActivitySystem`'s 60. The real work happens
   * inside `this.driver`, which the activity spine calls at 60; this system's own tick keeps the
   * clock reference the summary and the interaction handler read.
   */
  readonly order = 61;

  /** Registered with the activity system by the root: `activity.register(production.driver)`. */
  readonly driver: ProductionDriver;

  private lastAtMs = 0;

  constructor(private readonly deps: ProductionDeps) {
    this.driver = {
      kind: "production",
      tick: (activity, state, deltaMs, atMs) => this.advance(activity, state, deltaMs, atMs),
      summary: (activity, state, atMs) => this.summarise(activity, state, atMs),
    };
    deps.activity.register(this.driver);

    if (deps.registerInteraction !== false) {
      deps.dispatcher.registerHandler("produce", (context) => this.handleProduce(context.entity));
    }
  }

  /** Satisfies `SystemHooks.production` in api/gameApi.ts. */
  hook(): {
    produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;
    produceAt(
      stationId: EntityId,
      recipeId: RecipeId,
      quantity: number,
    ): Result<{ queued: number; durationMs: number }>;
  } {
    return {
      produce: (recipeId, quantity) => this.produce(recipeId, quantity),
      produceAt: (stationId, recipeId, quantity) => this.produceAt(stationId, recipeId, quantity),
    };
  }

  tick(_deltaMs: number, atMs: number): void {
    this.lastAtMs = atMs;
  }

  /** Clears the cached simulation clock after a game reset. */
  reset(atMs = 0): void {
    this.lastAtMs = atMs;
  }

  // ---------------------------------------------------------------- command

  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }> {
    return this.startProduction(recipeId, quantity);
  }

  produceAt(
    stationId: EntityId,
    recipeId: RecipeId,
    quantity: number,
  ): Result<{ queued: number; durationMs: number }> {
    return this.startProduction(recipeId, quantity, stationId);
  }

  private startProduction(
    recipeId: RecipeId,
    quantity: number,
    exactStationId?: EntityId,
  ): Result<{ queued: number; durationMs: number }> {
    const state = this.deps.store.get();
    const atMs = this.lastAtMs;

    if (state.player.health <= 0) return err("DEAD", "You are dead.");
    if (!Number.isFinite(quantity) || quantity < 1) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1.");
    }
    const wanted = Math.floor(quantity);

    const recipe = content.recipe(recipeId);
    if (!recipe) return err("NOT_FOUND", `No recipe with id ${recipeId}`);

    const level = state.skills[recipe.skill].level;
    if (level < recipe.reqLevel) {
      return err("REQUIREMENTS_NOT_MET", `${recipe.name} needs ${recipe.skill} ${recipe.reqLevel}.`);
    }

    const stationResult = exactStationId === undefined
      ? ok(this.findStation(state, recipe))
      : this.validateStation(state, recipe, exactStationId);
    if (!stationResult.ok) return stationResult;
    const station = stationResult.value;
    if (recipe.stations !== null && !station) {
      return err("OUT_OF_RANGE", `${recipe.name} needs ${formatStations(recipe.stations)} nearby.`);
    }

    const missing = this.missingInput(recipe);
    if (missing) {
      return err("NOT_ENOUGH_ITEMS", `${recipe.name} needs ${missing.quantity} ${missing.itemId}.`);
    }
    if (!this.hasRoomForOutput(recipe, state)) {
      return err("INVENTORY_FULL", "Your inventory is full.");
    }

    const activity: ActivityState = {
      kind: "production",
      skill: recipe.skill,
      recipeId: recipe.id,
      stationId: station?.id ?? "",
      remaining: wanted,
      completed: 0,
      nextCompleteAtMs: atMs + recipe.durationMs,
    };
    this.deps.activity.start(activity, atMs, {
      op: recipe.kind,
      recipeId: recipe.id,
      recipeName: recipe.name,
      quantity: wanted,
      durationMs: recipe.durationMs,
    });

    return ok({ queued: wanted, durationMs: recipe.durationMs });
  }

  /**
   * `interact(stationId, "produce")` with no recipe named. Picks the highest-requirement recipe the
   * station makes that the player has both the level and the ingredients for, which is what a
   * click on an anvil with a bag of bars should do.
   */
  private handleProduce(entity: SemanticEntity): Result<{ started: string }> {
    const state = this.deps.store.get();
    const station = entity.station;
    if (!station) return err("INVALID_ARGUMENT", `${entity.name} is not a production station.`, entity.id);
    if (!stationIsUsable(entity)) {
      return err("UNAVAILABLE", `${entity.name} is dormant. Awaken it with its boss Orb first.`, entity.id);
    }

    const candidates = station.recipeIds.length > 0
      ? station.recipeIds.map((id) => content.recipe(id)).filter(isRecipe)
      : content.recipesForSkill(station.skill);

    let best: RecipeDef | undefined;
    for (const recipe of candidates) {
      if (recipe.stations !== null && !recipe.stations.includes(station.kind)) continue;
      if (state.skills[recipe.skill].level < recipe.reqLevel) continue;
      if (this.missingInput(recipe)) continue;
      if (!best || recipe.reqLevel > best.reqLevel) best = recipe;
    }
    if (!best) {
      return err("NOT_ENOUGH_ITEMS", `Nothing you can make at ${entity.name} right now.`, entity.id);
    }

    const result = this.produceAt(entity.id, best.id, this.maxRepetitions(best));
    if (!result.ok) return result;
    return ok({ started: `making ${best.name}` });
  }

  // ------------------------------------------------------------------ drive

  private advance(
    activity: ActivityState,
    state: GameState,
    _deltaMs: number,
    atMs: number,
  ): ProductionTickResult {
    if (activity.kind !== "production") return CONTINUE;

    const recipe = content.recipe(activity.recipeId);
    if (!recipe) return { done: true, reason: "failed" };

    if (recipe.stations !== null) {
      const station = this.deps.entities.get(activity.stationId);
      if (!station) {
        const reason = activity.stationId === "player_campfire" ? "station-expired" : "gone";
        return { done: true, reason };
      }
      if (!station.station || !recipe.stations.includes(station.station.kind)) {
        return { done: true, reason: station.station?.kind === "campfire" ? "station-expired" : "gone" };
      }
      if (station.regionId !== state.player.regionId || distance(state.player.position, station.position) > STATION_RANGE) {
        return { done: true, reason: "moved" };
      }
    }

    let guard = 0;
    while (atMs >= activity.nextCompleteAtMs && activity.remaining > 0 && guard < MAX_CATCHUP_REPETITIONS) {
      guard += 1;

      if (this.missingInput(recipe)) {
        return { done: true, reason: "failed" };
      }
      if (!this.hasRoomForOutput(recipe, state)) {
        this.deps.events.emit("inventory.full", { recipeId: recipe.id }, undefined, atMs);
        return { done: true, reason: "inventory-full" };
      }

      const completion = this.completeOne(recipe, state, activity.stationId, atMs);
      if (!completion.ok) {
        if (completion.reason === "inventory-full") {
          this.deps.events.emit("inventory.full", { recipeId: recipe.id }, undefined, atMs);
        }
        return { done: true, reason: completion.reason };
      }
      activity.completed += 1;
      activity.remaining -= 1;
      activity.nextCompleteAtMs += recipe.durationMs;

      if (activity.remaining <= 0) return { done: true, reason: "completed" };
    }

    return CONTINUE;
  }

  /** One repetition: consume, roll (cooking only), produce, award XP, announce. */
  private completeOne(
    recipe: RecipeDef,
    state: GameState,
    stationId: EntityId,
    atMs: number,
  ): { ok: true } | { ok: false; reason: "inventory-full" | "failed" } {
    const burnt = this.rollBurn(recipe, state);
    const itemId = burnt && recipe.burntItemId ? recipe.burntItemId : recipe.output.itemId;
    const quantity = burnt ? 1 : recipe.output.quantity;

    // This repeats the preflight immediately before mutation. The game is single-threaded, but a
    // test or future inventory adapter may expose state that changed between the driver's checks.
    if (!this.hasRoomForResultAfterInputs(recipe, state, itemId, quantity)) {
      return { ok: false, reason: "inventory-full" };
    }

    const removedInputs: { itemId: string; quantity: number }[] = [];
    for (const input of recipe.inputs) {
      const removed = this.deps.inventory.removeItem(input.itemId, input.quantity, { silent: true });
      if (!removed.ok || removed.value !== input.quantity) {
        this.restoreInputs(removedInputs);
        return { ok: false, reason: "failed" };
      }
      removedInputs.push({ itemId: input.itemId, quantity: input.quantity });
    }

    const added = this.deps.inventory.addItem(itemId, quantity, { silent: true });
    const delivered = added.ok ? added.value : 0;
    if (!added.ok || delivered !== quantity) {
      // The dry-run mirrors InventorySystem exactly, so this path means an injected adapter broke
      // its contract. Undo any partial result before returning the ingredients.
      if (delivered > 0) this.deps.inventory.removeItem(itemId, delivered, { silent: true });
      this.restoreInputs(removedInputs);
      return { ok: false, reason: "inventory-full" };
    }

    if (!burnt) this.awardXp(state, recipe.skill, recipe.xp, atMs);

    for (const input of recipe.inputs) {
      this.deps.events.emit(
        "item.lost",
        { itemId: input.itemId, name: content.item(input.itemId)?.name ?? input.itemId, quantity: input.quantity },
        stationId || undefined,
        atMs,
      );
    }

    this.deps.events.emit(
      "production.completed",
      {
        recipeId: recipe.id,
        recipeName: recipe.name,
        skill: recipe.skill,
        itemId,
        quantity: delivered,
        burnt,
        xp: burnt ? 0 : recipe.xp,
      },
      stationId || undefined,
      atMs,
    );
    this.deps.events.emit(
      "item.received",
      { itemId, name: content.item(itemId)?.name ?? itemId, quantity: delivered },
      stationId || undefined,
      atMs,
    );
    this.deps.store.markDirty();
    return { ok: true };
  }

  /**
   * Cooking is the only production skill that can fail. Anything without a `burntItemId` — every
   * Smithing, Crafting and Fletching recipe — never rolls, so no other skill can burn by accident.
   */
  private rollBurn(recipe: RecipeDef, state: GameState): boolean {
    if (recipe.skill !== "cooking" || !recipe.burntItemId) return false;
    const chance = burnChance(state.skills.cooking.level, recipe.reqLevel);
    if (chance <= 0) return false;
    // Resolve the stream for every roll. RngStreams.reseed replaces its stream objects on reset.
    return this.deps.rng.get("misc").chance(chance);
  }

  // ---------------------------------------------------------------- summary

  private summarise(activity: ActivityState, _state: GameState, atMs: number): ActivitySummary {
    return productionSummary(activity, atMs);
  }

  // -------------------------------------------------------------- read-only

  /** How many repetitions the carried ingredients support. The batch UI's default quantity. */
  maxRepetitions(recipe: RecipeDef): number {
    let most = Number.POSITIVE_INFINITY;
    for (const input of recipe.inputs) {
      if (input.quantity <= 0) continue;
      most = Math.min(most, Math.floor(this.deps.inventory.countItem(input.itemId) / input.quantity));
    }
    if (!Number.isFinite(most)) return 1;
    return Math.max(1, most);
  }

  /** What a station can make right now, for the production panel and the skill guide. */
  availableAt(entityId: EntityId): RecipeDef[] {
    const state = this.deps.store.get();
    const entity = this.deps.entities.get(entityId);
    const station = entity?.station;
    if (!station || !entity || !stationIsUsable(entity)) return [];
    const rows = station.recipeIds.length > 0
      ? station.recipeIds.map((id) => content.recipe(id)).filter(isRecipe)
      : content.recipesForSkill(station.skill);
    return rows.filter((recipe) =>
      state.skills[recipe.skill].level >= recipe.reqLevel
      && (recipe.stations === null || recipe.stations.includes(station.kind))
    );
  }

  // -------------------------------------------------------------- internals

  /**
   * The nearest station in range that matches the recipe.
   *
   * The explicit semantic station kind is authoritative. This keeps a cooking range and a portable
   * campfire interchangeable without accidentally accepting another Cooking-tagged entity.
   */
  private findStation(state: GameState, recipe: RecipeDef): SemanticEntity | undefined {
    if (recipe.stations === null) return undefined;

    let best: SemanticEntity | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entity of this.deps.entities.all()) {
      if (entity.archetype !== "station" || !entity.station) continue;
      if (entity.regionId !== state.player.regionId) continue;
      if (!stationIsUsable(entity)) continue;

      const kindMatches = recipe.stations.includes(entity.station.kind);
      const listed = entity.station.recipeIds.includes(recipe.id);
      if (!kindMatches || (entity.station.recipeIds.length > 0 && !listed)) continue;

      const gap = distance(state.player.position, entity.position);
      if (gap > INTERACT_RANGE) continue;
      if (gap > bestDistance || (gap === bestDistance && best && entity.id >= best.id)) continue;
      bestDistance = gap;
      best = entity;
    }
    return best;
  }

  /** Validates the exact station selected by the panel, interaction, or agent command. */
  private validateStation(
    state: GameState,
    recipe: RecipeDef,
    stationId: EntityId,
  ): Result<SemanticEntity | undefined> {
    const station = this.deps.entities.get(stationId);
    if (!station || station.archetype !== "station" || !station.station) {
      return err("NOT_FOUND", `No production station with id ${stationId}`, stationId);
    }
    if (!stationIsUsable(station)) {
      return err("UNAVAILABLE", `${station.name} is dormant. Awaken it with its boss Orb first.`, stationId);
    }
    if (recipe.stations === null) {
      return err("INVALID_ARGUMENT", `${recipe.name} does not use a production station.`, stationId);
    }
    const kindMatches = recipe.stations.includes(station.station.kind);
    const listed = station.station.recipeIds.includes(recipe.id);
    if (!kindMatches || (station.station.recipeIds.length > 0 && !listed)) {
      return err("INVALID_ARGUMENT", `${station.name} cannot make ${recipe.name}.`, stationId);
    }
    if (station.regionId !== state.player.regionId) {
      return err("OUT_OF_RANGE", `${station.name} is in another region.`, stationId);
    }
    const gap = distance(state.player.position, station.position);
    if (gap > INTERACT_RANGE) {
      return err(
        "OUT_OF_RANGE",
        `${station.name} is ${gap.toFixed(1)} m away; you need to be within ${INTERACT_RANGE.toFixed(1)} m.`,
        stationId,
      );
    }
    return ok(station);
  }

  private missingInput(recipe: RecipeDef): { itemId: string; quantity: number } | undefined {
    for (const input of recipe.inputs) {
      if (this.deps.inventory.countItem(input.itemId) < input.quantity) return input;
    }
    return undefined;
  }

  /**
   * Checks the inventory after a hypothetical ingredient removal. Cooking checks both the cooked
   * and burnt result before rolling, so either deterministic outcome can complete atomically.
   */
  private hasRoomForOutput(recipe: RecipeDef, state: GameState): boolean {
    if (!this.hasRoomForResultAfterInputs(
      recipe,
      state,
      recipe.output.itemId,
      recipe.output.quantity,
    )) return false;

    const canBurn = recipe.skill === "cooking"
      && recipe.burntItemId !== undefined
      && burnChance(state.skills.cooking.level, recipe.reqLevel) > 0;
    return !canBurn || this.hasRoomForResultAfterInputs(recipe, state, recipe.burntItemId!, 1);
  }

  /** Dry-runs the same slot order, stacking rules and stack ceiling as InventorySystem. */
  private hasRoomForResultAfterInputs(
    recipe: RecipeDef,
    state: GameState,
    itemId: string,
    quantity: number,
  ): boolean {
    if (!Number.isFinite(quantity) || quantity < 1) return false;

    const slots = state.inventory.slots.map((slot) => slot ? { ...slot } : null);
    for (const input of recipe.inputs) {
      const inputDef = content.item(input.itemId);
      if (!inputDef) return false;
      if (inputDef.category === "currency") continue;

      let left = input.quantity;
      for (let index = 0; index < slots.length && left > 0; index += 1) {
        const slot = slots[index];
        if (!slot || slot.itemId !== input.itemId) continue;
        const taken = Math.min(slot.quantity, left);
        slot.quantity -= taken;
        left -= taken;
        if (slot.quantity <= 0) slots[index] = null;
      }
      if (left > 0) return false;
    }

    const outputDef = content.item(itemId);
    if (!outputDef) return false;
    if (outputDef.category === "currency") return true;

    const wanted = Math.floor(quantity);
    if (outputDef.stackable) {
      const existing = slots.find((slot) => slot !== null && slot.itemId === itemId);
      if (existing) return MAX_STACK - existing.quantity >= wanted;
      return slots.includes(null) && wanted <= MAX_STACK;
    }
    return slots.reduce((free, slot) => free + (slot === null ? 1 : 0), 0) >= wanted;
  }

  private restoreInputs(inputs: readonly { itemId: string; quantity: number }[]): void {
    for (let index = inputs.length - 1; index >= 0; index -= 1) {
      const input = inputs[index];
      if (input) this.deps.inventory.addItem(input.itemId, input.quantity, { silent: true });
    }
  }

  private awardXp(state: GameState, skill: SkillId, amount: number, atMs: number): void {
    if (amount <= 0) return;
    const result = addSkillXp(state, skill, amount);
    if (result.levelsGained > 0) {
      this.deps.events.emit(
        "level.gained",
        { skill, level: result.newLevel, levelsGained: result.levelsGained },
        undefined,
        atMs,
      );
    }
  }
}

function stationIsUsable(entity: SemanticEntity): boolean {
  return entity.station?.kind !== "essence_altar" || entity.state === "awakened";
}

// ---------------------------------------------------------------- helpers

function isRecipe(value: RecipeDef | undefined): value is RecipeDef {
  return value !== undefined;
}

function formatStations(stations: readonly string[]): string {
  const names = stations.map((kind) => kind.replace(/_/g, " "));
  return names.length < 2 ? `a ${names[0] ?? "station"}` : names.map((name) => `a ${name}`).join(" or ");
}

/** A production run as the HUD and the batch panel show it. Pure, so a page answers it from its replicated activity. */
export function productionSummary(activity: ActivityState, atMs: number): ActivitySummary {
  if (activity.kind !== "production") {
    return { kind: activity.kind, progress: 0, completed: 0, remaining: 0 };
  }
  const recipe = content.recipe(activity.recipeId);
  const durationMs = recipe?.durationMs ?? 1;
  const left = activity.nextCompleteAtMs - atMs;
  const progress = durationMs > 0 ? clamp01(1 - left / durationMs) : 1;

  const summary: ActivitySummary = {
    kind: "production",
    skill: activity.skill,
    recipeId: activity.recipeId,
    progress,
    completed: activity.completed,
    remaining: activity.remaining,
  };
  if (activity.stationId) summary.entityId = activity.stationId;
  return summary;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
