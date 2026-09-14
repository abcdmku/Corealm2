import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { deriveEnemySourceGraph } from '../game/src/content/balance/enemySourceGraph.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { deriveRecord, derivationDiffs, sameValue } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import { EnemySourceGraphInputsSchema } from '../game/src/content/schema/enemySourceGraph.js';
import type { DescendantSourceInput } from '../game/src/content/schema/enemyDescendantSources.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { ENEMY_BALANCE } from '../game/src/content/enemyBalanceData.js';
import { ENEMY_DATA } from '../game/src/content/enemyData.js';
import { FAIRY_CROWN_SPECIES } from '../game/src/content/fairyCrownCreatures.js';
import { CROWNWARD_DRAGON_SPECIES } from '../game/src/content/crownwardDragons.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import type { EnemyDef } from '../game/src/content/index.js';

function proposal() {
  const rows = parseCollection(EnemyRecordSchema, structuredClone(rawEnemies), { name: 'enemies' }) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  return { rows, params, tables: new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]) };
}
function descendants(params: ReturnType<typeof proposal>['params']) {
  return params.sourceInputs.filter((input): input is DescendantSourceInput => input.kind === 'fairyCrown' || input.kind === 'crownwardDragon');
}
function graph(params: ReturnType<typeof proposal>['params']) {
  return deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
}
function runtimeViews() {
  return { params: ENEMY_BALANCE, enemies: ENEMY_DATA, fairy: FAIRY_CROWN_SPECIES, dragons: CROWNWARD_DRAGON_SPECIES };
}

