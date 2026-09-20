import { describe, expect, it } from 'vitest';
import {
  combatLevel, tierGold, tuneCombat, deriveLegacyBoss, ordrunPhases,
  type CombatInput, type CombatResult, type EnemyBalanceStage1,
} from '../game/src/content/balance/enemies.js';

// Original literals are an independent oracle; these tests do not load mutable balance JSON.
const params: EnemyBalanceStage1 = {
  goldPerTier: { ordinary: [3, 11], purse: [7, 27] },
  combatLevel: { rollLevelOffset: 9, bonusDivisor: 100, defenceStyleCount: 2, healthPerLevel: 3,
    offenceWeight: .5, defenceWeight: .25, healthWeight: .25, minimum: 1 },
  tuning: { minimumHealth: 3, minimumLevel: 1, minimumBonus: 0, maximumBonus: 80, maximumBonusScale: 1,
    maxHitExponent: .68, searchInitialLow: 0, searchInitialHigh: 1, searchGrowth: 2, searchIterations: 48,
    healthPerCombatLevel: 12 },
  regionalBossLevels: {
    galeskin: { tier: 1, multiplier: 11 }, tempest_roc: { tier: 1, multiplier: 13 },
    mossbound: { tier: 5, multiplier: 3 }, rootheart: { tier: 5, multiplier: 5 },
    tideworn: { tier: 10, multiplier: 4 }, ordrun: { tier: 10, multiplier: 5 }, cinderwake: { tier: 20, multiplier: 4 },
  },
  legacyGoldInputs: [], legacyBossInputs: [],
  ordrunPhases: [
    { atHealthFraction: 1, attackSpeedMs: 3000 },
    { atHealthFraction: .55, armourNumerator: 50, armourDenominator: 62, attackSpeedMs: 2400,
      maxHitNumerator: 14, maxHitDenominator: 12, telegraphId: 'ground_slam', telegraphWindupMs: 1800, telegraphRadiusM: 6 },
  ],
};
const seed: CombatInput = { maxHealth: 38, attackLevel: 12, defenceLevel: 11, accuracy: 25, armour: 55, magicArmour: 10, maxHit: 7 };
const tune = (input: CombatInput, target: number, tier = 20, id = 'formula_probe') =>
  tuneCombat(params.tuning, params.combatLevel, input, target, tier, id);
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
describe('pure Stage 1 enemy formulas', () => {
  it('rounds mark half ties and uses the selected authored multiplier pair', () => {
    expect(tierGold(params.goldPerTier, .5, 'ordinary')).toEqual([2, 6]);
    expect(tierGold(params.goldPerTier, .5, 'purse')).toEqual([4, 14]);
    expect(tierGold({ ordinary: [4, 12], purse: [8, 28] }, 5, 'purse')).toEqual([40, 140]);
  });

  it('retains the first exact candidate across equal-error search plateaus', () => {
    const plateau = { maxHealth: 6, attackLevel: 1, defenceLevel: 1, accuracy: 0, armour: 0, magicArmour: 0, maxHit: 100 };
    expect(tune(plateau, 1)).toEqual({ ...plateau, maxHealth: 3, tier: 20 });
    expect(tune(plateau, 1).maxHit).toBe(100);
  });

  it('rounds the target before searching and caps each bonus before scaling', () => {
    expect(tune(seed, 49.5)).toEqual(tune(seed, 50));
    expect(tune(seed, 49.49)).toEqual(tune(seed, 49));
    const capped = tune({ ...seed, accuracy: 800, armour: 1000, magicArmour: 2000 }, 175);
    expect([capped.accuracy, capped.armour, capped.magicArmour]).toEqual([80, 80, 80]);
    expect(combatLevel(params.combatLevel, capped)).toBe(175);
  });

  it('uses revised weights and their matching health correction ratio', () => {
    const level = { ...params.combatLevel, offenceWeight: .2, defenceWeight: .3, healthWeight: .5 };
    const tuning = { ...params.tuning, healthPerCombatLevel: 6 };
    const result = tuneCombat(tuning, level, seed, 50, 10, 'reweighted');
    expect(combatLevel(level, result)).toBe(50);
    expect(result).not.toEqual(tune(seed, 50, 10));
    expect(combatLevel({ ...level, bonusDivisor: 50 }, seed)).not.toBe(combatLevel(level, seed));
  });

  it('responds to tuning caps, hit exponents, seed edits and boss multipliers', () => {
    const input = { id: 'legacy/quarrykeeper_t10', enemyId: 'quarrykeeper_t10', bossId: 'ordrun' as const, seed };
    const original = deriveLegacyBoss(params, input);
    const changed = { ...params, regionalBossLevels: { ...params.regionalBossLevels, ordrun: { tier: 10, multiplier: 6 } } };
    expect(combatLevel(params.combatLevel, deriveLegacyBoss(changed, input))).toBe(60);
    expect(deriveLegacyBoss(params, { ...input, seed: { ...seed, maxHit: 15 } }).maxHit).not.toBe(original.maxHit);
    const revised = tuneCombat({ ...params.tuning, maximumBonus: 10, maxHitExponent: 1 }, params.combatLevel, seed, 50, 10, input.enemyId);
    expect(revised.accuracy).toBe(10);
    expect(revised.armour).toBe(10);
    expect(revised.maxHit).not.toBe(original.maxHit);
  });

  it('returns fresh values without mutating frozen inputs or parameter rows', () => {
    const frozen = freeze(structuredClone(params));
    const input = freeze({ id: 'legacy/quarrykeeper_t10', enemyId: 'quarrykeeper_t10', bossId: 'ordrun' as const, seed: structuredClone(seed) });
    const before = structuredClone({ frozen, input });
    const result = deriveLegacyBoss(frozen, input);
    const phases = ordrunPhases(frozen.ordrunPhases, freeze(result));
    phases[0]!.armour = -1;
    const gold = tierGold(frozen.goldPerTier, 5, 'ordinary');
    gold[0] = -1;
    expect({ frozen, input }).toEqual(before);
    expect(ordrunPhases(frozen.ordrunPhases, result)[0]!.armour).toBe(result.armour);
  });

  it('preserves the exact failure text after the finite search budget', () => {
    expect(() => tune({ ...seed, maxHealth: 1, attackLevel: 1e20, defenceLevel: 1e20 }, .5, 20, 'low_target'))
      .toThrow('Cannot tune low_target to combat level 1');
  });

  it('rejects nonfinite targets before searching indefinitely', () => {
    expect(() => tune(seed, Infinity)).toThrow('Cannot tune formula_probe to combat level Infinity');
    expect(() => tune(seed, NaN)).toThrow('Cannot tune formula_probe to combat level NaN');
  });

  it('uses phase ratios in multiply-then-divide order and omits first-phase telegraphs', () => {
    const phases = ordrunPhases(params.ordrunPhases, { armour: 62, maxHit: 12 });
    expect(phases).toEqual([
      { atHealthFraction: 1, armour: 62, attackSpeedMs: 3000, maxHit: 12 },
      { atHealthFraction: .55, armour: 50, attackSpeedMs: 2400, maxHit: 14,
        telegraphId: 'ground_slam', telegraphWindupMs: 1800, telegraphRadiusM: 6 },
    ]);
    const changed = structuredClone(params.ordrunPhases);
    const revised = [changed[0], { ...changed[1], armourNumerator: 31, maxHitNumerator: 6 }] as const;
    expect(ordrunPhases(revised, { armour: 62, maxHit: 12 })[1]).toMatchObject({ armour: 31, maxHit: 6 });
  });
});
