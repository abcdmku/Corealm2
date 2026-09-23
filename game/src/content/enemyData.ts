import type { EnemyDef } from './index.js';
import { CREATURE_CATALOG } from './creatureRuntime.js';

export const ENEMY_DATA: readonly EnemyDef[] = CREATURE_CATALOG.enemies;
export const ENEMY_BLOCK_DATA = ENEMY_DATA;
export const LAB_ONLY_ENEMY_DATA = CREATURE_CATALOG.creatures.filter(row => row.availability === 'lab').map(row => row.enemy);
export function enemyBlockById(id: string): EnemyDef {
  const enemy = CREATURE_CATALOG.byEnemyId.get(id);
  if (!enemy) throw new Error(`Unknown creature combat ${id}`);
  return enemy;
}
export function registeredEnemyById(id: string): EnemyDef | undefined {
  const row = CREATURE_CATALOG.byCreatureId.get(id);
  return row?.availability === 'world' ? row.enemy : undefined;
}
