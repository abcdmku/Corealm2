import { ENEMY_RECORDS, ENEMY_ALIAS_RECORDS } from './enemyData.js';
import { CREATURE_RECORDS } from './creatureData.js';
import { LOOT_RECORDS } from './lootData.js';
import { validateCreatureCollections } from './schema/creatureLinks.js';
import { validateEnemyFormulaLinks } from './schema/enemyFormulaLinks.js';
import { ENEMY_BALANCE } from './enemyBalanceData.js';

/** Boot validates the same joins as editor writes, before registering gameplay tables. */
export function assertCreatureCatalog(): void {
  const tables = new Map<string, unknown>([
    ['enemies', ENEMY_RECORDS], ['enemyAliases', ENEMY_ALIAS_RECORDS],
    ['creatures', CREATURE_RECORDS], ['lootTables', LOOT_RECORDS],
    ['balance/enemies', ENEMY_BALANCE],
  ]);
  const issues = [...validateCreatureCollections(tables), ...validateEnemyFormulaLinks(tables)];
  if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
}
