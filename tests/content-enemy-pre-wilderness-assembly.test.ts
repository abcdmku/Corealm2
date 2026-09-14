import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import rawParameters from '../game/content/data/balance/enemies.json';
import rawLoot from '../game/content/data/balance/loot.json';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { parseValue } from '../game/src/content/schema/core.js';
import { PreWildernessAssemblyConfigSchema } from '../game/src/content/schema/enemyPreWildernessAssembly.js';
import { buildPreWildernessAssembly } from '../game/src/content/balance/enemyPreWildernessAssembly.js';
import { deriveEnemySourceGraph } from '../game/src/content/balance/enemySourceGraph.js';
import { buildPreWildernessAssemblyInputs, PRE_WILDERNESS_ASSEMBLY_MODULES,
  type PreWildernessAssemblySources, type PreWildernessAssemblyMembership } from '../tools/content/enemy-pre-wilderness-assembly-inputs.js';
import { buildEnemyAssemblySources } from '../tools/content/enemy-assembly-source-inputs.js';
import { buildLegacyEnemyInputs } from '../tools/content/enemy-formula-inputs.js';
import { buildCoreSourceLoot, CORE_SOURCE_LOOT_MODULES, type CoreSourceLootSources } from '../tools/content/source-loot-inputs.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import type { EnemyDef } from '../game/src/content/index.js';

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
type Species = { id: string; assetId: string; stats: EnemyDef };

describe('pre-Wilderness assembly provenance guard', () => {
  it('rejects absent source hashes before reading dependencies', () => {
    const sources = Object.fromEntries(PRE_WILDERNESS_ASSEMBLY_MODULES.map(module => [module, ''])) as PreWildernessAssemblySources;
    expect(() => buildPreWildernessAssemblyInputs({ source: { files: [] } } as unknown as M4Baseline,
      sources, { combatInputs: [], lootInputIds: [], assemblySources: [] })).toThrow(/source hash/);
  });
});

