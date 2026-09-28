import { reindexAudio } from "../audio/corealmCatalog.js";
import { reindexRecipeBalance } from "../content/index.js";
import { reindexBossArmor } from "../content/bossArmor.js";
import { reindexCampfireFuels } from "../content/campfireData.js";
import type { ClientCatalog } from "../content/clientCatalog.js";
import { overlayClientCatalog, type OverlayRegistry } from "../content/clientCatalogOverlay.js";
import { reindexCraftingTiers } from "../content/craftingTierData.js";
import { reindexCreatures } from "../content/creatureRuntime.js";
import { reindexCreatureSkins } from "../content/creatureSkins.js";
import { reindexElementalSpells } from "../content/elementalSpells.js";
import { reindexFairyNpcs } from "../content/fairyNpcs.js";
import { reindexGatheringTiers } from "../content/gatheringProductionTiers.js";
import { reindexNpcs } from "../content/npcs.js";
import { reindexQuests } from "../content/quests.js";
import { RESOLVED_CATALOG, RESOLVED_TABLES } from "../content/resolvedCatalog.js";
import { reindexResources } from "../content/resourceData.js";
import { reindexRuntimeTables } from "../content/runtimeCatalog.js";
import { reindexEquipmentSets } from "../content/setData.js";
import { reindexShops } from "../content/shops.js";
import { reindexSpells } from "../content/spells.js";

/**
 * The page's side of `contentSwap.ts`: moves a game page onto a joined server's client catalog, and
 * back onto the build's when it leaves.
 *
 * The page installed the build's client catalog before it imported the app, and about 140 modules
 * took what they needed from it as they loaded. Following a server therefore does two things. It
 * refills every table of the installed catalog IN PLACE (an array keeps its identity and gets the
 * server's rows), so every module that holds the catalog's own array reads the server's rows at once.
 * Then each module that parsed or indexed a table at import rebuilds its arrays and maps, again in
 * place, from `refreshers` below. Leaving puts the build's rows back and runs the same refreshers.
 *
 * `CLIENT_TABLE_FOLLOWS` says, table by table, what a player on the page sees. A test holds every
 * table of the client catalog against it.
 */

/** A table of the client catalog, by the name the page's catalog holds it under. */
export type ClientTableName = keyof ClientCatalog["tables"];

/**
 * - `live`: the page shows the server's rows from the moment the catalog loads: at join, and at every
 *   `content-updated`. A row the server added resolves, a row it changed reads the new fields.
 * - `bake`: world geometry. The page draws the baked world pack from its asset host, so region
 *   shapes, terrain and resource clusters must move with a new pack (live-authoring wave 3). The page
 *   keeps the build's rows, which match the pack it draws.
 * - `build`: the page reads the table through a module it cannot refill yet, so it keeps the build's
 *   copy. Each names the module that would have to offer a refresh.
 */
export const CLIENT_TABLE_FOLLOWS: Readonly<Record<ClientTableName, "live" | "bake" | "build">> = {
  // Names, icons, tooltips, stock: the registry (`overlayClientCatalog`) and the catalog arrays.
  items: "live", recipes: "live", resources: "live", shops: "live", spells: "live", enemies: "live",
  // Parsed at import, refilled by `refreshers`.
  npcs: "live", quests: "live", spellRunes: "live", elementalSpells: "live", equipmentSets: "live", campfireFuels: "live",
  progression: "live", materials: "live",
  // Creature look: species and compiled rows through `reindexCreatures`, skin rows read through `creatureSkinById`.
  compiledCreatures: "live", species: "live", creatures: "live", creatureSkins: "live",
  // `COREALM_AUDIO_CATALOG` refilled: the next cue or loop plays the server's file.
  audio: "live",
  // No page module reads these. A page's dialogue is always empty: lines arrive with the replicated conversation.
  "balance/sets": "live", "balance/campfires": "live", dialogue: "live",
  // `RECIPE_BALANCE` re-parsed: gather, heal and recipe XP previews use the server's numbers.
  "balance/recipes": "live",
  worldTerrain: "bake", regions: "bake", worldResources: "bake",
};

