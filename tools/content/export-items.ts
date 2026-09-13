/** One-shot item migration. Dry run validates the baseline; --apply replaces data/items.json. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ItemDef } from "../../game/src/contracts.js";
import gearParameters from "../../game/content/data/balance/gear.json";
import jewelryParameters from "../../game/content/data/balance/jewelry.json";
import progressionParameters from "../../game/content/data/balance/gearProgression.json";
import itemFormulaParameters from "../../game/content/data/balance/itemFormula.json";
import materialFoodParameters from "../../game/content/data/balance/materialFood.json";
import lootParameters from "../../game/content/data/balance/loot.json";
import { lootBalanceSchema } from "../../game/src/content/schema/balance.js";
import { MaterialFoodBalanceSchema } from "../../game/src/content/schema/materialFoodDerivation.js";
import { attachMaterialFoodDerivations } from "./material-food-derivations.js";
import { ItemFormulaBalanceSchema } from "../../game/src/content/schema/itemFormula.js";
import { buildItemFormulaTags } from "./item-formula-derivations.js";
import recipesParameters from "../../game/content/data/balance/recipes.json";
import craftingTierRecords from "../../game/content/data/craftingTiers.json";
import { GearProgressionBalanceSchema } from "../../game/src/content/schema/gearProgression.js";
import { CraftingTierRecordSchema } from "../../game/src/content/schema/craftingTiers.js";
import { recipesBalanceSchema } from "../../game/src/content/schema/balance.js";
import { buildGearProgressionTags } from "./gear-progression-derivations.js";
import { gearBalanceSchema, jewelryBalanceSchema } from "../../game/src/content/schema/balance.js";
import { attachJewelryDerivations } from "./jewelry-derivations.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { ItemSchema } from "../../game/src/content/schema/items.js";
import {
  ItemRecordSchema, ITEM_SOURCE_CATALOGS as ITEM_SOURCE_NAMES, ITEM_SOURCE_VIEWS as ITEM_SOURCE_CATALOGS,
  type ItemCatalog, type ItemRecord,
} from "../../game/src/content/schema/itemRecords.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";
import { attachGearDerivations } from "./gear-derivations.js";

export { ITEM_SOURCE_NAMES, ITEM_SOURCE_CATALOGS };
export type { ItemCatalog, ItemRecord };
export type ItemSourceTables = Readonly<Record<ItemCatalog, readonly ItemDef[]>>;

/** A filtered view preserves the global row order; it never sorts or concatenates catalogs. */
export function itemSourceView(records: readonly ItemRecord[], source: ItemCatalog): ItemDef[] {
  const catalogs = ITEM_SOURCE_CATALOGS[source];
  return records.filter((row) => catalogs.includes(row.catalog)).map(({ catalog: _catalog, derivation: _derivation, ...item }) => item);
}

function assertEqual(expected: readonly ItemDef[], actual: readonly ItemDef[], name: string): void {
  const differences: ParityDifference[] = [];
  collectDifferences(expected, actual, name, differences);
  if (differences.length > 0) {
    throw new Error(`Item source parity failed for ${name}:\n${differences.map((difference) =>
      `${difference.path}: expected ${difference.expected}, got ${difference.actual}`).join("\n")}`);
  }
}

/** Validates all source memberships and values before producing any writable records. */
export function buildItemRecords(namedSourceTables: ItemSourceTables, allItems: readonly ItemDef[]): ItemRecord[] {
  const all = canonicalRecords(ItemSchema, allItems, "ALL_ITEMS");
  const sources = new Map<ItemCatalog, ItemDef[]>();
  const memberships = new Map<string, ItemCatalog[]>();
  const allIds = new Set(all.map((item) => item.id));
  for (const source of ITEM_SOURCE_NAMES) {
    const rows = namedSourceTables[source];
    if (!Array.isArray(rows)) throw new Error(`Missing item source ${source}`);
    const canonical = canonicalRecords(ItemSchema, rows, source);
    sources.set(source, canonical);
    for (const item of canonical) {
      if (!allIds.has(item.id)) throw new Error(`${source} item ${item.id} is absent from ALL_ITEMS`);
      const names = memberships.get(item.id) ?? [];
      names.push(source);
      memberships.set(item.id, names);
    }
  }
  const records = all.map((item): ItemRecord => {
    const names = memberships.get(item.id);
    const catalog = names?.[0];
    if (!catalog) throw new Error(`ALL_ITEMS item ${item.id} has no named source`);
    for (const source of names!) {
      if (!ITEM_SOURCE_CATALOGS[source].includes(catalog)) {
        throw new Error(`Item ${item.id} overlaps unrelated sources ${names!.join(", ")}`);
      }
    }
    return { ...item, catalog };
  });
  const canonical = canonicalRecords(ItemRecordSchema, records, "items");
  assertEqual(all, canonical.map(({ catalog: _catalog, derivation: _derivation, ...item }) => item), "ALL_ITEMS");
  for (const source of ITEM_SOURCE_NAMES) {
    assertEqual(sources.get(source)!, itemSourceView(canonical, source), source);
  }
  return canonical;
}

