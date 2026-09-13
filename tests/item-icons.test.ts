import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ALL_ITEMS } from "../game/src/content/items.js";
import {
  ITEM_ICON_APPEARANCE_IDS,
  itemIconAppearance,
  itemIconAssetIds,
} from "../game/src/render/itemIconAppearances.js";
import { itemIconUrl } from "../game/src/ui/itemIcons.js";
import {
  ITEM_ICON_GAME_SIZE,
  ITEM_ICON_MASTER_SIZE,
  itemIconFiles,
} from "../tools/generate-item-icons.js";
import { isProceduralGearAsset } from "../game/src/render/proceduralGear.js";

describe("3D item icon catalog", () => {
  it("covers every item explicitly", () => {
    expect(new Set(ALL_ITEMS.map((item) => item.id)).size).toBe(ALL_ITEMS.length);
    expect([...ITEM_ICON_APPEARANCE_IDS].sort()).toEqual(ALL_ITEMS.map((item) => item.id).sort());
    for (const item of ALL_ITEMS) expect(itemIconAppearance(item.id).parts.length, item.id).toBeGreaterThan(0);
  });

  it("only references GLBs present in the asset manifest", async () => {
    const manifest = JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) as {
      assets: { id: string }[];
    };
    const known = new Set(manifest.assets.map((asset) => asset.id));
    expect(itemIconAssetIds().filter((id) => !known.has(id) && !isProceduralGearAsset(id))).toEqual([]);
  });

  it("points the runtime at the 48px public derivative, never the master", () => {
    const swappedArtwork: Record<string, string> = {
      dragonhide_hood: 'starhide_hood', dragonhide_robe: 'starhide_robe',
      dragonhide_leggings: 'starhide_leggings', dragonhide_boots: 'starhide_boots', dragonhide_wraps: 'starhide_wraps',
      starhide_hood: 'dragonhide_hood', starhide_robe: 'dragonhide_robe',
      starhide_leggings: 'dragonhide_leggings', starhide_boots: 'dragonhide_boots', starhide_wraps: 'dragonhide_wraps',
      frostweave_hood: 'aurora_frostweave_hood', frostweave_robe: 'aurora_frostweave_robe',
      frostweave_leggings: 'aurora_frostweave_leggings', frostweave_boots: 'aurora_frostweave_boots', frostweave_wraps: 'aurora_frostweave_wraps',
    };
    for (const item of ALL_ITEMS) {
      const url = itemIconUrl(item);
      expect(url, item.id).toBe(`assets/icons/items/48/${swappedArtwork[item.id] ?? item.id}.png`);
      expect(url, item.id).not.toContain("256");
      expect(url, item.id).not.toContain("art/");
    }
  });
});

describe("generated item icon files", () => {
  it("ships a valid transparent master and gameplay derivative for every item", async () => {
    const files = ALL_ITEMS.flatMap((item) => {
      const paths = itemIconFiles(item.id);
      return [[paths.master, ITEM_ICON_MASTER_SIZE], [paths.game, ITEM_ICON_GAME_SIZE]] as const;
    });

    await Promise.all(files.map(async ([file, size]) => {
      const input = await readFile(file);
      const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], file).toEqual([size, size]);
      let visible = 0;
      let transparent = 0;
      let minX = info.width;
      let minY = info.height;
      let maxX = -1;
      let maxY = -1;
      let blackPixels = 0;
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          const offset = (y * info.width + x) * info.channels;
          const alpha = data[offset + 3] ?? 0;
          if (alpha < 250) transparent += 1;
          if (alpha <= 8) continue;
          visible += 1;
          if (alpha >= 192 && (data[offset] ?? 255) < 24 && (data[offset + 1] ?? 255) < 24 && (data[offset + 2] ?? 255) < 24) {
            blackPixels += 1;
          }
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      expect(visible, file).toBeGreaterThan(size * size * 0.01);
      expect(transparent, file).toBeGreaterThan(size * size * 0.01);
      const margin = size === ITEM_ICON_MASTER_SIZE ? 4 : 1;
      expect(minX, file).toBeGreaterThanOrEqual(margin);
      expect(minY, file).toBeGreaterThanOrEqual(margin);
      expect(maxX, file).toBeLessThan(size - margin);
      expect(maxY, file).toBeLessThan(size - margin);
      if (size === ITEM_ICON_GAME_SIZE) {
        expect(Math.max(maxX - minX + 1, maxY - minY + 1), `${file} should fill its 48px canvas`).toBeGreaterThanOrEqual(44);
        expect(blackPixels, `${file} should have a black silhouette outline`).toBeGreaterThan(ITEM_ICON_GAME_SIZE);
      }
    }));
  }, 30_000);
});
