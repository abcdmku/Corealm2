import {
  CAPTURE_TILE_PIXELS, TILE_BLEED_PIXELS, sha256Hex, type MapLayout, type WorldMapCodec,
} from "../../../../game/src/world/worldMapRender.js";

/*
  The world map codec a browser has: the canonical image is a canvas, levels are resized with the
  canvas' high-quality filter, and files are encoded by the browser's own WebP encoder at the
  pipeline's quality settings. The repository encodes with Sharp instead (`tools/lib/worldMapSharp.ts`),
  so a server's files match the committed ones in frame and pixels, not byte for byte.
*/

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
  if (!context) throw new Error("This browser cannot draw the world map: no 2D canvas.");
  return context;
}

async function webp(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: quality / 100 });
  // A browser without a WebP encoder answers with a PNG instead of failing.
  if (blob.type !== "image/webp") throw new Error("This browser cannot encode WebP. Render the map from Chrome or Edge.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** `source` at `width` x `height`: itself when it already is, else a high-quality resample. */
function resized(source: OffscreenCanvas, width: number, height: number): OffscreenCanvas {
  if (source.width === width && source.height === height) return source;
  const canvas = new OffscreenCanvas(width, height);
  const draw = context(canvas);
  draw.imageSmoothingEnabled = true;
  draw.imageSmoothingQuality = "high";
  draw.drawImage(source, 0, 0, width, height);
  return canvas;
}

export const canvasWorldMapCodec: WorldMapCodec<OffscreenCanvas> = {
  stitcher(layout: MapLayout) {
    const canvas = new OffscreenCanvas(layout.width, layout.height);
    const draw = context(canvas);
    draw.fillStyle = "#000";
    draw.fillRect(0, 0, layout.width, layout.height);
    draw.imageSmoothingEnabled = false;
    return {
      async add(capture, column, row) {
        const bitmap = await createImageBitmap(new Blob([capture as Uint8Array<ArrayBuffer>], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        try {
          // The capture has +Z at the bottom. Drawing it through a vertical flip puts north at the
          // top; the source rectangle crops the bleed, exactly what Sharp's flip + extract does.
          draw.setTransform(1, 0, 0, -1, column * CAPTURE_TILE_PIXELS, (row + 1) * CAPTURE_TILE_PIXELS);
          draw.drawImage(bitmap, TILE_BLEED_PIXELS, TILE_BLEED_PIXELS, CAPTURE_TILE_PIXELS, CAPTURE_TILE_PIXELS, 0, 0, CAPTURE_TILE_PIXELS, CAPTURE_TILE_PIXELS);
        } finally {
          draw.setTransform(1, 0, 0, 1, 0, 0);
          bitmap.close();
        }
      },
      async finish() { return canvas; },
    };
  },
  async size(source) { return { width: source.width, height: source.height }; },
  /** No PNG is kept: the identity is the hash of the stitched RGBA pixels. */
  async identity(source) {
    const pixels = context(source).getImageData(0, 0, source.width, source.height).data;
    return { sha256: await sha256Hex(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)) };
  },
  async encode(source, target) {
    return webp(resized(source, target.width, target.height), target.quality);
  },
  async tiles(source, level, tile) {
    const scaled = resized(source, level.width, level.height);
    const edge = level.tilePixels;
    const canvas = new OffscreenCanvas(edge, edge);
    const draw = context(canvas);
    draw.imageSmoothingEnabled = false;
    for (let row = 0; row < level.height / edge; row += 1) {
      for (let column = 0; column < level.width / edge; column += 1) {
        draw.drawImage(scaled, column * edge, row * edge, edge, edge, 0, 0, edge, edge);
        await tile(column, row, await webp(canvas, level.quality));
      }
    }
  },
};
