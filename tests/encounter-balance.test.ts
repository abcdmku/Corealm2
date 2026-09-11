import { describe, expect, it } from 'vitest';
import { tuneEnemyCombatLevel, REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { enemyCombatLevel, type EnemyDef } from '../game/src/content/index.js';
import { ENEMY_BLOCKS } from '../game/src/content/enemies.js';

const base: EnemyDef = { id:'balance-fixture', family:'fixture', name:'Fixture', tier:10,
  maxHealth:70, attackLevel:12, defenceLevel:8, accuracy:20, armour:15, magicArmour:5,
  maxHit:6, attackSpeedMs:2400, aggroRadius:10, behaviour:'territorial', drops:[] };

describe('regional encounter strength', () => {
  it('changes the actual fight to every ordinary and boss level, while retaining source identity', () => {
    for (const target of [1,3,4,5,15,25,40,50,70,80,150,200,210,250,280,350]) {
      const result = tuneEnemyCombatLevel(base, target, target < 70 ? 50 : 70);
      expect(enemyCombatLevel(result)).toBe(target);
      expect(result.id).toBe(base.id);
      expect(result.drops).toBe(base.drops);
      expect(result.maxHealth).toBeGreaterThan(0);
    }
    expect(base.maxHealth).toBe(70);
  });
  // The three-to-five-times band only describes regions whose ordinary residents also scale with
  // their tier. They do not below tier 5: Fallowmarch's strongest ordinary residents (reaver_t1,
  // viper_t1, cattle_t1, zombie_t1) derive level 6 from their own stats, which is 6x their tier,
  // while tier 5, 10 and 20 residents top out near 2.8x, 2.3x and 1.7x. A 3-5x tier-1 boss would
  // therefore be weaker than the trash mobs guarding the same region. Tier 1 is held to the
  // substantive property the band is a proxy for - the boss must outrank the region's ordinary
  // ceiling by the gap `tests/player-level-labels.test.ts` requires.
  const MINIBOSS_LEVEL_GAP = 4;
  const bossIds = new Set(Object.keys(REGIONAL_BOSS_LEVELS).map(id => id === 'ordrun' ? 'quarrykeeper_t10' : `${id}_t${REGIONAL_BOSS_LEVELS[id as keyof typeof REGIONAL_BOSS_LEVELS].tier}`));
  const ordinaryCeiling = (tier: number) => Math.max(...ENEMY_BLOCKS
    .filter(row => row.tier === tier && !bossIds.has(row.id)).map(enemyCombatLevel));
  it('puts every regional boss from tier five up in the requested three-to-five-times band', () => {
    const scaled = Object.values(REGIONAL_BOSS_LEVELS).filter(({ tier }) => tier >= 5);
    expect(scaled.length).toBe(5);
    for (const { tier, multiplier } of scaled) {
      const result = tuneEnemyCombatLevel(base, tier * multiplier, tier);
      expect(enemyCombatLevel(result) / tier).toBeGreaterThanOrEqual(3);
      expect(enemyCombatLevel(result) / tier).toBeLessThanOrEqual(5);
    }
  });
  it('lifts every tier-one regional boss past the ordinary ceiling of its own region', () => {
    const tierOne = Object.values(REGIONAL_BOSS_LEVELS).filter(({ tier }) => tier === 1);
    expect(tierOne.length).toBe(2);
    const ceiling = ordinaryCeiling(1);
    expect(ceiling).toBe(6);
    for (const { tier, multiplier } of tierOne) {
      const result = tuneEnemyCombatLevel(base, tier * multiplier, tier);
      expect(enemyCombatLevel(result)).toBeGreaterThan(ceiling + MINIBOSS_LEVEL_GAP);
    }
  });
});
