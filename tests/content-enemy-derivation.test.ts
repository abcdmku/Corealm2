import { describe, expect, it } from 'vitest';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { ENEMY_DATA } from '../game/src/content/enemyData.js';
import { derivationDiffs, deriveRecord } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemyDerivationSchema } from '../game/src/content/schema/enemyDerivation.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { parseValue } from '../game/src/content/schema/core.js';

// Each proposal starts from raw JSON, so graph checks cannot accidentally use cached runtime rows.
function proposal() {
  const rows = structuredClone(rawEnemies) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  const tables = new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]);
  return { rows, params, tables };
}
function rowFor(rows: Record<string, unknown>[], id: string) {
  const row = rows.find(row => row.id === id);
  if (!row) throw new Error(`Missing test enemy ${id}`);
  return row;
}
function changeAt(value: object, path: string, replacement: unknown): void {
  const keys = path.split('.'); let parent = value as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  if (replacement === undefined) delete parent[keys.at(-1)!];
  else parent[keys.at(-1)!] = replacement;
}

describe('legacy enemy derivation previews', () => {
  it('recomputes every shipped tag with exactly its owned fields and no drift', () => {
    const { rows, params, tables } = proposal();
    expect(rows.filter(row => String((row.derivation as { kind?: string } | undefined)?.kind).startsWith('legacy'))).toHaveLength(35);
    expect(params.legacyMarksInputs).toHaveLength(28);
    expect(params.legacyBossInputs).toHaveLength(7);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]);
    expect(derivationDiffs(tables)).toEqual([]);
    for (const row of rows.filter(row => String((row.derivation as { kind?: string } | undefined)?.kind).startsWith('legacy'))) {
      parseValue(EnemyRecordSchema, row, `enemies.${row.id}`);
      const tag = parseValue(EnemyDerivationSchema, row.derivation, 'derivation');
      const result = deriveRecord('enemies', row, tables)!;
      expect(Object.keys(result).sort()).toEqual(tag.kind === 'legacyMarks.v1' ? ['marks']
        : ['accuracy', 'armour', 'attackLevel', 'defenceLevel', 'magicArmour', 'maxHealth', 'maxHit', 'tier']);
      expect(result, String(row.id)).toEqual(Object.fromEntries(Object.keys(result).map(key => [key, row[key]])));
    }
  });

  it.each(['seed', 'multiplier', 'both'] as const)('previews a changed %s while keeping stored runtime enemies and proposed records intact', change => {
    const { rows, params, tables } = proposal();
    const runtimeBefore = structuredClone(ENEMY_DATA), recordsBefore = structuredClone(rows);
    if (change !== 'multiplier') params.legacyBossInputs.find(row => row.bossId === 'ordrun')!.seed.maxHit *= 2;
    if (change !== 'seed') params.regionalBossLevels.ordrun.multiplier += 1;
    const paramsBefore = structuredClone(params);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]);
    const diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ collection: 'enemies', recordId: 'quarrykeeper_t10', kind: 'legacyBossCombat.v1', inputIds: ['legacy/quarrykeeper_t10'] });
    expect(diffs[0]!.after).not.toEqual(diffs[0]!.before);
    if (change === 'seed') expect(diffs[0]!.after.maxHit).toBeGreaterThan(diffs[0]!.before.maxHit as number);
    expect(rows).toEqual(recordsBefore);
    expect(params).toEqual(paramsBefore);
    expect(ENEMY_DATA).toEqual(runtimeBefore);
  });

  it('previews all 28 marks changes without changing boss rewards or unrelated authored fields', () => {
    const { rows, params, tables } = proposal();
    const before = structuredClone(rows);
    params.marksPerTier.ordinary = [4, 12]; params.marksPerTier.purse = [8, 28];
    const diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(28);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(params.legacyMarksInputs.map(row => row.enemyId).sort());
    for (const diff of diffs) {
      expect(diff.kind).toBe('legacyMarks.v1');
      expect(Object.keys(diff.before)).toEqual(['marks']); expect(Object.keys(diff.after)).toEqual(['marks']);
      const input = params.legacyMarksInputs.find(row => row.enemyId === diff.recordId)!;
      expect(diff.after.marks).toEqual(params.marksPerTier[input.profile].map(multiplier => input.tier * multiplier));
    }
    expect(rows).toEqual(before);
  });

  it('removes a formula lock without removing or recomputing stored values', () => {
    const { rows, params, tables } = proposal();
    const row = rowFor(rows, 'frog_t1'); const { derivation: _tag, ...stored } = structuredClone(row);
    params.marksPerTier.ordinary = [4, 12];
    expect(derivationDiffs(tables)).toHaveLength(24);
    delete row.derivation;
    expect(deriveRecord('enemies', row, tables)).toBeUndefined();
    expect(derivationDiffs(tables)).toHaveLength(23);
    expect(row).toEqual(stored);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]);
  });
});

