import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { NON_BAKE_CONTENT_FILES } from "./bake-inputs.js";
import { pageGraph } from "./page-graph.js";

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
}

/** The Node bake drivers and the browser-only writers they invoke through a page URL. */
export const BAKE_ENTRIES = [
  "tools/build-release-world.ts", "tools/build-navmesh.ts", "tools/build-server-world-pack.ts",
  "game/src/world/worldBake.ts", "game/src/world/mobSpawnCache.ts", "game/src/app/realmTerrain.ts",
  "game/src/app/mobSpawns.ts", "game/src/render/assets.ts", "game/src/world/cachedWorldValue.ts",
  "tools/content/compile.ts",
] as const;

/**
 * Follow the bake's imports, including dynamic imports, with the same resolver as the bundle.
 * The browser bake still assembles geometry in boot.ts, so that orchestrator remains an input.
 * Its UI imports are not bake inputs. Geometry modules are shared with the server-world bake;
 * the browser-only writers above cover serialization and the second terrain's cache.
 */
export async function generationInputs(root: string): Promise<string[]> {
  const repo = path.resolve(root, "..");
  const graphs = await Promise.all(BAKE_ENTRIES.map(entry => pageGraph(path.join(repo, entry))));
  const excluded = new Set(NON_BAKE_CONTENT_FILES.map(file => path.resolve(root, file)));
  return [...new Set([
    ...graphs.flatMap(graph => [...graph.keys()]),
    path.join(root, "src/app/boot.ts"),
    ...filesUnder(path.join(root, "content/data")).filter(file => !excluded.has(path.resolve(file))),
    path.join(root, "public/assets/manifest.json"), path.join(repo, "package-lock.json"),
  ])].sort();
}

/**
 * The lockfile pins the dependencies a bake runs on, but it also repeats `package.json`'s own
 * `version`, which is the base game version and names a release, not an input. It is taken out,
 * so bumping the base version for a release never stales a baked world.
 */
export function lockfileWithoutVersion(text: string): string {
  const lock = JSON.parse(text) as { version?: unknown; packages?: Record<string, { version?: unknown }> };
  delete lock.version;
  if (lock.packages?.[""]) delete lock.packages[""].version;
  return JSON.stringify(lock, null, 2);
}

export async function generationRevision(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await generationInputs(root)) {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update('\0'); hash.update(path.basename(file) === 'package-lock.json' ? lockfileWithoutVersion(text) : text); hash.update('\0');
  }
  return hash.digest('hex');
}

/** Invalidate derived browser data for source, asset metadata or dependency changes. */
export function generationRevisionPlugin(): Plugin {
  const id = "virtual:corealm-generation-revision", resolved = `\0${id}`;
  let root = "";
  return {
    name: "corealm-generation-revision",
    configResolved(config) { root = path.resolve(config.root); },
    resolveId(source) { if (source === id) return resolved; },
    async load(source) {
      if (source !== resolved) return;
      return `export default ${JSON.stringify(await generationRevision(root))};`;
    },
    async handleHotUpdate(context) {
      if (!(await generationInputs(root)).includes(path.resolve(context.file))) return;
      const module = context.server.moduleGraph.getModuleById(resolved);
      if (module) context.server.moduleGraph.invalidateModule(module);
      // A live world cannot mix derived data from two source revisions.
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
