import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildCoreEnemySources } from '../tools/content/enemy-source-inputs.js';
import { buildVariantEnemySources } from '../tools/content/enemy-source-variant-inputs.js';
import { buildCoreSourceLoot, CORE_SOURCE_LOOT_MODULES, type CoreSourceLootSources } from '../tools/content/source-loot-inputs.js';
import { buildDescendantLootSources, DESCENDANT_LOOT_MODULES, type DescendantLootSources } from '../tools/content/descendant-loot-inputs.js';
import type { DescendantAvailableInput } from '../tools/content/enemy-descendant-source-inputs.js';
import { deriveDescendantLoot } from '../game/src/content/balance/descendantLoot.js';
import { deriveSourceLoot } from '../game/src/content/balance/sourceLoot.js';
import { DescendantLootInputSchema, DescendantLootInputsSchema, DescendantLootParamsSchema } from '../game/src/content/schema/descendantLoot.js';
import { arr, parseValue } from '../game/src/content/schema/core.js';
import { DropSchema } from '../game/src/content/schema/loot.js';
import type { EnemyDef } from '../game/src/content/index.js';

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

const sourcePath = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
describe('descendant loot evidence guard', () => {
  it('requires original source hashes', () => {
    expect(() => buildDescendantLootSources({ source: { files: [] } } as unknown as M4Baseline,
      Object.fromEntries(DESCENDANT_LOOT_MODULES.map(module => [module, ''])) as DescendantLootSources, [])).toThrow(/source hash/);
  });
});
describe.skipIf(![...CORE_SOURCE_LOOT_MODULES, ...DESCENDANT_LOOT_MODULES].every(module => existsSync(sourcePath(module))))('original descendant source loot', () => {
  let baseline: M4Baseline, sources: DescendantLootSources, available: DescendantAvailableInput[];
  let extracted: ReturnType<typeof buildDescendantLootSources>, coreLoot: ReturnType<typeof buildCoreSourceLoot>;
  let coreDrops: Map<string, EnemyDef['drops']>;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    const coreSources = Object.fromEntries(CORE_SOURCE_LOOT_MODULES.map(module => [module, readFileSync(sourcePath(module), 'utf8')])) as CoreSourceLootSources;
    const core = buildCoreEnemySources(baseline, { creatureExpansion: coreSources.creatureExpansion,
      starterCreatures: coreSources.starterCreatures, rpgBestiary: coreSources.rpgBestiary });
    const variants = buildVariantEnemySources(baseline, { enemies: coreSources.enemies, regionalCreatureVariants: coreSources.regionalCreatureVariants,
      creatureRedesign: coreSources.creatureRedesign, forestCreatureRedesigns: coreSources.forestCreatureRedesigns,
      ashCreatureRedesigns: coreSources.ashCreatureRedesigns, stoneCreatureRedesigns: coreSources.stoneCreatureRedesigns }, core.inputs);
    available = [...core.inputs, ...variants.inputs];
    coreLoot = buildCoreSourceLoot(baseline, coreSources); coreDrops = new Map();
    for (const row of coreLoot.inputs) coreDrops.set(row.id, deriveSourceLoot(coreLoot.params, row, coreDrops));
    sources = Object.fromEntries(DESCENDANT_LOOT_MODULES.map(module => [module, readFileSync(sourcePath(module), 'utf8')])) as DescendantLootSources;
    extracted = buildDescendantLootSources(baseline, sources, available);
  });
  const input = (id: string) => extracted.inputs.find(row => row.id === id)!;
  function derive(row: typeof extracted.inputs[number]) {
    return row.kind === 'fairyCrown' || row.kind === 'crownwardDragon' || row.kind === 'wildernessDragonSource'
      ? deriveDescendantLoot(extracted.params, row, extracted.externalFabric) : deriveSourceLoot(coreLoot.params, row, coreDrops);
  }
  function changed(module: keyof DescendantLootSources, original: string, replacement: string) {
    const next = { ...sources, [module]: sources[module].replace(original, replacement) }, evidence = structuredClone(baseline);
    expect(next[module]).not.toBe(sources[module]);
    evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
    return { next, evidence };
  }

  it('matches all 40 original sources and their independently owned drop tables', () => {
    expect(extracted.inputs).toHaveLength(40); expect(extracted.ownerProposals).toHaveLength(40);
    expect(extracted.inputs.filter(row => row.kind === 'fairyCrown')).toHaveLength(12);
    expect(extracted.inputs.filter(row => row.kind === 'crownwardDragon')).toHaveLength(3);
    expect(extracted.inputs.filter(row => row.kind === 'wildernessDragonSource')).toHaveLength(7);
    expect(extracted.inputs.filter(row => row.kind === 'authored')).toHaveLength(11);
    expect(extracted.inputs.filter(row => row.kind === 'inherit')).toHaveLength(7);
    expect(extracted.ownerProposals.filter(row => row.formula)).toHaveLength(29);
    for (const row of extracted.inputs) {
      const origin = extracted.manifest.rows.find(origin => origin.inputId === row.id)!;
      const original = (restore(baseline.constants.find(item => item.module === origin.catalogModule && item.name === origin.catalog)!.value) as { id: string; stats: EnemyDef }[])
        .find(item => item.id === origin.speciesId)!;
      const owner = extracted.ownerProposals.find(owner => owner.inputId === row.id)!;
      const originalTable = baseline.records.lootTables.find(table => table.id === owner.lootTableId)!;
      const actual = derive(row);
      expect(actual, row.id).toStrictEqual(original.stats.drops);
      expect(actual, owner.lootTableId).toStrictEqual(originalTable.drops);
      expect(parseValue(arr(DropSchema), actual, row.id)).toStrictEqual(actual);
      actual.forEach(drop => expect(Object.hasOwn(drop, 'exclusiveGroup')).toBe(false));
    }
    expect(extracted.manifest.sources).toHaveLength(7); expect(extracted.manifest.rows).toHaveLength(40);
    expect(extracted.manifest.rows.find(row => row.inputId === 'wildernessBody/ashseal_warden')).toMatchObject({
      module: 'wildernessDepth', symbol: 'WILDERNESS_RUNE_KEEPERS', catalogModule: 'wildernessCreatureSpecies',
    });
  });

  it('assigns all 18 body/dragon source alternatives without tagging final Wilderness owners', () => {
    const alternatives = extracted.ownerProposals.filter(row => row.catalog === 'CREATURE_SOURCE_LOOT');
    expect(alternatives).toHaveLength(18);
    expect(alternatives.filter(row => !row.formula)).toHaveLength(11);
    for (const owner of alternatives) {
      const join = extracted.sourceInputJoins.find(row => row.inputId === owner.inputId)!;
      expect(owner.lootTableId).toBe(`loot_species_${join.speciesId}`);
      expect(owner.lootTableId).not.toBe(`loot_enemy_${join.enemyId}`);
      expect(extracted.ownerProposals.some(row => row.lootTableId === `loot_enemy_${join.enemyId}`)).toBe(false);
      const final = baseline.records.lootTables.find(row => row.id === `loot_enemy_${join.enemyId}`)!;
      expect(derive(input(owner.inputId))).not.toStrictEqual(final.drops);
    }
    for (const row of extracted.inputs.filter(row => row.kind === 'inherit')) {
      expect(row.sourceInputId.startsWith('rpg/')).toBe(true);
      expect(derive(row)).toStrictEqual(coreDrops.get(row.sourceInputId));
      expect(() => deriveSourceLoot(coreLoot.params, row, new Map())).toThrow(/Missing source loot dependency/);
    }
  });

  it('extracts changed original rolls and selectors without reading final drop arrays', () => {
    const evidence = structuredClone(baseline);
    evidence.records.enemies.length = 0;
    evidence.records.lootTables.forEach(row => { row.drops = []; });
    evidence.original.preWildernessBlocks.length = 0; evidence.original.wildernessBlocks.length = 0;
    for (const row of evidence.constants) if (row.value.kind === 'array') row.value.values.forEach(value => {
      if (value.kind === 'object') value.entries = value.entries.filter(([key]) => key === 'id');
    });
    expect(buildDescendantLootSources(evidence, sources, available)).toStrictEqual(extracted);
    for (const [module, original, replacement, check] of [
      ['fairyCrownCreatures', "'crown_hart' ?", "'silverthorn_harrow' ?", (value: typeof extracted) => expect(value.params.fairyCrown.venison.speciesId).toBe('silverthorn_harrow')],
      ['fairyCrownCreatures', 'form.boss ? 1 : .55', 'form.boss ? .9 : .45', (value: typeof extracted) => expect(value.params.fairyCrown.essence).toMatchObject({ boss: { chance: .9 }, ordinary: { chance: .45 } })],
      ['crownwardDragons', 'boss ? .75 : .35', 'boss ? .7 : .3', (value: typeof extracted) => expect(value.params.crownwardDragon.rune).toMatchObject({ boss: { chance: .7 }, ordinary: { chance: .3 } })],
      ['wildernessDragons', 'row.tier===50?2:4', 'row.tier===50?3:5', (value: typeof extracted) => expect(value.params.wildernessDragonSource.scales.quantity).toEqual({ shallow: [1, 3], deep: [1, 5] })],
      ['regionalTierEquipment', "hide: 'crownhide'", "hide: 'royal_hide'", (value: typeof extracted) => expect(value.externalFabric.regionalCraftingTiers[1]!.hide).toBe('royal_hide')],
    ] as const) {
      const edit = changed(module, original, replacement); check(buildDescendantLootSources(edit.evidence, edit.next, available));
    }
  });

  it('preserves fairy region ordering and the exact venison species condition', () => {
    const p = extracted.params, dependencies = extracted.externalFabric;
    for (const [regionId, tier, material, essence, rune] of [
      ['crownward', 40, 'crownhide', 'air_essence', 'death_rune'],
      ['gloamgarden', 30, 'mistweave', 'earth_essence', 'chaos_rune'],
      ['faeholme', 60, 'faesilk', 'earth_essence', 'blood_rune'],
    ] as const) for (const boss of [false, true]) {
      const row = { id: 'fairyCrown/probe', kind: 'fairyCrown' as const, speciesId: 'crown_hart', regionId, tier, boss };
      const drops = deriveDescendantLoot(p, row, dependencies);
      expect(drops.map(row => row.itemId)).toEqual([material, essence, rune, ...(regionId === 'crownward' ? [] : ['cosmic_rune']), 'raw_venison']);
      expect(drops[1]!.quantity).toEqual(boss ? [8, 14] : [2, 4]);
      expect(drops[2]!.quantity).toEqual(boss ? [3, 6] : [1, 2]);
      expect(drops.at(-1)).toEqual({ itemId: 'raw_venison', quantity: [1, 2], chance: .8 });
      expect(deriveDescendantLoot(p, { ...row, speciesId: 'another_hart' }, dependencies)).toHaveLength(drops.length - 1);
    }
  });

  it('responds to every roll family and selection parameter with actual fabric dependencies', () => {
    const p = structuredClone(extracted.params), deps = structuredClone(extracted.externalFabric);
    deps.regionalFabric.ordinary = { quantity: [7, 8], chance: .7 };
    deps.regionalFabric.boss = { quantity: [9, 10], chance: .9 };
    deps.regionalCraftingTiers.forEach(row => { row.hide = `fabric${row.tier}`; });
    p.fairyCrown.essence.fairyItemId = 'fairy_probe'; p.fairyCrown.essence.crownwardItemId = 'crown_probe';
    p.fairyCrown.cosmic.itemId = 'cosmic_probe'; p.fairyCrown.venison = { speciesId: 'probe', itemId: 'food_probe', roll: { quantity: [4, 5], chance: .4 } };
    p.fairyCrown.rune.items.forEach(row => { row.itemId = `rune${row.tier}`; });
    for (const profile of ['ordinary', 'boss'] as const) {
      p.fairyCrown.essence[profile] = { quantity: [2, 3], chance: .2 };
      p.fairyCrown.rune[profile] = { quantity: [3, 4], chance: .3 };
      p.fairyCrown.cosmic[profile] = { quantity: [5, 6], chance: .5 };
      for (const name of ['scales', 'fireEssence', 'rune'] as const) {
        p.crownwardDragon[name].itemId = name;
        p.crownwardDragon[name][profile] = { quantity: [6, 7], chance: .6 };
      }
      const boss = profile === 'boss';
      const fairy = deriveDescendantLoot(p, { id: 'f', kind: 'fairyCrown', speciesId: 'probe', regionId: 'faeholme', tier: 60, boss }, deps);
      expect(fairy).toEqual([{ itemId: 'fabric60', ...(boss ? deps.regionalFabric.boss : deps.regionalFabric.ordinary) },
        { itemId: 'fairy_probe', quantity: [2, 3], chance: .2 }, { itemId: 'rune60', quantity: [3, 4], chance: .3 },
        { itemId: 'cosmic_probe', quantity: [5, 6], chance: .5 }, { itemId: 'food_probe', quantity: [4, 5], chance: .4 }]);
      expect(deriveDescendantLoot(p, { id: 'c', kind: 'crownwardDragon', boss }, deps)).toEqual([
        { itemId: 'fabric40', ...(boss ? deps.regionalFabric.boss : deps.regionalFabric.ordinary) },
        ...['scales', 'fireEssence', 'rune'].map(itemId => ({ itemId, quantity: [6, 7], chance: .6 })),
      ]);
    }
    p.wildernessDragonSource.scales.itemId = 'scales_probe'; p.wildernessDragonSource.scales.chance = .3;
    p.wildernessDragonSource.scales.quantity = { shallow: [3, 4], deep: [5, 6] };
    p.wildernessDragonSource.fireEssence = { itemId: 'fire_probe', roll: { quantity: [6, 8], chance: .6 } };
    for (const tier of [50, 70] as const) expect(deriveDescendantLoot(p, { id: 'd', kind: 'wildernessDragonSource', tier }, deps)).toEqual([
      { itemId: 'scales_probe', quantity: tier === 50 ? [3, 4] : [5, 6], chance: .3 }, { itemId: 'fire_probe', quantity: [6, 8], chance: .6 },
    ]);
  });

  it('keeps outputs independent and rejects malformed inputs and parameters', () => {
    const saved = structuredClone({ params: extracted.params, external: extracted.externalFabric, inputs: extracted.inputs, coreDrops });
    for (const row of extracted.inputs) {
      const first = derive(row), copy = structuredClone(first), second = derive(row);
      if (second[0]) { second[0].quantity[0] = 999; second[0].chance = 0; }
      expect(first).toStrictEqual(copy);
    }
    expect({ params: extracted.params, external: extracted.externalFabric, inputs: extracted.inputs, coreDrops }).toStrictEqual(saved);
    const crown = input('fairyCrown/crown_hart');
    expect(() => parseValue(DescendantLootInputSchema, { ...crown, tier: 30 }, 'input')).toThrow(/region/);
    expect(() => parseValue(DescendantLootInputSchema, { ...crown, unknown: 1 }, 'input')).toThrow(/unknown/i);
    expect(() => parseValue(DescendantLootInputsSchema, [crown, crown], 'inputs')).toThrow(/unique/);
    for (const edit of [
      (p: typeof extracted.params) => { p.fairyCrown.rune.items.pop(); },
      (p: typeof extracted.params) => { p.fairyCrown.venison.roll.chance = 1.1; },
      (p: typeof extracted.params) => { p.crownwardDragon.scales.boss.quantity = [7, 3]; },
      (p: typeof extracted.params) => { p.wildernessDragonSource.scales.quantity.deep = [0, 4]; },
    ]) { const p = structuredClone(extracted.params); edit(p); expect(() => parseValue(DescendantLootParamsSchema, p, 'params')).toThrow(); }
  });

  it('rejects altered formula shapes, inherited-drop overrides and wrong source owner ledgers', () => {
    for (const [module, original, replacement] of [
      ['fairyCrownCreatures', "form.regionId !== 'crownward'", "form.regionId === 'crownward'"],
      ['crownwardDragons', '...regionalFabricDrops(40, boss),', ''],
      ['wildernessDragons', 'row.tier===50?2:4', 'row.tier===50?4:2'],
      ['wildernessCreatureSpecies', 'drops: []', 'drops: [{ itemId: "probe", quantity: [1, 1], chance: 1 }]'],
      ['regionalBossBodies', "name, behaviour: 'territorial'", "name, behaviour: 'territorial', drops: []"],
    ] as const) {
      const edit = changed(module, original, replacement);
      if (module === 'wildernessDragons') {
        expect(buildDescendantLootSources(edit.evidence, edit.next, available).params.wildernessDragonSource.scales.quantity).toEqual({ shallow: [1, 4], deep: [1, 2] });
      } else expect(() => buildDescendantLootSources(edit.evidence, edit.next, available)).toThrow();
    }
    const evidence = structuredClone(baseline), body = evidence.records.creatures.find(row => row.id === 'cinderback_crag')!;
    body.lootTableId = `loot_enemy_${body.blockId}`;
    expect(() => buildDescendantLootSources(evidence, sources, available)).toThrow(/owner mismatch/);
    for (const module of DESCENDANT_LOOT_MODULES) expect(() => buildDescendantLootSources(baseline,
      { ...sources, [module]: sources[module] + '\n' }, available)).toThrow(/source hash/);
  });
});
