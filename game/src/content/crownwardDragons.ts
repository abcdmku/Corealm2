import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';
import type { EnemyGroupDef, Spot } from './regions.js';

/** Reuse the accepted dragon bodies, skins, clips and asset-keyed motion records unchanged. */
export const CROWNWARD_DRAGON_FORMS = [
  { id: 'crownward_red_hatchling', sourceSpeciesId: 'baby_red_dragon', name: 'Red Dragon Whelp',
    rank: 'miniboss', level: 65, nativeScale: 1.1,
    description: 'A young red dragon nesting beyond the royal patrols. Its short wings spread as it braces for a snapping strike.' },
  { id: 'crownward_black_hatchling', sourceSpeciesId: 'baby_black_dragon', name: 'Black Dragon Whelp',
    rank: 'miniboss', level: 68, nativeScale: 1.1,
    description: 'A young black dragon with a hooked muzzle and broad small wings. It guards its patch of old kingdom pasture.' },
  { id: 'crownward_red_dragon', sourceSpeciesId: 'red_wilderness_dragon', name: 'Red Dragon of Crownward',
    rank: 'boss', level: 110, nativeScale: 1.05,
    description: 'An adult red dragon that has claimed a hunting ground in the old kingdom. Its tall neck, wing claws and long blade tail rise above the young dragons.' },
] as const;

export type CrownwardDragonSpeciesId = typeof CROWNWARD_DRAGON_FORMS[number]['id'];

export const CROWNWARD_DRAGON_SPECIES: readonly CreatureSpeciesDef[] = creatureRows(["crownward_red_hatchling", "crownward_black_hatchling", "crownward_red_dragon"]);

/** Locations are supplied only after the river, bridges and dry encounter clearings are accepted. */
export const CROWNWARD_DRAGON_ENCOUNTER_INTENTS = [
  { id: 'crownward_red_whelp_south', speciesId: 'crownward_red_hatchling' },
  { id: 'crownward_red_whelp_north', speciesId: 'crownward_red_hatchling' },
  { id: 'crownward_black_whelp_south', speciesId: 'crownward_black_hatchling' },
  { id: 'crownward_black_whelp_north', speciesId: 'crownward_black_hatchling' },
  { id: 'crownward_red_dragon_roost', speciesId: 'crownward_red_dragon' },
] as const;

export type CrownwardDragonEncounterId = typeof CROWNWARD_DRAGON_ENCOUNTER_INTENTS[number]['id'];
export type CrownwardDragonPositions = Readonly<Record<CrownwardDragonEncounterId, Spot>>;

/** Use this same group definition for isolated lab proof and the later authored encounter. */
export function crownwardDragonGroup(speciesId: CrownwardDragonSpeciesId, id: string, centre: Spot): EnemyGroupDef {
  const form = CROWNWARD_DRAGON_FORMS.find(entry => entry.id === speciesId);
  const species = CROWNWARD_DRAGON_SPECIES.find(entry => entry.id === speciesId);
  if (!form || !species) throw new Error(`Unknown Crownward dragon ${speciesId}`);
  const boss = form.rank === 'boss';
  return { id, family: species.stats.family, name: species.stats.name, tier: 40,
    assetId: species.assetId, scale: species.scale / (boss ? 1.6 : 1.3),
    centre, count: 1, radius: 0, ...(boss ? { boss: true } : { miniBoss: true }) };
}

export function resolveCrownwardDragonEncounters(positions: CrownwardDragonPositions): EnemyGroupDef[] {
  return CROWNWARD_DRAGON_ENCOUNTER_INTENTS.map(intent => {
    const centre = positions[intent.id];
    if (!centre || !centre.every(Number.isFinite)) throw new Error(`Missing finite dragon position ${intent.id}`);
    return crownwardDragonGroup(intent.speciesId, intent.id, centre);
  });
}
