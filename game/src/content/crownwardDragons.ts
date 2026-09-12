import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import { tierSilhouetteScale } from '../core/math.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';
import { WILDERNESS_DRAGONS } from './wildernessDragons.js';

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

/** Species registration makes these available to the lab without placing world encounters. */
export const CROWNWARD_DRAGON_SPECIES: readonly CreatureSpeciesDef[] = CROWNWARD_DRAGON_FORMS.map(form => {
  const source = WILDERNESS_DRAGONS.find(species => species.id === form.sourceSpeciesId);
  if (!source) throw new Error(`Missing accepted source dragon ${form.sourceSpeciesId}`);
  const boss = form.rank === 'boss';
  return {
    id: form.id, assetId: source.assetId, regionId: 'crownward', activity: source.activity,
    scale: form.nativeScale / tierSilhouetteScale(40), description: form.description,
    stats: tuneEnemyCombatLevel({
      ...source.stats, id: `${form.id}_t40`, family: form.id, name: form.name, tier: 40,
      behaviour: 'territorial', aggroRadius: boss ? 11 : 7,
      // Preserve the existing cadence and locomotion speeds of each accepted rig.
      marks: boss ? [600, 1000] : [220, 380],
      drops: [
        { itemId: 'drake_scale', quantity: boss ? [4, 7] : [1, 3], chance: 1 },
        { itemId: 'fire_essence', quantity: boss ? [10, 18] : [4, 8], chance: 1 },
        { itemId: 'death_rune', quantity: boss ? [4, 7] : [1, 3], chance: boss ? .75 : .35 },
      ],
    }, form.level, 40),
  };
});

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
