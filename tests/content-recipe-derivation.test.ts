import { describe, expect, it } from "vitest";
import rawParameters from "../game/content/data/balance/recipes.json";
import rawRecipes from "../game/content/data/recipes.json";
import { recipeXp, recipeFieldsFromDerivation } from "../game/src/content/balance/recipes.js";
import { jewelryRecipe } from "../game/src/content/balance/jewelry.js";
import jewelryParameters from "../game/content/data/balance/jewelry.json";
import { jewelryBalanceSchema } from "../game/src/content/schema/balance.js";
import { RECIPE_DATA, RECIPE_RECORDS } from "../game/src/content/recipeData.js";
import { recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import { parseCollection, parseValue } from "../game/src/content/schema/core.js";
import {
  RecipeDerivationSchema,
  type RecipeDerivation,
} from "../game/src/content/schema/recipeDerivation.js";
import { RecipeSchema, RecipeRecordSchema } from "../game/src/content/schema/recipes.js";
import {
  attachRecipeDerivations,
  recipeCraftWeight,
  recipeDerivationFor,
  recipeXpFromDerivation,
} from "../tools/content/recipe-derivations.js";

const params = parseValue(recipesBalanceSchema, rawParameters, "balance/recipes");

describe("recipe XP derivation tags", () => {
  it("covers every source row and reproduces the authored XP", () => {
    expect(RECIPE_RECORDS).toHaveLength(236);
    expect(RECIPE_RECORDS.filter(row => row.catalog === "RECIPES")).toHaveLength(102);
    expect(RECIPE_RECORDS.every(row => row.derivation)).toBe(true);
    expect(RECIPE_RECORDS.filter(row => "craftWeight" in row.derivation!).map(row => row.id)).toEqual([
      "creature_tapir_leather", "creature_drake_scale",
      "craft_mistweave_thread", "craft_crownhide_thread", "craft_faesilk_thread",
    ]);

    for (const row of RECIPE_RECORDS) {
      const derivation = row.derivation!;
      if (derivation.kind === "jewelryRecipe") {
        expect(jewelryRecipe(parseValue(jewelryBalanceSchema, jewelryParameters, "balance/jewelry"), params, derivation).xp, row.id).toBe(row.xp);
        continue;
      }
      expect(recipeXpFromDerivation(params, row, derivation), row.id).toBe(row.xp);
      expect(recipeXp(params, { tier: row.tier, craftWeight: recipeCraftWeight(params, derivation) }), row.id)
        .toBe(row.xp);
    }
  });

  it("strips catalog and derivation metadata from every runtime view", () => {
    expect(RECIPE_DATA).toEqual(rawRecipes.map(({ catalog: _catalog, derivation: _derivation, ...row }) => row));
    expect(RECIPE_DATA.every(row => !Object.hasOwn(row, "catalog") && !Object.hasOwn(row, "derivation"))).toBe(true);
    expect(parseCollection(RecipeSchema, RECIPE_DATA, { name: "recipes" })).toEqual(RECIPE_DATA);
  });

  it("keeps the tag a strict one-of and rejects unknown fields", () => {
    const parse = (value: unknown) => parseValue(RecipeDerivationSchema, value, "recipe.derivation");
    expect(parse({ kind: "recipeXp", weightKey: "sword" })).toEqual({ kind: "recipeXp", weightKey: "sword" });
    expect(parse({ kind: "recipeXp", craftWeight: 1.25 })).toEqual({ kind: "recipeXp", craftWeight: 1.25 });
    expect(() => parse({ kind: "recipeXp" })).toThrow("weightKey");
    expect(() => parse({ kind: "recipeXp", weightKey: "sword", craftWeight: 3.5 })).toThrow("craftWeight");
    expect(() => parse({ kind: "recipeXp", weightKey: "nearest" })).toThrow("weightKey");
    expect(() => parse({ kind: "recipeXp", craftWeight: 0 })).toThrow("craftWeight");
    expect(() => parse({ kind: "recipeXp", weightKey: "sword", extra: true })).toThrow("extra");
    const first = rawRecipes[0]!;
    expect(() => parseValue(RecipeRecordSchema, { ...first, derivation: { kind: "future" } }, "recipes[0]")).toThrow("derivation");
  });

  it("records the source role mapping without using authored XP to choose a weight", () => {
    const base = RECIPE_RECORDS.find(row => row.id === "smith_grithe_sword")!;
    expect(recipeDerivationFor("RECIPES", base)).toEqual({ kind: "recipeXp", weightKey: "sword" });
    const thread = RECIPE_RECORDS.find(row => row.id === "craft_mistweave_thread")!;
    expect(recipeDerivationFor("REGIONAL_TIER_RECIPES", thread)).toEqual({ kind: "recipeXp", craftWeight: 0.8 });
    const trophy = RECIPE_RECORDS.find(row => row.id === "creature_tapir_leather")!;
    expect(recipeDerivationFor("CREATURE_LOOT_RECIPES", trophy)).toEqual({ kind: "recipeXp", craftWeight: 1 });
  });

  it("refuses to tag a row whose locked XP has drifted", () => {
    const changed = RECIPE_RECORDS.map(row => row.id === "smith_grithe_sword" ? { ...row, xp: row.xp + 1 } : row);
    expect(() => attachRecipeDerivations(changed, params)).toThrow("drifted recipe smith_grithe_sword");
  });

  it("tracks W duration edits only for the 102 recipes authored from that table", () => {
    const changed = structuredClone(params);
    changed.weights.helmBootsGloves.ms += 100;
    const base = RECIPE_RECORDS.filter(row => row.catalog === "RECIPES");
    for (const row of base) {
      if (row.derivation?.kind !== "recipeXp") throw new Error("Expected base recipe XP tag");
      expect(recipeFieldsFromDerivation(params, row, row.derivation).durationMs, row.id).toBe(row.durationMs);
    }
    const hood = base.find(row => row.derivation?.kind === "recipeXp" && "weightKey" in row.derivation && row.derivation.weightKey === "helmBootsGloves" && row.kind === "craft")!;
    if (hood.derivation?.kind !== "recipeXp") throw new Error("Expected hood tag");
    expect(recipeFieldsFromDerivation(changed, hood, hood.derivation).durationMs).toBe(hood.durationMs + 100);
    expect(() => attachRecipeDerivations(RECIPE_RECORDS, changed)).toThrow("duration");
  });
});

const _typeCheck: RecipeDerivation | undefined = RECIPE_RECORDS[0]!.derivation?.kind === "recipeXp" ? RECIPE_RECORDS[0]!.derivation : undefined;
void _typeCheck;
