import { describe, expect, it } from 'vitest';
import { tuneEnemyCombatLevel, REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { enemyCombatLevel, type EnemyDef } from '../game/src/content/index.js';

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
  it('puts every existing regional boss in the requested three-to-five-times band', () => {
    for (const { tier, multiplier } of Object.values(REGIONAL_BOSS_LEVELS)) {
      const result = tuneEnemyCombatLevel(base, tier * multiplier, tier);
      expect(enemyCombatLevel(result) / tier).toBeGreaterThanOrEqual(3);
      expect(enemyCombatLevel(result) / tier).toBeLessThanOrEqual(5);
    }
  });
});
