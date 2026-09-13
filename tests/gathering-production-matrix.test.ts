import { JEWELRY_RECIPES } from "../game/src/content/jewelry.js";
import { describe, expect, it } from "vitest";
import type { ItemDef, ItemId } from "../game/src/contracts.js";
import { GATHER_TICK_MS } from "../game/src/core/time.js";
import {
  burnChance,
  gatherSuccessChance,
  gatherXp,
  healAmount,
  recipeXp,
  respawnSeconds,
  yieldRange,
  type RecipeDef,
} from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { RESOURCES } from "../game/src/content/resources.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { CREATURE_LOOT_RECIPES } from "../game/src/content/creatureLoot.js";

const ITEMS_BY_ID = new Map<ItemId, ItemDef>(ALL_ITEMS.map((item) => [item.id, item]));
const RESOURCES_BY_ID = new Map(RESOURCES.map((resource) => [resource.id, resource]));

function recipeProducing(itemId: ItemId, tier: number): RecipeDef {
  const recipe = RECIPES.find((candidate) => candidate.tier === tier && candidate.output.itemId === itemId);
  if (!recipe) throw new Error(`No tier ${tier} recipe produces ${itemId}`);
  return recipe;
}

function inputQuantities(recipe: RecipeDef): Record<string, number> {
  return Object.fromEntries(recipe.inputs.map((input) => [input.itemId, input.quantity]));
}

describe("frozen gathering and production formulas", () => {
  it("keeps the 1.8 second gather roll and success curve", () => {
    expect(GATHER_TICK_MS).toBe(1_800);
    for (const requirement of [1, 5, 10]) {
      expect(gatherSuccessChance(requirement, requirement)).toBeCloseTo(0.30, 12);
      expect(gatherSuccessChance(requirement + 1, requirement)).toBeCloseTo(0.316, 12);
    }
    expect(gatherSuccessChance(1, 99)).toBe(0.05);
    expect(gatherSuccessChance(99, 1)).toBe(0.95);
  });

  it("keeps tier 1, 5, and 10 gather XP, yield bands, and respawns", () => {
    expect([1, 5, 10].map(gatherXp)).toEqual([10, 24, 35]);
    expect([1, 5, 10].map(yieldRange)).toEqual([[8, 15], [8, 15], [8, 14]]);
    expect([1, 5, 10].map(respawnSeconds)).toEqual([21, 32, 43]);
  });

  it("keeps healing, burn, and production XP derived from their formulas", () => {
    expect([1, 5, 10].map(healAmount)).toEqual([3, 7, 12]);
    for (const requirement of [1, 5, 10]) {
      expect(burnChance(requirement, requirement)).toBeCloseTo(0.45, 12);
      expect(burnChance(requirement + 1, requirement)).toBeCloseTo(0.42, 12);
      expect(burnChance(requirement + 15, requirement)).toBeCloseTo(0, 12);
    }
    expect([1, 5, 10].map((tier) => recipeXp(tier, 0.8))).toEqual([8, 19, 28]);
    expect([1, 5, 10].map((tier) => recipeXp(tier, 1.0))).toEqual([10, 24, 35]);
    expect([1, 5, 10].map((tier) => recipeXp(tier, 1.5))).toEqual([15, 36, 53]);
    expect([1, 5, 10].map((tier) => recipeXp(tier, 3.2))).toEqual([32, 77, 112]);
  });
});

