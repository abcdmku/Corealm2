/**
 * The editor runs the game's own content modules (the actor stage, derived numbers, thumbnails) on
 * the catalog compiled into the page. After a save the server has compiled a new one; adopting it
 * lets the stage draw a variant or skin the moment it is written, without a reload.
 */
import { adoptCatalog } from "../../../game/src/content/resolvedCatalog.js";
import { reindexCreatures } from "../../../game/src/content/creatureRuntime.js";
import type { InstalledCatalog } from "../../../game/src/content/catalogInstall.js";

let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Fetch and adopt the latest compiled catalog. Calls made while one is in flight share it. */
export function refreshGameCatalog(): Promise<void> {
  pending ??= (async () => {
    try {
      const response = await fetch("/__devdocs/catalog", { cache: "no-store" });
      if (!response.ok) return;
      adoptCatalog(await response.json() as InstalledCatalog);
      reindexCreatures();
      for (const listener of listeners) listener();
    } catch (error) {
      console.warn("Could not refresh the game catalog after a save", error);
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/** Runs after each adopted catalog, e.g. to reload a stage that could not resolve its record. */
export function onGameCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
