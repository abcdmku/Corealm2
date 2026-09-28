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
 * Which changed tables a running server picks up when a publish moves it onto a new catalog.
 *
 * About 144 modules copy content tables as they load, and a publish cannot reach every copy. What
 * `swapCatalog` in `contentSwap.ts` can reach is declared here, table by table, and the publish reply
 * reads this map to tell the author which of their changed tables are live and which wait for the
 * next start. A test holds every table of the compiled catalog against it.
 *
 * `live` means one of:
 *  - the `ContentRegistry` holds the table and `swapCatalog` registers it again (`items`, `recipes`,
 *    `shops`, `enemies`), so the next kill, purchase or craft reads the new row;
 *  - `swapCatalog` refills the index that serves it (`compiledCreatures` and `species` through
 *    `reindexCreatures`, `world` through `reindexWorldContent`, `reindexHabitats` and each world's
 *    spawn plan, which takes effect creature by creature at the next respawn; people, dialogue,
 *    quests, spells, sets and the tier tables through the same module refreshers a page runs);
 *  - nothing on the server reads the table while the game runs: it is an input the compiler folds
 *    into the tables above, or only a page reads it.
 *
 * `restart` means a server module derives something from the table at import and keeps it. The next
 * start builds every world's entities from it again, a saved world's included: a save keeps only what
 * play made or moves (creatures, loot piles, recovery caches, campfires), never a structure, station or node.
 *
 * `rebake` means the table shapes the baked world (terrain, navmesh, collision, scatter). A publish that
 * changes it starts a server world bake (`serverWorldBake.ts`); when the bake passes, each world
 * restarts on the new pack and pages reload onto it. Until then the running world keeps the last good bake.
 *
 * Players' pages are a separate question, answered by `CLIENT_TABLE_FOLLOWS` in `clientContentSwap.ts`:
 * a page loads the new client catalog at every `content-updated` and shows most of it at once, even
 * where the server's own rules wait for a restart. Each line below says what a player sees, and when.
 */
export const CATALOG_TABLE_APPLIES: Readonly<Record<string, "live" | "restart" | "rebake">> = {
  // Names, icons, stats, stock: the page's tooltips and shop windows change at once, and the next craft, kill or purchase uses the new row.
  items: "live", recipes: "live", shops: "live", enemies: "live",
  // The creature list and its look. New spawns roll from the new rows at their next respawn; a page resolves a new variant at once.
  compiledCreatures: "live", species: "live",
  // Encounters, placements and habitats: creatures move over at their next respawn. Region shapes and terrain do not (see worldRegions).
  world: "live",
  // Compiler inputs, seen only through the tables above.
  creatureDefinitions: "live", creatureProfiles: "live", lootTables: "live", encounters: "live", placements: "live",
  equipmentFamilies: "live", recipeTemplates: "live",
  // Only a page reads these. Skin rows are read through on every lookup (`creatureSkinById`): an individual rolled with a new skin
  // draws it once its maps load, from the server's asset store. The audio table is refilled on the page, so the next cue plays the new file.
  creatureSkins: "live", audio: "live",
  // Resource nodes are world entities, built at start: requirement, yield and respawn are stamped on each node, so those move
  // after a restart. The rows themselves are refilled (the tier tables below derive from them), and a page's names and tooltips change at once.
  resources: "restart",
  // The spell registry, refilled and registered again: the next cast uses the new numbers, runes and names. The agent's
  // tool schema lists the spell ids it was started with, so a new spell reaches an agent after a restart.
  spells: "live", spellRunes: "live", elementalSpells: "live",
  // The world's shape. Terrain, navmesh and scatter are baked, and a page draws the baked pack: both move with the server's new bake.
  // The world map image is not re-rendered by a server bake; it stays the base world's until the next release.
  worldRegions: "rebake", worldTerrain: "rebake", resourcePlacements: "rebake",
  // Who each person is (the speaker of their lines, their role and journal entry) and every dialogue node: the next line
  // spoken reads the new row, and a conversation standing on a removed node ends. NPC entities (their names over their heads,
  // positions, dialogue roots) come from the region stands in `worldRegions` and move after a restart.
  npcs: "live", dialogue: "live",
  // The quest system reads every quest, stage, predicate and reward on each event, and each NPC entity's quest list is
  // derived from the table again. A player's saved progress keeps its stage index.
  quests: "live",
  // Tier tables behind gathering, smelting and crafting, refilled with the resources they read. A player keeps the campfire
  // fuels of the moment they joined until they join again; what the tiers compile into (items, recipes) is live above.
  progression: "live", materials: "live", campfireFuels: "live",
  // Set bonuses are summed from the set table whenever a player's bonuses are computed: at the next equipment change.
  equipmentSets: "live",
  // Gather, heal and recipe XP read the recipe balance again. Nothing on the server reads the other three: they are
  // authoring references for the formulas, and a page shows them at once.
  "balance/recipes": "live", "balance/sets": "live", "balance/formation": "live", "balance/campfires": "live",
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
