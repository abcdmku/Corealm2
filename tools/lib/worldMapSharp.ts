import { createHash } from "node:crypto";
import sharp, { type OverlayOptions, type WebpOptions } from "sharp";
import {
  CAPTURE_TILE_PIXELS, TILE_BLEED_PIXELS, type MapEncoding, type MapLayout, type WorldMapCodec,
} from "../../game/src/world/worldMapRender.js";

/** WebP settings per encoding: see `MapEncoding`. */
function webp(quality: number, encoding: MapEncoding): WebpOptions {
  return encoding === "photo"
    ? { quality, effort: 6, smartSubsample: false, preset: "photo" }
    : { quality, effort: 6, smartSubsample: true, preset: "default" };
}

/**
 * The repository's map codec: the canonical image is a lossless PNG, resized with lanczos3 and
 * encoded by libvips' WebP. The committed renditions come from exactly these settings.
 */
export const sharpWorldMapCodec: WorldMapCodec<Buffer> = {
  stitcher(layout: MapLayout) {
    const inputs: OverlayOptions[] = [];
    return {
      async add(capture, column, row) {
        const tile = await sharp(Buffer.from(capture))
          // Capture keeps +X to the right; the vertical flip changes +Z from bottom to north/top.
          .flip()
          .extract({ left: TILE_BLEED_PIXELS, top: TILE_BLEED_PIXELS, width: CAPTURE_TILE_PIXELS, height: CAPTURE_TILE_PIXELS })
          .png()
          .toBuffer();
        inputs.push({ input: tile, left: column * CAPTURE_TILE_PIXELS, top: row * CAPTURE_TILE_PIXELS });
      },
      async finish() {
        return sharp({ create: { width: layout.width, height: layout.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
          .composite(inputs)
          .png({ compressionLevel: 9, quality: 100 })
          .toBuffer();
      },
    };
  },
  async size(source) {
    const info = await sharp(source).metadata();
    return { width: info.width ?? 0, height: info.height ?? 0 };
  },
  async identity(source) {
    return { sha256: createHash("sha256").update(source).digest("hex"), png: source };
  },
  async encode(source, target) {
    return sharp(source)
      .resize({ width: target.width, height: target.height, fit: "fill", kernel: "lanczos3" })
      .webp(webp(target.quality, target.encoding))
      .toBuffer();
  },
  /** Decodes the level once and extracts every tile from that buffer, so a grid costs one decode. */
  async tiles(source, level, tile) {
    const info = await sharp(source).metadata();
    const resized = level.width === info.width && level.height === info.height
      ? sharp(source)
      : sharp(source).resize({ width: level.width, height: level.height, fit: "fill", kernel: "lanczos3" });
    const { data, info: rawInfo } = await resized.raw().toBuffer({ resolveWithObject: true });
    const raw = { width: rawInfo.width, height: rawInfo.height, channels: rawInfo.channels };
    for (let row = 0; row < level.height / level.tilePixels; row += 1) {
      for (let column = 0; column < level.width / level.tilePixels; column += 1) {
        const bytes = await sharp(data, { raw })
          .extract({ left: column * level.tilePixels, top: row * level.tilePixels, width: level.tilePixels, height: level.tilePixels })
          // Same encoder settings the monolithic top level used, at the higher quality the tile
          // budget affords. "photo" with full chroma keeps coast and roof edges from fringing.
          .webp(webp(level.quality, "photo"))
          .toBuffer();
        await tile(column, row, bytes);
      }
    }
  },
};
