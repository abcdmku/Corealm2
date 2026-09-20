import { RESOLVED_CATALOG } from './resolvedCatalog.js';
const tables = RESOLVED_CATALOG.tables;
export const CREATURE_DEFINITIONS = tables.creatureDefinitions;
export const CREATURE_PROFILES = tables.creatureProfiles;
export const CREATURE_CATALOG = {
  creatures: tables.compiledCreatures, enemies: tables.enemies, species: tables.species,
  byCreatureId: new Map(tables.compiledCreatures.map(row => [row.id, row])),
  byEnemyId: new Map(tables.compiledCreatures.map(row => [row.id, row.enemy])),
  bySpeciesId: new Map(tables.species.map(row => [row.id, row])),
};
/** After a live publish: the same object and maps, refilled, so every holder of `CREATURE_CATALOG` reads the new rows. */
export function reindexCreatures(): void {
  Object.assign(CREATURE_CATALOG, { creatures: tables.compiledCreatures, enemies: tables.enemies, species: tables.species });
  const fill = <V>(map: Map<string, V>, rows: readonly (readonly [string, V])[]) => { map.clear(); for (const [id, row] of rows) map.set(id, row); };
  fill(CREATURE_CATALOG.byCreatureId, tables.compiledCreatures.map(row => [row.id, row] as const));
  fill(CREATURE_CATALOG.byEnemyId, tables.compiledCreatures.map(row => [row.id, row.enemy] as const));
  fill(CREATURE_CATALOG.bySpeciesId, tables.species.map(row => [row.id, row] as const));
}
