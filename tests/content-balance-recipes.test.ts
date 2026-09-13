import { describe, expect, it } from "vitest";
import raw from "../game/content/data/balance/recipes.json";
import { recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { gatherXp, recipeXp, healAmount, toolBonus } from "../game/src/content/balance/recipes.js";
const params = parseValue(recipesBalanceSchema, raw, "balance/recipes");
describe("recipe balance parameters", () => {
  it("preserves the shipped curve including rounding before craft weight", () => {
    const rows = [[0,0,0,2,2],[1,10,25,3,2],[5,24,60,7,5],[10,35,88,12,9],[20,52,130,19,17],[30,65,163,26,24],[40,76,190,33,32],[50,86,215,40,39],[60,95,238,46,40],[70,103,258,52,40],[90,119,298,64,40]];
    for (const [tier, ...expected] of rows) expect([gatherXp(params, tier!), recipeXp(params, { tier: tier!, craftWeight: 2.5 }), healAmount(params, tier!), toolBonus(params, tier!)]).toEqual(expected);
  });
  it("takes independent explicit parameters without mutating them", () => {
    const changed = structuredClone(params);
    changed.gatherXp = { multiplier: 3, exponent: 1 };
    changed.healAmount = { base: 4, multiplier: 2, exponent: 1 };
    changed.toolBonus = { base: 2, perTier: 2, maximum: 9 };
    const before = structuredClone(changed);
    expect(recipeXp(changed, { tier: 5, craftWeight: 2 })).toBe(30);
    expect(healAmount(changed, 5)).toBe(14);
    expect(toolBonus(changed, 5)).toBe(9);
    expect(changed).toEqual(before);
    expect(gatherXp(params, 5)).toBe(24);
  });
});
