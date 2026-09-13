import { describe, expect, it } from "vitest";
import rawItems from "../game/content/data/items.json";
import rawMaterialFood from "../game/content/data/balance/materialFood.json";
import rawLoot from "../game/content/data/balance/loot.json";
import rawRecipes from "../game/content/data/balance/recipes.json";
import { materialFood, interpolateMaterialValue, type MaterialFoodInput } from "../game/src/content/balance/materialFood.js";
import { lootBalanceSchema, recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import {
  MaterialFoodBalanceSchema,
  MaterialFoodDerivationSchema,
  type MaterialFoodDerivation,
} from "../game/src/content/schema/materialFoodDerivation.js";
import { ItemSchema } from "../game/src/content/schema/items.js";
import { opt, parseCollection, parseValue, str, unknown } from "../game/src/content/schema/core.js";
import {
  attachMaterialFoodDerivations,
  buildMaterialFoodTags,
  CREATURE_MATERIAL_ITEM_IDS,
} from "../tools/content/material-food-derivations.js";

// Keep this test independent of the root ItemRecord derivation union while that union evolves.
const records = parseCollection(ItemSchema.extend({ catalog: str(), derivation: opt(unknown()) }), rawItems, { name: "items" });
const params = parseValue(MaterialFoodBalanceSchema, rawMaterialFood, "balance/materialFood");
const recipes = parseValue(recipesBalanceSchema, rawRecipes, "balance/recipes");
const loot = parseValue(lootBalanceSchema, rawLoot, "balance/loot");
const tags = buildMaterialFoodTags(params, recipes, loot, records);

function tag(id: string): MaterialFoodDerivation {
  return tags.find(row => row.itemId === id)!.derivation;
}

describe("material and cooked food derivations", () => {
  it("covers the eight base foods, three Crownward foods, 24 trophies and 15 regional materials", () => {
    expect(tags).toHaveLength(50);
    expect(tags.filter(row => row.derivation.variant === "cookedFood")).toHaveLength(11);
    expect(tags.filter(row => row.derivation.variant === "creatureMaterial")).toHaveLength(24);
    expect(tags.filter(row => row.derivation.variant === "regionalMaterial")).toHaveLength(15);
    expect(tags.filter(row => row.derivation.variant === "creatureMaterial").map(row => row.itemId))
      .toEqual(CREATURE_MATERIAL_ITEM_IDS);
    for (const row of tags) {
      const keys = Object.keys(row.derivation).sort();
      expect(keys, row.itemId).toEqual(row.derivation.variant === "cookedFood"
        ? ["itemId", "kind", "rawItemId", "variant"]
        : row.derivation.variant === "regionalMaterial"
          ? ["itemId", "kind", "role", "tier", "variant"]
          : ["itemId", "kind", "tier", "variant"]);
    }
  });

  it("recomputes each locked field while retaining authored base food prices", () => {
    for (const proposal of tags) {
      const row = records.find(candidate => candidate.id === proposal.itemId)!;
      const derived = materialFood(params, recipes, loot, {
        ...proposal.derivation,
        tier: row.tier,
      } as MaterialFoodInput, records);
      const actual = Object.fromEntries(Object.keys(derived).map(key => [key, row[key as keyof typeof row]]));
      expect(derived, row.id).toEqual(actual);
    }

    const base = records.find(row => row.id === "roast_game")!;
    const changed = records.map(row => row.id === base.id ? { ...row, value: row.value + 999 } : row);
    expect(buildMaterialFoodTags(params, recipes, loot, changed)).toHaveLength(50);
    expect(materialFood(params, recipes, loot, {
      ...tag("roast_game"), tier: base.tier,
    } as MaterialFoodInput, records)).toEqual({ food: { healAmount: 3 } });

    expect(materialFood(params, recipes, loot, {
      ...tag("cooked_crown_trout"), tier: 30,
    } as MaterialFoodInput, records)).toEqual({ value: 434, food: { healAmount: 26 } });
  });

  it("uses one regional triple per role and preserves the original interpolation and rounding", () => {
    expect(params.regional.values).toHaveLength(5);
    expect(interpolateMaterialValue(30, [20, 50, 70], [160, 360, 590])).toBe(227);
    expect(interpolateMaterialValue(40, [20, 50, 70], [160, 360, 590])).toBe(293);
    expect(interpolateMaterialValue(60, [20, 50, 70], [160, 360, 590])).toBe(475);
    expect(interpolateMaterialValue(50, [20, 50, 70], [1, 9, 30])).toBe(9);
    expect(materialFood(params, recipes, loot, {
      ...tag("dewglass_ore"), tier: 30,
    } as MaterialFoodInput, records)).toEqual({ value: 227 });
    expect(materialFood(params, recipes, loot, {
      ...tag("staramethyst_bar"), tier: 60,
    } as MaterialFoodInput, records)).toEqual({ value: 1650 });
  });

  it("reads creature prices from loot.materialValues rather than copying a second table", () => {
    expect(params).not.toHaveProperty("materialValues");
    const edited = structuredClone(loot);
    edited.materialValues.find(row => row.tier === 10)!.value = 19;
    expect(materialFood(params, recipes, edited, {
      ...tag("porcupine_quill"), tier: 10,
    } as MaterialFoodInput, records)).toEqual({ value: 19 });
  });

  it("attaches only validated identities, preserves unrelated rows and is idempotent", () => {
    const before = JSON.stringify(records);
    const tagged = attachMaterialFoodDerivations(records, params, recipes, loot);
    for (let index = 0; index < records.length; index += 1) {
      const original = records[index]!;
      const output = tagged[index]!;
      if (!tags.some(candidate => candidate.itemId === original.id)) expect(output).toBe(original);
      else {
        expect(output.id).toBe(original.id);
        expect(output.derivation).toEqual(tag(original.id));
      }
    }
    expect(JSON.stringify(records)).toBe(before);
    expect(attachMaterialFoodDerivations(tagged, params, recipes, loot)).toEqual(tagged);
  });

  it("refuses numerical drift, broken identities, missing targets and unmapped creature components", () => {
    const crown = records.find(row => row.id === "cooked_crown_trout")!;
    expect(() => attachMaterialFoodDerivations(records.map(row => row.id === crown.id
      ? { ...row, value: row.value + 1 } : row), params, recipes, loot)).toThrow("drifted material food cooked_crown_trout");
    const trophy = records.find(row => row.id === "porcupine_quill")!;
    expect(() => attachMaterialFoodDerivations(records.map(row => row.id === trophy.id
      ? { ...row, value: row.value + 1 } : row), params, recipes, loot)).toThrow("drifted material food porcupine_quill");
    const regional = records.find(row => row.id === "dewglass_ore")!;
    expect(() => attachMaterialFoodDerivations(records.map(row => row.id === regional.id
      ? { ...row, value: row.value + 1 } : row), params, recipes, loot)).toThrow("drifted material food dewglass_ore");
    expect(() => attachMaterialFoodDerivations(records.filter(row => row.id !== "porcupine_quill"), params, recipes, loot))
      .toThrow("Missing material food target porcupine_quill");
    expect(() => attachMaterialFoodDerivations(records.map(row => row.id === "porcupine_quill"
      ? { ...row, category: "resource" as const } : row), params, recipes, loot)).toThrow("not a component");
    expect(() => attachMaterialFoodDerivations(records.map(row => row.id === "roast_game"
      ? { ...row, catalog: "CROWNWARD_FISH_ITEMS" } : row), params, recipes, loot)).toThrow("Wrong material food catalog");
  });

  it("keeps tag and balance schemas strict", () => {
    expect(() => parseValue(MaterialFoodDerivationSchema, { ...tag("roast_game"), value: 22 }, "tag")).toThrow();
    expect(() => parseValue(MaterialFoodDerivationSchema, { ...tag("roast_game"), variant: "future" }, "tag")).toThrow();
    expect(() => parseValue(MaterialFoodDerivationSchema, { ...tag("dewglass_ore"), values: [1, 2, 3] }, "tag")).toThrow();
    expect(() => parseValue(MaterialFoodBalanceSchema, { ...rawMaterialFood, cookedValueMultiplier: 0 }, "params")).toThrow();
    const duplicate = structuredClone(rawMaterialFood);
    duplicate.regional.identities[1] = duplicate.regional.identities[0]!;
    expect(() => parseValue(MaterialFoodBalanceSchema, duplicate, "params")).toThrow("unique");
    const badCheckpoints = structuredClone(rawMaterialFood);
    badCheckpoints.regional.checkpointTiers = [50, 20, 70];
    expect(() => parseValue(MaterialFoodBalanceSchema, badCheckpoints, "params")).toThrow("must increase");
    expect(() => parseValue(MaterialFoodBalanceSchema, { ...rawMaterialFood, extra: true }, "params")).toThrow();
  });
});
