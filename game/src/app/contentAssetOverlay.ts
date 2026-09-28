import { CONTENT_MANIFEST_OVERLAY } from "../multiplayer/contentAssetsContract.js";
import { setManifestOverlay } from "../render/assets.js";
import { parseManifestOverlay } from "../render/manifestOverlay.js";
import { contentAssetOverride, fetchContentAssetIndex, MAX_CONTENT_ASSET_INDEX_BYTES, serverWorld, setContentAssetOverlay } from "./config.js";

/** The server's model overlay, read from where its index says; an unreadable one adds no models. */
async function readManifestOverlay(request: typeof fetch): Promise<ReturnType<typeof parseManifestOverlay>> {
  const url = contentAssetOverride(CONTENT_MANIFEST_OVERLAY);
  if (!url) return [];
  const response = await request(url, { credentials: "omit", redirect: "error" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CONTENT_ASSET_INDEX_BYTES) throw new Error(`${url} is too large`);
  return parseManifestOverlay(JSON.parse(text));
}

/**
 * Keeps `config.ts`'s overlay on the files of the world the page is in: `enter` with the joined
 * world's `contentAssetUrl` loads `index.json`, `refresh` reloads it after a `content-updated`, and
 * `leave` clears it. A load that finishes after the page left, or joined elsewhere, is dropped. A
 * failed load leaves the asset host's files in use and reports it.
 *
 * The models the server adds (`CONTENT_MANIFEST_OVERLAY`) follow the same index: when it lists the
 * overlay, the overlay is read before `enter`/`refresh` resolve and every asset registry in the page
 * merges it (`render/assets.ts` `setManifestOverlay`), so a catalog applied after it can name its models.
 *
 * A page that booted onto a server's baked world (`config.ts` `serverWorld`) starts on that server's
 * files, which the entry already loaded: entering the same server keeps them in use while the index
 * is read again for its models, so the world files never fall back to the asset host.
 */
export function createContentAssetOverlay(ports: { fetch?: typeof fetch; failed?(error: unknown): void } = {}) {
  let base: string | null = serverWorld()?.contentAssetUrl ?? null, loaded = base === null, request = 0;
  async function load(): Promise<void> {
    const ticket = ++request, from = base;
    if (from === null) { setContentAssetOverlay(null); setManifestOverlay(null); return; }
    try {
      const files = await fetchContentAssetIndex(from, ports.fetch ?? fetch);
      if (ticket !== request) return;
      loaded = true;
      setContentAssetOverlay({ base: from, files });
      const overlay = files[CONTENT_MANIFEST_OVERLAY] ? await readManifestOverlay(ports.fetch ?? fetch) : [];
      if (ticket === request) setManifestOverlay(overlay.length ? { entries: overlay } : null);
    } catch (error) { if (ticket === request) ports.failed?.(error); }
  }
  return {
    /** The server whose files are in use, or null. */
    get base(): string | null { return base; },
    enter(contentAssetUrl: string | undefined): Promise<void> {
      const next = contentAssetUrl ?? null;
      if (next === base) return loaded ? Promise.resolve() : load();
      if (next === null) { this.leave(); return Promise.resolve(); }
      // Another server's files are never used for this one, even while its index loads.
      setContentAssetOverlay(null); setManifestOverlay(null);
      base = next;
      return load();
    },
    refresh(): Promise<void> { return base === null ? Promise.resolve() : load(); },
    leave(): void { request++; base = null; setContentAssetOverlay(null); setManifestOverlay(null); },
  };
}
