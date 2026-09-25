import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * Install before import, per thread. A world thread has its own module graph, so it installs the
 * database's catalog itself and only then imports the simulation. That holds only while nothing a
 * thread loads at start reaches a content table through static imports: the entry a checkout starts
 * threads from, and the server program, which is what the single executable's threads run.
 */
const READS_TABLES = "game/src/content/resolvedCatalog.ts";

async function staticGraph(entry: string): Promise<Set<string>> {
  const result = await build({ absWorkingDir: repoRoot, entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "node", format: "esm",
    outdir: path.join(repoRoot, ".tmp/thread-install-order"), logLevel: "silent" });
  const inputs = result.metafile.inputs, seen = new Set([entry]);
  for (const queue = [entry]; queue.length;) for (const imported of inputs[queue.shift()!]?.imports ?? []) {
    if (imported.external || imported.kind === "dynamic-import" || seen.has(imported.path)) continue;
    seen.add(imported.path); queue.push(imported.path);
  }
  return seen;
}

for (const entry of ["game/src/multiplayer/threads/threadEntry.ts", "tools/multiplayer-server.ts"]) it(`${entry} evaluates no content table before a thread has installed its catalog`, async () => {
  const graph = await staticGraph(entry);
  expect(graph.has("game/src/multiplayer/threads/worldThread.ts")).toBe(true);
  expect(graph.has(READS_TABLES)).toBe(false);
  // The check can see a content read when there is one.
  expect((await staticGraph("game/src/multiplayer/localHostControl.ts")).has(READS_TABLES)).toBe(true);
}, 120_000);
