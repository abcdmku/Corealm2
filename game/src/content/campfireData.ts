import { RESOLVED_TABLES } from './resolvedCatalog.js';
const rawCampfireFuels = RESOLVED_TABLES["campfireFuels"];
import type { ItemId } from "../contracts.js";
import type { CampfireFuelDef } from "./index.js";
import { parseCollection } from "./schema/core.js";
import { CampfireFuelRecordSchema, type CampfireFuelRecord } from "./schema/campfireFuels.js";

/** Fuel records come from the accepted catalog revision. */
export const CAMPFIRE_FUEL_RECORDS: readonly CampfireFuelRecord[] = parseCollection(
  CampfireFuelRecordSchema,
  rawCampfireFuels,
  { name: "campfireFuels", idKey: "logItemId" },
);

/** Runtime fuel rows share their objects with the gathering tier campfire fields. */
export const CAMPFIRE_FUELS: readonly CampfireFuelDef[] = CAMPFIRE_FUEL_RECORDS;

const CAMPFIRE_FUEL_BY_LOG = new Map(CAMPFIRE_FUELS.map((fuel) => [fuel.logItemId, fuel] as const));

/** Missing gathering references fail at import time instead of falling back to a different log. */
export function campfireFuelByLog(logItemId: ItemId): CampfireFuelDef {
  const fuel = CAMPFIRE_FUEL_BY_LOG.get(logItemId);
  if (!fuel) throw new Error(`Unknown campfire fuel log item "${logItemId}".`);
  return fuel;
}
