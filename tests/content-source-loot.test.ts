import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildCoreSourceLoot, CORE_SOURCE_LOOT_MODULES, type CoreSourceLootSources } from '../tools/content/source-loot-inputs.js';
import { deriveSourceLoot, type SourceLootInput } from '../game/src/content/balance/sourceLoot.js';
import { SourceLootInputSchema, SourceLootInputsSchema, SourceLootParamsSchema } from '../game/src/content/schema/sourceLoot.js';
import { DropSchema } from '../game/src/content/schema/loot.js';
import { arr, parseValue } from '../game/src/content/schema/core.js';
import type { EnemyDef } from '../game/src/content/index.js';
import { repoRoot } from '../tools/lib/paths.js';

function plain(value: Snapshot): unknown {
  switch (value.kind) {
    case 'number': case 'string': case 'boolean': return value.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return value.values.map(plain);
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, plain(entry)]));
    default: throw new Error(`Unexpected snapshot ${value.kind}`);
  }
}
let baseline: M4Baseline, sources: CoreSourceLootSources, extracted: ReturnType<typeof buildCoreSourceLoot>;
const baselineAvailable = existsSync(new URL('../.baseline/game/src/content/enemies.ts', import.meta.url));
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(CORE_SOURCE_LOOT_MODULES.map(module => [module,
    readFileSync(path.join(repoRoot, `.baseline/game/src/content/${module}.ts`), 'utf8')])) as CoreSourceLootSources;
  extracted = buildCoreSourceLoot(baseline, sources);
});
const input = (id: string) => extracted.inputs.find(row => row.id === id)!;
function generate() {
  const result = new Map<string, EnemyDef['drops']>();
  for (const row of extracted.inputs) result.set(row.id, deriveSourceLoot(extracted.params, row, result));
  return result;
}
function changed(module: keyof CoreSourceLootSources, original: string, replacement: string) {
  const next = { ...sources, [module]: sources[module].replace(original, replacement) };
  expect(next[module]).not.toBe(sources[module]);
  const evidence = structuredClone(baseline);
  evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
  return { next, evidence };
}

