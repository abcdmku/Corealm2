import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { CATALOG_REVISION, clientCatalog, serializeClientCatalog } from "../content/clientCatalog.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import type { CatalogStorage } from "./catalogStorage.js";

/**
 * What a server does with its catalog store before and while it runs. This module loads no content
 * table, so a host can seed and read the active catalog first and install it before importing the
 * simulation. See `content/catalogInstall.ts`.
 */

/** The catalog a server ships with: compiled from the repo under tsx, embedded in the executable later. */
export interface BaseCatalog {
  catalog: InstalledCatalog;
  /** Source collections by name, as `game/content/data/` holds them. */
  sources: Readonly<Record<string, unknown>>;
}
type Log = (event: Record<string, unknown>) => void;

/**
 * An empty database takes the shipped catalog. A database that has one keeps it: the server is the
 * source of truth for its content once it is live, so a deploy with a newer base changes nothing
 * and says so once. Returns the active revision.
 *
 * `follow` is for a developer's own database: the shipped catalog is published over whatever is
 * active, so edits made in the repo show up in the local server. A live server never sets it.
 */
export async function seedCatalog(storage: CatalogStorage, base: BaseCatalog, log: Log, options: { now?: () => number; follow?: boolean } = {}): Promise<string> {
  const active = await storage.activeRevision(), revision = base.catalog.revision, now = options.now ?? Date.now;
  if (active !== null && !(options.follow && active !== revision)) {
    if (active !== revision) log({ event: "catalog-base-ignored", activeRevision: active, bundledRevision: revision,
      message: "This database already has a catalog, so the catalog shipped with this server was not applied." });
    return active;
  }
  const at = now(), by = active === null ? "seed" : "follow";
  await storage.store({ revision, formulaRevision: base.catalog.formulaRevision, server: JSON.stringify(base.catalog),
    client: serializeClientCatalog(clientCatalog(base.catalog)), sources: JSON.stringify(base.sources), by, at,
    note: active === null ? "Seeded from the catalog shipped with the server" : "Followed the catalog shipped with the server" });
  await storage.activate(revision, by, at);
  log(active === null ? { event: "catalog-seeded", revision } : { event: "catalog-followed", revision, previousRevision: active });
  return revision;
}

/** The active server catalog, parsed, ready for `installCatalog`. */
export async function activeServerCatalog(storage: CatalogStorage): Promise<InstalledCatalog> {
  const revision = await storage.activeRevision();
  const text = revision === null ? null : await storage.catalog(revision, "server");
  if (text === null) throw new Error("The database has no active catalog");
  const catalog = JSON.parse(text) as InstalledCatalog;
  if (catalog.revision !== revision || catalog.version !== 1) throw new Error("The stored catalog does not match its revision");
  return catalog;
}

export interface ServedCatalog { etag: string; identity: Buffer; gzip: Buffer; br: Buffer }
/** The catalog a running server simulates and serves. Publishing moves `revision`. */
export interface CatalogHost {
  readonly storage: CatalogStorage;
  /** The active revision: what `/worlds`, the `joined` reply and new saves carry. */
  revision: string;
  served(revision: string): Promise<ServedCatalog | null>;
}
const compressGzip = promisify(gzip), compressBrotli = promisify(brotliCompress);
/** Clients ask for the active revision, and for the one before it for a moment after a publish. */
const SERVED_REVISIONS = 3;

export function createCatalogHost(storage: CatalogStorage, revision: string): CatalogHost {
  const cache = new Map<string, Promise<ServedCatalog | null>>();
  return { storage, revision,
    served(wanted) {
      let entry = cache.get(wanted);
      if (entry) { cache.delete(wanted); cache.set(wanted, entry); return entry; }
      // Compressed once per revision, off the tick thread. An unknown revision is not remembered.
      entry = storage.catalog(wanted, "client").then(async text => {
        if (text === null) { cache.delete(wanted); return null; }
        const identity = Buffer.from(text);
        const [zipped, br] = await Promise.all([compressGzip(identity, { level: 9 }),
          compressBrotli(identity, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: identity.length } })]);
        return { etag: `"${wanted}"`, identity, gzip: zipped, br };
      }).catch(error => { cache.delete(wanted); throw error; });
      cache.set(wanted, entry);
      while (cache.size > SERVED_REVISIONS) cache.delete(cache.keys().next().value!);
      return entry;
    },
  };
}

function accepts(header: string | string[] | undefined, coding: string): boolean {
  return String(header ?? "").split(",").some(part => {
    const [name, ...params] = part.trim().toLowerCase().split(";").map(text => text.trim());
    return name === coding && !params.some(param => /^q=0(\.0*)?$/.test(param));
  });
}

/**
 * `GET /catalog/<revision>`: the client catalog, public and immutable. It holds nothing a player
 * cannot already see in the game, so any origin may read it. Only a stored revision is served.
 */
export async function serveCatalog(request: IncomingMessage, response: ServerResponse, host: CatalogHost): Promise<boolean> {
  const path = request.url?.split("?")[0] ?? "";
  if (!path.startsWith("/catalog/")) return false;
  const revision = path.slice("/catalog/".length);
  response.setHeader("Access-Control-Allow-Origin", "*");
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }).end(); return true; }
  const served = CATALOG_REVISION.test(revision) ? await host.served(revision) : null;
  if (!served) { response.writeHead(404, { "Cache-Control": "no-store" }).end(); return true; }
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable", ETag: served.etag, Vary: "Accept-Encoding" };
  if (request.headers["if-none-match"] === served.etag) { response.writeHead(304, headers).end(); return true; }
  const coding = accepts(request.headers["accept-encoding"], "br") ? "br" : accepts(request.headers["accept-encoding"], "gzip") ? "gzip" : null;
  const body = coding === null ? served.identity : served[coding];
  response.writeHead(200, { ...headers, "Content-Length": body.length, ...(coding ? { "Content-Encoding": coding } : {}) });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}
