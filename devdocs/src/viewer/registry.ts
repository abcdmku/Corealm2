import { AssetRegistry, setManifestOverlay, type AssetEntry } from '../../../game/src/render/assets.js';
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

/** Preview an import catalog through the same actor renderer, before its files are promoted. */
export async function previewCandidateCatalog(catalogUrl: string | null): Promise<string[]> {
  if (!import.meta.env.DEV || backend().kind === 'server') throw new Error('Candidate review is available in the local Art workspace');
  if (!catalogUrl) { applyServerModels(); registry = undefined; return []; }
  const url = new URL(catalogUrl, location.href);
  if (url.origin !== location.origin) throw new Error('Candidate catalog must come from the local development server');
  const response = await fetch(url.href, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Candidate catalog: ${response.status}`);
  const catalog = await response.json() as { assets: (AssetEntry & { sha256?: string })[]; files: Record<string, string> };
  if (!Array.isArray(catalog.assets) || !catalog.files) throw new Error('Invalid candidate catalog');
  const files = new Map<string, string>();
  for (const entry of catalog.assets) {
    const file = catalog.files[entry.id];
    if (!file || !entry.animations || !entry.size || !entry.sha256) throw new Error(`Incomplete candidate ${entry.id}`);
    const candidateUrl = new URL(file, url);
    if (candidateUrl.origin !== url.origin) throw new Error(`External candidate ${entry.id}`);
    const candidate = await fetch(candidateUrl.href, { cache: 'no-store' });
    if (!candidate.ok) throw new Error(`Candidate ${entry.id}: ${candidate.status}`);
    const bytes = await candidate.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== entry.bytes || digest !== entry.sha256) throw new Error(`Stale candidate ${entry.id}`);
    files.set(`assets/${entry.file}`, candidateUrl.href);
  }
  setManifestOverlay({ entries: catalog.assets, fileUrl: file => files.get(file) ?? null });
  registry = undefined;
  return catalog.assets.map(entry => entry.id);
}

// Dispatch through the module used by the live actor; importing a bare URL during HMR can
// otherwise create a second registry instance and leave the visible actor on cached assets.
if (import.meta.env.DEV) {
  const preview = (event: Event) => {
    const request = (event as CustomEvent<{ url: string | null; requestId: string }>).detail;
    if (!request || typeof request.requestId !== 'string' || (request.url !== null && typeof request.url !== 'string')) return;
    void previewCandidateCatalog(request.url).then(
      ids => window.dispatchEvent(new CustomEvent('viewer:catalog-ready', { detail: { requestId: request.requestId, ids } })),
      error => window.dispatchEvent(new CustomEvent('viewer:catalog-ready', { detail: { requestId: request.requestId, error: String(error) } })),
    );
  };
  window.addEventListener('viewer:preview-catalog', preview);
  import.meta.hot?.dispose(() => window.removeEventListener('viewer:preview-catalog', preview));
}

export { gameFileUrl, serverModels, serverModelsLoaded, setContentFiles, subscribeServerModels } from '../model/serverFiles.js';