describe.skipIf(!PRE_WILDERNESS_ASSEMBLY_MODULES.every(module => existsSync(sourcePath(module))))('original pre-Wilderness assembly', () => {
  let baseline: M4Baseline, sources: PreWildernessAssemblySources, membership: PreWildernessAssemblyMembership;
  let extracted: ReturnType<typeof buildPreWildernessAssemblyInputs>;
  let params: ReturnType<typeof EnemyBalanceSchema.parse>;
  let combat: ReturnType<typeof deriveEnemySourceGraph>, loot: Map<string, EnemyDef['drops']>, originalSpecies: Species[];
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    sources = Object.fromEntries(PRE_WILDERNESS_ASSEMBLY_MODULES.map(module => [module, readFileSync(sourcePath(module), 'utf8')])) as PreWildernessAssemblySources;
    params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
    const legacy = buildLegacyEnemyInputs(baseline, sources.enemies);
    const coreLoot = buildCoreSourceLoot(baseline, Object.fromEntries(CORE_SOURCE_LOOT_MODULES.map(module =>
      [module, readFileSync(sourcePath(module), 'utf8')])) as CoreSourceLootSources);
    const assembly = buildEnemyAssemblySources(baseline, { enemies: sources.enemies, redWorms: sources.redWorms },
      { ...legacy, sourceLootInputs: coreLoot.inputs });
    membership = { combatInputs: params.sourceInputs, lootInputIds: rawLoot.sourceInputs.map(row => row.id), assemblySources: assembly.inputs };
    extracted = buildPreWildernessAssemblyInputs(baseline, sources, membership);
    combat = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
    originalSpecies = ['CREATURE_SPECIES', 'RPG_BESTIARY'].flatMap(name => restore(baseline.constants.find(row => row.name === name)!.value) as Species[]);
    // Upstream original drop tables are a temporary oracle until the separate remaining loot slice is integrated.
    // Combat always comes from the pure source graph, never from saved final enemies.
    loot = new Map(coreLoot.inputs.filter(row => row.kind === 'authored').map(row => [row.id, row.drops]));
    for (const [index, ref] of extracted.config.progressionSpecies.entries()) {
      const previous = loot.get(ref.sourceInputId), drops = originalSpecies[index]!.stats.drops;
      if (previous) expect(previous, ref.sourceInputId).toStrictEqual(drops);
      loot.set(ref.sourceInputId, drops);
    }
  });
  const replay = (config = extracted.config, balance = params, outputs = combat, drops = loot) =>
    buildPreWildernessAssembly({ legacy: balance, fantasy: balance.fantasy }, config,
      { assemblySources: membership.assemblySources, resolveCombat: id => outputs.get(id), resolveLoot: id => drops.get(id) });

  it('replays the 330 ordered writes into 288 canonical rows and appends 72 aliases exactly', () => {
    const { config } = extracted, result = replay();
    expect(config.legacyAssemblyInputIds).toHaveLength(35); expect(config.sourceBlocks).toHaveLength(235);
    expect(config.fantasyBlocks).toHaveLength(60); expect(config.groupAliases).toHaveLength(18); expect(config.fantasyEncounters).toHaveLength(54);
    expect(result.allBlocks).toHaveLength(288); expect(result.preWildernessBlocks).toHaveLength(360);
    expect(result.preWildernessBlocks).toStrictEqual(baseline.original.preWildernessBlocks);
    expect([...result.preWildernessById.values()]).toStrictEqual(result.preWildernessBlocks);
    expect(result.sourceSpecies).toStrictEqual(originalSpecies.map(({ id, assetId, stats }) => ({ id, assetId, stats })));
    expect(extracted.manifest.sources).toHaveLength(PRE_WILDERNESS_ASSEMBLY_MODULES.length);
    expect(extracted.historicalLineage).toHaveLength(54);
  });

  it('keeps only original identity membership as baseline evidence', () => {
    const evidence = structuredClone(baseline);
    evidence.original.blocks = evidence.original.blocks.map(row => ({ id: row.id }) as EnemyDef);
    evidence.original.preWildernessBlocks.length = 0; evidence.original.wildernessBlocks.length = 0;
    evidence.records.enemies.length = 0; evidence.records.lootTables.length = 0;
    for (const row of evidence.constants) if (row.value.kind === 'array') row.value.values.forEach(value => {
      if (value.kind === 'object') value.entries = value.entries.filter(([key]) => key === 'id');
    });
    expect(buildPreWildernessAssemblyInputs(evidence, sources, membership)).toStrictEqual(extracted);
  });

  it('preserves last-value / first-insertion Map order when source blocks collide', () => {
    const config = structuredClone(extracted.config);
    config.legacyAssemblyInputIds = []; config.groupAliases = []; config.fantasyEncounters = []; config.fantasyBlocks = [];
    config.sourceBlocks = config.sourceBlocks.slice(0, 3); config.progressionSpecies = config.progressionSpecies.slice(0, 3);
    const outputs = new Map(combat), first = config.sourceBlocks[0]!, last = config.sourceBlocks[2]!;
    outputs.set(last.combatInputId, { ...outputs.get(last.combatInputId)!, id: outputs.get(first.combatInputId)!.id });
    const result = replay(config, params, outputs);
    expect(result.allBlocks).toHaveLength(2);
    expect(result.allBlocks.map(row => row.id)).toEqual(config.sourceBlocks.slice(0, 2).map(row => outputs.get(row.combatInputId)!.id));
    expect(result.allBlocks[0]).toStrictEqual(result.sourceSpecies[2]!.stats);
    expect(result.sourceSpecies).toHaveLength(3);
  });

  it('joins changed source combat and loot into scaled rows and keeps encounter combat on its historical source', () => {
    const sourceId = 'forest/briar_harrow', outputs = new Map(combat), drops = new Map(loot), before = replay();
    const source = outputs.get(sourceId)!;
    outputs.set(sourceId, { ...source, name: 'Changed Briar', maxHealth: source.maxHealth + 50,
      moveSpeedMps: 9.25, walkSpeedMps: 1.75 });
    drops.set(sourceId, [{ itemId: 'air_essence', quantity: [2, 4], chance: .375 }]);
    const after = replay(extracted.config, params, outputs, drops);
    const selected = extracted.config.fantasyEncounters.filter(row => row.replacementSourceInputId === sourceId);
    expect(selected.length).toBeGreaterThan(0);
    for (const node of selected) {
      const original = before.preWildernessById.get(node.id)!;
      expect(after.preWildernessById.get(node.id)).toStrictEqual({ ...original, name: 'Changed Briar', moveSpeedMps: 9.25, walkSpeedMps: 1.75 });
    }
    for (const tier of [1, 5, 10, 20]) {
      const block = after.preWildernessById.get(`briar_harrow_t${tier}`)!;
      expect(block.maxHealth).toBe(Math.max(params.fantasy.minimums.maxHealth, Math.round((source.maxHealth + 50) * tier / source.tier)));
      expect(block.drops).toStrictEqual(drops.get(sourceId)); expect(block.name).toBe('Changed Briar');
    }
    const historicalNode = extracted.config.fantasyEncounters.find(row => row.originalEnemyId === 'redbrush_fox_t1')!;
    expect(historicalNode).toBeDefined();
    outputs.set('expansion/redbrush_fox', { ...outputs.get('expansion/redbrush_fox')!, maxHealth: 1234 });
    drops.set('expansion/redbrush_fox', [{ itemId: 'water_essence', quantity: [5, 6], chance: .125 }]);
    const historical = replay(extracted.config, params, outputs, drops).preWildernessById.get(historicalNode.id)!;
    expect(historical.maxHealth).toBe(1234); expect(historical.drops).toStrictEqual(drops.get('expansion/redbrush_fox'));
    expect(historical.family).toBe(combat.get(historicalNode.replacementSourceInputId)!.family);
  });

  it('consumes fantasy and legacy parameters without changing stored identity or source species tiers', () => {
    const balance = structuredClone(params), before = replay();
    balance.fantasy.minimums.maxHealth = 9999; balance.marksPerTier.ordinary = [4, 12];
    const after = replay(extracted.config, balance);
    expect(after.preWildernessBlocks.map(row => row.id)).toEqual(before.preWildernessBlocks.map(row => row.id));
    expect(after.sourceSpecies).toStrictEqual(before.sourceSpecies);
    expect(after.preWildernessById.get('frog_t1')!.marks).toEqual([4, 12]);
    for (const node of extracted.config.fantasyBlocks) {
      const source = combat.get(node.sourceInputId)!;
      expect(after.preWildernessById.get(`${source.family}_t${node.tier}`)!.maxHealth)
        .toBe(node.tier === source.tier ? source.maxHealth : 9999);
    }
  });

  it('preserves absent native fields and own undefined fields introduced by encounter and fantasy spreads', () => {
    const sourceId = 'forest/briar_harrow', outputs = new Map(combat), source = { ...outputs.get(sourceId)! };
    delete source.moveSpeedMps; delete source.walkSpeedMps; delete source.marks; outputs.set(sourceId, source);
    const result = replay(extracted.config, params, outputs);
    const native = result.preWildernessById.get(source.id)!;
    expect(Object.hasOwn(native, 'marks')).toBe(false); expect(Object.hasOwn(native, 'moveSpeedMps')).toBe(false);
    const scaled = result.preWildernessById.get(`briar_harrow_t${source.tier === 1 ? 5 : 1}`)!;
    expect(Object.hasOwn(scaled, 'marks')).toBe(true); expect(scaled.marks).toBeUndefined();
    for (const node of extracted.config.fantasyEncounters.filter(row => row.replacementSourceInputId === sourceId)) {
      const actual = result.preWildernessById.get(node.id)!;
      expect(Object.hasOwn(actual, 'moveSpeedMps')).toBe(true); expect(actual.moveSpeedMps).toBeUndefined();
      expect(Object.hasOwn(actual, 'walkSpeedMps')).toBe(true); expect(actual.walkSpeedMps).toBeUndefined();
    }
  });

  it('fails closed on missing source combat, loot, authored records, aliases, and species alignment', () => {
    const sourceId = extracted.config.sourceBlocks[0]!.combatInputId, outputs = new Map(combat), drops = new Map(loot);
    outputs.delete(sourceId); expect(() => replay(extracted.config, params, outputs)).toThrow(/Missing source combat input/);
    drops.delete(sourceId); expect(() => replay(extracted.config, params, combat, drops)).toThrow(/Missing source loot input/);
    const config = structuredClone(extracted.config);
    config.legacyAssemblyInputIds[0] = 'assembly/missing'; expect(() => replay(config)).toThrow(/Missing authored assembly source/);
    config.legacyAssemblyInputIds = extracted.config.legacyAssemblyInputIds;
    config.groupAliases[0]!.baseEnemyId = 'missing'; expect(() => replay(config)).toThrow(/Missing group alias base/);
    config.groupAliases = extracted.config.groupAliases;
    config.fantasyEncounters[0]!.replacementSourceInputId = 'missing'; expect(() => replay(config)).toThrow(/Missing original stats or replacement/);
    config.fantasyEncounters = extracted.config.fantasyEncounters;
    config.progressionSpecies.reverse(); expect(() => replay(config)).toThrow(/Progression species/);
  });

  it('resolves red worm only through its authored source and never calls its combat or loot resolver', () => {
    const result = buildPreWildernessAssembly({ legacy: params, fantasy: params.fantasy }, extracted.config, {
      assemblySources: membership.assemblySources,
      resolveCombat: id => { expect(id).not.toBe('assembly/authored/red_worm'); return combat.get(id); },
      resolveLoot: id => { expect(id).not.toBe('assembly/authored/red_worm'); return loot.get(id); },
    });
    expect(result.sourceSpecies.find(row => row.id === 'red_worm')!.stats).toStrictEqual(originalSpecies.find(row => row.id === 'red_worm')!.stats);
  });

  it('does not mutate frozen dependency graphs, authored rows, original drop arrays, or config', () => {
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value); for (const child of Object.values(value)) freeze(child);
      }
    };
    const saved = structuredClone({ params, config: extracted.config, sources: membership.assemblySources, combat: [...combat], loot: [...loot] });
    freeze(params); freeze(extracted.config); freeze(membership.assemblySources); freeze([...combat]); freeze([...loot]);
    replay(); replay();
    expect({ params, config: extracted.config, sources: membership.assemblySources, combat: [...combat], loot: [...loot] }).toStrictEqual(saved);
  });

  it('rejects duplicate/schema-unknown fields and retains intentional repeated universal input membership', () => {
    expect(parseValue(PreWildernessAssemblyConfigSchema, extracted.config, 'config')).toStrictEqual(extracted.config);
    expect(new Set(extracted.config.sourceBlocks.map(row => row.combatInputId)).size).toBeLessThan(235);
    for (const update of [
      { extra: true }, { legacyAssemblyInputIds: [...extracted.config.legacyAssemblyInputIds, extracted.config.legacyAssemblyInputIds[0]!] },
      { fantasyBlocks: [...extracted.config.fantasyBlocks, extracted.config.fantasyBlocks[0]!] },
      { progressionSpecies: [...extracted.config.progressionSpecies].reverse() },
      { groupAliases: [...extracted.config.groupAliases, extracted.config.groupAliases[0]!] },
    ]) expect(() => parseValue(PreWildernessAssemblyConfigSchema, { ...extracted.config, ...update }, 'config')).toThrow();
  });

  it('extracts edited original asset literals and rejects changed assembly algorithms or missing memberships', () => {
    function changed(module: keyof PreWildernessAssemblySources, original: string, replacement: string) {
      const next = { ...sources, [module]: sources[module].replace(original, replacement) }, evidence = structuredClone(baseline);
      expect(next[module]).not.toBe(sources[module]);
      evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
      return { next, evidence };
    }
    const asset = changed('redWorms', "assetId: 'creature_red_worm'", "assetId: 'creature_test_worm'");
    const result = buildPreWildernessAssemblyInputs(asset.evidence, asset.next, membership);
    expect(result.config.progressionSpecies.find(row => row.id === 'red_worm')!.assetId).toBe('creature_test_worm');
    expect(result.config.sourceBlocks).toStrictEqual(extracted.config.sourceBlocks);
    const patch = changed('enemies', 'name: species.stats.name,', 'name: original.name,');
    expect(() => buildPreWildernessAssemblyInputs(patch.evidence, patch.next, membership)).toThrow(/fantasy encounter patches/);
    expect(() => buildPreWildernessAssemblyInputs(baseline, asset.next, membership)).toThrow(/source hash/);
    expect(() => buildPreWildernessAssemblyInputs(baseline, sources, { ...membership, combatInputs: membership.combatInputs.slice(1) })).toThrow(/membership/);
    expect(() => buildPreWildernessAssemblyInputs(baseline, sources, { ...membership,
      lootInputIds: membership.lootInputIds.filter(id => id !== 'forest/briar_harrow') })).toThrow(/loot membership/);
    expect(buildPreWildernessAssemblyInputs(baseline, sources, { ...membership,
      lootInputIds: [...membership.lootInputIds, 'different-owner/briar_harrow'] })).toStrictEqual(extracted);
  });
});
