import type { CampfireFuelDef } from "../index.js";
import type { CampfiresBalance, RecipesBalance } from "../schema/balance.js";
import { gatherXp } from "./recipes.js";

export interface CampfireFuelInput {
  logItemId: string;
  tier: number;
  visualLogAssetId: string;
}

/** Derives the locked campfire fields from explicit campfire and recipe balance parameters. */
export function campfireFuel(
  params: CampfiresBalance,
  recipes: RecipesBalance,
  input: CampfireFuelInput,
): CampfireFuelDef {
  const buildXp = Math.round(gatherXp(recipes, input.tier) * params.buildXpGatherMultiplier);
  return {
    logItemId: input.logItemId,
    tier: input.tier,
    buildTimeMs: params.buildTimeMs,
    lifetimeMs: params.lifetimeBaseMs + params.lifetimePerTierMs * input.tier,
    buildXp: { fletching: buildXp, crafting: buildXp },
    visualLogAssetId: input.visualLogAssetId,
  };
}

/** Explicit alias for callers that name the operation by its derivation role. */
export const deriveCampfireFuel = campfireFuel;
