import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { LOCAL_WORLD_MANIFEST, type LocalWorldManifest } from "../../game/src/worker/localHostProtocol.js";

/**
 * What the local-play worker fetches before it can host a world, published beside the client:
 *
 *   generated/local-world.json               the manifest, the one file with a fixed name
 *   generated/server-catalog-<hash>.json     every compiled table plus `formulaRevision`
 *   generated/server-world.pack              already in `public/`, fetched as `?v=<pack revision>`
 *
 * The catalog's name carries a hash of its own bytes and the pack's URL carries its revision, so
 * either can be cached for good, and the manifest is fetched with `no-cache`. A new build therefore
 * never pairs a fresh worker with a stale catalog or pack.
 *
 * The build emits the two JSON files. The dev server answers the same URLs from the compiled catalog
 * on disk, read again whenever it changes, so an edit made in devdocs reaches the next local session
 * without a restart and nothing is written into `public/generated`.
 */
const PACK_FILE = "server-world.pack";

/** The catalog a server seeds its database with: the compile output without its authoring source map and diagnostics. */
export function serverCatalogJson(compiledCatalogPath: string): { text: string; revision: string; formulaRevision: string } {
  const compiled = JSON.parse(readFileSync(compiledCatalogPath, "utf8")) as { version: number; revision: string; formulaRevision: string; tables: Record<string, unknown> };
  if (compiled.version !== 1 || typeof compiled.revision !== "string" || typeof compiled.formulaRevision !== "string") throw new Error(`${compiledCatalogPath} is not a compiled catalog`);
  return { revision: compiled.revision, formulaRevision: compiled.formulaRevision,
    text: JSON.stringify({ version: 1, revision: compiled.revision, formulaRevision: compiled.formulaRevision, tables: compiled.tables }) };
}

/** Revision and seeds from the pack's header, without reading ten megabytes to get them. */
export function packHeader(packPath: string): { revision: string; seeds: number[]; bytes: number } {
  const file = openSync(packPath, "r");
  try {
    const head = Buffer.alloc(48); readSync(file, head, 0, 48, 0);
    if (head.subarray(0, 8).toString("latin1") !== "CRLMWPCK") throw new Error(`${packPath} is not a server world pack`);
    const json = Buffer.alloc(head.readUInt32LE(12)); readSync(file, json, 0, json.length, 48);
    const header = JSON.parse(json.toString("utf8")) as { revision: string; seeds: number[] };
    return { revision: header.revision, seeds: header.seeds, bytes: statSync(packPath).size };
  } finally { closeSync(file); }
}

export interface LocalWorldFiles { manifest: LocalWorldManifest; catalogFile: string; catalogText: string }
export function localWorldFiles(gameRoot: string): LocalWorldFiles {
  const catalog = serverCatalogJson(path.join(gameRoot, "content/compiled/catalog.json"));
  const pack = packHeader(path.join(gameRoot, "public/generated", PACK_FILE));
  const catalogFile = `server-catalog-${createHash("sha256").update(catalog.text).digest("hex").slice(0, 16)}.json`;
  return { catalogFile, catalogText: catalog.text, manifest: { version: 1,
    catalog: { revision: catalog.revision, formulaRevision: catalog.formulaRevision, file: catalogFile, bytes: Buffer.byteLength(catalog.text) },
    pack: { file: PACK_FILE, revision: pack.revision, seeds: pack.seeds, bytes: pack.bytes } } };
}

export function localWorldFilesPlugin(): Plugin {
  let root = "";
  let cached: { stamp: string; files: LocalWorldFiles } | null = null;
  const current = (): LocalWorldFiles => {
    const stamp = ["content/compiled/catalog.json", `public/generated/${PACK_FILE}`].map(file => statSync(path.join(root, file)).mtimeMs).join(":");
    if (cached?.stamp !== stamp) cached = { stamp, files: localWorldFiles(root) };
    return cached.files;
  };
  return {
    name: "corealm-local-world-files",
    configResolved(config) { root = path.resolve(config.root); },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = /\/generated\/([^/?#]+)(?:[?#]|$)/.exec(request.url ?? "")?.[1];
        if (name !== LOCAL_WORLD_MANIFEST && !/^server-catalog-[0-9a-f]{16}\.json$/.test(name ?? "")) { next(); return; }
        try {
          const files = current();
          if (name !== LOCAL_WORLD_MANIFEST && name !== files.catalogFile) { response.statusCode = 404; response.end(); return; }
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", name === LOCAL_WORLD_MANIFEST ? "no-cache" : "public, max-age=31536000, immutable");
          response.end(name === LOCAL_WORLD_MANIFEST ? JSON.stringify(files.manifest) : files.catalogText);
        } catch (error) { response.statusCode = 500; response.end(String(error)); }
      });
    },
    generateBundle() {
      const files = localWorldFiles(root);
      this.emitFile({ type: "asset", fileName: `generated/${LOCAL_WORLD_MANIFEST}`, source: JSON.stringify(files.manifest) });
      this.emitFile({ type: "asset", fileName: `generated/${files.catalogFile}`, source: files.catalogText });
    },
  };
}
