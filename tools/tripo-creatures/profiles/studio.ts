import type { CreatureRepairProfile } from '../repairProfile.js';
import { repairStudioAnimal, studioAnimalIds } from './studio-animals.js';
import { repairStudioFairy, studioFairyIds } from './studio-fairy.js';
import { repairStudioMantis, studioMantisIds } from './studio-mantis.js';

/** Only confirmed structural defects are staged; good studio bodies stay untouched. */
export const profile: CreatureRepairProfile = {
  id: 'studio',
  stateRequirements: {
    animal_hog: { states: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'], reason: 'Retained inactive native source; no authored Run or active combat placement. Remove directional hits while preserving its five genuine states.' },
  },
  assetIds: [...new Set([...studioAnimalIds, ...studioFairyIds, ...studioMantisIds])],
  // RPG bestiary, Quaternius and OpenGameArt bodies use tools/rpg-bestiary/native-export.ts instead.
  repair: (doc, context) => studioMantisIds.includes(context.assetId) ? repairStudioMantis(doc, context)
    : (studioAnimalIds as readonly string[]).includes(context.assetId) ? repairStudioAnimal(doc, context)
      : repairStudioFairy(doc, context),
};
