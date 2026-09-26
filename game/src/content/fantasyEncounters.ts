import type { Spot } from './regions.js';
import type { RegionId } from '../contracts.js';


/** Farm animals and small wildlife are confined to Millfield, Marchfield and the first riverbanks. */
export const STARTER_WILDLIFE_BOUNDS = {min:[-278,-190],max:[-25,60]} as const;
export function inStarterWildlifeArea(regionId:RegionId, centre:Spot, radius=0):boolean {
  return regionId==='fallowmarch' && centre.every((v,i)=>v-radius>=STARTER_WILDLIFE_BOUNDS.min[i]! && v+radius<=STARTER_WILDLIFE_BOUNDS.max[i]!);
}

/** Species restricted to starter wildlife habitats. */
export function isStarterAnimalAsset(assetId:string):boolean {
  return assetId.startsWith('animal_') || /^creature_(redbrush_fox|marchwild_horse|reedbank_goose|marchfield_turkey|field_wasp|heath_wasp|reed_wasp)$/.test(assetId);
}
