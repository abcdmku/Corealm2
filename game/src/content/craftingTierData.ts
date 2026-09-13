import rawTiers from "../../content/data/craftingTiers.json";
import { parseCollection } from "./schema/core.js";
import { CraftingTierRecordSchema, type CraftingTierRecord } from "./schema/craftingTiers.js";

export const CRAFTING_TIER_RECORDS: readonly CraftingTierRecord[] = parseCollection(
  CraftingTierRecordSchema, rawTiers, { name: "craftingTiers", idKey: "tier" },
);
export const REGIONAL_CRAFTING_TIER_DATA = CRAFTING_TIER_RECORDS
  .filter((row) => row.catalog === "REGIONAL_CRAFTING_TIERS")
  .map(({ catalog: _catalog, ...row }) => row);
export const WILDERNESS_CRAFTING_TIER_DATA = CRAFTING_TIER_RECORDS
  .filter((row) => row.catalog === "WILDERNESS_CRAFTING_TIERS")
  .map(({ catalog: _catalog, ...row }) => row);
