/** Item facts shared by the live tooltip and the generated Codex. */
import type { EquipmentBonuses, ItemDef, ItemId, SkillId } from "../contracts.js";
import { content } from "../content/index.js";
import {
  BONUS_LABELS, attackSpeedLine, categoryLine, foodLine, formatWeaponChargeLine, itemIsReleased,
  magicWeaponLine, orbCraftLine, requirementLine, toolLine, valueLine,
} from "./itemFacts.js";

export { formatWeaponChargeLine, itemIsReleased };

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
  if (def.equip?.attackSpeedMs !== undefined) details.push(attackSpeedLine(def.equip.attackSpeedMs, Boolean(def.magicWeapon)));
  if (def.magicWeapon) {
    details.push(magicWeaponLine(def.magicWeapon.kind));
    const charge = def.magicWeapon.charge;
    if (charge) {
      details.push(formatWeaponChargeLine(charge.element, charge.capacity, options.liveWeaponCharges ?? null));
      const essence = content.item(charge.rechargeItemId)?.name ?? charge.rechargeItemId;
      details.push(`${charge.rechargeCost.toLocaleString("en-US")} ${essence} at an Essence Altar refills it.`);
    }
  }
  if (options.comparedSlotLabel) details.push(`Compared with your ${options.comparedSlotLabel}.`);

  if (def.orb) {
    const craftedCharge = content.allItems()
      .find((candidate: ItemDef) => candidate.magicWeapon?.charge?.orbItemId === def.id)
      ?.magicWeapon?.charge;
    details.push(orbCraftLine(def.orb.element, craftedCharge?.initialCharges ?? 1000));
    if (!def.orb.released) details.push("This orb is not released.");
  }
  if (def.food) details.push(foodLine(def.food.healAmount));
  if (def.tool) details.push(toolLine(def.tool.skill, def.tool.gatherBonus));

  const requirements: ItemTooltipRequirement[] = [];
  for (const [skill, level] of Object.entries(def.equip?.requires ?? {})) {
    if (typeof level !== "number") continue;
    const id = skill as SkillId;
    const levelView = options.skillLevels?.[id];
    const have = typeof levelView === "number" ? levelView : levelView?.level;
    requirements.push(have === undefined
      ? { text: requirementLine(id, level) }
      : { text: requirementLine(id, level, have), met: have >= level });
  }

  return {
    itemId,
    title: def.name,
    quantity: options.quantity,
    meta: categoryLine(def),
    description: def.description || undefined,
    stats,
    details,
    requirements,
    value: valueLine(def.value),
    footer: [...(options.footer ?? [])],
    released: itemIsReleased(def),
  };
}
