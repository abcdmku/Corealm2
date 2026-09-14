import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildLegacyEnemyInputs } from '../tools/content/enemy-formula-inputs.js';
import { buildCoreSourceLoot, CORE_SOURCE_LOOT_MODULES, type CoreSourceLootSources } from '../tools/content/source-loot-inputs.js';
import { buildEnemyAssemblySources, type EnemyAssemblySources, type EnemyAssemblyExtractionDependencies } from '../tools/content/enemy-assembly-source-inputs.js';
import { deriveEnemyAssemblySource, type EnemyAssemblySourceParams } from '../game/src/content/balance/enemyAssemblySources.js';
import { EnemyAssemblySourceSchema, EnemyAssemblySourcesSchema } from '../game/src/content/schema/enemyAssemblySources.js';
import { EnemySchema } from '../game/src/content/schema/enemies.js';
import { parseValue } from '../game/src/content/schema/core.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import type { EnemyDef } from '../game/src/content/index.js';

// Original Stage 1 operands, independently verified by the existing formula tests.
const originalParams: EnemyAssemblySourceParams = {
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
};

const sourcePath = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'number': case 'string': case 'boolean': return value.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return value.values.map(restore);
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    default: throw new Error(`Unexpected snapshot ${value.kind}`);
  }
}
describe('assembly source provenance guard', () => {
  it('rejects absent source hashes before using dependencies', () => {
    expect(() => buildEnemyAssemblySources({ source: { files: [] } } as unknown as M4Baseline,
      { enemies: '', redWorms: '' }, { legacyMarksInputs: [], legacyBossInputs: [], sourceLootInputs: [] })).toThrow(/source hash/);
  });
});
describe.skipIf(![...CORE_SOURCE_LOOT_MODULES, 'redWorms'].every(module => existsSync(sourcePath(module))))('original authored assembly sources', () => {
  let baseline: M4Baseline, sources: EnemyAssemblySources, dependencies: EnemyAssemblyExtractionDependencies;
  let params: EnemyAssemblySourceParams, extracted: ReturnType<typeof buildEnemyAssemblySources>;
  let loot: Map<string, EnemyDef['drops']>;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    sources = { enemies: readFileSync(sourcePath('enemies'), 'utf8'), redWorms: readFileSync(sourcePath('redWorms'), 'utf8') };
    const formula = buildLegacyEnemyInputs(baseline, sources.enemies);
    const core = buildCoreSourceLoot(baseline, Object.fromEntries(CORE_SOURCE_LOOT_MODULES.map(module =>
      [module, readFileSync(sourcePath(module), 'utf8')])) as CoreSourceLootSources);
    dependencies = { legacyMarksInputs: formula.legacyMarksInputs, legacyBossInputs: formula.legacyBossInputs, sourceLootInputs: core.inputs };
    params = { ...originalParams, legacyMarksInputs: formula.legacyMarksInputs, legacyBossInputs: formula.legacyBossInputs };
    loot = new Map(core.inputs.filter(row => row.kind === 'authored').map(row => [row.id, row.drops]));
    extracted = buildEnemyAssemblySources(baseline, sources, dependencies);
  });
  const find = (enemyId: string) => extracted.inputs.find(row => row.authored.id === enemyId)!;
  const derive = (enemyId: string) => deriveEnemyAssemblySource(params, find(enemyId), id => loot.get(id));
  function changed(module: keyof EnemyAssemblySources, original: string, replacement: string) {
    const next = { ...sources, [module]: sources[module].replace(original, replacement) }, evidence = structuredClone(baseline);
    expect(next[module]).not.toBe(sources[module]);
    evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
    return { next, evidence };
  }

  it('reproduces all 35 pre-Wilderness legacy blocks and the authored red worm', () => {
    expect(extracted.inputs).toHaveLength(36);
    expect(extracted.inputs.filter(row => row.kind === 'legacyMarksRemainder')).toHaveLength(28);
    expect(extracted.inputs.filter(row => row.kind === 'legacyBossRemainder')).toHaveLength(7);
    expect(extracted.inputs.filter(row => row.kind === 'redWorm')).toHaveLength(1);
    expect(extracted.inputs.slice(0, 35).map(row => row.authored.id)).toEqual(baseline.original.blocks.map(row => row.id));
    for (const row of extracted.inputs) {
      const expected = baseline.original.preWildernessBlocks.find(base => base.id === row.authored.id)!;
      const actual = deriveEnemyAssemblySource(params, row, id => loot.get(id));
      expect(actual, row.id).toStrictEqual(expected);
      expect(parseValue(EnemySchema, actual, row.id)).toStrictEqual(expected);
      expect(Object.hasOwn(actual, 'derivation')).toBe(false);
      if (row.kind !== 'redWorm') {
        expect(row.legacyInputId).toBe(`legacy/${row.authored.id}`);
        expect(row.lootInputId).toBe(row.legacyInputId);
        for (const field of ['tier', 'drops', ...(row.kind === 'legacyMarksRemainder' ? ['marks']
          : ['maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit'])])
          expect(Object.hasOwn(row.authored, field), `${row.id}.${field}`).toBe(false);
      }
    }
    expect(extracted.manifest.rows).toHaveLength(36);
    expect(extracted.manifest.sources).toHaveLength(2);
    const worm = find('red_worm_t1');
    expect(worm).toMatchObject({ id: 'assembly/authored/red_worm', kind: 'redWorm', drops: [] });
    const originalWorm = (restore(baseline.constants.find(row => row.module === 'redWorms' && row.name === 'RED_WORM_SPECIES')!.value) as { stats: EnemyDef }[])[0]!;
    expect(derive('red_worm_t1')).toStrictEqual(originalWorm.stats);
  });

  it('does not use baseline final fields or snapshots as authored inputs', () => {
    const evidence = structuredClone(baseline);
    evidence.original.blocks = evidence.original.blocks.map(row => ({ id: row.id }) as EnemyDef);
    evidence.original.preWildernessBlocks.length = 0; evidence.original.wildernessBlocks.length = 0;
    evidence.records.enemies.length = 0; evidence.records.lootTables.length = 0;
    for (const row of evidence.constants) if (row.value.kind === 'array') row.value.values.forEach(value => {
      if (value.kind === 'object') value.entries = value.entries.filter(([key]) => key === 'id');
    });
    expect(buildEnemyAssemblySources(evidence, sources, dependencies)).toStrictEqual(extracted);
    const health = changed('enemies', 'maxHealth: 6, attackLevel: 2, defenceLevel: 1', 'maxHealth: 7, attackLevel: 2, defenceLevel: 1');
    const updated = buildEnemyAssemblySources(health.evidence, health.next, dependencies).inputs.find(row => row.authored.id === 'frog_t1')!;
    expect(deriveEnemyAssemblySource(params, updated, id => loot.get(id)).maxHealth).toBe(7);
    const marks = changed('enemies', 'marks: [40, 90]', 'marks: [41, 91]');
    const boss = buildEnemyAssemblySources(marks.evidence, marks.next, dependencies).inputs.find(row => row.authored.id === 'galeskin_t1')!;
    expect(deriveEnemyAssemblySource(params, boss, id => loot.get(id)).marks).toEqual([41, 91]);
    const worm = changed('redWorms', 'maxHealth: 8', 'maxHealth: 9');
    const red = buildEnemyAssemblySources(worm.evidence, worm.next, dependencies).inputs.at(-1)!;
    expect(deriveEnemyAssemblySource(params, red, () => { throw new Error('Red worm must not resolve loot'); }).maxHealth).toBe(9);
  });

  it('joins changed marks inputs, boss seeds and target parameters without changing authored fields', () => {
    const frog = find('frog_t1'), original = derive('frog_t1');
    const p: EnemyAssemblySourceParams = { ...params, marksPerTier: { ordinary: [4, 12], purse: [8, 28] },
      legacyMarksInputs: params.legacyMarksInputs.map(row => row.enemyId === 'frog_t1' ? { ...row, tier: 2 } : row) };
    expect(deriveEnemyAssemblySource(p, frog, id => loot.get(id))).toStrictEqual({ ...original, tier: 2, marks: [8, 24] });
    expect(deriveEnemyAssemblySource(p, find('reaver_t1'), id => loot.get(id)).marks).toEqual([8, 28]);
    const boss = find('galeskin_t1'), before = derive('galeskin_t1');
    const changedTarget: EnemyAssemblySourceParams = { ...params, regionalBossLevels: { ...params.regionalBossLevels,
      galeskin: { tier: 2, multiplier: 11 } } };
    const result = deriveEnemyAssemblySource(changedTarget, boss, id => loot.get(id));
    expect(combatLevel(params.combatLevel, result)).toBe(22); expect(result.tier).toBe(2);
    expect(result.id).toBe('galeskin_t1'); expect(result.marks).toEqual(before.marks); expect(result.drops).toEqual(before.drops);
    const changedSeed: EnemyAssemblySourceParams = { ...params, legacyBossInputs: params.legacyBossInputs.map(row => row.enemyId === 'galeskin_t1'
      ? { ...row, seed: { ...row.seed, armour: 0, accuracy: 0 } } : row) };
    const seeded = deriveEnemyAssemblySource(changedSeed, boss, id => loot.get(id));
    expect(seeded.armour).toBe(0); expect(seeded.accuracy).toBe(0); expect(seeded).not.toEqual(before);
    expect(combatLevel(params.combatLevel, seeded)).toBe(11);
  });

  it('preserves optional absence and returns independent marks and drop quantities', () => {
    const savedInputs = structuredClone(extracted.inputs), savedParams = structuredClone(params), savedLoot = structuredClone(loot);
    for (const row of extracted.inputs) {
      const first = deriveEnemyAssemblySource(params, row, id => loot.get(id)), saved = structuredClone(first);
      const second = deriveEnemyAssemblySource(params, row, id => loot.get(id));
      if (second.marks) second.marks[0] = 999;
      if (second.drops[0]) { second.drops[0].quantity[0] = 999; second.drops[0].chance = 0; }
      expect(first).toStrictEqual(saved);
    }
    expect(extracted.inputs).toStrictEqual(savedInputs); expect(params).toStrictEqual(savedParams); expect(loot).toStrictEqual(savedLoot);
    const frog = derive('frog_t1');
    for (const key of ['attackStyle', 'attackRangeM', 'respawnSeconds']) expect(Object.hasOwn(frog, key)).toBe(false);
    const grouped: EnemyDef['drops'] = [{ itemId: 'probe', quantity: [1, 2], chance: .5, exclusiveGroup: 'pair' }];
    expect(deriveEnemyAssemblySource(params, find('frog_t1'), () => grouped).drops).toStrictEqual(grouped);
    const boss = find('galeskin_t1');
    if (boss.kind !== 'legacyBossRemainder') throw new Error('Wrong fixture');
    const authored = { ...boss.authored, attackStyle: 'magic' as const, attackRangeM: 8, respawnSeconds: 0 };
    expect(deriveEnemyAssemblySource(params, { ...boss, authored }, id => loot.get(id)))
      .toMatchObject({ attackStyle: 'magic', attackRangeM: 8, respawnSeconds: 0 });
    const withoutMarks = structuredClone(boss); Reflect.deleteProperty(withoutMarks.authored, 'marks');
    expect(Object.hasOwn(deriveEnemyAssemblySource(params, withoutMarks, id => loot.get(id)), 'marks')).toBe(false);
  });

  it('rejects omitted, duplicate, wrong-owner or wrong-kind dependencies', () => {
    const frog = find('frog_t1'), boss = find('galeskin_t1');
    expect(() => deriveEnemyAssemblySource(params, frog, () => undefined)).toThrow(/Missing original loot/);
    expect(() => deriveEnemyAssemblySource({ ...params, legacyMarksInputs: [] }, frog, id => loot.get(id))).toThrow(/marks dependency/);
    expect(() => deriveEnemyAssemblySource({ ...params, legacyBossInputs: [] }, boss, id => loot.get(id))).toThrow(/boss dependency/);
    expect(() => deriveEnemyAssemblySource({ ...params, legacyMarksInputs: [...params.legacyMarksInputs, params.legacyMarksInputs[0]!] }, frog, id => loot.get(id))).toThrow(/marks dependency/);
    if (frog.kind !== 'legacyMarksRemainder') throw new Error('Wrong fixture');
    expect(() => deriveEnemyAssemblySource(params, { ...frog, lootInputId: 'legacy/hen_t1' }, id => loot.get(id))).toThrow(/references disagree/);
    expect(() => deriveEnemyAssemblySource(params, { ...frog, legacyInputId: 'legacy/galeskin_t1' }, id => loot.get(id))).toThrow();
    expect(() => buildEnemyAssemblySources(baseline, sources, { ...dependencies, sourceLootInputs: [] })).toThrow(/authored loot input/);
    expect(() => buildEnemyAssemblySources(baseline, sources, { ...dependencies, legacyMarksInputs: [] })).toThrow(/28 unique/);
    const altered = structuredClone(dependencies);
    const lootInput = altered.sourceLootInputs.find(row => row.id === 'legacy/frog_t1')!;
    if (lootInput.kind !== 'authored') throw new Error('Wrong fixture');
    lootInput.drops[0]!.chance = .123;
    expect(() => buildEnemyAssemblySources(baseline, sources, altered)).toThrow(/loot arguments disagree/);
  });

  it('rejects excluded schema fields, nonempty red-worm drops and unsupported source expressions', () => {
    for (const row of extracted.inputs) {
      expect(() => parseValue(EnemyAssemblySourceSchema, { ...row, derivation: {} }, 'input')).toThrow(/unknown/i);
      const forbidden = row.kind === 'redWorm' ? ['drops'] : row.kind === 'legacyMarksRemainder' ? ['tier', 'marks', 'drops']
        : ['tier', 'maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit', 'drops'];
      for (const field of forbidden) expect(() => parseValue(EnemyAssemblySourceSchema,
        { ...row, authored: { ...row.authored, [field]: 1 } }, 'input')).toThrow(/unknown/i);
    }
    expect(() => parseValue(EnemyAssemblySourcesSchema, [extracted.inputs[0], extracted.inputs[0]], 'inputs')).toThrow(/unique/);
    const worm = find('red_worm_t1');
    expect(() => parseValue(EnemyAssemblySourceSchema, { ...worm, drops: [{ itemId: 'probe', quantity: [1, 1], chance: 1 }] }, 'worm')).toThrow();
    for (const [module, original, replacement] of [
      ['enemies', 'maxHealth: 6, attackLevel: 2', 'maxHealth: 3 + 3, attackLevel: 2'],
      ['enemies', 'marks: marksFor(1)', 'marks: [3, 11]'],
      ['enemies', 'maxHealth: 50, attackLevel: 8', 'maxHealth: 51, attackLevel: 8'],
      ['enemies', 'marks: [40, 90]', 'marks: marksFor(40)'],
      ['redWorms', 'drops: []', 'drops: [{ itemId: "probe", quantity: [1, 1], chance: 1 }]'],
      ['redWorms', 'maxHealth: 8', '...base, maxHealth: 8'],
    ] as const) {
      const edit = changed(module, original, replacement);
      expect(() => buildEnemyAssemblySources(edit.evidence, edit.next, dependencies)).toThrow();
    }
    for (const module of ['enemies', 'redWorms'] as const) expect(() => buildEnemyAssemblySources(baseline,
      { ...sources, [module]: sources[module] + '\n' }, dependencies)).toThrow(/source hash/);
  });
});
