import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deriveItemIconArt, itemIconGame, itemIconTrimBounds, type RgbaImage } from "../game/src/content/itemIconArt.js";
import { decodePng, encodePng } from "../game/src/multiplayer/imagegenPng.js";
import { ITEM_ICON_ART_DIR, generatedItemIconMaster, readItemIconArtRegistry, sharpItemIconGame } from "../tools/lib/item-icon-art.js";
import { repoRoot } from "../tools/lib/paths.js";

// Real originals of different shapes: round, tall and narrow, wide and flat, and one from a subdirectory.
const IDS = ["air_orb", "bramblehide_robe", "burnt_minnow", "crafted_ring_t10"] as const;

async function rgba(bytes: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Per pixel, the larger of the alpha difference and the premultiplied colour difference, in 0-255 levels. */
function differences(a: RgbaImage, b: RgbaImage): { mean: number; p99: number; max: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  const values: number[] = [];
  for (let i = 0; i < a.data.length; i += 4) {
    let worst = Math.abs(a.data[i + 3]! - b.data[i + 3]!);
    for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(a.data[i + c]! * a.data[i + 3]! - b.data[i + c]! * b.data[i + 3]!) / 255);
    values.push(worst);
  }
  values.sort((x, y) => x - y);
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, p99: values[Math.floor(values.length * 0.99)]!, max: values.at(-1)! };
}

describe("item icon art derivation", () => {
  it("the tools' sharp path still reproduces the published files byte for byte", async () => {
    const registry = await readItemIconArtRegistry();
    for (const id of IDS) {
      const master = await generatedItemIconMaster(registry[id]!, 256);
      expect(master.equals(await readFile(path.join(repoRoot, "art/item-icons/256", `${id}.png`))), `${id} master`).toBe(true);
      const game = await sharpItemIconGame(master);
      expect(game.equals(await readFile(path.join(repoRoot, "game/public/assets/icons/items/48", `${id}.png`))), `${id} 48`).toBe(true);
    }
  }, 60_000);

  it("the portable path matches the published icons within a few levels", async () => {
    const registry = await readItemIconArtRegistry();
    for (const id of IDS) {
      const original = await rgba(await readFile(path.join(ITEM_ICON_ART_DIR, registry[id]!.source)));
      const { master, game } = deriveItemIconArt(original);
      const publishedMaster = await rgba(await readFile(path.join(repoRoot, "art/item-icons/256", `${id}.png`)));
      const publishedGame = await rgba(await readFile(path.join(repoRoot, "game/public/assets/icons/items/48", `${id}.png`)));
      // Same placement: the artwork's bounds agree to the pixel.
      expect(itemIconTrimBounds(master), `${id} master bounds`).toEqual(itemIconTrimBounds(publishedMaster));
      expect(itemIconTrimBounds(game), `${id} 48 bounds`).toEqual(itemIconTrimBounds(publishedGame));
      const masterDiff = differences(master, publishedMaster);
      expect(masterDiff.mean, `${id} master mean`).toBeLessThan(1);
      expect(masterDiff.p99, `${id} master p99`).toBeLessThanOrEqual(5);
      expect(masterDiff.max, `${id} master max`).toBeLessThanOrEqual(32);
      // The published 48 is also palette-quantized with dithering, which the portable path does not do.
      const gameDiff = differences(itemIconGame(publishedMaster), publishedGame);
      expect(gameDiff.mean, `${id} 48 mean`).toBeLessThan(3.5);
      expect(gameDiff.p99, `${id} 48 p99`).toBeLessThanOrEqual(12);
      expect(gameDiff.max, `${id} 48 max`).toBeLessThanOrEqual(32);
    }
  }, 120_000);

  it("round-trips through the server's PNG codec and refuses an original without transparency", async () => {
    const registry = await readItemIconArtRegistry();
    const { master } = deriveItemIconArt(decodePng(await readFile(path.join(ITEM_ICON_ART_DIR, registry.air_orb!.source))));
    expect(decodePng(encodePng(master)).data).toEqual(master.data);
    const opaque = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4).fill(255) };
    expect(() => deriveItemIconArt(opaque)).toThrow("real transparency");
  }, 60_000);
});
