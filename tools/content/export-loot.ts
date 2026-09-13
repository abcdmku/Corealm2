/** One-shot loot migration. Dry run validates the baseline; --apply replaces data/lootTables.json. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildM4Baseline } from "./m4-baseline.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { LootTableSchema, type LootTableRecord } from "../../game/src/content/schema/loot.js";

/** Rebuilds the canonical loot rows from the immutable M4 baseline. */
export async function buildLootRecords(): Promise<LootTableRecord[]> {
  const baseline = await buildM4Baseline();
  return canonicalRecords(LootTableSchema, baseline.records.lootTables, "lootTables");
}

function parseApply(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

/** Validates by default and writes only when --apply is passed. */
export async function runLootExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = parseApply(args);
  const records = await buildLootRecords();
  console.log(`Validated ${records.length} baseline loot tables.`);
  if (apply) {
    const changed = await writeContentJson("data/lootTables.json", records);
    console.log(changed ? "Wrote game/content/data/lootTables.json" : "game/content/data/lootTables.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to replace game/content/data/lootTables.json with baseline records.");
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runLootExport();
}
