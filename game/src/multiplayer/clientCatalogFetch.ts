import { CATALOG_REVISION, parseClientCatalog, type ClientCatalog } from "../content/clientCatalog.js";
import { overlayClientCatalog, type OverlayRegistry } from "../content/clientCatalogOverlay.js";
import type { SessionCatalog } from "../contracts.js";
import { endpoint as checkedEndpoint, SessionFailure } from "./protocol.js";

/** The largest client catalog a page will read. The shipped one is about 1.3 MB. */
export const MAX_CLIENT_CATALOG_BYTES = 16 * 1024 * 1024;
const CACHE_NAME = "corealm-catalog-v1";

/** `GET /catalog/<revision>` lives beside the socket: same host, http for ws and https for wss. */
export function catalogUrl(endpoint: string, revision: string): string {
  if (!CATALOG_REVISION.test(revision)) throw new SessionFailure("INVALID_MESSAGE", "Invalid catalog revision");
  const url = new URL(checkedEndpoint(endpoint));
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return new URL(`catalog/${revision}`, url).href;
}

/** One revision at one server. */
export interface CatalogAddress { url: string; revision: string }

/** What a socket session offers: the catalog beside its endpoint, through the page's cache. `url` is kept for diagnosis. */
export function socketSessionCatalog(endpoint: string, revision: string, ports: CatalogFetchPorts = {}): SessionCatalog & { url: string } {
  const url = catalogUrl(endpoint, revision);
  return { revision, url, load: signal => fetchClientCatalog({ url, revision }, ports, signal) };
}

export interface CatalogFetchPorts {
  fetch?: typeof fetch;
  /** The Cache API when the page has one. It is absent outside a secure context, where the HTTP cache still holds the immutable reply. */
  caches?: Pick<CacheStorage, "open">;
}

async function limitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw new SessionFailure("UNAVAILABLE", "The server sent an empty catalog");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > MAX_CLIENT_CATALOG_BYTES) { await reader.cancel(); throw new SessionFailure("INVALID_MESSAGE", "The server's catalog is too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/**
 * The client catalog of one revision, from the page's cache or the server. A revision is a content
 * hash and its reply is immutable, so a cached copy is never revalidated, and storing a new revision
 * drops this server's older ones. Only a reply that parses is cached.
 */
export async function fetchClientCatalog({ url, revision }: CatalogAddress, ports: CatalogFetchPorts = {}, signal?: AbortSignal): Promise<ClientCatalog> {
  const stores = ports.caches ?? (globalThis as { caches?: CacheStorage }).caches;
  const cache = await stores?.open(CACHE_NAME).catch(() => undefined);
  const cached = await cache?.match(url);
  if (cached) try { return parseClientCatalog(JSON.parse(await cached.text()), revision); } catch { await cache!.delete(url); }
  const response = await (ports.fetch ?? fetch)(url, { signal, credentials: "omit", redirect: "error" });
  if (!response.ok) throw new SessionFailure("UNAVAILABLE", `The server has no catalog ${revision.slice(0, 12)}`);
  const text = await limitedText(response);
  let catalog: ClientCatalog;
  try { catalog = parseClientCatalog(JSON.parse(text), revision); } catch { throw new SessionFailure("INVALID_MESSAGE", "The server sent an invalid catalog"); }
  if (cache) {
    const prefix = url.slice(0, -revision.length);
    for (const request of await cache.keys()) if (request.url.startsWith(prefix) && request.url !== url) await cache.delete(request);
    await cache.put(url, new Response(text, { headers: { "Content-Type": "application/json" } })).catch(() => {});
  }
  return catalog;
}

/**
 * Keeps the content registry on the revision of the world the page is connected to. Entering a
 * world loads its client catalog from the session, whatever carries it, and overlays it. Leaving
 * undoes the overlay, so the page is back on the build's own tables. A load that finishes after the
 * player left, or joined elsewhere, is dropped.
 */
export function createServerCatalogOverlay(registry: OverlayRegistry, ports: { failed?(error: unknown): void } = {}) {
  let applied: { revision: string; undo(): void } | null = null, request = 0;
  const leave = (): void => { request++; applied?.undo(); applied = null; };
  return {
    /** The revision the registry shows now, or null while it shows the build's tables. */
    get revision(): string | null { return applied?.revision ?? null; },
    leave,
    async enter(source: SessionCatalog): Promise<void> {
      if (applied?.revision === source.revision) return;
      leave(); const mine = request;
      try {
        const catalog = await source.load();
        // The source answers for its own transport, so what it hands back is checked here, once, for both.
        if (catalog.revision !== source.revision) throw new SessionFailure("INVALID_MESSAGE", "The catalog is not the revision this session joined");
        if (mine === request) applied = { revision: source.revision, undo: overlayClientCatalog(registry, catalog) };
      } catch (error) { if (mine === request) ports.failed?.(error); }
    },
  };
}
