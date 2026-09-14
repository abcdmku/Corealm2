import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';

export const STARTER_CREATURES: readonly CreatureSpeciesDef[] = creatureRows(["grass_viper", "field_wasp", "heath_wasp", "reed_wasp", "creek_crab", "briar_spider", "granary_rat"]);
