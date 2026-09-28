import { RESOLVED_TABLES } from './resolvedCatalog.js';
import type { ItemId } from "../contracts.js";
import type { CampfireFuelDef } from "./index.js";
import { parseCollection } from "./schema/core.js";
import { CampfireFuelRecordSchema, type CampfireFuelRecord } from "./schema/campfireFuels.js";

/** Fuel records come from the accepted catalog revision. */
const fuelRows = (): CampfireFuelRecord[] => parseCollection(CampfireFuelRecordSchema, RESOLVED_TABLES["campfireFuels"], { name: "campfireFuels", idKey: "logItemId" });
const fuels = fuelRows();
export const CAMPFIRE_FUEL_RECORDS: readonly CampfireFuelRecord[] = fuels;

/** Runtime fuel rows share their objects with the gathering tier campfire fields. */
export const CAMPFIRE_FUELS: readonly CampfireFuelDef[] = CAMPFIRE_FUEL_RECORDS;

const CAMPFIRE_FUEL_BY_LOG = new Map(CAMPFIRE_FUELS.map((fuel) => [fuel.logItemId, fuel] as const));

/** After the catalog moved: the same array and map, refilled. Run `reindexGatheringTiers` after it. */
export function reindexCampfireFuels(): void {
  fuels.splice(0, fuels.length, ...fuelRows());
  CAMPFIRE_FUEL_BY_LOG.clear();
  for (const fuel of fuels) CAMPFIRE_FUEL_BY_LOG.set(fuel.logItemId, fuel);
}

/** Missing gathering references fail at import time instead of falling back to a different log. */
export function campfireFuelByLog(logItemId: ItemId): CampfireFuelDef {
  const fuel = CAMPFIRE_FUEL_BY_LOG.get(logItemId);
  if (!fuel) throw new Error(`Unknown campfire fuel log item "${logItemId}".`);
  return fuel;
}