describe("generated gathering and production matrix", () => {
  it("has one complete, self-contained recipe row at levels 1, 5, 10, and 20", () => {
    expect(GATHERING_PRODUCTION_TIERS.map((definition) => definition.tier)).toEqual([1, 5, 10, 20]);

    for (const definition of GATHERING_PRODUCTION_TIERS) {
      const { tier, items } = definition;
      const recipes = RECIPES.filter((recipe) => recipe.tier === tier && !CREATURE_LOOT_RECIPES.includes(recipe));
      expect(recipes.every((recipe) => recipe.reqLevel === tier), `tier ${tier} requirements`).toBe(true);

      const expectedOutputs: ItemId[] = [
        items.bar,
        items.dagger, items.sword, items.helm, items.body, items.legs, items.boots, items.gloves,
        items.pickaxe, items.hatchet,
        items.cookedFish, items.cookedMeat,
        definition.magic.wand, definition.magic.staff,
        ...JEWELRY_RECIPES.filter(recipe => recipe.tier === tier).map(recipe => recipe.output.itemId),
        items.robe, items.magicLegs, items.hood, items.magicBoots, items.wraps,
        items.shaft, items.handle, items.staff, items.wand, items.shield, items.rod,
        ...(definition.magic.basicWand ? [definition.magic.basicWand] : []),
        ...(definition.magic.basicStaff ? [definition.magic.basicStaff] : []),
      ];
      expect(recipes.map((recipe) => recipe.output.itemId).sort()).toEqual(expectedOutputs.sort());

      for (const resourceId of [
        ...definition.resources.mining,
        definition.resources.fishing,
        definition.resources.woodcutting,
      ]) {
        expect(RESOURCES_BY_ID.has(resourceId), `tier ${tier} resource ${resourceId}`).toBe(true);
      }
    }
  });

  it("contains no dangling recipe item references", () => {
    for (const recipe of RECIPES) {
      for (const input of recipe.inputs) {
        expect(ITEMS_BY_ID.has(input.itemId), `${recipe.id} input ${input.itemId}`).toBe(true);
      }
      expect(ITEMS_BY_ID.has(recipe.output.itemId), `${recipe.id} output ${recipe.output.itemId}`).toBe(true);
      if (recipe.burntItemId) {
        expect(ITEMS_BY_ID.has(recipe.burntItemId), `${recipe.id} burnt result ${recipe.burntItemId}`).toBe(true);
      }
    }
  });

  it("makes shafts, handles, and every wooden equipment family from the matching tier materials", () => {
    for (const definition of GATHERING_PRODUCTION_TIERS) {
      const { tier, items } = definition;
      const shaft = recipeProducing(items.shaft, tier);
      expect(shaft.kind).toBe("fletch");
      expect(shaft.stations).toEqual(["fletching_bench"]);
      expect(shaft.durationMs).toBe(1_800);
      expect(shaft.xp).toBe(gatherXp(tier));
      expect(inputQuantities(shaft)).toEqual({ [items.log]: 1 });
      expect(shaft.output.quantity).toBe(4);

      const handle = recipeProducing(items.handle, tier);
      expect(handle.kind).toBe("fletch");
      expect(handle.stations).toEqual(["fletching_bench"]);
      expect(handle.durationMs).toBe(1_800);
      expect(handle.xp).toBe(gatherXp(tier));
      expect(inputQuantities(handle)).toEqual({ [items.log]: 1 });
      expect(handle.output.quantity).toBe(2);

      expect(inputQuantities(recipeProducing(items.staff, tier))).toEqual({ [items.shaft]: 3 });
      expect(inputQuantities(recipeProducing(items.wand, tier))).toEqual({ [items.shaft]: 2 });
      expect(inputQuantities(recipeProducing(items.rod, tier))).toEqual({ [items.shaft]: 2, [items.hide]: 1 });
      expect(inputQuantities(recipeProducing(items.shield, tier))).toEqual({ [items.log]: 2, [items.bar]: 1 });
      const elementalWand = recipeProducing(definition.magic.wand, tier);
      expect(elementalWand.stations).toEqual(["essence_altar"]);
      expect(inputQuantities(elementalWand)).toEqual({ [items.wand]: 1 });
      const elementalStaff = recipeProducing(definition.magic.staff, tier);
      expect(elementalStaff.stations).toEqual(["essence_altar"]);
      expect(inputQuantities(elementalStaff)).toEqual({ [items.staff]: 1 });
    }
  });

  it("uses one matching handle in every handled smithing recipe", () => {
    for (const { tier, items } of GATHERING_PRODUCTION_TIERS) {
      const expectedBars = new Map<ItemId, number>([
        [items.dagger, 1], [items.sword, 2], [items.pickaxe, 2], [items.hatchet, 2],
      ]);
      for (const [outputId, bars] of expectedBars) {
        const recipe = recipeProducing(outputId, tier);
        expect(recipe.kind).toBe("smith");
        expect(recipe.stations).toEqual(["anvil"]);
        expect(recipe.durationMs).toBe(3_000);
        expect(inputQuantities(recipe)).toEqual({ [items.bar]: bars, [items.handle]: 1 });
        expect(recipe.inputs.some((input) => input.itemId === items.shaft)).toBe(false);
      }
    }
  });

  it("makes wands the cheaper two-thirds magic counterpart to each staff", () => {
    for (const { tier, items } of GATHERING_PRODUCTION_TIERS) {
      const staff = ITEMS_BY_ID.get(items.staff);
      const wand = ITEMS_BY_ID.get(items.wand);
      expect(staff?.equip?.slot).toBe("mainHand");
      expect(wand?.equip?.slot).toBe("mainHand");
      expect(wand?.equip?.requires.magic).toBe(tier);

      const staffBonuses = staff?.equip?.bonuses;
      const wandBonuses = wand?.equip?.bonuses;
      expect(staffBonuses, `${items.staff} bonuses`).toBeDefined();
      expect(wandBonuses, `${items.wand} bonuses`).toBeDefined();
      expect(wandBonuses?.magicAccuracy).toBeLessThan(staffBonuses?.magicAccuracy ?? 0);
      expect(wandBonuses?.magicPower).toBeLessThan(staffBonuses?.magicPower ?? 0);
      expect(wand?.equip?.attackSpeedMs).toBeLessThan(staff?.equip?.attackSpeedMs ?? 0);
      expect(wandBonuses?.meleePower).toBe(0);
      expect(wand?.value).toBeLessThan(staff?.value ?? 0);
    }
  });

  it("cooks the same healing food at ranges and campfires while raw and burnt fish remain inedible", () => {
    for (const { tier, items } of GATHERING_PRODUCTION_TIERS) {
      const recipe = recipeProducing(items.cookedFish, tier);
      expect(recipe.kind).toBe("cook");
      expect(recipe.stations).toEqual(["range", "campfire"]);
      expect(recipe.durationMs).toBe(2_400);
      expect(recipe.xp).toBe(recipeXp(tier, 1.5));
      expect(recipe.inputs).toEqual([{ itemId: items.rawFish, quantity: 1 }]);
      expect(recipe.output).toEqual({ itemId: items.cookedFish, quantity: 1 });
      expect(recipe.burntItemId).toBe(items.burntFish);

      expect(ITEMS_BY_ID.get(items.rawFish)?.food, `${items.rawFish} must be inedible`).toBeUndefined();
      expect(ITEMS_BY_ID.get(items.burntFish)?.food, `${items.burntFish} must be inedible`).toBeUndefined();
      expect(ITEMS_BY_ID.get(items.cookedFish)?.food?.healAmount).toBe(healAmount(tier));
    }
  });
});
