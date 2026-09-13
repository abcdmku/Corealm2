/** One-shot M1 export from the pre-migration TypeScript snapshot. */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { questSchema, dialogueRecordSchema } from "../../game/src/content/schema/story.js";

const baseline = (name: string) => pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href;
const [{ QUESTS }, { DIALOGUE_NODES }, { FAIRY_NPC_DIALOGUE }] = await Promise.all([
  import(baseline("quests")), import(baseline("dialogue")), import(baseline("fairyNpcs")),
]);
const fairyIds = new Set(FAIRY_NPC_DIALOGUE.map((row: { id: string }) => row.id));
await writeContentJson("data/quests.json", canonicalRecords(questSchema, QUESTS, "quests"));
await writeContentJson("data/dialogue.json", canonicalRecords(dialogueRecordSchema, DIALOGUE_NODES.map((row: { id: string }) => ({
  ...row, catalog: fairyIds.has(row.id) ? "fairy" : "base",
})), "dialogue"));
console.log(`Exported ${QUESTS.length} quests and ${DIALOGUE_NODES.length} dialogue nodes.`);
