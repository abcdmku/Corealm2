import type { GatheringProductionTierDef } from './index.js';
import { COMPILED_PROGRESSION } from './compiler/runtime.js';
import { campfireFuelByLog } from './campfireData.js';
import { resourceById } from './resourceData.js';
/** Campfire gameplay needs only progression rows with fuel and gathering unlocks. */
export const GATHERING_PRODUCTION_TIERS: readonly GatheringProductionTierDef[] = COMPILED_PROGRESSION.progression
  .filter(row => row.campfireFuelId && row.magic && row.smelting)
  .map(row => {
    const resourceDefs = row.resourceIds.map(resourceById);
    const items = Object.fromEntries(Object.entries(row.materials).map(([role, materialId]) =>
      [role, COMPILED_PROGRESSION.materials.find(material => material.id === materialId)!.itemId]));
    return { tier: row.tier, reqLevel: row.reqLevel, metalName: row.presentation.metalName ?? row.name,
      woodName: row.presentation.woodName ?? row.name, resourceDefs,
      resources: { mining: resourceDefs.filter(resource => resource.skill === 'mining').map(resource => resource.id),
        fishing: resourceDefs.find(resource => resource.skill === 'fishing')?.id ?? '',
        woodcutting: resourceDefs.find(resource => resource.skill === 'woodcutting')?.id ?? '' },
      items: items as GatheringProductionTierDef['items'], magic: row.magic as GatheringProductionTierDef['magic'],
      smelting: row.smelting!, campfire: campfireFuelByLog(row.campfireFuelId!) };
  });
export { CAMPFIRE_FUELS } from './campfireData.js';
export function gatheringProductionTier(tier: number): GatheringProductionTierDef | undefined {
  return GATHERING_PRODUCTION_TIERS.find(row => row.tier === tier);
}
