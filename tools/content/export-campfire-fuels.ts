/** One-shot campfire fuel migration. Dry run validates the baseline; --apply writes the JSON table. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import campfireParameters from "../../game/content/data/balance/campfires.json";
import recipeParameters from "../../game/content/data/balance/recipes.json";
import type { CampfireFuelDef } from "../../game/src/content/index.js";
import { campfireFuel } from "../../game/src/content/balance/campfires.js";
import type { CampfiresBalance, RecipesBalance } from "../../game/src/content/schema/balance.js";
import { campfiresBalanceSchema, recipesBalanceSchema } from "../../game/src/content/schema/balance.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import {
  CampfireFuelRecordSchema, CampfireFuelSchema,
  type CampfireFuelRecord,
} from "../../game/src/content/schema/campfireFuels.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

const DEFAULT_CAMPFIRES = parseValue(campfiresBalanceSchema, campfireParameters, "balance/campfires");
const DEFAULT_RECIPES = parseValue(recipesBalanceSchema, recipeParameters, "balance/recipes");

function assertDerivedFields(source: CampfireFuelDef, derived: CampfireFuelDef): void {
  const expected = {
    buildTimeMs: derived.buildTimeMs,
    lifetimeMs: derived.lifetimeMs,
    buildXp: derived.buildXp,
  };
  const actual = {
    buildTimeMs: source.buildTimeMs,
    lifetimeMs: source.lifetimeMs,
    buildXp: source.buildXp,
  };
  const differences: ParityDifference[] = [];
  collectDifferences(expected, actual, source.logItemId, differences);
  if (differences.length > 0) {
    throw new Error(`Cannot tag drifted campfire fuel ${source.logItemId}: ${JSON.stringify(differences)}`);
  }
}

/** Attach the derivation marker after validating every source row against the balance formulas. */
export function buildCampfireFuelRecords(
  fuels: readonly CampfireFuelDef[],
  params: CampfiresBalance = DEFAULT_CAMPFIRES,
  recipes: RecipesBalance = DEFAULT_RECIPES,
): CampfireFuelRecord[] {
  const source = canonicalRecords(CampfireFuelSchema, fuels, "CAMPFIRE_FUELS", "logItemId");
  const tagged = source.map((fuel): CampfireFuelRecord => {
    const derived = campfireFuel(params, recipes, {
      logItemId: fuel.logItemId,
      tier: fuel.tier,
      visualLogAssetId: fuel.visualLogAssetId,
    });
    assertDerivedFields(fuel, derived);
    return { ...fuel, derivation: { kind: "campfireFuel" } };
  });
  return canonicalRecords(CampfireFuelRecordSchema, tagged, "campfireFuels", "logItemId");
}

/** Baseline imports are deferred so importing the pure builder never reads .baseline. */
export async function baselineCampfireFuels(): Promise<CampfireFuelRecord[]> {
  const file = path.join(repoRoot, ".baseline", "game", "src", "content", "gatheringProductionTiers.ts");
  const module = await import(pathToFileURL(file).href) as Record<string, unknown>;
  const fuels = module.CAMPFIRE_FUELS;
  if (!Array.isArray(fuels)) throw new Error("Baseline gathering module does not export CAMPFIRE_FUELS");
  return buildCampfireFuelRecords(fuels as CampfireFuelDef[]);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  const records = await baselineCampfireFuels();
  console.log(`Validated ${records.length} baseline campfire fuels.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/campfireFuels.json", records);
    console.log(changed ? "Wrote game/content/data/campfireFuels.json" : "game/content/data/campfireFuels.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to write game/content/data/campfireFuels.json.");
  }
}
