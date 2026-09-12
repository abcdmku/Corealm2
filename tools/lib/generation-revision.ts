import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

function generationInputs(root: string): string[] {
  return [...readdirSync(path.join(root, "src"), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name)),
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
