/**
 * What this page is here to play, and how it remembers.
 *
 * Three answers feed the loading-screen picker, and all three are plain data so they can be decided
 * and tested without a browser:
 *
 *  - `?play=` — a harness or a bookmark naming its target, which skips the picker entirely.
 *  - the last choice, in `localStorage`, which preselects a row but never joins on its own.
 *  - a pending launch, in `sessionStorage`, which is how the page changes asset host or baked world:
 *    the choice is written down, the page reloads, and the second boot sets the base, the catalog and
 *    the world files before the first fetch.
 *
 * Nothing here touches the DOM beyond the two storages, and every read tolerates a browser that
 * refuses them (private mode, a sandboxed frame) by answering as if nothing were stored.
 */
import type { WorldDescriptor } from "../contracts.js";
import { CATALOG_REVISION } from "../content/clientCatalog.js";
import { catalogUrl } from "./clientCatalogFetch.js";
import { SessionFailure, WORLD_REVISION } from "./protocol.js";

/** A world is named `<providerId>/<worldId>`, which is the pair `worldKey` is built from. */
export type PlayTarget =
  | { readonly kind: "local" }
  | { readonly kind: "world"; readonly providerId: string; readonly worldId: string }
  /** Something was asked for that cannot name a world. The picker shows, and says so. */
  | { readonly kind: "invalid"; readonly value: string };

/** Ids come from world descriptors and directory URLs, so they are short and have no separators. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const LAST_CHOICE_KEY = "corealm.play.v1";
const PENDING_LAUNCH_KEY = "corealm.play.pending.v1";

/** `local`, `<providerId>/<worldId>`, or nothing. The same spelling as `?play=` and the stored choice. */
export function parsePlayTarget(value: string | null | undefined): PlayTarget | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  if (text === "local") return { kind: "local" };
  const slash = text.indexOf("/");
  const providerId = text.slice(0, slash), worldId = text.slice(slash + 1);
  if (slash <= 0 || !ID.test(providerId) || !ID.test(worldId)) return { kind: "invalid", value: text.slice(0, 120) };
  return { kind: "world", providerId, worldId };
}

/** The `play` parameter of a page URL. */
export function playTargetOf(search: string | URLSearchParams): PlayTarget | null {
  return parsePlayTarget((typeof search === "string" ? new URLSearchParams(search) : search).get("play"));
}

/** How a target is written down, in a URL or in storage. Invalid targets are never written. */
export function playTargetText(target: PlayTarget): string | null {
  return target.kind === "local" ? "local" : target.kind === "world" ? `${target.providerId}/${target.worldId}` : null;
}

/** What this browser played last. Local until it says otherwise: a first visit has nothing to join. */
export function lastPlayChoice(): PlayTarget {
  let stored: string | null = null;
  try { stored = localStorage.getItem(LAST_CHOICE_KEY); } catch { /* Private mode: this session starts fresh. */ }
  const target = parsePlayTarget(stored);
  return target === null || target.kind === "invalid" ? { kind: "local" } : target;
}

/** Remembered on every commit, never on a hover or an arrow key: it decides where focus starts next time. */
export function rememberPlayChoice(target: PlayTarget): void {
  const text = playTargetText(target);
  if (text === null) return;
  try { localStorage.setItem(LAST_CHOICE_KEY, text); } catch { /* Private mode: the choice still holds this session. */ }
}

/**
 * A world the page is reloading in order to reach, with what the second boot needs before its first
 * fetch: the asset host it named, and the world geometry its server baked for itself.
 *
 * `attempts` counts the reloads already spent on it. One is allowed: if the second boot still finds
 * the host or the world foreign, it could not be taken and reloading again would only loop.
 */
export interface PendingLaunch {
  readonly providerId: string;
  readonly worldId: string;
  /** Absent: the page's own deployment directory. */
  readonly assetBaseUrl?: string;
  /** Absent: the build's own baked world. */
  readonly world?: PendingServerWorld;
  readonly attempts: number;
}

/**
 * A world whose geometry the server baked (`WorldDescriptor.worldRevision`). The entry installs the
 * server's client catalog from `catalogUrl` and reads its file index at `contentAssetUrl` before any
 * content module evaluates, so terrain, scatter and the navmesh are built from the server's rows and
 * `generated/...` resolves to the server's files (`content/catalogEntry.ts`).
 */
export interface PendingServerWorld {
  readonly revision: string;
  readonly contentAssetUrl: string;
  readonly catalogUrl: string;
  readonly catalogRevision: string;
}

const HTTP = /^https?:\/\//i;
function pendingServerWorld(value: unknown): PendingServerWorld | null {
  if (typeof value !== "object" || value === null) return null;
  const { revision, contentAssetUrl, catalogUrl, catalogRevision } = value as Record<string, unknown>;
  if (typeof revision !== "string" || !WORLD_REVISION.test(revision)) return null;
  if (typeof contentAssetUrl !== "string" || !HTTP.test(contentAssetUrl) || typeof catalogUrl !== "string" || !HTTP.test(catalogUrl)) return null;
  if (typeof catalogRevision !== "string" || !CATALOG_REVISION.test(catalogRevision)) return null;
  return { revision, contentAssetUrl, catalogUrl, catalogRevision };
}

