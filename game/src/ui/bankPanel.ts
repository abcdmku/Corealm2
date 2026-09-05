import { PanelFrame } from "./panelFrame.js";
import { QuantitySelector } from "./quantitySelector.js";
/**
 * The bank window: bank on the left, inventory on the right, because every real bank interaction is
 * a transfer between the two and a player should never have to remember what is in the other one.
 *
 * Quantity is a mode, not a prompt — 1 / 5 / 10 / All / X — so depositing forty things is four clicks
 * instead of forty. The filter is a plain substring match applied to what `bank("list")` returned,
 * which keeps the behaviour identical whether or not the banking system implements its own filter.
 *
 * Opened by the world: the activity event bridge calls `Ui.openBank()` when a bank interaction
 * succeeds, so mouse, context-menu, and agent interactions all reach this same panel.
 */
import type { BankView, EntityId, InventorySlot, ItemId, ItemStack } from "../contracts.js";
import { notify } from "./contextMenu.js";
import type { ContextMenuItem } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { INVENTORY_COLUMNS, INVENTORY_SLOTS, emptyState, formatExact, installRovingGrid, itemName, paintSlot, report, stackSignature } from "./panels.js";

const BANK_COLUMNS = 8;
const BANK_PAGE_SIZE = 80;

export class BankPanel implements ManagedPanel {
  readonly frame: PanelFrame;

  private readonly filterInput: HTMLInputElement;
  private readonly quantity: QuantitySelector;
  private readonly bankGrid: HTMLElement;
  private readonly bankStatus: HTMLElement;
  private readonly bankHeading: HTMLElement;
  private readonly invGrid: HTMLElement;
  private readonly invHeading: HTMLElement;
  private readonly pager: HTMLElement;
  private readonly pageLabel: HTMLElement;

  private readonly bankCells: HTMLButtonElement[] = [];
  private readonly invCells: HTMLButtonElement[] = [];

