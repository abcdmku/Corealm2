import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildWildernessLootSources, WILDERNESS_LOOT_MODULES, type WildernessLootSources } from '../tools/content/wilderness-loot-inputs.js';
import { deriveWildernessLoot, wildernessDropsForStructure, type WildernessLootDependencies } from '../game/src/content/balance/wildernessLoot.js';
import { WildernessLootParamsSchema, WildernessLootRequestSchema, type WildernessStructureLootId } from '../game/src/content/schema/wildernessLoot.js';
import { parseValue } from '../game/src/content/schema/core.js';
import type { WildernessKeeperRow } from '../game/src/content/schema/enemyWildernessSources.js';

function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'number': case 'string': case 'boolean': return value.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return value.values.map(restore);
    case 'object': return Object.fromEntries(value.entries.map(([key, row]) => [key, restore(row)]));
    default: throw new Error(`Unsupported snapshot ${value.kind}`);
  }
}
const path = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
const json = (file: string) => JSON.parse(readFileSync(new URL(`../game/content/data/${file}.json`, import.meta.url), 'utf8'));
it('requires original source hash evidence', () => {
  expect(() => buildWildernessLootSources({ source: { files: [] } } as unknown as M4Baseline,
    Object.fromEntries(WILDERNESS_LOOT_MODULES.map(module => [module, ''])) as WildernessLootSources)).toThrow(/source hash/);
});

