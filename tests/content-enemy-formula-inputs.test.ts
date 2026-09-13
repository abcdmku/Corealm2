import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLegacyEnemyInputs } from '../tools/content/enemy-formula-inputs.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

const sourcePath = '.baseline/game/src/content/enemies.ts';
function withSource(baseline: M4Baseline, source: string): M4Baseline {
  const copy = structuredClone(baseline);
  copy.source.files.find(row => row.path === sourcePath)!.sha256 = createHash('sha256').update(source).digest('hex');
  return copy;
}

// This fixture deliberately lacks final records and export snapshots. Extraction cannot depend on them.
function fixture() {
  const ids = [
    'frog_t1', 'hen_t1', 'goat_t1', 'cattle_t1', 'coney_t1', 'viper_t1', 'reaver_t1',
    'deer_t5', 'hog_t5', 'coyote_t5', 'frog_t5', 'coney_t5', 'viper_t5', 'reaver_t5',
    'bear_t10', 'boar_t10', 'ibex_t10', 'aurochs_t10', 'reaver_t10', 'coyote_t10', 'rat_t10', 'scorpion_t10', 'crab_t10',
    'bear_t20', 'boar_t20', 'ibex_t20', 'viper_t20', 'reaver_t20',
    'galeskin_t1', 'tempest_roc_t1', 'mossbound_t5', 'rootheart_t5', 'tideworn_t10', 'quarrykeeper_t10', 'cinderwake_t20',
  ];
  const seed = { maxHealth: 6, attackLevel: 2, defenceLevel: 1, accuracy: 0, armour: 0, magicArmour: 0, maxHit: 2 };
  const blocks = ids.map(id => ({ id, ...seed }));
  const source = `const BLOCKS: readonly EnemyDef[] = [${ids.map((id, index) => {
    const tier = id.split('_t')[1];
    return `{id:'${id}', tier:${tier}, ${Object.entries(seed).map(([key, value]) => `${key}:${value}`).join(',')},
      marks:${index < 28 ? `${id.startsWith('reaver_') ? 'purseMarksFor' : 'marksFor'}(${tier})` : '[80,140]'}}`;
  }).join(',')}];
  const ORDRUN_PHASES = [
    {atHealthFraction:1,armour:balancedOrdrun.armour,attackSpeedMs:3000,maxHit:balancedOrdrun.maxHit},
    {atHealthFraction:.55,armour:Math.round(balancedOrdrun.armour * 50 / 62),attackSpeedMs:2400,
      maxHit:Math.round(balancedOrdrun.maxHit * 14 / 12),telegraphId:'ground_slam',telegraphWindupMs:1800,telegraphRadiusM:6},
  ];`;
  const baseline = { source: { root: '.baseline', files: [{ path: sourcePath, sha256: '' }] }, original: { blocks } } as M4Baseline;
  return { source, baseline: withSource(baseline, source) };
}