describe('descendant source derivation integration', () => {
  it('derives all 15 registered source owners from the complete graph with their original target levels', () => {
    const { rows, params, tables } = proposal(), inputs = descendants(params), outputs = graph(params);
    expect(inputs).toHaveLength(15);
    expect(inputs.filter(input => input.kind === 'fairyCrown')).toHaveLength(12);
    expect(inputs.filter(input => input.kind === 'crownwardDragon')).toHaveLength(3);
    for (const input of inputs) {
      const output = outputs.get(input.id)!;
      const row = rows.find(row => row.id === output.id)!;
      expect(row).toMatchObject({ catalog: 'CREATURE_SPECIES_BLOCKS', stage: 'registered',
        derivation: { kind: 'sourceEnemy.v1', inputId: input.id } });
      expect(combatLevel(params.combatLevel, output)).toBe(input.targetLevel);
      const preview = deriveRecord('enemies', row, tables)!;
      expect(preview, input.id).toEqual(Object.fromEntries(Object.keys(preview).map(key => [key, row[key]])));
    }
    expect(validateEnemyFormulaLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
  });

  it('keeps authored Crownward marks separate from fairy crown tier multipliers', () => {
    const { params, tables } = proposal();
    params.descendantSourceParameters.fairyCrown.marksPerTier.ordinary = [4, 8];
    let diffs = derivationDiffs(tables);
    const ordinary = descendants(params).filter(input => input.kind === 'fairyCrown').filter(input => !input.boss);
    expect(ordinary).toHaveLength(9); expect(diffs).toHaveLength(9);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(ordinary.map(input => `${input.speciesId}_t${input.tier}`).sort());
    for (const diff of diffs) expect(Object.keys(diff.after).filter(key => !sameValue(diff.after[key], diff.before[key]))).toEqual(['marks']);
    params.descendantSourceParameters.fairyCrown.marksPerTier.ordinary = [3, 7];
    params.descendantSourceParameters.crownwardDragon.marks.miniboss = [221, 381];
    params.descendantSourceParameters.crownwardDragon.marks.boss = [601, 1001];
    diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(3);
    expect(diffs.find(diff => diff.recordId === 'crownward_red_dragon_t40')!.after.marks).toEqual([601, 1001]);
    for (const id of ['crownward_red_hatchling_t40', 'crownward_black_hatchling_t40']) {
      expect(diffs.find(diff => diff.recordId === id)!.after.marks).toEqual([221, 381]);
    }
  });

  it.each(['keeper motion', 'dragon motion'] as const)('cascades %s into descendants without tagging the overwritten source canonicals', mode => {
    const { rows, params, tables } = proposal(), before = graph(params);
    const runtimeBefore = structuredClone(runtimeViews()), savedRows = structuredClone(rows);
    if (mode === 'keeper motion') params.wildernessSourceParameters.wildernessBody.moveSpeedMps.heavy += .4;
    else params.wildernessSourceParameters.wildernessDragon.deep.moveSpeedMps += .2;
    const after = graph(params), diffs = derivationDiffs(tables);
    const expectedIds = mode === 'keeper motion' ? ['ivory_castellan_t40', 'pearl_knight_t40'] : ['crownward_red_dragon_t40'];
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(expectedIds);
    for (const input of descendants(params).filter(input => expectedIds.includes(after.get(input.id)!.id))) {
      const output = after.get(input.id)!, source = after.get(input.sourceInputId)!;
      const multiplier = input.kind === 'fairyCrown' ? Math.min(params.descendantSourceParameters.fairyCrown.movementScaleCap, input.nativeScale) : 1;
      expect(output.moveSpeedMps).toBe(source.moveSpeedMps! * multiplier);
      expect(output.moveSpeedMps).toBeGreaterThan(before.get(input.id)!.moveSpeedMps!);
      expect(combatLevel(params.combatLevel, output)).toBe(input.targetLevel);
      expect(output.marks).toEqual(before.get(input.id)!.marks);
      expect(rows.find(row => row.id === source.id)!.derivation).toBeUndefined();
    }
    expect(rows).toStrictEqual(savedRows); expect(runtimeViews()).toStrictEqual(runtimeBefore);
  });

  it('propagates an absent authored movement field through crown hart without synthesizing a default', () => {
    const { rows, params, tables } = proposal();
    const source = params.sourceInputs.find(input => input.id === 'expansion/marchwild_horse')!;
    if (source.kind !== 'expansion') throw new Error('Missing horse source');
    delete source.authored.moveSpeedMps; delete source.authored.walkSpeedMps;
    const outputs = graph(params), crown = outputs.get('fairyCrown/crown_hart')!;
    expect(Object.hasOwn(crown, 'moveSpeedMps')).toBe(false); expect(Object.hasOwn(crown, 'walkSpeedMps')).toBe(false);
    const diffs = derivationDiffs(tables);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(['crown_hart_t40', 'marchwild_horse_t5']);
    const crownRow = rows.find(row => row.id === 'crown_hart_t40')!;
    const preview = deriveRecord('enemies', crownRow, tables)!;
    for (const key of ['moveSpeedMps', 'walkSpeedMps']) {
      expect(Object.hasOwn(preview, key)).toBe(true); expect(preview[key]).toBeUndefined();
      expect(crownRow[key]).toBeGreaterThan(0);
    }
  });

  it('requires descendant parameters explicitly and resolves dependencies without reading stored enemies', () => {
    const { params } = proposal(), { descendantSourceParameters: _descendants, ...withoutDescendants } = params;
    for (const input of descendants(params)) {
      expect(() => deriveEnemySourceGraph(params.sourceParameters, [input], withoutDescendants))
        .toThrow(`Missing descendant source dependencies for ${input.id}`);
    }
    params.sourceInputs = params.sourceInputs.filter(input => input.id !== 'wildernessBody/nightforge_marshal');
    expect(() => parseValue(EnemySourceGraphInputsSchema, params.sourceInputs, 'sourceInputs')).toThrow(/dependencies/);
    expect(() => graph(params)).toThrow('Missing original source input wildernessBody/nightforge_marshal');
  });

  it.each(['self cycle', 'cross-family cycle', 'saved enemy reference'] as const)('rejects a descendant %s', mode => {
    const { params } = proposal(), input = descendants(params).find(input => input.id === 'fairyCrown/bloomheart_matriarch')!;
    if (mode === 'self cycle') input.sourceInputId = input.id;
    if (mode === 'cross-family cycle') {
      const boss = params.sourceInputs.find(input => input.id === 'regionalBossBody/boss_rootheart')!;
      if (boss.kind !== 'regionalBossBody') throw new Error('Missing rootheart body');
      boss.sourceInputId = input.id;
    }
    if (mode === 'saved enemy reference') input.sourceInputId = 'boss_rootheart_t5';
    expect(() => parseValue(EnemySourceGraphInputsSchema, params.sourceInputs, 'sourceInputs')).toThrow(/dependencies|acyclic/);
    expect(() => graph(params)).toThrow(/Missing original source|Circular/);
  });
});

function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'number': case 'string': case 'boolean': return value.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return value.values.map(restore);
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    default: throw new Error(`Unsupported snapshot ${value.kind}`);
  }
}
describe.skipIf(!existsSync(new URL('../.baseline/game/src/content/enemies.ts', import.meta.url)))('original descendant graph evidence', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });
  it('matches all 15 original source outputs through their source dependency chains', () => {
    const { params } = proposal(), outputs = graph(params);
    for (const input of descendants(params)) {
      const [module, catalog] = input.kind === 'fairyCrown' ? ['fairyCrownCreatures', 'FAIRY_CROWN_SPECIES']
        : ['crownwardDragons', 'CROWNWARD_DRAGON_SPECIES'];
      const originals = restore(baseline.constants.find(row => row.module === module && row.name === catalog)!.value) as { stats: EnemyDef }[];
      const output = outputs.get(input.id)!;
      const original = originals.find(row => row.stats.id === output.id)!;
      expect(original, input.id).toBeDefined();
      const { drops, ...expected } = original.stats;
      expect(output, input.id).toStrictEqual(expected);
    }
  });
});
