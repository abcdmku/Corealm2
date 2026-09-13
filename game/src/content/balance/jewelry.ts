import type { EquipmentBonuses, ItemDef } from "../../contracts.js";
import type { RecipeDef } from "../index.js";
import type { JewelryBalance, RecipesBalance } from "../schema/balance.js";
import type { JewelryDerivation, JewelryRecipeDerivation } from "../schema/jewelryDerivation.js";
import { recipeXp } from "./recipes.js";

export interface DerivedJewelry {
  tier: number;
  value: number;
  equip: NonNullable<ItemDef["equip"]>;
}

/**
 * Original jewelry.ts and universalMinibossLoot.ts arithmetic. Crafted bonuses use the
 * tier divisor and health multiplier; guardian profiles grant the same bonus to each stat.
 * Neither generator rounded its value or bonuses. Names and recipe fields stay outside this
 * projection, so recomputing an item cannot replace its authored presentation or ingredients.
 */
export function jewelry(params: JewelryBalance, input: JewelryDerivation): DerivedJewelry {
  const bonuses: EquipmentBonuses = {
    meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0,
    meleePower: 0, magicPower: 0, vitality: 0,
  };
  const equip: DerivedJewelry["equip"] = {
    slot: input.shape === "ring" ? "accessory1" : "accessory2",
    requires: {},
    bonuses,
  };
  if (input.variant === "crafted") {
    const matches = params.crafted.profiles.filter(profile => profile.tier === input.tier);
    if (matches.length !== 1) throw new Error(`Expected one crafted jewelry profile for tier ${input.tier}, found ${matches.length}`);
    const profile = matches[0]!;
    equip.requires = { [profile.requirementSkill]: input.tier };
    bonuses[profile.stat] = input.tier / params.crafted.bonusTierDivisor
      * (profile.stat === "health" ? params.crafted.healthMultiplier : params.crafted.otherMultiplier);
    return { tier: input.tier, value: input.tier * params.crafted.valuePerTier, equip };
  }
  const matches = params.miniboss.profiles.filter(profile => profile.tier === input.tier);
  if (matches.length !== 1) throw new Error(`Expected one miniboss jewelry profile for tier ${input.tier}, found ${matches.length}`);
  const profile = matches[0]!;
  equip.requires = { [profile.requirementSkill]: input.tier };
  for (const stat of profile.stats) bonuses[stat] = params.miniboss.bonusPerStat;
  return { tier: input.tier, value: input.tier * params.miniboss.valuePerTier, equip };
}

export type DerivedJewelryRecipe = Pick<RecipeDef, "tier" | "reqLevel" | "inputs" | "output" | "durationMs" | "xp">;

/** Original JEWELRY_RECIPES inputs and quantities, with gather XP rounded before craft weight. */
export function jewelryRecipe(
  params: JewelryBalance, recipeParams: RecipesBalance, input: JewelryRecipeDerivation,
): DerivedJewelryRecipe {
  const matches = params.crafted.profiles.filter(profile => profile.tier === input.tier);
  if (matches.length !== 1) throw new Error(`Expected one crafted jewelry profile for tier ${input.tier}, found ${matches.length}`);
  const profile = matches[0]!;
  return {
    tier: input.tier,
    reqLevel: input.tier,
    inputs: [
      { itemId: profile.bar, quantity: params.crafted.ingredientQuantity },
      { itemId: profile.gem, quantity: params.crafted.ingredientQuantity },
    ],
    output: { itemId: `crafted_${input.shape}_t${input.tier}`, quantity: params.crafted.outputQuantity },
    durationMs: params.crafted.recipeDurationMs,
    xp: recipeXp(recipeParams, { tier: input.tier, craftWeight: params.crafted.recipeWeight }),
  };
}
