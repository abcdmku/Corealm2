import type { InstalledCatalog } from "../content/catalogInstall.js";
import { reindexCreatures } from "../content/creatureRuntime.js";
import { content } from "../content/index.js";
import { adoptCatalog } from "../content/resolvedCatalog.js";
import { reindexRuntimeTables, runtimeTables } from "../content/runtimeCatalog.js";
import { reindexWorldContent } from "../content/worldData.js";
import { reindexHabitats } from "../content/worldHabitats.js";
import type { HeadlessWorld } from "./headlessWorld.js";

/**
 * Moves a running process onto a newly published catalog. What this reaches, table by table, is
 * declared by `CATALOG_TABLE_APPLIES` in `catalogHost.ts`, which loads no content so a publish can
 * read it before any world starts. A change here that reaches another table changes that map too.
 *
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
