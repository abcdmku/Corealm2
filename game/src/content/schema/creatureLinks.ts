import type { EnemyAlias, EnemyRecord } from './enemies.js';
import type { CreatureRecord } from './creatures.js';
import type { LootTableRecord } from './loot.js';
import type { RefKind, SchemaIssue } from './core.js';

type Tables = ReadonlyMap<string, unknown>;
const names = ['enemies', 'enemyAliases', 'creatures', 'lootTables'] as const;

/** References use the proposed disk snapshot, including lab-only bodies and encounter aliases. */
export function creatureCollectionPools(tables: Tables): Partial<Record<RefKind, ReadonlySet<string>>> {
  if (!names.every(name => tables.has(name))) return {};
  const enemies = tables.get('enemies') as readonly EnemyRecord[];
  const aliases = tables.get('enemyAliases') as readonly EnemyAlias[];
  const creatures = tables.get('creatures') as readonly CreatureRecord[];
  const loot = tables.get('lootTables') as readonly LootTableRecord[];
  return {
    enemy: new Set([...enemies, ...aliases].map(row => row.id)),
    enemyFamily: new Set([...enemies.map(row => row.family), ...aliases.flatMap(row => row.overrides.family === undefined ? [] : [row.overrides.family])]),
    species: new Set(creatures.map(row => row.id)), lootTable: new Set(loot.map(row => row.id)),
  };
}

/** Validate relationships after strict field parsing, without loading a mutable runtime registry. */
export function validateCreatureCollections(tables: Tables): SchemaIssue[] {
  if (!names.some(name => tables.has(name))) return [];
  const issues: SchemaIssue[] = [];
  const issue = (path: string, message: string) => { issues.push({ path, message, severity: 'error' }); };
  for (const name of names) if (!Array.isArray(tables.get(name))) issue(name, 'Creature content requires all four parsed collections');
  if (issues.length) return issues;
  const enemies = tables.get('enemies') as readonly EnemyRecord[];
  const aliases = tables.get('enemyAliases') as readonly EnemyAlias[];
  const creatures = tables.get('creatures') as readonly CreatureRecord[];
  const loot = tables.get('lootTables') as readonly LootTableRecord[];
  const blocks = new Map(enemies.map(row => [row.id, row]));
  const encounters = new Map(aliases.map(row => [row.id, row]));
  const species = new Map(creatures.map(row => [row.id, row]));
  const drops = new Map(loot.map(row => [row.id, row]));
  const usedLoot = new Set<string>();
  const canonical = enemies.filter(row => row.stage === 'registered');
  if (canonical.some((row, index) => index > 0 && row.registrationOrder <= canonical[index - 1]!.registrationOrder)) {
    issue('enemies.registrationOrder', 'Canonical enemy file order must follow registration order');
  }
  const ownedLoot = (id: string, catalog: LootTableRecord['catalog'], owner: string, at: string) => {
    const table = drops.get(id);
    usedLoot.add(id);
    if (!table || table.catalog !== catalog || table.ownerId !== owner) issue(at, `Expected ${catalog} owned by ${owner}`);
  };
  const order = (rows: readonly { id: string; order: number | undefined }[], at: string) => {
    const sorted = rows.map(row => row.order).sort((a, b) => (a ?? -1) - (b ?? -1));
    if (sorted.some((value, index) => value !== index)) issue(at, 'Order must be unique and contiguous from zero');
  };
  order([...enemies.filter(row => row.stage === 'registered').map(row => ({ id: row.id, order: row.registrationOrder })),
    ...aliases.map(row => ({ id: row.id, order: row.registrationOrder }))], 'enemies.registrationOrder');
  order(enemies.filter(row => row.stage === 'labOnly').map(row => ({ id: row.id, order: row.labOrder })), 'enemies.labOrder');
  order(enemies.flatMap(row => row.stage === 'registered' && row.fantasyTierOrder !== undefined ? [{ id: row.id, order: row.fantasyTierOrder }] : []), 'enemies.fantasyTierOrder');
  for (const row of enemies) {
    if (encounters.has(row.id)) issue(`enemies.${row.id}.id`, 'Canonical and alias identities collide');
    ownedLoot(row.lootTableId, 'ENEMY_BLOCK_LOOT', row.id, `enemies.${row.id}.lootTableId`);
  }
  for (const row of aliases) {
    const at = `enemyAliases.${row.id}`;
    const block = blocks.get(row.blockId);
    if (!block || block.stage !== 'registered') issue(`${at}.blockId`, 'Alias base must be a registered canonical enemy');
    if (row.lootTableId !== undefined) ownedLoot(row.lootTableId, 'ENEMY_ALIAS_LOOT', row.id, `${at}.lootTableId`);
    if (row.catalog === 'FANTASY_ENCOUNTER_BLOCKS') {
      if (row.lineage[0] !== row.blockId || row.lineage.some(id => blocks.get(id)?.stage !== 'registered')) issue(`${at}.lineage`, 'Lineage must retain its canonical base and registered targets');
      if (species.get(row.speciesId)?.stage !== 'registered') issue(`${at}.speciesId`, 'Fantasy replacement must reference a registered species');
    }
  }
  for (const row of creatures) {
    const at = `creatures.${row.id}`;
    const block = blocks.get(row.blockId);
    if (!block) issue(`${at}.blockId`, 'Species must reference a canonical enemy');
    else if (block.stage !== row.stage) issue(`${at}.stage`, 'Species and canonical enemy stages must agree');
    if (row.catalog === 'RPG_BESTIARY' || row.catalog === 'RPG_BESTIARY_STAGED') {
      if (row.presentationKind !== 'rpg') issue(`${at}.presentationKind`, 'RPG catalogs require complete RPG presentation');
    }
    const table = drops.get(row.lootTableId);
    if (table?.catalog === 'CREATURE_SOURCE_LOOT') ownedLoot(row.lootTableId, 'CREATURE_SOURCE_LOOT', row.id, `${at}.lootTableId`);
    else ownedLoot(row.lootTableId, 'ENEMY_BLOCK_LOOT', row.blockId, `${at}.lootTableId`);
  }
  for (const row of loot) {
    const at = `lootTables.${row.id}`;
    const owners = row.catalog === 'ENEMY_BLOCK_LOOT' ? blocks : row.catalog === 'CREATURE_SOURCE_LOOT' ? species : encounters;
    if (!owners.has(row.ownerId)) issue(`${at}.ownerId`, 'Loot owner does not exist in its declared catalog');
    if (!usedLoot.has(row.id)) issue(at, 'Loot owner table is orphaned');
  }
  return issues;
}
