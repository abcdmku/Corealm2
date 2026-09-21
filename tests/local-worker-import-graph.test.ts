import { expect, it } from "vitest";
import { build, type Metafile } from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The local-play worker is a browser with no DOM. esbuild resolves its graph for a browser, drops
 * type-only imports and follows dynamic ones, and the graph is then held to four things:
 *
 *  - no renderer, no GLB reader, no UI: the worker simulates and nothing else;
 *  - nothing from Node;
 *  - no bundled catalog: the worker installs the one it fetched;
 *  - install before import: what the entry loads statically evaluates no content table.
 */
const ENTRY = "game/src/worker/localHost.ts";
const NODE_ONLY = ["ws", ...builtinModules.flatMap(name => [name, `node:${name}`])];
const FORBIDDEN_PACKAGES = /node_modules\/(three|@gltf-transform\/[^/]+|meshoptimizer|draco3d|draco3dgltf|@recast-navigation\/three|ws)\//;
const FORBIDDEN_SOURCES = [
  /^game\/src\/(ui|audio|debug)\//,
  // `render/` also holds the plain-data structure and composition specs the world is assembled from. These are the ones that draw.
  /^game\/src\/render\/(scene|assets|dungeon|materials|entityViews)\.ts$/,
  /^game\/src\/world\/scatter\.ts$/,
  /^game\/src\/systems\/navigationObstacles\.ts$/,
  /^game\/src\/app\/(boot|loop)\.ts$/,
  /^game\/src\/multiplayer\/(bake\/|referenceServer|sqliteStorage|adminStorage|browserSession|worldSelector)/,
  /^game\/src\/content\/bundledCatalog\.ts$/,
  /^game\/content\/compiled\//,
];
/** A worker has no `window`, so even reading a page knob off it throws. `window` alone is also a building part in the structure specs. */
const DOM_OR_NODE_GLOBALS = /\b(?:document|localStorage|sessionStorage)\s*\.|\bwindow\.(?:addEventListener|removeEventListener|location|innerWidth|innerHeight|devicePixelRatio|requestAnimationFrame|matchMedia|__\w+)|\bBuffer\b|\bprocess\.(?!env\.NODE_ENV\b)|\brequire\(/;

/** Uses that sit behind a guard on an earlier line, which a line scan cannot see. */
const GUARDED: Record<string, RegExp> = { "game/src/systems/navigation.ts": /^window\.__corealmNavigationArtifact$/ };

type Inputs = Metafile["inputs"];
async function browserInputs(entry: string): Promise<Inputs> {
  const result = await build({ absWorkingDir: repoRoot, entryPoints: [entry], bundle: true, write: false, metafile: true, external: NODE_ONLY,
    platform: "browser", format: "esm", splitting: true, outdir: path.join(repoRoot, ".tmp/local-worker-import-graph"), logLevel: "silent", loader: { ".wasm": "empty" } });
  return result.metafile.inputs;
}
/** Every module reached from `entry`. With `staticOnly`, dynamic imports are not followed: that is what evaluates before the entry's own code runs. */
function reach(inputs: Inputs, entry: string, staticOnly: boolean): Map<string, string | null> {
  const parent = new Map<string, string | null>([[entry, null]]);
  for (const queue = [entry]; queue.length;) {
    const current = queue.shift()!;
    for (const imported of inputs[current]?.imports ?? []) {
      if (staticOnly && imported.kind === "dynamic-import") continue;
      const name = imported.external ? `external:${imported.path}` : imported.path;
      if (parent.has(name)) continue;
      parent.set(name, current);
      if (!imported.external) queue.push(name);
    }
  }
  return parent;
}
const chain = (graph: Map<string, string | null>, file: string): string => {
  const steps: string[] = [];
  for (let at: string | null | undefined = file; at; at = graph.get(at)) steps.push(at);
  return steps.join(" <- ");
};

it("keeps the renderer, the DOM, Node and the bundled catalog out of the worker's module graph", async () => {
  const graph = reach(await browserInputs(ENTRY), ENTRY, false);
  expect(graph.size).toBeGreaterThan(100);
  expect([...graph.keys()]).toEqual(expect.arrayContaining(["game/src/multiplayer/worldHost.ts", "game/src/multiplayer/worldPack.ts", "game/src/multiplayer/indexedDbStorage.ts", "game/src/content/resolvedCatalog.ts"]));
  const offenders = [...graph.keys()].filter(file => file.startsWith("external:")
    || (FORBIDDEN_PACKAGES.test(file) && !FORBIDDEN_PACKAGES.test(graph.get(file) ?? "")) || FORBIDDEN_SOURCES.some(pattern => pattern.test(file)));
  expect(offenders.map(file => chain(graph, file))).toEqual([]);

  const uses: string[] = [];
  for (const file of [...graph.keys()].filter(name => name.startsWith("game/src/"))) {
    (await readFile(path.join(repoRoot, file), "utf8")).split(/\r?\n/).forEach((line, index) => {
      // Comments name these freely, and a line that tests `typeof x` is the guard that makes the use safe.
      const code = line.replace(/\/\*.*?\*\/|\/\/.*$|^\s*\/?\*.*$/g, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "\"\"");
      const hit = /\btypeof (?:window|document|localStorage|Buffer|process)\b/.test(code) ? null : DOM_OR_NODE_GLOBALS.exec(code);
      if (hit && !GUARDED[file]?.test(hit[0])) uses.push(`${file}:${index + 1} ${hit[0]}`);
    });
  }
  expect(uses).toEqual([]);
}, 120_000);

it("evaluates no content before the catalog is installed", async () => {
  const before = reach(await browserInputs(ENTRY), ENTRY, true);
  // `labSpec.ts` and `labProtocol.ts` are the lab's two boundary validators. Like `localHostProtocol.ts`, they import the contracts and types only.
  expect([...before.keys()].sort()).toEqual(["game/src/content/catalogInstall.ts", "game/src/contracts.ts", "game/src/featureLab/labSpec.ts", "game/src/worker/labProtocol.ts",
    "game/src/worker/localHost.ts", "game/src/worker/localHostProtocol.ts"]);
}, 120_000);

it("still sees the renderer when it is there", async () => {
  const graph = reach(await browserInputs("game/src/multiplayer/browserSession.ts"), "game/src/multiplayer/browserSession.ts", false);
  expect([...graph.keys()].some(file => FORBIDDEN_PACKAGES.test(file))).toBe(true);
  expect([...graph.keys()].some(file => FORBIDDEN_SOURCES.some(pattern => pattern.test(file)))).toBe(true);
}, 120_000);
