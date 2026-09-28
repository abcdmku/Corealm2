import { AssetRegistry, setManifestOverlay } from '../../../game/src/render/assets.js';
import { registerProceduralGear } from '../../../game/src/render/proceduralGearFactories.js';
import { backend } from '../api/backend.js';
import { gameUrl } from '../model/gameUrl.js';
import { gameFileUrl, serverFileSha, serverModels, serverModelsLoaded, subscribeServerModels } from '../model/serverFiles.js';

let registry: { base: string; ready: Promise<AssetRegistry> } | undefined;

/**
 * One production registry across route changes shares source geometry, images, and clips.
 *
 * Built lazily, once the backend knows where assets load from: server mode settles its asset base
 * (a same-origin development mount or the published host) while it reads its first snapshot, so it
 * is asked for that snapshot first. A registry built on another base is dropped and built again.
 */
export async function viewerRegistry(): Promise<AssetRegistry> {
  if (backend().kind === 'server') await backend().collections().catch(() => undefined);
  await serverModelsLoaded();
  const base = gameUrl('assets/');
  if (registry?.base !== base) {
    const next = {
      base,
      ready: (async () => {
        const assets = new AssetRegistry({ manifestUrl: gameUrl('assets/manifest.json'), assetBaseUrl: base });
        registerProceduralGear(assets);
        await assets.loadManifest();
        return assets;
      })(),
    };
    next.ready.catch(() => { if (registry === next) registry = undefined; });
    registry = next;
  }
  return registry.ready;
}

// The server's models are read in `model/serverFiles.ts`; every registry on the page merges them by id,
// loading their GLBs from the server's store.
function applyServerModels(): void {
  const entries = serverModels();
  setManifestOverlay(entries.length ? { entries, fileUrl: path => serverFileSha(path) ? gameFileUrl(path) : null } : null);
}
subscribeServerModels(applyServerModels);
applyServerModels();

export { gameFileUrl, serverModels, serverModelsLoaded, setContentFiles, subscribeServerModels } from '../model/serverFiles.js';
