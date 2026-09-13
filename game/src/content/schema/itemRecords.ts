import { enumOf, opt, union, type Infer } from "./core.js";
import { JewelryDerivationSchema } from "./jewelryDerivation.js";
import { ItemSchema } from "./items.js";
import { GearDerivationSchema } from "./gearDerivation.js";
import { GearProgressionDerivationSchema } from "./gearProgression.js";
import { ItemFormulaDerivationSchema } from "./itemFormula.js";
import { MaterialFoodDerivationSchema } from "./materialFoodDerivation.js";

/** Exclusive source catalogs; specific sources precede their containing aggregate views. */
export const ITEM_SOURCE_CATALOGS = [
  "CROWNWARD_FISH_ITEMS", "HIGH_TIER_LOG_ITEMS", "MAGIC_ORBS", "CRAFTED_JEWELRY",
  "ELEMENTAL_MAGIC_WEAPONS", "RARE_MINIBOSS_WEAPONS", "EQUIPMENT", "CREATURE_LOOT_ITEMS",
  "WILDERNESS_LOOT_ITEMS", "BOSS_ARMOR_ITEMS", "MINIBOSS_JEWELLERY", "REGIONAL_TIER_ITEMS", "ITEMS",
] as const;

export type ItemCatalog = typeof ITEM_SOURCE_CATALOGS[number];

/** Existing named exports are filtered views over the shared, ordered item table. */
export const ITEM_SOURCE_VIEWS: Readonly<Record<ItemCatalog, readonly ItemCatalog[]>> = {
  CROWNWARD_FISH_ITEMS: ["CROWNWARD_FISH_ITEMS"],
  HIGH_TIER_LOG_ITEMS: ["HIGH_TIER_LOG_ITEMS"],
  MAGIC_ORBS: ["MAGIC_ORBS"],
  CRAFTED_JEWELRY: ["CRAFTED_JEWELRY"],
  ELEMENTAL_MAGIC_WEAPONS: ["ELEMENTAL_MAGIC_WEAPONS"],
  RARE_MINIBOSS_WEAPONS: ["RARE_MINIBOSS_WEAPONS"],
  EQUIPMENT: ["EQUIPMENT", "CRAFTED_JEWELRY", "ELEMENTAL_MAGIC_WEAPONS", "RARE_MINIBOSS_WEAPONS"],
  CREATURE_LOOT_ITEMS: ["CREATURE_LOOT_ITEMS"],
  WILDERNESS_LOOT_ITEMS: ["WILDERNESS_LOOT_ITEMS"],
  BOSS_ARMOR_ITEMS: ["BOSS_ARMOR_ITEMS"],
  MINIBOSS_JEWELLERY: ["MINIBOSS_JEWELLERY"],
  REGIONAL_TIER_ITEMS: ["REGIONAL_TIER_ITEMS"],
  ITEMS: ["ITEMS", "CROWNWARD_FISH_ITEMS"],
};

export const ItemRecordSchema = ItemSchema.extend({
  catalog: enumOf(ITEM_SOURCE_CATALOGS, { hidden: true }),
  derivation: opt(union([GearDerivationSchema, JewelryDerivationSchema, GearProgressionDerivationSchema, ItemFormulaDerivationSchema, MaterialFoodDerivationSchema] as const), { label: "Balance derivation" }),
});

export type ItemRecord = Infer<typeof ItemRecordSchema>;
