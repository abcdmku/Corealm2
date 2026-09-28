import { assetReferencePools } from "../content/compiler/assetPools.js";
import type { ReferencePools } from "../content/compiler/references.js";
import type { ContentDiagnostic } from "../content/compiler/contracts.js";
import type { ContentAssetIndex } from "./contentAssetsContract.js";

/**
 * The asset ids a publish may reference: those of the asset host this server points its clients at.
 *
 * With an `assetBaseUrl` the manifest is `<assetBaseUrl>assets/manifest.json`, the same file the
 * client loads. It is cached for five seconds and then revalidated with its ETag, so a run of publishes
 * costs one download. Without one the server validates against the manifest it shipped with.
 *
 * Audio files are not in the manifest. A publish cannot check them against a remote host, so every
 * path the candidate audio catalog names is accepted; the schema still checks its shape.
 *
 * A server's own file store (`contentAssets.ts`) is the other half of what clients load: every path
 * in its index is accepted too, and a file a row names (a skin map) exists when the store or the
 * host tree has it.
 */
export interface AssetHostOptions {
  /** The public root of the asset host, ending in a slash. */
  assetBaseUrl?: string;
  /** The manifest shipped with this server, parsed. Read from the repo under tsx; M6 embeds it. */
  bundledManifest?(): Promise<unknown>;
  /** Whether the host tree this server ships with has a public path, such as `assets/skins/...`. Without it and without a remote host, paths are not checked. */
  bundledFile?(path: string): Promise<boolean>;
  /** This server's own files. */
  contentAssets?: { index(): Promise<ContentAssetIndex> };
  fetch?: typeof fetch;
  now?(): number;
}
export interface AssetHost {
  /** Where asset ids are checked: `remote`, `bundled`, or `none` when the host gave this server no manifest at all. */
  readonly source: "remote" | "bundled" | "none";
  pools(sources: Readonly<Record<string, unknown>>): Promise<ReferencePools>;
  /** The public paths (`assets/...`, `audio/...`) that neither this server's store nor the asset host has. */
  missingFiles(paths: readonly string[]): Promise<string[]>;
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

/** Every skin map the candidate sources name, as a public path, with where it is named. */
export function skinMapFiles(sources: Readonly<Record<string, unknown>>): { path: string; at: string }[] {
  const rows = Array.isArray(sources.creatureSkins) ? sources.creatureSkins as { id?: unknown; maps?: unknown }[] : [];
  return rows.flatMap((row, index) => row && typeof row.maps === "object" && row.maps
    ? Object.entries(row.maps as Record<string, unknown>).filter(([, map]) => typeof map === "string")
      .map(([material, map]) => ({ path: `assets/${String(map).replace(/^\/+/, "")}`, at: `creatureSkins[${index}].maps.${material}` }))
    : []);
}

/** One error per skin map that is nowhere a client could load it from. */
export async function missingSkinMaps(host: AssetHost, sources: Readonly<Record<string, unknown>>): Promise<ContentDiagnostic[]> {
  const files = skinMapFiles(sources);
  const missing = new Set(await host.missingFiles([...new Set(files.map(file => file.path))]));
  return files.filter(file => missing.has(file.path)).map(file => ({ path: file.at, severity: "error" as const,
    message: `The skin map ${file.path} is neither in this server's files nor on its asset host. Upload it first, then publish the skin.` }));
}

export function createAssetHost(options: AssetHostOptions): AssetHost {
  const now = options.now ?? Date.now, request = options.fetch ?? fetch;
  /** HEAD answers from the asset host, per path, for the manifest's cache time. */
  const probed = new Map<string, { found: boolean; at: number }>();
  async function onHost(path: string): Promise<boolean | null> {
    if (options.assetBaseUrl) {
      const hit = probed.get(path);
      if (hit && now() - hit.at < ASSET_MANIFEST_TTL_MS) return hit.found;
      let found: boolean;
      try {
        const response = await request(new URL(path, options.assetBaseUrl).href, { method: "HEAD", signal: AbortSignal.timeout(ASSET_MANIFEST_TIMEOUT_MS), redirect: "error", credentials: "omit" });
        if (response.status >= 500) throw new Error(String(response.status));
        found = response.ok;
      } catch { throw new AssetManifestFailure(`The asset host at ${options.assetBaseUrl} could not be asked for ${path}`); }
      probed.set(path, { found, at: now() });
      return found;
    }
    return options.bundledFile ? options.bundledFile(path) : null;
  }
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
      const stored = options.contentAssets ? Object.keys((await options.contentAssets.index()).files) : [];
      return { asset: new Set([...ids.asset!, ...audioFiles(sources.audio), ...stored]) };
    },
    async missingFiles(paths) {
      const stored = options.contentAssets ? (await options.contentAssets.index()).files : {};
      const missing: string[] = [];
      for (const path of paths) if (!Object.hasOwn(stored, path) && await onHost(path) === false) missing.push(path);
      return missing;
    },
  };
}
