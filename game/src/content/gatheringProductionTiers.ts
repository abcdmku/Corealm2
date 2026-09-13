import gatheringTierData from "../../content/data/gatheringTiers.json";
import type { GatheringProductionTierDef } from "./index.js";
import { campfireFuelByLog } from "./campfireData.js";
import { resourceById } from "./resourceData.js";
import { parseCollection } from "./schema/core.js";
import { GatheringTierSchema, type GatheringTierRecord } from "./schema/gatheringTiers.js";

/**
 * Canonical gathering and production unlocks for the current regions.
 *
 * The tier rows live in `game/content/data/gatheringTiers.json`. Resource definitions are owned by
 * the resource collection and are linked by id here, so every tier and the global resource table
 * share the same parsed ResourceDef objects.
 */

function hydrateTier(record: GatheringTierRecord): GatheringProductionTierDef {
  const resourceDefs = record.resourceDefIds.map((resourceId) => resourceById(resourceId));
  const campfire = campfireFuelByLog(record.campfireFuelId);
  const { resourceDefIds: _resourceDefIds, campfireFuelId: _campfireFuelId, ...definition } = record;
  return { ...definition, resourceDefs, campfire };
}

const tierRecords = parseCollection(GatheringTierSchema, gatheringTierData, {
  name: "gatheringTiers", idKey: "tier",
});

export const GATHERING_PRODUCTION_TIERS: readonly GatheringProductionTierDef[] =
  tierRecords.map(hydrateTier);

export { CAMPFIRE_FUELS } from "./campfireData.js";

export function gatheringProductionTier(tier: number): GatheringProductionTierDef | undefined {
  return GATHERING_PRODUCTION_TIERS.find((definition) => definition.tier === tier);
}
