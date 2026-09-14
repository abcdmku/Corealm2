import type { RegionId } from '../contracts.js';
import type { EnemyDef } from './index.js';
import { creaturesAvailableIn } from './creatureData.js';

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

export const CREATURE_SPECIES: readonly CreatureSpeciesDef[] = creaturesAvailableIn('world');
