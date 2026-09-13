import type { RecipeDef } from "../../game/src/content/index.js";
import type { RecipesBalance } from "../../game/src/content/schema/balance.js";
import {
  RecipeDerivationSchema,
  type RecipeDerivation,
  type RecipeWeightKey,
} from "../../game/src/content/schema/recipeDerivation.js";
import { RecipeRecordSchema, type RecipeCatalog, type RecipeRecord } from "../../game/src/content/schema/recipes.js";
import { canonicalRecords } from "./format.js";
import jewelryParameters from "../../game/content/data/balance/jewelry.json";
import { jewelryBalanceSchema, type JewelryBalance } from "../../game/src/content/schema/balance.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { jewelryRecipe } from "../../game/src/content/balance/jewelry.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

import { recipeCraftWeight, recipeXpFromDerivation, recipeFieldsFromDerivation } from "../../game/src/content/balance/recipes.js";
export { recipeCraftWeight, recipeXpFromDerivation } from "../../game/src/content/balance/recipes.js";

const byWeightKey = (weightKey: RecipeWeightKey): RecipeDerivation => ({ kind: "recipeXp", weightKey });
const byLiteralWeight = (craftWeight: number): RecipeDerivation => ({ kind: "recipeXp", craftWeight });

/**
 * These mappings preserve the calls in the baseline generators. They intentionally inspect the
 * authored recipe role and output suffix; they never recover a weight by solving from `xp`.
 *
 * `recipes.ts` uses the named W entries for the 102-row base ladder. The small hide pieces and
 * magic leggings reuse `helmBootsGloves` and `leatherBody`, respectively, exactly as the source
 * comments document. Regional and Wilderness tier builders repeat the same W roles. The three
 * regional thread rows use their source literal `.8`, which has no named craft role.
 */
function generatedRecipeDerivation(row: RecipeDef): RecipeDerivation | undefined {
  if (!row.id.startsWith(`${row.kind}_`)) return undefined;
  const output = row.output.itemId;
  const endsWith = (suffix: string): boolean => output.endsWith(suffix);

  if (row.kind === "smelt") return endsWith("_bar") ? byWeightKey("smeltBar") : undefined;
  if (row.kind === "cook") return byWeightKey("cookedFood");

  if (row.kind === "smith") {
    if (endsWith("_dagger")) return byWeightKey("dagger");
    if (endsWith("_sword")) return byWeightKey("sword");
    if (endsWith("_body") || endsWith("_cuirass") || endsWith("_plate") || endsWith("_legs") || endsWith("_greaves")) {
      return byWeightKey("bodyOrLegs");
    }
    if (endsWith("_helm") || endsWith("_boots") || endsWith("_gloves") || endsWith("_gauntlets")) {
      return byWeightKey("helmBootsGloves");
    }
    if (endsWith("_pickaxe") || endsWith("_hatchet")) return byWeightKey("toolHead");
    return undefined;
  }

  if (row.kind === "craft") {
    if (endsWith("_wand")) return byWeightKey("wand");
    if (endsWith("_staff")) return byWeightKey("staff");
    if (endsWith("_robe") || endsWith("_leggings")) return byWeightKey("leatherBody");
    if (endsWith("_hood") || endsWith("_boots") || endsWith("_wraps")) return byWeightKey("helmBootsGloves");
    if (endsWith("_thread")) return byLiteralWeight(0.8);
    return undefined;
  }

  if (row.kind === "fletch") {
    if (endsWith("_shaft") || endsWith("_handle")) return byWeightKey("toolHandle");
    if (endsWith("_staff")) return byWeightKey("staff");
    if (endsWith("_wand")) return byWeightKey("wand");
    if (endsWith("_shield")) return byWeightKey("woodenShield");
    if (endsWith("_rod")) return byWeightKey("fishingRod");
  }
  return undefined;
}

/** Explicit creature source calls whose role or weight is not represented by a generated suffix. */
const CREATURE_RECIPE_DERIVATIONS: Readonly<Record<string, RecipeDerivation>> = {
  // creatureLoot.ts recipe(..., 4): large hide pieces use the leather-body role.
  creature_badger_bristle: byWeightKey("leatherBody"),
  creature_bighorn_fleece: byWeightKey("leatherBody"),
  creature_goose_down: byWeightKey("leatherBody"),
  creature_bustard_plume: byWeightKey("leatherBody"),
  creature_spider_thread: byWeightKey("leatherBody"),
  // creatureLoot.ts recipe(..., 2.5): small hide pieces use the helm/boots/gloves role.
  creature_crocodile_scute: byWeightKey("helmBootsGloves"),
  creature_nightmare_plate: byWeightKey("helmBootsGloves"),
  // creatureLoot.ts recipe(..., 1.8), 2.8, 2.2, 2 and .8 match their named production roles.
  creature_horse_tailhair: byWeightKey("fishingRod"),
  creature_monitor_sinew: byWeightKey("fishingRod"),
  creature_tortoise_shell_plate: byWeightKey("woodenShield"),
  creature_snail_mucus: byWeightKey("woodenShield"),
  creature_beetle_mandible: byWeightKey("toolHead"),
  creature_ravager_talon: byWeightKey("dagger"),
  creature_salamander_secretion: byWeightKey("smeltBar"),
  // The source calls these direct craft literals with no matching craft role.
  creature_tapir_leather: byLiteralWeight(1),
  creature_drake_scale: byLiteralWeight(1),
};

