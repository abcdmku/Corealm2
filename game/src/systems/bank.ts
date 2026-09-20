/**
 * The bank: 400 dense slots, and the reason settlements are worth walking back to.
 *
 * Everything stacks here regardless of `ItemDef.stackable`, so the bank is storage rather than a
 * second inventory puzzle — the interesting constraint stays on the 28 slots you carry. The slot
 * array is dense with no nulls, so `usedSlots` is just `slots.length` and the UI never renders a
 * hole. Capacity is counted in distinct item kinds, not units.
 *
 * Access is geographic. The player must be standing at a bank entity, which is checked through an
 * injected predicate rather than by reaching into the world layer from here.
 *
 * Owner: W-INV. State lives in `state.bank`; this file adds none.
 */
import type { BankView, ItemId, ItemStack, Result } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { GameState, Store } from "../state/store.js";
import { BANK_CAPACITY } from "../state/store.js";
import { content } from "../content/index.js";
import type { EventBus } from "../core/events.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { InventorySystem } from "./inventory.js";
import { MAX_STACK } from "./inventory.js";

export type BankOp = "list" | "deposit" | "withdraw" | "depositAll";

export interface BankArgs {
  itemId?: ItemId;
  /** Omitted or -1 means "all of it". The UI omits it; the agent API also accepts the PRD's -1. */
  quantity?: number;
  /** Plain case-insensitive substring match for this list response. Empty string returns all rows. */
  filter?: string;
}

export interface BankDeps {
  store: Store;
  events: EventBus;
  inventory: InventorySystem;
  dispatcher: InteractionDispatcher;
  now: () => number;
  /** Production persistence hook. Bank writes are saved before the call returns. */
  persist?: () => void;
  /**
   * True when the player is within interaction range of a bank entity. The world layer owns the
   * distance test; this system only asks.
   */
  inRangeOfBank: () => boolean;
}

export class BankSystem {
  constructor(private readonly deps: BankDeps) {
    deps.dispatcher.registerHandler("bank", (context) => this.open(context));
  }

  private get state(): GameState {
    return this.deps.store.get();
  }

  /** Opens the bank through the same interaction path used by pointer and agent play. */
  private open(context: InteractionContext): Result<{ started: string }> {
    if (context.entity.archetype !== "bank") {
      return err("INVALID_ARGUMENT", `${context.entity.name} is not a bank`, context.entity.id);
    }
    this.deps.events.emit(
      "activity.started",
      { kind: "bank", interaction: "bank" },
      context.entity.id,
      this.deps.now(),
    );
    return ok({ started: `banking at ${context.entity.name}` });
  }

  /** Matches `SystemHooks.bank`. */
  op(op: BankOp, args?: BankArgs): Result<BankView> {
    if (!this.deps.inRangeOfBank()) {
      return err("OUT_OF_RANGE", "You need to be standing at a bank to use it");
    }
    switch (op) {
      case "list":
        return ok(this.view(args?.filter));
      case "deposit":
        return this.write(() => this.deposit(args));
      case "withdraw":
        return this.write(() => this.withdraw(args));
      case "depositAll":
        return this.write(() => this.depositAll());
      default:
        return err("INVALID_ARGUMENT", `Unknown bank op "${String(op)}"`);
    }
  }

  private write(operation: () => Result<BankView>): Result<BankView> {
    const result = operation();
    if (result.ok) this.deps.persist?.();
    return result;
  }

  // ------------------------------------------------------------------- views

  /**
   * `slots` can be filtered for this one response; `usedSlots` and `capacity` always describe the
   * whole bank, because a filter must never look like free space. Filtering is request-scoped. An
   * agent search must not change what the player sees later or what a bulk deposit moves.
   */
  view(requestFilter = ""): BankView {
    const filter = requestFilter.trim().toLowerCase();
    const all = this.state.bank.slots;
    const visible = filter.length === 0
      ? all
      : all.filter((stack) => this.displayName(stack.itemId).toLowerCase().includes(filter));
    return {
      slots: visible.map((stack) => ({ ...stack })),
      usedSlots: all.length,
      capacity: BANK_CAPACITY,
    };
  }

  private displayName(itemId: ItemId): string {
    return content.item(itemId)?.name ?? itemId;
  }

