import type { ItemDef } from "../contracts.js";
import { ITEM_DATA } from "./itemData.js";

export const MAGIC_ORBS: readonly ItemDef[] = ITEM_DATA.filter(item => !!item.orb);
export const ELEMENTAL_MAGIC_WEAPONS: readonly ItemDef[] = ITEM_DATA.filter(item => !!item.magicWeapon?.charge);
export const RARE_MINIBOSS_WEAPONS: readonly ItemDef[] = ITEM_DATA.filter(item => item.id.startsWith("rare_"));
export const EQUIPMENT: readonly ItemDef[] = ITEM_DATA.filter(item => !!item.equip);

/**
 * The canonical "kit" for a tier and style: exactly one item per slot, which is what the PRD's
 * derived-health and damage tables assume. Exported so a test can re-check the totals in the
 * header comment without re-deriving them by hand.
 */
export const KITS: Readonly<Record<string, readonly string[]>> = {
    melee_t1: [
        "grithe_sword", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves",
        "grithe_boots", "grithe_gloves",
    ],
    melee_t5: [
        "corven_sword", "duskoak_shield", "corven_helm", "corven_plate", "corven_greaves",
        "corven_boots", "corven_gauntlets",
    ],
    melee_t10: [
        "kaldite_sword", "cairnpine_shield", "kaldite_helm", "kaldite_plate", "kaldite_greaves",
        "kaldite_boots", "kaldite_gauntlets",
    ],
    melee_t20: [
        "emberite_sword", "cinderpine_shield", "emberite_helm", "emberite_plate", "emberite_greaves",
        "emberite_boots", "emberite_gauntlets",
    ],
    magic_t1: [
        "air_staff", "marchhide_hood", "marchhide_robe", "marchhide_leggings",
        "marchhide_boots", "marchhide_wraps",
    ],
    magic_t5: [
        "earth_staff", "bramblehide_hood", "bramblehide_robe", "bramblehide_leggings",
        "bramblehide_boots", "bramblehide_wraps",
    ],
    magic_t10: [
        "water_staff", "cairnpelt_hood", "cairnpelt_robe", "cairnpelt_leggings",
        "cairnpelt_boots", "cairnpelt_wraps",
    ],
    magic_t20: [
        "fire_staff", "charhide_hood", "charhide_robe", "charhide_leggings",
        "charhide_boots", "charhide_wraps",
    ]
};
