import { enumOf, lit, num, obj, union, type Infer, type Schema } from "./core.js";

/** Stable keys in balance/recipes.json that supply a recipe's craft weight. */
export const RECIPE_WEIGHT_KEYS = [
  "smeltBar", "dagger", "sword", "bodyOrLegs", "helmBootsGloves", "toolHead",
  "cookedFood", "amuletOrRing", "leatherBody", "staff", "wand", "toolHandle",
  "fishingRod", "woodenShield",
] as const;

export type RecipeWeightKey = typeof RECIPE_WEIGHT_KEYS[number];

const recipeXpByWeightKey = obj({
  kind: lit("recipeXp", { readOnly: true }),
  weightKey: enumOf(RECIPE_WEIGHT_KEYS, { label: "Craft weight key" }),
});

const recipeXpByLiteralWeight = obj({
  kind: lit("recipeXp", { readOnly: true }),
  craftWeight: num({ exclusiveMin: 0 }, { label: "Craft weight", unit: "x" }),
});

/** Exactly one source is required so a tag cannot silently carry competing weights. */
export const RecipeDerivationSchema = union([
  recipeXpByWeightKey,
  recipeXpByLiteralWeight,
] as const, { label: "XP derivation" }) satisfies Schema<
  | { kind: "recipeXp"; weightKey: RecipeWeightKey }
  | { kind: "recipeXp"; craftWeight: number }
>;

export type RecipeDerivation = Infer<typeof RecipeDerivationSchema>;

/** Descriptive alias for callers that want to name the only currently supported derivation. */
export const RecipeXpDerivationSchema = RecipeDerivationSchema;
export type RecipeXpDerivation = RecipeDerivation;
