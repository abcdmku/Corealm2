import { describe, expect, it } from "vitest";
import rawRecipes from "../game/content/data/recipes.json";
import type { RecipeDef } from "../game/src/content/index.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { JEWELRY_RECIPES } from "../game/src/content/jewelry.js";
import { CREATURE_LOOT_RECIPES } from "../game/src/content/creatureLoot.js";
import { WILDERNESS_LOOT_RECIPES } from "../game/src/content/wildernessLoot.js";
import { CROWNWARD_FISH_RECIPES } from "../game/src/content/crownwardFishing.js";
import { REGIONAL_TIER_RECIPES } from "../game/src/content/regionalTierEquipment.js";
import { RECIPE_DATA, RECIPE_RECORDS, recipeRows } from "../game/src/content/recipeData.js";
import { RecipeSchema, RecipeRecordSchema, RECIPE_SOURCE_CATALOGS } from "../game/src/content/schema/recipes.js";
import { parseCollection, parseValue, validateCollection } from "../game/src/content/schema/core.js";
import { buildRecipeRecords, type RecipeSourceTables } from "../tools/content/export-recipes.js";

const views = { RECIPES, JEWELRY_RECIPES, CREATURE_LOOT_RECIPES, WILDERNESS_LOOT_RECIPES, CROWNWARD_FISH_RECIPES, REGIONAL_TIER_RECIPES };

function fixture(id: string): RecipeDef {
  return { id, name: id, kind: "craft", skill: "crafting", reqLevel: 1, tier: 1, stations: ["crafting_table"],
    inputs: [{ itemId: "pale_quartz", quantity: 1 }], output: { itemId: "crafted_ring_t10", quantity: 1 }, durationMs: 3000, xp: 10 };
}

function sources(all: readonly RecipeDef[], extras: Partial<RecipeSourceTables> = {}): RecipeSourceTables {
  return { RECIPES: all, JEWELRY_RECIPES: [], CREATURE_LOOT_RECIPES: [], WILDERNESS_LOOT_RECIPES: [],
    CROWNWARD_FISH_RECIPES: [], REGIONAL_TIER_RECIPES: [], ...extras };
}

