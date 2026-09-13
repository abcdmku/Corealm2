/** One-shot export from the pre-migration baseline, never from the JSON-backed loaders. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { npcRecordSchema, shopSchema } from "../../game/src/content/schema/people.js";

function applyRequested(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

export async function buildPeopleExport(): Promise<{
  shops: unknown[];
  npcs: unknown[];
}> {
  const baseline = (name: string) => import(pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href);
  const [shops, npcs, fairy] = await Promise.all([baseline("shops"), baseline("npcs"), baseline("fairyNpcs")]);
  if (!Array.isArray(shops.SHOPS)) throw new Error("Baseline shops module does not export SHOPS");
  if (!Array.isArray(npcs.NPCS)) throw new Error("Baseline npcs module does not export NPCS");
  if (!Array.isArray(fairy.FAIRY_NPC_CANDIDATES)) throw new Error("Baseline fairy module does not export FAIRY_NPC_CANDIDATES");
  const fairyIds = new Set(fairy.FAIRY_NPC_CANDIDATES.map((row: { id: string }) => row.id));
  const npcRecords = npcs.NPCS.map((row: { id: string }) => ({ ...row, catalog: fairyIds.has(row.id) ? "fairy" : "base" }));
  return {
    shops: canonicalRecords(shopSchema, shops.SHOPS, "shops"),
    npcs: canonicalRecords(npcRecordSchema, npcRecords, "npcs"),
  };
}

export async function runPeopleExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = applyRequested(args);
  const records = await buildPeopleExport();
  console.log(`Validated ${records.shops.length} shops and ${records.npcs.length} NPCs from .baseline.`);
  if (!apply) {
    console.log("Dry run: no files written. Pass --apply to replace shops.json and npcs.json.");
    return;
  }
  const [shopsChanged, npcsChanged] = await Promise.all([
    writeContentJson("data/shops.json", records.shops),
    writeContentJson("data/npcs.json", records.npcs),
  ]);
  console.log(`Applied people export (${shopsChanged || npcsChanged ? "files changed" : "files already matched"}).`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runPeopleExport();
}
