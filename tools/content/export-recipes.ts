/** One-shot recipe migration from .baseline. No files are written unless --apply is supplied. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import recipeParameters from "../../game/content/data/balance/recipes.json";
import type { RecipeDef } from "../../game/src/content/index.js";
import { recipesBalanceSchema, type RecipesBalance } from "../../game/src/content/schema/balance.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import {
  RecipeRecordSchema, RecipeSchema, RECIPE_SOURCE_CATALOGS,
  type RecipeCatalog, type RecipeRecord,
} from "../../game/src/content/schema/recipes.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";
import { attachRecipeDerivations } from "./recipe-derivations.js";

export type RecipeSourceTables = Readonly<Record<RecipeCatalog, readonly RecipeDef[]>>;

function assertEqual(expected: readonly RecipeDef[], actual: readonly RecipeDef[], name: string): void {
  const differences: ParityDifference[] = [];
  collectDifferences(expected, actual, name, differences);
  if (differences.length) throw new Error(`Recipe source parity failed for ${name}:\n${differences.map((row) =>
    `${row.path}: expected ${row.expected}, got ${row.actual}`).join("\n")}`);
}

/** Assigns each row one source and proves that filtering reconstructs the existing exports. */
export function buildRecipeRecords(
  sources: RecipeSourceTables,
  allRecipes: readonly RecipeDef[],
  params: RecipesBalance = parseValue(recipesBalanceSchema, recipeParameters, "balance/recipes"),
): RecipeRecord[] {
  const all = canonicalRecords(RecipeSchema, allRecipes, "RECIPES");
  const allIds = new Set(all.map((row) => row.id));
  const primaryById = new Map<string, RecipeCatalog>();
  const canonicalSources = new Map<RecipeCatalog, RecipeDef[]>();
  for (const source of RECIPE_SOURCE_CATALOGS) {
    if (!Array.isArray(sources[source])) throw new Error(`Missing recipe source ${source}`);
    const rows = canonicalRecords(RecipeSchema, sources[source], source);
    canonicalSources.set(source, rows);
    for (const row of rows) {
      if (!allIds.has(row.id)) throw new Error(`${source} recipe ${row.id} is absent from RECIPES`);
      if (source === "RECIPES") continue;
      const previous = primaryById.get(row.id);
      if (previous) throw new Error(`Recipe ${row.id} overlaps leaf sources ${previous} and ${source}`);
      primaryById.set(row.id, source);
    }
  }
  assertEqual(all, canonicalSources.get("RECIPES")!, "RECIPES");
  const records = canonicalRecords(RecipeRecordSchema,
    all.map((row) => ({ ...row, catalog: primaryById.get(row.id) ?? "RECIPES" })), "recipes");
  for (const source of RECIPE_SOURCE_CATALOGS) {
    const actual = records.filter((row) => source === "RECIPES" || row.catalog === source)
      .map(({ catalog: _catalog, derivation: _derivation, ...row }) => row);
    assertEqual(canonicalSources.get(source)!, actual, source);
  }
  return attachRecipeDerivations(records, params);
}

const modules: Readonly<Record<RecipeCatalog, string>> = {
  RECIPES: "recipes", JEWELRY_RECIPES: "jewelry", CREATURE_LOOT_RECIPES: "creatureLoot",
  WILDERNESS_LOOT_RECIPES: "wildernessLoot", CROWNWARD_FISH_RECIPES: "crownwardFishing",
  REGIONAL_TIER_RECIPES: "regionalTierEquipment",
};

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  const entries = await Promise.all(RECIPE_SOURCE_CATALOGS.map(async (source) => {
    const file = path.join(repoRoot, ".baseline", "game", "src", "content", `${modules[source]}.ts`);
    const module = await import(pathToFileURL(file).href) as Record<string, unknown>;
    return [source, module[source]] as const;
  }));
  // The builder validates every imported value before any file can be written.
  const sources = Object.fromEntries(entries) as RecipeSourceTables;
  const records = buildRecipeRecords(sources, sources.RECIPES);
  console.log(`Validated ${records.length} baseline recipes and ${RECIPE_SOURCE_CATALOGS.length} source views.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/recipes.json", records);
    console.log(changed ? "Wrote game/content/data/recipes.json" : "game/content/data/recipes.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to replace game/content/data/recipes.json with baseline records.");
  }
}
