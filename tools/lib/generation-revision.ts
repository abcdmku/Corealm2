import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));
}

/**
 * Every file whose bytes can change derived world data. Exported so a test can prove the shipped
 * JSON content store is covered while the dev-only `content/meta` (notes, approvals) is not.
 */
export function generationInputs(root: string): string[] {
  // Recursive source coverage includes separate terrain maps, region content and compositions
  // such as realmTerrain, Crownward and the fairy regions without maintaining a second file list.
  // `content/data` holds the JSON tables the loaders under `src/content` import; `content/meta`
  // is deliberately absent because approval state must never invalidate a baked world.
  return [...filesUnder(path.join(root, "src")), ...filesUnder(path.join(root, "content/data")),
    path.join(root, "public/assets/manifest.json"), path.join(root, "../package-lock.json")].sort();
}

export function generationRevision(root: string): string {
  const hash = createHash('sha256');
  for (const file of generationInputs(root)) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update('\0'); hash.update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')); hash.update('\0');
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
    load(source) {
      if (source !== resolved) return;
      return `export default ${JSON.stringify(generationRevision(root))};`;
    },
    handleHotUpdate(context) {
      if (!generationInputs(root).includes(path.resolve(context.file))) return;
      const module = context.server.moduleGraph.getModuleById(resolved);
      if (module) context.server.moduleGraph.invalidateModule(module);
      // A live world cannot mix derived data from two source revisions.
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
