import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { repoRoot } from "./paths.js";

export const ITEM_ICON_ART_DIR = path.join(repoRoot, "art", "item-icons", "generated");

export interface ItemIconArtEntry {
  readonly status: "pending" | "accepted";
  readonly source: string;
  readonly sha256: string;
  readonly prompt: string;
  readonly generator: "built-in image_gen";
  /** Concrete asset-search findings explaining why a genuine model could not be used. */
  readonly sourceLookup: string;
  /** Visual review of both the full source and the 48px derivative. */
  readonly review: string;
}

export async function readItemIconArtRegistry(directory = ITEM_ICON_ART_DIR): Promise<Readonly<Record<string, ItemIconArtEntry>>> {
  const text = await readFile(path.join(directory, "registry.json"), "utf8");
  const registry = JSON.parse(text.replace(/^\uFEFF/, "")) as { version?: number; items?: Record<string, ItemIconArtEntry> };
  if (registry.version !== 1 || !registry.items || Array.isArray(registry.items) || typeof registry.items !== "object") {
    throw new Error("Invalid generated item icon registry");
  }
  for (const [id, entry] of Object.entries(registry.items)) {
    if (!entry || !/^[a-z0-9_]+$/.test(id) || entry.generator !== "built-in image_gen"
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

/** Preserve original generated alpha; only trim, scale and add transparent framing. */
export async function generatedItemIconMaster(entry: ItemIconArtEntry, size: number, directory = ITEM_ICON_ART_DIR): Promise<Buffer> {
  const source = await readFile(path.resolve(directory, entry.source));
  if (createHash("sha256").update(source).digest("hex") !== entry.sha256) {
    throw new Error(`Generated item icon source hash mismatch: ${entry.source}`);
  }
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error(`Generated item icon has no alpha: ${entry.source}`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  let visible = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset]! <= 8) clear += 1;
    else visible += 1;
  }
  if (clear < info.width * info.height * 0.05 || visible < info.width * info.height * 0.01) {
    throw new Error(`Generated item icon needs real transparency and visible artwork: ${entry.source}`);
  }
  return sharp(source)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .resize(size - 16, size - 16, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: sharp.kernel.lanczos3 })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}
