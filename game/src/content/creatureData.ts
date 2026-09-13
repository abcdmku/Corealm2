import rawCreatures from '../../content/data/creatures.json';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import { enemyWithLoot } from './enemyData.js';
import { parseCollection } from './schema/core.js';
import { CreatureRecordSchema, type CreatureRecord, type CreatureCatalog } from './schema/creatures.js';

/** Resolve once so every source array and map shares the same runtime objects. */
export const CREATURE_RECORDS: readonly CreatureRecord[] = parseCollection(CreatureRecordSchema, rawCreatures, { name: 'creatures', idKey: 'id' });
const rpgRows = new Map<CreatureCatalog, RpgBestiaryEntry[]>();
const sources = new Map<string, RpgBestiaryEntry['source']>();
/** Species using the same accepted asset and provenance retain their shared source object. */
function sharedSource(assetId: string, source: RpgBestiaryEntry['source']): RpgBestiaryEntry['source'] {
  const key = JSON.stringify([assetId, source.author, source.license, source.generator]);
  const previous = sources.get(key);
  if (previous) return previous;
  sources.set(key, source);
  return source;
}
export const CREATURE_DATA: readonly (CreatureSpeciesDef | RpgBestiaryEntry)[] = CREATURE_RECORDS.map(record => {
  if (record.presentationKind === 'rpg') {
    const { catalog, stage: _stage, presentationKind: _kind, blockId, lootTableId, ...presentation } = record;
    const species: RpgBestiaryEntry = { ...presentation, source: sharedSource(presentation.assetId, presentation.source), stats: enemyWithLoot(blockId, lootTableId) };
    const rows = rpgRows.get(catalog) ?? [];
    rows.push(species);
    rpgRows.set(catalog, rows);
    return species;
  }
  const { catalog: _catalog, stage: _stage, presentationKind: _kind, blockId, lootTableId, ...presentation } = record;
  return { ...presentation, stats: enemyWithLoot(blockId, lootTableId) };
});
const byId = new Map(CREATURE_DATA.map(species => [species.id, species]));

export function creatureById(id: string): CreatureSpeciesDef | RpgBestiaryEntry {
  const species = byId.get(id);
  if (!species) throw new Error(`Unknown creature ${id}`);
  return species;
}

/** Catalog selection preserves file order, including complete regional RPG variants. */
export function creatureRows(catalog: CreatureCatalog | readonly CreatureCatalog[]): readonly CreatureSpeciesDef[] {
  const selected = new Set<CreatureCatalog>(typeof catalog === 'string' ? [catalog] : catalog);
  return CREATURE_DATA.filter((_species, index) => selected.has(CREATURE_RECORDS[index]!.catalog));
}

export function rpgCreatureRows(catalog: 'RPG_BESTIARY' | 'RPG_BESTIARY_STAGED'): readonly RpgBestiaryEntry[] {
  const rows = rpgRows.get(catalog) ?? [];
  if (rows.length !== CREATURE_RECORDS.filter(row => row.catalog === catalog).length) {
    throw new Error(`RPG catalog ${catalog} contains a basic creature`);
  }
  return rows;
}
