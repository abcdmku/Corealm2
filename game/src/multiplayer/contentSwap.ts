import type { InstalledCatalog } from "../content/catalogInstall.js";
import { reindexCreatures } from "../content/creatureRuntime.js";
import { content } from "../content/index.js";
import { adoptCatalog } from "../content/resolvedCatalog.js";
import { reindexRuntimeTables, runtimeTables } from "../content/runtimeCatalog.js";
import { reindexWorldContent } from "../content/worldData.js";
import { reindexHabitats } from "../content/worldHabitats.js";
import type { HeadlessWorld } from "./headlessWorld.js";

/**
 * Moving a running process onto a newly published catalog.
 *
 * About 144 modules copy content tables as they load, and a publish cannot reach those copies. What
 * it can reach is declared here, table by table, next to the code that does it, and the publish
 * reply reads this map to tell the author which of their changed tables are live and which wait for
 * the next start. A test holds every table of the compiled catalog against it.
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
 * `restart` means a module derives something from the table at import and keeps it.
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

/**
 * Assignments and map refills only. The caller has compiled and validated `next`, planned every
 * world's spawns and activated the revision in the database, so nothing here may throw. It runs
 * between ticks. Spawn plans are applied by the caller, world by world, right after.
 */
export function swapCatalog(next: InstalledCatalog, worlds: readonly HeadlessWorld[]): void {
  adoptCatalog(next);
  reindexCreatures(); reindexWorldContent(); reindexHabitats(); reindexRuntimeTables();
  // One registry serves every world of the process. A lab world adds lab-only creatures, and a fixture may bring its own.
  const tables = runtimeTables(worlds.some(world => world.descriptor.fixture === "lab"));
  const enemies = new Map([...tables.enemies, ...worlds.flatMap(world => world.ports.enemies ?? [])].map(enemy => [enemy.id, enemy]));
  content.register({ items: tables.items, recipes: tables.recipes, shops: tables.shops, enemies: [...enemies.values()] });
  for (const world of worlds) {
    world.invalidateDefinitions();
    // What `/worlds`, the join reply and every save from now on carry.
    world.descriptor.catalogRevision = next.revision;
  }
}
