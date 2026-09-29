import type { CreatureRepairProfile } from '../repairProfile.js';
import { repairStudioAnimal, studioAnimalIds } from './studio-animals.js';

/** Only confirmed structural defects are staged; good studio bodies stay untouched.
 * PixeliusVita bodies use tools/fairy-terraces/monsters-build.ts, and RPG bestiary, Quaternius and
 * OpenGameArt bodies use tools/rpg-bestiary/native-export.ts instead.
 */
export const profile: CreatureRepairProfile = {
  id: 'studio',
  stateRequirements: {
    animal_hog: { states: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'], reason: 'Retained inactive native source; no authored Run or active combat placement. Remove directional hits while preserving its five genuine states.' },
  },
  assetIds: [...studioAnimalIds],
  repair: (doc, context) => repairStudioAnimal(doc, context),
};
