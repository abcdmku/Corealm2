import type { EquipmentBonuses, EquipSlot, ItemStack } from "../contracts.js";
import { WILDERNESS_CRAFTING_TIERS } from './wildernessLoot.js';

export const ARMOUR_SET_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
export type ArmourSetSlot = typeof ARMOUR_SET_SLOTS[number];
export type EquipmentSetSlots = Partial<Record<EquipSlot, ItemStack | null>>;

export interface EquipmentSetThreshold {
  pieces: 2 | 4 | 5;
  bonuses: EquipmentBonuses;
}

export interface EquipmentSetDefinition {
  id: string;
  name: string;
  tier: number;
  style: "melee" | "magic";
  members: Readonly<Record<ArmourSetSlot, string>>;
  thresholds: readonly EquipmentSetThreshold[];
}

export interface EquipmentSetProgress {
  set: EquipmentSetDefinition;
  pieces: number;
  activeThresholds: readonly EquipmentSetThreshold[];
  bonuses: EquipmentBonuses;
}

function bonuses(partial: Partial<EquipmentBonuses> = {}): EquipmentBonuses {
  return { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0,
    magicArmour: 0, vitality: 0, ...partial };
}

function defineSet(
  id: string, name: string, tier: number, style: "melee" | "magic",
  memberIds: readonly [string, string, string, string, string],
  defence: number, vitality: number,
): EquipmentSetDefinition {
  return {
    id, name, tier, style,
    members: { head: memberIds[0], body: memberIds[1], legs: memberIds[2],
      hands: memberIds[3], feet: memberIds[4] },
    thresholds: [
      { pieces: 2, bonuses: bonuses(style === "melee" ? { armour: defence } : { magicArmour: defence }) },
      { pieces: 4, bonuses: bonuses({ vitality }) },
      { pieces: 5, bonuses: bonuses(style === "melee" ? { magicArmour: defence } : { armour: defence }) },
    ],
  };
}

/** Membership uses saved item IDs. Weapons, shields and jewellery never count. */
export const EQUIPMENT_SETS: readonly EquipmentSetDefinition[] = [
  defineSet("copper", "Copper", 1, "melee", ["grithe_helm", "grithe_cuirass", "grithe_greaves", "grithe_gloves", "grithe_boots"], 2, 1),
  defineSet("iron", "Iron", 5, "melee", ["corven_helm", "corven_plate", "corven_greaves", "corven_gauntlets", "corven_boots"], 3, 2),
  defineSet("cobalt", "Cobalt", 10, "melee", ["kaldite_helm", "kaldite_plate", "kaldite_greaves", "kaldite_gauntlets", "kaldite_boots"], 4, 3),
  defineSet("titanium", "Titanium", 20, "melee", ["emberite_helm", "emberite_plate", "emberite_greaves", "emberite_gauntlets", "emberite_boots"], 6, 4),
  defineSet("hide", "Hide", 1, "magic", ["marchhide_hood", "marchhide_robe", "marchhide_leggings", "marchhide_wraps", "marchhide_boots"], 2, 1),
  defineSet("thick_hide", "Thick Hide", 5, "magic", ["bramblehide_hood", "bramblehide_robe", "bramblehide_leggings", "bramblehide_wraps", "bramblehide_boots"], 3, 2),
  defineSet("fur", "Fur", 10, "magic", ["cairnpelt_hood", "cairnpelt_robe", "cairnpelt_leggings", "cairnpelt_wraps", "cairnpelt_boots"], 4, 3),
  defineSet("heavy_hide", "Heavy Hide", 20, "magic", ["charhide_hood", "charhide_robe", "charhide_leggings", "charhide_wraps", "charhide_boots"], 6, 4),
  ...WILDERNESS_CRAFTING_TIERS.flatMap(row => [
    defineSet(row.metal, row.metalName, row.tier, 'melee',
      [`${row.metal}_helm`, `${row.metal}_plate`, `${row.metal}_greaves`, `${row.metal}_gauntlets`, `${row.metal}_boots`],
      row.tier === 50 ? 10 : 14, row.tier === 50 ? 7 : 10),
    defineSet(row.hide, row.hideName, row.tier, 'magic',
      [`${row.hide}_hood`, `${row.hide}_robe`, `${row.hide}_leggings`, `${row.hide}_wraps`, `${row.hide}_boots`],
      row.tier === 50 ? 10 : 14, row.tier === 50 ? 7 : 10),
  ]),
];

function addBonuses(total: EquipmentBonuses, addition: EquipmentBonuses): void {
  for (const key of Object.keys(total) as (keyof EquipmentBonuses)[]) total[key] += addition[key];
}

/** Derived from current slots on every call, so equip, unequip and load share one rule. */
export function inferEquipmentSets(slots: EquipmentSetSlots): EquipmentSetProgress[] {
  const progress: EquipmentSetProgress[] = [];
  for (const set of EQUIPMENT_SETS) {
    const pieces = ARMOUR_SET_SLOTS.filter((slot) => {
      const stack = slots[slot];
      return stack != null && stack.quantity > 0 && stack.itemId === set.members[slot];
    }).length;
    if (pieces === 0) continue;
    const activeThresholds = set.thresholds.filter((threshold) => pieces >= threshold.pieces);
    const total = bonuses();
    for (const threshold of activeThresholds) addBonuses(total, threshold.bonuses);
    progress.push({ set, pieces, activeThresholds, bonuses: total });
  }
  return progress;
}

export function getEquipmentSetBonuses(slots: EquipmentSetSlots): EquipmentBonuses {
  const total = bonuses();
  for (const progress of inferEquipmentSets(slots)) addBonuses(total, progress.bonuses);
  return total;
}
