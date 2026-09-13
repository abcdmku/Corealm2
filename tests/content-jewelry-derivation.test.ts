import { describe, expect, it } from "vitest";
import rawItems from "../game/content/data/items.json";
import rawParameters from "../game/content/data/balance/jewelry.json";
import rawRecipes from "../game/content/data/recipes.json";
import rawRecipeParameters from "../game/content/data/balance/recipes.json";
import { jewelry, jewelryRecipe } from "../game/src/content/balance/jewelry.js";
import { jewelryBalanceSchema, recipesBalanceSchema, type JewelryBalance } from "../game/src/content/schema/balance.js";
import { JewelryDerivationSchema, JewelryRecipeDerivationSchema, type JewelryDerivation, type JewelryRecipeDerivation } from "../game/src/content/schema/jewelryDerivation.js";
import { ItemSchema } from "../game/src/content/schema/items.js";
import { RecipeSchema } from "../game/src/content/schema/recipes.js";
import { opt, parseCollection, parseValue, str, unknown } from "../game/src/content/schema/core.js";
import { attachJewelryDerivations } from "../tools/content/jewelry-derivations.js";

// Parse production item fields independently of the root's evolving derivation union.
const records = parseCollection(ItemSchema.extend({ catalog: str(), derivation: opt(unknown()) }), rawItems, { name: "items" });
const params = parseValue(jewelryBalanceSchema, rawParameters, "balance/jewelry");
const recipeParams = parseValue(recipesBalanceSchema, rawRecipeParameters, "balance/recipes");
const recipeRecords = parseCollection(RecipeSchema.extend({ catalog: str(), derivation: opt(unknown()) }), rawRecipes, { name: "recipes" });
const isJewelry = (row: { catalog: string }) => row.catalog === "CRAFTED_JEWELRY" || row.catalog === "MINIBOSS_JEWELLERY";

