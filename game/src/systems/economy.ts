/**
 * Shops and marks: the sink and the source that give gathered ore a number.
 *
 * Prices are fixed and readable off the content tables, never haggled and never dynamic — an agent
 * should be able to work out whether a trip is worth it from `ItemDef.value` and two multipliers,
 * without sampling the market. Buy is `value * buyMultiplier`, sell is `value * sellMultiplier`,
 * rounded once per item, which is the 40% spread PRD 2.10 tabulates.
 *
 * Stock is fixed in the literal sense: `ShopDef.stock` quantities are what the shop always has.
 * There is no per-shop stock in `state`, so a depleting shelf would need a new state field, and the
 * frozen store owns that decision. Selling to a shop pays marks and the goods leave the world.
 *
 * Owner: W-INV. State touched: `state.currency` (through the inventory system) only.
 */
import type { EntityId, ItemId, Result, ShopView } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { ShopDef } from "../content/index.js";
import { content } from "../content/index.js";
import type { GameState, Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { InteractionContext, InteractionDispatcher } from "../world/interactions.js";
import type { InventorySystem } from "./inventory.js";

export type ShopOp = "list" | "buy" | "sell";

export interface ShopArgs {
  shopId?: EntityId;
  itemId?: ItemId;
  /** Omitted means 1 when buying and "all of them" when selling. */
  quantity?: number;
}

/** What the world layer must answer about the shop the player is standing at. */
export interface ShopResolution {
  /** The semantic entity the player interacts with. */
  entityId: EntityId;
  /** The `content.shop(id)` key backing that entity. */
  contentShopId: string;
  /** Within interaction range right now. */
  inRange: boolean;
}

export interface EconomyDeps {
  store: Store;
  events: EventBus;
  inventory: InventorySystem;
  dispatcher: InteractionDispatcher;
  now: () => number;
  /**
   * Resolves which shop a call refers to. With no `shopId` this should return the nearest shop
   * entity the player could be using. Returning undefined means "no such shop", which reads as
   * NOT_FOUND; returning `inRange: false` reads as OUT_OF_RANGE.
   */
  resolveShop: (shopId?: EntityId) => ShopResolution | undefined;
}

export class EconomySystem {
  constructor(private readonly deps: EconomyDeps) {
    deps.dispatcher.registerHandler("trade", (context) => this.open(context));
  }

  private get state(): GameState {
    return this.deps.store.get();
  }

  /** Opens the shop through the same interaction path used by pointer and agent play. */
  private open(context: InteractionContext): Result<{ started: string }> {
    if (context.entity.archetype !== "shop") {
      return err("INVALID_ARGUMENT", `${context.entity.name} is not a shop`, context.entity.id);
    }
    const listed = this.op("list", { shopId: context.entity.id });
    if (!listed.ok) return { ok: false, error: listed.error };
    this.deps.events.emit(
      "activity.started",
      { kind: "shop", interaction: "trade" },
      context.entity.id,
      this.deps.now(),
    );
    return ok({ started: `trading at ${context.entity.name}` });
  }

  /** Matches `SystemHooks.shop`. */
  op(op: ShopOp, args?: ShopArgs): Result<ShopView> {
    const resolved = this.deps.resolveShop(args?.shopId);
    if (!resolved) {
      return args?.shopId
        ? err("NOT_FOUND", `No shop with id ${args.shopId}`, args.shopId)
        : err("NOT_FOUND", "There is no shop nearby");
    }
    if (!resolved.inRange) {
      return err("OUT_OF_RANGE", "You need to be standing at the shop counter", resolved.entityId);
    }
    const def = content.shop(resolved.contentShopId);
    if (!def) {
      return err("NOT_FOUND", `No shop content for ${resolved.contentShopId}`, resolved.entityId);
    }

    switch (op) {
      case "list":
        return ok(this.view(resolved.entityId, def));
      case "buy":
        return this.buy(resolved.entityId, def, args);
      case "sell":
        return this.sell(resolved.entityId, def, args);
      default:
        return err("INVALID_ARGUMENT", `Unknown shop op "${String(op)}"`);
    }
  }

  // ------------------------------------------------------------------ prices

  buyPriceOf(def: ShopDef, itemId: ItemId): number | null {
    const item = content.item(itemId);
    if (!item) return null;
    return Math.max(1, Math.round(item.value * def.buyMultiplier));
  }

  sellPriceOf(def: ShopDef, itemId: ItemId): number | null {
    const item = content.item(itemId);
    if (!item) return null;
    return Math.max(0, Math.round(item.value * def.sellMultiplier));
  }

  private view(entityId: EntityId, def: ShopDef): ShopView {
    const stock: ShopView["stock"] = [];
    for (const row of def.stock) {
      const item = content.item(row.itemId);
      if (!item) continue;
      stock.push({
        itemId: row.itemId,
        name: item.name,
        buyPrice: this.buyPriceOf(def, row.itemId) ?? item.value,
        sellPrice: this.sellPriceOf(def, row.itemId) ?? 0,
        quantity: row.quantity,
      });
    }
    const sellPrices: ShopView["sellPrices"] = {};
    for (const slot of this.state.inventory.slots) {
      if (!slot) continue;
      sellPrices[slot.itemId] = this.sellPriceOf(def, slot.itemId) ?? 0;
    }
    return { shopId: entityId, stock, sellPrices, currency: this.state.currency };
  }

  // -------------------------------------------------------------------- buy

  private buy(entityId: EntityId, def: ShopDef, args?: ShopArgs): Result<ShopView> {
    const itemId = args?.itemId;
    if (!itemId) return err("INVALID_ARGUMENT", "buy needs an itemId");

    const item = content.item(itemId);
    if (!item) return err("NOT_FOUND", `No item with id ${itemId}`);

    const row = def.stock.find((entry) => entry.itemId === itemId);
    if (!row) return err("NOT_FOUND", `${def.name} does not stock ${item.name}`, entityId);

    const requested = args?.quantity ?? 1;
    if (!Number.isFinite(requested) || requested < 1) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1");
    }
    const wanted = Math.floor(requested);
    if (wanted > row.quantity) {
      return err("NOT_ENOUGH_ITEMS", `${def.name} only carries ${row.quantity} ${item.name}`, entityId);
    }

    const unit = this.buyPriceOf(def, itemId) ?? item.value;
    const total = unit * wanted;
    // All or nothing on both checks: a half-filled purchase is harder to reason about than a refusal.
    if (this.state.currency < total) {
      return err("NOT_ENOUGH_CURRENCY", `${wanted} ${item.name} costs ${total} marks; you have ${this.state.currency}`);
    }
    if (!this.deps.inventory.hasSpaceFor(itemId, wanted)) {
      return err("INVENTORY_FULL", `No room for ${wanted} ${item.name}`);
    }

    const added = this.deps.inventory.addItem(itemId, wanted);
    if (!added.ok) return { ok: false, error: added.error };
    const paid = this.deps.inventory.spendCurrency(unit * added.value);
    if (!paid.ok) {
      // Cannot happen after the balance check, but never hand out goods for free.
      this.deps.inventory.removeItem(itemId, added.value);
      return { ok: false, error: paid.error };
    }

    this.deps.store.markDirty();
    return ok(this.view(entityId, def));
  }

  // ------------------------------------------------------------------- sell

  private sell(entityId: EntityId, def: ShopDef, args?: ShopArgs): Result<ShopView> {
    const itemId = args?.itemId;
    if (!itemId) return err("INVALID_ARGUMENT", "sell needs an itemId");

    const item = content.item(itemId);
    if (!item) return err("NOT_FOUND", `No item with id ${itemId}`);
    if (item.category === "currency") return err("INVALID_ARGUMENT", "You cannot sell marks for marks");

    const held = this.deps.inventory.countOf(itemId);
    if (held < 1) return err("NOT_ENOUGH_ITEMS", `You are not carrying any ${item.name}`);

    const requested = args?.quantity;
    if (requested !== undefined && (!Number.isFinite(requested) || requested < 1)) {
      return err("INVALID_ARGUMENT", "Quantity must be at least 1");
    }
    const wanted = requested === undefined ? held : Math.floor(requested);
    if (wanted > held) {
      return err("NOT_ENOUGH_ITEMS", `You have ${held} ${item.name}, not ${wanted}`);
    }

    const unit = this.sellPriceOf(def, itemId) ?? 0;
    if (unit < 1) {
      return err("INVALID_ARGUMENT", `${def.name} will not pay anything for ${item.name}`, entityId);
    }

    const removed = this.deps.inventory.removeItem(itemId, wanted);
    if (!removed.ok) return { ok: false, error: removed.error };
    this.deps.inventory.addCurrency(unit * removed.value);

    this.deps.store.markDirty();
    return ok(this.view(entityId, def));
  }
}
