/**
 * The one tooltip in the game.
 *
 * Item facts come from itemTooltipContent, which the generated Codex also uses. This renderer adds
 * live skill levels, equipped-item comparison, weapon charge, and DOM positioning.
 */
import type {
  EquipSlot, EquipmentBonuses, EquippedMagicWeaponView, GameApi, ItemId, SkillId, SpellRow,
} from "../contracts.js";
import { content } from "../content/index.js";
import { createItemIcon } from "./itemIcons.js";
import { itemTooltipContent } from "./itemTooltipContent.js";

export type TooltipContent =
  | {
    kind: "item";
    itemId: ItemId;
    /** Shown as "x 1,234" beside the name. */
    quantity?: number;
    /** Adds the green/red delta against the currently equipped item in the same slot. */
    compareEquipped?: boolean;
    /** Extra lines appended below, e.g. shop prices. */
    footer?: string[];
  }
  | { kind: "text"; title: string; lines: string[]; runeCosts?: SpellRow["runes"] };

const EMPTY_BONUSES: EquipmentBonuses = {
  accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
};

export function liveWeaponChargeFor(
  itemId: ItemId,
  equipped: EquippedMagicWeaponView | null,
): number | null {
  return equipped?.itemId === itemId ? equipped.charges : null;
}

export { formatWeaponChargeLine } from "./itemTooltipContent.js";

const EDGE_MARGIN_PX = 10;
const ANCHOR_GAP_PX = 12;

export class Tooltip {
  readonly element: HTMLElement;
  private anchor: Element | null = null;
  private activeProvider: (() => TooltipContent | null) | null = null;
  private signature = "";
  private readonly detachers: (() => void)[] = [];

