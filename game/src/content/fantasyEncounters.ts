import type { EnemyGroupDef, Spot } from './regions.js';
import type { RegionId } from '../contracts.js';
import { CREATURE_SPECIES } from './creatureSpecies.js';
import { BIOME_POPULATION_LEGACY_REPLACEMENTS } from './biomePopulation.js';
import { REGIONAL_BOSS_BODIES } from './regionalBossBodies.js';
import { tierSilhouetteScale } from '../core/math.js';


/** Farm animals and small wildlife are confined to Millfield, Marchfield and the first riverbanks. */
export const STARTER_WILDLIFE_BOUNDS = {min:[-278,-190],max:[-25,60]} as const;
export function inStarterWildlifeArea(regionId:RegionId, centre:Spot, radius=0):boolean {
  return regionId==='fallowmarch' && centre.every((v,i)=>v-radius>=STARTER_WILDLIFE_BOUNDS.min[i]! && v+radius<=STARTER_WILDLIFE_BOUNDS.max[i]!);
}

/** Stable encounter IDs preserve residents, tier, count, saves and original rewards. */
export const FANTASY_ENCOUNTER_SPECIES = BIOME_POPULATION_LEGACY_REPLACEMENTS;

/** Boss identities, phases and guaranteed progression drops survive their body revision. */
export const FANTASY_BOSS_BODIES = REGIONAL_BOSS_BODIES;

export function fantasyEncounter(group:EnemyGroupDef):EnemyGroupDef {
  const id=FANTASY_ENCOUNTER_SPECIES[group.id];
  if(id){
    const species=CREATURE_SPECIES.find(row=>row.id===id);
    if(!species)throw new Error('Missing accepted fantasy occupant '+id+' for '+group.id);
    return {...group,family:species.stats.family,name:species.stats.name,assetId:species.assetId,scale:species.scale};
  }
  const body=FANTASY_BOSS_BODIES[group.id as keyof typeof FANTASY_BOSS_BODIES];
  if(!body)return group;
  return {...group,assetId:body.assetId,
    scale:body.scale / tierSilhouetteScale(group.tier) / (group.boss ? 1.6 : group.miniBoss ? 1.3 : 1)};
}

/** The coastal generator must never carry a cow or a rat from its starter pen to a remote shore. */
export function isStarterAnimalAsset(assetId:string):boolean {
  return assetId.startsWith('animal_') || /^creature_(redbrush_fox|marchwild_horse|reedbank_goose|marchfield_turkey|field_wasp|heath_wasp|reed_wasp)$/.test(assetId);
}
