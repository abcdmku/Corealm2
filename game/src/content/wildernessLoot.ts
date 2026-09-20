import { WILDERNESS_CRAFTING_TIER_DATA } from './craftingTierData.js';
import { ITEM_DATA } from './itemData.js';
import type { ItemDef, ItemId } from '../contracts.js';
import type { EnemyDef, RecipeDef } from './index.js';
import { RECIPE_DATA } from './recipeData.js';
import { LOOT_BALANCE } from './lootBalanceData.js';
import { CREATURE_CATALOG } from './creatureRuntime.js';

/** These rows extend equipment and production without adding a spell element or another rune. */
export const WILDERNESS_CRAFTING_TIERS = WILDERNESS_CRAFTING_TIER_DATA;
export const WILDERNESS_LOOT_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => item.tier >= 50);
export const WILDERNESS_LOOT_RECIPES: readonly RecipeDef[] = RECIPE_DATA.filter(recipe => recipe.reqLevel >= 50);

/** Distinct fortress supplies also fall from ordinary guards, so their recipes are not boss-only. */
export const WILDERNESS_STRUCTURE_COMPONENTS: Readonly<Record<string, ItemId>> = Object.fromEntries(
  LOOT_BALANCE.wildernessParameters.structureComponents.map(row => [row.structureId, row.itemId]),
) as Record<string, ItemId>;
export const WILDERNESS_KEEPER_COMPONENTS: Readonly<Record<string, ItemId>> = Object.fromEntries(
  LOOT_BALANCE.wildernessParameters.keeperRewards.map(row => [row.keeperId, row.component]),
) as Record<string, ItemId>;

/** Caller supplies the authored creature ID. Loot comes from its accepted compiled definition. */
export function wildernessLootForCreature(creatureId: string): EnemyDef['lootRolls'] {
  const creature = CREATURE_CATALOG.byCreatureId.get(creatureId);
  if (!creature) throw new Error(`Unknown creature ${creatureId}`);
  return creature.enemy.lootRolls;
}
