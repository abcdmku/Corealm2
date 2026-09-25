/**
 * The 28-slot inventory: the constraint the whole economy hangs off.
 *
 * Slot pressure is the reason a route matters. Ore, logs, fish, bars and equipment each burn a real
 * slot, so a trip to Karrowmoor is a decision about what you carry back, not a formality. Only the
 * kinds PRD 2.10 calls stackable (currency, elemental essence, seeds, shafts, gems) collapse into one
 * slot, and that is read straight off `ItemDef.stackable` rather than re-listed here — the content
 * table is the single source of truth for it.
 *
 * Nothing in this file throws. Every public entry point returns `Result<T>`.
 *
 * Owner: W-INV. State lives in `state.inventory.slots` and `state.currency`; this file adds none.
 */
import type { EntityId, EquipSlot, InventorySlot, ItemDef, ItemId, Result } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { INVENTORY_SLOTS } from "../state/store.js";
import { content, healAmount } from "../content/index.js";
import type { EventBus } from "../core/events.js";
import { initialiseWeaponCharge } from "./essence.js";

/** PRD 2.7: eating occupies the player for 1.8 s. */
export const EAT_DURATION_MS = 1_800;

/** PRD 2.10: a bank slot stacks to int32 max. The inventory uses the same ceiling for stackables. */
export const MAX_STACK = 2_147_483_647;

/**
 * Options for a slot move.
 *
 * `silent` exists for one caller: `systems/equipment.ts`. Wearing a sword is not losing it, and an
 * agent rebuilding its pack from `item.received`/`item.lost` reads the pair of events an equip
 * used to generate as a loss followed by nothing. Equipment suppresses both and emits
 * `item.equipped`/`item.unequipped` instead, so the two event families never disagree.
 *
 * `inventory.full` is never suppressed: running out of room is real information no matter who
 * asked for the move.
 */
export interface ItemMoveOptions {
  silent?: boolean;
  /** Extra facts carried on the one inventory-owned receipt event. */
  eventData?: Record<string, unknown>;
  /** Source entity for a receipt, such as the resource node that yielded it. */
  eventEntityId?: EntityId;
  /** Source-system timestamp when it differs from `now()`. */
  eventAtMs?: number;
}

export interface InventoryDeps {
  store: Store;
  events: EventBus;
  /** Sim clock milliseconds, for event timestamps. */
  now: () => number;
  /**
   * Optional boot seam for the eating activity driver. The inventory owns validation and the
   * eventual item move; the driver owns only the timer. No food is consumed when this seam is
   * absent or refuses the activity.
   */
  beginEating?: (itemId: ItemId, durationMs: number, atMs: number) => boolean;
  /**
   * Optional. Lets `use()` on a wearable equip it, which is what a player expects from a click.
   * The root wires `EquipmentSystem.equip`; without it, `use()` on gear returns UNAVAILABLE.
   */
  equip?: (itemId: ItemId) => Result<{ slot: EquipSlot; replaced: ItemId | null }>;
}

export class InventorySystem {
  private currencyItemId: ItemId | null = null;

  constructor(private readonly deps: InventoryDeps) {}

  private get state(): GameState {
    return this.deps.store.get();
  }

  private emit(
    type: "item.received" | "item.lost" | "inventory.full",
    data: Record<string, unknown>,
    entityId?: EntityId,
    atMs = this.deps.now(),
  ): void {
    this.deps.events.emit(type, data, entityId, atMs);
  }

  // ------------------------------------------------------------ SystemHooks

  /** A defensive copy. Callers outside the game must never hold the live array. */
  slots(): (InventorySlot | null)[] {
    return this.state.inventory.slots.map((slot) => (slot ? { ...slot } : null));
  }

  freeSlots(): number {
    let free = 0;
    for (const slot of this.state.inventory.slots) if (slot === null) free += 1;
    return free;
  }

