import type { EnemyDef } from './index.js';
import type { RegionId } from '../contracts.js';
import { ENEMY_BALANCE } from './enemyBalanceData.js';
import { tuneCombat } from './balance/enemies.js';

/** Compatibility wrapper. Stored enemy records are only changed by explicit recompute. */
export function tuneEnemyCombatLevel(base: EnemyDef, targetLevel: number, tier = base.tier): EnemyDef {
  return { ...base, ...tuneCombat(ENEMY_BALANCE.tuning, ENEMY_BALANCE.combatLevel, base, targetLevel, tier, base.id) };
}

export const REGION_COMBAT_TIERS: Readonly<Record<RegionId, number>> = ENEMY_BALANCE.regionCombatTiers;
export const REGIONAL_BOSS_LEVELS = ENEMY_BALANCE.regionalBossLevels;
