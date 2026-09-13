import { describe, expect, it } from 'vitest';
import rawEnemies from '../game/content/data/enemies.json';
import rawParameters from '../game/content/data/balance/enemies.json';
import { ENEMY_DATA, LAB_ONLY_ENEMY_DATA } from '../game/src/content/enemyData.js';
import { CREATURE_EXPANSION } from '../game/src/content/creatureExpansion.js';
import { STARTER_CREATURES } from '../game/src/content/starterCreatures.js';
import { RPG_BESTIARY, RPG_BESTIARY_STAGED } from '../game/src/content/rpgBestiary.js';
import { deriveRecord, derivationDiffs } from '../game/src/content/balance/derivations.js';
import { EnemyBalanceSchema } from '../game/src/content/schema/enemyBalance.js';
import { EnemyRecordSchema } from '../game/src/content/schema/enemies.js';
import { EnemyDerivationSchema } from '../game/src/content/schema/enemyDerivation.js';
import { validateEnemyFormulaLinks } from '../game/src/content/schema/enemyFormulaLinks.js';
import { parseCollection, parseValue } from '../game/src/content/schema/core.js';

function proposal() {
  const rows = parseCollection(EnemyRecordSchema, structuredClone(rawEnemies), { name: 'enemies' }) as Record<string, unknown>[];
  const params = parseValue(EnemyBalanceSchema, structuredClone(rawParameters), 'balance/enemies');
  return { rows, params, tables: new Map<string, unknown>([['enemies', rows], ['balance/enemies', params]]) };
}
function rowFor(rows: Record<string, unknown>[], id: string): Record<string, unknown> {
  const row = rows.find(row => row.id === id); if (!row) throw new Error(`Missing test enemy ${id}`); return row;
}
function runtimeViews() {
  return { enemies: ENEMY_DATA, labEnemies: LAB_ONLY_ENEMY_DATA, expansion: CREATURE_EXPANSION,
    starter: STARTER_CREATURES, rpg: RPG_BESTIARY, stagedRpg: RPG_BESTIARY_STAGED };
}

