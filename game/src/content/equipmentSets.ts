import type { EquipmentBonuses, EquipSlot, ItemStack } from "../contracts.js";
import { SET_DATA } from "./setData.js";
export const ARMOUR_SET_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
export type ArmourSetSlot = typeof ARMOUR_SET_SLOTS[number];
export type EquipmentSetSlots = Partial<Record<EquipSlot, ItemStack | null>>;
export interface EquipmentSetThreshold {
    pieces: 2 | 3 | 4 | 5;
    bonuses: EquipmentBonuses;
}
export interface EquipmentSetDefinition {
    id: string;
    name: string;
    tier: number;
    style: "melee" | "magic";
    members: Readonly<Partial<Record<ArmourSetSlot, string>>>;
    thresholds: readonly EquipmentSetThreshold[];
}
export interface EquipmentSetProgress {
    set: EquipmentSetDefinition;
    pieces: number;
    activeThresholds: readonly EquipmentSetThreshold[];
    bonuses: EquipmentBonuses;
}
function bonuses(partial: Partial<EquipmentBonuses> = {}): EquipmentBonuses {
    return { meleeAccuracy: 0, meleePower: 0, defence: Math.max(0, 0), magicAccuracy: 0, magicPower: 0,
        health: 0, ...partial, vitality: 0 };
}
/** Membership uses saved item IDs. Weapons, shields and jewellery never count. */
export const EQUIPMENT_SETS: readonly EquipmentSetDefinition[] = SET_DATA;
function addBonuses(total: EquipmentBonuses, addition: EquipmentBonuses): void {
    for (const key of Object.keys(total) as (keyof EquipmentBonuses)[])
        total[key] += addition[key];
}
/** Derived from current slots on every call, so equip, unequip and load share one rule. */
export function inferEquipmentSets(slots: EquipmentSetSlots): EquipmentSetProgress[] {
    const progress: EquipmentSetProgress[] = [];
    for (const set of EQUIPMENT_SETS) {
        const pieces = ARMOUR_SET_SLOTS.filter((slot) => {
            const stack = slots[slot];
            return stack != null && stack.quantity > 0 && stack.itemId === set.members[slot];
        }).length;
        if (pieces === 0)
            continue;
        const activeThresholds = set.thresholds.filter((threshold) => pieces >= threshold.pieces);
        const total = bonuses();
        for (const threshold of activeThresholds)
            addBonuses(total, threshold.bonuses);
        progress.push({ set, pieces, activeThresholds, bonuses: total });
    }
    return progress;
}
export function getEquipmentSetBonuses(slots: EquipmentSetSlots): EquipmentBonuses {
    const total = bonuses();
    for (const progress of inferEquipmentSets(slots))
        addBonuses(total, progress.bonuses);
    return total;
}
