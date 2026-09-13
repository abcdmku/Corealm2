import type { RecipesBalance } from "../schema/balance.js";
import type { RecipeDerivation } from "../schema/recipeDerivation.js";

/** Pure balance functions shared by runtime callers and the editor's worked examples. */
export function gatherXp(params: RecipesBalance, tier: number): number {
  return Math.round(params.gatherXp.multiplier * Math.pow(tier, params.gatherXp.exponent));
}

export function recipeXp(params: RecipesBalance, input: { tier: number; craftWeight: number }): number {
  return Math.round(gatherXp(params, input.tier) * input.craftWeight);
}

export function recipeCraftWeight(params: RecipesBalance, derivation: RecipeDerivation): number {
  return "weightKey" in derivation ? params.weights[derivation.weightKey].weight : derivation.craftWeight;
}

export function recipeXpFromDerivation(params: RecipesBalance, row: { tier: number }, derivation: RecipeDerivation): number {
  return recipeXp(params, { tier: row.tier, craftWeight: recipeCraftWeight(params, derivation) });
}

/** Only the base recipe builder reads W.ms; other catalogs author their durations separately. */
export function recipeFieldsFromDerivation(params: RecipesBalance, row: { tier: number; catalog: string }, derivation: RecipeDerivation): { xp: number; durationMs?: number } {
  return { xp: recipeXpFromDerivation(params, row, derivation), ...(row.catalog === "RECIPES" && "weightKey" in derivation ? { durationMs: params.weights[derivation.weightKey].ms } : {}) };
}

export function healAmount(params: RecipesBalance, tier: number): number {
  return Math.round(params.healAmount.base + params.healAmount.multiplier * Math.pow(tier, params.healAmount.exponent));
}

export function toolBonus(params: RecipesBalance, tier: number): number {
  return Math.min(params.toolBonus.maximum, Math.round(params.toolBonus.base + params.toolBonus.perTier * tier));
}
