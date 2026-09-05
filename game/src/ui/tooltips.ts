/**
 * The one tooltip in the game.
 *
 * Every panel that shows an item hands this the item id and an anchor element; nothing else builds
 * its own hover card. That matters for the PRD's readability contract, which is specific about what
 * an item tooltip must say: name, category, description, requirements in plain text with the
 * reason when they are unmet, value, and — for equipment — the stat delta against what is currently
 * worn. A second tooltip implementation somewhere would drift off that list within a round.
 *
 * The card is rendered from a signature-compared descriptor, positioned to stay on screen, and
 * never given pointer events, because it sits under the cursor.
 */
import type {
  EquipSlot, EquipmentBonuses, EquippedMagicWeaponView, GameApi, ItemDef, ItemId, SkillId,
  SpellElement,
} from "../contracts.js";
import { content } from "../content/index.js";
import { SKILLS } from "../content/skills.js";

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
  | { kind: "text"; title: string; lines: string[] };

const BONUS_LABELS: readonly [keyof EquipmentBonuses, string][] = [
  ["accuracy", "Accuracy"],
  ["power", "Power"],
  ["armour", "Armour"],
  ["magicAccuracy", "Magic accuracy"],
  ["magicPower", "Magic power"],
  ["magicArmour", "Magic armour"],
  ["vitality", "Vitality"],
];

const EMPTY_BONUSES: EquipmentBonuses = {
  accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
};

const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Air",
  water: "Water",
  earth: "Earth",
  fire: "Fire",
};

export function liveWeaponChargeFor(
  itemId: ItemId,
  equipped: EquippedMagicWeaponView | null,
): number | null {
  return equipped?.itemId === itemId ? equipped.charges : null;
}

export function formatWeaponChargeLine(
  element: SpellElement,
  capacity: number,
  charges: number | null,
): string {
  const name = ELEMENT_LABELS[element];
  const maximum = Math.max(0, Math.floor(capacity)).toLocaleString("en-US");
  if (charges === null) return `${name} weapon · ${maximum} charge capacity.`;
  const current = Math.max(0, Math.min(capacity, Math.floor(charges))).toLocaleString("en-US");
  return `${name} weapon · ${current} / ${maximum} charges remaining.`;
}

const EDGE_MARGIN_PX = 10;
const ANCHOR_GAP_PX = 12;

export class Tooltip {
  readonly element: HTMLElement;
  private anchor: HTMLElement | null = null;
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

  /**
   * Wires hover and focus on an element to a content provider. The provider is called on enter, so
   * a slot that changed since mount still describes what is in it now.
   */
  attach(target: HTMLElement, provider: () => TooltipContent | null): void {
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

    this.detachers.push(() => {
      target.removeEventListener("pointerenter", show);
      target.removeEventListener("pointerleave", hide);
      target.removeEventListener("focus", show);
      target.removeEventListener("blur", hide);
    });
  }