  /**
   * Use an item on itself or on a target. This includes food, potions, and equipping gear when the
   * equipment system is wired. Combination recipes (knife on logs) belong to production, not here.
   */
  use(itemId: ItemId, target?: { itemId: ItemId }): Result<{ effect: string }> {
    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (target) {
      return err("INVALID_ARGUMENT", `${def.name} does nothing when used on that`);
    }
    if (def.food) return this.eat(def);
    if (def.potion) return this.drink(def);
    if (def.equip) {
      const equip = this.deps.equip;
      if (!equip) return err("UNAVAILABLE", "Equipment system is not available yet");
      const result = equip(itemId);
      if (!result.ok) return { ok: false, error: result.error };
      return ok({ effect: `equipped ${def.name} in ${result.value.slot}` });
    }
    return err("INVALID_ARGUMENT", `${def.name} has no use on its own`);
  }

  // ----------------------------------------------- the gathering-side surface

  /**
   * Adds up to `quantity` of an item and reports how many actually landed.
   *
   * Partial adds are deliberate. Non-stackables consume one slot per unit, so a gather that yields
   * three logs into a two-slot inventory stores two, returns ok(2), and emits `inventory.full` — the
   * gathering loop reads the shortfall and stops rather than silently voiding drops. Stackables
   * merge into their single existing stack and only clip at MAX_STACK. When nothing at all fits the
   * call fails with INVENTORY_FULL, so "no room" is never mistaken for "success, zero items".
   */
  addItem(itemId: ItemId, quantity: number, options: ItemMoveOptions = {}): Result<number> {
    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1");
    }
    const wanted = Math.floor(quantity);

    // Gold is a balance, not a slot. See addCurrency for why.
    if (def.category === "currency") return this.addCurrency(wanted);

    const slots = this.state.inventory.slots;
    let added = 0;

    if (def.stackable) {
      const existing = slots.find((slot): slot is InventorySlot => slot !== null && slot.itemId === itemId);
      if (existing) {
        added = Math.min(wanted, Math.max(0, MAX_STACK - existing.quantity));
        existing.quantity += added;
      } else {
        const free = slots.indexOf(null);
        if (free >= 0) {
          added = Math.min(wanted, MAX_STACK);
          slots[free] = { slotIndex: free, itemId, quantity: added };
        }
      }
    } else {
      for (let i = 0; i < slots.length && added < wanted; i += 1) {
        if (slots[i] === null) {
          slots[i] = { slotIndex: i, itemId, quantity: 1 };
          added += 1;
        }
      }
    }

    if (added === 0) {
      this.emit("inventory.full", { itemId, name: def.name, attempted: wanted, added: 0 });
      return err("INVENTORY_FULL", `No room for ${def.name}: all ${INVENTORY_SLOTS} slots are full`);
    }

    // Altar-crafted elemental weapons get their initial charge once. Moving one through the
    // inventory, bank, equipment, death recovery, or loot never refills it.
    if (def.magicWeapon?.charge) initialiseWeaponCharge(this.state, itemId);

