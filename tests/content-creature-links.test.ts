import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_COLLECTIONS, parseContentCollection } from '../tools/content/collections.js';
import { contentPath } from '../tools/content/format.js';
import { collectionReferenceIssues } from '../tools/content/references.js';
import { creatureCollectionPools, validateCreatureCollections } from '../game/src/content/schema/creatureLinks.js';
import { CreatureRecordSchema } from '../game/src/content/schema/creatures.js';

function fixture() {
  const names = ['enemies', 'enemyAliases', 'creatures', 'lootTables'];
  const tables = new Map(CONTENT_COLLECTIONS.filter(spec => names.includes(spec.name)).map(spec =>
    [spec.name, parseContentCollection(spec, JSON.parse(readFileSync(contentPath(spec.file), 'utf8')))]));
  const rows = (name: string) => tables.get(name) as Record<string, any>[];
  return { tables, rows };
}

describe('normalized creature relationships', () => {
  it('accepts all authored joins and builds references including lab and alias identities', () => {
    const { tables, rows } = fixture();
    expect(validateCreatureCollections(tables)).toEqual([]);
    const pools = creatureCollectionPools(tables);
    expect(pools.enemy?.size).toBe(483);
    expect(pools.species?.size).toBe(246);
    expect(pools.lootTable?.size).toBe(362);
    expect(pools.enemy?.has(rows('enemyAliases')[0]!.id)).toBe(true);
  });
  it('rejects alias chains and lost order while allowing tuning without rekeying', () => {
    const { tables, rows } = fixture();
    rows('enemies')[0]!.family = 'retuned_family';
    rows('enemies')[0]!.tier = 40;
    expect(validateCreatureCollections(tables)).toEqual([]);
    rows('enemyAliases')[0]!.blockId = rows('enemyAliases')[1]!.id;
    rows('enemyAliases')[0]!.registrationOrder = rows('enemyAliases')[1]!.registrationOrder;
    const issues = validateCreatureCollections(tables);
    expect(issues.some(issue => issue.path.endsWith('.blockId'))).toBe(true);
    expect(issues.some(issue => issue.path === 'enemies.registrationOrder')).toBe(true);
  });
  it('rejects a species stealing a different source table and detects orphaned loot', () => {
    const { tables, rows } = fixture();
    const alternatives = rows('lootTables').filter(row => row.catalog === 'CREATURE_SOURCE_LOOT');
    const owner = rows('creatures').find(row => row.id === alternatives[0]!.ownerId)!;
    owner.lootTableId = alternatives[1]!.id;
    const issues = validateCreatureCollections(tables);
    expect(issues.some(issue => issue.path === `creatures.${owner.id}.lootTableId`)).toBe(true);
    expect(issues.some(issue => issue.message.includes('orphaned'))).toBe(true);
  });
  it('rejects stage mismatches and incomplete RPG presentation', () => {
    const { tables, rows } = fixture();
    const rpg = rows('creatures').find(row => row.catalog === 'RPG_BESTIARY')!;
    rpg.stage = 'labOnly';
    rpg.presentationKind = 'basic';
    const issues = validateCreatureCollections(tables);
    expect(issues.some(issue => issue.path === `creatures.${rpg.id}.stage`)).toBe(true);
    expect(issues.some(issue => issue.path === `creatures.${rpg.id}.presentationKind`)).toBe(true);
  });
  it('reports unpromoted lab assets as warnings and registered asset gaps as errors', () => {
    const { rows } = fixture();
    const staged = rows('creatures').find(row => row.catalog === 'RPG_BESTIARY_STAGED')!;
    const live = rows('creatures').find(row => row.stage === 'registered')!;
    const pools = { asset: new Set<string>() };
    expect(collectionReferenceIssues('creatures', CreatureRecordSchema, staged, pools, 'creatures.staged'))
      .toEqual([expect.objectContaining({ path: 'creatures.staged.assetId', severity: 'warning' })]);
    expect(collectionReferenceIssues('creatures', CreatureRecordSchema, live, pools, 'creatures.live'))
      .toEqual([expect.objectContaining({ path: 'creatures.live.assetId', severity: 'error' })]);
  });
});
