import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { repoRoot } from "./lib/paths.js";

const manifestPath = path.join(repoRoot, "game/public/assets/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.assets = manifest.assets.filter((asset: { id: string }) => !/^corealm_(?:oak|pine|fern|shrub)_\d+_far$/.test(asset.id));
manifest.packs = manifest.packs.filter((pack: { id: string }) => pack.id !== "corealm-original-nature-lods");
for (const family of ["nature", "geology"]) {
  const catalog = JSON.parse(await readFile(path.join(repoRoot, `tools/data/corealm-${family}.json`), "utf8"));
  catalog.pack.license = "LicenseRef-Corealm-Original";
  catalog.pack.generatorSha256 = createHash("sha256").update(await readFile(path.join(repoRoot, catalog.pack.source))).digest("hex");
  manifest.packs = manifest.packs.filter((pack: { id: string }) => pack.id !== catalog.pack.id);
  manifest.packs.push(catalog.pack);
  const ids = new Set(catalog.assets.map((asset: { id: string }) => asset.id));
  manifest.assets = manifest.assets.filter((asset: { id: string }) => !ids.has(asset.id));
  manifest.assets.push(...catalog.assets);
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Registered ${manifest.assets.length} models, including original Corealm environment families.`);
