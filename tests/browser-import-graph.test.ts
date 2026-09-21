import { expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * Local play moves into a Web Worker, so the world host, its storage and the catalog install have to
 * resolve with no Node built-in anywhere in their graph. `node:sqlite` or `node:crypto` in there is
 * not a slow import, it is a worker that cannot start.
 *
 * esbuild resolves the same way the worker bundle will: `platform: "browser"`, type-only imports
 * dropped, dynamic imports followed. Every `node:` specifier is recorded rather than resolved, so
 * the failure names the module that asked for it and the chain that pulled it in.
 */
const ENTRIES = [
  "game/src/multiplayer/memoryStorage.ts",
  "game/src/multiplayer/headlessWorld.ts",
  "game/src/multiplayer/worldPack.ts",
  "game/src/multiplayer/labWorld.ts",
  "game/src/content/catalogInstall.ts",
];

interface Graph { parent: Map<string, string | null>; builtins: { specifier: string; importer: string }[] }

async function browserGraph(entries: readonly string[]): Promise<Graph> {
  const builtins: { specifier: string; importer: string }[] = [];
  const result = await build({
    absWorkingDir: repoRoot, entryPoints: [...entries], bundle: true, write: false, metafile: true,
    platform: "browser", format: "esm", outdir: path.join(repoRoot, ".tmp/browser-import-graph"), logLevel: "silent",
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta.env.BASE_URL": '"/"' },
    plugins: [{
      name: "record-node-builtins",
      setup(builder) {
        builder.onResolve({ filter: /^node:/ }, args => {
          builtins.push({ specifier: args.path, importer: path.relative(repoRoot, args.importer).replaceAll("\\", "/") });
          return { path: args.path, external: true };
        });
      },
    }],
  });
  const inputs = result.metafile.inputs, parent = new Map<string, string | null>(entries.map(entry => [entry, null]));
  for (const queue = [...entries]; queue.length;) {
    const current = queue.shift()!;
    for (const imported of inputs[current]?.imports ?? []) {
      if (imported.external || parent.has(imported.path)) continue;
      parent.set(imported.path, current);
      queue.push(imported.path);
    }
  }
  return { parent, builtins };
}

const chain = (parent: Map<string, string | null>, file: string): string => {
  const steps: string[] = [];
  for (let at: string | null | undefined = file; at; at = parent.get(at)) steps.push(at);
  return steps.join(" <- ");
};

it("keeps every Node built-in out of the world host's browser graph", async () => {
  const { parent, builtins } = await browserGraph(ENTRIES);
  expect(parent.size).toBeGreaterThan(100);
  const offenders = [...new Set(builtins.map(found => `${found.specifier} <- ${chain(parent, found.importer)}`))];
  expect(offenders).toEqual([]);
}, 120_000);

it("still sees a Node built-in when there is one", async () => {
  const { parent, builtins } = await browserGraph(["game/src/multiplayer/sqliteStorage.ts"]);
  expect(new Set(builtins.map(found => found.specifier))).toContain("node:sqlite");
  expect(chain(parent, "game/src/multiplayer/sqliteStorage.ts")).toBe("game/src/multiplayer/sqliteStorage.ts");
}, 120_000);
