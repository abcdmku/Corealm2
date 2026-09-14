import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { creatureRows } from './creatureData.js';

export const WILDERNESS_DRAGONS: readonly CreatureSpeciesDef[] = creatureRows(["baby_red_dragon", "baby_black_dragon", "baby_lava_dragon", "red_wilderness_dragon", "black_wilderness_dragon", "purple_wilderness_dragon", "amethyst_dragon"]);
export const WILDERNESS_DRAGON_CANDIDATES = WILDERNESS_DRAGONS;
