import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  combatLevel, tierMarks, tuneCombat, deriveLegacyBoss, ordrunPhases,
  type CombatInput, type CombatResult, type EnemyBalanceStage1, type LegacyBossId,
} from '../game/src/content/balance/enemies.js';
import type { EnemyDef } from '../game/src/content/index.js';
import type { BossPhase } from '../game/src/content/enemies.js';
import { buildM4Baseline, snapshot, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

// Original literals are an independent oracle; these tests do not load mutable balance JSON.
const params: EnemyBalanceStage1 = {
  marksPerTier: { ordinary: [3, 11], purse: [7, 27] },
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
  legacyMarksInputs: [], legacyBossInputs: [],
  ordrunPhases: [
    { atHealthFraction: 1, attackSpeedMs: 3000 },
    { atHealthFraction: .55, armourNumerator: 50, armourDenominator: 62, attackSpeedMs: 2400,
      maxHitNumerator: 14, maxHitDenominator: 12, telegraphId: 'ground_slam', telegraphWindupMs: 1800, telegraphRadiusM: 6 },
  ],
};
const seed: CombatInput = { maxHealth: 38, attackLevel: 12, defenceLevel: 11, accuracy: 25, armour: 55, magicArmour: 10, maxHit: 7 };
const project = (input: CombatResult): CombatResult => ({
  maxHealth: input.maxHealth, attackLevel: input.attackLevel, defenceLevel: input.defenceLevel,
  accuracy: input.accuracy, armour: input.armour, magicArmour: input.magicArmour, maxHit: input.maxHit, tier: input.tier,
});
const tune = (input: CombatInput, target: number, tier = 20, id = 'formula_probe') =>
  tuneCombat(params.tuning, params.combatLevel, input, target, tier, id);
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'null': return null;
    case 'undefined': return undefined;
    case 'boolean': case 'number': case 'string': return value.value;
    case 'array': return value.values.map(restore);
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    case 'set': return new Set(value.values.map(restore));
    case 'map': return new Map(value.entries.map(([key, entry]) => [restore(key), restore(entry)]));
  }
}

describe('pure Stage 1 enemy formulas', () => {
  it('rounds mark half ties and uses the selected authored multiplier pair', () => {
    expect(tierMarks(params.marksPerTier, .5, 'ordinary')).toEqual([2, 6]);
    expect(tierMarks(params.marksPerTier, .5, 'purse')).toEqual([4, 14]);
    expect(tierMarks({ ordinary: [4, 12], purse: [8, 28] }, 5, 'purse')).toEqual([40, 140]);
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
    const marks = tierMarks(frozen.marksPerTier, 5, 'ordinary');
    marks[0] = -1;
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

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('original enemy formula parity', () => {
  let baseline: M4Baseline;
  let originalTune: (base: EnemyDef, target: number, tier?: number) => EnemyDef;
  let originalPhases: readonly BossPhase[];
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    const balance = await import(pathToFileURL(path.join(repoRoot, '.baseline/game/src/content/encounterBalance.ts')).href);
    const enemies = await import(pathToFileURL(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')).href);
    originalTune = balance.tuneEnemyCombatLevel;
    originalPhases = enemies.ORDRUN_PHASES;
  });

  it('replays every original combat-level and tuning probe', () => {
    for (const evidence of baseline.functions.filter(row => row.name === 'enemyCombatLevel' || row.name === 'tuneEnemyCombatLevel')) {
      expect(evidence.probes.length).toBeGreaterThan(0);
      for (const probe of evidence.probes) {
        const args = restore(probe.args) as [EnemyDef, number, number?];
        const invoke = () => evidence.name === 'enemyCombatLevel'
          ? combatLevel(params.combatLevel, args[0])
          : { ...args[0], ...tune(args[0], args[1], args[2] ?? args[0].tier, args[0].id) };
        if (probe.result.kind === 'throw') expect(invoke, probe.label).toThrow(probe.result.message);
        else expect(snapshot(invoke()), probe.label).toEqual(probe.result.value);
      }
    }
  });

  it('matches the 28 original marks rows, seven saved boss seeds and both phases', () => {
    const bossIds = Object.keys(params.regionalBossLevels) as LegacyBossId[];
    const bossEnemyIds = bossIds.map(bossId => bossId === 'ordrun' ? 'quarrykeeper_t10' : `${bossId}_t${params.regionalBossLevels[bossId].tier}`);
    const ordinary = baseline.original.blocks.filter(row => !bossEnemyIds.includes(row.id));
    expect(ordinary).toHaveLength(28);
    expect(ordinary.filter(row => row.family === 'reaver')).toHaveLength(4);
    for (const row of ordinary) expect(tierMarks(params.marksPerTier, row.tier, row.family === 'reaver' ? 'purse' : 'ordinary'), row.id).toEqual(row.marks);
    for (const [index, bossId] of bossIds.entries()) {
      const enemyId = bossEnemyIds[index]!;
      const original = baseline.original.blocks.find(row => row.id === enemyId)!;
      const result = deriveLegacyBoss(params, { id: `legacy/${enemyId}`, enemyId, bossId, seed: original });
      const expected = baseline.records.enemies.find(row => row.id === enemyId)!;
      expect(result, enemyId).toEqual(project(expected));
      if (bossId === 'ordrun') expect(ordrunPhases(params.ordrunPhases, result)).toEqual(originalPhases);
    }
  });

  it('matches original rounding, tie, bonus-cap and low-target failure behavior', () => {
    const base = baseline.original.blocks[0]!;
    const cases = [
      { input: base, target: 49.5 }, { input: base, target: 49.49 },
      { input: { ...base, maxHealth: 6, attackLevel: 1, defenceLevel: 1, accuracy: 0, armour: 0, magicArmour: 0, maxHit: 100 }, target: 1 },
      { input: { ...base, accuracy: 800, armour: 1000, magicArmour: 2000 }, target: 175 },
      { input: { ...base, maxHealth: .25 }, target: 6 },
      { input: { ...base, id: 'low_target', maxHealth: 1, attackLevel: 1e20, defenceLevel: 1e20 }, target: .5 },
    ];
    for (const { input, target } of cases) {
      let expected: EnemyDef;
      try { expected = originalTune(input, target, 20); }
      catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(() => tune(input, target, 20, input.id)).toThrow((error as Error).message);
        continue;
      }
      expect(tune(input, target, 20, input.id)).toEqual(project(expected));
    }
  });
});
