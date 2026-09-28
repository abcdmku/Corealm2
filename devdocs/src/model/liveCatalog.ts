/**
 * The editor runs the game's own content modules (the actor stage, derived numbers, thumbnails) on
 * the catalog compiled into the page. The content it edits lives elsewhere: the checkout in repo
 * mode, a running server in server mode. Each backend hands this module the compiled catalog it has
 * (repo mode after a save, server mode on every snapshot, publish, base update and rollback), so the
 * stage draws a variant or skin the moment it exists, without a reload.
 */
import { adoptCatalog, RESOLVED_CATALOG } from "../../../game/src/content/resolvedCatalog.js";
import { reindexCreatures } from "../../../game/src/content/creatureRuntime.js";
import type { InstalledCatalog } from "../../../game/src/content/catalogInstall.js";

type CatalogSource = () => Promise<InstalledCatalog | undefined>;

let source: CatalogSource | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Adopt a compiled catalog into the page. The one already in force is not adopted again. */
export function adoptGameCatalog(catalog: InstalledCatalog): void {
  if (catalog.revision && catalog.revision === RESOLVED_CATALOG.revision) return;
  adoptCatalog(catalog);
  reindexCreatures();
  for (const listener of listeners) listener();
}

/** Where `refreshGameCatalog` reads the current catalog. Each backend sets its own when it is created. */
export function setGameCatalogSource(next: CatalogSource): void { source = next; }

/** Read and adopt the current compiled catalog. Calls made while one is in flight share it. */
export function refreshGameCatalog(): Promise<void> {
  if (!source) return Promise.resolve();
  const read = source;
  pending ??= (async () => {
    try {
      const catalog = await read();
      if (catalog) adoptGameCatalog(catalog);
    } catch (error) {
      console.warn("Could not refresh the game catalog", error);
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

/** A compiled catalog from JSON: `{ version, revision, formulaRevision, tables }`, or undefined when it is not one. */
export function installedCatalogOf(value: unknown, fallbackRevision = ""): InstalledCatalog | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const tables = body.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) return undefined;
  return {
    version: 1,
    revision: typeof body.revision === "string" ? body.revision : fallbackRevision,
    formulaRevision: typeof body.formulaRevision === "string" ? body.formulaRevision : RESOLVED_CATALOG.formulaRevision,
    tables: tables as Record<string, unknown>,
  };
}
