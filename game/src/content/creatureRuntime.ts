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
