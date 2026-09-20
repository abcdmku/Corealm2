import { describe, expect, it } from "vitest";
import { ENEMIES } from "../game/src/content/enemies.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { QUESTS } from "../game/src/content/quests.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { SHOPS } from "../game/src/content/shops.js";

const BY_ID = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

describe("magic weapon recipes", () => {
  it.each(["palewood", "duskoak", "cairnpine"] as const)("fletches each wooden wand from two shafts", (wood) => {
    const wand = BY_ID.get(`fletch_${wood}_wand`);
    expect(wand?.durationMs).toBe(1_800);
    expect(wand?.inputs).toEqual([{ itemId: `${wood}_shaft`, quantity: 2 }]);
    expect(wand?.output).toEqual({ itemId: `${wood}_wand`, quantity: 1 });
  });

  it.each(["palewood", "duskoak", "cairnpine"] as const)(
    "keeps %s staff shaft-only and three-shaft",
    (wood) => {
      const staff = BY_ID.get(`fletch_${wood}_staff`);
      expect(staff?.durationMs).toBe(1_800);
      expect(staff?.inputs).toEqual([{ itemId: `${wood}_shaft`, quantity: 3 }]);
      expect(staff?.output).toEqual({ itemId: `${wood}_staff`, quantity: 1 });
    },
  );

  it.each([
    ["air", "palewood", 1],
    ["earth", "duskoak", 5],
    ["water", "cairnpine", 10],
  ] as const)("crafts either matching %s weapon at its awakened altar", (element, wood, level) => {
    for (const kind of ["wand", "staff"] as const) {
      const recipe = BY_ID.get(`craft_${element}_${kind}`);
      expect(recipe?.reqLevel).toBe(level);
      expect(recipe?.stations).toEqual(["essence_altar"]);
      expect(recipe?.inputs).toEqual([{ itemId: `${wood}_${kind}`, quantity: 1 }]);
      expect(recipe?.output).toEqual({ itemId: `${element}_${kind}`, quantity: 1 });
    }
  });

  it("lets the starter weapons be replaced through fletching", () => {
    expect(BY_ID.get("fletch_basic_wooden_wand")?.inputs).toEqual([
      { itemId: "palewood_shaft", quantity: 1 },
    ]);
    expect(BY_ID.get("fletch_basic_wooden_staff")?.inputs).toEqual([
      { itemId: "palewood_shaft", quantity: 2 },
    ]);
  });

  it("does not bypass production with finished weapon drops, quest grants, or shop stock", () => {
    const weaponIds = new Set(GATHERING_PRODUCTION_TIERS.flatMap((tier) => [
      tier.items.wand,
      tier.items.staff,
      tier.magic.wand,
      tier.magic.staff,
      ...(tier.magic.basicWand ? [tier.magic.basicWand] : []),
      ...(tier.magic.basicStaff ? [tier.magic.basicStaff] : []),
    ]));

    const enemyDrops = ENEMIES.flatMap((enemy) => enemy.lootRolls.flatMap(roll => roll.drops).map((drop) => drop.itemId));
    const shopStock = SHOPS.flatMap((shop) => shop.stock.map((stock) => stock.itemId));
    const questGrants = QUESTS.flatMap((quest) => [
      ...(quest.onStart?.items ?? []).map((item) => item.itemId),
      ...quest.rewards.items.map((item) => item.itemId),
      ...quest.stages.flatMap((stage) => (stage.grants?.items ?? []).map((item) => item.itemId)),
    ]);

    expect(enemyDrops.filter((itemId) => weaponIds.has(itemId))).toEqual([]);
    expect(shopStock.filter((itemId) => weaponIds.has(itemId))).toEqual([]);
    expect(questGrants.filter((itemId) => weaponIds.has(itemId))).toEqual([]);
  });
});