    this.deps.store.markDirty();
    if (!options.silent) {
      this.emit(
        "item.received",
        { ...options.eventData, itemId, name: def.name, quantity: added },
        options.eventEntityId,
        options.eventAtMs,
      );
    }
    if (added < wanted) {
      this.emit("inventory.full", { itemId, name: def.name, attempted: wanted, added });
    }
    return ok(added);
  }

  /**
   * Removes exactly `quantity`, or nothing at all. All-or-nothing keeps callers from having to
   * unwind a half-consumed recipe input.
   */
  removeItem(itemId: ItemId, quantity: number, options: ItemMoveOptions = {}): Result<number> {
    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1");
    }
    const wanted = Math.floor(quantity);

    if (def.category === "currency") return this.spendCurrency(wanted);

    const held = this.countOf(itemId);
    if (held < wanted) {
      return err("NOT_ENOUGH_ITEMS", `You have ${held} ${def.name}, not ${wanted}`);
    }

    const slots = this.state.inventory.slots;
    let left = wanted;
    for (let i = 0; i < slots.length && left > 0; i += 1) {
      const slot = slots[i];
      if (!slot || slot.itemId !== itemId) continue;
      const taken = Math.min(slot.quantity, left);
      slot.quantity -= taken;
      left -= taken;
      if (slot.quantity <= 0) slots[i] = null;
    }

    this.deps.store.markDirty();
    if (!options.silent) {
      this.emit("item.lost", { ...options.eventData, itemId, name: def.name, quantity: wanted });
    }
    return ok(wanted);
  }

  countOf(itemId: ItemId): number {
    if (itemId === this.resolveCurrencyItemId()) return this.state.currency;
    let total = 0;
    for (const slot of this.state.inventory.slots) {
      if (slot && slot.itemId === itemId) total += slot.quantity;
    }
    return total;
  }

  /** True when the full quantity fits. A partial fit reports false; use addItem's return for that. */
  hasSpaceFor(itemId: ItemId, quantity: number): boolean {
    const def = content.item(itemId);
    if (!def) return false;
    if (!Number.isFinite(quantity) || quantity < 1) return false;
    if (def.category === "currency") return true;

    const wanted = Math.floor(quantity);
    if (def.stackable) {
      const existing = this.state.inventory.slots.find(
        (slot): slot is InventorySlot => slot !== null && slot.itemId === itemId,
      );
      if (existing) return MAX_STACK - existing.quantity >= wanted;
      return this.freeSlots() >= 1 && wanted <= MAX_STACK;
    }
    return this.freeSlots() >= wanted;
  }

  // Aliases matching `InventoryPort` in systems/activity.ts, so the root can hand this system
  // straight to the gathering and production drivers without an adapter object.
  countItem(itemId: ItemId): number {
    return this.countOf(itemId);
  }

  hasRoomFor(itemId: ItemId, quantity: number): boolean {
    return this.hasSpaceFor(itemId, quantity);
  }

  /** Distinct item ids currently carried, in slot order. Bank deposit-all walks this. */
  distinctItemIds(): ItemId[] {
    const seen: ItemId[] = [];
    for (const slot of this.state.inventory.slots) {
      if (slot && !seen.includes(slot.itemId)) seen.push(slot.itemId);
    }
    return seen;
  }

  // ---------------------------------------------------------------- currency

  /**
   * Gold lives in `state.currency` and nowhere else.
   *
   * PRD 2.10 also describes gold as "carried in inventory". Honouring both would double-count:
   * `GameApi.getCurrency()` and `ShopView.currency` read `state.currency`, while a mirrored stack
   * would be a second, drifting copy of the same number, and reconciling them on every sale is a
   * bug farm. The balance wins because it is the one the frozen contract already reads. The visible
   * consequence is that gold never occupies one of the 28 slots — which costs nothing, because a
   * single always-stacked coin pile was never the constraint that made a route interesting.
   */
  addCurrency(amount: number): Result<number> {
    if (!Number.isFinite(amount) || amount < 1) return err("INVALID_ARGUMENT", "Amount must be at least 1");
    const gained = Math.min(Math.floor(amount), MAX_STACK - this.state.currency);
    if (gained <= 0) return ok(0);
    this.state.currency += gained;
    this.deps.store.markDirty();
    this.emit("item.received", { itemId: this.resolveCurrencyItemId(), name: "gold", quantity: gained });
    return ok(gained);
  }

  spendCurrency(amount: number): Result<number> {
    if (!Number.isFinite(amount) || amount < 1) return err("INVALID_ARGUMENT", "Amount must be at least 1");
    const cost = Math.floor(amount);
    if (this.state.currency < cost) {
      return err("NOT_ENOUGH_CURRENCY", `You have ${this.state.currency} gold, not ${cost}`);
    }
    this.state.currency -= cost;
    this.deps.store.markDirty();
    this.emit("item.lost", { itemId: this.resolveCurrencyItemId(), name: "gold", quantity: cost });
    return ok(cost);
  }

  /** The content id of the currency item, discovered once from the registry. */
  resolveCurrencyItemId(): ItemId {
    if (this.currencyItemId !== null) return this.currencyItemId;
    const found = content.allItems().find((item) => item.category === "currency");
    if (found) this.currencyItemId = found.id;
    return found ? found.id : "gold";
  }

  // -------------------------------------------------------------------- food

  private drink(def: ItemDef): Result<{ effect: string }> {
    const state = this.state;
    const potion = def.potion;
    if (!potion) return err("INVALID_ARGUMENT", `${def.name} is not a potion`);
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (this.countOf(def.id) < 1) return err("NOT_ENOUGH_ITEMS", `You have no ${def.name}`);

    const atMs = this.deps.now();
    const active = state.combat.potionBuffs?.[potion.kind];
    if (active && active.expiresAtMs > atMs && active.strength > potion.strength) {
      return err("INVALID_ARGUMENT", `A stronger ${potion.kind} potion is already active`);
    }

    const removed = this.removeItem(def.id, 1);
    if (!removed.ok) return { ok: false, error: removed.error };
    state.combat.potionBuffs ??= {};
    state.combat.potionBuffs[potion.kind] = {
      itemId: def.id, strength: potion.strength, expiresAtMs: atMs + potion.durationMs,
    };
    this.deps.store.markDirty();
    return ok({ effect: `drank ${def.name}: +${potion.strength} ${potion.kind} for ${Math.round(potion.durationMs / 60_000)} minutes` });
  }

  private eat(def: ItemDef): Result<{ effect: string }> {
    const state = this.state;
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (state.combat.targetId !== null) return err("BUSY", "You cannot eat while attacking");
    if (state.activity) {
      return err("BUSY", state.activity.kind === "eating" ? "Still eating" : "Another activity is in progress");
    }
    if (this.countOf(def.id) < 1) return err("NOT_ENOUGH_ITEMS", `You have no ${def.name}`);

    const beginEating = this.deps.beginEating;
    if (!beginEating) return err("UNAVAILABLE", "Eating activity is not available");
    if (!beginEating(def.id, EAT_DURATION_MS, this.deps.now())) {
      return err("BUSY", "Eating could not be started");
    }
    return ok({ effect: `started eating ${def.name}` });
  }

  /**
   * The eating driver's single completion point.
   *
   * Starting an eat reserves nothing. That makes cancel, death and replacement lossless. The item
   * is removed and its healing applied atomically only after the matching activity reaches its
   * deadline. Rechecking combat and ownership closes the two races that can occur during the
   * timer: the player can target an enemy, or another system can move the food out of the pack.
   */
  completeEating(itemId: ItemId, atMs: number): Result<{ restored: number; effect: string }> {
    const state = this.state;
    const activity = state.activity;
    if (!activity || activity.kind !== "eating" || activity.itemId !== itemId) {
      return err("BUSY", "No matching eating activity is in progress");
    }
    if (atMs < activity.endsAtMs) return err("BUSY", "Still eating");
    if (state.player.health <= 0) return err("DEAD", "The player is dead");
    if (state.combat.targetId !== null) return err("BUSY", "You cannot eat while attacking");

    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (!def.food) return err("INVALID_ARGUMENT", `${def.name} is not edible`);
    if (this.countOf(itemId) < 1) return err("NOT_ENOUGH_ITEMS", `You have no ${def.name}`);

    // The authored heal wins when the table supplies one; otherwise fall back to the PRD 2.7 curve.
    const authored = def.food.healAmount;
    const heal = Number.isFinite(authored) && authored > 0 ? Math.round(authored) : healAmount(def.tier);

    const removed = this.removeItem(itemId, 1);
    if (!removed.ok) return { ok: false, error: removed.error };

    const before = state.player.health;
    // Overheal is burned, not banked: eating at full health still consumes the completed item.
    state.player.health = Math.min(state.player.maxHealth, before + heal);
    const restored = state.player.health - before;
    this.deps.store.markDirty();
    return ok({ restored, effect: `ate ${def.name}, restored ${restored} health` });
  }
}
