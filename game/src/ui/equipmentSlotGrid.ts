/**
 * The production worn-equipment figure without panel, store, tooltip, or menu dependencies.
 *
 * The game panel and the isolated feature lab deliberately share this DOM and icon renderer. The
 * owner supplies current equipment plus interaction callbacks; it remains responsible for what a
 * click means (unequip in the game, choose an appearance in the lab).
 */
import {
  EQUIP_SLOTS,
  type EquipSlot,
  type ItemDef,
  type ItemId,
  type ItemStack,
} from "../contracts.js";
import { createItemIcon } from "./itemIcons.js";

export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipSlot, string>> = {
  head: "Head",
  body: "Body",
  legs: "Legs",
  feet: "Feet",
  hands: "Hands",
  mainHand: "Main",
  offHand: "Off",
  accessory1: "Ring 1",
  ring2: "Ring 2",
  accessory2: "Earring 1",
  earring2: "Earring 2",
};

/** Row, column. A three-wide grid with the body down the middle, arms either side. */
export const EQUIPMENT_SLOT_CELLS: Readonly<Record<EquipSlot, readonly [number, number]>> = {
  head: [1, 2],
  accessory1: [1, 3],
  ring2: [1, 1],
  mainHand: [2, 1],
  body: [2, 2],
  offHand: [2, 3],
  hands: [3, 1],
  legs: [3, 2],
  accessory2: [3, 3],
  earring2: [4, 3],
  feet: [4, 2],
};

/** A lab may hold only item ids; the game supplies complete one-item stacks. */
export type EquipmentSlotValue = ItemStack | ItemId | null;
export type EquipmentSlotState = Readonly<Partial<Record<EquipSlot, EquipmentSlotValue>>>;

export interface EquipmentSlotGridOptions {
  /** Resolve canonical display data without making this component depend on the content registry. */
  resolveItem(itemId: ItemId): ItemDef | undefined;
  onActivate?(slot: EquipSlot, cell: HTMLButtonElement, event: MouseEvent): void;
  onContextMenu?(slot: EquipSlot, cell: HTMLButtonElement, event: MouseEvent): void;
}

/**
 * Shared equipment figure/grid. It intentionally owns no panel chrome and reads no game state.
 */
export class EquipmentSlotGrid {
  readonly root: HTMLElement;
  readonly grid: HTMLElement;
  private readonly cellsBySlot = new Map<EquipSlot, HTMLButtonElement>();

  constructor(private readonly options: EquipmentSlotGridOptions) {
    const figure = document.createElement("div");
    figure.className = "equip-figure";

    const silhouette = document.createElement("div");
    silhouette.className = "equip-silhouette";
    silhouette.setAttribute("aria-hidden", "true");
    figure.appendChild(silhouette);

    const grid = document.createElement("div");
    grid.className = "equip-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Worn equipment");

    for (const slot of EQUIP_SLOTS) {
      const cell = this.buildCell(slot);
      const position = EQUIPMENT_SLOT_CELLS[slot];
      cell.style.gridRow = String(position[0]);
      cell.style.gridColumn = String(position[1]);
      grid.appendChild(cell);
    }

    figure.appendChild(grid);
    this.root = figure;
    this.grid = grid;
  }

  /** Stable cells for tooltip attachment, focus management, and lab selection state. */
  get cells(): ReadonlyMap<EquipSlot, HTMLButtonElement> {
    return this.cellsBySlot;
  }

  cell(slot: EquipSlot): HTMLButtonElement {
    const cell = this.cellsBySlot.get(slot);
    if (!cell) throw new Error(`Equipment slot cell was not built: ${slot}`);
    return cell;
  }

  render(equipment: EquipmentSlotState): void {
    for (const slot of EQUIP_SLOTS) this.paintCell(slot, equipment[slot] ?? null);
  }

  private buildCell(slot: EquipSlot): HTMLButtonElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "slot slot--equip is-empty";
    cell.dataset["equipSlot"] = slot;
    cell.setAttribute("aria-label", `${EQUIPMENT_SLOT_LABELS[slot]}: empty`);
    cell.addEventListener("click", (event) => this.options.onActivate?.(slot, cell, event));
    cell.addEventListener("contextmenu", (event) => this.options.onContextMenu?.(slot, cell, event));
    this.cellsBySlot.set(slot, cell);
    return cell;
  }

  private paintCell(slot: EquipSlot, value: EquipmentSlotValue): void {
    const stack = typeof value === "string" ? { itemId: value, quantity: 1 } : value;
    const emptyLabel = EQUIPMENT_SLOT_LABELS[slot];
    const signature = `${stack ? `${stack.itemId}:${stack.quantity}` : "-"}|${emptyLabel}`;
    const cell = this.cell(slot);
    if (cell.dataset["sig"] === signature) return;
    cell.dataset["sig"] = signature;
    cell.replaceChildren();

    if (!stack) {
      cell.classList.add("is-empty");
      delete cell.dataset["item"];
      cell.setAttribute("aria-label", `${emptyLabel}: empty`);
      const label = document.createElement("span");
      label.className = "slot__label";
      label.textContent = emptyLabel;
      cell.appendChild(label);
      return;
    }

    cell.classList.remove("is-empty");
    cell.dataset["item"] = stack.itemId;
    const definition = this.options.resolveItem(stack.itemId);

    const glyph = document.createElement("span");
    glyph.className = "slot__glyph";
    glyph.appendChild(createItemIcon(definition));
    cell.appendChild(glyph);

    if (stack.quantity > 1) {
      const count = document.createElement("span");
      count.className = "slot__count";
      count.textContent = formatQuantity(stack.quantity);
      cell.appendChild(count);
    }

    const name = definition?.name ?? prettifyId(stack.itemId);
    cell.setAttribute(
      "aria-label",
      stack.quantity > 1 ? `${name}, ${formatExact(stack.quantity)}` : name,
    );
  }
}

/** Thousands separators up to five digits, then k/m; mirrors other production item slots. */
function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const quantity = Math.floor(value);
  if (quantity < 100_000) return quantity.toLocaleString("en-US");
  if (quantity < 10_000_000) return `${Math.floor(quantity / 1000).toLocaleString("en-US")}k`;
  return `${Math.floor(quantity / 1_000_000).toLocaleString("en-US")}m`;
}

function formatExact(value: number): string {
  return Math.floor(value).toLocaleString("en-US");
}

function prettifyId(id: string): string {
  const words = id.split(/[_\-.\s]+/).filter(Boolean);
  if (words.length === 0) return id;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