  constructor(private readonly api: GameApi) {
    const element = document.createElement("div");
    element.className = "tooltip";
    element.setAttribute("role", "tooltip");
    element.hidden = true;
    this.element = element;
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.element);
  }

  attach(target: Element, provider: () => TooltipContent | null): () => void {
    let attached = true;
    const show = (): void => {
      this.activeProvider = provider;
      const contentSpec = provider();
      if (contentSpec) this.show(contentSpec, target);
      else this.hide();
    };
    const hide = (): void => {
      if (this.anchor === target) this.hide();
    };

    target.addEventListener("pointerenter", show);
    target.addEventListener("pointerleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);

    const detach = (): void => {
      if (!attached) return;
      attached = false;
      target.removeEventListener("pointerenter", show);
      target.removeEventListener("pointerleave", hide);
      target.removeEventListener("focus", show);
      target.removeEventListener("blur", hide);
      if (this.anchor === target) this.hide();
    };
    this.detachers.push(detach);
    return detach;
  }

  show(spec: TooltipContent, anchor: Element): void {
    const signature = this.signatureFor(spec);
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.replaceChildren(...(spec.kind === "item" ? this.renderItem(spec) : this.renderText(spec)));
    }
    this.anchor = anchor;
    this.element.hidden = false;
    this.position(anchor);
  }

  refresh(): void {
    const anchor = this.anchor;
    const provider = this.activeProvider;
    if (!anchor || !provider) return;
    const spec = provider();
    if (spec) this.show(spec, anchor);
    else this.hide();
  }

  hide(): void {
    this.anchor = null;
    this.activeProvider = null;
    this.element.hidden = true;
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.detachers.length = 0;
    this.element.remove();
  }

  private signatureFor(spec: TooltipContent): string {
    if (spec.kind === "text") return `t:${spec.title}:${spec.lines.join("|")}:${JSON.stringify(spec.runeCosts ?? [])}`;
    const skills = this.api.getSkills();
    const levels = (Object.keys(skills) as SkillId[]).map((id) => skills[id].level).join(",");
    const worn = spec.compareEquipped ? this.equippedIn(this.slotOf(spec.itemId)) : null;
    const weapon = content.item(spec.itemId)?.magicWeapon?.charge
      ? this.api.getSpellbook().equippedWeapon
      : null;
    return [
      "i", spec.itemId, spec.quantity ?? 1, spec.compareEquipped ? "cmp" : "-",
      worn ?? "-", levels,
      weapon ? `${weapon.itemId}/${weapon.charges}/${weapon.capacity}` : "weapon=-",
      (spec.footer ?? []).join("|"),
    ].join(":");
  }

  private renderText(spec: Extract<TooltipContent, { kind: "text" }>): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const title = document.createElement("div");
    title.className = "tooltip__title";
    title.textContent = spec.title;
    nodes.push(title);
    for (const line of spec.lines) {
      const body = document.createElement("div");
      body.className = "tooltip__body";
      body.textContent = line;
      nodes.push(body);
    }
    if (spec.runeCosts?.length) {
      const heading = document.createElement("div");
      heading.className = "tooltip__body";
      heading.textContent = "Cost per cast";
      nodes.push(heading);
      for (const rune of spec.runeCosts) {
        const cost = document.createElement("div");
        cost.className = `tooltip__rune-cost${rune.carried < rune.quantity ? " is-short" : ""}`;
        cost.dataset["rune"] = rune.itemId;
        cost.dataset["carried"] = String(rune.carried);
        const icon = createItemIcon(content.item(rune.itemId));
        const label = document.createElement("span");
        label.textContent = `${rune.quantity} ${rune.name}`;
        const carried = document.createElement("span");
        carried.className = "tooltip__rune-carried";
        carried.textContent = `${rune.carried} carried${rune.carried < rune.quantity ? ", missing" : ""}`;
        cost.append(icon, label, carried);
        nodes.push(cost);
      }
    }
    return nodes;
  }

  private renderItem(spec: Extract<TooltipContent, { kind: "item" }>): HTMLElement[] {
    const def = content.item(spec.itemId);
    const worn = def?.equip && spec.compareEquipped ? this.wornBonuses(def.equip.slot, def.id) : null;
    const liveCharge = def?.magicWeapon?.charge
      ? liveWeaponChargeFor(def.id, this.api.getSpellbook().equippedWeapon)
      : null;
    const model = itemTooltipContent(spec.itemId, {
      quantity: spec.quantity,
      skillLevels: this.api.getSkills(),
      ...(worn ? { wornBonuses: worn, comparedSlotLabel: this.slotLabel(def!.equip!.slot) } : {}),
      liveWeaponCharges: liveCharge,
      footer: spec.footer,
    });
    const nodes: HTMLElement[] = [];

    const title = document.createElement("div");
    title.className = "tooltip__title";
    title.textContent = model.title;
    if (model.quantity !== undefined && model.quantity > 1) {
      const count = document.createElement("span");
      count.className = "tooltip__count u-numeric";
      count.textContent = ` ×${model.quantity.toLocaleString("en-US")}`;
      title.appendChild(count);
    }
    nodes.push(title);

    if (!def) {
      const unknown = document.createElement("div");
      unknown.className = "tooltip__body";
      unknown.textContent = model.details[0] ?? "No description available yet.";
      nodes.push(unknown);
      return nodes;
    }

    const meta = document.createElement("div");
    meta.className = "tooltip__tier";
    meta.textContent = model.meta ?? "";
    nodes.push(meta);
    if (model.description) {
      const body = document.createElement("div");
      body.className = "tooltip__body";
      body.textContent = model.description;
      nodes.push(body);
    }
    if (def.equip) nodes.push(this.renderBonuses(model.stats));
    for (const detail of model.details) {
      const line = document.createElement("div");
      line.className = detail === "This orb is not released."
        ? "tooltip__requirement is-unmet"
        : detail.startsWith("Compared with your ") ? "tooltip__body u-faint" : "tooltip__body";
      line.textContent = detail;
      nodes.push(line);
    }
    for (const requirement of model.requirements) {
      const line = document.createElement("div");
      line.className = requirement.met === false ? "tooltip__requirement is-unmet" : "tooltip__requirement";
      line.textContent = requirement.text;
      nodes.push(line);
    }
    const value = document.createElement("div");
    value.className = "tooltip__body u-numeric";
    value.textContent = model.value ?? "";
    nodes.push(value);
    for (const footer of model.footer) {
      const line = document.createElement("div");
      line.className = "tooltip__body";
      line.textContent = footer;
      nodes.push(line);
    }
    return nodes;
  }

  private renderBonuses(stats: ReturnType<typeof itemTooltipContent>["stats"]): HTMLElement {
    const table = document.createElement("div");
    table.className = "tooltip__stats";
    for (const stat of stats) {
      const name = document.createElement("span");
      name.textContent = stat.label;
      const amount = document.createElement("span");
      amount.className = "tooltip__stat-value u-numeric";
      amount.textContent = stat.value > 0 ? `+${stat.value}` : String(stat.value);
      if (stat.delta !== undefined) {
        const change = document.createElement("span");
        change.className = stat.delta > 0 ? "tooltip__delta-up" : stat.delta < 0 ? "tooltip__delta-down" : "u-faint";
        change.textContent = stat.delta === 0 ? " (=)" : ` (${stat.delta > 0 ? "+" : ""}${stat.delta})`;
        amount.appendChild(change);
      }
      table.append(name, amount);
    }
    if (table.childElementCount === 0) {
      const none = document.createElement("span");
      none.className = "u-faint";
      none.textContent = "No stat bonuses";
      table.appendChild(none);
    }
    return table;
  }

  private slotOf(itemId: ItemId): EquipSlot | null {
    return content.item(itemId)?.equip?.slot ?? null;
  }

  private equippedIn(slot: EquipSlot | null): ItemId | null {
    if (!slot) return null;
    return this.api.getEquipment().slots[slot]?.itemId ?? null;
  }

  private wornBonuses(slot: EquipSlot, hoveredId: ItemId): EquipmentBonuses | null {
    const equipped = this.api.getEquipment().slots[slot];
    if (!equipped) return EMPTY_BONUSES;
    if (equipped.itemId === hoveredId) return null;
    return content.item(equipped.itemId)?.equip?.bonuses ?? EMPTY_BONUSES;
  }

  private slotLabel(slot: EquipSlot): string {
    return slot.replace(/([A-Z])/g, " $1").replace(/(\d)/g, " $1").toLowerCase().trim();
  }

  private position(anchor: Element): void {
    const target = anchor.getBoundingClientRect();
    this.element.style.left = "0px";
    this.element.style.top = "0px";
    const card = this.element.getBoundingClientRect();
    let left = target.right + ANCHOR_GAP_PX;
    if (left + card.width + EDGE_MARGIN_PX > window.innerWidth) {
      left = target.left - card.width - ANCHOR_GAP_PX;
    }
    if (left < EDGE_MARGIN_PX) left = EDGE_MARGIN_PX;
    let top = target.top;
    if (top + card.height + EDGE_MARGIN_PX > window.innerHeight) {
      top = window.innerHeight - card.height - EDGE_MARGIN_PX;
    }
    if (top < EDGE_MARGIN_PX) top = EDGE_MARGIN_PX;
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
  }
}
