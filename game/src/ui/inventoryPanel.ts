import { jewelrySlots } from '../content/jewelry.js';
import { EQUIPMENT_SLOT_LABELS } from './equipmentSlotGrid.js';
import type { EquipSlot } from '../contracts.js';
import { sendGameCommand } from "../api/commands.js";
import { PanelFrame } from "./panelFrame.js";
/**
 * The 28-slot inventory, 4 across and 7 down, exactly as the PRD lays it out.
 *
 * Left click runs the item's obvious action (wear it if it is equipment, otherwise use it), right
 * click opens the shared context menu with every action listed — including the ones that are not
 * available yet, greyed with the reason, because the same rule that governs the world menu governs
 * this one: hiding what you cannot do is how a game becomes unlearnable.
 *
 * Hovering an item shows the shared tooltip with the stat delta against what is currently worn.
 *
 * Gold is an item that never takes a slot, so the footer under the grid is where it is read.
 */
import type { InventorySlot, ItemId, ItemStack } from "../contracts.js";
import { CAMPFIRE_FUELS } from "../content/gatheringProductionTiers.js";
import { CURRENCY_ITEM_ID } from "../content/items.js";
import { createItemIcon } from "./itemIcons.js";
import { notify } from "./contextMenu.js";
import { skillRequirementsLabel } from "./displayLabels.js";
import type { ContextMenuItem } from "./contextMenu.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { INVENTORY_COLUMNS, INVENTORY_SLOTS, formatExact, formatQuantity, installRovingGrid, itemDef, itemName, paintSlot, report, stackSignature } from "./panels.js";

