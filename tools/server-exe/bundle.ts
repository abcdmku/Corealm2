import { build, type BuildOptions, type Metafile } from "esbuild";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";

/**
 * One file for the single executable. Node's SEA runs one embedded CommonJS script, so the whole
 * server — the reference host, the simulation, `ws` and the content compiler — is bundled into it.
 *
 * Two things about that bundle are load bearing:
 *
 *  - Install before import has to survive it. The entry installs the database's catalog and only
 *    then reaches the simulation through `await import()`. esbuild turns a bundled ESM module into
 *    a lazily initialised one and a dynamic import into a call of its initialiser, so the ordering
 *    holds inside the bundle exactly as it does on disk. `tests/server-bundle-ordering.test.ts`
 *    proves that against these options rather than against a paraphrase of them.
 *  - `ws` looks for two optional native addons. They are not installed, they must not be, and
 *    marking them external leaves the `try { require(...) } catch {}` that already handles their
 *    absence.
 */

/** The `ws` speed-ups. Native addons cannot live in a single executable, and `ws` works without them. */
export const OPTIONAL_NATIVE = ["bufferutil", "utf-8-validate"];

export function serverBundleOptions(entry: string, outfile: string): BuildOptions {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    // Readable stack traces from an operator's log are worth more than the megabytes: the Node
    // binary the bundle is injected into is fifty times its size.
    minify: false,
    sourcemap: false,
    legalComments: "none",
    metafile: true,
    external: OPTIONAL_NATIVE,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    logLevel: "warning",
  };
}

export interface ModuleSize { name: string; bytes: number }
export interface BundleResult {
  outfile: string;
  bytes: number;
  /** Bundled bytes by npm package, or by first path segment for the repository's own code. */
  modules: ModuleSize[];
  inputs: string[];
}

/** `node_modules/a/b/c.js` is package `a`; a scoped package keeps both segments. Our own code groups by folder. */
export function moduleOwner(path: string): string {
  const normalized = path.split("\\").join("/");
  const index = normalized.lastIndexOf("node_modules/");
  if (index < 0) return normalized.split("/").slice(0, 2).join("/");
  const parts = normalized.slice(index + "node_modules/".length).split("/");
  return parts[0]!.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

export function moduleSizes(metafile: Metafile, outfile: string): ModuleSize[] {
  const output = Object.entries(metafile.outputs).find(([name]) => name.endsWith(outfile.split("\\").join("/").split("/").at(-1)!));
  const totals = new Map<string, number>();
  for (const [path, entry] of Object.entries(output?.[1].inputs ?? {})) {
    const owner = moduleOwner(path);
    totals.set(owner, (totals.get(owner) ?? 0) + entry.bytesInOutput);
  }
  return [...totals].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
}

export async function bundleServer(entry: string, outfile: string, root: string): Promise<BundleResult> {
  const result = await build(serverBundleOptions(entry, outfile));
  const metafile = result.metafile!;
  const bytes = (await readFile(outfile)).length;
  return {
    outfile, bytes,
    modules: moduleSizes(metafile, outfile),
    inputs: Object.keys(metafile.inputs).map(path => relative(root, path).split("\\").join("/")),
  };
}

/**
 * Packages a release bundle may not contain. The world pack removes the server's need to parse GLBs,
 * and this is what keeps them from creeping back in through an import nobody noticed.
 */
export function forbiddenPackages(result: BundleResult, forbidden: readonly string[]): string[] {
  return forbidden.filter(name => result.modules.some(module => module.name === name || module.name.startsWith(`${name}/`)));
}
