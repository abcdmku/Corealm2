import { describe, expect, it } from 'vitest';
import rawTables from '../game/content/data/lootTables.json';
import rawParameters from '../game/content/data/balance/loot.json';
import { deriveRecord, derivationDiffs } from '../game/src/content/balance/derivations.js';
import { deriveSourceLootGraph } from '../game/src/content/balance/sourceLootGraph.js';
import { lootBalanceSchema } from '../game/src/content/schema/balance.js';
import { SourceLootInputsSchema } from '../game/src/content/schema/sourceLoot.js';
import { SourceLootDerivationSchema } from '../game/src/content/schema/lootDerivation.js';
import { validateSourceLootLinks } from '../game/src/content/schema/sourceLootLinks.js';
import { LootTableSchema } from '../game/src/content/schema/loot.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { LOOT_RECORDS } from '../game/src/content/lootData.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { STARTER_CREATURES } from '../game/src/content/starterCreatures.js';
import { RPG_BESTIARY, RPG_BESTIARY_STAGED } from '../game/src/content/rpgBestiary.js';
import { REGIONAL_CREATURE_VARIANTS } from '../game/src/content/regionalCreatureVariants.js';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';
import { FANTASY_TIER_BLOCKS } from '../game/src/content/enemies.js';

function proposal() {
  const rows = parseCollection(LootTableSchema, structuredClone(rawTables), { name: 'lootTables' });
  const params = parseValue(lootBalanceSchema, structuredClone(rawParameters), 'balance/loot');
  return { rows, params, tables: new Map<string, unknown>([['lootTables', rows], ['balance/loot', params]]) };
}
function rowFor(rows: ReturnType<typeof proposal>['rows'], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing test loot owner ${id}`); return row;
}
function runtimeViews() {
  return { loot: LOOT_RECORDS, enemies: ENEMY_DATA, labEnemies: LAB_ONLY_ENEMY_DATA, starter: STARTER_CREATURES,
    rpg: RPG_BESTIARY, stagedRpg: RPG_BESTIARY_STAGED, variants: REGIONAL_CREATURE_VARIANTS,
    stone: STONE_CREATURE_REDESIGNS, fantasy: FANTASY_TIER_BLOCKS };
}

describe('source loot derivation ownership and previews', () => {
  it('recomputes all 100 shipped formula owners while the 59 authored owners remain untagged', () => {
    const { rows, params, tables } = proposal();
    expect(params.sourceInputs).toHaveLength(114); expect(params.sourceOwners).toHaveLength(159);
    const formula = params.sourceOwners.filter(owner => owner.mode === 'formula');
    const authored = params.sourceOwners.filter(owner => owner.mode === 'authored');
    expect(formula).toHaveLength(100); expect(authored).toHaveLength(59);
    expect(rows.filter(row => row.derivation?.kind === 'sourceLoot.v1')).toHaveLength(100);
    expect(validateSourceLootLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
    for (const owner of formula) {
      const row = rowFor(rows, owner.id);
      expect(row.derivation).toEqual({ kind: 'sourceLoot.v1', inputId: owner.inputId });
      const output = deriveRecord('lootTables', row, tables)!;
      expect(Object.keys(output)).toEqual(['drops']); expect(output).toEqual({ drops: row.drops });
    }
    for (const owner of authored) {
      const row = rowFor(rows, owner.id);
      expect(Object.hasOwn(row, 'derivation')).toBe(false);
      expect(deriveRecord('lootTables', row, tables)).toBeUndefined();
    }
  });

  it('previews seven starter rolls while retaining stored loot and runtime source views', () => {
    const { rows, params, tables } = proposal(); const runtimeBefore = structuredClone(runtimeViews()), rowsBefore = structuredClone(rows);
    params.sourceLoot.starter = { quantity: [2, 4], chance: .8 };
    const before = structuredClone(params), diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(7);
    const starterIds = new Set(params.sourceInputs.filter(input => input.kind === 'starter').map(input => input.id));
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(params.sourceOwners.filter(owner => starterIds.has(owner.inputId)).map(owner => owner.id).sort());
    for (const diff of diffs) {
      const row = rowFor(rows, diff.recordId);
      expect(diff.kind).toBe('sourceLoot.v1'); expect(diff.inputIds).toEqual([row.derivation!.inputId]);
      expect(Object.keys(diff.after)).toEqual(['drops']);
      expect(diff.after.drops).toEqual([{ itemId: row.drops[0]!.itemId, quantity: [2, 4], chance: .8 }]);
    }
    expect(rows).toEqual(rowsBefore); expect(params).toEqual(before); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('propagates an authored source edit only to its formula descendants and preserves appended roll order', () => {
    const { rows, params, tables } = proposal(); const runtimeBefore = structuredClone(runtimeViews()), rowsBefore = structuredClone(rows);
    const input = params.sourceInputs.find(input => input.id === 'expansion/redbrush_fox')!;
    if (input.kind !== 'authored') throw new Error('Expected authored source input');
    input.drops[0]!.chance = .4; input.drops[0]!.quantity = [2, 3];
    const diffs = derivationDiffs(tables);
    const owners = params.sourceOwners.filter(owner => owner.inputId === 'variant/gloam_fox');
    expect(owners).toHaveLength(1); expect(diffs.map(diff => diff.recordId)).toEqual(owners.map(owner => owner.id));
    const original = rowFor(rows, owners[0]!.id).drops;
    expect(diffs[0]!.after.drops).toEqual([{ ...original[0], chance: .4, quantity: [2, 3] }, ...original.slice(1)]);
    expect((diffs[0]!.after.drops as typeof original).at(-1)).toEqual(original.at(-1));
    expect(rows).toEqual(rowsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it.each(['caster', 'other'] as const)('propagates RPG %s chance through inherited and fantasy owner tables', role => {
    const { rows, params, tables } = proposal(); const runtimeBefore = structuredClone(runtimeViews()), rowsBefore = structuredClone(rows);
    const inputs = new Map(params.sourceInputs.map(input => [input.id, input]));
    const affected = (id: string): boolean => {
      const input = inputs.get(id)!;
      if (input.kind === 'inherit' || input.kind === 'variantAppend') return affected(input.sourceInputId);
      return input.kind === 'rpg' && (role === 'caster' ? input.role === 'caster' : input.role !== 'caster');
    };
    const expectedOwners = params.sourceOwners.filter(owner => owner.mode === 'formula' && affected(owner.inputId));
    expect(expectedOwners.length).toBeGreaterThan(0);
    params.sourceLoot.rpg.chance[role] = .8;
    const paramsBefore = structuredClone(params), diffs = derivationDiffs(tables);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(expectedOwners.map(owner => owner.id).sort());
    if (role === 'other') {
      expect(diffs.some(diff => diff.recordId === 'loot_enemy_moonweave_spider_t5')).toBe(true);
      expect(diffs.some(diff => diff.recordId === 'loot_enemy_cairn_treader_t1')).toBe(true);
    }
    for (const diff of diffs) {
      const original = rowFor(rows, diff.recordId).drops;
      expect(diff.after.drops).toEqual([{ ...original[0], chance: .8 }, ...original.slice(1)]);
    }
    expect(rows).toEqual(rowsBefore); expect(params).toEqual(paramsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('removes a formula tag without removing its ledger ownership or changing saved drops', () => {
    const { rows, params, tables } = proposal(); const row = rowFor(rows, 'loot_enemy_grass_viper_t1');
    const saved = structuredClone(row.drops); params.sourceLoot.starter.chance = .8;
    expect(derivationDiffs(tables)).toHaveLength(7); delete row.derivation;
    expect(deriveRecord('lootTables', row, tables)).toBeUndefined(); expect(row.drops).toEqual(saved);
    expect(derivationDiffs(tables)).toHaveLength(6); expect(validateSourceLootLinks(tables)).toEqual([]);
    expect(params.sourceOwners.find(owner => owner.id === row.id)?.mode).toBe('formula');
  });
});

describe('source loot graph validation', () => {
  it('resolves dependencies before consumers and clones inherited drop arrays', () => {
    const { params } = proposal(), saved = structuredClone(params);
    const graph = deriveSourceLootGraph(params.sourceLoot, params.sourceInputs);
    const reversedInputs = [...params.sourceInputs].reverse(), reversed = deriveSourceLootGraph(params.sourceLoot, reversedInputs);
    expect(graph.size).toBe(114); expect([...reversed.keys()]).toEqual(reversedInputs.map(input => input.id));
    for (const [id, drops] of graph) expect(reversed.get(id), id).toEqual(drops);
    const base = graph.get('rpg/shale_elemental')!, inherited = graph.get('stone/cairn_treader')!;
    expect(inherited).toEqual(base); expect(inherited).not.toBe(base); expect(inherited[0]!.quantity).not.toBe(base[0]!.quantity);
    inherited[0]!.quantity[0] = 99; expect(base[0]!.quantity[0]).toBe(1); expect(params).toEqual(saved);
  });

  it.each(['self cycle', 'two-row cycle', 'missing dependency', 'duplicate input'] as const)('rejects %s before preview', kind => {
    const { params, tables } = proposal();
    const first = params.sourceInputs.find(input => input.id === 'variant/moonweave_spider')!;
    const second = params.sourceInputs.find(input => input.id === 'variant/amethyst_spider')!;
    if (first.kind !== 'variantAppend' || second.kind !== 'variantAppend') throw new Error('Expected dependent loot inputs');
    if (kind === 'self cycle') first.sourceInputId = first.id;
    if (kind === 'two-row cycle') { first.sourceInputId = second.id; second.sourceInputId = first.id; }
    if (kind === 'missing dependency') first.sourceInputId = 'rpg/missing';
    if (kind === 'duplicate input') params.sourceInputs.push(structuredClone(first));
    expect(() => parseValue(SourceLootInputsSchema, params.sourceInputs, 'sourceInputs')).toThrow(/unique|dependencies|cycles/);
    expect(() => validateSourceLootLinks(tables)).toThrow(/unique|dependencies|cycles/);
    expect(() => deriveSourceLootGraph(params.sourceLoot, params.sourceInputs)).toThrow(/Circular|Missing|Duplicate/);
    expect(() => derivationDiffs(tables)).toThrow(/unique|dependencies|cycles/);
  });

  it.each(['foreign input', 'authored owner', 'unlisted owner', 'changed mode'] as const)('rejects a source tag with %s', kind => {
    const { rows, params, tables } = proposal();
    const row = kind === 'authored owner' ? rowFor(rows, params.sourceOwners.find(owner => owner.mode === 'authored')!.id)
      : kind === 'unlisted owner' ? rows.find(row => !params.sourceOwners.some(owner => owner.id === row.id))!
        : rowFor(rows, 'loot_enemy_grass_viper_t1');
    const originalOwner = params.sourceOwners.find(owner => owner.id === row.id);
    row.derivation = { kind: 'sourceLoot.v1', inputId: kind === 'foreign input' ? 'starter/field_wasp'
      : originalOwner?.inputId ?? 'starter/grass_viper' };
    if (kind === 'changed mode') originalOwner!.mode = 'authored';
    expect(validateSourceLootLinks(tables)).toContainEqual(expect.objectContaining({ path: `lootTables.${row.id}.derivation`, severity: 'error' }));
    expect(() => deriveRecord('lootTables', row, tables)).toThrow('Loot source ownership disagrees');
  });

  it('rejects a missing proposed ledger input even when its table has no formula tag', () => {
    const { rows, params, tables } = proposal(); const owner = params.sourceOwners.find(owner => owner.mode === 'authored')!;
    owner.inputId = 'authored/missing'; expect(rowFor(rows, owner.id).derivation).toBeUndefined();
    expect(validateSourceLootLinks(tables)).toContainEqual({ path: `balance/loot.sourceOwners.${owner.id}.inputId`, severity: 'error', message: 'Missing original loot source input' });
  });

  it('rejects removed saved tables and missing formula source inputs in proposed snapshots', () => {
    const { rows, params, tables } = proposal(); const id = 'loot_enemy_grass_viper_t1';
    const original = structuredClone(rowFor(rows, id)); rows.splice(rows.findIndex(row => row.id === id), 1);
    expect(validateSourceLootLinks(tables)).toContainEqual({ path: `balance/loot.sourceOwners.${id}.id`, severity: 'error', message: 'Missing saved loot table owner' });
    rows.push(original); params.sourceInputs = params.sourceInputs.filter(input => input.id !== 'starter/grass_viper');
    expect(validateSourceLootLinks(tables)).toContainEqual(expect.objectContaining({ path: `lootTables.${id}.derivation`, severity: 'error' }));
    expect(() => deriveRecord('lootTables', original, tables)).toThrow('Missing loot source');
  });

  it('rejects unknown derivation fields and duplicate owner identities', () => {
    const { params } = proposal();
    expect(() => parseValue(SourceLootDerivationSchema, { kind: 'sourceLoot.v1', inputId: 'starter/grass_viper', drops: [] }, 'derivation')).toThrow();
    params.sourceOwners.push(structuredClone(params.sourceOwners[0]!));
    expect(() => parseValue(lootBalanceSchema, params, 'balance/loot')).toThrow('owners must be unique');
  });
});
