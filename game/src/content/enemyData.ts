import rawEnemies from '../../content/data/enemies.json';
import rawAliases from '../../content/data/enemyAliases.json';
import type { EnemyDef } from './index.js';
import { parseCollection } from './schema/core.js';
import { EnemyRecordSchema, EnemyAliasSchema, type EnemyRecord, type EnemyAlias, type EnemyCatalog } from './schema/enemies.js';
import { lootDrops } from './lootData.js';

export const ENEMY_RECORDS: readonly EnemyRecord[] = parseCollection(EnemyRecordSchema, rawEnemies, { name: 'enemies' });
export const ENEMY_ALIAS_RECORDS: readonly EnemyAlias[] = parseCollection(EnemyAliasSchema, rawAliases, { name: 'enemyAliases' });

function requireRow<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/** Order is content identity; duplicates and gaps must fail before any runtime views are exported. */
function ordered<T>(rows: readonly T[], ordinal: (row: T) => number, label: string): T[] {
  const result = [...rows].sort((a, b) => ordinal(a) - ordinal(b));
  result.forEach((row, index) => {
    if (ordinal(row) !== index) throw new Error(`${label}: expected unique contiguous order ${index}, got ${ordinal(row)}`);
  });
  return result;
}

/** Pure projection for focused data-edit checks; callers pass parsed records and a loot resolver. */
export function buildEnemyViews(
  records: readonly EnemyRecord[], aliases: readonly EnemyAlias[], dropsById: (id: string) => EnemyDef['drops'],
) {
  const blockMap = new Map<string, EnemyDef>();
  const recordMap = new Map<string, EnemyRecord>();
  for (const record of records) {
    if (recordMap.has(record.id)) throw new Error(`Duplicate canonical enemy ${record.id}`);
    recordMap.set(record.id, record);
    let row: EnemyDef;
    if (record.stage === 'registered') {
      const { catalog: _catalog, stage: _stage, lootTableId, registrationOrder: _registration, fantasyTierOrder: _fantasy, derivation: _derivation, ...stats } = record;
      row = { ...stats, drops: dropsById(lootTableId) };
    } else {
      const { catalog: _catalog, stage: _stage, lootTableId, labOrder: _lab, ...stats } = record;
      row = { ...stats, drops: dropsById(lootTableId) };
    }
    blockMap.set(record.id, row);
  }
  const registeredRecords = records.filter(row => row.stage === 'registered');
  if (registeredRecords.some((row, index) => index > 0 && row.registrationOrder <= registeredRecords[index - 1]!.registrationOrder)) {
    throw new Error('Canonical enemy file order must follow registration order');
  }
  const labRecords = records.filter(row => row.stage === 'labOnly');
  const aliasMap = new Map<string, EnemyDef>();
  for (const alias of aliases) {
    if (blockMap.has(alias.id) || aliasMap.has(alias.id)) throw new Error(`Duplicate enemy alias ${alias.id}`);
    const baseRecord = requireRow(recordMap.get(alias.blockId), `Unknown canonical alias base ${alias.blockId}`);
    if (baseRecord.stage !== 'registered') throw new Error(`Alias ${alias.id} targets lab-only block ${alias.blockId}`);
    const base = blockMap.get(alias.blockId)!;
    aliasMap.set(alias.id, { ...base, ...alias.overrides, id: alias.id,
      drops: alias.lootTableId === undefined ? base.drops : dropsById(alias.lootTableId) });
  }
  const orderedRegistered = ordered([...registeredRecords, ...aliases], row => row.registrationOrder, 'Enemy registration');
  const enemyData = orderedRegistered.map(row => requireRow(blockMap.get(row.id) ?? aliasMap.get(row.id), `Missing resolved enemy ${row.id}`));
  const registeredMap = new Map(enemyData.map(row => [row.id, row]));
  const enemyBlockData = registeredRecords.map(row => blockMap.get(row.id)!);
  const labOnlyEnemyData = ordered(labRecords, row => row.labOrder, 'Lab enemy').map(row => blockMap.get(row.id)!);
  const fantasyRecords = registeredRecords.filter(row => row.fantasyTierOrder !== undefined);
  const fantasyTierData = ordered(fantasyRecords, row => row.fantasyTierOrder!, 'Fantasy tier').map(row => blockMap.get(row.id)!);
  const fantasyAliases = aliases.filter(row => row.catalog === 'FANTASY_ENCOUNTER_BLOCKS');
  const fantasyEncounterData = fantasyAliases.map(row => aliasMap.get(row.id)!);
  const encounterLineage: Readonly<Record<string, readonly [string, string]>> = Object.fromEntries(fantasyAliases.map(row => [row.id, row.lineage]));
  const biomeReplacementSpecies: Readonly<Record<string, string>> = Object.fromEntries(fantasyAliases.map(row => [row.id, row.speciesId]));
  const alternateLootCache = new Map<string, Map<string, EnemyDef>>();
  const enemyBlockById = (id: string): EnemyDef => requireRow(blockMap.get(id), `Unknown canonical enemy ${id}`);
  return {
    enemyData, enemyBlockData, labOnlyEnemyData, fantasyTierData, fantasyEncounterData, encounterLineage, biomeReplacementSpecies,
    enemyBlockById,
    registeredEnemyById: (id: string): EnemyDef | undefined => registeredMap.get(id),
    enemyBlockRows: (catalog: EnemyCatalog | readonly EnemyCatalog[]): readonly EnemyDef[] => {
      const selected = new Set<EnemyCatalog>(typeof catalog === 'string' ? [catalog] : catalog);
      return records.filter(row => selected.has(row.catalog)).map(row => blockMap.get(row.id)!);
    },
    enemyWithLoot: (blockId: string, lootTableId: string): EnemyDef => {
      const base = enemyBlockById(blockId);
      if (recordMap.get(blockId)!.lootTableId === lootTableId) return base;
      let alternatives = alternateLootCache.get(blockId);
      if (!alternatives) { alternatives = new Map(); alternateLootCache.set(blockId, alternatives); }
      let alternate = alternatives.get(lootTableId);
      if (!alternate) { alternate = { ...base, drops: dropsById(lootTableId) }; alternatives.set(lootTableId, alternate); }
      return alternate;
    },
  };
}

const views = buildEnemyViews(ENEMY_RECORDS, ENEMY_ALIAS_RECORDS, lootDrops);
export const ENEMY_BLOCK_DATA: readonly EnemyDef[] = views.enemyBlockData;
export const LAB_ONLY_ENEMY_DATA: readonly EnemyDef[] = views.labOnlyEnemyData;
export const ENEMY_DATA: readonly EnemyDef[] = views.enemyData;
export const FANTASY_TIER_DATA: readonly EnemyDef[] = views.fantasyTierData;
export const FANTASY_ENCOUNTER_DATA: readonly EnemyDef[] = views.fantasyEncounterData;
export const ENCOUNTER_LINEAGE = views.encounterLineage;
export const BIOME_REPLACEMENT_SPECIES = views.biomeReplacementSpecies;
export const enemyBlockById = views.enemyBlockById;
export const registeredEnemyById = views.registeredEnemyById;
export const enemyBlockRows = views.enemyBlockRows;
export const enemyWithLoot = views.enemyWithLoot;
