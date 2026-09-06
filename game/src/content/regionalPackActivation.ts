import type { RegionId } from "../contracts.js";
import { REGIONAL_PACKS, type RegionalPackRegionId } from "./regionalPacks.js";
import type { RpgPackAssignmentOverrides } from "./rpgRegionalPacks.js";

/**
 * Root acceptance decision for the final-world regional pack population.
 *
 * The staged catalogue in `regionalPacks.ts` / `rpgRegionalPacks.ts` is data, not a decision. A pack
 * reaches the authored world only when its region is listed here, its species has passed the compact
 * lab lifecycle and its model is promoted to the public manifest. Regions are integrated one at a
 * time; a URL parameter never activates the population. Keep `excludedPackIds` for packs whose
 * occupant is still unaccepted inside an otherwise activated region, and `assignmentOverrides` for
 * root-approved species replacements on stable pack IDs.
 */
export interface RegionalPackActivation {
  readonly regions: readonly RegionalPackRegionId[];
  readonly excludedPackIds: readonly string[];
  readonly assignmentOverrides: RpgPackAssignmentOverrides;
}

export const REGIONAL_PACK_ACTIVATION: RegionalPackActivation = {
  regions: [],
  excludedPackIds: [],
  assignmentOverrides: {},
};

/** Stable pack IDs that the final world constructs at boot and on every save rebuild. */
export function activatedRegionalPackIds(activation: RegionalPackActivation = REGIONAL_PACK_ACTIVATION): string[] {
  const known = new Set(REGIONAL_PACKS.map((pack) => pack.id));
  for (const id of activation.excludedPackIds) if (!known.has(id)) throw new Error(`Unknown excluded regional pack: ${id}`);
  for (const id of Object.keys(activation.assignmentOverrides)) if (!known.has(id)) throw new Error(`Unknown regional pack override: ${id}`);
  const regions = new Set<RegionId>(activation.regions);
  const excluded = new Set(activation.excludedPackIds);
  return REGIONAL_PACKS.filter((pack) => regions.has(pack.regionId) && !excluded.has(pack.id)).map((pack) => pack.id);
}
