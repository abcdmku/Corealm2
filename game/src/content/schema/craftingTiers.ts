import { discriminated, lit, obj, ref, str, union, type Infer } from "./core.js";

const name = str({ nonEmpty: true });
const family = str({ nonEmpty: true }, { help: "Saved item-id prefix for this material family." });
const art = str({ nonEmpty: true }, { multiline: true });
const tierMeta = { label: "Tier", readOnly: true, identity: true, step: 1 };

export const RegionalCraftingTierSchema = obj({
  tier: union([lit(30), lit(40), lit(60)] as const, tierMeta),
  metal: family, metalName: name, ore: ref("item"), wood: family, woodName: name,
  hide: ref("item"), hideName: name, thread: ref("item"), threadName: name,
  metalArt: art, clothArt: art, woodArt: art,
});

export const WildernessCraftingTierSchema = obj({
  tier: union([lit(50), lit(70)] as const, tierMeta),
  metal: family, metalName: name, ore: ref("item"), wood: family, woodName: name,
  hide: ref("item"), hideName: name, thread: ref("item"), flux: ref("item"),
  jewellery: family, gem: ref("item"),
});

export const CRAFTING_TIER_CATALOGS = ["REGIONAL_CRAFTING_TIERS", "WILDERNESS_CRAFTING_TIERS"] as const;
export type CraftingTierCatalog = typeof CRAFTING_TIER_CATALOGS[number];

export const CraftingTierRecordSchema = discriminated("catalog", {
  REGIONAL_CRAFTING_TIERS: RegionalCraftingTierSchema.extend({ catalog: lit("REGIONAL_CRAFTING_TIERS", { hidden: true }) }),
  WILDERNESS_CRAFTING_TIERS: WildernessCraftingTierSchema.extend({ catalog: lit("WILDERNESS_CRAFTING_TIERS", { hidden: true }) }),
});

export type RegionalCraftingTier = Infer<typeof RegionalCraftingTierSchema>;
export type WildernessCraftingTier = Infer<typeof WildernessCraftingTierSchema>;
export type CraftingTierRecord = Infer<typeof CraftingTierRecordSchema>;
