import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  ITEM_ICON_ALPHA_THRESHOLD, ITEM_ICON_CONTENT_SIZE, ITEM_ICON_GAME_SIZE, ITEM_ICON_MASTER_MARGIN, ITEM_ICON_MASTER_SIZE,
  ITEM_ICON_OUTLINE_RADIUS, itemIconOriginalProblem,
} from "../../game/src/content/itemIconArt.js";
import { repoRoot } from "./paths.js";

export const ITEM_ICON_ART_DIR = path.join(repoRoot, "art", "item-icons", "generated");

/** How an original reached the checkout: an image-generation run, or a generated PNG an author uploaded with its prompt. */
export const ITEM_ICON_GENERATORS = ["built-in image_gen", "uploaded original"] as const;
export type ItemIconGenerator = (typeof ITEM_ICON_GENERATORS)[number];

export interface ItemIconArtEntry {
  readonly status: "pending" | "accepted";
  readonly source: string;
  readonly sha256: string;
  readonly prompt: string;
  readonly generator: ItemIconGenerator;
  /** Asset-source findings or the explicit art direction authorizing a generated replacement. */
  readonly sourceLookup: string;
  /** Visual review of both the full source and the 48px derivative. */
  readonly review: string;
}

interface RegistryFile { version?: number; items?: Record<string, ItemIconArtEntry> }

function checkRegistry(registry: RegistryFile, directory: string): Record<string, ItemIconArtEntry> {
  if (registry.version !== 1 || !registry.items || Array.isArray(registry.items) || typeof registry.items !== "object") {
    throw new Error("Invalid generated item icon registry");
  }
  for (const [id, entry] of Object.entries(registry.items)) {
    if (!entry || !/^[a-z0-9_]+$/.test(id) || !ITEM_ICON_GENERATORS.includes(entry.generator)
      || (entry.status !== "pending" && entry.status !== "accepted")
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || ![entry.source, entry.prompt, entry.sourceLookup, entry.review].every(value => typeof value === "string" && value.trim().length > 0)) {
      throw new Error(`Invalid generated item icon provenance: ${id}`);
    }
    const relative = path.relative(directory, path.resolve(directory, entry.source));
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || !relative.endsWith(".png")) {
      throw new Error(`Generated item icon source escapes its directory: ${id}`);
    }
  }
  return registry.items;
}

async function readRegistryFile(directory: string): Promise<{ registry: RegistryFile; eol: string }> {
  const text = await readFile(path.join(directory, "registry.json"), "utf8");
  return { registry: JSON.parse(text.replace(/^﻿/, "")) as RegistryFile, eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

export async function readItemIconArtRegistry(directory = ITEM_ICON_ART_DIR): Promise<Readonly<Record<string, ItemIconArtEntry>>> {
  return checkRegistry((await readRegistryFile(directory)).registry, directory);
}

/**
 * Replaces one item's registry entry with `update(current)` and writes the registry back, keeping
 * every other entry and the file's line endings. The result must pass the same checks a read does.
 */
export async function updateItemIconArtEntry(itemId: string, update: (current: ItemIconArtEntry | undefined, items: Readonly<Record<string, ItemIconArtEntry>>) => ItemIconArtEntry,
  directory = ITEM_ICON_ART_DIR): Promise<ItemIconArtEntry> {
  const { registry, eol } = await readRegistryFile(directory);
  const items = checkRegistry(registry, directory);
  const entry = update(items[itemId], items);
  const next: RegistryFile = { ...registry, items: { ...items, [itemId]: entry } };
  checkRegistry(next, directory);
  await writeFile(path.join(directory, "registry.json"), `${JSON.stringify(next, null, 2)}\n`.replace(/\n/g, eol));
  return entry;
}

/**
 * The 256 master from a generated original. Preserves the original's alpha; only trims, scales and
 * adds transparent framing. The parameters are `game/src/content/itemIconArt.ts`'s, which derives
 * the same image without sharp.
 */
export async function sharpItemIconMaster(source: Buffer, size = ITEM_ICON_MASTER_SIZE, label = "original"): Promise<Buffer> {
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error(`Generated item icon has no alpha: ${label}`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (itemIconOriginalProblem({ width: info.width, height: info.height, data })) {
    throw new Error(`Generated item icon needs real transparency and visible artwork: ${label}`);
  }
  const margin = ITEM_ICON_MASTER_MARGIN;
  return sharp(source)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: ITEM_ICON_ALPHA_THRESHOLD })
    .resize(size - margin * 2, size - margin * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: sharp.kernel.lanczos3 })
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

/** The outlined 48px inventory icon from a 256 master: fitted inside 44px, a 1px black silhouette outline, centred. */
export async function sharpItemIconGame(master: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(master)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: ITEM_ICON_ALPHA_THRESHOLD })
    .resize(ITEM_ICON_CONTENT_SIZE, ITEM_ICON_CONTENT_SIZE, {
      fit: "inside",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const silhouette = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    silhouette[offset + 3] = data[offset + 3] ?? 0;
  }
  const raw = { width: info.width, height: info.height, channels: info.channels } as const;
  const [foregroundPng, silhouettePng] = await Promise.all([
    sharp(data, { raw }).png().toBuffer(),
    sharp(silhouette, { raw }).png().toBuffer(),
  ]);
  const left = Math.floor((ITEM_ICON_GAME_SIZE - info.width) / 2);
  const top = Math.floor((ITEM_ICON_GAME_SIZE - info.height) / 2);
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let y = -ITEM_ICON_OUTLINE_RADIUS; y <= ITEM_ICON_OUTLINE_RADIUS; y += 1) {
    for (let x = -ITEM_ICON_OUTLINE_RADIUS; x <= ITEM_ICON_OUTLINE_RADIUS; x += 1) {
      if (x === 0 && y === 0) continue;
      layers.push({ input: silhouettePng, left: left + x, top: top + y });
    }
  }
  layers.push({ input: foregroundPng, left, top });

  return sharp({
    create: {
      width: ITEM_ICON_GAME_SIZE,
      height: ITEM_ICON_GAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256 })
    .toBuffer();
}

/** The master for a registry entry, after checking the original's recorded hash. */
export async function generatedItemIconMaster(entry: ItemIconArtEntry, size: number, directory = ITEM_ICON_ART_DIR): Promise<Buffer> {
  const source = await readFile(path.resolve(directory, entry.source));
  if (createHash("sha256").update(source).digest("hex") !== entry.sha256) {
    throw new Error(`Generated item icon source hash mismatch: ${entry.source}`);
  }
  return sharpItemIconMaster(source, size, entry.source);
}
