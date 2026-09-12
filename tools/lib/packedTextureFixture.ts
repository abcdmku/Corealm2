import type { Page } from 'playwright';
import { packAssetTextures, type PackedImage } from './asset-texture-pack.js';

/** Stage the exact release repacker in a production lab, without replacing authored assets. */
export async function installPackedTextureFixture(page: Page) {
  const images = new Map<string, PackedImage>();
  const stats = { models: 0, embeddedImages: 0, uniqueImages: 0, imageRequests: 0, savedBytes: 0 };
  await page.route('**/assets/shared-textures/*', async route => {
    const image = images.get(new URL(route.request().url()).pathname.slice(1));
    if (!image) { await route.fulfill({ status: 404, body: 'Missing staged texture' }); return; }
    stats.imageRequests++;
    await route.fulfill({ contentType: image.mimeType, body: image.bytes });
  });
  await page.route('**/*.glb', async route => {
    const response = await route.fetch();
    if (!response.ok()) { await route.fulfill({ response }); return; }
    const original = await response.body();
    const packed = packAssetTextures(original, new URL(route.request().url()).pathname.slice(1));
    stats.models++; stats.embeddedImages += packed.images.length;
    stats.savedBytes += original.length - packed.glb.length;
    for (const image of packed.images) if (!images.has(image.file)) {
      images.set(image.file, image); stats.uniqueImages++; stats.savedBytes -= image.bytes.length;
    }
    await route.fulfill({ contentType: 'model/gltf-binary', body: packed.glb });
  });
  return stats;
}
