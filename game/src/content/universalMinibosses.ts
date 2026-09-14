import { creatureRows, creatureById } from './creatureData.js';
import type { RegionId } from '../contracts.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { FAIRY_MINIBOSS_FORMS } from './fairyMinibossForms.js';

export const UNIVERSAL_MINIBOSS_RESPAWN_SECONDS = 1800;
export const UNIVERSAL_MINIBOSSES_PER_REGION = 2;

/** Each source body can appear in every region. Strength and rewards follow the region. */
export const UNIVERSAL_MINIBOSS_ROSTER = [
  { number: '01', name: 'Bramblehorn', style: 'melee', unique: 'Brambleheart Ring' },
  { number: '02', name: 'Gloamwarden', style: 'magic', unique: 'Gloamwarden Pendant' },
  { number: '03', name: 'Thorn Sovereign', style: 'melee', unique: 'Thorn Sovereign Ring' },
  { number: '04', name: 'Hollow Crown', style: 'magic', unique: 'Hollow Crown Pendant' },
  { number: '05', name: 'Stonevein', style: 'melee', unique: 'Stonevein Ring' },
  { number: '06', name: 'Nightbloom', style: 'magic', unique: 'Nightbloom Pendant' },
  { number: '07', name: 'Dreadroot', style: 'melee', unique: 'Dreadroot Ring' },
  { number: '08', name: 'Veilkeeper', style: 'magic', unique: 'Veilkeeper Pendant' },
  { number: '09', name: 'Elder Thorne', style: 'melee', unique: 'Elder Thorne Ring' },
] as const;
export type UniversalMinibossNumber = typeof UNIVERSAL_MINIBOSS_ROSTER[number]['number'];

/** Older aliases retain these same source bodies and are reserved as well. */
export const RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS = new Set<string>([
  ...UNIVERSAL_MINIBOSS_ROSTER.map(row => `fantasy_monster_${row.number}`),
  ...FAIRY_MINIBOSS_FORMS.map(row => row.assetId),
  'miniboss_cinderwake', 'miniboss_galeskin', 'miniboss_mossbound', 'miniboss_tideworn',
  'creature_cinder_ravager', 'creature_basalt_maw',
  'creature_gorge_mantis', 'creature_hollow_star', 'creature_amethyst_sovereign',
]);

export function isReservedUniversalMinibossAsset(assetId: string): boolean {
  return RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS.has(assetId);
}

export function universalMinibossSpecies(number: UniversalMinibossNumber, regionId: RegionId, tierOverride?: 70): CreatureSpeciesDef {
  return creatureById(`guardian_${number}_${regionId}${tierOverride ? `_t${tierOverride}` : ''}`);
}

export const UNIVERSAL_MINIBOSS_SPECIES: readonly CreatureSpeciesDef[] = creatureRows(["guardian_01_fallowmarch", "guardian_01_vellenwood", "guardian_01_karrowmoor", "guardian_01_gravelmaw", "guardian_02_fallowmarch", "guardian_02_vellenwood", "guardian_02_karrowmoor", "guardian_02_gravelmaw", "guardian_03_fallowmarch", "guardian_03_vellenwood", "guardian_03_karrowmoor", "guardian_03_gravelmaw", "guardian_04_fallowmarch", "guardian_04_vellenwood", "guardian_04_karrowmoor", "guardian_04_gravelmaw", "guardian_05_fallowmarch", "guardian_05_vellenwood", "guardian_05_karrowmoor", "guardian_05_gravelmaw", "guardian_06_fallowmarch", "guardian_06_vellenwood", "guardian_06_karrowmoor", "guardian_06_gravelmaw", "guardian_07_fallowmarch", "guardian_07_vellenwood", "guardian_07_karrowmoor", "guardian_07_gravelmaw", "guardian_08_fallowmarch", "guardian_08_vellenwood", "guardian_08_karrowmoor", "guardian_08_gravelmaw", "guardian_09_fallowmarch", "guardian_09_vellenwood", "guardian_09_karrowmoor", "guardian_09_gravelmaw", "guardian_01_kilnhalt", "guardian_02_kilnhalt", "guardian_03_kilnhalt", "guardian_04_kilnhalt", "guardian_05_kilnhalt", "guardian_06_kilnhalt", "guardian_07_kilnhalt", "guardian_08_kilnhalt", "guardian_09_kilnhalt", "guardian_01_wilderness", "guardian_01_wilderness_t70", "guardian_02_wilderness", "guardian_02_wilderness_t70", "guardian_03_wilderness", "guardian_03_wilderness_t70", "guardian_04_wilderness", "guardian_04_wilderness_t70", "guardian_05_wilderness", "guardian_05_wilderness_t70", "guardian_06_wilderness", "guardian_06_wilderness_t70", "guardian_07_wilderness", "guardian_07_wilderness_t70", "guardian_08_wilderness", "guardian_08_wilderness_t70", "guardian_09_wilderness", "guardian_09_wilderness_t70", "guardian_01_crownward", "guardian_02_crownward", "guardian_03_crownward", "guardian_04_crownward", "guardian_05_crownward", "guardian_06_crownward", "guardian_07_crownward", "guardian_08_crownward", "guardian_09_crownward", "guardian_01_gloamgarden", "guardian_02_gloamgarden", "guardian_03_gloamgarden", "guardian_04_gloamgarden", "guardian_05_gloamgarden", "guardian_06_gloamgarden", "guardian_07_gloamgarden", "guardian_08_gloamgarden", "guardian_09_gloamgarden", "guardian_01_faeholme", "guardian_02_faeholme", "guardian_03_faeholme", "guardian_04_faeholme", "guardian_05_faeholme", "guardian_06_faeholme", "guardian_07_faeholme", "guardian_08_faeholme", "guardian_09_faeholme"]);

/** Cave and Karrowmoor share T10 stats; registration contains each canonical ID once. */
export const UNIVERSAL_MINIBOSS_ENEMIES: readonly EnemyDef[] = [...new Map(
  UNIVERSAL_MINIBOSS_SPECIES.map(species => [species.stats.id, species.stats]),
).values()];
