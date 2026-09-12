import type { RegionId } from "../contracts.js";
import type { EnemyDef } from "./index.js";
import { CREATURE_EXPANSION } from "./creatureExpansion.js";
import { STARTER_CREATURES } from "./starterCreatures.js";
import { CREATURE_REDESIGNS } from "./creatureRedesign.js";
import { FOREST_CREATURE_REDESIGNS } from "./forestCreatureRedesigns.js";
import { ASH_CREATURE_REDESIGNS } from "./ashCreatureRedesigns.js";
import { STONE_CREATURE_REDESIGNS } from "./stoneCreatureRedesigns.js";
import { WILDERNESS_DRAGONS } from "./wildernessDragons.js";
import { WILDERNESS_CREATURE_SPECIES } from "./wildernessCreatureSpecies.js";
import { CROWNWARD_DRAGON_SPECIES } from './crownwardDragons.js';
import { FAIRY_CROWN_SPECIES } from "./fairyCrownCreatures.js";

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

import { REGIONAL_CREATURE_VARIANTS } from "./regionalCreatureVariants.js";

export const CREATURE_SPECIES: readonly CreatureSpeciesDef[] = [...CREATURE_EXPANSION, ...STARTER_CREATURES, ...REGIONAL_CREATURE_VARIANTS, ...CREATURE_REDESIGNS,
  ...FOREST_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS,
  ...WILDERNESS_DRAGONS, ...WILDERNESS_CREATURE_SPECIES, ...FAIRY_CROWN_SPECIES, ...CROWNWARD_DRAGON_SPECIES];
