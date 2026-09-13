import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as enemies from '../game/src/content/enemies.js';
import * as biome from '../game/src/content/biomePopulation.js';
import { ENEMY_RECORDS, ENEMY_ALIAS_RECORDS, ENEMY_DATA, ENEMY_BLOCK_DATA, LAB_ONLY_ENEMY_DATA,
  FANTASY_TIER_DATA, enemyBlockById, registeredEnemyById, enemyBlockRows, enemyWithLoot, buildEnemyViews } from '../game/src/content/enemyData.js';
import { lootDrops } from '../game/src/content/lootData.js';
import { parseCollection } from '../game/src/content/schema/core.js';
import { EnemyRecordSchema, EnemyAliasSchema } from '../game/src/content/schema/enemies.js';
import { buildM4Baseline, type M4Baseline } from '../tools/content/m4-baseline.js';
import { buildEnemyRecords, restoreSnapshot } from '../tools/content/export-enemies.js';
import { repoRoot } from '../tools/lib/paths.js';

describe('enemy JSON runtime views', () => {
  it('rejects reordered canonical files before public views can disagree', () => {
    const rows = [...ENEMY_RECORDS];
    [rows[0], rows[1]] = [rows[1]!, rows[0]!];
    expect(() => buildEnemyViews(rows, ENEMY_ALIAS_RECORDS, lootDrops)).toThrow('Canonical enemy file order');
  });
  it('separates production and lab rows and reuses canonical objects across ordered public views', () => {
    expect(ENEMY_RECORDS).toHaveLength(338);
    expect(ENEMY_ALIAS_RECORDS).toHaveLength(145);
    expect(ENEMY_DATA).toHaveLength(472);
    expect(ENEMY_BLOCK_DATA).toHaveLength(327);
    expect(LAB_ONLY_ENEMY_DATA).toHaveLength(11);
    expect(FANTASY_TIER_DATA).toHaveLength(60);
    expect(enemies.ENEMIES).toBe(ENEMY_DATA);
    expect(enemies.ENEMY_BLOCKS).toBe(ENEMY_BLOCK_DATA);
    expect(enemies.FANTASY_TIER_BLOCKS).toBe(FANTASY_TIER_DATA);
    for (const row of ENEMY_BLOCK_DATA) expect(registeredEnemyById(row.id)).toBe(row);
    for (const row of LAB_ONLY_ENEMY_DATA) {
      expect(registeredEnemyById(row.id)).toBeUndefined();
      expect(enemyBlockById(row.id)).toBe(row);
    }
    for (const row of FANTASY_TIER_DATA) expect(enemyBlockById(row.id)).toBe(row);
    expect(enemyBlockRows('FANTASY_TIER_BLOCKS')).toHaveLength(45);
    expect(enemyBlockRows(['RPG_BESTIARY_STAGED_BLOCKS', 'REGIONAL_BOSS_BLOCKS'])).toEqual(LAB_ONLY_ENEMY_DATA);
    expect(() => enemyBlockById(enemies.FANTASY_ENCOUNTER_BLOCKS[0]!.id)).toThrow('Unknown canonical');
    expect(() => enemyBlockById('__missing')).toThrow('Unknown canonical');
    for (const row of ENEMY_DATA) {
      for (const metadata of ['catalog', 'stage', 'registrationOrder', 'labOrder', 'fantasyTierOrder', 'lootTableId', 'blockId', 'overrides', 'lineage', 'speciesId']) expect(Object.hasOwn(row, metadata)).toBe(false);
      expect(Object.values(row).includes(undefined)).toBe(false);
    }
  });

  it('caches alternate source loot while preserving shared canonical drop arrays', () => {
    const record = ENEMY_RECORDS.find(row => row.id === 'cinderback_crag_t50')!;
    expect(record).toBeDefined();
    expect(enemyWithLoot(record.id, record.lootTableId)).toBe(enemyBlockById(record.id));
    expect(enemyBlockById(record.id).drops).toBe(lootDrops(record.lootTableId));
    const source = enemyWithLoot(record.id, 'loot_species_cinderback_crag');
    expect(source).toBe(enemyWithLoot(record.id, 'loot_species_cinderback_crag'));
    expect(source).not.toBe(enemyBlockById(record.id));
    expect(source.drops).toBe(lootDrops('loot_species_cinderback_crag'));
    expect(source.drops).toEqual([]);
    expect(enemyBlockById(record.id).drops.length).toBeGreaterThan(0);
  });

  it('projects edited canonical fields and loot without rekeying immutable identities', () => {
    const records = ENEMY_RECORDS.map(row => structuredClone(row));
    const firstAlias = ENEMY_ALIAS_RECORDS.find(row => row.catalog === 'GROUP_ALIASES')!;
    const base = records.find(row => row.id === firstAlias.blockId)!;
    const originalId = base.id;
    base.family = 'edited_family'; base.tier += 1; base.maxHealth += 7;
    const editedDrops = [{ itemId: 'raw_game_meat', quantity: [2, 3] as [number, number], chance: 0.75 }];
    const views = buildEnemyViews(parseCollection(EnemyRecordSchema, records, { name: 'editedEnemies' }), ENEMY_ALIAS_RECORDS,
      id => id === base.lootTableId ? editedDrops : lootDrops(id));
    const canonical = views.enemyBlockById(originalId);
    expect(canonical.id).toBe(originalId);
    expect(canonical.family).toBe('edited_family');
    expect(canonical.maxHealth).toBe(base.maxHealth);
    expect(canonical.drops).toBe(editedDrops);
    expect(views.registeredEnemyById(firstAlias.id)!.family).toBe('edited_family');
    expect(views.registeredEnemyById(firstAlias.id)!.drops).toBe(editedDrops);
    expect(enemyBlockById(originalId).family).not.toBe('edited_family');
  });

  it('rejects invalid order, alias chains, lab bases and missing loot before exporting views', () => {
    const records = ENEMY_RECORDS.map(row => structuredClone(row));
    const first = records.find(row => row.stage === 'registered')!;
    if (first.stage !== 'registered') throw new Error('Expected registered fixture');
    first.registrationOrder = 9999;
    expect(() => buildEnemyViews(records, ENEMY_ALIAS_RECORDS, lootDrops)).toThrow(/contiguous|Canonical enemy file order/);
    const aliases = ENEMY_ALIAS_RECORDS.map(row => structuredClone(row));
    aliases[0]!.blockId = aliases[1]!.id;
    expect(() => buildEnemyViews(ENEMY_RECORDS, aliases, lootDrops)).toThrow('Unknown canonical alias base');
    aliases[0]!.blockId = LAB_ONLY_ENEMY_DATA[0]!.id;
    expect(() => buildEnemyViews(ENEMY_RECORDS, aliases, lootDrops)).toThrow('lab-only');
    expect(() => buildEnemyViews(ENEMY_RECORDS, ENEMY_ALIAS_RECORDS, () => { throw new Error('Missing loot fixture'); })).toThrow('Missing loot');
    expect(() => parseCollection(EnemyAliasSchema, [{ ...ENEMY_ALIAS_RECORDS[0], overrides: { drops: [] } }], { name: 'invalidAlias' })).toThrow();
  });
});

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('enemy original-source parity', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });

  it('matches every original enemy and biome constant and writes exactly the validated records', () => {
    for (const snapshot of baseline.constants.filter(row => row.module === 'enemies' || row.module === 'biomePopulation')) {
      const current: Record<string, unknown> = snapshot.module === 'enemies' ? enemies : biome;
      expect(current[snapshot.name], `${snapshot.module}.${snapshot.name}`).toStrictEqual(restoreSnapshot(snapshot.value));
    }
    const exported = buildEnemyRecords(baseline);
    expect(exported.enemies).toStrictEqual(ENEMY_RECORDS);
    expect(exported.aliases).toStrictEqual(ENEMY_ALIAS_RECORDS);
    const originalNames = [...baseline.constants, ...baseline.functions].filter(row => row.module === 'enemies').map(row => row.name).sort();
    expect(Object.keys(enemies).sort()).toEqual(originalNames);
  });

  it('replays every captured enemy helper probe and the original biome projection', () => {
    for (const evidence of baseline.functions.filter(row => row.module === 'enemies' || row.module === 'biomePopulation')) {
      const current: Record<string, unknown> = evidence.module === 'enemies' ? enemies : biome;
      const fn = current[evidence.name];
      if (typeof fn !== 'function') throw new Error(`Missing ${evidence.name}`);
      for (const probe of evidence.probes) {
        const args = restoreSnapshot(probe.args);
        if (!Array.isArray(args)) throw new Error('Invalid probe arguments');
        expect(probe.result.kind).toBe('return');
        if (probe.result.kind === 'return') expect(fn(...args), `${evidence.name}: ${probe.label}`).toStrictEqual(restoreSnapshot(probe.result.value));
      }
    }
  });
});
