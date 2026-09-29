/**
 * Renders a thumbnail for every creature definition, and one of each body model they wear (the
 * review queue and model previews show the bare body), and ships them with the build, so the Art
 * workspace never renders the base game's creatures in an author's browser (on a live server's
 * admin that was a long task per tile). A look a server changed misses the list and renders there.
 * Run it after a creature model or look changes.
 *
 *   npx tsx tools/bake-art-thumbnails.ts [--base http://127.0.0.1:4190]
 *
 * Needs the repo devdocs running (`npm run devdocs`). It drives the editor's own renderer in Chrome
 * with WebGPU, which keeps each render in the checkout's cache, then copies the current keys to
 * `game/public/assets/thumbnails/<key>.png` with an `index.json` listing them, and removes files no
 * key names any more. Keys carry each creature's look and the render version, so a stale file is
 * never shown for a changed creature.
 */
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { gameRoot, repoRoot } from "./lib/paths.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] ?? fallback : fallback; };
const base = option("base", "http://127.0.0.1:4190").replace(/\/+$/, "");
const cacheRoot = path.join(repoRoot, "devdocs", "generated", "thumbnails");
const shipRoot = path.join(gameRoot, "public", "assets", "thumbnails");

const browser = await chromium.launch({ channel: process.env.THUMBNAIL_BROWSER ?? "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.warn(`page error: ${error.message}`));
  await page.goto(`${base}/#/art/creatures`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("bodies"), undefined, { timeout: 120_000 });
  const started = Date.now();
  const keys = await page.evaluate(async () => {
    const [{ createThumbnailProvider, thumbnailCacheKey }, { creatureThumbnailKey }, { actorSpec }] = await Promise.all([
      import("/src/viewer/thumbnailRenderer.ts" as string) as Promise<typeof import("../devdocs/src/viewer/thumbnailRenderer.js")>,
      import("/src/viewer/thumbnailKeys.ts" as string) as Promise<typeof import("../devdocs/src/viewer/thumbnailKeys.js")>,
      import("/src/viewer/actorEntity.ts" as string) as Promise<typeof import("../devdocs/src/viewer/actorEntity.js")>,
    ]);
    const response = await fetch("/__devdocs/collections/creatureDefinitions");
    const rows = ((await response.json()) as { data: { id: string; retired?: boolean }[] }).data;
    const provide = createThumbnailProvider();
    const done: string[] = [];
    const live = rows.filter(row => !row.retired);
    // A base definition without a model of its own (its placements choose one) draws nothing.
    const bodies = new Set<string>();
    for (const row of live) {
      try { const assetId = actorSpec(row.id).entity.view?.assetId; if (assetId) bodies.add(assetId); } catch { /* no model */ }
    }
    for (const id of [...live.map(row => creatureThumbnailKey(row.id)), ...bodies]) {
      const key = await thumbnailCacheKey(id);
      if (!key || !(await provide(id))) continue;
      done.push(key);
    }
    return done;
  });
  console.log(`rendered or found ${keys.length} creature thumbnails in ${Math.round((Date.now() - started) / 1000)} s`);

  // The editor keeps each render in the checkout's cache without waiting; wait for every file. A key
  // that was already shipped is found in the build and not rendered again.
  const isFile = (file: string) => stat(file).then(found => found.isFile(), () => false);
  const source = async (key: string) => (await isFile(path.join(shipRoot, `${key}.png`))) ? path.join(shipRoot, `${key}.png`)
    : (await isFile(path.join(cacheRoot, `${key}.png`))) ? path.join(cacheRoot, `${key}.png`) : undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    const missing = (await Promise.all(keys.map(source))).filter(found => !found).length;
    if (!missing) break;
    if (attempt === 59) throw new Error(`${missing} thumbnails never reached ${cacheRoot}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await mkdir(shipRoot, { recursive: true });
  const wanted = new Set(keys.map(key => `${key}.png`));
  for (const key of keys) {
    const from = (await source(key))!;
    if (path.dirname(from) !== shipRoot) await copyFile(from, path.join(shipRoot, `${key}.png`));
  }
  for (const name of await readdir(shipRoot)) if (name.endsWith(".png") && !wanted.has(name)) await rm(path.join(shipRoot, name));
  await writeFile(path.join(shipRoot, "index.json"), `${JSON.stringify({ keys: [...keys].sort() }, null, 2)}\n`);
  console.log(`shipped ${keys.length} thumbnails to ${path.relative(repoRoot, shipRoot)}`);
} finally {
  await browser.close();
}
