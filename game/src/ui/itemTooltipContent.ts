/** Item facts shared by the live tooltip and the generated Codex. */
import type { EquipmentBonuses, ItemDef, ItemId, SkillId, SpellElement } from "../contracts.js";
import { content } from "../content/index.js";
import { SKILLS } from "../content/skills.js";

const BONUS_LABELS: readonly [keyof EquipmentBonuses, string][] = [
  ["accuracy", "Accuracy"],
  ["power", "Power"],
  ["armour", "Armour"],
  ["magicAccuracy", "Magic accuracy"],
  ["magicPower", "Magic power"],
  ["magicArmour", "Magic armour"],
  ["vitality", "Vitality"],
];

const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Air", water: "Water", earth: "Earth", fire: "Fire",
};

export interface ItemTooltipStat { label: string; value: number; delta?: number }
export interface ItemTooltipRequirement {
  text: string;
  /** Omitted when the caller did not provide player levels. */
  met?: boolean;
}
export interface ItemTooltipModel {
  itemId: ItemId;
  title: string;
  quantity?: number;
  meta?: string;
  description?: string;
  stats: ItemTooltipStat[];
  details: string[];
  requirements: ItemTooltipRequirement[];
  value?: string;
  footer: string[];
  released: boolean;
}
export interface ItemTooltipOptions {
  quantity?: number;
  skillLevels?: Partial<Record<SkillId, number | { level: number }>>;
  wornBonuses?: EquipmentBonuses;
  comparedSlotLabel?: string;
  liveWeaponCharges?: number | null;
  footer?: readonly string[];
}

export function itemIsReleased(def: ItemDef): boolean {
  return def.orb?.released ?? def.magicWeapon?.charge?.released ?? true;
}

export function formatWeaponChargeLine(element: SpellElement, capacity: number, charges: number | null): string {
  const name = ELEMENT_LABELS[element];
  const maximum = Math.max(0, Math.floor(capacity)).toLocaleString("en-US");
  if (charges === null) return `${name} weapon · ${maximum} charge capacity.`;
  const current = Math.max(0, Math.min(capacity, Math.floor(charges))).toLocaleString("en-US");
  return `${name} weapon · ${current} / ${maximum} charges remaining.`;
}

export function itemTooltipContent(itemId: ItemId, options: ItemTooltipOptions = {}): ItemTooltipModel {
  const def = content.item(itemId);
  if (!def) {
    return {
      itemId, title: itemId, quantity: options.quantity, stats: [],
      details: ["No description available yet."], requirements: [],
      footer: [...(options.footer ?? [])], released: false,
    };
  }

  const stats: ItemTooltipStat[] = [];
  if (def.equip) {
    for (const [key, label] of BONUS_LABELS) {
      const value = def.equip.bonuses[key];
      const delta = options.wornBonuses ? value - options.wornBonuses[key] : undefined;
      if (value === 0 && (delta === undefined || delta === 0)) continue;
      stats.push({ label, value, ...(delta === undefined ? {} : { delta }) });
    }
  }

  const details: string[] = [];
  if (def.equip?.attackSpeedMs !== undefined) {
    details.push(def.magicWeapon
      ? `Cast cadence ${(def.equip.attackSpeedMs / 1000).toFixed(1)} s`
      : `Attack speed ${(def.equip.attackSpeedMs / 1000).toFixed(1)} s`);
  }
  if (def.magicWeapon) {
    details.push(def.magicWeapon.kind === "wand"
      ? "Wand: one-handed, faster casts, weaker hits."
      : "Staff: two-handed, slower casts, stronger hits.");
    const charge = def.magicWeapon.charge;
    if (charge) {
      details.push(formatWeaponChargeLine(charge.element, charge.capacity, options.liveWeaponCharges ?? null));
      const essence = content.item(charge.rechargeItemId)?.name ?? charge.rechargeItemId;
      details.push(`${charge.rechargeCost.toLocaleString("en-US")} ${essence} at an Essence Altar refills it.`);
    }
  }
  if (options.comparedSlotLabel) details.push(`Compared with your ${options.comparedSlotLabel}.`);

  if (def.orb) {
    const element = ELEMENT_LABELS[def.orb.element];
    const article = /^[AEIOU]/.test(element) ? "an" : "a";
    const craftedCharge = content.allItems()
      .find((candidate) => candidate.magicWeapon?.charge?.orbItemId === def.id)
      ?.magicWeapon?.charge;
    details.push(
      `Craft this into ${article} ${element} wand or staff. The finished weapon starts with `
      + `${(craftedCharge?.initialCharges ?? 1000).toLocaleString("en-US")} charges.`,
    );
    if (!def.orb.released) details.push("This orb is not released.");
  }
  if (def.food) details.push(`Heals ${def.food.healAmount} health.`);
  if (def.tool) details.push(`${SKILLS[def.tool.skill].name} tool, +${def.tool.gatherBonus} effective levels.`);

  const requirements: ItemTooltipRequirement[] = [];
  for (const [skill, level] of Object.entries(def.equip?.requires ?? {})) {
    if (typeof level !== "number") continue;
    const id = skill as SkillId;
    const levelView = options.skillLevels?.[id];
    const have = typeof levelView === "number" ? levelView : levelView?.level;
    requirements.push(have === undefined
      ? { text: `Requires ${SKILLS[id].name} ${level}` }
      : {
        text: have >= level
          ? `Requires ${SKILLS[id].name} ${level}`
          : `Requires ${SKILLS[id].name} ${level} — you have ${have}`,
        met: have >= level,
      });
  }

  return {
    itemId,
    title: def.name,
    quantity: options.quantity,
    meta: `${def.category}${def.stackable ? " · stacks" : ""}`,
    description: def.description || undefined,
    stats,
    details,
    requirements,
    value: `Value ${def.value.toLocaleString("en-US")} · sells for ${Math.round(def.value * 0.6).toLocaleString("en-US")}`,
    footer: [...(options.footer ?? [])],
    released: itemIsReleased(def),
  };
}
