import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The server boots from the world pack, so its module graph holds no renderer, no GLB reader and no
 * bake-time code. esbuild resolves the graph the way the executable's bundle does: type-only imports
 * are dropped, dynamic imports are followed.
 */
const ENTRIES = ["tools/multiplayer-server.ts", "game/src/multiplayer/referenceServer.ts",
  "game/src/multiplayer/worldPack.ts", "game/src/multiplayer/labWorld.ts"];
const FORBIDDEN_PACKAGES = /node_modules\/(three|@gltf-transform\/[^/]+|meshoptimizer|draco3d|draco3dgltf|playwright|playwright-core|jsdom|@recast-navigation\/three)\//;
const FORBIDDEN_SOURCES = [
  /^game\/src\/multiplayer\/bake\//,
  /^game\/src\/(ui|audio)\//,
  /^game\/src\/app\/boot\.ts$/,
  /^game\/src\/render\/(scene|assets|dungeon|materials|entityViews)\.ts$/,
  /^game\/src\/world\/scatter\.ts$/,
  /^game\/src\/systems\/navigationObstacles\.ts$/,
];

async function serverGraph(entries: readonly string[]): Promise<Map<string, string | null>> {
  const result = await build({ absWorkingDir: repoRoot, entryPoints: [...entries], bundle: true, write: false, metafile: true,
    platform: "node", format: "esm", outdir: path.join(repoRoot, ".tmp/server-import-graph"), logLevel: "silent" });
  const inputs = result.metafile.inputs, parent = new Map<string, string | null>(entries.map(entry => [entry, null]));
  for (const queue = [...entries]; queue.length;) {
    const current = queue.shift()!;
    for (const imported of inputs[current]?.imports ?? []) {
      if (imported.external || parent.has(imported.path)) continue;
      parent.set(imported.path, current);
      queue.push(imported.path);
    }
  }
  return parent;
}

const chain = (graph: Map<string, string | null>, file: string): string => {
  const steps: string[] = [];
  for (let at: string | null | undefined = file; at; at = graph.get(at)) steps.push(at);
  return steps.join(" <- ");
};

it("keeps the renderer, the GLB reader and the bake out of the server's module graph", async () => {
  const graph = await serverGraph(ENTRIES);
  expect(graph.size).toBeGreaterThan(100);
  // Report the importing module, not every file inside a forbidden package.
  const offenders = [...graph.keys()].filter(file => (FORBIDDEN_PACKAGES.test(file) && !FORBIDDEN_PACKAGES.test(graph.get(file) ?? ""))
    || FORBIDDEN_SOURCES.some(pattern => pattern.test(file)));
  expect(offenders.map(file => chain(graph, file))).toEqual([]);
}, 120_000);

it("still sees a forbidden import when there is one", async () => {
  const graph = await serverGraph(["game/src/multiplayer/bake/authoredWorld.ts"]);
  const packages = new Set([...graph.keys()].map(file => FORBIDDEN_PACKAGES.exec(file)?.[1]).filter(Boolean));
  expect([...packages].sort()).toEqual(expect.arrayContaining(["@gltf-transform/core", "three"]));
}, 120_000);
