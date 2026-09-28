import type { CreatureRepairProfile } from '../repairProfile.js';
import { repairStudioHumanoid, studioHumanoidIds } from './studioHumanoids.js';
import { repairStudioAnimal, studioAnimalIds } from './studio-animals.js';
import { repairStudioFairy, studioFairyIds } from './studio-fairy.js';
import { repairStudioTroll, studioTrollIds } from './studio-troll.js';

/** Only confirmed structural defects are staged; good studio bodies stay untouched. */
export const profile: CreatureRepairProfile = {
  id: 'studio',
  stateRequirements: {
    animal_hog: { states: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'], reason: 'Retained inactive native source; no authored Run or active combat placement. Remove directional hits while preserving its five genuine states.' },
  },
  assetIds: [...new Set([...studioHumanoidIds, ...studioAnimalIds, ...studioFairyIds, ...studioTrollIds])],
  repair: (doc, context) => (studioTrollIds as readonly string[]).includes(context.assetId)
    ? repairStudioTroll(doc, context) : (studioAnimalIds as readonly string[]).includes(context.assetId)
      ? repairStudioAnimal(doc, context) : studioFairyIds.includes(context.assetId)
        ? repairStudioFairy(doc, context) : repairStudioHumanoid(doc, context),
};