describe("crafted and guardian jewelry derivations", () => {
  it("recomputes all 14 crafted and 14 guardian records exactly", () => {
    const tagged = attachJewelryDerivations(records, params);
    const targets = tagged.filter(isJewelry);
    expect(targets.filter(row => row.catalog === "CRAFTED_JEWELRY")).toHaveLength(14);
    expect(targets.filter(row => row.catalog === "MINIBOSS_JEWELLERY")).toHaveLength(14);
    for (const row of targets) {
      const input = parseValue(JewelryDerivationSchema, row.derivation, `${row.id}.derivation`);
      expect(jewelry(params, input), row.id).toEqual({ tier: row.tier, value: row.value, equip: row.equip });
      expect(input.variant).toBe(row.catalog === "CRAFTED_JEWELRY" ? "crafted" : "miniboss");
      expect(input.tier).toBe(row.tier);
      expect(input.shape).toBe(row.id.includes("_earring_") ? "earring" : "ring");
    }
    expect(attachJewelryDerivations(tagged, params)).toEqual(tagged);
  });

  it("preserves every unrelated record and gear tag without mutating the input", () => {
    const before = JSON.stringify(records);
    const tagged = attachJewelryDerivations(records, params);
    for (let index = 0; index < records.length; index++) {
      const original = records[index]!;
      if (!isJewelry(original)) expect(tagged[index]).toBe(original);
      else {
        const { derivation: _old, ...originalItem } = original;
        const { derivation: _new, ...taggedItem } = tagged[index]!;
        expect(taggedItem).toEqual(originalItem);
      }
    }
    expect(JSON.stringify(records)).toBe(before);
    const gear = records.find(row => row.id === "grithe_sword")!;
    expect(gear.derivation).toMatchObject({ kind: "gear" });
    expect(tagged.find(row => row.id === gear.id)!.derivation).toBe(gear.derivation);
  });

  it("reads changed crafted multipliers and profile fields without introducing rounding", () => {
    const changed = structuredClone(params);
    changed.crafted.valuePerTier = 80.013;
    changed.crafted.bonusTierDivisor = 9;
    changed.crafted.healthMultiplier = 2.75;
    const tag: JewelryDerivation = { kind: "jewelry", variant: "crafted", tier: 40, shape: "earring" };
    const result = jewelry(changed, tag);
    expect(result.value).toBe(40 * 80.013);
    expect(Number.isInteger(result.value)).toBe(false);
    expect(result.equip.bonuses.health).toBe(40 / 9 * 2.75);
    expect(result.equip.slot).toBe("accessory2");
    expect(result.equip.requires).toEqual({ melee: 40 });

    const profile = changed.crafted.profiles.find(row => row.tier === 40)!;
    profile.stat = "magicPower";
    profile.requirementSkill = "magic";
    changed.crafted.otherMultiplier = 1.25;
    const revised = jewelry(changed, tag);
    expect(revised.equip.bonuses.magicPower).toBe(40 / 9 * 1.25);
    expect(revised.equip.bonuses.health).toBe(0);
    expect(revised.equip.requires).toEqual({ magic: 40 });
    expect(revised.equip).not.toHaveProperty("attackSpeedMs");
  });

  it("reads changed guardian value, requirements and stat profiles", () => {
    const changed = structuredClone(params);
    changed.miniboss.valuePerTier = 400.123;
    changed.miniboss.bonusPerStat = 3.25;
    const profile = changed.miniboss.profiles.find(row => row.tier === 70)!;
    profile.stats = ["defence", "vitality"];
    profile.requirementSkill = "melee";
    const result = jewelry(changed, { kind: "jewelry", variant: "miniboss", tier: 70, shape: "ring" });
    expect(result.value).toBe(70 * 400.123);
    expect(result.equip).toEqual({
      slot: "accessory1", requires: { melee: 70 }, bonuses: {
        meleeAccuracy: 0, magicAccuracy: 0, defence: 3.25, health: 0,
        meleePower: 0, magicPower: 0, vitality: 3.25,
      },
    });
  });

  it("returns independent outputs and leaves parameters and tags unchanged", () => {
    const before = JSON.stringify(params);
    for (const variant of ["crafted", "miniboss"] as const) {
      const tag = { kind: "jewelry", variant, tier: 10, shape: "ring" } as const;
      const originalTag = structuredClone(tag);
      const result = jewelry(params, tag);
      result.equip.bonuses.meleeAccuracy = 99;
      result.equip.requires.melee = 99;
      expect(jewelry(params, tag).equip).not.toEqual(result.equip);
      expect(tag).toEqual(originalTag);
    }
    expect(JSON.stringify(params)).toBe(before);
  });

  it("refuses numeric drift, conflicting tags and mismatched original identities", () => {
    const original = records.find(row => row.id === "crafted_ring_t10")!;
    expect(() => attachJewelryDerivations([{ ...original, value: original.value + 1 }], params)).toThrow("drifted jewelry");
    expect(() => attachJewelryDerivations([{ ...original, equip: { ...original.equip!, slot: "accessory2" } }], params)).toThrow("drifted jewelry");
    expect(() => attachJewelryDerivations([{ ...original, derivation: { kind: "gear" } }], params)).toThrow("Conflicting jewelry derivation");
    expect(() => attachJewelryDerivations([{ ...original, id: "crafted_ring_t20" }], params)).toThrow("catalog/tier identity");
    expect(() => attachJewelryDerivations([{ ...original, catalog: "MINIBOSS_JEWELLERY" }], params)).toThrow("catalog/tier identity");
    const changed = structuredClone(params);
    changed.crafted.otherMultiplier = 2;
    expect(() => attachJewelryDerivations([original], changed)).toThrow("drifted jewelry");
  });

  it("rejects missing or ambiguous profiles and validates tag inputs", () => {
    for (const variant of ["crafted", "miniboss"] as const) {
      expect(() => jewelry(params, { kind: "jewelry", variant, tier: 90, shape: "ring" })).toThrow("found 0");
      const changed = structuredClone(params);
      if (variant === "crafted") changed.crafted.profiles.push({ ...changed.crafted.profiles[0]! });
      else changed.miniboss.profiles.push({ ...changed.miniboss.profiles[0]! });
      expect(() => jewelry(changed, { kind: "jewelry", variant, tier: 10, shape: "ring" })).toThrow("found 2");
    }
    const valid = { kind: "jewelry", variant: "crafted", tier: 10, shape: "ring" };
    for (const invalid of [{ ...valid, tier: 0 }, { ...valid, tier: 10.5 }, { ...valid, shape: "pendant" },
      { ...valid, variant: "rare" }, { ...valid, value: 800 }]) {
      expect(() => parseValue(JewelryDerivationSchema, invalid, "derivation")).toThrow();
    }
  });
});

