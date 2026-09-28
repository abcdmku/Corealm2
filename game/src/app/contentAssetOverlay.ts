import { CONTENT_ASSET_PATH } from "../multiplayer/contentAssetsContract.js";
import { setContentAssetOverlay } from "./config.js";

/** The largest index a page reads. Tens of thousands of files, far past what a server authors. */
export const MAX_CONTENT_ASSET_INDEX_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;

/** The entries of an index a client may use: contract paths with a sha256. Anything else is dropped, never trusted. */
export function contentAssetFiles(value: unknown): Record<string, { sha256: string }> {
  const files = (value as { files?: unknown } | null)?.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("A content asset index is {revision, files}");
  const kept: Record<string, { sha256: string }> = {};
  for (const [path, entry] of Object.entries(files as Record<string, unknown>)) {
    const sha256 = (entry as { sha256?: unknown } | null)?.sha256;
    if (CONTENT_ASSET_PATH.test(path) && typeof sha256 === "string" && SHA256.test(sha256)) kept[path] = { sha256 };
  }
  return kept;
}

/**
 * Keeps `config.ts`'s overlay on the files of the world the page is in: `enter` with the joined
 * world's `contentAssetUrl` loads `index.json`, `refresh` reloads it after a `content-updated`, and
 * `leave` clears it. A load that finishes after the page left, or joined elsewhere, is dropped. A
 * failed load leaves the asset host's files in use and reports it.
 */
export function createContentAssetOverlay(ports: { fetch?: typeof fetch; failed?(error: unknown): void } = {}) {
  let base: string | null = null, request = 0;
  async function load(): Promise<void> {
    const ticket = ++request, from = base;
    if (from === null) { setContentAssetOverlay(null); return; }
    try {
      const response = await (ports.fetch ?? fetch)(new URL("index.json", from).href, { cache: "no-cache", credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error(`${from}index.json answered ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_CONTENT_ASSET_INDEX_BYTES) throw new Error(`${from}index.json is too large`);
      const files = contentAssetFiles(JSON.parse(text));
      if (ticket === request) setContentAssetOverlay({ base: from, files });
    } catch (error) { if (ticket === request) ports.failed?.(error); }
  }
  return {
    /** The server whose files are in use, or null. */
    get base(): string | null { return base; },
    enter(contentAssetUrl: string | undefined): Promise<void> {
      const next = contentAssetUrl ?? null;
      if (next === base) return Promise.resolve();
      if (next === null) { this.leave(); return Promise.resolve(); }
      // Another server's files are never used for this one, even while its index loads.
      setContentAssetOverlay(null);
      base = next;
      return load();
    },
    refresh(): Promise<void> { return base === null ? Promise.resolve() : load(); },
    leave(): void { request++; base = null; setContentAssetOverlay(null); },
  };
}
