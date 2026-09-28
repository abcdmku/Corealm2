/**
 * Files a live server stores itself (`/content-assets/<path>`), by path under the public tree, with
 * the hash that versions each URL. Server mode fills it from `GET /admin/files` and after each
 * `putFiles`; repo mode leaves it empty because its files are in the checkout beside the page.
 *
 * Kept free of three.js so light surfaces (thumbnails, icons) can ask it without loading the viewer.
 */
import { gameUrl } from "./gameUrl.js";
import type { AssetEntry } from "../../../game/src/render/assets.js";
import { parseManifestOverlay } from "../../../game/src/render/manifestOverlay.js";
import { CONTENT_MANIFEST_OVERLAY } from "../../../game/src/multiplayer/contentAssetsContract.js";

let contentFiles: { base: string; files: ReadonlyMap<string, string> } = { base: "", files: new Map() };
const listeners = new Set<() => void>();

export function setContentFiles(base: string, files: Readonly<Record<string, { sha256: string }>>): void {
  contentFiles = { base: base.replace(/\/*$/, "/"), files: new Map(Object.entries(files).map(([path, entry]) => [path, entry.sha256])) };
  for (const listener of listeners) listener();
}

/** A newer index of the same server, such as the answer to a `POST` or `DELETE /admin/files`. */
export function adoptContentIndex(files: Readonly<Record<string, { sha256: string }>>): void {
  setContentFiles(contentFiles.base, files);
}

/** Runs after each new file index, e.g. to reload the server's model overlay when its hash moved. */
export function onContentFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The stored file's hash, or undefined when the server does not hold the path. */
export function serverFileSha(path: string): string | undefined {
  return contentFiles.files.get(path.replace(/^\/+/, ""));
}

/** Where a game file loads from: the server's own store when it holds the path, the asset base otherwise. */
export function gameFileUrl(path: string): string {
  const relative = path.replace(/^\/+/, "");
  const sha = contentFiles.files.get(relative);
  return sha ? `${new URL(relative, contentFiles.base).href}?v=${sha.slice(0, 12)}` : gameUrl(relative);
}

/**
 * The models the server adds (its manifest overlay), read whenever the overlay's hash changes. The
 * viewer merges them into every asset registry; pickers and the asset list read them from here.
 */
let models: readonly AssetEntry[] = [];
let modelsSha: string | undefined;
let modelsLoad: Promise<void> = Promise.resolve();
const modelListeners = new Set<() => void>();

onContentFiles(() => {
  const sha = serverFileSha(CONTENT_MANIFEST_OVERLAY);
  if (sha !== modelsSha) { modelsSha = sha; modelsLoad = loadModels(sha); }
});

async function loadModels(sha: string | undefined): Promise<void> {
  let entries: AssetEntry[] = [];
  if (sha) try {
    const response = await fetch(gameFileUrl(CONTENT_MANIFEST_OVERLAY), { credentials: "omit" });
    if (response.ok) entries = parseManifestOverlay(await response.json());
  } catch (error) { console.warn("Could not read the server's model overlay", error); }
  if (serverFileSha(CONTENT_MANIFEST_OVERLAY) !== sha) return;
  models = entries;
  for (const listener of modelListeners) listener();
}

/** The server's own model entries, in overlay order; empty in repo mode. */
export function serverModels(): readonly AssetEntry[] { return models; }
export function subscribeServerModels(listener: () => void): () => void {
  modelListeners.add(listener);
  return () => { modelListeners.delete(listener); };
}
/** Settles once the overlay the latest file index names is read. */
export function serverModelsLoaded(): Promise<void> { return modelsLoad; }