  show(spec: TooltipContent, anchor: HTMLElement): void {
    const signature = this.signatureFor(spec);
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.replaceChildren(...(spec.kind === "item" ? this.renderItem(spec) : this.renderText(spec)));
    }
    this.anchor = anchor;
    this.element.hidden = false;
    this.position(anchor);
  }

  /** Repaints the open card from its provider without requiring the pointer to leave and re-enter. */
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

  // ----------------------------------------------------------------- render

  private signatureFor(spec: TooltipContent): string {
    if (spec.kind === "text") return `t:${spec.title}:${spec.lines.join("|")}`;
    // Skill levels are in the signature because a level-up changes a requirement from red to grey.
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

  private renderText(spec: { title: string; lines: string[] }): HTMLElement[] {
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
    return nodes;
  }

  private renderItem(spec: Extract<TooltipContent, { kind: "item" }>): HTMLElement[] {
    const def = content.item(spec.itemId);
    const nodes: HTMLElement[] = [];

    const title = document.createElement("div");
    title.className = "tooltip__title";
    title.textContent = def?.name ?? spec.itemId;
    if (spec.quantity !== undefined && spec.quantity > 1) {
      const count = document.createElement("span");
      count.className = "tooltip__count u-numeric";
      count.textContent = ` ×${spec.quantity.toLocaleString("en-US")}`;
      title.appendChild(count);
    }
    nodes.push(title);

    if (!def) {
      // Content for this id has not been registered yet. Say so rather than rendering a blank card.
      const unknown = document.createElement("div");
      unknown.className = "tooltip__body";
      unknown.textContent = "No description available yet.";
      nodes.push(unknown);
      return nodes;
    }

    const meta = document.createElement("div");
    meta.className = "tooltip__tier";
    meta.textContent = `${def.category}${def.stackable ? " · stacks" : ""}`;
    nodes.push(meta);

    if (def.description) {
      const body = document.createElement("div");
      body.className = "tooltip__body";
      body.textContent = def.description;
      nodes.push(body);
    }

    if (def.equip) {
      const worn = spec.compareEquipped ? this.wornBonuses(def.equip.slot, def.id) : null;
      nodes.push(this.renderBonuses(def.equip.bonuses, worn));
      if (def.equip.attackSpeedMs !== undefined) {
        const speed = document.createElement("div");
        speed.className = "tooltip__body u-numeric";
        speed.textContent = def.magicWeapon
          ? `Cast cadence ${(def.equip.attackSpeedMs / 1000).toFixed(1)} s`
          : `Attack speed ${(def.equip.attackSpeedMs / 1000).toFixed(1)} s`;
        nodes.push(speed);
      }
      if (def.magicWeapon) {
        const role = document.createElement("div");
        role.className = "tooltip__body";
        role.textContent = def.magicWeapon.kind === "wand"
          ? "Wand: one-handed, faster casts, weaker hits."
          : "Staff: two-handed, slower casts, stronger hits.";
        nodes.push(role);
      }
      const charge = def.magicWeapon?.charge;
      if (charge) {
        const live = liveWeaponChargeFor(def.id, this.api.getSpellbook().equippedWeapon);
        const chargeLine = document.createElement("div");
        chargeLine.className = "tooltip__body u-numeric";
        chargeLine.textContent = formatWeaponChargeLine(charge.element, charge.capacity, live);
        nodes.push(chargeLine);

        const recharge = document.createElement("div");
        recharge.className = "tooltip__body";
        const essence = content.item(charge.rechargeItemId)?.name ?? charge.rechargeItemId;
        recharge.textContent =
          `${charge.rechargeCost.toLocaleString("en-US")} ${essence} at an Essence Altar refills it.`;
        nodes.push(recharge);
      }
      if (worn) {
        const note = document.createElement("div");
        note.className = "tooltip__body u-faint";
        note.textContent = `Compared with your ${this.slotLabel(def.equip.slot)}.`;
        nodes.push(note);
      }
    }

    if (def.orb) {
      const element = ELEMENT_LABELS[def.orb.element];
      const craftedCharge = content.allItems()
        .find((candidate) => candidate.magicWeapon?.charge?.orbItemId === def.id)
        ?.magicWeapon?.charge;
      const firstDrop = document.createElement("div");
      firstDrop.className = "tooltip__body";
      firstDrop.textContent =
        `Craft this into a ${element} wand or staff. The finished weapon starts with `
        + `${(craftedCharge?.initialCharges ?? 1000).toLocaleString("en-US")} charges.`;
      nodes.push(firstDrop);

      if (!def.orb.released) {
        const unreleased = document.createElement("div");
        unreleased.className = "tooltip__requirement is-unmet";
        unreleased.textContent = "This orb is not released.";
        nodes.push(unreleased);
      }
    }

    if (def.food) {
      const heal = document.createElement("div");
      heal.className = "tooltip__body";
      heal.textContent = `Heals ${def.food.healAmount} health.`;
      nodes.push(heal);
    }

    if (def.tool) {
      const tool = document.createElement("div");
      tool.className = "tooltip__body";
      tool.textContent = `${SKILLS[def.tool.skill].name} tool, +${def.tool.gatherBonus} effective levels.`;
      nodes.push(tool);
    }

    for (const requirement of this.requirementLines(def)) {
      const line = document.createElement("div");
      line.className = requirement.met ? "tooltip__requirement" : "tooltip__requirement is-unmet";
      line.textContent = requirement.text;
      nodes.push(line);
    }

    const value = document.createElement("div");
    value.className = "tooltip__body u-numeric";
    value.textContent = `Value ${def.value.toLocaleString("en-US")} · sells for ${Math.round(def.value * 0.6).toLocaleString("en-US")}`;
    nodes.push(value);

    for (const line of spec.footer ?? []) {
      const extra = document.createElement("div");
      extra.className = "tooltip__body";
      extra.textContent = line;
      nodes.push(extra);
    }

    return nodes;
  }

  /**
   * The stat table. With a comparison, each row is "value (+delta)" so the player can read the
   * trade — a swap that raises armour and drops power is the common case and it has to be obvious.
   */
  private renderBonuses(bonuses: EquipmentBonuses, worn: EquipmentBonuses | null): HTMLElement {
    const table = document.createElement("div");
    table.className = "tooltip__stats";

    for (const [key, label] of BONUS_LABELS) {
      const value = bonuses[key];
      const wornValue = worn ? worn[key] : 0;
      const delta = value - wornValue;
      if (value === 0 && delta === 0) continue;

      const name = document.createElement("span");
      name.textContent = label;

      const amount = document.createElement("span");
      amount.className = "tooltip__stat-value u-numeric";
      amount.textContent = value > 0 ? `+${value}` : String(value);

      if (worn) {
        const change = document.createElement("span");
        change.className = delta > 0 ? "tooltip__delta-up" : delta < 0 ? "tooltip__delta-down" : "u-faint";
        change.textContent = delta === 0 ? " (=)" : ` (${delta > 0 ? "+" : ""}${delta})`;
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

  private requirementLines(def: ItemDef): { text: string; met: boolean }[] {
    const requires = def.equip?.requires;
    if (!requires) return [];
    const skills = this.api.getSkills();
    const lines: { text: string; met: boolean }[] = [];
    for (const [skill, level] of Object.entries(requires)) {
      if (typeof level !== "number") continue;
      const id = skill as SkillId;
      const have = skills[id]?.level ?? 1;
      lines.push({
        text: have >= level
          ? `Requires ${SKILLS[id].name} ${level}`
          : `Requires ${SKILLS[id].name} ${level} — you have ${have}`,
        met: have >= level,
      });
    }
    return lines;
  }

  private slotOf(itemId: ItemId): EquipSlot | null {
    return content.item(itemId)?.equip?.slot ?? null;
  }

  private equippedIn(slot: EquipSlot | null): ItemId | null {
    if (!slot) return null;
    return this.api.getEquipment().slots[slot]?.itemId ?? null;
  }

  /** Null when nothing is worn in that slot or when the hovered item IS the worn one. */
  private wornBonuses(slot: EquipSlot, hoveredId: ItemId): EquipmentBonuses | null {
    const equipped = this.api.getEquipment().slots[slot];
    if (!equipped) return EMPTY_BONUSES;
    if (equipped.itemId === hoveredId) return null;
    return content.item(equipped.itemId)?.equip?.bonuses ?? EMPTY_BONUSES;
  }

  private slotLabel(slot: EquipSlot): string {
    return slot.replace(/([A-Z])/g, " $1").replace(/(\d)/g, " $1").toLowerCase().trim();
  }

  // --------------------------------------------------------------- position

  /** Right of the anchor, flipped left when it would leave the viewport, clamped vertically. */
  private position(anchor: HTMLElement): void {
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
