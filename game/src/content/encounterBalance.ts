import { enemyCombatLevel, type EnemyDef } from './index.js';
import type { RegionId } from '../contracts.js';

/** Regional strength is read from the fight's stats, using the existing combat-level formula. */
export function tuneEnemyCombatLevel(base: EnemyDef, targetLevel: number, tier = base.tier): EnemyDef {
  const target = Math.max(1, Math.round(targetLevel));
  const sample = (factor: number): EnemyDef => ({
    ...base, tier,
    maxHealth: Math.max(3, Math.round(base.maxHealth * factor)),
    attackLevel: Math.max(1, Math.round(base.attackLevel * factor)),
    defenceLevel: Math.max(1, Math.round(base.defenceLevel * factor)),
    accuracy: Math.max(0, Math.round(Math.min(80, base.accuracy) * Math.min(1, factor))),
    armour: Math.max(0, Math.round(Math.min(80, base.armour) * Math.min(1, factor))),
    magicArmour: Math.max(0, Math.round(Math.min(80, base.magicArmour) * Math.min(1, factor))),
    maxHit: Math.max(1, Math.round(base.maxHit * Math.pow(factor, .68))),
  });
  let low = 0, high = 1;
  while (enemyCombatLevel(sample(high)) < target) high *= 2;
  let best = sample(high);
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2, candidate = sample(mid);
    const level = enemyCombatLevel(candidate);
    if (Math.abs(level - target) < Math.abs(enemyCombatLevel(best) - target)) best = candidate;
    if (level < target) low = mid; else high = mid;
  }
  // Integer attack rolls can step over a level. Health contributes one level per twelve HP.
  const offence = (best.attackLevel + 9) * (1 + best.accuracy / 100) - 9;
  const defence = (best.defenceLevel + 9) * (1 + (best.armour + best.magicArmour) / 200) - 9;
  best.maxHealth = Math.max(3, Math.round((target - .5 * offence - .25 * defence) * 12));
  if (enemyCombatLevel(best) !== target) throw new Error(`Cannot tune ${base.id} to combat level ${target}`);
  return best;
}

export const REGION_COMBAT_TIERS: Readonly<Record<RegionId, number>> = {
  fallowmarch: 1, vellenwood: 5, karrowmoor: 10, gravelmaw: 10, kilnhalt: 20, wilderness: 50,
};

/** Retain the four orb encounters and three regional boss identities and saved kill IDs. */
export const REGIONAL_BOSS_LEVELS = {
  galeskin: { tier: 1, multiplier: 3 }, tempest_roc: { tier: 1, multiplier: 5 },
  mossbound: { tier: 5, multiplier: 3 }, rootheart: { tier: 5, multiplier: 5 },
  tideworn: { tier: 10, multiplier: 4 }, ordrun: { tier: 10, multiplier: 5 },
  cinderwake: { tier: 20, multiplier: 4 },
} as const;
