import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { CATALOG_REVISION, clientCatalog, serializeClientCatalog } from "../content/clientCatalog.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import type { BaseMarker, CatalogStorage } from "./catalogStorage.js";

/**
 * What a server does with its catalog store before and while it runs. This module loads no content
 * table, so a host can seed and read the active catalog first and install it before importing the
 * simulation. See `content/catalogInstall.ts`.
 */

/**
 * The base game a server ships with: compiled from the repo under tsx, embedded in the executable
 * as `seed-catalog.json`. It seeds an empty database, and it is the "new base" an update from base
 * merges in. `version` is `package.json`'s version when it was built. It lives beside the catalog,
 * never in it, so the same content under two versions is still one revision.
 */
export interface BaseCatalog {
  version: string;
  catalog: InstalledCatalog;
  /** Source collections by name, as `game/content/data/` holds them. */
  sources: Readonly<Record<string, unknown>>;
}
type Log = (event: Record<string, unknown>) => void;
export const baseMarkerOf = (base: BaseCatalog): BaseMarker => ({ version: base.version, revision: base.catalog.revision });
/** True when the bundled base is not the base the server's content derives from: an update from base has something to offer or report. */
export const baseDiffers = (current: BaseMarker | null, bundled: BaseMarker): boolean => current === null || current.revision !== bundled.revision || current.version !== bundled.version;

/**
 * An empty database takes the shipped catalog, and records it as the base its content derives
 * from. A database that has one keeps it: the server's content is its own once it is seeded, so a
 * deploy with a newer base changes nothing. When the shipped base is not the one the content derives
 * from, it says so once, and devdocs offers the update. Returns the active revision.
 *
 * `follow` is for a developer's own database: the shipped catalog is published over whatever is
 * active, so edits made in the repo show up in the local server. A live server never sets it.
 */
export async function seedCatalog(storage: CatalogStorage, base: BaseCatalog, log: Log, options: { now?: () => number; follow?: boolean } = {}): Promise<string> {
  const active = await storage.activeRevision(), revision = base.catalog.revision, now = options.now ?? Date.now, marker = baseMarkerOf(base);
  if (active !== null && !(options.follow && active !== revision)) {
    const current = await storage.activeBase();
    if (baseDiffers(current, marker)) log({ event: "base-update-available", current, bundled: marker,
      message: "This server ships a different base game than its content derives from. Nothing was changed. Open devdocs, Server, Base game to preview the update and apply it, or restart the server with --apply-base-update." });
    return active;
  }
  const at = now(), by = active === null ? "seed" : "follow";
  const sources = JSON.stringify(base.sources);
  await storage.storeBase({ revision, version: base.version, sources, at });
  await storage.store({ revision, formulaRevision: base.catalog.formulaRevision, server: JSON.stringify(base.catalog),
    client: serializeClientCatalog(clientCatalog(base.catalog)), sources, by, at, base: marker,
    note: active === null ? "Seeded from the catalog shipped with the server" : "Followed the catalog shipped with the server" });
  await storage.activate(revision, by, at, undefined, marker);
  log(active === null ? { event: "catalog-seeded", revision, baseVersion: base.version } : { event: "catalog-followed", revision, previousRevision: active, baseVersion: base.version });
  return revision;
}

/**
 * Which changed tables a running process picks up when a publish moves it onto a new catalog.
 *
 * About 144 modules copy content tables as they load, and a publish cannot reach those copies. What
 * `swapCatalog` in `contentSwap.ts` can reach is declared here, table by table, and the publish reply
 * reads this map to tell the author which of their changed tables are live and which wait for the
 * next start. A test holds every table of the compiled catalog against it.
 *
 * `live` means one of:
 *  - the `ContentRegistry` holds the table and `swapCatalog` registers it again (`items`, `recipes`,
 *    `shops`, `enemies`), so the next kill, purchase or craft reads the new row;
 *  - `swapCatalog` refills the index that serves it (`compiledCreatures` and `species` through
 *    `reindexCreatures`, `world` through `reindexWorldContent`, `reindexHabitats` and each world's
 *    spawn plan, which takes effect creature by creature at the next respawn);
 *  - nothing reads the table while the game runs: it is an input the compiler folds into one of the
 *    tables above, so its whole effect arrives through them.
 *
 * `restart` means a module derives something from the table at import and keeps it. The next start
 * builds every world's entities from it again, a saved world's included: a save keeps only what play
 * made or moves (creatures, loot piles, recovery caches, campfires), never a structure, station or node.
 */
export const CATALOG_TABLE_APPLIES: Readonly<Record<string, "live" | "restart">> = {
  // Registry rows.
  items: "live", recipes: "live", shops: "live", enemies: "live",
  // Refilled indexes.
  compiledCreatures: "live", species: "live", world: "live",
  // Compiler inputs with no reader at run time.
  creatureDefinitions: "live", creatureProfiles: "live", lootTables: "live", encounters: "live", placements: "live",
  // Derived at import: resource nodes and their entities, spells, region geometry and everything built on it, tier tables, tuning, audio.
  resources: "restart", spells: "restart", spellRunes: "restart", elementalSpells: "restart",
  worldRegions: "restart", resourcePlacements: "restart", npcs: "restart", quests: "restart", dialogue: "restart",
  progression: "restart", materials: "restart", equipmentFamilies: "restart", recipeTemplates: "restart",
  campfireFuels: "restart", equipmentSets: "restart",
  "balance/recipes": "restart", "balance/sets": "restart", "balance/formation": "restart", "balance/campfires": "restart",
  audio: "restart",
};

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
  /** The base the active revision derives from. Publishing keeps it, a base update and a rollback move it. */
  base: BaseMarker | null;
  served(revision: string): Promise<ServedCatalog | null>;
}
const compressGzip = promisify(gzip), compressBrotli = promisify(brotliCompress);
/** Clients ask for the active revision, and for the one before it for a moment after a publish. */
const SERVED_REVISIONS = 3;

export function createCatalogHost(storage: CatalogStorage, revision: string, base: BaseMarker | null = null): CatalogHost {
  const cache = new Map<string, Promise<ServedCatalog | null>>();
  return { storage, revision, base,
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

export function accepts(header: string | string[] | undefined, coding: string): boolean {
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
