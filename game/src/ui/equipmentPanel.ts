import { PanelFrame } from "./panelFrame.js";
/**
 * The nine equipment slots, laid out around a silhouette, with the summed bonuses underneath.
 *
 * The panel is the second half of the PRD's readability contract for gear. The first half lives in
 * the tooltip: hovering an inventory item shows the green/red delta against whatever is worn in
 * that slot. This panel is where the player checks the total that delta moves.
 */
import type {
  EquipSlot, EquipmentBonuses, EquippedMagicWeaponView, FeatureLabApi, ItemId, ItemStack,
} from "../contracts.js";
import { EQUIP_SLOTS } from "../contracts.js";
import { inferEquipmentSets } from "../content/equipmentSets.js";
import { notify } from "./contextMenu.js";
import type { ContextMenuItem } from "./contextMenu.js";
import { EquipmentSlotGrid, EQUIPMENT_SLOT_LABELS } from "./equipmentSlotGrid.js";
import { createItemIcon } from "./itemIcons.js";
import type { ManagedPanel, UiContext } from "./panels.js";
import { itemDef, itemName, report, stackSignature } from "./panels.js";

const BONUS_ROWS: readonly [keyof EquipmentBonuses, string][] = [
  ["accuracy", "Accuracy"],
  ["power", "Power"],
  ["armour", "Armour"],
  ["magicAccuracy", "Magic accuracy"],
  ["magicPower", "Magic power"],
  ["magicArmour", "Magic armour"],
  ["vitality", "Vitality"],
];

/** Compact enough for the main-hand slot while keeping current and maximum values exact. */
export function formatWeaponCharge(charges: number, capacity: number): string {
  const current = Math.max(0, Math.floor(charges)).toLocaleString("en-US");
  const maximum = Math.max(0, Math.floor(capacity)).toLocaleString("en-US");
  return `${current} / ${maximum}`;
}

function paintWeaponCharge(
  cell: HTMLButtonElement,
  itemId: ItemId | null,
  weapon: EquippedMagicWeaponView | null,
): void {
  const existing = cell.querySelector<HTMLElement>(".slot__charge");
  if (!itemId || !weapon || weapon.itemId !== itemId) {
    existing?.remove();
    delete cell.dataset["weaponCharge"];
    return;
  }

  const text = formatWeaponCharge(weapon.charges, weapon.capacity);
  let label = existing;
  if (!label) {
    label = document.createElement("span");
    label.className = "slot__charge u-numeric";
    cell.appendChild(label);
  }
  if (label.textContent !== text) label.textContent = text;
  cell.dataset["weaponCharge"] = `${weapon.charges}/${weapon.capacity}`;
  cell.setAttribute(
    "aria-label",
    `${itemName(itemId)}, ${weapon.charges.toLocaleString("en-US")} of ${weapon.capacity.toLocaleString("en-US")} charges`,
  );
}

export class EquipmentPanel implements ManagedPanel {
  readonly frame: PanelFrame;
  private readonly slotGrid: EquipmentSlotGrid;
  private readonly totals = new Map<keyof EquipmentBonuses, HTMLElement>();
  private readonly sets = document.createElement("section");
  private worn: Record<EquipSlot, ItemStack | null> | null = null;
  private signature = "";
  private picker: HTMLElement | null = null;
  private pickerItems: HTMLElement | null = null;
  private pickerTitle: HTMLElement | null = null;
  private selectedSlot: EquipSlot | null = null;

  constructor(private readonly ctx: UiContext, private readonly featureLab?: FeatureLabApi) {
    this.frame = new PanelFrame({
      id: "equipment",
      title: "Equipment",
      key: "e",
      keyLabel: "Equipment",
      registry: ctx.registry,
      placement: { right: "10px", bottom: "48px", width: "190px", maxHeight: "calc(100vh - 110px)" },
      group: "side",
      onOpen: () => this.refresh(true),
    });

    this.slotGrid = new EquipmentSlotGrid({
      resolveItem: itemDef,
      onActivate: (slot) => featureLab ? this.openPicker(slot) : this.unequip(slot),
      onContextMenu: (slot, _cell, event) => {
        event.preventDefault();
        this.openMenu(slot, event.clientX, event.clientY);
      },
    });
    if (featureLab) this.slotGrid.root.classList.add("equip-figure--lab");
    for (const slot of EQUIP_SLOTS) {
      const cell = this.slotGrid.cell(slot);
      this.ctx.tooltip.attach(cell, () => {
        const stack = this.worn?.[slot] ?? null;
        if (!stack) {
          return {
            kind: "text",
            title: EQUIPMENT_SLOT_LABELS[slot],
            lines: ["Nothing worn in this slot."],
          };
        }
        return { kind: "item", itemId: stack.itemId, quantity: stack.quantity };
      });
    }
    this.frame.body.appendChild(this.slotGrid.root);

    const totals = document.createElement("dl");
    totals.className = "equip-totals";
    for (const [key, label] of BONUS_ROWS) {
      const term = document.createElement("dt");
      term.textContent = label;
      const value = document.createElement("dd");
      value.className = "u-numeric";
      value.textContent = "0";
      totals.append(term, value);
      this.totals.set(key, value);
    }
    this.frame.body.appendChild(totals);
    this.sets.className = "equip-sets";
    this.sets.setAttribute("aria-label", "Armour sets");
    this.frame.body.appendChild(this.sets);

    if (featureLab) {
      const picker = document.createElement("section");
      picker.className = "equip-chooser";
      picker.hidden = true;
      const title = document.createElement("strong");
      title.className = "equip-chooser__title";
      const items = document.createElement("div");
      items.className = "equip-chooser__items";
      picker.append(title, items);
      this.frame.body.appendChild(picker);
      this.picker = picker;
      this.pickerTitle = title;
      this.pickerItems = items;
    }
  }