function parsePendingLaunch(raw: string | null): PendingLaunch | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { providerId, worldId, assetBaseUrl, world, attempts } = value as Record<string, unknown>;
    if (typeof providerId !== "string" || typeof worldId !== "string" || !ID.test(providerId) || !ID.test(worldId)) return null;
    if (assetBaseUrl !== undefined && (typeof assetBaseUrl !== "string" || !HTTP.test(assetBaseUrl))) return null;
    const serverWorld = world === undefined ? null : pendingServerWorld(world);
    if (world !== undefined && serverWorld === null) return null;
    return { providerId, worldId,
      ...(assetBaseUrl === undefined ? {} : { assetBaseUrl }), ...(serverWorld ? { world: serverWorld } : {}),
      attempts: typeof attempts === "number" && Number.isSafeInteger(attempts) ? attempts : 0 };
  } catch { return null; }
}

/** Read and clear, so a boot that fails on the way to the world does not repeat forever. */
export function takePendingLaunch(): PendingLaunch | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING_LAUNCH_KEY); sessionStorage.removeItem(PENDING_LAUNCH_KEY); }
  catch { return null; }
  return parsePendingLaunch(raw);
}

/**
 * Read without clearing: the entry asks which world the page is reloading onto before it installs
 * a catalog, and boot takes the launch afterwards, as it always has.
 */
export function peekPendingLaunch(): PendingLaunch | null {
  try { return parsePendingLaunch(sessionStorage.getItem(PENDING_LAUNCH_KEY)); }
  catch { return null; }
}

/** Written immediately before `location.reload()`, and only then. */
export function storePendingLaunch(launch: PendingLaunch): void {
  try { sessionStorage.setItem(PENDING_LAUNCH_KEY, JSON.stringify(launch)); }
  catch { /* Without session storage the reload would forget why it happened, so the caller must not reload. */ }
}

/** True when `storePendingLaunch` will survive a reload. A page that cannot store must not reload. */
export function canStorePendingLaunch(): boolean {
  try {
    sessionStorage.setItem(`${PENDING_LAUNCH_KEY}.probe`, "1");
    sessionStorage.removeItem(`${PENDING_LAUNCH_KEY}.probe`);
    return true;
  } catch { return false; }
}

/**
 * Whether this page can read a world's asset host, asked before reloading onto it.
 *
 * The reloaded boot fetches the manifest first and has no way back if that fails: a host without
 * `Access-Control-Allow-Origin` surfaced as a bare "Failed to fetch" on the loading screen. A CORS
 * `HEAD` for the same file fails the same way, while this page can still say which world and why.
 */
export async function assetHostReadable(assetBaseUrl: string, fetcher: typeof fetch = fetch, timeoutMs = 8_000): Promise<boolean> {
  try {
    const response = await fetcher(new URL("assets/manifest.json", assetBaseUrl).href,
      { method: "HEAD", mode: "cors", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch { return false; }
}

/** What joining a world costs this page. */
export type JoinRoute = "join" | "reload" | "refuse";

/**
 * Whether this page can join the world as it stands, has to reload onto the world's asset host or
 * its baked world first, or cannot reach it at all.
 *
 * Boot resolves the asset base from the page's own deployment and starts fetching immediately, so
 * by the time a world is chosen the `AssetRegistry`, the shipped world records and the manifest are
 * all pinned to that origin. Re-pointing a live registry would leave a session holding half its
 * models from each host, which is why the answer is a reload rather than a rebase. A world whose
 * geometry differs is the same: terrain, scatter and the navmesh are built once, before a choice.
 *
 * `rebaseAttempts` is what the pending launch carried into this boot. One reload is allowed: if the
 * host or world is still foreign afterwards the page pinned its own base, or the world's files are
 * unusable, and reloading again would only loop.
 */
export function joinRoute(page: { assetHostForeign: boolean; worldForeign?: boolean; rebaseAttempts: number; canStore: boolean }): JoinRoute {
  if (!page.assetHostForeign && page.worldForeign !== true) return "join";
  return page.rebaseAttempts === 0 && page.canStore ? "reload" : "refuse";
}

/**
 * What a reload onto `world` carries about its geometry: nothing for the build's own world, else
 * where the second boot reads the server's catalog and files. Throws when the world names a baked
 * world it does not say how to reach.
 */
export function launchWorld(world: WorldDescriptor, buildRevision: string): PendingServerWorld | undefined {
  if (world.worldRevision === undefined || world.worldRevision === buildRevision) return undefined;
  if (world.contentAssetUrl === undefined || world.catalogRevision === undefined)
    throw new SessionFailure("INCOMPATIBLE", `${world.name} runs its own world but does not say where its files are.`);
  return { revision: world.worldRevision, contentAssetUrl: world.contentAssetUrl,
    catalogUrl: catalogUrl(world.endpoint, world.catalogRevision), catalogRevision: world.catalogRevision };
}

/**
 * True when joining `world` means another baked world than the one this page built its scene from.
 * A world that names no revision runs the build's; the page runs a server's only after reloading onto it.
 */
export function worldForeign(page: { buildRevision: string; serverRevision: string | null }, world: { worldRevision?: string }): boolean {
  return (world.worldRevision ?? page.buildRevision) !== (page.serverRevision ?? page.buildRevision);
}