describe('strict enemy formula parameter schemas', () => {
  it.each([
    ['unexpected', 1], ['marksPerTier.extra', [1, 2]], ['legacyMarksInputs.0.marks', [3, 11]],
    ['legacyBossInputs.0.seed.tier', 1], ['legacyBossInputs.0.seed.maxHealth', 0],
    ['legacyBossInputs.0.seed.accuracy', -1], ['legacyBossInputs.0.seed.maxHit', Number.POSITIVE_INFINITY],
    ['legacyMarksInputs.0.tier', 1.5], ['legacyMarksInputs.0.profile', 'guessed'],
    ['legacyBossInputs.0.bossId', 'quarrykeeper'], ['marksPerTier.ordinary', [12, 3]],
    ['combatLevel.offenceWeight', .6], ['combatLevel.healthWeight', 0], ['combatLevel.bonusDivisor', 0],
    ['tuning.healthPerCombatLevel', 13], ['tuning.minimumBonus', 81], ['tuning.minimumBonus', 10.5], ['tuning.maximumBonus', -1],
    ['tuning.searchInitialLow', 1], ['tuning.searchInitialHigh', 0], ['tuning.searchGrowth', 1],
    ['tuning.searchIterations', 1.5], ['regionCombatTiers.fallowmarch', undefined],
    ['regionCombatTiers.extra', 1], ['regionalBossLevels.ordrun', undefined], ['regionalBossLevels.extra', { tier: 1, multiplier: 1 }],
    ['ordrunPhases.1.atHealthFraction', 1], ['ordrunPhases.1.armourDenominator', 0],
    ['ordrunPhases.1.telegraphRadiusM', 0], ['ordrunPhases.0.armour', 62],
  ])('rejects invalid %s', (path, replacement) => {
    const { params } = proposal(); changeAt(params, path as string, replacement);
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).toThrow();
  });

  it('accepts fractional authored seed health', () => {
    const { params } = proposal(); params.legacyBossInputs[0]!.seed.maxHealth = 50.5;
    expect(parseValue(EnemyBalanceSchema, params, 'balance/enemies').legacyBossInputs[0]!.seed.maxHealth).toBe(50.5);
  });

  it.each(['marks', 'boss', 'cross-kind id', 'cross-kind target'] as const)('rejects duplicate %s inputs', kind => {
    const { params } = proposal();
    if (kind === 'marks') params.legacyMarksInputs.push(structuredClone(params.legacyMarksInputs[0]!));
    if (kind === 'boss') params.legacyBossInputs.push(structuredClone(params.legacyBossInputs[0]!));
    if (kind === 'cross-kind id') changeAt(params, 'legacyBossInputs.0.id', params.legacyMarksInputs[0]!.id);
    if (kind === 'cross-kind target') params.legacyBossInputs[0]!.enemyId = params.legacyMarksInputs[0]!.enemyId;
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).toThrow(/unique/);
  });

  it.each([
    { kind: 'legacyMarks.v2', inputId: 'legacy/frog_t1' },
    { kind: 'legacyMarks.v1', inputId: 'legacy/frog_t1', tier: 1 },
    { kind: 'legacyBossCombat.v1', inputId: 'legacy/quarrykeeper_t10', seed: {} },
    { kind: 'legacyMarks.v1', inputId: '' },
  ])('rejects unknown or extra tag fields: %j', tag => {
    expect(() => parseValue(EnemyDerivationSchema, tag, 'derivation')).toThrow();
    const { rows, tables } = proposal(); rowFor(rows, 'frog_t1').derivation = tag;
    expect(() => deriveRecord('enemies', rowFor(rows, 'frog_t1'), tables)).toThrow();
  });
});