  refresh(force = false): void {
    const equipment = this.ctx.api.getEquipment();
    const equippedWeapon = this.ctx.api.getSpellbook().equippedWeapon;
    const signature = [
      ...EQUIP_SLOTS.map((slot) => `${slot}=${stackSignature(equipment.slots[slot])}`),
      ...BONUS_ROWS.map(([key]) => `${key}=${equipment.totals[key]}`),
      `weapon=${equippedWeapon?.itemId ?? "-"}:${equippedWeapon?.charges ?? "-"}:${equippedWeapon?.capacity ?? "-"}`,
    ].join("|");
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.worn = equipment.slots;

    const filled = EQUIP_SLOTS.filter((slot) => equipment.slots[slot] !== null).length;
    this.slotGrid.render(equipment.slots);
    const mainHand = equipment.slots.mainHand;
    paintWeaponCharge(this.slotGrid.cell("mainHand"), mainHand?.itemId ?? null, equippedWeapon);

    for (const [key] of BONUS_ROWS) {
      const node = this.totals.get(key);
      if (!node) continue;
      const value = equipment.totals[key];
      node.textContent = value > 0 ? `+${value}` : String(value);
      node.classList.toggle("is-zero", value === 0);
    }

    this.frame.setSubtitle(`${filled}/${EQUIP_SLOTS.length} worn`);
    this.sets.replaceChildren();
    for (const progress of inferEquipmentSets(equipment.slots)) {
      const heading = document.createElement("strong");
      heading.textContent = `${progress.set.name} set · ${progress.pieces}/5 pieces`;
      const list = document.createElement("ul");
      for (const threshold of progress.set.thresholds) {
        const row = document.createElement("li");
        const active = progress.pieces >= threshold.pieces;
        row.className = active ? "u-positive" : "u-dim";
        const bonuses = BONUS_ROWS.filter(([key]) => threshold.bonuses[key] !== 0)
          .map(([key, label]) => `+${threshold.bonuses[key]} ${label.toLowerCase()}`).join(", ");
        row.textContent = `${threshold.pieces} pieces: ${bonuses}${active ? " (active)" : ""}`;
        list.appendChild(row);
      }
      this.sets.append(heading, list);
    }
    this.sets.hidden = !this.sets.childElementCount;
    if (this.selectedSlot) this.openPicker(this.selectedSlot);
    // Keep a hovered weapon card open while its charge changes.
    this.ctx.tooltip.refresh();
  }

  dispose(): void {
    this.frame.dispose();
  }

  private unequip(slot: EquipSlot): void {
    if (!this.worn?.[slot]) return;
    const result = this.ctx.api.unequipItem(slot);
    if (result.ok) notify(`Removed ${itemName(result.value.itemId)}.`, "info");
    else report(result);
    this.ctx.refresh();
  }

  /** Lab-only setup picker inside the actual production Equipment panel. */
  private openPicker(slot: EquipSlot): void {
    if (!this.featureLab || !this.picker || !this.pickerTitle || !this.pickerItems) return;
    this.selectedSlot = slot;
    const group = this.featureLab.getCatalog().equipment.find((candidate) => candidate.slot === slot);
    const current = this.ctx.api.getEquipment().slots[slot]?.itemId ?? null;
    this.pickerTitle.textContent = `${EQUIPMENT_SLOT_LABELS[slot]}: choose equipment`;
    this.pickerItems.replaceChildren(
      this.choice(slot, null, "None (empty slot)", current),
      ...(group?.items ?? []).map((item) => this.choice(slot, item.id, item.label, current)),
    );
    this.picker.hidden = false;
    for (const [candidate, cell] of this.slotGrid.cells) {
      cell.classList.toggle("is-selected", candidate === slot);
    }
  }

  private choice(slot: EquipSlot, itemId: ItemId | null, label: string, current: ItemId | null): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "equip-chooser__choice";
    button.dataset["equipmentItem"] = itemId ?? "";
    button.classList.toggle("is-selected", itemId === current);
    button.setAttribute("aria-pressed", String(itemId === current));
    if (itemId) button.appendChild(createItemIcon(itemDef(itemId)));
    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);
    button.addEventListener("click", () => {
      void this.featureLab!.equipPlayer(slot, itemId)
        .then(() => this.ctx.refresh())
        .catch((cause: unknown) => notify(cause instanceof Error ? cause.message : String(cause), "error"));
    });
    return button;
  }

  private openMenu(slot: EquipSlot, clientX: number, clientY: number): void {
    const stack = this.worn?.[slot] ?? null;
    const label = EQUIPMENT_SLOT_LABELS[slot];
    const items: ContextMenuItem[] = [];

    if (stack) {
      const def = itemDef(stack.itemId);
      items.push({
        id: "unequip",
        label: `Remove ${itemName(stack.itemId)}`,
        enabled: true,
        onSelect: () => this.unequip(slot),
      });
      items.push({
        id: "examine",
        label: "Examine",
        enabled: true,
        onSelect: () => notify(def?.description ?? itemName(stack.itemId), "info"),
      });
    } else {
      items.push({ id: "empty", label: "Nothing worn here", enabled: false, reason: label });
    }

    this.ctx.menu.open(clientX, clientY, items, { title: label });
  }
}
