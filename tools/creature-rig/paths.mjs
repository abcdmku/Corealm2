/** Shared locations for the creature rig pipeline. Candidates and work files live under
 * test-results (git-ignored); only tools and per-asset configs are committed. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const rigRoot = path.join(repo, "test-results/creature-motion/rig");

export const paths = {
  rigRoot,
  work: (assetId) => path.join(rigRoot, "work", assetId),
  models: path.join(rigRoot, "models"),
  sheets: path.join(rigRoot, "sheets"),
  manifest: path.join(repo, "game/public/assets/manifest.json"),
  publicAssets: path.join(repo, "game/public/assets"),
  tool: path.join(repo, "tools/creature-rig"),
};

/** Per-asset config: { class, profile, source?, notes? } in tools/creature-rig/assets/<id>.json. */
export function assetConfig(assetId) {
  const file = path.join(paths.tool, "assets", `${assetId}.json`);
  if (!existsSync(file)) throw new Error(`no rig config for ${assetId}: add tools/creature-rig/assets/${assetId}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export const isMain = (meta) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url);
