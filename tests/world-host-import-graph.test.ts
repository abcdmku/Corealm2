import { expect, it } from "vitest";
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The host core runs in a Web Worker for local play, so nothing it imports may need Node: no
 * `node:*` module, no `ws`, no `Buffer`, no `process`. esbuild resolves the graph for a browser;
 * type-only imports are dropped and dynamic imports are followed.
 */
const ENTRY = "game/src/multiplayer/worldHost.ts";
const NODE_ONLY = ["ws", ...builtinModules.flatMap(name => [name, `node:${name}`])];
/** Modules the host core owns. Anything Node-only in these fails. */
const OWNED = [/^game\/src\/multiplayer\/worldHost\.ts$/];
/** Node-only code in modules the core reaches but does not own, by file, while its owner removes it. Empty means the whole graph is clean. */
const KNOWN_FOREIGN: Record<string, RegExp> = {};
const NODE_GLOBALS = /\bBuffer\b|\bprocess\.(?!env\.NODE_ENV\b)|\brequire\(/;

interface Offence { file: string; what: string }
async function browserGraph(entry: string): Promise<{ files: string[]; offences: Offence[] }> {
  const result = await build({ absWorkingDir: repoRoot, entryPoints: [entry], bundle: true, write: false, metafile: true, external: NODE_ONLY,
    platform: "browser", format: "esm", outdir: path.join(repoRoot, ".tmp/world-host-import-graph"), logLevel: "silent", loader: { ".wasm": "empty" } });
  const inputs = result.metafile.inputs, seen = new Set([entry]), offences: Offence[] = [];
  for (const queue = [entry]; queue.length;) {
    const current = queue.shift()!;
    for (const imported of inputs[current]?.imports ?? []) {
      if (imported.external) { if (NODE_ONLY.includes(imported.path)) offences.push({ file: current, what: `imports ${imported.path}` }); continue; }
      if (!seen.has(imported.path)) { seen.add(imported.path); queue.push(imported.path); }
    }
  }
  const files = [...seen].filter(file => file.startsWith("game/src/"));
  for (const file of files) {
    const lines = (await readFile(path.join(repoRoot, file), "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      // Comments say "process" freely, and a line that tests `typeof Buffer` is the guard that makes its use safe.
      const code = line.replace(/\/\*.*?\*\/|\/\/.*$|^\s*\/?\*.*$/g, "");
      const hit = /\btypeof (Buffer|process)\b/.test(code) ? null : NODE_GLOBALS.exec(code);
      if (hit) offences.push({ file, what: `${index + 1}: ${hit[0]}` });
    });
  }
  return { files, offences };
}

it("keeps Node out of the host core's module graph", async () => {
  const { files, offences } = await browserGraph(ENTRY);
  expect(files.length).toBeGreaterThan(50);
  const foreign = offences.filter(offence => !OWNED.some(pattern => pattern.test(offence.file)));
  if (foreign.length) console.log(`Node-only code in the host core's graph, outside the core:\n${foreign.map(offence => `  ${offence.file} ${offence.what}`).join("\n")}`);
  expect(offences.filter(offence => OWNED.some(pattern => pattern.test(offence.file)))).toEqual([]);
  expect(foreign.filter(offence => !KNOWN_FOREIGN[offence.file]?.test(offence.what))).toEqual([]);
}, 120_000);

it("still sees a Node import when there is one", async () => {
  const { offences } = await browserGraph("game/src/multiplayer/referenceServer.ts");
  expect(offences.map(offence => `${offence.file} ${offence.what}`)).toEqual(expect.arrayContaining([
    "game/src/multiplayer/referenceServer.ts imports node:http", "game/src/multiplayer/referenceServer.ts imports ws"]));
  expect(offences.some(offence => offence.file === "game/src/multiplayer/referenceServer.ts" && /Buffer/.test(offence.what))).toBe(true);
}, 120_000);
