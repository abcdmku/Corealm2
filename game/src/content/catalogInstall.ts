/**
 * Install before import. About 144 modules read content tables as they are evaluated, so a process
 * that runs on a catalog from a database must hand it over before the first of them loads:
 *
 *   installCatalog(await storage.catalog(revision, "server"));
 *   const { startReferenceServer } = await import("./referenceServer.js");
 *
 * This module imports nothing, so loading it evaluates no content. With nothing installed,
 * `resolvedCatalog.ts` throws: a process that reads content says where the content came from.
 * Tests, tools, devdocs and the browser client say it by importing `bundledCatalog.js` for its
 * side effect, which installs the catalog compiled into the build.
 */
export interface InstalledCatalog { version: 1; revision: string; formulaRevision: string; tables: Record<string, unknown> }
interface Slot { catalog?: InstalledCatalog; taken: boolean }
const slot = ((globalThis as Record<symbol, unknown>)[Symbol.for("corealm.catalog")] ??= { taken: false }) as Slot;

export function installCatalog(catalog: InstalledCatalog): void {
  if (slot.taken) throw new Error("installCatalog ran after the content modules were evaluated. Install the catalog first, then import() the server.");
  slot.catalog = catalog;
}
/**
 * Whether a catalog is already waiting. Only `bundledCatalog.ts` asks: it is a fallback, so a
 * process that installed a database's catalog keeps it, and one that installed nothing gets the
 * build's. It deliberately does not mark the slot taken — `resolvedCatalog.ts` still does that.
 */
export function catalogInstalled(): boolean {
  return slot.catalog !== undefined;
}
/** Called once, by `resolvedCatalog.ts`. After it, the choice of catalog is final for this process. */
export function takeInstalledCatalog(): InstalledCatalog | undefined {
  slot.taken = true;
  return slot.catalog;
}
