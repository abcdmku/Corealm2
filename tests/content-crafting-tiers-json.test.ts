import { describe, expect, it } from "vitest";
import rawTiers from "../game/content/data/craftingTiers.json";
import { REGIONAL_CRAFTING_TIERS } from "../game/src/content/regionalTierEquipment.js";
import { WILDERNESS_CRAFTING_TIERS } from "../game/src/content/wildernessLoot.js";
import { CRAFTING_TIER_RECORDS } from "../game/src/content/craftingTierData.js";
import { CraftingTierRecordSchema } from "../game/src/content/schema/craftingTiers.js";
import { parseCollection } from "../game/src/content/schema/core.js";

describe("crafting tier JSON", () => {
  it("rebuilds both original ladders in order from five canonical records", () => {
    expect(CRAFTING_TIER_RECORDS).toEqual(rawTiers);
    expect(CRAFTING_TIER_RECORDS.map((row) => row.tier)).toEqual([30, 40, 50, 60, 70]);
    for (const [catalog, rows] of Object.entries({ REGIONAL_CRAFTING_TIERS, WILDERNESS_CRAFTING_TIERS })) {
      expect(rows).toEqual(rawTiers.filter((row) => row.catalog === catalog).map(({ catalog: _catalog, ...row }) => row));
      rows.forEach((row) => expect(row).not.toHaveProperty("catalog"));
    }
  });

  it("rejects duplicate numeric tier identities, missing references, and wrong catalog shapes", () => {
    const first = rawTiers[0]!;
    expect(() => parseCollection(CraftingTierRecordSchema, [first, first], { name: "craftingTiers", idKey: "tier" }))
      .toThrow("duplicate tier");
    expect(() => parseCollection(CraftingTierRecordSchema, [{ ...first, ore: "" }], { name: "craftingTiers", idKey: "tier" }))
      .toThrow("ore");
    expect(() => parseCollection(CraftingTierRecordSchema, [{ ...first, catalog: "WILDERNESS_CRAFTING_TIERS" }], { name: "craftingTiers", idKey: "tier" }))
      .toThrow();
  });
});
