import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import { gatheringToolAppearance, gearAppearanceParts } from "../../game/src/render/equipmentVisuals.js";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const references = JSON.parse(await readFile("art/item-icons/generated/registry.json", "utf8")).items;
const reviews = JSON.parse(await readFile("art/item-models/registry.json", "utf8")).items;
const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8"));
const candidates = new Map<string, any>();
for (const author of await readdir("art/item-models/candidates", { withFileTypes: true })) {
  if (!author.isDirectory()) continue;
  // Withdrawn armor files await policy-permitted deletion and are not active candidates.
  if (author.name.startsWith("armor-") || author.name === "pilot-armor") continue;
  const directory = path.join("art/item-models/candidates", author.name);
  const catalog = JSON.parse(await readFile(path.join(directory, "catalogue.json"), "utf8"));
  const currentSourceHash = sha256(await readFile(path.join("tools/item-models/authors", `${author.name}.ts`)));
  for (const entry of catalog.assets) {
    if (candidates.has(entry.itemId)) throw new Error(`Duplicate model ownership: ${entry.itemId}`);
    const bytes = await readFile(path.join(directory, entry.file));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Stale GLB: ${entry.itemId}`);
    candidates.set(entry.itemId, { author: author.name, file: path.join(directory, entry.file),
      sha256: entry.sha256, sourceCurrent: currentSourceHash === entry.sourceSha256,
      referenceSha256: entry.referenceSha256, triangles: entry.triangles, bytes: entry.bytes });
  }
}
const items = [];
for (const item of ALL_ITEMS) {
  const reference = references[item.id];
  if (reference?.status !== "accepted") throw new Error(`Icon is not approved: ${item.id}`);
  const referenceHash = sha256(await readFile(path.join("art/item-icons/generated", reference.source)));
  if (referenceHash !== reference.sha256) throw new Error(`Approved artwork changed: ${item.id}`);
  const candidate = candidates.get(item.id);
  const review = reviews[item.id];
  const reviewed = candidate && review?.sha256 === candidate.sha256;
  if (reviewed && review.promoted) {
    const production = manifest.assets.find((entry: any) => entry.id === `corealm_item_${item.id}`);
    if (!production || production.itemModel && production.itemModel.itemId !== item.id) throw new Error(`Missing production model: ${item.id}`);
    const bytes = await readFile(path.join("game/public/assets", production.file));
    if (sha256(bytes) !== candidate.sha256 || bytes.length !== production.bytes) throw new Error(`Production model differs from accepted candidate: ${item.id}`);
  }
  if (candidate && candidate.referenceSha256 !== referenceHash) throw new Error(`Model used stale artwork: ${item.id}`);
  const appearance = gearAppearanceParts(item.id);
  const usage = appearance.some(part => part.attach === "skin") ? "armor" : appearance.length ? "held-equipment"
    : gatheringToolAppearance(item.id) ? "gathering-tool" : item.id.endsWith("_rod") ? "fishing-rod" : "standalone";
  items.push({ itemId: item.id, name: item.name, usage, referenceHash,
    status: usage === "armor" ? "existing-model" : review?.revisionRequired ? "revision-required" : reviewed ? review.promoted ? "promoted" : review.status : candidate ? "candidate-unaccepted" : "not-exported", candidate });
}
for (const itemId of candidates.keys()) if (!ALL_ITEMS.some(item => item.id === itemId)) throw new Error(`Unknown candidate ${itemId}`);
const counts = { total: items.length, authoredCandidates: candidates.size, notAuthored: items.length - candidates.size,
  staleSources: items.filter(item => item.candidate && !item.candidate.sourceCurrent).length,
  visualApproved: items.filter(item => item.status === "visual-approved").length,
  promoted: items.filter(item => item.status === "promoted").length,
  revisionRequired: items.filter(item => item.status === "revision-required").length,
  candidateBytes: items.reduce((sum, item) => sum + (item.candidate?.bytes ?? 0), 0) };
await writeFile("runs/item-models/catalog-status.json", JSON.stringify({ counts, items }, null, 2));
console.log(JSON.stringify(counts));
