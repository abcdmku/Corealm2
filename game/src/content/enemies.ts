import type { EnemyDef } from "./index.js";
import { ENEMY_BALANCE } from "./enemyBalanceData.js";
import { ordrunPhases } from "./balance/enemies.js";
import { CREATURE_CATALOG } from './creatureRuntime.js';
import {
  ENEMY_DATA, ENEMY_BLOCK_DATA,
  enemyBlockById, registeredEnemyById,
} from './enemyData.js';

/** Enemies leash at 28 m from their spawn point. */
export const LEASH_RADIUS_M = 28;

/** Existing family/tier lookup convention; changing data never rewrites a saved block ID. */
export function enemyIdFor(family: string, tier: number): string {
  return `${family}_t${tier}`;
}

export interface BossPhase {
  /** Enter this phase when health/maxHealth falls to or below this fraction. */
  atHealthFraction: number;
  armour: number;
  attackSpeedMs: number;
  maxHit: number;
  telegraphId?: string;
  telegraphWindupMs?: number;
  telegraphRadiusM?: number;
}

export const ORDRUN_PHASES: readonly BossPhase[] = ordrunPhases(ENEMY_BALANCE.ordrunPhases, enemyBlockById('quarrykeeper_t10'));

export const ENEMIES: readonly EnemyDef[] = ENEMY_DATA;
export const ENEMY_BLOCKS: readonly EnemyDef[] = ENEMY_BLOCK_DATA;

/** A hunt for a base creature also credits its directly authored variants. */
export function huntEnemyDefMatches(requestedId: string, currentId: string): boolean {
  return requestedId === currentId || CREATURE_CATALOG.byCreatureId.get(currentId)?.definition.baseId === requestedId;
}

/** Matching-family group first, then the canonical family/tier block, then the original group. */
export function enemyBlockFor(groupId: string, family: string, tier: number): EnemyDef | undefined {
  const group = registeredEnemyById(groupId);
  return group?.family === family ? group : registeredEnemyById(enemyIdFor(family, tier)) ?? group;
}
