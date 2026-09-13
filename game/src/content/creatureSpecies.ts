import type { RegionId } from '../contracts.js';
import type { EnemyDef } from './index.js';
import { creatureRows } from './creatureData.js';

/** Production species can be tested before an encounter is placed in the authored world. */
export interface CreatureSpeciesDef {
  readonly id: string;
  readonly assetId: string;
  readonly scale: number;
  readonly regionId: RegionId;
  readonly stats: EnemyDef;
  readonly activity: "graze" | "forage" | "prowl" | "patrol";
  readonly description: string;
}

export const CREATURE_SPECIES: readonly CreatureSpeciesDef[] = creatureRows([
  'CREATURE_EXPANSION',
  'STARTER_CREATURES',
  'RED_WORM_SPECIES',
  'REGIONAL_CREATURE_VARIANTS',
  'CREATURE_REDESIGNS',
  'FOREST_CREATURE_REDESIGNS',
  'ASH_CREATURE_REDESIGNS',
  'STONE_CREATURE_REDESIGNS',
  'WILDERNESS_DRAGONS',
  'WILDERNESS_CREATURE_SPECIES',
  'FAIRY_CROWN_SPECIES',
  'CROWNWARD_DRAGON_SPECIES',
  'FAIRY_CREATURE_SPECIES',
  'FAIRY_GARDEN_SPECIES',
  'UNIVERSAL_MINIBOSS_SPECIES',
]);
