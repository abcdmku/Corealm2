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
  // Fallowmarch only. Slice 07 ran 29 representative packs through the production combat fixture
  // against the public manifest and the current navmesh; all four of the region's species and both
  // wildlife behaviours passed idle, patrol, aggro, pursuit, contact damage, death, loot, XP,
  // respawn and post-combat return. The other three regions stay dark until their held packs
  // clear: a returning resident can still be trapped by its own burial-shrine dressing, which is
  // the main thing holding Vellenwood.
  regions: ["fallowmarch"],
  excludedPackIds: [
    // Failed its lifecycle. Its sibling pack_fallowmarch_palewood_east_brush proves the same
    // zombie-in-a-burial-shrine combination, so the region does not lose that coverage.
    "pack_fallowmarch_northgate_west_scrub",
    // Never exercised. The Wild Horse packs had no representative run, so they are not activated
    // on the strength of other packs passing.
    "pack_fallowmarch_northern_horse_outer_grass",
    "pack_fallowmarch_south_march_horse_grass",
  ],
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
