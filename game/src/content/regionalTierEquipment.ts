import { REGIONAL_CRAFTING_TIER_DATA } from "./craftingTierData.js";
import { ITEM_DATA } from "./itemData.js";
import type { ItemDef } from '../contracts.js';
import type { RecipeDef } from './index.js';
import { RECIPE_DATA } from "./recipeData.js";

/** Standalone regional catalog. Root registers this after production-lab acceptance. */
export const REGIONAL_CRAFTING_TIERS = REGIONAL_CRAFTING_TIER_DATA;
export const REGIONAL_TIER_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => [30,40,60].includes(item.tier));

export const REGIONAL_TIER_RECIPES: readonly RecipeDef[] = RECIPE_DATA.filter(recipe => [30,40,60].includes(recipe.tier));
