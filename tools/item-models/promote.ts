import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import { gatheringToolAppearance } from "../../game/src/render/equipmentVisuals.js";

// Root invokes this only after confirming the visual/runtime review of the supplied evidence.
const [author, runtimeList = "", itemList = ""] = process.argv.slice(2);
assert(author && /^[a-z0-9-]+$/.test(author), "Usage: promote <author> [runtime-report-paths comma-separated] [item-ids comma-separated]");
const directory = path.resolve(`art/item-models/candidates/${author}`);
const catalog = JSON.parse(await readFile(path.join(directory, "catalogue.json"), "utf8"));
const registryPath = "art/item-models/registry.json";
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const manifestPath = "game/public/assets/manifest.json";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const evidence = await Promise.all(runtimeList.split(",").filter(Boolean).map(async file => ({ file, report: JSON.parse(await readFile(file, "utf8")) })));
const selected = itemList ? new Set(itemList.split(",")) : null;
const entries = catalog.assets.filter((entry: any) => !selected || selected.has(entry.itemId));
assert(entries.length && (!selected || entries.length === selected.size), "Unknown selection");
const currentSourceHash = createHash("sha256").update(await readFile(`tools/item-models/authors/${author}.ts`)).digest("hex");
for (const entry of entries) {
  const review = registry.items[entry.itemId];
  assert(!review?.revisionRequired, `${entry.itemId}: owner-requested revision is still pending`);
  assert(review?.status === "visual-approved" || review?.promoted, `${entry.itemId}: no accepted visual review`);
  assert(review.sha256 === entry.sha256, `${entry.itemId}: visual review is stale`);
  assert(currentSourceHash === entry.sourceSha256 && review.sourceSha256 === entry.sourceSha256, `${entry.itemId}: reviewed model source changed`);
  assert(/^models\/items\/[a-z0-9_]+\.glb$/.test(entry.file));
  const bytes = await readFile(path.join(directory, entry.file));
  assert(createHash("sha256").update(bytes).digest("hex") === entry.sha256, "Candidate bytes changed");
  const item = ALL_ITEMS.find(item => item.id === entry.itemId)!;
  const needsRuntime = item.equip && !item.equip.slot.startsWith("accessory") || gatheringToolAppearance(item.id) || item.id.endsWith("_rod");
  const proof = evidence.filter(({ report }) => {
    if (!report.passed || !report.assets?.some((asset: any) => asset.itemId === item.id && asset.sha256 === entry.sha256)) return false;
    return report.heldItems?.some((held: any) => held.itemId === item.id && held.sha256 === entry.sha256)
      || report.tools?.some((tool: any) => tool.itemId === item.id && tool.sha256 === entry.sha256)
      || report.authoredRod?.rodId === item.id
      || report.captures?.some((capture: any) => capture.state?.motion?.layerAssets?.includes(entry.id)
        || Object.values(capture.state?.motion?.attachments ?? {}).some(name => String(name).endsWith(entry.id)));
  });
  assert(!needsRuntime || proof.length, `${item.id}: no matching runtime evidence`);
  entry.runtimeEvidence = proof.map(row => row.file);
}
for (const entry of entries) {
  const destination = path.resolve("game/public/assets", entry.file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(directory, entry.file), destination);
  const runtimeEntry: any = {};
  for (const key of ["id", "file", "pack", "category", "is", "tags", "bytes", "size", "base", "animations", "materials", "itemModel"]) runtimeEntry[key] = entry[key];
  const index = manifest.assets.findIndex((asset: any) => asset.id === entry.id);
  if (index < 0) manifest.assets.push(runtimeEntry); else manifest.assets[index] = runtimeEntry;
  Object.assign(registry.items[entry.itemId], { promoted: true, runtimeEvidence: entry.runtimeEvidence, productionFile: destination });
}
const packIndex = manifest.packs.findIndex((pack: any) => pack.id === catalog.pack.id);
const pack = { ...catalog.pack, source: "tools/item-models/build.ts", generatorSha256: createHash("sha256").update(await readFile("tools/item-models/build.ts")).digest("hex") };
if (packIndex < 0) manifest.packs.push(pack); else manifest.packs[packIndex] = pack;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await writeFile(registryPath, JSON.stringify(registry, null, 2));
console.log(JSON.stringify({ author, promoted: entries.map((entry: any) => entry.itemId) }));
