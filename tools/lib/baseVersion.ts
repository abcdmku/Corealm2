import { readFileSync } from "node:fs";
import path from "node:path";
import { semver } from "../../game/src/multiplayer/semver.js";
import { repoRoot } from "./paths.js";

/**
 * The base game version: `package.json`'s `version`, strict semver. It names a release of the base
 * game and travels beside the compiled catalog, never inside it, so bumping it changes no revision.
 * Reads one file and imports no content, so any tool may call it before a catalog is installed.
 */
export function repoBaseVersion(root = repoRoot): string {
  return semver(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "package.json version");
}
