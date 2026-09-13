/** One-shot gathering tier migration. Dry run validates the baseline; --apply writes the JSON table. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GatheringProductionTierDef } from "../../game/src/content/index.js";
import { GatheringTierSchema, type GatheringTierRecord } from "../../game/src/content/schema/gatheringTiers.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";

/** Replace duplicated nested rows with ordered references to shared collections. */
export function buildGatheringTierRecords(
  tiers: readonly GatheringProductionTierDef[],
): GatheringTierRecord[] {
  const records = tiers.map(({ resourceDefs, campfire, ...tier }): GatheringTierRecord => ({
    ...tier,
    resourceDefIds: resourceDefs.map((resource) => resource.id),
    campfireFuelId: campfire.logItemId,
  }));
  return canonicalRecords(GatheringTierSchema, records, "gatheringTiers", "tier");
}

/** Baseline imports are deferred so importing the pure record builder never reads .baseline. */
async function baselineGatheringTiers(): Promise<GatheringTierRecord[]> {
  const file = path.join(repoRoot, ".baseline", "game", "src", "content", "gatheringProductionTiers.ts");
  const module = await import(pathToFileURL(file).href) as Record<string, unknown>;
  const tiers = module.GATHERING_PRODUCTION_TIERS;
  if (!Array.isArray(tiers)) throw new Error("Baseline gathering module does not export GATHERING_PRODUCTION_TIERS");
  return buildGatheringTierRecords(tiers as GatheringProductionTierDef[]);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  const records = await baselineGatheringTiers();
  console.log(`Validated ${records.length} baseline gathering tiers.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/gatheringTiers.json", records);
    console.log(changed ? "Wrote game/content/data/gatheringTiers.json" : "game/content/data/gatheringTiers.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to write game/content/data/gatheringTiers.json.");
  }
}