describe("crafted jewelry recipe derivations", () => {
  it("reproduces ingredients, output, duration, requirements and XP for all 14 recipes", () => {
    const targets = recipeRecords.filter(row => row.catalog === "JEWELRY_RECIPES");
    expect(targets).toHaveLength(14);
    for (const row of targets) {
      const shape = row.output.itemId.includes("_earring_") ? "earring" : "ring";
      const input = parseValue(JewelryRecipeDerivationSchema, { kind: "jewelryRecipe", tier: row.tier, shape }, `${row.id}.derivation`);
      expect(jewelryRecipe(params, recipeParams, input), row.id).toEqual({
        tier: row.tier, reqLevel: row.reqLevel, inputs: row.inputs, output: row.output,
        durationMs: row.durationMs, xp: row.xp,
      });
    }
  });

  it("uses each jewelry recipe parameter independently", () => {
    const input: JewelryRecipeDerivation = { kind: "jewelryRecipe", tier: 10, shape: "ring" };
    const original = jewelryRecipe(params, recipeParams, input);
    const changes: [string, (changed: JewelryBalance) => void][] = [
      ["duration", changed => { changed.crafted.recipeDurationMs = 4500; }],
      ["XP weight", changed => { changed.crafted.recipeWeight = 4.3; }],
      ["ingredient quantity", changed => { changed.crafted.ingredientQuantity = 2; }],
      ["output quantity", changed => { changed.crafted.outputQuantity = 3; }],
      ["bar", changed => { changed.crafted.profiles[0]!.bar = "emberite_bar"; }],
      ["gem", changed => { changed.crafted.profiles[0]!.gem = "fire_opal"; }],
    ];
    for (const [field, mutate] of changes) {
      const changed = structuredClone(params);
      mutate(changed);
      expect(jewelryRecipe(changed, recipeParams, input), field).not.toEqual(original);
    }
    const changed = structuredClone(params);
    for (const [, mutate] of changes) mutate(changed);
    const result = jewelryRecipe(changed, recipeParams, { ...input, shape: "earring" });
    expect(result.inputs).toEqual([{ itemId: "emberite_bar", quantity: 2 }, { itemId: "fire_opal", quantity: 2 }]);
    expect(result.output).toEqual({ itemId: "crafted_earring_t10", quantity: 3 });
    expect(result.durationMs).toBe(4500);
    expect(result.xp).toBe(Math.round(35 * 4.3));
  });

  it("reads gather curve parameters and rounds gather XP before multiplying by weight", () => {
    const changed = structuredClone(params);
    const changedRecipeParams = structuredClone(recipeParams);
    changed.crafted.recipeWeight = 3.3;
    changedRecipeParams.gatherXp.multiplier = 10.1;
    const input = { kind: "jewelryRecipe", tier: 10, shape: "ring" } as const;
    const result = jewelryRecipe(changed, changedRecipeParams, input);
    expect(result.xp).toBe(119);
    expect(result.xp).not.toBe(Math.round(10.1 * 10 ** changedRecipeParams.gatherXp.exponent * 3.3));
    changedRecipeParams.gatherXp.exponent = 0.7;
    expect(jewelryRecipe(changed, changedRecipeParams, input).xp).not.toBe(result.xp);
  });

  it("returns independent recipe fields without mutating inputs", () => {
    const before = JSON.stringify([params, recipeParams]);
    const input = { kind: "jewelryRecipe", tier: 10, shape: "ring" } as const;
    const result = jewelryRecipe(params, recipeParams, input);
    result.inputs[0]!.itemId = "changed_bar";
    result.inputs[0]!.quantity = 99;
    result.output.quantity = 99;
    expect(jewelryRecipe(params, recipeParams, input).inputs[0]).toEqual({ itemId: "kaldite_bar", quantity: 1 });
    expect(jewelryRecipe(params, recipeParams, input).output.quantity).toBe(1);
    expect(JSON.stringify([params, recipeParams])).toBe(before);
    expect(input).toEqual({ kind: "jewelryRecipe", tier: 10, shape: "ring" });
  });

  it("rejects missing or duplicate profiles and invalid recipe tags", () => {
    expect(() => jewelryRecipe(params, recipeParams, { kind: "jewelryRecipe", tier: 90, shape: "ring" })).toThrow("found 0");
    const changed = structuredClone(params);
    changed.crafted.profiles.push({ ...changed.crafted.profiles[0]! });
    expect(() => jewelryRecipe(changed, recipeParams, { kind: "jewelryRecipe", tier: 10, shape: "ring" })).toThrow("found 2");
    const valid = { kind: "jewelryRecipe", tier: 10, shape: "ring" };
    for (const invalid of [{ ...valid, tier: 0 }, { ...valid, tier: 1.5 }, { ...valid, shape: "pendant" },
      { ...valid, kind: "jewelry" }, { ...valid, craftWeight: 3 }, { ...valid, inputs: [] }]) {
      expect(() => parseValue(JewelryRecipeDerivationSchema, invalid, "derivation")).toThrow();
    }
  });
});
