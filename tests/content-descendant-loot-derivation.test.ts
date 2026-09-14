import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import rawLoot from '../game/content/data/lootTables.json';
import rawParams from '../game/content/data/balance/loot.json';
import rawCraftingTiers from '../game/content/data/craftingTiers.json';
import rawCreatures from '../game/content/data/creatures.json';
import { deriveRecord, derivationDiffs } from '../game/src/content/balance/derivations.js';
import { deriveSourceLootGraph } from '../game/src/content/balance/sourceLootGraph.js';
import { lootBalanceSchema } from '../game/src/content/schema/balance.js';
import { RegionalFabricTiersSchema } from '../game/src/content/schema/actorLoot.js';
import { CraftingTierRecordSchema } from '../game/src/content/schema/craftingTiers.js';
import { LootTableSchema } from '../game/src/content/schema/loot.js';
import { validateSourceLootLinks } from '../game/src/content/schema/sourceLootLinks.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { LOOT_RECORDS } from '../game/src/content/lootData.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { FAIRY_CROWN_SPECIES } from '../game/src/content/fairyCrownCreatures.js';
import { CROWNWARD_DRAGON_SPECIES } from '../game/src/content/crownwardDragons.js';
import { WILDERNESS_DRAGONS } from '../game/src/content/wildernessDragons.js';
import { WILDERNESS_CREATURE_SPECIES } from '../game/src/content/wildernessCreatureSpecies.js';
import { REGIONAL_BOSS_SPECIES } from '../game/src/content/regionalBossBodies.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

