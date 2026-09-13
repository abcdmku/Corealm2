/** One-shot export from the pre-migration baseline, never from the JSON-backed loaders. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { npcRecordSchema, shopSchema } from "../../game/src/content/schema/people.js";

const baseline = (name: string) => import(pathToFileURL(path.join(repoRoot, ".baseline/game/src/content", `${name}.ts`)).href);
const [shops, npcs, fairy] = await Promise.all([baseline("shops"), baseline("npcs"), baseline("fairyNpcs")]);
const fairyIds = new Set(fairy.FAIRY_NPC_CANDIDATES.map((row: { id: string }) => row.id));
const npcRecords = npcs.NPCS.map((row: { id: string }) => ({ ...row, catalog: fairyIds.has(row.id) ? "fairy" : "base" }));
await writeContentJson("data/shops.json", canonicalRecords(shopSchema, shops.SHOPS, "shops"));
await writeContentJson("data/npcs.json", canonicalRecords(npcRecordSchema, npcRecords, "npcs"));
console.log(`Exported ${shops.SHOPS.length} shops and ${npcRecords.length} NPCs.`);
