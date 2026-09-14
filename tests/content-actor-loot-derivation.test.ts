import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import rawLoot from '../game/content/data/lootTables.json';
import rawParams from '../game/content/data/balance/loot.json';
import rawCraftingTiers from '../game/content/data/craftingTiers.json';
import { deriveRecord, derivationDiffs } from '../game/src/content/balance/derivations.js';
import { deriveSourceLootGraph } from '../game/src/content/balance/sourceLootGraph.js';
import { deriveActorLoot } from '../game/src/content/balance/actorLoot.js';
import { lootBalanceSchema } from '../game/src/content/schema/balance.js';
import { RegionalFabricTiersSchema, type ActorLootInput } from '../game/src/content/schema/actorLoot.js';
import { CraftingTierRecordSchema } from '../game/src/content/schema/craftingTiers.js';
import { LootTableSchema } from '../game/src/content/schema/loot.js';
import { validateSourceLootLinks } from '../game/src/content/schema/sourceLootLinks.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { LOOT_RECORDS } from '../game/src/content/lootData.js';
import { ENEMY_DATA } from '../game/src/content/enemyData.js';
import { CRAFTING_TIER_RECORDS } from '../game/src/content/craftingTierData.js';
import { FAIRY_CREATURE_SPECIES } from '../game/src/content/fairyCreatures.js';
import { FAIRY_GARDEN_SPECIES } from '../game/src/content/fairyGardenCreatures.js';
import { UNIVERSAL_MINIBOSS_SPECIES, UNIVERSAL_MINIBOSS_ENEMIES } from '../game/src/content/universalMinibosses.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

