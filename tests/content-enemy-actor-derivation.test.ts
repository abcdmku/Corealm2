import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { deriveEnemySourceGraph } from '../game/src/content/balance/enemySourceGraph.js';
import { deriveActorEnemy } from '../game/src/content/balance/enemyActorSources.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { deriveRecord, derivationDiffs, sameValue } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import type { ActorEnemySourceInput } from '../game/src/content/schema/enemyActorSources.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { ENEMY_BALANCE } from '../game/src/content/enemyBalanceData.js';
import { FAIRY_CREATURE_SPECIES } from '../game/src/content/fairyCreatures.js';
import { FAIRY_GARDEN_SPECIES } from '../game/src/content/fairyGardenCreatures.js';
import { UNIVERSAL_MINIBOSS_SPECIES, UNIVERSAL_MINIBOSS_ENEMIES } from '../game/src/content/universalMinibosses.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

function proposal() {
  const rows = parseCollection(EnemyRecordSchema, structuredClone(rawEnemies), { name: 'enemies' }) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  return { rows, params, tables: new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]) };
}
function actors(params: ReturnType<typeof proposal>['params']) {
  return params.sourceInputs.filter((input): input is ActorEnemySourceInput => ['universal', 'fairy', 'garden'].includes(input.kind));
}
function enemyId(input: ActorEnemySourceInput): string { return input.kind === 'universal' ? `guardian_${input.number}_t${input.tier}` : input.speciesId; }
function rowFor(rows: Record<string, unknown>[], id: string) {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing actor test enemy ${id}`); return row;
}
function runtimeViews() {
  return { enemies: ENEMY_DATA, labs: LAB_ONLY_ENEMY_DATA, params: ENEMY_BALANCE,
    fairy: FAIRY_CREATURE_SPECIES, garden: FAIRY_GARDEN_SPECIES,
    universalSpecies: UNIVERSAL_MINIBOSS_SPECIES, universalEnemies: UNIVERSAL_MINIBOSS_ENEMIES };
}

describe('actor source derivation integration', () => {
  it('recomputes 99 actor owners through the shared graph and keeps all 280 shipped tags free of drift', () => {
    const { rows, params, tables } = proposal(); const actorInputs = actors(params);
    expect(actorInputs).toHaveLength(99);
    expect(actorInputs.filter(input => input.kind === 'universal')).toHaveLength(63);
    expect(actorInputs.filter(input => input.kind === 'fairy')).toHaveLength(12);
    expect(actorInputs.filter(input => input.kind === 'garden')).toHaveLength(24);
    expect(rows.filter(row => row.derivation)).toHaveLength(280);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]); expect(derivationDiffs(tables)).toEqual([]);
    const graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
    expect(graph.size).toBe(218);
    for (const input of actorInputs) {
      const row = rowFor(rows, enemyId(input));
      expect(row.derivation).toEqual({ kind: 'sourceEnemy.v1', inputId: input.id });
      expect(row.catalog).toBe('CREATURE_SPECIES_BLOCKS'); expect(row.stage).toBe('registered');
      const output = graph.get(input.id)!;
      expect(output, input.id).toEqual(deriveActorEnemy(params.actorSourceParameters, input, params));
      expect(output, input.id).toEqual(Object.fromEntries(Object.keys(output).map(key => [key, row[key]])));
    }
  });

  it('previews all 63 universal target edits without automatically changing saved enemies or helper source views', () => {
    const { rows, params, tables } = proposal(); const before = structuredClone(runtimeViews()), savedRows = structuredClone(rows);
    params.actorSourceParameters.universal.targetLevelMultiplier = 3;
    const savedParams = structuredClone(params), diffs = derivationDiffs(tables);
    const universal = actors(params).filter(input => input.kind === 'universal');
    expect(diffs).toHaveLength(63); expect(diffs.map(diff => diff.recordId).sort()).toEqual(universal.map(enemyId).sort());
    const graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
    for (const input of universal) {
      expect(combatLevel(params.combatLevel, graph.get(input.id)!)).toBe(input.tier * 3);
      const diff = diffs.find(diff => diff.recordId === enemyId(input))!;
      expect(diff.inputIds).toEqual([input.id]); expect(diff.after.marks).toEqual(diff.before.marks);
      expect(diff.after.respawnSeconds).toBe(diff.before.respawnSeconds);
      expect(diff.after.attackStyle).toBe(diff.before.attackStyle);
    }
    expect(rows).toEqual(savedRows); expect(params).toEqual(savedParams); expect(runtimeViews()).toEqual(before);
  });

  it.each([['fairy', 12], ['garden', 24]] as const)('previews only %s marks for its %i authored actors', (kind, count) => {
    const { rows, params, tables } = proposal(); const before = structuredClone(runtimeViews()), savedRows = structuredClone(rows);
    params.actorSourceParameters[kind].marksPerTier = [4, 8];
    const diffs = derivationDiffs(tables), expected = actors(params).filter(input => input.kind === kind);
    expect(diffs).toHaveLength(count); expect(diffs.map(diff => diff.recordId).sort()).toEqual(expected.map(enemyId).sort());
    for (const input of expected) {
      const diff = diffs.find(diff => diff.recordId === enemyId(input))!;
      expect(Object.keys(diff.after).filter(key => !sameValue(diff.after[key], diff.before[key]))).toEqual(['marks']);
      expect(diff.after.marks).toEqual([input.tier * 4, input.tier * 8]);
    }
    expect(rows).toEqual(savedRows); expect(runtimeViews()).toEqual(before);
  });

  it('applies shared Stage 1 tuning edits to actors and both boss catalogs while retaining target levels', () => {
    const { params, tables } = proposal(); const before = structuredClone(runtimeViews());
    params.tuning.maximumBonus = 0;
    const diffs = derivationDiffs(tables), actorInputs = actors(params);
    const bodies = params.sourceInputs.filter(input => input.kind === 'regionalBossBody');
    const descendants = params.sourceInputs.filter(input => input.kind === 'fairyCrown' || input.kind === 'crownwardDragon');
    expect(bodies).toHaveLength(7); expect(descendants).toHaveLength(15); expect(diffs).toHaveLength(128);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual([...actorInputs.map(enemyId), ...params.legacyBossInputs.map(input => input.enemyId),
      ...bodies.map(input => `${input.speciesId}_t${params.regionalBossLevels[input.bossId].tier}`),
      ...descendants.map(input => `${input.speciesId}_t${input.kind === 'fairyCrown' ? input.tier : params.descendantSourceParameters.crownwardDragon.tier}`)].sort());
    const graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
    for (const input of actorInputs) {
      const output = graph.get(input.id)!;
      expect([output.accuracy, output.armour, output.magicArmour]).toEqual([0, 0, 0]);
      const target = input.kind === 'universal' ? Math.max(params.actorSourceParameters.universal.minimumTargetLevel,
        Math.round(input.tier * params.actorSourceParameters.universal.targetLevelMultiplier)) : input.tier + input.levelOffset;
      expect(combatLevel(params.combatLevel, output)).toBe(target);
    }
    for (const input of bodies) {
      const output = graph.get(input.id)!, target = params.regionalBossLevels[input.bossId];
      expect([output.accuracy, output.armour, output.magicArmour]).toEqual([0, 0, 0]);
      expect(combatLevel(params.combatLevel, output)).toBe(Math.round(target.tier * target.multiplier));
    }
    for (const input of descendants) expect(combatLevel(params.combatLevel, graph.get(input.id)!)).toBe(input.targetLevel);
    expect(runtimeViews()).toEqual(before);
  });

  it('requires explicit actor tuning dependencies while leaving the core graph independently usable', () => {
    const { params } = proposal();
    for (const kind of ['universal', 'fairy', 'garden'] as const) {
      const input = actors(params).find(input => input.kind === kind)!;
      expect(() => deriveEnemySourceGraph(params.sourceParameters, [input])).toThrow(`Missing actor tuning dependencies for ${input.id}`);
    }
    const core = params.sourceInputs.filter(input => ['expansion', 'starter', 'rpg', 'variant', 'redesign'].includes(input.kind));
    expect(deriveEnemySourceGraph(params.sourceParameters, core).size).toBe(79);
  });

  it.each(['universal', 'fairy', 'garden'] as const)('rejects a missing %s source or mismatched actor catalog', kind => {
    const { rows, params, tables } = proposal(); const input = actors(params).find(input => input.kind === kind)!;
    const row = rowFor(rows, enemyId(input)); row.catalog = 'RPG_BESTIARY_BLOCKS';
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: `enemies.${row.id}.derivation`, severity: 'error' }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Source formula catalog disagrees');
    row.catalog = 'CREATURE_SPECIES_BLOCKS'; params.sourceInputs = params.sourceInputs.filter(source => source.id !== input.id);
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: `enemies.${row.id}.derivation.inputId`, severity: 'error' }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Missing original source input');
  });

  it('removes unexpected optional fairy fields through explicit undefined preview fields', () => {
    const { rows, params, tables } = proposal(); const input = actors(params).find(input => input.kind === 'fairy')!;
    const row = rowFor(rows, enemyId(input)); row.attackStyle = 'magic'; row.attackRangeM = 9; row.respawnSeconds = 100;
    const diffs = derivationDiffs(tables); expect(diffs).toHaveLength(1);
    for (const key of ['attackStyle', 'attackRangeM', 'respawnSeconds']) {
      expect(Object.hasOwn(diffs[0]!.after, key)).toBe(true); expect(diffs[0]!.after[key]).toBeUndefined();
    }
    expect(row.attackStyle).toBe('magic');
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('original actor record evidence', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });
  it('matches all 99 integrated actor outputs against the independent original records', () => {
    const { params } = proposal(), graph = deriveEnemySourceGraph(params.sourceParameters, params.sourceInputs, params);
    for (const input of actors(params)) {
      const original = baseline.records.enemies.find(row => row.id === enemyId(input))!;
      expect(original, input.id).toBeDefined();
      const output = graph.get(input.id)!;
      expect(output, input.id).toEqual(Object.fromEntries(Object.keys(output).map(key => [key, original[key as keyof typeof original]])));
      if (input.kind !== 'universal') for (const key of ['attackStyle', 'attackRangeM', 'respawnSeconds']) expect(Object.hasOwn(output, key)).toBe(false);
    }
  });
});
