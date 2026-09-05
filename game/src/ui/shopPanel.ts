import { PanelFrame } from "./panelFrame.js";
import { QuantitySelector } from "./quantitySelector.js";
/**
 * The shop window: stock on the left, your inventory on the right, prices on every row, marks in
 * the header. Buying and selling both use the shared quantity modes, so a stack of eighty ore is
 * one click to sell rather than eighty.
 *
 * A row you cannot afford stays visible and says why, in line with the rule the context menu
 * follows — the player has to be able to see the price they are short of.
 */
import type { EntityId, ItemId, ShopView } from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { emptyState, formatExact, formatQuantity, itemDef, itemName, report } from "./panels.js";
import { createItemIcon } from "./itemIcons.js";

interface ShopRow {
  root: HTMLElement;
  name: HTMLElement;
  detail: HTMLElement;
  price: HTMLElement;
  action: HTMLButtonElement;
}

export class ShopPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly quantity: QuantitySelector;
  private readonly marks: HTMLElement;
  private readonly stockList: HTMLElement;
  private readonly stockStatus: HTMLElement;
  private readonly sellList: HTMLElement;
  private readonly sellStatus: HTMLElement;

  private readonly stockRows = new Map<ItemId, ShopRow>();
  private readonly sellRows = new Map<ItemId, ShopRow>();

  private shopId: EntityId | null = null;
  private view: ShopView | null = null;
  private stockSignature = "";
  private sellSignature = "";

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "shop",
      title: "Shop",
      registry: ctx.registry,
      placement: { top: "64px", left: "calc(50% - 310px)", width: "620px" },
      group: "center",
      onOpen: () => this.refresh(true),
    });

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    this.quantity = new QuantitySelector("Amount");
    this.marks = document.createElement("div");
    this.marks.className = "shop__marks u-numeric";
    this.marks.textContent = "0 marks";
    toolbar.append(this.quantity.root, this.marks);
    this.frame.body.appendChild(toolbar);

    const columns = document.createElement("div");
    columns.className = "shop-columns";

    const buyColumn = document.createElement("section");
    buyColumn.className = "shop-column";
    const buyHeading = document.createElement("h3");
    buyHeading.className = "u-caps u-dim";
    buyHeading.textContent = "For sale";
    this.stockStatus = document.createElement("div");
    this.stockList = document.createElement("div");
    this.stockList.className = "shop-list";
    this.stockList.setAttribute("role", "list");
    buyColumn.append(buyHeading, this.stockStatus, this.stockList);

    const sellColumn = document.createElement("section");
    sellColumn.className = "shop-column";
    const sellHeading = document.createElement("h3");
    sellHeading.className = "u-caps u-dim";
    sellHeading.textContent = "Your inventory";
    this.sellStatus = document.createElement("div");
    this.sellList = document.createElement("div");
    this.sellList.className = "shop-list";
    this.sellList.setAttribute("role", "list");
    sellColumn.append(sellHeading, this.sellStatus, this.sellList);

    columns.append(buyColumn, sellColumn);
    this.frame.body.appendChild(columns);
  }

  openFor(shopId?: EntityId): void {
    this.shopId = shopId ?? this.shopId;
    if (this.shopId) {
      const inspected = this.ctx.api.inspect(this.shopId);
      this.frame.setSubtitle(inspected.ok ? inspected.value.name : "");
    }
    this.frame.open();
    this.refresh(true);
  }

  refresh(force = false): void {
    const listed = this.shopId
      ? this.ctx.api.shop("list", { shopId: this.shopId })
      : this.ctx.api.shop("list");

    if (!listed.ok) {
      this.view = null;
      const message = listed.error.message;
      if (this.stockStatus.textContent !== message) {
        this.stockStatus.replaceChildren(emptyState(message));
        this.stockList.replaceChildren();
        this.stockRows.clear();
        this.stockSignature = "";
      }
      this.marks.textContent = `${formatQuantity(this.ctx.api.getCurrency())} marks`;
      this.paintSellSide(force);
      return;
    }

    this.view = listed.value;
    this.paintBuySide(listed.value, force);
    this.paintSellSide(force);
  }

  dispose(): void {
    this.frame.dispose();
  }

  /** Called from the inventory panel's context menu while a shop is open. */
  sell(itemId: ItemId, quantity: number): void {
    const args = this.shopId ? { shopId: this.shopId, itemId, quantity } : { itemId, quantity };
    const result = this.ctx.api.shop("sell", args);
    if (result.ok) {
      this.view = result.value;
      notify(`Sold ${quantity} × ${itemName(itemId)}.`, "success");
      this.refresh(true);
    } else {
      report(result);
    }
    this.ctx.refresh();
  }

  private buy(itemId: ItemId, quantity: number): void {
    const args = this.shopId ? { shopId: this.shopId, itemId, quantity } : { itemId, quantity };
    const result = this.ctx.api.shop("buy", args);
    if (result.ok) {
      this.view = result.value;
      notify(`Bought ${quantity} × ${itemName(itemId)}.`, "success");
      this.refresh(true);
    } else {
      report(result);
    }
    this.ctx.refresh();
  }

  // ------------------------------------------------------------- buy side

  private paintBuySide(view: ShopView, force: boolean): void {
    const signature = [
      view.currency,
      ...view.stock.map((row) => `${row.itemId}:${row.quantity}:${row.buyPrice}`),
    ].join("|");
    if (!force && signature === this.stockSignature) return;
    this.stockSignature = signature;

    this.marks.textContent = `${formatQuantity(view.currency)} marks`;
    this.frame.setSubtitle(`${view.stock.length} lines · ${formatExact(view.currency)} marks`);

    if (view.stock.length === 0) {
      this.stockStatus.replaceChildren(emptyState("This shop has nothing in stock."));
    } else if (this.stockStatus.childElementCount > 0) {
      this.stockStatus.replaceChildren();
    }

    const seen = new Set<ItemId>();
    for (const line of view.stock) {
      seen.add(line.itemId);
      const row = this.ensureRow(this.stockRows, this.stockList, line.itemId, "Buy");

      row.name.textContent = line.name || itemName(line.itemId);
      row.detail.textContent = line.quantity > 0 ? `${formatQuantity(line.quantity)} in stock` : "out of stock";
      row.price.textContent = `${formatQuantity(line.buyPrice)} ◈`;

      const affordable = view.currency >= line.buyPrice;
      const inStock = line.quantity > 0;
      const reason = !inStock ? "Out of stock" : !affordable ? "Not enough marks" : null;
      this.setRowState(row, reason);
      this.stockList.appendChild(row.root);
    }
    this.prune(this.stockRows, seen);
  }

  // ------------------------------------------------------------ sell side

  private paintSellSide(force: boolean): void {
    const inventory = this.ctx.api.getInventory();
    const totals = new Map<ItemId, number>();
    for (const slot of inventory.slots) {
      if (!slot) continue;
      totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
    }

    const entries = [...totals.entries()].sort((a, b) => itemName(a[0]).localeCompare(itemName(b[0])));
    const signature = entries.map(([itemId, quantity]) => `${itemId}:${quantity}:${this.sellPriceFor(itemId)}`).join("|");
    if (!force && signature === this.sellSignature) return;
    this.sellSignature = signature;

    if (entries.length === 0) {
      this.sellStatus.replaceChildren(emptyState("You are carrying nothing to sell."));
    } else if (this.sellStatus.childElementCount > 0) {
      this.sellStatus.replaceChildren();
    }

    const seen = new Set<ItemId>();
    for (const [itemId, quantity] of entries) {
      seen.add(itemId);
      const row = this.ensureRow(this.sellRows, this.sellList, itemId, "Sell");

      row.name.textContent = itemName(itemId);
      row.detail.textContent = `${formatQuantity(quantity)} carried`;
      const price = this.sellPriceFor(itemId);
      row.price.textContent = `${formatQuantity(price)} ◈`;
      this.setRowState(row, price > 0 ? null : "This shop will not buy that");
      this.sellList.appendChild(row.root);
    }
    this.prune(this.sellRows, seen);
  }

  /** The economy quotes every carried item, including goods the shop does not stock. */
  private sellPriceFor(itemId: ItemId): number {
    return this.view?.sellPrices[itemId] ?? 0;
  }

  // -------------------------------------------------------------- plumbing

  /**
   * Rows are created once per item and then updated in place, so a purchase does not rebuild the
   * list. The amount a click acts on is read live rather than captured, or "All" would spend a
   * stock count from before the last transaction.
   */
  private ensureRow(
    rows: Map<ItemId, ShopRow>,
    list: HTMLElement,
    itemId: ItemId,
    verb: "Buy" | "Sell",
  ): ShopRow {
    const existing = rows.get(itemId);
    if (existing) return existing;

    const act = (quantity: number): void => {
      if (verb === "Buy") this.buy(itemId, quantity);
      else this.sell(itemId, quantity);
    };
    const available = (): number => (verb === "Buy" ? this.buyableCount(itemId) : this.carriedCount(itemId));

    const root = document.createElement("div");
    root.className = "shop-row";
    root.setAttribute("role", "listitem");

    const glyph = document.createElement("span");
    glyph.className = "slot__glyph shop-row__glyph";
    glyph.appendChild(createItemIcon(itemDef(itemId)));

    const text = document.createElement("div");
    text.className = "shop-row__text";
    const name = document.createElement("div");
    name.className = "shop-row__name u-truncate";
    const detail = document.createElement("div");
    detail.className = "shop-row__detail u-dim u-numeric";
    text.append(name, detail);

    const price = document.createElement("div");
    price.className = "shop-row__price u-numeric";

    const action = document.createElement("button");
    action.type = "button";
    action.className = "btn shop-row__action";
    action.textContent = verb;
    action.addEventListener("click", () => {
      const blocked = action.dataset["reason"];
      if (blocked) {
        // Never a dead click: say the reason the row already shows.
        notify(blocked, "info");
        return;
      }
      act(this.quantity.resolve(available()));
    });

    root.append(glyph, text, price, action);
    this.ctx.tooltip.attach(root, () => ({
      kind: "item",
      itemId,
      compareEquipped: true,
      footer: [`${verb} price ${formatExact(verb === "Buy" ? this.buyPriceFor(itemId) : this.sellPriceFor(itemId))} marks each.`],
    }));

    const row: ShopRow = { root, name, detail, price, action };
    rows.set(itemId, row);
    list.appendChild(root);
    return row;
  }

  private buyPriceFor(itemId: ItemId): number {
    return this.view?.stock.find((row) => row.itemId === itemId)?.buyPrice ?? itemDef(itemId)?.value ?? 0;
  }

  /** "All" when buying means all you can afford, not all the shop has and a rejected purchase. */
  private buyableCount(itemId: ItemId): number {
    const line = this.view?.stock.find((row) => row.itemId === itemId);
    const stock = line?.quantity ?? 1;
    const price = line?.buyPrice ?? 0;
    const currency = this.view?.currency ?? this.ctx.api.getCurrency();
    const affordable = price > 0 ? Math.floor(currency / price) : stock;
    return Math.max(1, Math.min(stock, affordable));
  }

  private carriedCount(itemId: ItemId): number {
    let total = 0;
    for (const slot of this.ctx.api.getInventory().slots) {
      if (slot?.itemId === itemId) total += slot.quantity;
    }
    return Math.max(1, total);
  }

  private setRowState(row: ShopRow, reason: string | null): void {
    if (reason) {
      row.action.dataset["reason"] = reason;
      row.action.setAttribute("aria-disabled", "true");
      row.action.title = reason;
      row.root.classList.add("is-blocked");
    } else {
      delete row.action.dataset["reason"];
      row.action.removeAttribute("aria-disabled");
      row.action.removeAttribute("title");
      row.root.classList.remove("is-blocked");
    }
  }

  private prune(rows: Map<ItemId, ShopRow>, keep: Set<ItemId>): void {
    for (const [itemId, row] of rows) {
      if (keep.has(itemId)) continue;
      row.root.remove();
      rows.delete(itemId);
    }
  }
}
