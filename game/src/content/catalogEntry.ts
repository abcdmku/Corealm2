import { installCatalog, type InstalledCatalog } from "./catalogInstall.js";
import { LOCAL_WORLD_MANIFEST, parseLocalWorldManifest, type LocalWorldManifest } from "../worker/localHostProtocol.js";

/**
 * The page's catalog, fetched and installed before the app is imported.
 *
 * About 140 modules read content tables as they are evaluated, so the entry (`main.ts`) installs a
 * catalog first and only then `import()`s the app. This module and everything it imports evaluate
 * no content, which is what lets the entry import it statically.
 *
 * Which catalog depends on the page. The authored game is a thin client: it installs the CLIENT
 * projection (`clientCatalog.ts`), and a joined server's revision is laid over it later. A feature
 * lab, the world bake, the map capture and the navmesh bake assemble a world on the page (a lab
 * posts whole entities to its worker, the bake writes spawn placement), so those authoring surfaces
 * install the full catalog the manifest names for the worker. Neither is ever bundled.
 */
export type PageCatalogKind = "client" | "full";

/** Decided from the URL alone, because the boot profile module evaluates content. Mirrors `bootProfileFor`: a `mode` is a lab. */
export function pageCatalogKind(search: string): PageCatalogKind {
  const params = new URLSearchParams(search);
  const mode = params.get("mode");
  const authoring = mode === "combat" || mode === "building" || ["world-bake", "world-map-capture", "navmesh-bake"].some(flag => params.get(flag) === "1");
  return authoring ? "full" : "client";
}

/** The manifest the entry fetched, kept for `localLaunch` so local play does not fetch it a second time. */
interface SharedManifest { url: string; manifest: LocalWorldManifest }
const SHARED = Symbol.for("corealm.localWorldManifest");
export function sharedLocalWorldManifest(url: string): LocalWorldManifest | null {
  const shared = (globalThis as Record<symbol, unknown>)[SHARED] as SharedManifest | undefined;
  return shared?.url === url ? shared.manifest : null;
}

/** `startedAtMs` is on the page clock (`performance.now()`), for the boot telemetry span. */
export interface InstalledPageCatalog { kind: PageCatalogKind; revision: string; file: string; bytes: number; startedAtMs: number; manifestMs: number; catalogMs: number }

/**
 * Fetch the manifest (never cached) and the catalog it names (cached for good), and install it.
 * Throws with a sentence a player can read: the entry shows it beside a Retry button.
 */
export async function installPageCatalog(generatedBase: string, kind: PageCatalogKind, fetcher: typeof fetch = fetch): Promise<InstalledPageCatalog> {
  const started = performance.now();
  const manifestUrl = new URL(LOCAL_WORLD_MANIFEST, generatedBase).href;
  const get = async (url: string, init: RequestInit, what: string): Promise<unknown> => {
    let response: Response;
    try { response = await fetcher(url, { credentials: "omit", ...init }); }
    catch { throw new Error(`The game's ${what} could not be downloaded. Check your connection and try again.`); }
    if (!response.ok) throw new Error(`The game's ${what} could not be downloaded (the host answered ${response.status}).`);
    try { return await response.json(); }
    catch { throw new Error(`The game's ${what} arrived damaged. Try again.`); }
  };
  const listed = await get(manifestUrl, { cache: "no-cache" }, "file list");
  let manifest: LocalWorldManifest;
  try { manifest = parseLocalWorldManifest(listed); }
  catch { throw new Error("The game's file list does not match this build. The host may be part way through an update: try again in a moment."); }
  (globalThis as Record<symbol, unknown>)[SHARED] = { url: manifestUrl, manifest } satisfies SharedManifest;
  const manifestMs = performance.now() - started;
  const named = kind === "client" ? manifest.clientCatalog : manifest.catalog;
  const catalog = await get(new URL(named.file, generatedBase).href, {}, "content") as Partial<InstalledCatalog> | null;
  if (!catalog || catalog.version !== 1 || catalog.revision !== named.revision || typeof catalog.tables !== "object" || catalog.tables === null) {
    throw new Error("The game's content does not match this build. Reload the page.");
  }
  // The client projection carries no formula revision: only a host compiles a publish.
  installCatalog({ version: 1, revision: catalog.revision, formulaRevision: catalog.formulaRevision ?? "", tables: catalog.tables });
  return { kind, revision: named.revision, file: named.file, bytes: named.bytes, startedAtMs: started, manifestMs, catalogMs: performance.now() - started - manifestMs };
}
