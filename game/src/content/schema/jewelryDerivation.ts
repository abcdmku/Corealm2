import { enumOf, int, lit, obj, type Infer } from "./core.js";

/** Tier selects independent balance parameters; shape preserves the original equipment slot. */
export const JewelryDerivationSchema = obj({
  kind: lit("jewelry"),
  variant: enumOf(["crafted", "miniboss"] as const, { label: "Jewelry source" }),
  tier: int({ min: 1 }, { label: "Profile tier" }),
  shape: enumOf(["ring", "earring"] as const, { label: "Shape" }),
});

export type JewelryDerivation = Infer<typeof JewelryDerivationSchema>;

/** The crafted profile owns ingredients, duration and XP weight for both jewelry shapes. */
export const JewelryRecipeDerivationSchema = obj({
  kind: lit("jewelryRecipe"),
  tier: int({ min: 1 }, { label: "Profile tier" }),
  shape: enumOf(["ring", "earring"] as const, { label: "Shape" }),
});

export type JewelryRecipeDerivation = Infer<typeof JewelryRecipeDerivationSchema>;
