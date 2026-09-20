/**
 * Install before import. About 144 modules read content tables as they are evaluated, so a process
 * that runs on a catalog from a database must hand it over before the first of them loads:
 *
 *   installCatalog(await storage.catalog(revision, "server"));
 *   const { startReferenceServer } = await import("./referenceServer.js");
 *
 * This module imports nothing, so loading it evaluates no content. With nothing installed,
 * `resolvedCatalog.ts` uses the catalog compiled into the build, which is what tests, tools,
 * devdocs and the browser client do.
 */
export interface InstalledCatalog { version: 1; revision: string; formulaRevision: string; tables: Record<string, unknown> }
interface Slot { catalog?: InstalledCatalog; taken: boolean }
const slot = ((globalThis as Record<symbol, unknown>)[Symbol.for("corealm.catalog")] ??= { taken: false }) as Slot;

export function installCatalog(catalog: InstalledCatalog): void {
  if (slot.taken) throw new Error("installCatalog ran after the content modules were evaluated. Install the catalog first, then import() the server.");
  slot.catalog = catalog;
}
/** Called once, by `resolvedCatalog.ts`. After it, the choice of catalog is final for this process. */
export function takeInstalledCatalog(): InstalledCatalog | undefined {
  slot.taken = true;
  return slot.catalog;
}