describe("JSON recipe loaders and export", () => {
  it("loads all 236 authored recipes in file order and reproduces every source export", () => {
    expect(RECIPES).toHaveLength(236);
    expect(RECIPES).toBe(RECIPE_DATA);
    expect(RECIPES).toEqual(rawRecipes.map(({ catalog: _catalog, derivation: _derivation, ...row }) => row));
    expect(parseCollection(RecipeSchema, RECIPES, { name: "recipes" })).toEqual(RECIPES);
    expect(buildRecipeRecords(views, RECIPES)).toEqual(RECIPE_RECORDS);
    expect(recipeRows("RECIPES")).toHaveLength(102);
  });

  it("shares objects, ingredient lists, and outputs across all source views", () => {
    const byId = new Map(RECIPES.map((row) => [row.id, row]));
    for (const source of RECIPE_SOURCE_CATALOGS) {
      const expected = RECIPES.filter((_row, index) => source === "RECIPES" || RECIPE_RECORDS[index]!.catalog === source);
      expect(views[source], source).toEqual(expected);
      for (const row of views[source]) {
        expect(row).toBe(byId.get(row.id));
        expect(row.inputs).toBe(byId.get(row.id)!.inputs);
        expect(row.output).toBe(byId.get(row.id)!.output);
        expect(row).not.toHaveProperty("catalog");
      }
    }
    const selected = recipeRows(["CREATURE_LOOT_RECIPES", "JEWELRY_RECIPES"]);
    expect(selected).toEqual([...JEWELRY_RECIPES, ...CREATURE_LOOT_RECIPES]);
    expect(recipeRows([])).toEqual([]);
  });

  it("supports station-free recipes and preserves optional burnt outputs", () => {
    const anywhere = { ...fixture("anywhere"), stations: null };
    expect(parseValue(RecipeSchema, anywhere, "recipe")).toEqual(anywhere);
    const cooking = RECIPES.find((row) => row.burntItemId)!;
    expect(parseValue(RecipeSchema, cooking, "recipe")).toEqual(cooking);
    expect(parseValue(RecipeSchema, fixture("ordinary"), "recipe")).not.toHaveProperty("burntItemId");
    expect(RecipeSchema.fields.id.meta).toMatchObject({ readOnly: true, identity: true });
  });

  it.each([
    ["quantity", { ...fixture("bad"), inputs: [{ itemId: "pale_quartz", quantity: 0 }] }, ".inputs[0].quantity"],
    ["fractional output", { ...fixture("bad"), output: { itemId: "pale_quartz", quantity: 1.5 } }, ".output.quantity"],
    ["item reference", { ...fixture("bad"), output: { itemId: "", quantity: 1 } }, ".output.itemId"],
    ["station", { ...fixture("bad"), stations: ["workbench"] }, ".stations[0]"],
    ["empty stations", { ...fixture("bad"), stations: [] }, ".stations"],
    ["skill", { ...fixture("bad"), skill: "alchemy" }, ".skill"],
    ["duration", { ...fixture("bad"), durationMs: 0 }, ".durationMs"],
    ["XP", { ...fixture("bad"), xp: Number.NaN }, ".xp"],
    ["nested typo", { ...fixture("bad"), output: { itemId: "pale_quartz", quantity: 1, count: 1 } }, ".output.count"],
  ])("rejects invalid %s at the exact field", (_name, row, suffix) => {
    const { issues } = validateCollection(RecipeSchema, [row], { name: "recipes" });
    expect(issues.some((issue) => issue.path.endsWith(suffix) && issue.severity === "error")).toBe(true);
  });

  it("rejects unknown catalogs and duplicate recipe identities", () => {
    const first = rawRecipes[0]!;
    expect(() => parseCollection(RecipeRecordSchema, [{ ...first, catalog: "FUTURE" }], { name: "recipes" })).toThrow("catalog");
    expect(() => parseCollection(RecipeRecordSchema, [first, first], { name: "recipes" })).toThrow("duplicate id");
  });

  it("assigns specific and remaining base catalogs without regrouping or mutating sources", () => {
    const a = fixture("a"), b = fixture("b"), c = fixture("c");
    const all = Object.freeze([a, b, c]);
    const tables = sources(all, { JEWELRY_RECIPES: [a, c] });
    const before = JSON.stringify(tables);
    expect(buildRecipeRecords(tables, all).map(({ id, catalog }) => [id, catalog])).toEqual([
      ["a", "JEWELRY_RECIPES"], ["b", "RECIPES"], ["c", "JEWELRY_RECIPES"],
    ]);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it("rejects overlapping, conflicting, absent, reordered, and duplicated source recipes", () => {
    const a = fixture("a"), b = fixture("b");
    expect(() => buildRecipeRecords(sources([a], { JEWELRY_RECIPES: [a], CREATURE_LOOT_RECIPES: [a] }), [a])).toThrow("overlaps leaf sources");
    expect(() => buildRecipeRecords(sources([a], { JEWELRY_RECIPES: [{ ...a, xp: 12 }] }), [a])).toThrow("JEWELRY_RECIPES[0].xp");
    expect(() => buildRecipeRecords(sources([a], { JEWELRY_RECIPES: [b] }), [a])).toThrow("absent from RECIPES");
    expect(() => buildRecipeRecords(sources([a, b], { JEWELRY_RECIPES: [b, a] }), [a, b])).toThrow("parity failed for JEWELRY_RECIPES");
    expect(() => buildRecipeRecords(sources([a], { JEWELRY_RECIPES: [a, a] }), [a])).toThrow("duplicate id");
    expect(() => buildRecipeRecords(sources([a]), [a, a])).toThrow("duplicate id");
  });
});
