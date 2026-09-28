import { installCatalog, type InstalledCatalog } from "../../content/catalogInstall.js";
import type { WorldRecordBake, WorldRecordBakeInput } from "./nodeWorldBake.js";

/**
 * Bakes a server's catalog in a process that has evaluated no content yet: installs it, then loads
 * the bake. `installCatalog` throws when content modules already ran on another catalog, so a baker
 * process is one catalog, one bake.
 */
export async function bakeCatalogWorldRecords(catalog: InstalledCatalog, input: Omit<WorldRecordBakeInput, "tables">): Promise<WorldRecordBake> {
  installCatalog(catalog);
  const [{ RESOLVED_TABLES }, { bakeWorldRecords }] = await Promise.all([import("../../content/resolvedCatalog.js"), import("./nodeWorldBake.js")]);
  return bakeWorldRecords({ ...input, tables: RESOLVED_TABLES });
}