describe('core enemy source derivation previews', () => {
  it('recomputes all 79 source tags, 35 legacy tags, and 45 fantasy tags without drift', () => {
    const { rows, params, tables } = proposal();
    const tags = rows.filter(row => row.derivation).map(row => ({ row,
      tag: parseValue(EnemyDerivationSchema, row.derivation, `enemies.${row.id}.derivation`) }));
    const sourceRows = tags.filter(({ tag }) => tag.kind === 'sourceEnemy.v1');
    expect(tags).toHaveLength(159); expect(sourceRows).toHaveLength(79);
    expect(tags.filter(({ tag }) => tag.kind === 'fantasyScale.v1')).toHaveLength(45);
    expect(tags.filter(({ tag }) => tag.kind === 'legacyMarks.v1')).toHaveLength(28);
    expect(tags.filter(({ tag }) => tag.kind === 'legacyBossCombat.v1')).toHaveLength(7);
    expect(sourceRows.filter(({ row }) => row.stage === 'labOnly')).toHaveLength(4);
    expect(params.sourceInputs).toHaveLength(79);
    expect(validateEnemyFormulaLinks(tables)).toEqual([]);
    expect(derivationDiffs(tables)).toEqual([]);
    for (const { row } of sourceRows) {
      const result = deriveRecord('enemies', row, tables)!;
      expect(result, String(row.id)).toEqual(Object.fromEntries(Object.keys(result).map(key => [key, row[key]])));
      expect(result).not.toHaveProperty('lootTableId'); expect(result).not.toHaveProperty('catalog');
      expect(result).not.toHaveProperty('stage'); expect(result).not.toHaveProperty('drops');
    }
  });

  it('previews exactly seven starter attack edits without mutating stored enemies or any source view', () => {
    const { rows, params, tables } = proposal();
    const runtimeBefore = structuredClone(runtimeViews()), recordsBefore = structuredClone(rows);
    params.sourceParameters.starter.attackLevel += 3;
    const paramsBefore = structuredClone(params), diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(7);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(params.sourceInputs.filter(input => input.kind === 'starter')
      .map(input => `${input.speciesId}_t${params.sourceParameters.starter.tier}`).sort());
    for (const diff of diffs) {
      expect(diff.kind).toBe('sourceEnemy.v1');
      expect(diff.after.attackLevel).toBe((diff.before.attackLevel as number) + 3);
      expect(Object.keys(diff.after).filter(key => !Object.is(diff.after[key], diff.before[key]) && key !== 'marks')).toEqual(['attackLevel']);
      expect(diff.after.marks).toEqual(diff.before.marks);
    }
    expect(rows).toEqual(recordsBefore); expect(params).toEqual(paramsBefore);
    expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('changes only brute RPG health across active and lab records', () => {
    const { rows, params, tables } = proposal();
    const runtimeBefore = structuredClone(runtimeViews()), recordsBefore = structuredClone(rows);
    const affected = params.sourceInputs.filter(input => input.kind === 'rpg').filter(input => input.role === 'brute');
    const expectedIds = affected.map(input => `${input.speciesId}_t${input.tier}`).sort();
    expect(expectedIds).toContain('troll_mauler_t12'); expect(expectedIds).toContain('zombie_t1');
    params.sourceParameters.rpg.roles.brute.healthMultiplier += .5;
    const paramsBefore = structuredClone(params), diffs = derivationDiffs(tables);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(expectedIds);
    expect(diffs.some(diff => rowFor(rows, diff.recordId).stage === 'registered')).toBe(true);
    expect(diffs.some(diff => rowFor(rows, diff.recordId).stage === 'labOnly')).toBe(true);
    for (const diff of diffs) {
      expect(diff.kind).toBe('sourceEnemy.v1'); expect(diff.after.maxHealth).toBeGreaterThan(diff.before.maxHealth as number);
      const { maxHealth: _beforeHealth, ...otherBefore } = diff.before;
      const { maxHealth: _afterHealth, ...otherAfter } = diff.after;
      expect(otherAfter).toEqual(otherBefore);
    }
    expect(rows).toEqual(recordsBefore); expect(params).toEqual(paramsBefore);
    expect(runtimeViews()).toEqual(runtimeBefore);
  });

  it('detects unexpected optional starter fields and returns explicit undefined removals', () => {
    const { rows, tables } = proposal(); const row = rowFor(rows, 'grass_viper_t1');
    expect(Object.hasOwn(row, 'attackStyle')).toBe(false);
    row.attackStyle = 'magic'; row.attackRangeM = 8; row.respawnSeconds = 100;
    const before = structuredClone(row), diffs = derivationDiffs(tables);
    expect(diffs).toHaveLength(1); expect(diffs[0]!.recordId).toBe('grass_viper_t1');
    for (const key of ['attackStyle', 'attackRangeM', 'respawnSeconds']) {
      expect(Object.hasOwn(diffs[0]!.after, key)).toBe(true);
      expect(diffs[0]!.before[key]).toEqual(row[key]); expect(diffs[0]!.after[key]).toBeUndefined();
    }
    expect(row).toEqual(before);
  });

  it('honors authored optional-field absence when an expansion source explicitly removes a field', () => {
    const { rows, params, tables } = proposal();
    const input = params.sourceInputs.find(input => input.id === 'expansion/redbrush_fox')!;
    if (input.kind !== 'expansion') throw new Error('Expected expansion test input');
    const row = rowFor(rows, input.identity.enemyId); expect(row.walkSpeedMps).toBe(.5);
    delete input.authored.walkSpeedMps;
    const diffs = derivationDiffs(tables);
    expect(diffs.map(diff => diff.recordId).sort()).toEqual(['gloam_fox_t1', 'redbrush_fox_t1']);
    for (const diff of diffs) {
      expect(diff.before.walkSpeedMps).toBe(.5);
      expect(Object.hasOwn(diff.after, 'walkSpeedMps')).toBe(true); expect(diff.after.walkSpeedMps).toBeUndefined();
    }
    expect(row.walkSpeedMps).toBe(.5);
  });

  it('keeps stored source stats when the formula tag is removed', () => {
    const { rows, params, tables } = proposal(); const row = rowFor(rows, 'grass_viper_t1');
    const { derivation: _tag, ...stored } = structuredClone(row);
    params.sourceParameters.starter.attackLevel += 1; delete row.derivation;
    expect(deriveRecord('enemies', row, tables)).toBeUndefined(); expect(row).toEqual(stored);
    expect(derivationDiffs(tables)).toHaveLength(6); expect(validateEnemyFormulaLinks(tables)).toEqual([]);
  });
});

describe('source formula references resolve against the proposed snapshot', () => {
  it.each(['removed input', 'unknown input'] as const)('rejects %s without consulting stored runtime inputs', mode => {
    const { rows, params, tables } = proposal(); const row = rowFor(rows, 'grass_viper_t1');
    if (mode === 'removed input') params.sourceInputs = params.sourceInputs.filter(input => input.id !== 'starter/grass_viper');
    else row.derivation = { kind: 'sourceEnemy.v1', inputId: 'starter/missing' };
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({
      path: 'enemies.grass_viper_t1.derivation.inputId', severity: 'error', message: 'Source input is missing or belongs to another enemy',
    }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Missing original source input');
  });

  it.each([
    ['grass_viper_t1', 'starter/field_wasp'], ['grass_viper_t1', 'rpg/giant_rat'],
    ['giant_rat_t3', 'rpg/troll_mauler'],
  ])('rejects %s pointed at another source %s', (enemyId, inputId) => {
    const { rows, tables } = proposal(); const row = rowFor(rows, enemyId);
    row.derivation = { kind: 'sourceEnemy.v1', inputId };
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: `enemies.${enemyId}.derivation.inputId`, severity: 'error' }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow(/belongs to|catalog disagrees/);
  });

  it('detects a changed proposed source identity even while the tag inputId stays the same', () => {
    const { rows, params, tables } = proposal();
    const input = params.sourceInputs.find(input => input.id === 'starter/grass_viper')!;
    if (input.kind !== 'starter') throw new Error('Expected starter test input');
    input.speciesId = 'changed_viper';
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({ path: 'enemies.grass_viper_t1.derivation.inputId', severity: 'error' }));
    expect(() => deriveRecord('enemies', rowFor(rows, 'grass_viper_t1'), tables)).toThrow('changed_viper_t1');
  });

  it.each([
    ['grass_viper_t1', 'RPG_BESTIARY_BLOCKS'], ['redbrush_fox_t1', 'LEGACY_BLOCKS'], ['giant_rat_t3', 'REGIONAL_BOSS_BLOCKS'],
  ])('rejects source catalog mismatch for %s', (enemyId, catalog) => {
    const { rows, tables } = proposal(); const row = rowFor(rows, enemyId); row.catalog = catalog;
    expect(validateEnemyFormulaLinks(tables)).toContainEqual(expect.objectContaining({
      path: `enemies.${enemyId}.derivation`, severity: 'error', message: 'Source formula catalog disagrees with its original generator',
    }));
    expect(() => deriveRecord('enemies', row, tables)).toThrow('Source formula catalog disagrees');
  });
});
