import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { deriveEnemySourceGraph } from '../game/src/content/balance/enemySourceGraph.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { deriveRecord, derivationDiffs, sameValue } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import { EnemySourceGraphInputsSchema } from '../game/src/content/schema/enemySourceGraph.js';
import type { WildernessBaseSourceInput } from '../game/src/content/schema/enemyWildernessSources.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { ENEMY_BALANCE } from '../game/src/content/enemyBalanceData.js';
import { REGIONAL_BOSS_SPECIES } from '../game/src/content/regionalBossBodies.js';
import { WILDERNESS_CREATURE_SPECIES } from '../game/src/content/wildernessCreatureSpecies.js';
import { WILDERNESS_DRAGONS } from '../game/src/content/wildernessDragons.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import type { EnemyDef } from '../game/src/content/index.js';

function proposal() {
  const rows = parseCollection(EnemyRecordSchema, structuredClone(rawEnemies), { name: 'enemies' }) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  return { rows, params, tables: new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]) };
}
function wilderness(params: ReturnType<typeof proposal>['params']) {
  return params.sourceInputs.filter((input): input is WildernessBaseSourceInput =>
    ['wildernessBody', 'wildernessDragon', 'regionalBossBody'].includes(input.kind));
}
function graph(params: ReturnType<typeof proposal>['params']) {
  return deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
}
function rowFor(rows: Record<string, unknown>[], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing Wilderness test enemy ${id}`); return row;
}
function runtimeViews() {
  return { enemies: ENEMY_DATA, labs: LAB_ONLY_ENEMY_DATA, params: ENEMY_BALANCE,
    bosses: REGIONAL_BOSS_SPECIES, bodies: WILDERNESS_CREATURE_SPECIES, dragons: WILDERNESS_DRAGONS };
}

describe('Wilderness source derivation integration', () => {
  it('resolves 218 ordered inputs while assigning source tags to only the seven regional boss bodies in this slice', () => {
    const { rows, params, tables } = proposal(), inputs = wilderness(params);
    const before = structuredClone(params), output = graph(params);
    const reversed = deriveEnemySourceGraph(params.sourceParameters, [...params.sourceInputs].reverse(), params);
    expect(inputs).toHaveLength(25); expect(output.size).toBe(218);
    expect(inputs.filter(input => input.kind === 'wildernessBody')).toHaveLength(11);
    expect(inputs.filter(input => input.kind === 'wildernessDragon')).toHaveLength(7);
    expect([...output.keys()]).toEqual(params.sourceInputs.map(input => input.id));
    expect([...reversed.keys()]).toEqual([...params.sourceInputs].reverse().map(input => input.id));
    let taggedBodies = 0, retainedSources = 0;
    for (const input of inputs) {
      const fields = output.get(input.id)!; expect(reversed.get(input.id), input.id).toStrictEqual(fields);
      const row = rowFor(rows, fields.id);
      if (input.kind === 'regionalBossBody') {
        taggedBodies++;
        expect(row).toMatchObject({ stage: 'labOnly', catalog: 'REGIONAL_BOSS_BLOCKS',
          derivation: { kind: 'sourceEnemy.v1', inputId: input.id } });
        const preview = deriveRecord('enemies', row, tables)!;
        expect(preview, input.id).toEqual(Object.fromEntries(Object.keys(preview).map(key => [key, row[key]])));
      } else {
        retainedSources++;
        expect(row.catalog).toBe('WILDERNESS_BLOCKS'); expect(row.derivation).toBeUndefined();
        expect(deriveRecord('enemies', row, tables)).toBeUndefined();
      }
    }
    expect([taggedBodies, retainedSources]).toEqual([7, 18]);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
    expect(params).toStrictEqual(before);
  });

  it('rejects source tags on all 18 overwritten canonical rows even when their IDs match the original source output', () => {
    const { rows, params, tables } = proposal(), outputs = graph(params);
    const inputs = wilderness(params).filter(input => input.kind !== 'regionalBossBody');
    expect(inputs).toHaveLength(18);
    for (const input of inputs) {
      const row = rowFor(rows, outputs.get(input.id)!.id);
      row.derivation = { kind: 'sourceEnemy.v1', inputId: input.id };
      expect(() => deriveRecord('enemies', row, tables), input.id).toThrow('Source formula catalog disagrees');
    }
    expect(validateEnemyFormulaLinks(tables).filter(issue => issue.message === 'Source formula catalog disagrees with its original generator')).toHaveLength(18);
  });

  it('reads the five shared keepers and fractional targets without changing saved canonical enemies', () => {
    const { rows, params, tables } = proposal(), before = graph(params);
    const runtimeBefore = structuredClone(runtimeViews()), savedRows = structuredClone(rows);
    params.keepers.forEach(keeper => { keeper.name = `Edited ${keeper.name}`; keeper.multiplier += .015; });
    expect(() => parseValue(EnemyBalanceSchema, params, 'balance/enemies')).not.toThrow();
    const savedParams = structuredClone(params), after = graph(params);
    const changed = [...after].filter(([id, fields]) => !sameValue(fields, before.get(id))).map(([id]) => id);
    expect(changed).toEqual(params.keepers.map(keeper => `wildernessBody/${keeper.id}`));
    for (const keeper of params.keepers) {
      const input = params.sourceInputs.find(input => input.id === `wildernessBody/${keeper.id}`)!;
      expect(input).toEqual({ id: `wildernessBody/${keeper.id}`, kind: 'wildernessBody', role: 'keeper', keeperId: keeper.id });
      const fields = after.get(input.id)!;
      expect(fields.name).toBe(keeper.name); expect(fields.tier).toBe(keeper.tier);
      expect(combatLevel(params.combatLevel, fields)).toBe(Math.round(keeper.tier * keeper.multiplier));
    }
    expect(derivationDiffs(tables)).toEqual([]);
    expect(rows).toStrictEqual(savedRows); expect(params).toStrictEqual(savedParams); expect(runtimeViews()).toStrictEqual(runtimeBefore);
  });

  it('cascades guard movement through inherited RPG sources into four regional boss bodies with their own tuned levels', () => {
    const { rows, params, tables } = proposal(), outputs = graph(params);
    const runtimeBefore = structuredClone(runtimeViews()), savedRows = structuredClone(rows);
    params.sourceParameters.rpg.roles.guard.moveSpeedMps += .25;
    const guardIds = params.sourceInputs.filter(input => input.kind === 'rpg').filter(input => input.role === 'guard').map(input => input.id);
    const dependents = wilderness(params).filter(input => input.kind === 'regionalBossBody').filter(input => guardIds.includes(input.sourceInputId));
    expect(dependents.map(input => input.bossId)).toEqual(['tempest_roc', 'mossbound', 'tideworn', 'ordrun']);
    const after = graph(params), diffs = derivationDiffs(tables);
    expect(diffs.filter(diff => diff.recordId.startsWith('boss_')).map(diff => diff.recordId).sort())
      .toEqual(dependents.map(input => after.get(input.id)!.id).sort());
    for (const diff of diffs) {
      expect(Object.keys(diff.after).filter(key => !sameValue(diff.before[key], diff.after[key]))).toEqual(['moveSpeedMps']);
      expect(diff.after.moveSpeedMps).toBe((diff.before.moveSpeedMps as number) + .25);
    }
    for (const input of dependents) {
      const fields = after.get(input.id)!, target = params.regionalBossLevels[input.bossId];
      expect(fields.moveSpeedMps).toBe(outputs.get(input.id)!.moveSpeedMps! + .25);
      expect(combatLevel(params.combatLevel, fields)).toBe(Math.round(target.tier * target.multiplier));
      expect(fields.name).toBe(input.name); expect(fields.family).toBe(input.speciesId);
    }
    expect(rows).toStrictEqual(savedRows); expect(runtimeViews()).toStrictEqual(runtimeBefore);
  });

  it('shares regional boss level edits between saved legacy bosses and separately owned lab bodies', () => {
    const { params, tables } = proposal();
    params.regionalBossLevels.cinderwake.multiplier = 4.025;
    const diffs = derivationDiffs(tables);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(['boss_cinderwake_t20', 'cinderwake_t20']);
    for (const diff of diffs) expect(combatLevel(params.combatLevel, diff.after as unknown as EnemyDef)).toBe(81);
  });

  it('requires Wilderness parameters and shared keeper and boss dependencies without expanding the core dependency contract', () => {
    const { params } = proposal();
    const { wildernessSourceParameters: _wild, ...withoutWild } = params;
    const { keepers: _keepers, ...withoutKeepers } = params;
    const { regionalBossLevels: _bosses, ...withoutBosses } = params;
    for (const input of wilderness(params)) {
      for (const dependencies of [undefined, withoutWild, withoutKeepers, withoutBosses]) {
        expect(() => deriveEnemySourceGraph(params.sourceParameters, [input], dependencies))
          .toThrow(`Missing Wilderness source dependencies for ${input.id}`);
      }
    }
    const core = params.sourceInputs.filter(input => ['expansion', 'starter', 'rpg', 'variant', 'redesign'].includes(input.kind));
    expect(deriveEnemySourceGraph(params.sourceParameters, core).size).toBe(79);
  });

  it.each(['missing source', 'self cycle', 'duplicate input'] as const)('rejects a regional body %s through schema and execution', mode => {
    const { params } = proposal(), input = wilderness(params).find(input => input.kind === 'regionalBossBody')!;
    if (input.kind !== 'regionalBossBody') throw new Error('Missing boss fixture');
    if (mode === 'missing source') input.sourceInputId = 'rpg/missing';
    if (mode === 'self cycle') input.sourceInputId = input.id;
    if (mode === 'duplicate input') params.sourceInputs.push(structuredClone(input));
    expect(() => parseValue(EnemySourceGraphInputsSchema, params.sourceInputs, 'sourceInputs')).toThrow(/unique|dependencies|acyclic/);
    expect(() => graph(params)).toThrow(/Missing original source|Circular|Duplicate/);
  });
});

const sourceUrl = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
const originalModules = ['enemies', 'index', 'encounterBalance', 'wildernessCreatureSpecies', 'wildernessDragons', 'regionalBossBodies'];
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
describe.skipIf(!originalModules.every(module => existsSync(sourceUrl(module))))('original Wilderness graph source evidence', () => {
  let baseline: M4Baseline, bodyStats: (input: { id: string; name: string; tier: number; level: number; role: string }) => EnemyDef;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    const read = (module: string) => readFileSync(sourceUrl(module), 'utf8');
    const functionSource = (source: string, name: string) => {
      const start = source.indexOf(`function ${name}(`), end = /\r?\n}(?=\r?\n|$)/.exec(source.slice(start));
      if (start < 0 || !end) throw new Error(`Missing original ${name}`);
      return source.slice(start, start + end.index + end[0].length);
    };
    const index = read('index'), health = index.match(/^export const PLAYER_HEALTH_PER_LEVEL = .*;$/m)?.[0];
    if (!health) throw new Error('Missing original health parameter');
    const source = [health.replace('export ', ''), functionSource(index, 'enemyCombatLevel'),
      functionSource(read('encounterBalance'), 'tuneEnemyCombatLevel'), functionSource(read('wildernessCreatureSpecies'), 'bodyStats')].join('\n');
    bodyStats = new Function((await transform(`${source}\nreturn bodyStats;`, { loader: 'ts' })).code)() as typeof bodyStats;
  });

  it('matches all 25 original source outputs, including all seven lab bodies before canonical progression', () => {
    const { params } = proposal(), outputs = graph(params);
    for (const input of wilderness(params)) {
      const [module, catalog] = input.kind === 'regionalBossBody' ? ['regionalBossBodies', 'REGIONAL_BOSS_SPECIES']
        : input.kind === 'wildernessDragon' ? ['wildernessDragons', 'WILDERNESS_DRAGONS'] : ['wildernessCreatureSpecies', 'WILDERNESS_CREATURE_SPECIES'];
      const originals = restore(baseline.constants.find(row => row.module === module && row.name === catalog)!.value) as { stats: EnemyDef }[];
      const output = outputs.get(input.id)!;
      const original = originals.find(row => row.stats.id === output.id)!;
      expect(original, input.id).toBeDefined();
      const { drops, ...expected } = original.stats;
      expect(output, input.id).toStrictEqual(expected);
      expect(Object.hasOwn(output, 'respawnSeconds')).toBe(Object.hasOwn(expected, 'respawnSeconds'));
    }
  });

  it('preserves fractional keeper products through the graph until the original tuning boundary', () => {
    const { params } = proposal(); let distinguishesEarlyRounding = false;
    for (const multiplier of [3.005, 3.01, 3.015, 3.025]) {
      const keeper = params.keepers.find(row => row.id === 'ashseal_warden')!; keeper.multiplier = multiplier;
      const body = { id: keeper.id, name: keeper.name, tier: keeper.tier, level: keeper.tier * keeper.multiplier, role: 'keeper' };
      const { drops, ...expected } = bodyStats(body);
      const { drops: _earlyDrops, ...early } = bodyStats({ ...body, level: Math.round(body.level) });
      const actual = graph(params).get(`wildernessBody/${keeper.id}`)!;
      expect(actual, String(multiplier)).toStrictEqual(expected);
      distinguishesEarlyRounding ||= !sameValue(actual, early);
    }
    expect(distinguishesEarlyRounding).toBe(true);
  });
});