describe.skipIf(!WILDERNESS_LOOT_MODULES.every(module => existsSync(path(module))))('original Wilderness loot', () => {
  let baseline: M4Baseline, sources: WildernessLootSources, result: ReturnType<typeof buildWildernessLootSources>, deps: WildernessLootDependencies;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    sources = Object.fromEntries(WILDERNESS_LOOT_MODULES.map(module => [module, readFileSync(path(module), 'utf8')])) as WildernessLootSources;
    result = buildWildernessLootSources(baseline, sources);
    const keeperRows = restore(baseline.constants.find(row => row.module === 'wildernessDepth' && row.name === 'WILDERNESS_RUNE_KEEPERS')!.value) as WildernessKeeperRow[];
    const items = json('items') as { id: string; tier: number; catalog: string }[];
    deps = { craftingTiers: json('craftingTiers').filter((row: { catalog: string }) => row.catalog === 'WILDERNESS_CRAFTING_TIERS'),
      keepers: keeperRows.map(({ id, name, tier, multiplier }) => ({ id, name, tier, multiplier })),
      rolls: json('balance/loot'), armorEligibility: ([50, 70] as const).map(tier => ({ tier,
        itemIds: items.filter(row => row.catalog === 'BOSS_ARMOR_ITEMS' && row.tier === tier).map(row => row.id) })) };
  });
  function changed(module: keyof WildernessLootSources, original: string, replacement: string) {
    const next = { ...sources, [module]: sources[module].replace(original, replacement) }, evidence = structuredClone(baseline);
    expect(next[module]).not.toBe(sources[module]);
    evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
    return { next, evidence };
  }
  it('replays every original ordered helper probe', () => {
    const probes = baseline.functions.find(row => row.module === 'wildernessLoot' && row.name === 'wildernessDrops')!.probes;
    expect(probes).toHaveLength(29);
    for (const probe of probes) {
      const [speciesId, tier, keeperId, structureId] = restore(probe.args) as [string, number, string?, WildernessStructureLootId?];
      expect(probe.result.kind).toBe('return');
      if (probe.result.kind === 'return') expect(wildernessDropsForStructure(result.params, { speciesId, tier, keeperId, structureId }, deps), probe.label)
        .toStrictEqual(restore(probe.result.value));
    }
    expect(result.manifest.sources).toHaveLength(4);
    expect(result.params.keeperRewards).toHaveLength(5);
    expect(deps.armorEligibility.map(row => row.itemIds.length)).toEqual([9, 9]);
  });
  it('only the six exact conclave groups receive an extra ordered component', () => {
    const request = { speciesId: 'gloam_wraith', tier: 70 }, canonical = deriveWildernessLoot(result.params, request, deps);
    let alternatives = 0;
    for (const structure of result.params.structureComponents) {
      for (const suffix of result.params.groupSuffixes) {
        const alias = deriveWildernessLoot(result.params, { ...request, groupId: structure.structureId + suffix }, deps);
        expect(alias.slice(0, -1)).toStrictEqual(canonical);
        expect(alias.at(-1)?.itemId).toBe(structure.itemId); alternatives++;
      }
      for (const groupId of [structure.structureId, `${structure.structureId}_west`, `${structure.structureId}_west_conclave_extra`])
        expect(deriveWildernessLoot(result.params, { ...request, groupId }, deps)).toStrictEqual(canonical);
    }
    expect(alternatives).toBe(6);
  });
  it('retains arbitrary-tier boundaries, case sensitivity and overlapping classifications', () => {
    const derive = (speciesId: string, tier: number) => deriveWildernessLoot(result.params, { speciesId, tier }, deps);
    for (const tier of [-Infinity, -1, 0, 50, 69.999, NaN]) expect(derive('stone_dragon', tier)).toStrictEqual(derive('stone_dragon', 50));
    for (const tier of [70, 70.1, 99, Infinity]) expect(derive('stone_dragon', tier)).toStrictEqual(derive('stone_dragon', 70));
    expect(derive('stone_dragon', 70).map(row => row.itemId)).toEqual(['starhide', 'cosmic_rune', 'death_rune', 'blood_rune', 'wrath_rune', 'nightglass_ore', 'fire_opal']);
    expect(derive('STONE_DRAGON', 70)[0]!.itemId).toBe('void_thread');
    expect(derive('rift_carapace', 50)[0]!.itemId).toBe('molten_heart');
  });
  it('keeper identity overrides species and numeric tier and ignores structure rewards', () => {
    for (const keeper of deps.keepers) {
      const expected = deriveWildernessLoot(result.params, { speciesId: keeper.id, tier: keeper.tier, keeperId: keeper.id }, deps);
      expect(deriveWildernessLoot(result.params, { speciesId: 'dragon', tier: -500, keeperId: keeper.id, groupId: 'hollow_star_sanctum_west_conclave' }, deps)).toStrictEqual(expected);
      expect(expected.slice(-9).reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(deps.rolls.bossArmorExpectedPieces);
    }
    expect(() => deriveWildernessLoot(result.params, { speciesId: 'dragon', tier: 50, keeperId: 'missing' }, deps)).toThrow('Unknown Wilderness rune keeper: missing');
  });
  it('reads actual dependency edits without mutating input rows or saved tables', () => {
    const saved = JSON.stringify({ params: result.params, deps, tables: baseline.records.lootTables });
    const edited = structuredClone(deps);
    edited.craftingTiers.find(row => row.tier === 70)!.hide = 'edited_hide';
    const material = edited.rolls.wilderness.ordinary.material;
    material.quantity = [material.quantity[0], material.quantity[1] + 2];
    expect(deriveWildernessLoot(result.params, { speciesId: 'dragon', tier: 70 }, edited)[0]).toEqual({ itemId: 'edited_hide', quantity: [1, 5], chance: 1 });
    const withoutArmor = { ...deps, armorEligibility: deps.armorEligibility.map(row => ({ ...row, itemIds: [] })) };
    expect(deriveWildernessLoot(result.params, { speciesId: 'x', tier: 0, keeperId: 'ashseal_warden' }, withoutArmor)).toHaveLength(6);
    expect(JSON.stringify({ params: result.params, deps, tables: baseline.records.lootTables })).toBe(saved);
  });
  it('fails missing and duplicate references instead of silently omitting rewards', () => {
    const ordinary = { speciesId: 'dragon', tier: 50 }, keeper = { ...ordinary, keeperId: 'ashseal_warden' };
    expect(() => deriveWildernessLoot(result.params, ordinary, { ...deps, craftingTiers: [] })).toThrow(/crafting tier/);
    expect(() => deriveWildernessLoot(result.params, keeper, { ...deps, armorEligibility: [] })).toThrow(/armor tier/);
    expect(() => deriveWildernessLoot({ ...result.params, keeperRewards: [] }, keeper, deps)).toThrow(/keeper reward/);
    expect(() => deriveWildernessLoot({ ...result.params, runesByRank: [] }, ordinary, deps)).toThrow(/rune rank/);
    const missingRoll = structuredClone(deps); missingRoll.rolls.wilderness.ordinary.runes = [];
    expect(() => deriveWildernessLoot(result.params, ordinary, missingRoll)).toThrow(/rune roll/);
    expect(() => deriveWildernessLoot(result.params, keeper, { ...deps, keepers: [...deps.keepers, deps.keepers[0]!] })).toThrow(/keeper/);
  });
  it('rejects unknown keys, keeper IDs, incomplete maps and duplicate ranks', () => {
    for (const edit of [
      { ...result.params, unexpected: 1 }, { ...result.params, keeperRewards: result.params.keeperRewards.slice(1) },
      { ...result.params, structureComponents: result.params.structureComponents.slice(1) },
      { ...result.params, runesByRank: result.params.runesByRank.map(row => ({ ...row, rank: 1 })) },
      { ...result.params, ordinaryRanks: { shallow: [1, 1], deep: [3, 4, 5] } },
      { ...result.params, groupSuffixes: ['', '_east_conclave'] },
    ]) expect(() => parseValue(WildernessLootParamsSchema, edit, 'params')).toThrow();
    expect(() => parseValue(WildernessLootRequestSchema, { speciesId: 'dragon', tier: 50, keeperId: 'bad' }, 'request')).toThrow();
    expect(() => parseValue(WildernessLootRequestSchema, { speciesId: 'dragon', tier: Infinity }, 'request')).toThrow();
  });
  it('takes inputs from source literals without final outputs or constants', () => {
    const evidence = structuredClone(baseline);
    evidence.constants = []; evidence.functions = []; evidence.records.lootTables = []; evidence.original.wildernessBlocks = [];
    expect(buildWildernessLootSources(evidence, sources)).toStrictEqual(result);
    const modified = changed('wildernessLoot', '/dragon|drake|hatchling/', '/dragon|drake|hatchling|wyrm/');
    const extracted = buildWildernessLootSources(modified.evidence, modified.next);
    expect(extracted.params.dragonTokens.at(-1)).toBe('wyrm');
    expect(deriveWildernessLoot(extracted.params, { speciesId: 'wyrm', tier: 50 }, deps)[0]!.itemId).toBe('dragonhide');
  });
  it('rejects changed arithmetic, mismatched material mappings and malformed group rules', () => {
    for (const [module, before, after] of [
      ['wildernessLoot', '(keeper?.tier ?? tier) >= 70', '(keeper?.tier ?? tier) > 70'],
      ['wildernessLoot', "deep ? 'starhide' : 'dragonhide'", "deep ? 'starhide' : 'wrong_hide'"],
      ['wildernessEnemyProgression', 'groupId === `${siteId}_west_conclave`', 'groupId.includes(`${siteId}_west_conclave`)'],
    ] as const) {
      const modified = changed(module, before, after);
      expect(() => buildWildernessLootSources(modified.evidence, modified.next)).toThrow(/Unsupported|mismatch/);
    }
    expect(() => buildWildernessLootSources(baseline, { ...sources, wildernessLoot: sources.wildernessLoot + '\n' })).toThrow(/source hash/);
  });
});