describe('enemy formula links use proposed input and target identities', () => {
  it('rejects coordinated swaps of saved boss targets even when every tag still matches its input', () => {
    const { rows, params, tables } = proposal();
    const ordrun = params.legacyBossInputs.find(input => input.bossId === 'ordrun')!;
    const galeskin = params.legacyBossInputs.find(input => input.bossId === 'galeskin')!;
    [ordrun.enemyId, galeskin.enemyId] = [galeskin.enemyId, ordrun.enemyId];
    for (const input of [ordrun, galeskin]) {
      rowFor(rows, input.enemyId).derivation = { kind: 'legacyBossCombat.v1', inputId: input.id };
    }
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).not.toThrow();
    expect(validateEnemyFormulaLinks(tables)).toEqual([ordrun, galeskin]
      .sort((left, right) => params.legacyBossInputs.indexOf(left) - params.legacyBossInputs.indexOf(right))
      .map(input => ({ path: `balance/enemies.legacyBossInputs.${input.id}.enemyId`, severity: 'error',
        message: 'Boss input must retain its original saved enemy identity' })));
  });

  it('rejects ordinary marks assigned to a saved boss after removing its combat formula', () => {
    const { rows, params, tables } = proposal();
    const input = params.legacyMarksInputs.find(input => input.enemyId === 'frog_t1')!;
    delete rowFor(rows, input.enemyId).derivation;
    params.legacyBossInputs = params.legacyBossInputs.filter(input => input.bossId !== 'ordrun');
    input.enemyId = 'quarrykeeper_t10';
    rowFor(rows, input.enemyId).derivation = { kind: 'legacyMarks.v1', inputId: input.id };
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).not.toThrow();
    expect(validateEnemyFormulaLinks(tables)).toEqual([{
      path: `balance/enemies.legacyMarksInputs.${input.id}.enemyId`, severity: 'error',
      message: 'Legacy boss marks are authored and cannot use an ordinary marks input',
    }]);
  });

  it.each([
    ['unknown input', 'frog_t1', { kind: 'legacyMarks.v1', inputId: 'legacy/missing' }],
    ['wrong kind', 'frog_t1', { kind: 'legacyBossCombat.v1', inputId: 'legacy/frog_t1' }],
    ['another marks target', 'frog_t1', { kind: 'legacyMarks.v1', inputId: 'legacy/hen_t1' }],
    ['another boss target', 'quarrykeeper_t10', { kind: 'legacyBossCombat.v1', inputId: 'legacy/galeskin_t1' }],
  ] as const)('rejects %s', (_label, id, tag) => {
    const { rows, tables } = proposal(); rowFor(rows, id).derivation = tag;
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({
      path: `enemies.${id}.derivation.inputId`, severity: 'error',
    }));
    expect(() => deriveRecord('enemies', rowFor(rows, id), tables)).toThrow(/Invalid legacy/);
  });

  it.each(['missing', 'nonlegacy', 'lab'] as const)('rejects input targeting %s enemy even without a tag', kind => {
    const { rows, params, tables } = proposal();
    const input = params.legacyMarksInputs[0]!; const originalId = input.enemyId;
    delete rowFor(rows, originalId).derivation;
    input.enemyId = kind === 'missing' ? 'missing_enemy' : String(rows.find(row => kind === 'lab'
      ? row.stage === 'labOnly' : row.stage === 'registered' && row.catalog !== 'LEGACY_BLOCKS')!.id);
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({
      path: `balance/enemies.legacyMarksInputs.${input.id}.enemyId`, severity: 'error',
    }));
  });

  it.each(['nonlegacy', 'lab'] as const)('rejects a %s target even when tag and input agree', kind => {
    const { rows, params, tables } = proposal();
    const input = params.legacyMarksInputs[0]!; delete rowFor(rows, input.enemyId).derivation;
    const target = rows.find(row => kind === 'lab' ? row.stage === 'labOnly'
      : row.stage === 'registered' && row.catalog !== 'LEGACY_BLOCKS')!;
    input.enemyId = String(target.id); target.derivation = { kind: 'legacyMarks.v1', inputId: input.id };
    const issues = validateEnemyFormulaLinks(tables);
    expect(issues).toContainEqual(expect.objectContaining({ path: `enemies.${target.id}.derivation`, severity: 'error' }));
    expect(() => deriveRecord('enemies', target, tables)).toThrow('registered legacy canonical');
    if (kind === 'lab') expect(() => parseValue(EnemyRecordSchema, target, 'enemies.lab')).toThrow();
  });

  it('detects proposed input removal rather than resolving against the runtime loader', () => {
    const { params, tables } = proposal();
    params.legacyMarksInputs = params.legacyMarksInputs.filter(row => row.enemyId !== 'frog_t1');
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({
      path: 'enemies.frog_t1.derivation.inputId', severity: 'error',
    }));
  });
});