const sourceModules: Readonly<Record<ItemCatalog, string>> = {
  CROWNWARD_FISH_ITEMS: "crownwardFishing", HIGH_TIER_LOG_ITEMS: "treeSpecies", MAGIC_ORBS: "equipment",
  CRAFTED_JEWELRY: "jewelry", ELEMENTAL_MAGIC_WEAPONS: "equipment", RARE_MINIBOSS_WEAPONS: "equipment",
  EQUIPMENT: "equipment", CREATURE_LOOT_ITEMS: "creatureLoot", WILDERNESS_LOOT_ITEMS: "wildernessLoot",
  BOSS_ARMOR_ITEMS: "bossArmor", MINIBOSS_JEWELLERY: "universalMinibossLoot",
  REGIONAL_TIER_ITEMS: "regionalTierEquipment", ITEMS: "items",
};

/** Baseline imports are deferred so importing the pure builder never reads .baseline. */
async function baselineItems(): Promise<ItemRecord[]> {
  const names = [...new Set(Object.values(sourceModules))];
  const modules = new Map(await Promise.all(names.map(async (name) => {
    const file = path.join(repoRoot, ".baseline", "game", "src", "content", `${name}.ts`);
    return [name, await import(pathToFileURL(file).href) as Record<string, unknown>] as const;
  })));
  const sources = Object.fromEntries(ITEM_SOURCE_NAMES.map((name) => [name, modules.get(sourceModules[name])?.[name]]));
  const all = modules.get("items")?.ALL_ITEMS;
  if (!Array.isArray(all)) throw new Error("Baseline items module does not export ALL_ITEMS");
  // The builder validates every array and nested field before these unknown module exports are used.
  const gearRecords = attachGearDerivations(buildItemRecords(sources as ItemSourceTables, all as ItemDef[]),
    parseValue(gearBalanceSchema, gearParameters, "balance/gear"));
  const records = attachJewelryDerivations(gearRecords, parseValue(jewelryBalanceSchema, jewelryParameters, "balance/jewelry"));
  const proposals = buildGearProgressionTags(parseValue(GearProgressionBalanceSchema, progressionParameters, "balance/gearProgression"),
    parseValue(recipesBalanceSchema, recipesParameters, "balance/recipes"), canonicalRecords(CraftingTierRecordSchema, craftingTierRecords, "craftingTiers", "tier"), records);
  const tags = new Map(proposals.map(proposal => [proposal.itemId, proposal.derivation]));
  const progressionRecords = records.map(row => tags.has(row.id) ? { ...row, derivation: tags.get(row.id)! } : row);
  const itemTags = new Map(buildItemFormulaTags(parseValue(ItemFormulaBalanceSchema, itemFormulaParameters, "balance/itemFormula"), parseValue(recipesBalanceSchema, recipesParameters, "balance/recipes"), parseValue(gearBalanceSchema, gearParameters, "balance/gear"), progressionRecords).map(proposal => [proposal.itemId, proposal.derivation]));
  const formulaRecords = progressionRecords.map(row => itemTags.has(row.id) ? { ...row, derivation: itemTags.get(row.id)! } : row);
  return canonicalRecords(ItemRecordSchema, attachMaterialFoodDerivations(formulaRecords, parseValue(MaterialFoodBalanceSchema, materialFoodParameters, "balance/materialFood"), parseValue(recipesBalanceSchema, recipesParameters, "balance/recipes"), parseValue(lootBalanceSchema, lootParameters, "balance/loot")), "items");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  const records = await baselineItems();
  console.log(`Validated ${records.length} baseline items and ${ITEM_SOURCE_NAMES.length} source views.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/items.json", records);
    console.log(changed ? "Wrote game/content/data/items.json" : "game/content/data/items.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to replace game/content/data/items.json with baseline records.");
  }
}