/** Special Wilderness outputs are authored calls with a standard W role but no suffix role. */
const WILDERNESS_SPECIAL_DERIVATIONS: Readonly<Record<string, RecipeDerivation>> = {
  smith_ashseal_guard: byWeightKey("woodenShield"),
  fletch_regent_staff: byWeightKey("staff"),
  smith_chainbound_sword: byWeightKey("sword"),
  smith_nightmarshal_plate: byWeightKey("bodyOrLegs"),
  fletch_hollowstar_staff: byWeightKey("staff"),
};

/**
 * Returns the provenance tag for a known baseline row. `undefined` is allowed for fixture rows in
 * exporter unit tests and for future catalogs whose source has not yet supplied an exact call.
 */
export function recipeDerivationFor(catalog: RecipeCatalog, row: RecipeDef): RecipeDerivation | undefined {
  if (catalog === "JEWELRY_RECIPES") {
    if (!/^craft_crafted_(ring|earring)_t\d+$/.test(row.id)) return undefined;
    // jewelry.ts passes the literal 3; amuletOrRing is the named W entry with that exact value.
    return byWeightKey("amuletOrRing");
  }
  if (catalog === "CROWNWARD_FISH_RECIPES") {
    if (!row.id.startsWith("cook_")) return undefined;
    // crownwardFishing.ts passes the literal 1.5 for each cooked fish row.
    return byWeightKey("cookedFood");
  }
  if (catalog === "CREATURE_LOOT_RECIPES") return CREATURE_RECIPE_DERIVATIONS[row.id];
  if (catalog === "WILDERNESS_LOOT_RECIPES") {
    return WILDERNESS_SPECIAL_DERIVATIONS[row.id] ?? generatedRecipeDerivation(row);
  }
  if (catalog === "RECIPES" || catalog === "REGIONAL_TIER_RECIPES") return generatedRecipeDerivation(row);
  return undefined;
}

/** Tags source-backed rows and refuses to hide an XP drift under a derivation marker. */
export function attachRecipeDerivations(records: readonly RecipeRecord[], params: RecipesBalance, jewelryParams: JewelryBalance = parseValue(jewelryBalanceSchema, jewelryParameters, "balance/jewelry")): RecipeRecord[] {
  const tagged = records.map((record): RecipeRecord => {
    const identity = /^craft_crafted_(ring|earring)_t([1-9]\d*)$/.exec(record.id);
    if (record.catalog === "JEWELRY_RECIPES" && identity) {
      const derivation = { kind: "jewelryRecipe", tier: Number(identity[2]), shape: identity[1] as "ring" | "earring" } as const;
      const expected = jewelryRecipe(jewelryParams, params, derivation);
      const actual = Object.fromEntries(Object.keys(expected).map(key => [key, record[key as keyof RecipeRecord]]));
      const differences: ParityDifference[] = [];
      collectDifferences(expected, actual, record.id, differences);
      if (differences.length) throw new Error(`Cannot tag drifted jewelry recipe ${record.id}: ${JSON.stringify(differences)}`);
      return { ...record, derivation };
    }
    const derivation = recipeDerivationFor(record.catalog, record);
    if (!derivation) return record;
    const expectedXp = recipeXpFromDerivation(params, record, derivation);
    if (expectedXp !== record.xp) {
      throw new Error(`Cannot tag drifted recipe ${record.id}: expected XP ${expectedXp}, got ${record.xp}`);
    }
    const fields = recipeFieldsFromDerivation(params, record, derivation);
    if (fields.durationMs !== undefined && fields.durationMs !== record.durationMs) throw new Error(`Cannot tag drifted recipe ${record.id}: duration disagrees with its craft weight table`);
    return { ...record, derivation };
  });
  return canonicalRecords(RecipeRecordSchema, tagged, "recipes");
}

/** Ensures the exported tag itself remains strict when this helper is used outside the loader. */
export function parseRecipeDerivation(value: unknown): RecipeDerivation {
  return parseValue(RecipeDerivationSchema, value, "recipe.derivation");
}

// Keep the schema import live in this tool's public surface for callers that validate tags directly.
export { RecipeDerivationSchema };
