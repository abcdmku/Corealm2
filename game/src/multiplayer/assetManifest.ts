import { assetReferencePools } from "../content/compiler/assetPools.js";
import type { ReferencePools } from "../content/compiler/references.js";
import type { ContentDiagnostic } from "../content/compiler/contracts.js";
import { CONTENT_MANIFEST_OVERLAY, type ContentAssetIndex } from "./contentAssetsContract.js";
import { parseManifestOverlay } from "../render/manifestOverlay.js";
import { setMeasuredFootprints } from "../content/worldCreatureResolver.js";
import { CREATURE_MOTION_TIMING } from "../content/creatureMotionTiming.js";
import type { AssetEntry } from "../render/assets.js";

/**
 * The asset ids a publish may reference: those of the asset host this server points its clients at.
 *
 * With an `assetBaseUrl` the manifest is `<assetBaseUrl>assets/manifest.json`, the same file the
 * client loads. It is cached for five seconds and then revalidated with its ETag, so a run of publishes
 * costs one download. Without one the server validates against the manifest it shipped with.
 *
 * Audio files are not in the manifest, so every path the candidate audio catalog names is accepted
 * as a reference; `missingAudioFiles` then checks each file exists, the way `missingSkinMaps` does.
 *
 * A server's own file store (`contentAssets.ts`) is the other half of what clients load: every path
 * in its index is accepted too, and a file a row names (a skin map) exists when the store or the
 * host tree has it.
 *
 * The store's model overlay (`CONTENT_MANIFEST_OVERLAY`) adds manifest entries: their ids are accepted,
 * and each one's measured size is its encounter footprint (`setMeasuredFootprints`), so a creature on
 * a model the server added compiles instead of lacking one.
 */
