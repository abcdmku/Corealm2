import { AssetRegistry } from '../../../game/src/render/assets.js';
import { registerProceduralGear } from '../../../game/src/render/proceduralGearFactories.js';
import { gameUrl } from '../model/gameUrl.js';

let registry: Promise<AssetRegistry> | undefined;

/** One production registry across route changes shares source geometry, images, and clips. */
export function viewerRegistry(): Promise<AssetRegistry> {
  if (!registry) {
    registry = (async () => {
      const assets = new AssetRegistry({ manifestUrl: gameUrl('assets/manifest.json'), assetBaseUrl: gameUrl('assets/') });
      registerProceduralGear(assets);
      await assets.loadManifest();
      return assets;
    })().catch(error => { registry = undefined; throw error; });
  }
  return registry;
}
