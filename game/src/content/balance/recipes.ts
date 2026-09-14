import type { RecipesBalance } from "../schema/balance.js";

/** Pure balance functions shared by runtime callers and the editor's worked examples. */
export function gatherXp(params: RecipesBalance, tier: number): number {
  return Math.round(params.gatherXp.multiplier * Math.pow(tier, params.gatherXp.exponent));
}

export function recipeXp(params: RecipesBalance, input: { tier: number; craftWeight: number }): number {
  return Math.round(gatherXp(params, input.tier) * input.craftWeight);
}

export function healAmount(params: RecipesBalance, tier: number): number {
  return Math.round(params.healAmount.base + params.healAmount.multiplier * Math.pow(tier, params.healAmount.exponent));
}

export function toolBonus(params: RecipesBalance, tier: number): number {
  return Math.min(params.toolBonus.maximum, Math.round(params.toolBonus.base + params.toolBonus.perTier * tier));
}
