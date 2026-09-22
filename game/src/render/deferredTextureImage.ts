import { ImageLoader, type Texture } from 'three';

const preparations = new WeakMap<Texture, Promise<void>>();

/** Publish a decoded browser image into an existing shared texture. Creating the texture
 * itself does no network work; preparation failures remain visible to the readiness gate. */
export function prepareDeferredTextureImage(texture: Texture, url: string): Promise<void> {
  if ((texture as Texture & { isDataTexture?: boolean }).isDataTexture) return Promise.resolve();
  let pending = preparations.get(texture);
  if (!pending) {
    pending = new ImageLoader().loadAsync(url).then(async image => {
      await image.decode();
      texture.image = image;
      texture.needsUpdate = true;
    }).catch(cause => {
      preparations.delete(texture);
      throw new Error(`Could not prepare texture ${texture.name || url}: ${String(cause)}`, { cause });
    });
    preparations.set(texture, pending);
  }
  return pending;
}
