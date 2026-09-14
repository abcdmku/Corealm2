import { ITEM_DATA } from "./itemData.js";
import { SET_RECORDS } from "./setData.js";
import type { ItemDef } from "../contracts.js";
import type { EnemyDef } from "./index.js";
import type { EquipmentSetDefinition } from "./equipmentSets.js";

export const BOSS_ARMOR_SETS: readonly EquipmentSetDefinition[] = SET_RECORDS.filter(set => set.acquisition === 'boss');
const bossItemIds = new Set(BOSS_ARMOR_SETS.flatMap(set => Object.values(set.members)));
export const BOSS_ARMOR_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => bossItemIds.has(item.id));

/** Independent piece rolls share a 0.02 expected-piece budget, including bareheaded sets. */
export function bossArmorDrops(tier: 50 | 70): EnemyDef['drops'] {
    const items = BOSS_ARMOR_ITEMS.filter(item => item.tier === tier);
    return items.map(item => ({
        itemId: item.id, quantity: [1, 1], chance: 0.02 / items.length
    }));
}
