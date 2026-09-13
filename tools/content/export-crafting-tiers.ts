/** Export the authored regional and wilderness crafting ladders without changing their views. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CraftingTierRecordSchema } from "../../game/src/content/schema/craftingTiers.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(" ")}`);
  const [regional, wilderness] = await Promise.all(["regionalTierEquipment", "wildernessLoot"].map((name) =>
    import(pathToFileURL(path.join(repoRoot, ".baseline", "game", "src", "content", `${name}.ts`)).href)));
  const sources = {
    REGIONAL_CRAFTING_TIERS: regional!.REGIONAL_CRAFTING_TIERS as readonly Record<string, unknown>[],
    WILDERNESS_CRAFTING_TIERS: wilderness!.WILDERNESS_CRAFTING_TIERS as readonly Record<string, unknown>[],
  };
  const records = canonicalRecords(CraftingTierRecordSchema, Object.entries(sources)
    .flatMap(([catalog, rows]) => rows.map((row) => ({ ...row, catalog }))), "craftingTiers", "tier")
    .sort((a, b) => a.tier - b.tier);
  for (const [catalog, expected] of Object.entries(sources)) {
    const actual = records.filter((row) => row.catalog === catalog).map(({ catalog: _catalog, ...row }) => row);
    const differences: ParityDifference[] = [];
    collectDifferences(expected, actual, catalog, differences);
    if (differences.length) throw new Error(`Crafting tier parity failed: ${JSON.stringify(differences)}`);
  }
  console.log(`Validated ${records.length} crafting tiers and both source views.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/craftingTiers.json", records);
    console.log(changed ? "Wrote game/content/data/craftingTiers.json" : "Crafting tiers already match");
  } else console.log("Dry run: no files written. Pass --apply to replace craftingTiers.json from .baseline.");
}