describe('legacy enemy literal extraction rejects unsupported inputs', () => {
  it('reads only original source inputs, tolerates comments, and does not mutate input evidence', () => {
    const { baseline, source } = fixture();
    const before = structuredClone(baseline);
    const output = buildLegacyEnemyInputs(baseline, source);
    expect(output.legacyMarksInputs).toHaveLength(28);
    expect(output.legacyBossInputs).toHaveLength(7);
    expect(baseline).toEqual(before);
    output.legacyBossInputs[0]!.seed.maxHealth = 900;
    expect(baseline).toEqual(before);
    const commented = `// const BLOCKS = [];\n/* marks: marksFor(900) */\n${source}`;
    expect(buildLegacyEnemyInputs(withSource(baseline, commented), commented).legacyMarksInputs).toEqual(output.legacyMarksInputs);
  });

  it('requires matching original source provenance', () => {
    const { baseline, source } = fixture();
    expect(() => buildLegacyEnemyInputs(baseline, source + '\n')).toThrow('source hash');
  });

  it.each([
    ['marksFor(1)', 'marksFor(1 + 0)', 'one-argument call'],
    ['marksFor(1)', 'marksFor(finalEnemy.tier)', 'one-argument call'],
    ['marksFor(1)', '[3,11]', '28 original marks call sites'],
    ['purseMarksFor(1)', 'marksFor(1)', 'four original purse'],
    ['tier:1,', 'tier:2,', 'marks tier mismatch'],
    ["id:'frog_t1'", "id:'frog_t1',id:'frog_t1'", 'Duplicate property'],
    ['balancedOrdrun.armour * 50 / 62', 'balancedOrdrun.armour * (50 / 62)', 'Unsupported Ordrun armour ratio'],
    ['balancedOrdrun.armour * 50 / 62', 'balancedOrdrun.armour * 50 / 0', 'denominator must be positive'],
    ['const BLOCKS: readonly EnemyDef[] = [', 'const BLOCKS: readonly EnemyDef[] = make([', 'literal array'],
  ])('rejects %s replaced by %s', (before, after, error) => {
    const { baseline, source } = fixture(); const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => buildLegacyEnemyInputs(withSource(baseline, changed), changed)).toThrow(error);
  });

  it('rejects missing, renamed, reordered and tuned boss seed evidence', () => {
    const { baseline, source } = fixture();
    const missing = structuredClone(baseline); missing.original.blocks.pop();
    expect(() => buildLegacyEnemyInputs(missing, source)).toThrow('35 original');
    const renamed = structuredClone(baseline); renamed.original.blocks[0]!.id = 'other';
    expect(() => buildLegacyEnemyInputs(renamed, source)).toThrow('identities/order');
    const reordered = structuredClone(baseline); reordered.original.blocks.reverse();
    expect(() => buildLegacyEnemyInputs(reordered, source)).toThrow('identities/order');
    const tuned = structuredClone(baseline); tuned.original.blocks.find(row => row.id === 'quarrykeeper_t10')!.maxHealth = 1000;
    expect(() => buildLegacyEnemyInputs(tuned, source)).toThrow('original seed differs from source literal');
  });

  it('rejects additional calls outside the original BLOCKS array', () => {
    const { baseline, source } = fixture(); const extra = source + '\nconst extra = marksFor(1);';
    expect(() => buildLegacyEnemyInputs(withSource(baseline, extra), extra)).toThrow('28 original marks call sites');
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, sourcePath)))('true baseline legacy enemy input extraction', () => {
  let baseline: M4Baseline, source: string;
  beforeAll(async () => { baseline = await buildM4Baseline(); source = readFileSync(path.join(repoRoot, sourcePath), 'utf8'); });

  it('captures 24 ordinary calls, four purse calls, seven literal boss seeds, and two phase parameter rows', () => {
    const result = buildLegacyEnemyInputs(baseline, source);
    expect(result.legacyMarksInputs).toHaveLength(28);
    const literalCalls = [...source.matchAll(/id: "([^"]+)"[^{}]*?marks: (purseMarksFor|marksFor)\((\d+)\)/g)];
    expect(literalCalls).toHaveLength(28);
    expect(result.legacyMarksInputs).toEqual(literalCalls.map(([, enemyId, helper, tier]) => ({
      id: `legacy/${enemyId}`, enemyId, tier: Number(tier), profile: helper === 'marksFor' ? 'ordinary' : 'purse',
    })));
    expect(result.legacyMarksInputs.filter(row => row.profile === 'ordinary')).toHaveLength(24);
    expect(result.legacyMarksInputs.filter(row => row.profile === 'purse').map(row => [row.enemyId, row.tier])).toEqual([
      ['reaver_t1', 1], ['reaver_t5', 5], ['reaver_t10', 10], ['reaver_t20', 20],
    ]);
    expect(result.legacyBossInputs).toHaveLength(7);
    for (const row of result.legacyBossInputs) {
      const original = baseline.original.blocks.find(block => block.id === row.enemyId)!;
      expect(row.seed).toEqual(Object.fromEntries(Object.keys(row.seed).map(key => [key, original[key as keyof typeof original]])));
      expect(row.id).toBe(`legacy/${row.enemyId}`);
    }
    expect(result.legacyBossInputs.find(row => row.bossId === 'ordrun')).toEqual({
      id: 'legacy/quarrykeeper_t10', enemyId: 'quarrykeeper_t10', bossId: 'ordrun',
      seed: { maxHealth: 200, attackLevel: 24, defenceLevel: 20, accuracy: 15, armour: 62, magicArmour: 18, maxHit: 12 },
    });
    expect(result.ordrunPhases).toEqual([
      { atHealthFraction: 1, attackSpeedMs: 3000 },
      { atHealthFraction: .55, armourNumerator: 50, armourDenominator: 62, attackSpeedMs: 2400,
        maxHitNumerator: 14, maxHitDenominator: 12, telegraphId: 'ground_slam', telegraphWindupMs: 1800, telegraphRadiusM: 6 },
    ]);
    expect(result.manifest.source).toEqual(baseline.source.files.find(row => row.path === sourcePath));
    expect(result.manifest.rows).toHaveLength(37);
    for (const origin of result.manifest.rows.filter(row => row.symbol === 'BLOCKS')) {
      expect(origin.inputId).toBe(`legacy/${baseline.original.blocks[origin.rowIndex]!.id}`);
    }
  });

  it('ignores altered final combat and mark outputs', () => {
    const altered = structuredClone(baseline);
    for (const row of altered.records.enemies) { row.maxHealth = 999999; row.marks = [999999, 999999]; }
    expect(buildLegacyEnemyInputs(altered, source)).toEqual(buildLegacyEnemyInputs(baseline, source));
  });
});
