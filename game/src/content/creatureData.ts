import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import { CREATURE_CATALOG } from './creatureRuntime.js';

export const CREATURE_DATA = CREATURE_CATALOG.species;
export function creatureById(id: string): CreatureSpeciesDef | RpgBestiaryEntry {
  const species = CREATURE_CATALOG.bySpeciesId.get(id);
  if (!species) throw new Error(`Unknown creature ${id}`);
  return species;
}
export function creatureRows(ids: readonly string[]): readonly CreatureSpeciesDef[] {
  return ids.map(creatureById);
}
export function creaturesAvailableIn(availability: 'world' | 'lab', kind: 'basic' | 'rpg' = 'basic'): readonly (CreatureSpeciesDef | RpgBestiaryEntry)[] {
  const found = new Map<string, CreatureSpeciesDef | RpgBestiaryEntry>();
  for (const row of CREATURE_CATALOG.creatures) {
    if (row.availability !== availability || !row.presentation) continue;
    if (('bodyFamily' in row.presentation) !== (kind === 'rpg')) continue;
    if (!found.has(row.presentation.id)) found.set(row.presentation.id, row.presentation);
  }
  return [...found.values()];
}
export function rpgCreatureRows(availability: 'world' | 'lab'): readonly RpgBestiaryEntry[] {
  return creaturesAvailableIn(availability, 'rpg').filter((row): row is RpgBestiaryEntry => 'bodyFamily' in row);
}