function proposal() {
  const rows = parseCollection(LootTableSchema, structuredClone(rawLoot), { name: 'lootTables' });
  const params = parseValue(lootBalanceSchema, structuredClone(rawParams), 'balance/loot');
  const craftingTiers = parseCollection(CraftingTierRecordSchema, structuredClone(rawCraftingTiers), { name: 'craftingTiers', idKey: 'tier' });
  return { rows, params, craftingTiers, tables: new Map<string, unknown>([['lootTables', rows], ['balance/loot', params], ['craftingTiers', craftingTiers]]) };
}
type Proposal = ReturnType<typeof proposal>;
function actors(params: Proposal['params']) {
  return params.sourceInputs.filter((input): input is ActorLootInput => input.kind === 'fairy' || input.kind === 'universalJewelry');
}
function dependencies({ params, craftingTiers }: Proposal) {
  return { actorLootParameters: params.actorLootParameters, descendantLootParameters: params.descendantLootParameters, regionalFabric: params.regionalFabric,
    regionalCraftingTiers: parseValue(RegionalFabricTiersSchema, craftingTiers.filter(row => row.catalog === 'REGIONAL_CRAFTING_TIERS')
      .map(({ tier, hide }) => ({ tier, hide })), 'regional fabric tiers') };
}
function ownersFor(params: Proposal['params'], inputs: ActorLootInput[]) {
  const ids = new Set(inputs.map(input => input.id)); return params.sourceOwners.filter(owner => ids.has(owner.inputId));
}
function rowFor(rows: Proposal['rows'], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing actor loot owner ${id}`); return row;
}
function runtimeViews() {
  return { loot: LOOT_RECORDS, enemies: ENEMY_DATA, crafting: CRAFTING_TIER_RECORDS,
    fairy: FAIRY_CREATURE_SPECIES, garden: FAIRY_GARDEN_SPECIES,
    universalSpecies: UNIVERSAL_MINIBOSS_SPECIES, universalEnemies: UNIVERSAL_MINIBOSS_ENEMIES };
}

describe('actor loot formula integration', () => {
  it('recomputes all 99 actor owners through the full 253-input graph with no shipped loot drift', () => {
    const data = proposal(), { rows, params, tables } = data;
    const actorInputs = actors(params), actorOwners = ownersFor(params, actorInputs), deps = dependencies(data);
    expect(actorInputs).toHaveLength(99); expect(actorOwners).toHaveLength(99);
    expect(actorInputs.filter(input => input.kind === 'fairy')).toHaveLength(36);
    expect(actorInputs.filter(input => input.kind === 'universalJewelry')).toHaveLength(63);
    expect(params.sourceInputs).toHaveLength(253); expect(params.sourceOwners).toHaveLength(298);
    expect(rows.filter(row => row.derivation)).toHaveLength(228);
    expect(validateSourceLootLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs, deps);
    expect(graph.size).toBe(253);
    for (const owner of actorOwners) {
      const row = rowFor(rows, owner.id), input = actorInputs.find(input => input.id === owner.inputId)!;
      expect(owner.mode).toBe('formula'); expect(row.derivation).toEqual({ kind: 'sourceLoot.v1', inputId: input.id });
      expect(graph.get(input.id), input.id).toEqual(row.drops);
      expect(deriveActorLoot(params.actorLootParameters, input, deps), input.id).toEqual(row.drops);
      expect(deriveRecord('lootTables', row, tables)).toEqual({ drops: row.drops });
    }
  });

  it('previews earth roll changes for all 36 fairy and garden owners while retaining drop order and saved runtime values', () => {
    const { rows, params, craftingTiers, tables } = proposal();
    const saved = structuredClone({ rows, craftingTiers }), runtimeBefore = structuredClone(runtimeViews());
    params.actorLootParameters.fairy.earth.roll = { quantity: [2, 5], chance: .8 };
    const paramsBefore = structuredClone(params), diffs = derivationDiffs(tables);
    const expected = ownersFor(params, actors(params).filter(input => input.kind === 'fairy'));
    expect(diffs).toHaveLength(36); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expected.map(owner => owner.id).sort());
    for (const diff of diffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([old[0], { ...old[1], quantity: [2, 5], chance: .8 }, ...old.slice(2)]);
    }
    expect({ rows, craftingTiers }).toEqual(saved); expect(params).toEqual(paramsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('previews the total jewelry chance for all 63 guardians, preserving ordered exclusive slots', () => {
    const { rows, params, tables } = proposal(); const runtimeBefore = structuredClone(runtimeViews()), rowsBefore = structuredClone(rows);
    params.actorLootParameters.universalJewelry.totalChance = .6;
    const diffs = derivationDiffs(tables), expected = ownersFor(params, actors(params).filter(input => input.kind === 'universalJewelry'));
    expect(diffs).toHaveLength(63); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expected.map(owner => owner.id).sort());
    for (const diff of diffs) {
      const row = rowFor(rows, diff.recordId), old = row.drops;
      expect(diff.inputIds).toEqual([row.derivation!.inputId]);
      expect(diff.after.drops).toEqual(old.map(drop => ({ ...drop, chance: .3 })));
      const after = diff.after.drops as typeof old;
      expect(after.reduce((sum, drop) => sum + drop.chance, 0)).toBe(.6);
      expect(after.every(drop => drop.exclusiveGroup === params.actorLootParameters.universalJewelry.exclusiveGroup)).toBe(true);
    }
    expect(rows).toEqual(rowsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('uses the proposed tier-30 hide for 18 fairy/garden and four fairy crown tables', () => {
    const data = proposal(), { rows, params, craftingTiers, tables } = data;
    const runtimeBefore = structuredClone(runtimeViews()), rowsBefore = structuredClone(rows), paramsBefore = structuredClone(params);
    const tier30 = craftingTiers.find(row => row.catalog === 'REGIONAL_CRAFTING_TIERS' && row.tier === 30)!;
    tier30.hide = craftingTiers.find(row => row.catalog === 'REGIONAL_CRAFTING_TIERS' && row.tier === 60)!.hide;
    const editedCrafting = structuredClone(craftingTiers), diffs = derivationDiffs(tables);
    const actorOwners = ownersFor(params, actors(params).filter(input => input.kind === 'fairy' && input.tier === 30));
    expect(actorOwners).toHaveLength(18);
    const crownInputs = params.sourceInputs.filter(input => input.kind === 'fairyCrown' && input.tier === 30);
    expect(crownInputs.map(input => input.id).sort()).toEqual([
      'fairyCrown/lantern_sprite', 'fairyCrown/moonpetal_stalker', 'fairyCrown/dewglass_weaver', 'fairyCrown/bloomheart_matriarch',
    ].sort());
    const crownIds = new Set(crownInputs.map(input => input.id));
    const expected = [...actorOwners, ...params.sourceOwners.filter(owner => crownIds.has(owner.inputId))];
    expect(diffs).toHaveLength(22); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expected.map(owner => owner.id).sort());
    for (const diff of diffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...old[0], itemId: tier30.hide }, ...old.slice(1)]);
    }
    expect(Object.hasOwn(params.actorLootParameters, 'regionalCraftingTiers')).toBe(false);
    expect(rows).toEqual(rowsBefore); expect(params).toEqual(paramsBefore); expect(craftingTiers).toEqual(editedCrafting);
    expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('propagates ordinary fabric to 47 tables and boss fabric to the four named bosses', () => {
    const { rows, params, tables } = proposal();
    const rowsBefore = structuredClone(rows), runtimeBefore = structuredClone(runtimeViews());
    params.regionalFabric.ordinary = { quantity: [2, 4], chance: .6 };
    const ordinaryInputs = params.sourceInputs.filter(input => input.kind === 'fairy'
      || (input.kind === 'fairyCrown' || input.kind === 'crownwardDragon') && !input.boss);
    expect(ordinaryInputs.filter(input => input.kind === 'fairy')).toHaveLength(36);
    expect(ordinaryInputs.filter(input => input.kind === 'fairyCrown')).toHaveLength(9);
    expect(ordinaryInputs.filter(input => input.kind === 'crownwardDragon').map(input => input.id).sort()).toEqual([
      'crownwardDragon/crownward_red_hatchling', 'crownwardDragon/crownward_black_hatchling',
    ].sort());
    const ordinaryIds = new Set(ordinaryInputs.map(input => input.id));
    const diffs = derivationDiffs(tables); expect(diffs).toHaveLength(47);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(params.sourceOwners.filter(owner => ordinaryIds.has(owner.inputId)).map(owner => owner.id).sort());
    for (const diff of diffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...old[0], quantity: [2, 4], chance: .6 }, ...old.slice(1)]);
    }
    params.regionalFabric.ordinary = structuredClone(rawParams.regionalFabric.ordinary) as typeof params.regionalFabric.ordinary;
    params.regionalFabric.boss.chance = .4;
    const bossDiffs = derivationDiffs(tables);
    expect(bossDiffs.map(diff => diff.recordId).sort()).toEqual([
      'loot_enemy_ivory_castellan_t40', 'loot_enemy_bloomheart_matriarch_t30',
      'loot_enemy_amethyst_sovereign_t60', 'loot_enemy_crownward_red_dragon_t40',
    ].sort());
    for (const diff of bossDiffs) {
      const old = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...old[0], chance: .4 }, ...old.slice(1)]);
    }
    expect(rows).toEqual(rowsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('keeps saved actor loot after tag removal and preserves the source owner ledger', () => {
    const { rows, params, tables } = proposal();
    const owner = ownersFor(params, actors(params).filter(input => input.kind === 'fairy'))[0]!, row = rowFor(rows, owner.id);
    const saved = structuredClone(row.drops); params.actorLootParameters.fairy.earth.roll.chance = .8;
    expect(derivationDiffs(tables)).toHaveLength(36); delete row.derivation;
    expect(deriveRecord('lootTables', row, tables)).toBeUndefined(); expect(row.drops).toEqual(saved);
    expect(derivationDiffs(tables)).toHaveLength(35); expect(validateSourceLootLinks(tables)).toEqual([]);
    expect(owner.mode).toBe('formula');
  });

  it('requires actor graph dependencies and the actual complete crafting tiers collection for previews', () => {
    const data = proposal(), { rows, params, tables } = data;
    for (const kind of ['fairy', 'universalJewelry'] as const) {
      const input = actors(params).find(input => input.kind === kind)!;
      expect(() => deriveSourceLootGraph(params.sourceLoot, [input])).toThrow(`Missing actor loot dependencies for ${input.id}`);
    }
    const owner = ownersFor(params, actors(params))[0]!, row = rowFor(rows, owner.id);
    tables.delete('craftingTiers');
    expect(() => deriveRecord('lootTables', row, tables)).toThrow('craftingTiers');
    tables.set('craftingTiers', data.craftingTiers.filter(row => row.tier !== 30));
    expect(() => deriveRecord('lootTables', row, tables)).toThrow('regional fabric');
    const corePrefixes = new Set(['legacy', 'expansion', 'starter', 'rpg', 'variant', 'basic', 'forest', 'ash', 'stone']);
    const coreInputs = params.sourceInputs.filter(input => corePrefixes.has(input.id.split('/')[0]!));
    expect(deriveSourceLootGraph(params.sourceLoot, coreInputs).size).toBe(114);
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('actor loot original owner evidence', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });
  it('matches all 99 integrated actor owner tables against independent baseline drops', () => {
    const data = proposal(), { params } = data;
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs, dependencies(data));
    const owners = ownersFor(params, actors(params)); expect(owners).toHaveLength(99);
    for (const owner of owners) {
      const original = baseline.records.lootTables.find(row => row.id === owner.id)!;
      expect(original, owner.id).toBeDefined(); expect(graph.get(owner.inputId), owner.id).toEqual(original.drops);
    }
  });
});
