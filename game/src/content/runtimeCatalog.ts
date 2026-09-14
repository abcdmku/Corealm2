import { ITEM_DATA } from './itemData.js';
import { RECIPE_DATA } from './recipeData.js';
import { RESOURCE_DATA } from './resourceData.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from './enemyData.js';
import { ALL_SPELLS } from './spells.js';
import { SHOPS } from './shops.js';
import { RESOLVED_CATALOG } from './resolvedCatalog.js';

/** Runtime registration uses the same resolved domains as the authoring compiler. */
export const RUNTIME_CATALOG = {
  version: 1 as const,
  revision: RESOLVED_CATALOG.revision,
  tables: {
    items: ITEM_DATA,
    recipes: RECIPE_DATA,
    resources: RESOURCE_DATA,
    enemies: ENEMY_DATA,
    spells: ALL_SPELLS,
    shops: SHOPS,
  },
};

export function runtimeTables(includeLabCreatures = false) {
  return includeLabCreatures
    ? { ...RUNTIME_CATALOG.tables, enemies: [...ENEMY_DATA, ...LAB_ONLY_ENEMY_DATA] }
    : RUNTIME_CATALOG.tables;
}
