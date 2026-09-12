/**
 * Shrinks the committed documentation media in place.
 *
 * The guide ships every capture and icon straight to the browser, so a single oversized source
 * file is paid for on every page view and in every clone. This pass re-encodes the committed
 * sources to WebP at sizes the site actually renders and drops folders nothing references.
 *
 * Idempotent: re-running skips files that are already at or below the target encoding.
 *
 * Usage: npx tsx tools/optimize-docs-media.ts [--dry-run]
 */
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { repoRoot } from "./lib/paths.js";

const dryRun = process.argv.includes("--dry-run");

/** Full-frame armour screenshots only ever appear as a click-through, so 1440px WebP is plenty. */
const ARMOUR_QUALITY = 74;
/** Gameplay captures render at 960x540 in a ~15rem column; effort 6 buys ~30% over effort 1. */
const CAPTURE_QUALITY = 78;

const capturesRoot = path.resolve(repoRoot, "docs/game/assets/captures");

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

async function walk(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }));
  return files.flat();
}

/** The `armor` folder duplicates `armor-ornate` and no page has linked it since the retexture. */
async function dropUnreferencedArmourSet(): Promise<number> {
  const dead = path.join(capturesRoot, "armor");
  if (!existsSync(dead)) return 0;
  const bytes = (await walk(dead)).reduce((total, file) => total + statSync(file).size, 0);
  if (!dryRun) await rm(dead, { recursive: true, force: true });
  console.log(`  dropped captures/armor (unreferenced duplicate) ${megabytes(bytes)}`);
  return bytes;
}

async function convertArmourFrames(): Promise<number> {
  const dir = path.join(capturesRoot, "armor-ornate");
  if (!existsSync(dir)) return 0;
  let saved = 0;
  for (const file of (await walk(dir)).filter((name) => name.endsWith(".png"))) {
    const before = statSync(file).size;
    const target = file.replace(/\.png$/, ".webp");
    if (!dryRun) {
      const encoded = await sharp(file)
        .webp({ quality: ARMOUR_QUALITY, effort: 6, smartSubsample: true })
        .toBuffer();
      await writeFile(target, encoded);
      await rm(file);
      saved += before - encoded.length;
    }
  }
  console.log(`  armour frames -> webp, saved ${megabytes(saved)}`);
  return saved;
}

/** Re-encodes the gameplay captures that tools/capture-docs.ts writes at effort 1. */
async function recompressCaptures(): Promise<number> {
  const skip = new Set(["armor", "armor-ornate"]);
  let saved = 0;
  for (const folder of await readdir(capturesRoot, { withFileTypes: true })) {
    if (!folder.isDirectory() || skip.has(folder.name)) continue;
    for (const file of await walk(path.join(capturesRoot, folder.name))) {
      if (!file.endsWith(".webp")) continue;
      // Read into memory first: sharp keeps the source handle open, and writing the result back
      // over its own input fails on Windows.
      const source = await readFile(file);
      const before = source.length;
      const encoded = await sharp(source)
        .webp({ quality: CAPTURE_QUALITY, effort: 6, smartSubsample: true })
        .toBuffer();
      // Re-encoding a WebP is lossy twice over; only keep it when the saving is worth the pass.
      if (encoded.length >= before * 0.92) continue;
      if (!dryRun) await writeFile(file, encoded);
      saved += before - encoded.length;
    }
  }
  console.log(`  gameplay captures re-encoded, saved ${megabytes(saved)}`);
  return saved;
}

/** The landing hero is a 1.6 MB PNG shown at 72rem wide. */
async function shrinkHero(): Promise<number> {
  const source = path.resolve(repoRoot, "docs-site/public/corealm/coldbrace.png");
  if (!existsSync(source)) return 0;
  const png = await readFile(source);
  const encoded = await sharp(png)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6, smartSubsample: true })
    .toBuffer();
  if (!dryRun) {
    await writeFile(source.replace(/\.png$/, ".webp"), encoded);
    await rm(source);
  }
  console.log(`  coldbrace hero ${megabytes(png.length)} -> ${megabytes(encoded.length)}`);
  return png.length - encoded.length;
}

/** The social card is a 2.4 MB PNG served on every page's <head>. */
async function shrinkSocialCard(): Promise<number> {
  const file = path.resolve(repoRoot, "docs-site/public/og.png");
  if (!existsSync(file)) return 0;
  const source = await readFile(file);
  const before = source.length;
  const encoded = await sharp(source)
    .resize({ width: 1200, height: 630, fit: "cover", position: "centre" })
    .png({ quality: 82, compressionLevel: 9, palette: true })
    .toBuffer();
  if (encoded.length >= before) return 0;
  if (!dryRun) await writeFile(file, encoded);
  console.log(`  og.png ${megabytes(before)} -> ${megabytes(encoded.length)}`);
  return before - encoded.length;
}

async function main(): Promise<void> {
  console.log(dryRun ? "Optimising documentation media (dry run)" : "Optimising documentation media");
  let saved = 0;
  saved += await dropUnreferencedArmourSet();
  saved += await convertArmourFrames();
  saved += await recompressCaptures();
  saved += await shrinkHero();
  saved += await shrinkSocialCard();
  console.log(`Reclaimed ${megabytes(saved)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
