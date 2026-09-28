import { ITEM_DATA } from "./itemData.js";
import { SET_RECORDS } from "./setData.js";
import type { ItemDef, LootDrop } from "../contracts.js";
import type { EquipmentSetDefinition } from "./equipmentSets.js";

const bossSets: EquipmentSetDefinition[] = [], bossItems: ItemDef[] = [];
export const BOSS_ARMOR_SETS: readonly EquipmentSetDefinition[] = bossSets;
export const BOSS_ARMOR_ITEMS: readonly ItemDef[] = bossItems;

/** Fills the two arrays above; again after the catalog moved, once `reindexEquipmentSets` ran. */
export function reindexBossArmor(): void {
  bossSets.splice(0, bossSets.length, ...SET_RECORDS.filter(set => set.acquisition === 'boss'));
  const bossItemIds = new Set(bossSets.flatMap(set => Object.values(set.members)));
  bossItems.splice(0, bossItems.length, ...ITEM_DATA.filter(item => bossItemIds.has(item.id)));
}
reindexBossArmor();

/** Pieces in one roll share a 0.02 expected-piece budget, including bareheaded sets. */
export function bossArmorDrops(tier: 50 | 70): LootDrop[] {
    const items = BOSS_ARMOR_ITEMS.filter(item => item.tier === tier);
    return items.map(item => ({
        itemId: item.id, quantity: [1, 1], chance: 0.02 / items.length
    }));
}
