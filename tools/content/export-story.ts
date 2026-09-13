/** One-shot M1 export from the pre-migration TypeScript snapshot. */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { questSchema, dialogueRecordSchema } from "../../game/src/content/schema/story.js";

function applyRequested(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

export async function buildStoryExport(): Promise<{
  quests: unknown[];
  dialogue: unknown[];
}> {
  const baseline = (name: string) => pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href;
  const [{ QUESTS }, { DIALOGUE_NODES }, { FAIRY_NPC_DIALOGUE }] = await Promise.all([
    import(baseline("quests")), import(baseline("dialogue")), import(baseline("fairyNpcs")),
  ]);
  if (!Array.isArray(QUESTS)) throw new Error("Baseline quests module does not export QUESTS");
  if (!Array.isArray(DIALOGUE_NODES)) throw new Error("Baseline dialogue module does not export DIALOGUE_NODES");
  if (!Array.isArray(FAIRY_NPC_DIALOGUE)) throw new Error("Baseline fairy module does not export FAIRY_NPC_DIALOGUE");
  const fairyIds = new Set(FAIRY_NPC_DIALOGUE.map((row: { id: string }) => row.id));
  return {
    quests: canonicalRecords(questSchema, QUESTS, "quests"),
    dialogue: canonicalRecords(dialogueRecordSchema, DIALOGUE_NODES.map((row: { id: string }) => ({
      ...row, catalog: fairyIds.has(row.id) ? "fairy" : "base",
    })), "dialogue"),
  };
}

export async function runStoryExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = applyRequested(args);
  const records = await buildStoryExport();
  console.log(`Validated ${records.quests.length} quests and ${records.dialogue.length} dialogue nodes from .baseline.`);
  if (!apply) {
    console.log("Dry run: no files written. Pass --apply to replace quests.json and dialogue.json.");
    return;
  }
  const [questsChanged, dialogueChanged] = await Promise.all([
    writeContentJson("data/quests.json", records.quests),
    writeContentJson("data/dialogue.json", records.dialogue),
  ]);
  console.log(`Applied story export (${questsChanged || dialogueChanged ? "files changed" : "files already matched"}).`);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runStoryExport();
}
