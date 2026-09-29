import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';

export const REGIONAL_CREATURE_VARIANTS: readonly CreatureSpeciesDef[] = creatureRows(["gloam_fox", "rimeback_tortoise", "cindercrest_salamander", "amethyst_spider"]);
