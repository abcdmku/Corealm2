import { REGIONAL_CRAFTING_TIER_DATA } from "./craftingTierData.js";
import { itemRows } from "./itemData.js";
import type { ItemDef } from '../contracts.js';
import type { RecipeDef, EnemyDef } from './index.js';
import { recipeRows } from "./recipeData.js";

/** Standalone regional catalog. Root registers this after production-lab acceptance. */
export const REGIONAL_CRAFTING_TIERS = REGIONAL_CRAFTING_TIER_DATA;
export const REGIONAL_TIER_ITEMS: readonly ItemDef[] = itemRows("REGIONAL_TIER_ITEMS");

/** Regional creatures supply the fabric or hide; its own recipe makes the matching binding. */
export function regionalFabricDrops(tier: number, boss = false): EnemyDef['drops'] {
  const row = REGIONAL_CRAFTING_TIERS.find(row => row.tier === tier);
  return row ? [{ itemId: row.hide, quantity: boss ? [4, 7] : [1, 3], chance: boss ? 1 : .75 }] : [];
}
export const REGIONAL_TIER_RECIPES: readonly RecipeDef[] = recipeRows("REGIONAL_TIER_RECIPES");