  // ---------------------------------------------------------------- deposits

  private deposit(args?: BankArgs): Result<BankView> {
    const itemId = args?.itemId;
    if (!itemId) return err("INVALID_ARGUMENT", "deposit needs an itemId");

    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (def.category === "currency") {
      return err("INVALID_ARGUMENT", "Gold is a single carried balance and never takes a bank slot");
    }

    const held = this.deps.inventory.countOf(itemId);
    if (held < 1) return err("NOT_ENOUGH_ITEMS", `You are not carrying any ${def.name}`);

    const requested = args?.quantity;
    if (requested !== undefined && requested !== -1 && (!Number.isFinite(requested) || requested < 1)) {
      return err("INVALID_ARGUMENT", "Quantity must be -1 for all or at least 1");
    }
    const wanted = requested === undefined || requested === -1
      ? held
      : Math.min(Math.floor(requested), held);

    const moved = this.moveIn(itemId, wanted);
    if (!moved.ok) return { ok: false, error: moved.error };
    return ok(this.view());
  }

  private depositAll(): Result<BankView> {
    const ids = this.deps.inventory.distinctItemIds();
    let movedAny = false;
    let blocked = false;

    for (const itemId of ids) {
      const def = content.item(itemId);
      if (!def || def.category === "currency") continue;
      const held = this.deps.inventory.countOf(itemId);
      if (held < 1) continue;
      const moved = this.moveIn(itemId, held);
      if (moved.ok) movedAny = true;
      else if (moved.error.code === "INVENTORY_FULL") blocked = true;
    }

    if (!movedAny && blocked) {
      return err("INVENTORY_FULL", `The bank is full: all ${BANK_CAPACITY} slots are in use`);
    }
    return ok(this.view());
  }

  /** Inventory to bank. Fails without moving anything when the bank has no slot for a new kind. */
  private moveIn(itemId: ItemId, quantity: number): Result<number> {
    const existing = this.state.bank.slots.find((stack) => stack.itemId === itemId);
    if (!existing && this.state.bank.slots.length >= BANK_CAPACITY) {
      return err("INVENTORY_FULL", `The bank is full: all ${BANK_CAPACITY} slots are in use`);
    }
    const room = existing ? MAX_STACK - existing.quantity : MAX_STACK;
    const amount = Math.min(quantity, room);
    if (amount < 1) return err("INVENTORY_FULL", "That bank stack is already at its maximum");

    const removed = this.deps.inventory.removeItem(itemId, amount);
    if (!removed.ok) return { ok: false, error: removed.error };

    if (existing) existing.quantity += amount;
    else this.state.bank.slots.push({ itemId, quantity: amount });
    this.deps.store.markDirty();
    return ok(amount);
  }

  // -------------------------------------------------------------- withdrawal

  private withdraw(args?: BankArgs): Result<BankView> {
    const itemId = args?.itemId;
    if (!itemId) return err("INVALID_ARGUMENT", "withdraw needs an itemId");

    const def = content.item(itemId);
    if (!def) return err("NOT_FOUND", `No item with id ${itemId}`);

    const index = this.state.bank.slots.findIndex((stack) => stack.itemId === itemId);
    const stack: ItemStack | undefined = index >= 0 ? this.state.bank.slots[index] : undefined;
    if (!stack || stack.quantity < 1) {
      return err("NOT_ENOUGH_ITEMS", `The bank holds no ${def.name}`);
    }

    const requested = args?.quantity;
    if (requested !== undefined && requested !== -1 && (!Number.isFinite(requested) || requested < 1)) {
      return err("INVALID_ARGUMENT", "Quantity must be -1 for all or at least 1");
    }
    const wanted = requested === undefined || requested === -1
      ? stack.quantity
      : Math.min(Math.floor(requested), stack.quantity);

    // addItem does the slot arithmetic and reports what actually fit; the bank gives up exactly that
    // much, so a half-fitting withdrawal never loses the remainder.
    const added = this.deps.inventory.addItem(itemId, wanted);
    if (!added.ok) return { ok: false, error: added.error };

    stack.quantity -= added.value;
    if (stack.quantity <= 0) this.state.bank.slots.splice(index, 1);
    this.deps.store.markDirty();
    return ok(this.view());
  }
}