const FOLLOWED = (Object.keys(CLIENT_TABLE_FOLLOWS) as ClientTableName[]).filter(name => CLIENT_TABLE_FOLLOWS[name] !== "bake");

/** Every module that copied a table at import, in dependency order. Assignments and refills only, apart from the parse each module already did at import. */
const refreshers: readonly (() => void)[] = [
  reindexFairyNpcs, reindexNpcs, reindexQuests, reindexSpells, reindexShops,
  reindexEquipmentSets, reindexBossArmor, reindexElementalSpells,
  reindexCampfireFuels, reindexResources, reindexGatheringTiers, reindexCraftingTiers,
  reindexCreatures, reindexRuntimeTables, reindexCreatureSkins, reindexAudio, reindexRecipeBalance,
];
function refresh(): void { for (const step of refreshers) step(); }

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function refillObject(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

/**
 * Lays `incoming` over `target`, table by table, keeping each table object's identity: an array is
 * refilled, a plain object gets the new keys and loses the old ones, anything else is replaced.
 * Returns the undo, which puts every table back as it was, the same objects with the same rows.
 */
export function layTables(target: Record<string, unknown>, incoming: Readonly<Record<string, unknown>>, names: readonly string[]): () => void {
  const undo: (() => void)[] = [];
  for (const name of names) {
    if (!(name in incoming)) continue;
    const current = target[name], next = incoming[name];
    if (Array.isArray(current) && Array.isArray(next)) {
      const was = current.slice();
      current.length = 0; for (const row of next) current.push(row);
      undo.push(() => { current.length = 0; for (const row of was) current.push(row); });
    } else if (plain(current) && plain(next)) {
      const was = { ...current };
      refillObject(current, next);
      undo.push(() => refillObject(current, was));
    } else {
      const had = name in target;
      target[name] = next;
      undo.push(() => { if (had) target[name] = current; else delete target[name]; });
    }
  }
  return () => { for (const step of undo.reverse()) step(); };
}

/**
 * Moves the page onto `catalog` and returns the way back. The registry overlay runs first and is
 * undone last, because the registry holds some of the very arrays the table swap refills: it must
 * re-register them once they hold the build's rows again.
 *
 * Only a page that runs on the client projection follows a server's tables. A lab, bake or capture
 * page runs on the full catalog (it carries `world`) and simulates with it, so a projection laid
 * over it would strip the rules it runs on; there the registry overlay alone applies, as before.
 *
 * Throws, with the page back on the tables it had, when a module cannot parse the server's rows.
 */
export function followClientCatalog(registry: OverlayRegistry, catalog: ClientCatalog): () => void {
  const undoRegistry = overlayClientCatalog(registry, catalog);
  if ("world" in RESOLVED_TABLES) return undoRegistry;
  const revision = RESOLVED_CATALOG.revision;
  const undoTables = layTables(RESOLVED_TABLES, catalog.tables, FOLLOWED);
  RESOLVED_CATALOG.revision = catalog.revision;
  const restore = (): void => { undoTables(); RESOLVED_CATALOG.revision = revision; refresh(); undoRegistry(); };
  try { refresh(); } catch (error) { restore(); throw error; }
  return restore;
}

/**
 * The tables `catalog` changes that this page cannot show: what it holds now differs, and the table
 * does not follow live. Empty on a lab page, which follows nothing but the registry.
 */
export function unfollowedChanges(catalog: ClientCatalog): ClientTableName[] {
  if ("world" in RESOLVED_TABLES) return [];
  return (Object.keys(CLIENT_TABLE_FOLLOWS) as ClientTableName[])
    .filter(name => CLIENT_TABLE_FOLLOWS[name] !== "live" && name in catalog.tables && JSON.stringify(RESOLVED_TABLES[name]) !== JSON.stringify(catalog.tables[name]));
}
