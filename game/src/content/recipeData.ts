import rawRecipes from "../../content/data/recipes.json";
import type { RecipeDef } from "./index.js";
import { parseCollection } from "./schema/core.js";
import { RecipeRecordSchema, type RecipeCatalog, type RecipeRecord } from "./schema/recipes.js";

/** All recipe exports share these parsed rows and their nested ingredient/output objects. */
export const RECIPE_RECORDS: readonly RecipeRecord[] = parseCollection(RecipeRecordSchema, rawRecipes, { name: "recipes" });
export const RECIPE_DATA: readonly RecipeDef[] = RECIPE_RECORDS.map(({ catalog: _catalog, derivation: _derivation, ...recipe }) => recipe);

export function recipeRows(catalog: RecipeCatalog | readonly RecipeCatalog[]): readonly RecipeDef[] {
  const selected = new Set<RecipeCatalog>(typeof catalog === "string" ? [catalog] : catalog);
  return RECIPE_DATA.filter((_recipe, index) => selected.has(RECIPE_RECORDS[index]!.catalog));
}