export class InventoryPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly cells: HTMLButtonElement[] = [];
  private slots: (InventorySlot | null)[] = [];
  private signature = "";
  private readonly goldRow: HTMLElement;
  private readonly goldAmount: HTMLElement;
  private gold = -1;

  constructor(private readonly ctx: UiContext) {
    this.frame = new PanelFrame({
      id: "inventory",
      title: "Inventory",
      key: "i",
      keyLabel: "Inventory",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    const grid = document.createElement("div");
    grid.className = "slot-grid inv-grid";
    grid.style.setProperty("--slot-columns", String(INVENTORY_COLUMNS));
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Inventory slots");

    for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
      grid.appendChild(this.buildCell(index));
    }
    installRovingGrid(grid, INVENTORY_COLUMNS);

    this.frame.body.appendChild(grid);

    // Outside the scrolling body, so the balance stays in view when a short phone panel scrolls.
    this.goldRow = document.createElement("div");
    this.goldRow.className = "panel__footer inv-gold";
    const goldIcon = document.createElement("span");
    goldIcon.className = "inv-gold__icon";
    goldIcon.appendChild(createItemIcon(itemDef(CURRENCY_ITEM_ID)));
    this.goldAmount = document.createElement("span");
    this.goldAmount.className = "inv-gold__amount u-numeric";
    this.goldRow.append(goldIcon, this.goldAmount);
    this.ctx.tooltip.attach(this.goldRow, () => ({ kind: "item", itemId: CURRENCY_ITEM_ID, quantity: Math.max(0, this.gold) }));
    this.frame.root.appendChild(this.goldRow);
    this.paintGold(0);
  }

  refresh(force = false): void {
    this.paintGold(this.ctx.api.getCurrency());
    const inventory = this.ctx.api.getInventory();
    const slots: (InventorySlot | null)[] = [];
    for (let index = 0; index < INVENTORY_SLOTS; index += 1) slots[index] = inventory.slots[index] ?? null;

    const signature = slots.map(stackSignature).join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.slots = slots;

    for (let index = 0; index < INVENTORY_SLOTS; index += 1) {
      const cell = this.cells[index];
      if (cell) paintSlot(cell, slots[index] ?? null);
    }

    const free = inventory.freeSlots;
    this.frame.setSubtitle(free === 0 ? "full" : `${free}/${INVENTORY_SLOTS} free`);
  }

  dispose(): void {
    this.frame.dispose();
  }

  private paintGold(gold: number): void {
    if (gold === this.gold) return;
    this.gold = gold;
    this.goldAmount.textContent = `${formatQuantity(gold)} gold`;
    this.goldRow.setAttribute("aria-label", `${formatExact(gold)} gold`);
  }

  /** The stack in a slot right now, for the tooltip and the menu. */
  private stackAt(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  private buildCell(index: number): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot is-empty";
    cell.dataset["slotIndex"] = String(index);
    cell.tabIndex = index === 0 ? 0 : -1;
    cell.setAttribute("aria-label", "Empty slot");

    cell.addEventListener("click", () => this.activate(index));
    cell.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openMenu(index, event.clientX, event.clientY);
    });
    // Shift+F10 and the menu key are the keyboard route to a context menu everywhere else in
    // desktop software; the inventory should not be the exception.
    cell.addEventListener("keydown", (event) => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      event.preventDefault();
      const rect = cell.getBoundingClientRect();
      this.openMenu(index, rect.left + rect.width / 2, rect.bottom);
    });

    this.ctx.tooltip.attach(cell, () => {
      const stack = this.stackAt(index);
      if (!stack) return null;
      return { kind: "item", itemId: stack.itemId, quantity: stack.quantity, compareEquipped: true };
    });

    this.cells.push(cell);
    return cell;
  }

  /** Left click: wear it if it is equipment, otherwise use it. */
  private activate(index: number): void {
    const stack = this.stackAt(index);
    if (!stack) return;
    if (itemDef(stack.itemId)?.equip) this.equip(stack.itemId);
    else this.use(stack.itemId);
  }

  private async use(itemId: ItemId): Promise<void> {
    const result = await sendGameCommand(this.ctx.api, "useItem", itemId);
    if (result.ok) notify(result.value.effect, "info");
    else report(result);
    this.ctx.refresh();
  }

  private async equip(itemId: ItemId, targetSlot?: EquipSlot): Promise<void> {
    const result = await sendGameCommand(this.ctx.api, "equipItem", itemId, targetSlot);
    if (result.ok) notify(`Equipped ${itemName(itemId)}.`, "success");
    else report(result);
    this.ctx.refresh();
  }

  private async buildFire(itemId: ItemId): Promise<void> {
    const result = await sendGameCommand(this.ctx.api, "buildCampfire", itemId);
    if (result.ok) {
      notify(
        `Started building a ${itemName(itemId)} fire · ${Math.round(result.value.lifetimeMs / 1_000)}s lifetime.`,
        "success",
      );
    } else {
      report(result);
    }
    this.ctx.refresh();
  }

  private openMenu(index: number, clientX: number, clientY: number): void {
    const stack = this.stackAt(index);
    if (!stack) return;
    const def = itemDef(stack.itemId);
    const name = itemName(stack.itemId);
    const items: ContextMenuItem[] = [];

    if (def?.equip) {
      items.push({
        id: "equip",
        label: `Equip ${name}`,
        enabled: true,
        onSelect: () => this.equip(stack.itemId),
      });
    }

    if (def?.equip && jewelrySlots(def.equip.slot).length > 1) {
      for (const slot of jewelrySlots(def.equip.slot)) items.push({
        id: `equip-${slot}`, label: `Equip in ${EQUIPMENT_SLOT_LABELS[slot]}`, enabled: true,
        onSelect: () => this.equip(stack.itemId, slot),
      });
    }

    const fireFuel = CAMPFIRE_FUELS.find((fuel) => fuel.logItemId === stack.itemId);
    if (fireFuel) {
      const player = this.ctx.api.getPlayer();
      const activity = this.ctx.api.getActivity();
      const unavailableReason = player.dead
        ? "Cannot build while dead"
        : player.inCombat
          ? "Cannot build during combat"
          : activity
            ? "Finish or stop the current activity first"
            : undefined;
      items.push({
        id: "build-fire",
        label: "Build fire",
        enabled: unavailableReason === undefined,
        reason: unavailableReason,
        hint: `${Math.round(fireFuel.lifetimeMs / 1_000)}s`,
        onSelect: () => this.buildFire(stack.itemId),
      });
    }

    items.push({
      id: "use",
      label: def?.food ? `Eat ${name}` : def?.potion ? `Drink ${name}` : `Use ${name}`,
      enabled: true,
      onSelect: () => this.use(stack.itemId),
    });

    if (this.ctx.isBankOpen()) {
      const amounts: number[] = [1, 10];
      for (const amount of amounts) {
        if (stack.quantity < amount) continue;
        items.push({
          id: `deposit-${amount}`,
          label: `Deposit ${amount}`,
          enabled: true,
          onSelect: () => this.ctx.deposit(stack.itemId, amount),
        });
      }
      items.push({
        id: "deposit-all",
        label: "Deposit all",
        enabled: true,
        hint: formatExact(stack.quantity),
        onSelect: () => this.ctx.deposit(stack.itemId, stack.quantity),
      });
    }

    if (this.ctx.isShopOpen()) {
      items.push({
        id: "sell-1",
        label: `Sell ${name}`,
        enabled: true,
        onSelect: () => this.ctx.sell(stack.itemId, 1),
      });
      items.push({
        id: "sell-all",
        label: "Sell all",
        enabled: true,
        hint: formatExact(stack.quantity),
        onSelect: () => this.ctx.sell(stack.itemId, stack.quantity),
      });
    }

    for (const quantity of [...new Set([1, stack.quantity])]) items.push({
      id: `drop-${quantity}`, label: quantity === 1 ? `Drop ${name}` : `Drop all ${name} (${quantity})`, enabled: true,
      onSelect: () => { void this.ctx.api.submit?.({ method: "dropItem", args: [stack.itemId, quantity] }).then(outcome => {
        if (outcome.status !== "accepted") notify(outcome.error.message, "error");
      }).catch(() => notify("Drop outcome unknown. Reconnect before retrying.", "error")); },
    });

    items.push({
      id: "examine",
      label: "Examine",
      enabled: true,
      onSelect: () => notify(def?.description ?? `${name}. No description yet.`, "info"),
    });

    this.ctx.menu.open(clientX, clientY, items, {
      title: name,
      subtitle: def ? [def.category, skillRequirementsLabel(def.equip?.requires)].filter(Boolean).join(" · ") : undefined,
    });
  }
}