function proposal() {
  const rows = parseCollection(LootTableSchema, structuredClone(rawLoot), { name: 'lootTables' });
  const params = parseValue(lootBalanceSchema, structuredClone(rawParams), 'balance/loot');
  const craftingTiers = parseCollection(CraftingTierRecordSchema, structuredClone(rawCraftingTiers), { name: 'craftingTiers', idKey: 'tier' });
  return { rows, params, craftingTiers, tables: new Map<string, unknown>([['lootTables', rows], ['balance/loot', params], ['craftingTiers', craftingTiers]]) };
}
type Proposal = ReturnType<typeof proposal>;
function descendants(params: Proposal['params']) {
  const prefixes = new Set(['wildernessBody', 'wildernessDragon', 'regionalBossBody', 'fairyCrown', 'crownwardDragon']);
  return params.sourceInputs.filter(input => prefixes.has(input.id.split('/')[0]!));
}
function ownersFor(params: Proposal['params']) {
  const ids = new Set(descendants(params).map(input => input.id));
  return params.sourceOwners.filter(owner => ids.has(owner.inputId));
}
function dependencies({ params, craftingTiers }: Proposal) {
  return { actorLootParameters: params.actorLootParameters, descendantLootParameters: params.descendantLootParameters,
    regionalFabric: params.regionalFabric, regionalCraftingTiers: parseValue(RegionalFabricTiersSchema,
      craftingTiers.filter(row => row.catalog === 'REGIONAL_CRAFTING_TIERS').map(({ tier, hide }) => ({ tier, hide })), 'regional fabric tiers') };
}
function rowFor(rows: Proposal['rows'], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing descendant loot owner ${id}`); return row;
}
function runtimeViews() {
  return { loot: LOOT_RECORDS, enemies: ENEMY_DATA, labEnemies: LAB_ONLY_ENEMY_DATA,
    fairyCrown: FAIRY_CROWN_SPECIES, crownwardDragons: CROWNWARD_DRAGON_SPECIES,
    wildernessDragons: WILDERNESS_DRAGONS, wildernessBodies: WILDERNESS_CREATURE_SPECIES, bosses: REGIONAL_BOSS_SPECIES };
}

describe('descendant loot formula integration', () => {
  it('resolves all 40 source inputs with 29 tagged and 11 authored owners through the complete graph', () => {
    const data = proposal(), { params, rows, tables } = data, inputs = descendants(params), owners = ownersFor(params);
    expect(inputs).toHaveLength(40); expect(owners).toHaveLength(40);
    expect(Object.fromEntries(['authored', 'inherit', 'wildernessDragonSource', 'fairyCrown', 'crownwardDragon']
      .map(kind => [kind, inputs.filter(input => input.kind === kind).length])))
      .toEqual({ authored: 11, inherit: 7, wildernessDragonSource: 7, fairyCrown: 12, crownwardDragon: 3 });
    expect(owners.filter(owner => owner.mode === 'formula')).toHaveLength(29);
    expect(owners.filter(owner => owner.mode === 'authored')).toHaveLength(11);
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs, dependencies(data));
    const reversed = deriveSourceLootGraph(params.sourceLoot, [...params.sourceInputs].reverse(), dependencies(data));
    expect(graph.size).toBe(253);
    for (const owner of owners) {
      const row = rowFor(rows, owner.id);
      expect(graph.get(owner.inputId), owner.id).toStrictEqual(row.drops);
      expect(reversed.get(owner.inputId), owner.id).toStrictEqual(row.drops);
      if (owner.mode === 'formula') {
        expect(row.derivation).toEqual({ kind: 'sourceLoot.v1', inputId: owner.inputId });
        expect(deriveRecord('lootTables', row, tables)).toStrictEqual({ drops: row.drops });
      } else {
        expect(row.drops).toEqual([]); expect(Object.hasOwn(row, 'derivation')).toBe(false);
        expect(deriveRecord('lootTables', row, tables)).toBeUndefined();
      }
    }
    expect(validateSourceLootLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
  });

  it('keeps all 18 body and dragon alternatives separate from final Wilderness loot when source rolls change', () => {
    const data = proposal(), { rows, params, tables } = data;
    const alternatives = ownersFor(params).filter(owner => /^wilderness(?:Body|Dragon)\//.test(owner.inputId));
    expect(alternatives).toHaveLength(18);
    expect(alternatives.filter(owner => owner.mode === 'authored')).toHaveLength(11);
    const finalIds = alternatives.map(owner => {
      const speciesId = owner.inputId.split('/')[1]!, creature = rawCreatures.find(row => row.id === speciesId)!;
      expect(creature.lootTableId).toBe(owner.id); expect(owner.id).toBe(`loot_species_${speciesId}`);
      const finalId = `loot_enemy_${creature.blockId}`;
      expect(owner.id).not.toBe(finalId); expect(params.sourceOwners.some(row => row.id === finalId)).toBe(false);
      expect(rowFor(rows, owner.id).drops).not.toStrictEqual(rowFor(rows, finalId).drops);
      return finalId;
    });
    const saved = structuredClone(rows), runtimeBefore = structuredClone(runtimeViews());
    params.descendantLootParameters.wildernessDragonSource.scales.chance = .5;
    const diffs = derivationDiffs(tables), expected = alternatives.filter(owner => owner.mode === 'formula');
    expect(diffs).toHaveLength(7); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expected.map(owner => owner.id).sort());
    for (const diff of diffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...old[0], chance: .5 }, ...old.slice(1)]);
    }
    for (const finalId of finalIds) {
      expect(deriveRecord('lootTables', rowFor(rows, finalId), tables)).toBeUndefined();
      expect(diffs.some(diff => diff.recordId === finalId)).toBe(false);
    }
    expect(rows).toEqual(saved); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('propagates RPG roll changes through exactly the seven regional boss inheritance edges in this slice', () => {
    const data = proposal(), { rows, params, tables } = data;
    const inputs = descendants(params).filter(input => input.kind === 'inherit');
    expect(Object.fromEntries(inputs.map(input => [input.id, input.sourceInputId]))).toEqual({
      'regionalBossBody/boss_tempest_roc': 'rpg/beetle_golem', 'regionalBossBody/boss_galeskin': 'rpg/mossback_sentinel',
      'regionalBossBody/boss_rootheart': 'rpg/mossback_sentinel', 'regionalBossBody/boss_mossbound': 'rpg/beetle_golem',
      'regionalBossBody/boss_tideworn': 'rpg/beetle_golem', 'regionalBossBody/boss_ordrun': 'rpg/iron_golem',
      'regionalBossBody/boss_cinderwake': 'rpg/lava_golem',
    });
    const saved = structuredClone(rows), runtimeBefore = structuredClone(runtimeViews());
    params.sourceLoot.rpg.chance.other = .8;
    const descendantOwners = ownersFor(params), ownerIds = new Set(descendantOwners.map(owner => owner.id));
    const diffs = derivationDiffs(tables).filter(diff => ownerIds.has(diff.recordId));
    const inheritedIds = new Set(inputs.map(input => input.id));
    expect(diffs).toHaveLength(7);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(descendantOwners.filter(owner => inheritedIds.has(owner.inputId)).map(owner => owner.id).sort());
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs, dependencies(data));
    for (const input of inputs) {
      const base = graph.get(input.sourceInputId)!, inherited = graph.get(input.id)!;
      expect(inherited).toStrictEqual(base); expect(inherited).not.toBe(base);
      expect(inherited[0]!.quantity).not.toBe(base[0]!.quantity);
    }
    for (const diff of diffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...old[0], chance: .8 }, ...old.slice(1)]);
    }
    expect(rows).toEqual(saved); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('keeps the conditional venison roll on the named crown hart and preserves preceding roll order', () => {
    const { rows, params, tables } = proposal(), saved = structuredClone(rows);
    const owner = ownersFor(params).find(owner => owner.inputId === 'fairyCrown/crown_hart')!;
    params.descendantLootParameters.fairyCrown.venison.roll = { quantity: [3, 4], chance: .4 };
    const diffs = derivationDiffs(tables), old = rowFor(rows, owner.id).drops;
    expect(diffs.map(diff => diff.recordId)).toEqual([owner.id]);
    expect(diffs[0]!.after.drops).toEqual([...old.slice(0, -1), { ...old.at(-1), quantity: [3, 4], chance: .4 }]);
    expect(rows).toEqual(saved);
  });

  it('keeps one saved source table after its formula tag is removed while previewing the other six dragons', () => {
    const { rows, params, tables } = proposal();
    const owner = ownersFor(params).find(owner => owner.inputId === 'wildernessDragon/baby_red_dragon')!;
    const row = rowFor(rows, owner.id), saved = structuredClone(row.drops), runtimeBefore = structuredClone(runtimeViews());
    params.descendantLootParameters.wildernessDragonSource.scales.chance = .5;
    expect(derivationDiffs(tables)).toHaveLength(7); delete row.derivation;
    expect(deriveRecord('lootTables', row, tables)).toBeUndefined(); expect(row.drops).toEqual(saved);
    const diffs = derivationDiffs(tables); expect(diffs).toHaveLength(6);
    expect(diffs.some(diff => diff.recordId === owner.id)).toBe(false);
    expect(owner.mode).toBe('formula'); expect(validateSourceLootLinks(tables)).toEqual([]);
    expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('requires descendant parameters for each new formula branch and rejects a missing inherited source', () => {
    const data = proposal(), { params } = data;
    const { descendantLootParameters: _omitted, ...deps } = dependencies(data);
    for (const kind of ['fairyCrown', 'crownwardDragon', 'wildernessDragonSource']) {
      const input = descendants(params).find(input => input.kind === kind)!;
      expect(() => deriveSourceLootGraph(params.sourceLoot, [input], deps)).toThrow(`Missing descendant loot dependencies for ${input.id}`);
    }
    const inherited = descendants(params).find(input => input.kind === 'inherit')!;
    expect(() => deriveSourceLootGraph(params.sourceLoot, [inherited], dependencies(data))).toThrow('Missing source loot input rpg/');
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('descendant loot original owner evidence', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });
  it('matches all 40 independently owned original drop tables through the full source graph', () => {
    const data = proposal(), { params } = data;
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs, dependencies(data));
    const owners = ownersFor(params); expect(owners).toHaveLength(40);
    for (const owner of owners) {
      const original = baseline.records.lootTables.find(row => row.id === owner.id)!;
      expect(original, owner.id).toBeDefined(); expect(graph.get(owner.inputId), owner.id).toStrictEqual(original.drops);
    }
  });
});
