import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Page } from "playwright";

/** Serve staged production GLBs in one browser context without promoting them into the world. */
export async function installAssetCandidates(page: Page, catalogPath: string): Promise<string[]> {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8"));
  const ids: string[] = [];
  for (const entry of catalog.assets) {
    if (ids.includes(entry.id)) throw new Error(`Duplicate candidate ${entry.id}`);
    const bytes = await readFile(path.resolve(path.dirname(catalogPath), catalog.files?.[entry.id] ?? entry.file));
    if (entry.bytes !== bytes.length || entry.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
      throw new Error(`Stale asset candidate ${entry.id}`);
    }
    const index = manifest.assets.findIndex((asset: { id: string }) => asset.id === entry.id);
    if (index < 0) manifest.assets.push(entry);
    else manifest.assets[index] = entry;
    await page.route(`**/assets/${entry.file}*`, route => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: bytes }));
    ids.push(entry.id);
  }
  if (catalog.pack && !manifest.packs.some((pack: { id: string }) => pack.id === catalog.pack.id)) manifest.packs.push(catalog.pack);
  await page.route("**/assets/manifest.json*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }));
  return ids;
}
