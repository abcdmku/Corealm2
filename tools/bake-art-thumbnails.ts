/**
 * Renders a thumbnail for every creature definition and ships them with the build, so the Art
 * workspace never renders the base game's creatures in an author's browser (on a live server's
 * admin that was a long task per tile). A look a server changed misses the list and renders there.
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

const browser = await chromium.launch({ channel: process.env.THUMBNAIL_BROWSER ?? "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.warn(`page error: ${error.message}`));
  await page.goto(`${base}/#/art/creatures`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("bodies"), undefined, { timeout: 120_000 });
  const started = Date.now();
  const keys = await page.evaluate(async () => {
    const [{ createThumbnailProvider, thumbnailCacheKey }, { creatureThumbnailKey }] = await Promise.all([
      import("/src/viewer/thumbnailRenderer.ts" as string) as Promise<typeof import("../devdocs/src/viewer/thumbnailRenderer.js")>,
      import("/src/viewer/thumbnailKeys.ts" as string) as Promise<typeof import("../devdocs/src/viewer/thumbnailKeys.js")>,
    ]);
    const response = await fetch("/__devdocs/collections/creatureDefinitions");
    const rows = ((await response.json()) as { data: { id: string; retired?: boolean }[] }).data;
    const provide = createThumbnailProvider();
    const done: string[] = [];
    for (const row of rows) {
      if (row.retired) continue;
      const id = creatureThumbnailKey(row.id);
      const key = await thumbnailCacheKey(id);
      if (!key || !(await provide(id))) continue;
      done.push(key);
    }
    return done;
  });
  console.log(`rendered or found ${keys.length} creature thumbnails in ${Math.round((Date.now() - started) / 1000)} s`);

  // The editor keeps each render in the checkout's cache without waiting; wait for every file.
  const cached = (key: string) => stat(path.join(cacheRoot, `${key}.png`)).then(found => found.isFile(), () => false);
  for (let attempt = 0; attempt < 60; attempt++) {
    const missing = (await Promise.all(keys.map(cached))).filter(found => !found).length;
    if (!missing) break;
    if (attempt === 59) throw new Error(`${missing} thumbnails never reached ${cacheRoot}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await mkdir(shipRoot, { recursive: true });
  const wanted = new Set(keys.map(key => `${key}.png`));
  for (const name of await readdir(shipRoot)) if (name.endsWith(".png") && !wanted.has(name)) await rm(path.join(shipRoot, name));
  for (const key of keys) await copyFile(path.join(cacheRoot, `${key}.png`), path.join(shipRoot, `${key}.png`));
  await writeFile(path.join(shipRoot, "index.json"), `${JSON.stringify({ keys: [...keys].sort() }, null, 2)}\n`);
  console.log(`shipped ${keys.length} thumbnails to ${path.relative(repoRoot, shipRoot)}`);
} finally {
  await browser.close();
}