export interface AssetHostOptions {
  /** The public root of the asset host, ending in a slash. */
  assetBaseUrl?: string;
  /** The manifest shipped with this server, parsed. Read from the repo under tsx; M6 embeds it. */
  bundledManifest?(): Promise<unknown>;
  /** Whether the host tree this server ships with has a public path, such as `assets/skins/...`. Without it and without a remote host, paths are not checked. */
  bundledFile?(path: string): Promise<boolean>;
  /** This server's own files. */
  contentAssets?: ServerFiles;
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

/** What the asset host reads of a server's file store (`contentAssets.ts`). */
export interface ServerFiles {
  index(): Promise<ContentAssetIndex>;
  read?(path: string): Promise<{ bytes: Uint8Array } | null>;
}

/**
 * The models a server's store adds, parsed, with their footprints put where the content compiler
 * finds them. A publish reads it before every compile; a server calls it once before it checks its
 * stored content at start. A store without an overlay adds none and clears the footprints.
 */
export async function serverModelOverlay(files: ServerFiles): Promise<AssetEntry[]> {
  const entries = await readModelOverlay(files);
  setMeasuredFootprints(entries);
  setOverlayMotionTiming(entries);
  return entries;
}

/** The store's overlay entries, parsed, without side effects. */
async function readModelOverlay(files: ServerFiles, index?: ContentAssetIndex): Promise<AssetEntry[]> {
  const listed = index ?? await files.index();
  const stored = Object.hasOwn(listed.files, CONTENT_MANIFEST_OVERLAY) && files.read ? await files.read(CONTENT_MANIFEST_OVERLAY) : null;
  if (!stored) return [];
  try { return parseManifestOverlay(JSON.parse(Buffer.from(stored.bytes).toString("utf8"))); }
  catch { throw new AssetManifestFailure(`This server's ${CONTENT_MANIFEST_OVERLAY} is not JSON`); }
}

/**
 * Attack timing of the creature models a server added, where the server's combat reads the build's
 * (`CREATURE_MOTION_TIMING`, keyed by asset id): each overlay entry with a measured `attackSeconds`
 * and `contactNormalized` (recorded at upload) is timed like a build model. An overlay entry that
 * replaces a build model's id wins; the build's timing comes back when the entry goes.
 */
const replacedTiming = new Map<string, { seconds: number; contactNormalized: number } | undefined>();
export function setOverlayMotionTiming(entries: readonly AssetEntry[]): void {
  for (const [id, original] of replacedTiming) {
    if (original) CREATURE_MOTION_TIMING[id] = original; else delete CREATURE_MOTION_TIMING[id];
  }
  replacedTiming.clear();
  for (const entry of entries) {
    const { attackSeconds: seconds, contactNormalized } = entry;
    if (!(typeof seconds === "number" && seconds > 0 && typeof contactNormalized === "number" && contactNormalized > 0 && contactNormalized < 1)) continue;
    if (!replacedTiming.has(entry.id)) replacedTiming.set(entry.id, CREATURE_MOTION_TIMING[entry.id]);
    CREATURE_MOTION_TIMING[entry.id] = { seconds, contactNormalized };
  }
}

/** The icon an item draws (`ui/itemIcons.ts` `itemIconUrl`): its base id, with the crafted sets that swapped art. */
function itemArtworkId(id: string): string {
  const base = /^(.+)__r(?:10|[1-9])(?:__[a-z]+)?$/.exec(id)?.[1] ?? id;
  const swapped = /^(dragonhide|starhide)_(hood|robe|leggings|boots|wraps)$/.exec(base);
  return swapped ? `${swapped[1] === "dragonhide" ? "starhide" : "dragonhide"}_${swapped[2]}` : base;
}

const rowLabel = (collection: string, row: unknown, index: number): string => {
  const id = row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
  return `${collection}/${typeof id === "string" ? id : index}`;
};

export interface FileReferencePorts {
  /** The ACTIVE catalog's source collections (`CatalogStorage.sources()`), or null before the first seed. */
  sources(): Promise<Readonly<Record<string, unknown>> | null>;
  files: ServerFiles;
  /**
   * The asset host alone (`createAssetHost` without `contentAssets`): an item icon the host also
   * serves may be removed, since players fall back to it. Absent, every stored icon of an item is kept.
   */
  host?: Pick<AssetHost, "missingFiles">;
}

/**
 * The files of this server's store that the active content still names, with the records naming
 * each, for the store's remove guard (`ContentAssetStoreOptions.references`):
 *
 * - skin maps (`creatureSkins[].maps`) and `audio/...` files the audio table names;
 * - item icons (`assets/icons/items/<size>/<artwork>.png`) of existing items, when the asset host
 *   does not also have that icon;
 * - model files of overlay entries whose id a row names (and, for a model stored in its own folder,
 *   every file in that folder), and the overlay itself while any of its models is named.
 *
 * Only paths the store holds are listed. Every call reads the active sources again.
 */
export function activeFileReferences(ports: FileReferencePorts): () => Promise<Map<string, string[]>> {
  return async () => {
    const index = await ports.files.index();
    const stored = new Set(Object.keys(index.files));
    const found = new Map<string, string[]>();
    const add = (path: string, by: string): void => {
      if (!stored.has(path)) return;
      const list = found.get(path) ?? found.set(path, []).get(path)!;
      if (!list.includes(by)) list.push(by);
    };
    const sources = await ports.sources();
    if (!sources) return found;

    const skins = Array.isArray(sources.creatureSkins) ? sources.creatureSkins : [];
    skins.forEach((row, at) => {
      const maps = row && typeof row === "object" ? (row as { maps?: unknown }).maps : undefined;
      if (maps && typeof maps === "object") for (const map of Object.values(maps)) if (typeof map === "string") add(`assets/${map.replace(/^\/+/, "")}`, rowLabel("creatureSkins", row, at));
    });

    if (sources.audio && typeof sources.audio === "object") for (const [group, entries] of Object.entries(sources.audio)) {
      const named = entries && typeof entries === "object" ? Object.entries(entries) : [["", entries] as const];
      for (const [name, value] of named) for (const path of audioFiles(value)) add(path, `audio/${group}${name ? `/${name}` : ""}`);
    }

    const items = Array.isArray(sources.items) ? sources.items : [];
    const byArtwork = new Map<string, string[]>();
    items.forEach((row, at) => {
      const id = row && typeof row === "object" ? (row as { id?: unknown }).id : undefined;
      if (typeof id !== "string") return;
      const artwork = itemArtworkId(id);
      (byArtwork.get(artwork) ?? byArtwork.set(artwork, []).get(artwork)!).push(rowLabel("items", row, at));
    });
    const icons = [...stored].flatMap(path => {
      const artwork = /^assets\/icons\/items\/\d+\/([^/]+)\.png$/.exec(path)?.[1];
      return artwork && byArtwork.has(artwork) ? [{ path, artwork }] : [];
    });
    const onlyHere = new Set(ports.host ? await ports.host.missingFiles(icons.map(icon => icon.path)) : icons.map(icon => icon.path));
    for (const icon of icons) if (onlyHere.has(icon.path)) for (const by of byArtwork.get(icon.artwork)!) add(icon.path, by);

    const overlay = await readModelOverlay(ports.files, index);
    if (overlay.length) {
      const ids = new Set(overlay.map(entry => entry.id));
      const users = new Map<string, Set<string>>();
      const walk = (value: unknown, label: string): void => {
        if (typeof value === "string") { if (ids.has(value)) (users.get(value) ?? users.set(value, new Set()).get(value)!).add(label); }
        else if (Array.isArray(value)) value.forEach(entry => walk(entry, label));
        else if (value && typeof value === "object") Object.values(value).forEach(entry => walk(entry, label));
      };
      for (const [collection, rows] of Object.entries(sources)) {
        if (Array.isArray(rows)) rows.forEach((row, at) => walk(row, rowLabel(collection, row, at)));
        else walk(rows, collection);
      }
      for (const entry of overlay) {
        const by = users.get(entry.id);
        if (!by) continue;
        const file = `assets/${entry.file}`, folder = file.slice(0, file.lastIndexOf("/") + 1);
        const own = folder.endsWith(`/${entry.id}/`) ? [...stored].filter(path => path.startsWith(folder)) : [file];
        for (const label of by) {
          for (const path of new Set([file, ...own])) add(path, label);
          add(CONTENT_MANIFEST_OVERLAY, label);
        }
      }
    }
    return found;
  };
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

/**
 * One error per skin map that is nowhere a client could load it from. Maps the running catalog
 * already names (the base game's, or a skin published before) were checked when they arrived, so
 * only new paths are probed, as `missingAudioFiles` does.
 */
export async function missingSkinMaps(host: AssetHost, sources: Readonly<Record<string, unknown>>, running?: unknown): Promise<ContentDiagnostic[]> {
  const known = new Set(skinMapFiles({ creatureSkins: running }).map(file => file.path));
  const files = skinMapFiles(sources).filter(file => !known.has(file.path));
  const missing = new Set(await host.missingFiles([...new Set(files.map(file => file.path))]));
  return files.filter(file => missing.has(file.path)).map(file => ({ path: file.at, severity: "error" as const,
    message: `The skin map ${file.path} is neither in this server's files nor on its asset host. Upload it first, then publish the skin.` }));
}

/**
 * One error per `audio/…` file the candidate audio catalog names that is nowhere a client could
 * load it from: neither this server's files nor the asset host (probed with HEAD, or the tree this
 * server ships with). A cue or loop that names a missing file plays nothing.
 *
 * Only paths `running` (the active audio table) does not name are asked about: the catalog names
 * about a hundred files, and each is a HEAD to a remote host, so a publish checks what it adds.
 */
export async function missingAudioFiles(host: AssetHost, sources: Readonly<Record<string, unknown>>, running?: unknown): Promise<ContentDiagnostic[]> {
  const known = new Set(audioFiles(running));
  const named: { path: string; at: string }[] = [];
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") { if (value.startsWith("audio/") && !known.has(value)) named.push({ path: value, at }); }
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${at}[${index}]`));
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) walk(entry, `${at}.${key}`);
  };
  walk(sources.audio, "audio");
  const missing = new Set(await host.missingFiles([...new Set(named.map(file => file.path))]));
  return named.filter(file => missing.has(file.path)).map(file => ({ path: file.at, severity: "error" as const,
    message: `The audio file ${file.path} is neither in this server's files nor on its asset host. Upload it first, then publish the sound.` }));
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
      const models = options.contentAssets ? (await serverModelOverlay(options.contentAssets)).map(entry => entry.id) : [];
      return { asset: new Set([...ids.asset!, ...audioFiles(sources.audio), ...stored, ...models]) };
    },
    async missingFiles(paths) {
      const stored = options.contentAssets ? (await options.contentAssets.index()).files : {};
      const missing: string[] = [];
      for (const path of paths) if (!Object.hasOwn(stored, path) && await onHost(path) === false) missing.push(path);
      return missing;
    },
  };
}