  private visible: ItemStack[] = [];
  private inventory: (InventorySlot | null)[] = [];
  private page = 0;
  private bankSignature = "";
  private invSignature = "";
  private lastError: string | null = null;

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "bank",
      title: "Bank",
      registry: ctx.registry,
      placement: { top: "64px", left: "calc(50% - 350px)", width: "700px" },
      group: "center",
      onOpen: () => this.refresh(true),
      onClose: () => { this.page = 0; },
    });

    // ---- toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";

    this.filterInput = document.createElement("input");
    this.filterInput.type = "search";
    this.filterInput.className = "field";
    this.filterInput.placeholder = "Filter by name…";
    this.filterInput.setAttribute("aria-label", "Filter bank by name");
    this.filterInput.addEventListener("input", () => {
      this.page = 0;
      this.refresh(true);
    });

    this.quantity = new QuantitySelector("Amount");

    const depositAll = document.createElement("button");
    depositAll.type = "button";
    depositAll.className = "btn btn--primary";
    depositAll.textContent = "Deposit all";
    depositAll.addEventListener("click", () => this.depositAll());

    toolbar.append(this.filterInput, this.quantity.root, depositAll);
    this.frame.body.appendChild(toolbar);

    // ---- two columns
    const columns = document.createElement("div");
    columns.className = "bank-columns";

    const bankColumn = document.createElement("section");
    bankColumn.className = "bank-column bank-column--bank";
    this.bankHeading = document.createElement("h3");
    this.bankHeading.className = "u-caps u-dim";
    this.bankHeading.textContent = "Bank";
    this.bankStatus = document.createElement("div");
    this.bankStatus.className = "bank-status";
    this.bankGrid = document.createElement("div");
    this.bankGrid.className = "slot-grid bank-grid";
    this.bankGrid.style.setProperty("--slot-columns", String(BANK_COLUMNS));
    this.bankGrid.setAttribute("role", "group");
    this.bankGrid.setAttribute("aria-label", "Bank contents");
    installRovingGrid(this.bankGrid, BANK_COLUMNS);

    this.pager = document.createElement("div");
    this.pager.className = "pager";
    this.pager.hidden = true;
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn btn--ghost";
    prev.textContent = "Prev";
    prev.addEventListener("click", () => this.turnPage(-1));
    const next = document.createElement("button");
    next.type = "button";
    next.className = "btn btn--ghost";
    next.textContent = "Next";
    next.addEventListener("click", () => this.turnPage(1));
    this.pageLabel = document.createElement("span");
    this.pageLabel.className = "u-dim u-numeric";
    this.pager.append(prev, this.pageLabel, next);

    bankColumn.append(this.bankHeading, this.bankStatus, this.bankGrid, this.pager);

    const invColumn = document.createElement("section");
    invColumn.className = "bank-column bank-column--inventory";
    this.invHeading = document.createElement("h3");
    this.invHeading.className = "u-caps u-dim";
    this.invHeading.textContent = "Inventory";
    this.invGrid = document.createElement("div");
    this.invGrid.className = "slot-grid inv-grid";
    this.invGrid.style.setProperty("--slot-columns", String(INVENTORY_COLUMNS));
    this.invGrid.setAttribute("role", "group");
    this.invGrid.setAttribute("aria-label", "Your inventory");
    installRovingGrid(this.invGrid, INVENTORY_COLUMNS);
    for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
      this.invGrid.appendChild(this.buildInventoryCell(index));
    }
    invColumn.append(this.invHeading, this.invGrid);

    columns.append(bankColumn, invColumn);
    this.frame.body.appendChild(columns);
  }

  /** Called when a bank interaction lands. `entityId` only names the window. */
  openFor(entityId?: EntityId): void {
    if (entityId) {
      const inspected = this.ctx.api.inspect(entityId);
      this.frame.setSubtitle(inspected.ok ? inspected.value.name : "");
    }
    this.frame.open();
    this.refresh(true);
  }

  refresh(force = false): void {
    this.refreshBank(force);
    this.refreshInventory(force);
  }

  dispose(): void {
    this.frame.dispose();
  }

  // ------------------------------------------------------------- bank side

  private refreshBank(force: boolean): void {
    const listed = this.ctx.api.bank("list");
    if (!listed.ok) {
      // The banking system is not online yet. Say so in the panel instead of showing an empty grid
      // that looks like an empty bank.
      const message = listed.error.message;
      if (this.lastError !== message) {
        this.lastError = message;
        this.bankStatus.replaceChildren(emptyState(message));
        this.bankGrid.replaceChildren();
        this.bankCells.length = 0;
        this.pager.hidden = true;
        this.bankSignature = "";
        this.frame.setSubtitle("unavailable");
      }
      return;
    }
    this.lastError = null;
    this.paintBank(listed.value, force);
  }

  private paintBank(view: BankView, force: boolean): void {
    const filter = this.filterInput.value.trim().toLowerCase();
    const matching = filter
      ? view.slots.filter((stack) => itemName(stack.itemId).toLowerCase().includes(filter))
      : [...view.slots];

    const pageCount = Math.max(1, Math.ceil(matching.length / BANK_PAGE_SIZE));
    if (this.page >= pageCount) this.page = pageCount - 1;
    const start = this.page * BANK_PAGE_SIZE;
    const visible = matching.slice(start, start + BANK_PAGE_SIZE);

    const signature = [
      view.usedSlots, view.capacity, filter, this.page, matching.length,
      ...visible.map(stackSignature),
    ].join("|");
    if (!force && signature === this.bankSignature) return;
    this.bankSignature = signature;
    this.visible = visible;

    if (this.bankStatus.childElementCount > 0) this.bankStatus.replaceChildren();
    this.ensureBankCells(visible.length);
    visible.forEach((stack, index) => {
      const cell = this.bankCells[index];
      if (cell) paintSlot(cell, stack);
    });

    this.bankHeading.textContent = filter
      ? `Bank · ${matching.length} of ${view.usedSlots} shown`
      : `Bank · ${view.usedSlots} of ${view.capacity} used`;
    this.pager.hidden = pageCount <= 1;
    this.pageLabel.textContent = `page ${this.page + 1} / ${pageCount}`;
    this.frame.setSubtitle(`${view.usedSlots} of ${view.capacity} slots`);

    if (matching.length === 0) {
      this.bankStatus.replaceChildren(emptyState(filter ? "Nothing matches that filter." : "Your bank is empty."));
    }
  }

  private ensureBankCells(count: number): void {
    while (this.bankCells.length > count) {
      const cell = this.bankCells.pop();
      cell?.remove();
    }
    while (this.bankCells.length < count) {
      const index = this.bankCells.length;
      const cell = this.buildBankCell(index);
      this.bankCells.push(cell);
      this.bankGrid.appendChild(cell);
    }
  }

  private buildBankCell(index: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot is-empty";
    cell.dataset["slotIndex"] = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;

    cell.addEventListener("click", () => {
      const stack = this.visible[index];
      if (stack) this.withdraw(stack.itemId, this.quantity.resolve(stack.quantity));
    });
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const stack = this.visible[index];
      if (stack) this.openTransferMenu(stack, "withdraw", event.clientX, event.clientY);
    });
    this.ctx.tooltip.attach(cell, () => {
      const stack = this.visible[index];
      if (!stack) return null;
      return {
        kind: "item",
        itemId: stack.itemId,
        quantity: stack.quantity,
        compareEquipped: true,
        footer: ["Click to withdraw the selected amount."],
      };
    });
    return cell;
  }

  // -------------------------------------------------------- inventory side

  private refreshInventory(force: boolean): void {
    const inventory = this.ctx.api.getInventory();
    const slots: (InventorySlot | null)[] = [];
    for (let index = 0; index < INVENTORY_SLOTS; index += 1) slots[index] = inventory.slots[index] ?? null;

    const signature = slots.map(stackSignature).join("|");
    if (!force && signature === this.invSignature) return;
    this.invSignature = signature;
    this.inventory = slots;

    for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
      const cell = this.invCells[index];
      if (cell) paintSlot(cell, slots[index] ?? null);
    }
    this.invHeading.textContent = `Inventory · ${inventory.freeSlots} free`;
  }

  private buildInventoryCell(index: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot is-empty";
    cell.dataset["slotIndex"] = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;

    cell.addEventListener("click", () => {
      const stack = this.inventory[index];
      if (stack) this.deposit(stack.itemId, this.quantity.resolve(this.carriedQuantity(stack.itemId)));
    });
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const stack = this.inventory[index];
      if (stack) this.openTransferMenu(
        { itemId: stack.itemId, quantity: this.carriedQuantity(stack.itemId) },
        "deposit",
        event.clientX,
        event.clientY,
      );
    });
    this.ctx.tooltip.attach(cell, () => {
      const stack = this.inventory[index];
      if (!stack) return null;
      return {
        kind: "item",
        itemId: stack.itemId,
        quantity: stack.quantity,
        compareEquipped: true,
        footer: ["Click to deposit the selected amount."],
      };
    });

    this.invCells.push(cell);
    return cell;
  }

  private carriedQuantity(itemId: ItemId): number {
    return this.inventory.reduce(
      (total, slot) => total + (slot?.itemId === itemId ? slot.quantity : 0),
      0,
    );
  }

  // ------------------------------------------------------------ operations

  deposit(itemId: ItemId, quantity: number): void {
    const result = this.ctx.api.bank("deposit", { itemId, quantity });
    if (result.ok) this.paintBank(result.value, true);
    else report(result);
    this.refreshInventory(true);
  }

  withdraw(itemId: ItemId, quantity: number): void {
    const result = this.ctx.api.bank("withdraw", { itemId, quantity });
    if (result.ok) this.paintBank(result.value, true);
    else report(result);
    this.refreshInventory(true);
  }

  private depositAll(): void {
    const result = this.ctx.api.bank("depositAll");
    if (result.ok) {
      this.paintBank(result.value, true);
      notify("Deposited all carried items that fit.", "success");
    } else {
      report(result);
    }
    this.refreshInventory(true);
  }

  private turnPage(delta: number): void {
    this.page = Math.max(0, this.page + delta);
    this.refresh(true);
  }

  private openTransferMenu(stack: ItemStack, direction: "deposit" | "withdraw", x: number, y: number): void {
    const run = (quantity: number): void => {
      if (direction === "deposit") this.deposit(stack.itemId, quantity);
      else this.withdraw(stack.itemId, quantity);
    };
    const verb = direction === "deposit" ? "Deposit" : "Withdraw";
    const items: ContextMenuItem[] = [];
    for (const amount of [1, 10, 100]) {
      items.push({
        id: `${direction}-${amount}`,
        label: `${verb} ${amount}`,
        enabled: stack.quantity >= amount || amount === 1,
        reason: stack.quantity >= amount ? undefined : `Only ${formatExact(stack.quantity)} here`,
        onSelect: () => run(amount),
      });
    }
    items.push({
      id: `${direction}-all`,
      label: `${verb} all`,
      enabled: true,
      hint: formatExact(stack.quantity),
      onSelect: () => run(stack.quantity),
    });
    this.ctx.menu.open(x, y, items, { title: itemName(stack.itemId) });
  }
}