describe.skipIf(!baselineAvailable)('original core source loot', () => {
  it('extracts all 114 original inputs and preserves the original ordered drop arrays', () => {
    expect(extracted.inputs).toHaveLength(114);
    expect(Object.fromEntries(['authored', 'starter', 'rpg', 'variantAppend', 'redesignEssence', 'inherit']
      .map(kind => [kind, extracted.inputs.filter(row => row.kind === kind).length])))
      .toEqual({ authored: 59, starter: 7, rpg: 25, variantAppend: 5, redesignEssence: 13, inherit: 5 });
    const generated = generate();
    for (const origin of extracted.manifest.rows) {
      const join = extracted.sourceInputJoins.find(row => row.inputId === origin.inputId)!;
      const expected = origin.module === 'enemies' ? baseline.original.blocks[origin.rowIndex]!.drops
        : (plain(baseline.constants.find(row => row.module === origin.module && row.name === origin.catalog)!.value) as
          { id: string; stats: EnemyDef }[]).find(row => row.id === join.speciesId)!.stats.drops;
      expect(generated.get(origin.inputId), origin.inputId).toStrictEqual(expected);
      expect(parseValue(arr(DropSchema), generated.get(origin.inputId), origin.inputId)).toStrictEqual(expected);
    }
    expect(extracted.ownerProposals.filter(row => !row.formula).every(row => input(row.inputId).kind === 'authored')).toBe(true);
    expect(extracted.manifest.sources).toHaveLength(9);
    expect(extracted.sourceInputJoins).toHaveLength(114);
  });

  it('reads authored arrays and factory arguments while ignoring original output drops', () => {
    const evidence = structuredClone(baseline);
    evidence.records.enemies.length = 0;
    evidence.records.lootTables.forEach(row => { row.drops = []; });
    evidence.original.blocks.forEach(row => { row.drops = []; });
    for (const row of evidence.constants) {
      if (!CORE_SOURCE_LOOT_MODULES.includes(row.module as keyof CoreSourceLootSources) || row.value.kind !== 'array') continue;
      row.value.values.forEach(value => { if (value.kind === 'object') value.entries = value.entries.filter(([key]) => key === 'id'); });
    }
    expect(buildCoreSourceLoot(evidence, sources)).toStrictEqual(extracted);
    const edit = changed('creatureExpansion', 'drop("fox_guardhair", 1, 2, 0.65)', 'drop("fox_guardhair", 2, 3, 0.45)');
    const updated = buildCoreSourceLoot(edit.evidence, edit.next);
    expect(updated.inputs.find(row => row.id === 'expansion/redbrush_fox')).toMatchObject({ drops: [{ itemId: 'fox_guardhair', quantity: [2, 3], chance: .45 }, {}, {}] });
    const starter = changed('starterCreatures', '"prowl", "venom_gland"', '"prowl", "earth_essence"');
    expect(buildCoreSourceLoot(starter.evidence, starter.next).inputs.find(row => row.id === 'starter/grass_viper'))
      .toMatchObject({ itemId: 'earth_essence' });
  });

  it('extracts changed roll operands and item choices from original source', () => {
    for (const [module, original, replacement, check] of [
      ['starterCreatures', 'chance: 0.65', 'chance: 0.55', (value: typeof extracted) => expect(value.params.starter.chance).toBe(.55)],
      ['rpgBestiary', 'Math.ceil(tier / 10)', 'Math.ceil(tier / 8)', (value: typeof extracted) => expect(value.params.rpg.quantityTierDivisor).toBe(8)],
      ['rpgBestiary', 'fallowmarch: "air_essence"', 'fallowmarch: "fire_essence"', (value: typeof extracted) => expect(value.params.rpg.essenceByRegion.fallowmarch).toBe('fire_essence')],
      ['regionalCreatureVariants', 'chance: .25', 'chance: .3', (value: typeof extracted) => expect(value.params.variantAppend.chance).toBe(.3)],
      ['creatureRedesign', "'water_essence' : 'earth_essence'", "'air_essence' : 'fire_essence'", (value: typeof extracted) => expect(value.inputs.find(row => row.id === 'basic/chalk_warden')).toMatchObject({ essenceItemId: 'air_essence' })],
      ['forestCreatureRedesigns', 'chance: .35', 'chance: .5', (value: typeof extracted) => expect(value.params.redesignEssence.forest.chance).toBe(.5)],
      ['ashCreatureRedesigns', 'quantity: [1, 2]', 'quantity: [2, 4]', (value: typeof extracted) => expect(value.params.redesignEssence.ash.quantity).toEqual([2, 4])],
    ] as const) {
      const edit = changed(module, original, replacement); check(buildCoreSourceLoot(edit.evidence, edit.next));
    }
  });

  it('uses all roll families and RPG quantity, role, region parameters', () => {
    const p = structuredClone(extracted.params), dependencies = generate();
    p.starter = { quantity: [2, 4], chance: .8 };
    p.variantAppend = { quantity: [3, 5], chance: .9 };
    for (const profile of ['basic', 'forest', 'ash'] as const) p.redesignEssence[profile] = { quantity: [4, 6], chance: .7 };
    for (const row of extracted.inputs) {
      const actual = deriveSourceLoot(p, row, dependencies);
      if (row.kind === 'starter') expect(actual).toEqual([{ itemId: row.itemId, quantity: [2, 4], chance: .8 }]);
      if (row.kind === 'variantAppend') expect(actual).toEqual([...dependencies.get(row.sourceInputId)!, { itemId: row.essenceItemId, quantity: [3, 5], chance: .9 }]);
      if (row.kind === 'redesignEssence') expect(actual).toEqual([{ itemId: row.essenceItemId, quantity: [4, 6], chance: .7 }]);
    }
    p.rpg.quantityMinimum = 2; p.rpg.quantityMaximumMinimum = 3; p.rpg.quantityTierDivisor = 4;
    p.rpg.chance = { caster: .8, other: .2 };
    for (const region of ['fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt'] as const) {
      p.rpg.essenceByRegion[region] = `${region}_probe`;
      for (const role of ['caster', 'fighter', 'guard', 'brute', 'skirmisher'] as const) {
        const row: SourceLootInput = { id: 'rpg/probe', kind: 'rpg', regionId: region, tier: 13, role };
        expect(deriveSourceLoot(p, row, dependencies)).toEqual([{ itemId: `${region}_probe`, quantity: [2, 4], chance: role === 'caster' ? .8 : .2 }]);
        expect(deriveSourceLoot(p, { ...row, tier: 1 }, dependencies)[0]!.quantity).toEqual([2, 3]);
        expect(deriveSourceLoot(p, { ...row, tier: 12 }, dependencies)[0]!.quantity).toEqual([2, 3]);
      }
    }
  });

  it('preserves optional exclusive groups and never mutates inputs, dependencies or prior results', () => {
    const source: SourceLootInput = { id: 'authored/probe', kind: 'authored', drops: [
      { itemId: 'first', quantity: [1, 2], chance: 1 },
      { itemId: 'second', quantity: [2, 3], chance: .4, exclusiveGroup: 'pair' },
    ] };
    const saved = structuredClone(source), p = structuredClone(extracted.params);
    const base = deriveSourceLoot(p, source, new Map()), dependencies = new Map([['authored/probe', base]]);
    const inherited = deriveSourceLoot(p, { id: 'inherit/probe', kind: 'inherit', sourceInputId: source.id }, dependencies);
    expect(Object.hasOwn(inherited[0]!, 'exclusiveGroup')).toBe(false);
    expect(inherited[1]!.exclusiveGroup).toBe('pair');
    inherited[0]!.quantity[0] = 9; inherited[1]!.chance = 0; inherited.push({ itemId: 'third', quantity: [1, 1], chance: 0 });
    expect(base).toStrictEqual(saved.drops); expect(source).toStrictEqual(saved); expect(p).toStrictEqual(extracted.params);
    for (const row of [input('variant/gloam_fox'), input('stone/cairn_treader')]) {
      expect(() => deriveSourceLoot(p, row, new Map())).toThrow(/Missing source loot dependency/);
    }
    expect(deriveSourceLoot(p, { id: 'empty', kind: 'inherit', sourceInputId: 'empty_base' }, new Map([['empty_base', []]]))).toEqual([]);
  });

  it('rejects malformed schemas and unsupported original source expressions', () => {
    for (const row of extracted.inputs) expect(() => parseValue(SourceLootInputSchema, { ...row, unexpected: 1 }, 'input')).toThrow(/unknown/i);
    expect(() => parseValue(SourceLootInputsSchema, [input('rpg/goblin_scout'), input('rpg/goblin_scout')], 'inputs')).toThrow(/unique/);
    for (const change of [
      (p: typeof extracted.params) => { p.rpg.quantityTierDivisor = 0; },
      (p: typeof extracted.params) => { p.rpg.quantityMinimum = 2; },
      (p: typeof extracted.params) => { p.rpg.quantityMaximumMinimum = 1.5; },
      (p: typeof extracted.params) => { p.variantAppend.chance = 1.01; },
      (p: typeof extracted.params) => { p.redesignEssence.basic.quantity = [3, 2]; },
    ]) {
      const p = structuredClone(extracted.params); change(p);
      expect(() => parseValue(SourceLootParamsSchema, p, 'params')).toThrow();
    }
    expect(() => parseValue(SourceLootInputSchema, { ...input('rpg/goblin_scout'), regionId: 'wilderness' }, 'input')).toThrow();
    expect(() => parseValue(SourceLootParamsSchema, { ...extracted.params, surprise: {} }, 'params')).toThrow(/unknown/i);
    for (const [module, original, replacement] of [
      ['rpgBestiary', 'Math.ceil(tier / 10)', 'Math.round(tier / 10)'],
      ['regionalCreatureVariants', '...base.stats.drops,', ''],
      ['stoneCreatureRedesigns', 'maxHealth: row.health,', 'drops: [], maxHealth: row.health,'],
      ['creatureExpansion', 'quantity: [min, max]', 'quantity: [max, min]'],
    ] as const) {
      const edit = changed(module, original, replacement);
      expect(() => buildCoreSourceLoot(edit.evidence, edit.next)).toThrow(/Unsupported/);
    }
    expect(() => buildCoreSourceLoot(baseline, { ...sources, enemies: sources.enemies + '\n' })).toThrow(/source hash/);
  });
});
