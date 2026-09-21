import { compileContent, readContentSources } from "../content/compile.js";
import type { BaseCatalog } from "../../game/src/multiplayer/catalogHost.js";
import { repoBaseVersion } from "./baseVersion.js";

/**
 * The catalog a server run from this checkout ships with: compiled now, from `game/content/data/` and
 * this checkout's formulas, so it can never lag the code the way a committed artifact can, and
 * versioned by `package.json`. Loads no content table, so it is safe to call before `installCatalog`.
 */
export async function repoBaseCatalog(): Promise<BaseCatalog> {
  const values = await readContentSources();
  const { ok, diagnostics, ...catalog } = compileContent(values);
  if (!ok) throw new Error(`Repo content does not compile:\n${diagnostics.filter(issue => issue.severity === "error").map(issue => `${issue.path}: ${issue.message}`).join("\n")}`);
  return { version: repoBaseVersion(), catalog, sources: Object.fromEntries(values) };
}
