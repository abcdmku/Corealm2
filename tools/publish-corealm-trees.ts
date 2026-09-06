/** Refresh only accepted tree rows in the manifest after a production nature build. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { TREE_SPECIES, treeAssetIds } from "../game/src/content/treeSpecies.js";
import { gameRoot, repoRoot } from "./lib/paths.js";

type Entry = { id: string; file: string; sha256: string; tags: string[] };
type Pack = { id: string; generatorSha256?: string };
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const file = path.join(gameRoot, "public/assets/manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8")) as { assets: Entry[]; packs: Pack[] };
const catalog = JSON.parse(await readFile(path.join(repoRoot, "tools/data/corealm-nature.json"), "utf8")) as { assets: Entry[]; pack: Pack };
const trees = catalog.assets.filter(entry => entry.tags.includes("tree"));
assert.deepEqual(trees.map(entry => entry.id).sort(), TREE_SPECIES.flatMap(treeAssetIds).sort(), "Tree catalogue is incomplete");
for (const entry of trees) {
  assert.equal(digest(await readFile(path.join(gameRoot, "public/assets", entry.file))), entry.sha256, `Rebuild stale tree ${entry.id}`);
}
const pack = manifest.packs.find(entry => entry.id === catalog.pack.id);
assert(pack, "The production nature pack is missing");
pack.generatorSha256 = digest(await readFile(path.join(repoRoot, "tools/build-corealm-nature.ts")));
const replacements = new Map(trees.map(entry => [entry.id, entry]));
const existing = new Set(manifest.assets.map(entry => entry.id));
manifest.assets = manifest.assets.map(entry => replacements.get(entry.id) ?? entry);
manifest.assets.push(...trees.filter(entry => !existing.has(entry.id)));
const output = `${JSON.stringify(manifest, null, 2)}\n`;
if (await readFile(file, "utf8") !== output) {
  await writeFile(`${file}.tmp`, output);
  await rename(`${file}.tmp`, file);
}
console.log(`Verified and published ${trees.length} tree manifest rows.`);
