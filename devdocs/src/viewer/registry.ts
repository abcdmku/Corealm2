import { AssetRegistry } from '../../../game/src/render/assets.js';
import { registerProceduralGear } from '../../../game/src/render/proceduralGearFactories.js';
import { backend } from '../api/backend.js';
import { gameUrl } from '../model/gameUrl.js';

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

/**
 * Files a live server stores itself (`/content-assets/<path>`), by path under the public tree, with
 * the hash that versions each URL. Server mode fills it from `GET /admin/files` and after each
 * `putFiles`; repo mode leaves it empty because its files are in the checkout beside the page.
 */
let contentFiles: { base: string; files: ReadonlyMap<string, string> } = { base: '', files: new Map() };

export function setContentFiles(base: string, files: Readonly<Record<string, { sha256: string }>>): void {
  contentFiles = { base: base.replace(/\/*$/, '/'), files: new Map(Object.entries(files).map(([path, entry]) => [path, entry.sha256])) };
}

/** Where a game file loads from: the server's own store when it holds the path, the asset base otherwise. */
export function gameFileUrl(path: string): string {
  const relative = path.replace(/^\/+/, '');
  const sha = contentFiles.files.get(relative);
  return sha ? `${new URL(relative, contentFiles.base).href}?v=${sha.slice(0, 12)}` : gameUrl(relative);
}
