/** Shared locations for the creature rig pipeline. Candidates and work files live under
 * test-results (git-ignored); only tools and per-asset configs are committed. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
// Donor extractions and the source-rig index are shared by every output folder.
const sharedRoot = path.join(repo, "test-results/creature-motion/rig");
let rigRoot = sharedRoot;

/** Stage work files, candidates, sheets and the catalog under dir instead (run.mjs --out). */
export function setRigRoot(dir) {
  rigRoot = path.resolve(dir);
}

export const paths = {
  get rigRoot() { return rigRoot; },
  work: (assetId) => path.join(rigRoot, "work", assetId),
  get models() { return path.join(rigRoot, "models"); },
  get sheets() { return path.join(rigRoot, "sheets"); },
  donors: path.join(sharedRoot, "donors"),
  sourceIndex: path.join(sharedRoot, "source-index.json"),
  manifest: path.join(repo, "game/public/assets/manifest.json"),
  publicAssets: path.join(repo, "game/public/assets"),
  tool: path.join(repo, "tools/creature-rig"),
};

export const configFile = (assetId) => path.join(paths.tool, "assets", `${assetId}.json`);

/** Per-asset config: { class, profile, source?, profileOverrides?, notes? } in
 * tools/creature-rig/assets/<id>.json. rig.py reads it again at rig time, so class, profile and
 * overrides never need a fresh intake. */
export function assetConfig(assetId) {
  const file = configFile(assetId);
  if (!existsSync(file)) throw new Error(`no rig config for ${assetId}: add tools/creature-rig/assets/${assetId}.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export const isMain = (meta) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url);
