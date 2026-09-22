import { prepareLeafPixels } from "./leafTexturePixels.js";

export interface LeafTextureTask { id: number; bitmap: ImageBitmap }
export type LeafTextureReply = { id: number; error: string } | {
  id: number; width: number; height: number; hash: string; pixels: Uint8Array<ArrayBuffer>;
};

self.onmessage = (event: MessageEvent<LeafTextureTask>): void => {
  const { id, bitmap } = event.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Leaf texture preparation needs a worker 2D canvas");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const prepared = prepareLeafPixels(pixels, canvas.width, canvas.height);
    self.postMessage({ id, ...prepared } satisfies LeafTextureReply, { transfer: [prepared.pixels.buffer] });
  } catch (cause) {
    self.postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) } satisfies LeafTextureReply);
  } finally {
    bitmap.close();
  }
};
