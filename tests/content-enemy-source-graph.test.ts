import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { deriveEnemySourceGraph } from '../game/src/content/balance/enemySourceGraph.js';
import { scaleFantasy } from '../game/src/content/balance/enemySourceVariants.js';
import { deriveRecord, derivationDiffs, sameValue } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemySourceGraphInputsSchema } from '../game/src/content/schema/enemySourceGraph.js';
import { EnemyDerivationSchema, FantasyEnemyDerivationSchema } from '../game/src/content/schema/enemyDerivation.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { FANTASY_TIER_BLOCKS } from '../game/src/content/enemies.js';
import { REGIONAL_CREATURE_VARIANTS } from '../game/src/content/regionalCreatureVariants.js';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import { RPG_BESTIARY, RPG_BESTIARY_STAGED } from '../game/src/content/rpgBestiary.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

function proposal() {
  const rows = parseCollection(EnemyRecordSchema, structuredClone(rawEnemies), { name: 'enemies' }) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  return { rows, params, tables: new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]) };
}
function rowFor(rows: Record<string, unknown>[], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing test enemy ${id}`); return row;
}
function dependency(params: ReturnType<typeof proposal>['params'], id: string) {
  const input = params.sourceInputs.find(input => input.id === id);
  if (!input || (input.kind !== 'variant' && input.kind !== 'redesign')) throw new Error(`Missing dependency test input ${id}`);
  return input;
}
function runtimeViews() {
  return { enemies: ENEMY_DATA, labEnemies: LAB_ONLY_ENEMY_DATA, variants: REGIONAL_CREATURE_VARIANTS,
    forest: FOREST_CREATURE_REDESIGNS, stone: STONE_CREATURE_REDESIGNS, ash: ASH_CREATURE_REDESIGNS,
    rpg: RPG_BESTIARY, stagedRpg: RPG_BESTIARY_STAGED, fantasy: FANTASY_TIER_BLOCKS };
}

describe('enemy source dependency graph', () => {
  it('resolves all 79 original inputs independently of array order and preserves caller order in the result', () => {
    const { rows, params } = proposal();
    const before = structuredClone(params), graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs);
    const reversedInputs = [...params.sourceInputs].reverse(), reversed = deriveEnemySourceGraph(params.sourceParameters, reversedInputs);
    expect(graph.size).toBe(79);
    expect([...graph.keys()]).toEqual(params.sourceInputs.map(input => input.id));
    expect([...reversed.keys()]).toEqual(reversedInputs.map(input => input.id));
    expect(graph.get('variant/moonweave_spider')!.marks).toBe(graph.get('rpg/webweaver_spider')!.marks);
    expect(graph.get('variant/amethyst_spider')!.marks).toBe(graph.get('rpg/webweaver_spider')!.marks);
    for (const [id, output] of graph) {
      expect(reversed.get(id), id).toEqual(output);
      const row = rowFor(rows, output.id);
      expect(output, id).toEqual(Object.fromEntries(Object.keys(output).map(key => [key, row[key]])));
    }
    expect(params).toEqual(before);
  });

  it.each(['self cycle', 'two-row cycle', 'missing dependency', 'final enemy reference', 'duplicate input'] as const)('rejects %s in both schema validation and graph execution', kind => {
    const { params, tables } = proposal();
    const first = dependency(params, 'variant/moonweave_spider'), second = dependency(params, 'variant/amethyst_spider');
    if (kind === 'self cycle') first.sourceInputId = first.id;
    if (kind === 'two-row cycle') { first.sourceInputId = second.id; second.sourceInputId = first.id; }
    if (kind === 'missing dependency') first.sourceInputId = 'rpg/missing';
    if (kind === 'final enemy reference') first.sourceInputId = 'webweaver_spider_t5';
    if (kind === 'duplicate input') params.sourceInputs.push(structuredClone(first));
    expect(() => parseValue(EnemySourceGraphInputsSchema, params.sourceInputs, 'sourceInputs')).toThrow(/unique|dependencies|acyclic/);
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).toThrow(/unique|dependencies|acyclic/);
    expect(() => validateEnemyFormulaLinks(tables)).toThrow(/unique|dependencies|acyclic/);
    expect(() => deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs)).toThrow(/Circular|Missing original source|Duplicate/);
  });

  it('propagates a role accuracy edit through regional variants, native redesigns, and scaled fantasy rows', () => {
    const { rows, params, tables } = proposal();
    const runtimeBefore = structuredClone(runtimeViews()), recordsBefore = structuredClone(rows);
    const inputs = new Map(params.sourceInputs.map(input => [input.id, input]));
    const affected = (id: string): boolean => {
      const input = inputs.get(id)!;
      if (input.kind === 'variant' || input.kind === 'redesign') return affected(input.sourceInputId);
      return input.kind === 'rpg' && input.role === 'skirmisher';
    };
    const expectedIds = rows.filter(row => {
      if (!row.derivation) return false;
      const tag = parseValue(EnemyDerivationSchema, row.derivation, 'derivation');
      return tag.kind === 'sourceEnemy.v1' ? affected(tag.inputId) : tag.kind === 'fantasyScale.v1' && affected(tag.sourceInputId);
    }).map(row => String(row.id)).filter(id => id !== 'grave_lantern_t1').sort();
    params.sourceParameters.rpg.roles.skirmisher.accuracy += 8;
    const paramsBefore = structuredClone(params), diffs = derivationDiffs(tables);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(expectedIds);
    // At native tier 20, both 12/20 and 20/20 round to one at tier 1.
    expect(deriveRecord('enemies', rowFor(rows, 'grave_lantern_t1'), tables)!.accuracy).toBe(1);
    for (const diff of diffs) {
      expect(Object.keys(diff.after).filter(key => !sameValue(diff.after[key], diff.before[key]))).toEqual(['accuracy']);
      expect(diff.after.accuracy).toBeGreaterThan(diff.before.accuracy as number);
    }
    for (const [id, accuracy] of [['webweaver_spider_t5', 20], ['moonweave_spider_t5', 20], ['amethyst_spider_t5', 20],
      ['fen_crawler_t10', 20], ['fen_crawler_t1', 2], ['fen_crawler_t5', 10], ['fen_crawler_t20', 40]] as const) {
      expect(diffs.find(diff => diff.recordId === id)?.after.accuracy, id).toBe(accuracy);
    }
    expect(rows).toEqual(recordsBefore); expect(params).toEqual(paramsBefore); expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('keeps all variant and redesign health overrides when the original RPG health base changes', () => {
    const { rows, params, tables } = proposal(); const before = structuredClone(runtimeViews());
    const expectedIds = params.sourceInputs.filter(input => input.kind === 'rpg').map(input => `${input.speciesId}_t${input.tier}`).sort();
    params.sourceParameters.rpg.healthBase += 10;
    const diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(25); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expectedIds);
    for (const diff of diffs) {
      expect(Object.keys(diff.after).filter(key => !sameValue(diff.after[key], diff.before[key]))).toEqual(['maxHealth']);
      expect(diff.after.maxHealth).toBeGreaterThan(rowFor(rows, diff.recordId).maxHealth as number);
    }
    expect(runtimeViews()).toEqual(before);
  });
});

describe('fantasy source ownership and optional values', () => {
  it('keeps all 15 native tiers on their source formula while the other 45 tiers use scaling', () => {
    const { rows, params } = proposal(), graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs);
    expect(params.fantasy.sourceInputIds).toHaveLength(15);
    let nativeCount = 0, scaledCount = 0;
    for (const sourceInputId of params.fantasy.sourceInputIds) {
      const source = graph.get(sourceInputId)!;
      for (const tier of params.fantasy.tiers) {
        const row = rowFor(rows, `${source.family}_t${tier}`);
        if (tier === source.tier) { nativeCount++; expect(row.derivation).toEqual({ kind: 'sourceEnemy.v1', inputId: sourceInputId }); }
        else { scaledCount++; expect(row.derivation).toEqual({ kind: 'fantasyScale.v1', sourceInputId, tier }); }
      }
    }
    expect([nativeCount, scaledCount]).toEqual([15, 45]);
  });

  it('propagates inherited non-scaled source fields to every fantasy tier', () => {
    const { rows, params, tables } = proposal();
    params.sourceParameters.rpg.roles.skirmisher.attackSpeedMs += 123;
    const source = params.sourceInputs.find(input => input.id === 'forest/fen_crawler')!;
    if (source.kind !== 'redesign') throw new Error('Expected redesign');
    source.name = 'Changed crawler'; source.behaviour = 'passive';
    for (const tier of [1, 5, 10, 20]) {
      const row = rowFor(rows, `fen_crawler_t${tier}`);
      const output = deriveRecord('enemies', row, tables)!;
      expect(output.name).toBe('Changed crawler');
      expect(output.behaviour).toBe('passive');
      expect(output.attackSpeedMs).toBe(Number(row.attackSpeedMs) + 123);
      expect(output).not.toHaveProperty('drops');
      expect(Object.hasOwn(output, 'respawnSeconds')).toBe(true);
      expect(output.respawnSeconds).toBeUndefined();
    }
    expect(rowFor(rows, 'fen_crawler_t1').name).not.toBe('Changed crawler');
  });

  it('preserves native identity and absent optional fields while nonnative scaling writes own undefined marks', () => {
    const { params } = proposal(); const graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs);
    const { marks: _marks, attackStyle: _style, attackRangeM: _range, ...fields } = graph.get('forest/fen_crawler')!;
    const source = { ...fields, drops: [] };
    const before = structuredClone(source);
    expect(scaleFantasy(params.fantasy, source, source.tier)).toBe(source);
    expect(Object.hasOwn(source, 'marks')).toBe(false);
    const scaled = scaleFantasy(params.fantasy, source, 1);
    expect(Object.hasOwn(scaled, 'marks')).toBe(true); expect(scaled.marks).toBeUndefined();
    expect(Object.hasOwn(scaled, 'attackStyle')).toBe(false); expect(Object.hasOwn(scaled, 'attackRangeM')).toBe(false);
    expect(scaled.drops).toBe(source.drops); expect(source).toEqual(before);
  });

  it.each([
    { kind: 'fantasyScale.v2', sourceInputId: 'forest/fen_crawler', tier: 1 },
    { kind: 'fantasyScale.v1', sourceInputId: 'forest/fen_crawler', tier: 1, inputId: 'rpg/webweaver_spider' },
    { kind: 'fantasyScale.v1', sourceInputId: 'forest/fen_crawler', tier: 0 },
    { kind: 'fantasyScale.v1', sourceInputId: '', tier: 1 },
  ])('rejects unknown or malformed fantasy tag %j', tag => {
    expect(() => parseValue(FantasyEnemyDerivationSchema, tag, 'derivation')).toThrow();
    const { rows, tables } = proposal(); const row = rowFor(rows, 'fen_crawler_t1'); row.derivation = tag;
    expect(() => deriveRecord('enemies', row, tables)).toThrow();
  });

  it.each([
    ['missing source', 'forest/missing', 1], ['nonfantasy source', 'rpg/webweaver_spider', 1],
    ['another family', 'forest/briar_harrow', 1], ['unlisted tier', 'forest/fen_crawler', 30],
    ['another saved tier', 'forest/fen_crawler', 5],
  ] as const)('rejects %s using proposed source and tier values', (_label, sourceInputId, tier) => {
    const { rows, tables } = proposal(); const row = rowFor(rows, 'fen_crawler_t1');
    row.derivation = { kind: 'fantasyScale.v1', sourceInputId, tier };
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: 'enemies.fen_crawler_t1.derivation', severity: 'error' }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow(/fantasy|Fantasy/);
  });

  it('rejects a fantasy source removed from the proposed roster', () => {
    const { rows, params, tables } = proposal();
    params.fantasy.sourceInputIds = params.fantasy.sourceInputIds.filter(id => id !== 'forest/fen_crawler');
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: 'enemies.fen_crawler_t1.derivation', severity: 'error' }));
    expect(() => deriveRecord('enemies', rowFor(rows, 'fen_crawler_t1'), tables)).toThrow('Unknown fantasy source or tier');
  });

  it('rejects fantasy formula ownership on another catalog', () => {
    const { rows, tables } = proposal(); const row = rowFor(rows, 'fen_crawler_t1'); row.catalog = 'CREATURE_SPECIES_BLOCKS';
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: 'enemies.fen_crawler_t1.derivation', severity: 'error' }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Invalid fantasy source');
  });

  it('rejects native-tier scaling even when its catalog and tag are changed together', () => {
    const { rows, tables } = proposal(); const row = rowFor(rows, 'fen_crawler_t10');
    row.catalog = 'FANTASY_TIER_BLOCKS'; row.derivation = { kind: 'fantasyScale.v1', sourceInputId: 'forest/fen_crawler', tier: 10 };
    expect(validateEnemyFormulaLinks(tables)).toContainEqual({ path: 'enemies.fen_crawler_t10.derivation', severity: 'error',
      message: 'Native fantasy rows retain their original source derivation' });
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Invalid fantasy source');
  });

  it('rejects nonregistered fantasy rows in both graph links and direct previews', () => {
    const { rows, tables } = proposal(); const row = rowFor(rows, 'fen_crawler_t1'); row.stage = 'labOnly';
    expect(validateEnemyFormulaLinks(tables)).toContainEqual({ path: 'enemies.fen_crawler_t1.derivation', severity: 'error',
      message: 'Fantasy derivation requires a registered scaled fantasy row' });
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Invalid fantasy source');
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('original fantasy projection evidence', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });
  it('matches all 45 scaled projections against independent original baseline records', () => {
    const { rows, tables } = proposal();
    const fantasyRows = rows.filter(row => row.derivation && parseValue(EnemyDerivationSchema, row.derivation, 'derivation').kind === 'fantasyScale.v1');
    expect(fantasyRows).toHaveLength(45);
    for (const row of fantasyRows) {
      const original = baseline.records.enemies.find(original => original.id === row.id)!;
      expect(original).toBeDefined();
      const output = deriveRecord('enemies', row, tables)!;
      expect(Object.keys(output).sort()).toEqual(['accuracy', 'aggroRadius', 'armour', 'attackLevel', 'attackRangeM', 'attackSpeedMs', 'attackStyle', 'behaviour', 'defenceLevel', 'family', 'id', 'magicArmour', 'marks', 'maxHealth', 'maxHit', 'moveSpeedMps', 'name', 'respawnSeconds', 'tier', 'walkSpeedMps']);
      expect(output, String(row.id)).toEqual(Object.fromEntries(Object.keys(output).map(key => [key, original[key as keyof typeof original]])));
    }
  });
});
