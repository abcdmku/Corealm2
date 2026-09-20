import { ITEM_DATA } from './itemData.js';
import { RECIPE_DATA } from './recipeData.js';
import { RESOURCE_DATA } from './resourceData.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from './enemyData.js';
import { ALL_SPELLS } from './spells.js';
import { SHOPS } from './shops.js';
import { RESOLVED_CATALOG, RESOLVED_TABLES } from './resolvedCatalog.js';
import type { ContentTables, EnemyDef, ShopDef } from './index.js';

/** Runtime registration uses the same resolved domains as the authoring compiler. */
export const RUNTIME_CATALOG: { version: 1; revision: string; tables: ContentTables } = {
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
let labOnlyEnemies: readonly EnemyDef[] = LAB_ONLY_ENEMY_DATA;

export function runtimeTables(includeLabCreatures = false): ContentTables {
  return includeLabCreatures
    ? { ...RUNTIME_CATALOG.tables, enemies: [...RUNTIME_CATALOG.tables.enemies, ...labOnlyEnemies] }
    : RUNTIME_CATALOG.tables;
}

/**
 * The registry tables a live publish replaces: exactly these four. Resources and spells are derived
 * at import by other modules, so they keep their rows until the next start.
 */
export const LIVE_REGISTRY_TABLES = ['items', 'recipes', 'enemies', 'shops'] as const;
/**
 * After a live publish, once `adoptCatalog` ran. A world built later in this process registers the same rows.
 * Assignments only: the compile that produced these tables already parsed them, and a swap must not throw.
 */
export function reindexRuntimeTables(): void {
  const tables = RESOLVED_CATALOG.tables;
  RUNTIME_CATALOG.revision = RESOLVED_CATALOG.revision;
  RUNTIME_CATALOG.tables = { ...RUNTIME_CATALOG.tables, items: tables.items, recipes: tables.recipes, enemies: tables.enemies,
    shops: RESOLVED_TABLES.shops as ShopDef[] };
  labOnlyEnemies = tables.compiledCreatures.filter(row => row.availability === 'lab').map(row => row.enemy);
}
