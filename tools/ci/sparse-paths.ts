import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";

/**
 * What each workflow checks out.
 *
 * The repository carries about 3.9 GB of art, most of it historical rebuild candidates that nothing
 * reads, so every job takes a cone-mode sparse checkout. Cone mode brings each entry's whole subtree
 * plus the loose files of its parents, which is why a nested entry works:
 * `art/rebuild/candidates/finish-motion` costs 41 MB instead of the 1.8 GB of `art/rebuild`.
 *
 * Leaving a directory out does not fail the checkout. It fails a test with ENOENT eight minutes into
 * a ten-minute job, and it did: the first pull request this repository ever ran lost about 60 tests
 * that way. So the lists live here, one per job shape, and `tests/ci-sparse-checkout.test.ts` holds
 * every workflow to them.
 *
 * To derive the suite list again, do what produced it: take a checkout holding only these paths, run
 * `npx vitest run`, and add the smallest directory that covers each ENOENT until only failures that
 * are not about paths remain. `npx tsx tools/ci/sparse-paths.ts` prints the blocks to paste.
 */

/** Jobs that run the test suite, the game build, the lab shards or the browser smoke test. */
export const SUITE_CHECKOUT = [
  ".github",
  // Ash and stone redesign gait calibration and anatomy atlases.
  "art/biome-creatures",
  // Fairy garden and guardian skin textures that the asset tests hash.
  "art/fairy-population/textures/generated",
  // Icons the guide build copies.
  "art/item-icons",
  // The licensed cave scan the dungeon and cave-domain tests fit geometry against.
  "art/rebuild/candidates/finish-cave-source",
  // Legacy gait sources for the creature-motion tests.
  "art/rebuild/candidates/finish-motion",
  // Regional boss gait calibration.
  "assets/art/regional-bosses",
  "devdocs",
  // The committed guide output that the generated-Markdown tests read.
  "docs/game",
  "game",
  // game/src/multiplayer/identityAuthentication.ts imports identity/src/joinToken.ts.
  "identity",
  "tests",
  "tools",
] as const;

/** The server release: no test suite and no art, but the executable bundles the join-token code. */
export const RELEASE_CHECKOUT = [".github", "deploy", "devdocs", "game", "identity", "tests", "tools"] as const;

/** Jobs that only compile content and move it between a live server and the repository. */
export const CONTENT_CHECKOUT = [".github", "game", "tools"] as const;

/** The export self-test also starts a lab server, which signs join tokens. */
export const CONTENT_LAB_CHECKOUT = [".github", "game", "identity", "tools"] as const;

export const WORKFLOW_CHECKOUTS: Readonly<Record<string, readonly string[]>> = {
  "content-export.yml": CONTENT_CHECKOUT,
  "content-publish.yml": CONTENT_CHECKOUT,
  "content-selftest.yml": CONTENT_LAB_CHECKOUT,
  "docs.yml": SUITE_CHECKOUT,
  "release.yml": RELEASE_CHECKOUT,
};

export const workflowRoot = path.join(repoRoot, ".github/workflows");

export function workflowFiles(): string[] {
  return readdirSync(workflowRoot).filter(name => name.endsWith(".yml")).sort();
}

/** Every `sparse-checkout: |` block in one workflow, as the paths it lists. */
export function workflowSparseBlocks(file: string): string[][] {
  const lines = readFileSync(path.join(workflowRoot, file), "utf8").split(/\r?\n/);
  const blocks: string[][] = [];
  for (const [index, line] of lines.entries()) {
    const opener = /^(\s*)sparse-checkout: \|\s*$/.exec(line);
    if (!opener) continue;
    const block: string[] = [];
    for (let at = index + 1; at < lines.length; at++) {
      const entry = lines[at] ?? "";
      const indent = /^(\s*)(\S.*)?$/.exec(entry)!;
      if (!indent[2]) continue;
      if (indent[1]!.length <= opener[1]!.length) break;
      if (!indent[2].startsWith("#")) block.push(indent[2].trim());
    }
    blocks.push(block);
  }
  return blocks;
}

/** How many `actions/checkout` steps a workflow has, so none of them can skip the sparse list. */
export function workflowCheckoutSteps(file: string): number {
  return readFileSync(path.join(workflowRoot, file), "utf8").split(/\r?\n/)
    .filter(line => /^\s*-?\s*uses:\s*actions\/checkout@/.test(line)).length;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  for (const file of workflowFiles()) {
    console.log(`# ${file}`);
    console.log("          sparse-checkout: |");
    for (const entry of WORKFLOW_CHECKOUTS[file] ?? []) console.log(`            ${entry}`);
    console.log("");
  }
}
