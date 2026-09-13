import { SKILL_IDS } from "../../contracts.js";
import type { StationKind } from "../../contracts.js";
import type { RecipeDef, RecipeKind } from "../index.js";
import { RecipeDerivationSchema } from "./recipeDerivation.js";
import { JewelryRecipeDerivationSchema } from "./jewelryDerivation.js";
import { arr, enumOf, id, int, nullable, num, obj, opt, ref, str, union, type Schema } from "./core.js";

const ingredient = obj({
  itemId: ref("item", { label: "Item" }),
  quantity: int({ min: 1 }, { label: "Quantity", step: 1 }),
});

export const RecipeSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  kind: enumOf(["smelt", "smith", "cook", "craft", "fletch"] as const satisfies readonly RecipeKind[], { label: "Recipe kind" }),
  skill: enumOf(SKILL_IDS, { label: "Skill", ref: "skill" }),
  reqLevel: int({ min: 1 }, { label: "Required level", step: 1 }),
  tier: int({ min: 0 }, { label: "Tier", step: 1 }),
  stations: nullable(arr(enumOf([
    "furnace", "anvil", "range", "campfire", "crafting_table", "fletching_bench", "essence_altar",
  ] as const satisfies readonly StationKind[], { label: "Station", ref: "station" }), { minLength: 1 }),
  { label: "Accepted stations", help: "Null allows production anywhere." }),
  inputs: arr(ingredient, {}, { label: "Ingredients" }),
  output: ingredient.describe({ label: "Output" }),
  durationMs: num({ exclusiveMin: 0 }, { label: "Duration", unit: "ms" }),
  xp: int({ min: 0 }, { label: "XP", unit: "xp", step: 1 }),
  burntItemId: opt(ref("item"), { label: "Burnt output", help: "Item produced when cooking fails." }),
}) satisfies Schema<RecipeDef>;

/** Exclusive leaf catalogs followed by the remaining base recipes. */
export const RECIPE_SOURCE_CATALOGS = [
  "JEWELRY_RECIPES", "CREATURE_LOOT_RECIPES", "WILDERNESS_LOOT_RECIPES",
  "CROWNWARD_FISH_RECIPES", "REGIONAL_TIER_RECIPES", "RECIPES",
] as const;
export type RecipeCatalog = typeof RECIPE_SOURCE_CATALOGS[number];

export const RecipeRecordSchema = RecipeSchema.extend({
  catalog: enumOf(RECIPE_SOURCE_CATALOGS, { hidden: true }),
  derivation: opt(union([RecipeDerivationSchema, JewelryRecipeDerivationSchema] as const), {
    label: "Balance derivation",
    help: "Locks the fields supplied by this recipe's source formula, including XP and base-table duration. Remove this tag to hand tune them.",
  }),
});

export type RecipeRecord = RecipeDef & {
  catalog: RecipeCatalog;
  derivation?: import("./recipeDerivation.js").RecipeDerivation | import("./jewelryDerivation.js").JewelryRecipeDerivation;
};
