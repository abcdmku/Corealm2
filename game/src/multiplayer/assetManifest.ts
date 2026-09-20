import { assetReferencePools } from "../content/compiler/assetPools.js";
import type { ReferencePools } from "../content/compiler/references.js";

/**
 * The asset ids a publish may reference: those of the asset host this server points its clients at.
 *
 * With an `assetBaseUrl` the manifest is `<assetBaseUrl>assets/manifest.json`, the same file the
 * client loads. It is cached for five seconds and then revalidated with its ETag, so a run of publishes
 * costs one download. Without one the server validates against the manifest it shipped with.
 *
 * Audio files are not in the manifest. A publish cannot check them against a remote host, so every
 * path the candidate audio catalog names is accepted; the schema still checks its shape.
 */
export interface AssetHostOptions {
  /** The public root of the asset host, ending in a slash. */
  assetBaseUrl?: string;
  /** The manifest shipped with this server, parsed. Read from the repo under tsx; M6 embeds it. */
  bundledManifest?(): Promise<unknown>;
  fetch?: typeof fetch;
  now?(): number;
}
export interface AssetHost {
  /** Where asset ids are checked: `remote`, `bundled`, or `none` when the host gave this server no manifest at all. */
  readonly source: "remote" | "bundled" | "none";
  pools(sources: Readonly<Record<string, unknown>>): Promise<ReferencePools>;
}

export const ASSET_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
export const ASSET_MANIFEST_TIMEOUT_MS = 10_000;
export const ASSET_MANIFEST_TTL_MS = 5_000;

export class AssetManifestFailure extends Error {
  constructor(message: string) { super(message); this.name = "AssetManifestFailure"; }
}

/** Every `audio/…` path in the candidate audio catalog. */
export function audioFiles(catalog: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") { if (value.startsWith("audio/")) found.push(value); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(catalog);
  return found;
}

async function limitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new AssetManifestFailure("The asset host sent an empty manifest");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > ASSET_MANIFEST_MAX_BYTES) { await reader.cancel().catch(() => {}); throw new AssetManifestFailure("The asset manifest exceeds the size limit"); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createAssetHost(options: AssetHostOptions): AssetHost {
  const now = options.now ?? Date.now, request = options.fetch ?? fetch;
  let cached: { ids: ReferencePools; etag: string | null; at: number } | null = null;
  async function remote(url: string): Promise<ReferencePools> {
    if (cached && now() - cached.at < ASSET_MANIFEST_TTL_MS) return cached.ids;
    let response: Response;
    try {
      response = await request(url, { signal: AbortSignal.timeout(ASSET_MANIFEST_TIMEOUT_MS), redirect: "error", credentials: "omit",
        headers: cached?.etag ? { "If-None-Match": cached.etag } : {} });
    } catch { throw new AssetManifestFailure(`The asset manifest at ${url} could not be fetched`); }
    if (response.status === 304 && cached) { cached.at = now(); return cached.ids; }
    if (!response.ok) throw new AssetManifestFailure(`The asset manifest at ${url} answered ${response.status}`);
    let ids: ReferencePools;
    try { ids = assetReferencePools(JSON.parse(await limitedText(response))); }
    catch (error) { throw error instanceof AssetManifestFailure ? error : new AssetManifestFailure(`The asset manifest at ${url} is not a manifest`); }
    cached = { ids, etag: response.headers.get("etag"), at: now() };
    return ids;
  }
  const source = options.assetBaseUrl ? "remote" : options.bundledManifest ? "bundled" : "none";
  return { source,
    async pools(sources) {
      if (source === "none") return {};
      const ids = options.assetBaseUrl ? await remote(new URL("assets/manifest.json", options.assetBaseUrl).href)
        : cached?.ids ?? (cached = { ids: assetReferencePools(await options.bundledManifest!()), etag: null, at: now() }).ids;
      return { asset: new Set([...ids.asset!, ...audioFiles(sources.audio)]) };
    },
  };
}
