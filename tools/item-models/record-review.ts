import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [author, itemId, round, decision] = process.argv.slice(2);
if (!author || !itemId || !round || ![author, itemId, round].every(value => /^[a-z0-9_-]+$/.test(value))
  || !["visual-approved", "rejected"].includes(decision ?? "")) throw new Error("Usage: record-review <author> <item> <round> <visual-approved|rejected>");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(await readFile(`art/item-models/candidates/${author}/catalogue.json`, "utf8"));
const entry = catalog.assets.find((entry: any) => entry.itemId === itemId);
const evidence = `test-results/item-models/${round}/report.json`;
const report = JSON.parse(await readFile(evidence, "utf8"));
if (!entry || !report.passed || !report.assets?.some((asset: any) => asset.itemId === itemId && asset.sha256 === entry.sha256)) throw new Error("No passing browser evidence for this exact GLB");
if (report.report.filter((row: any) => row.itemId === itemId).length < 3) throw new Error("Missing front/side/back evidence");
const source = await readFile(`tools/item-models/authors/${author}.ts`);
const glb = await readFile(path.join(`art/item-models/candidates/${author}`, entry.file));
const reference = await readFile(entry.metadata.reference);
if (hash(source) !== entry.sourceSha256 || hash(glb) !== entry.sha256 || hash(reference) !== entry.referenceSha256) throw new Error("Candidate or source changed since review");
const registryFile = "art/item-models/registry.json";
let registry: { version: number; items: Record<string, unknown> };
try { registry = JSON.parse(await readFile(registryFile, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; registry = { version: 1, items: {} }; }
await mkdir("art/item-models/source-snapshots", { recursive: true });
const snapshot = `art/item-models/source-snapshots/${entry.sourceSha256}.ts`;
await writeFile(snapshot, source);
registry.items[itemId] = { ...entry, status: decision, evidence, sourceSnapshot: snapshot,
  review: "GPT-5.6 Luna max visual review, confirmed by root against the approved artwork. Runtime equipment/animation acceptance and production promotion are tracked separately.",
  promoted: false };
await writeFile(registryFile, JSON.stringify(registry, null, 2));
console.log(`${itemId}: ${decision}, ${entry.sha256}`);
