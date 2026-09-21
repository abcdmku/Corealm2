import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { contentType, type AdminUiSource } from "./adminUi.js";

/**
 * What a packaged server carries inside itself, and where the same files live in a checkout.
 *
 * A single executable reads its assets through `node:sea`, whose keys are flat strings. Run from the
 * repository the same names resolve to files, so `tools/multiplayer-server.ts` is one program with
 * one code path whether it runs under `tsx` or as `corealm-server.exe`.
 */

/** The baked world the server simulates instead of parsing GLBs. Built by the world pack step. */
export const SERVER_WORLD_PACK_FILE = "server-world.pack";
/** The devdocs server-mode build, as the archive below. */
export const ADMIN_UI_ASSET = "admin-ui.archive";
/** `{catalog, sources}`: the catalog a packaged server seeds an empty database with, with its `formulaRevision`. */
export const SEED_CATALOG_ASSET = "seed-catalog.json";
/** `game/public/assets/manifest.json`, which a publish checks asset ids against when no asset host is configured. */
export const ASSET_MANIFEST_ASSET = "asset-manifest.json";
export const BUILD_INFO_ASSET = "build-info.json";

/**
 * Assets that are an ordinary file in a checkout. The rest exist only in a build.
 *
 * The pack's path is written out rather than imported from `worldPack.ts`, because this module is
 * loaded before `installCatalog` and that one reads content tables. `tests/server-packaging.test.ts`
 * holds the two to the same value.
 */
const REPO_PATHS: Readonly<Record<string, string>> = {
  [SERVER_WORLD_PACK_FILE]: `game/public/generated/${SERVER_WORLD_PACK_FILE}`,
  [ASSET_MANIFEST_ASSET]: "game/public/assets/manifest.json",
};
/** Where an asset lives in a checkout, `/`-separated and relative to the repository root. */
export const repoPathOf = (name: string): string | null => REPO_PATHS[name] ?? null;

/** The part of `node:sea` this module uses. Injected so both branches have a test. */
export interface SeaApi {
  isSea(): boolean;
  getRawAsset(key: string): ArrayBuffer;
}

export interface EmbeddedOptions {
  /** `node:sea`, or null to force the checkout branch. */
  sea?: SeaApi | null;
  /** Repository root for the checkout branch. */
  root?: string;
  readFile?(path: string): Uint8Array;
}

export interface Embedded {
  /** True when this process is a single executable and its assets come from inside it. */
  readonly sea: boolean;
  asset(name: string): Uint8Array | null;
  text(name: string): string | null;
  json(name: string): unknown;
}

export function createEmbedded(options: EmbeddedOptions = {}): Embedded {
  const sea = options.sea === undefined ? loadSea() : options.sea;
  const packaged = sea !== null && sea.isSea();
  const root = options.root ?? process.cwd();
  const readFile = options.readFile ?? (path => readFileSync(path));
  return {
    sea: packaged,
    asset(name) {
      if (packaged) {
        // `getRawAsset` throws for a key the blob does not carry, which is how an optional asset is absent.
        try { return new Uint8Array(sea!.getRawAsset(name)); } catch { return null; }
      }
      const path = REPO_PATHS[name];
      if (path === undefined) return null;
      try { return readFile(resolve(root, path)); } catch { return null; }
    },
    text(name) {
      const bytes = this.asset(name);
      return bytes === null ? null : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
    },
    json(name) {
      const text = this.text(name);
      return text === null ? null : JSON.parse(text);
    },
  };
}

function loadSea(): SeaApi | null {
  // The bundled entry is CommonJS, which is what a single executable runs. Under `tsx` there is no
  // `require` and no blob, and both mean the same thing: read the files from the checkout.
  if (typeof require !== "function") return null;
  try {
    const module = require("node:sea") as SeaApi;
    return typeof module?.isSea === "function" ? module : null;
  } catch { return null; }
}

/** The process's own assets. */
export const embedded: Embedded = createEmbedded();
export const embeddedAsset = (name: string): Uint8Array | null => embedded.asset(name);

/**
 * Where a packaged server's configuration file and data directory sit: beside the executable, so an
 * operator can drop the binary and its `corealm-server.json` into a folder and start it from
 * anywhere. Run from a checkout the working directory decides, which is what every launcher expects.
 */
export function serverBaseDir(runtime: { sea: boolean; execPath: string; cwd: string }): string {
  return runtime.sea ? dirname(runtime.execPath) : runtime.cwd;
}

export interface BuildInfo {
  name: string;
  version: string;
  /** ISO 8601, or `unknown` when this is not a build. */
  builtAt: string;
  node: string;
  commit: string | null;
  /** The catalog this release seeds an empty database with, and the formula code it was compiled with. */
  catalogRevision: string | null;
  formulaRevision: string | null;
  /** The base game version of that catalog: `package.json`'s `version` at build time. `version` above names the executable build. */
  baseVersion: string | null;
  /** Whether the baked server world pack is inside this build. */
  worldPack: boolean;
}
export const DEVELOPMENT_BUILD: BuildInfo = {
  name: "corealm-server", version: "dev", builtAt: "unknown", node: "dev", commit: null,
  catalogRevision: null, formulaRevision: null, baseVersion: null, worldPack: false,
};

/** What `--version` prints. A checkout says `dev`, because nothing stamped it. */
export function buildInfo(source: Embedded = embedded): BuildInfo {
  const value = source.json(BUILD_INFO_ASSET);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return DEVELOPMENT_BUILD;
  return { ...DEVELOPMENT_BUILD, ...value as Partial<BuildInfo> };
}

/*
 * The admin UI archive. SEA asset keys are flat strings, so a build could embed one asset per file,
 * but then every file name is part of the blob's key space and a missing file is indistinguishable
 * from a key the API owns. One asset with an index in front is smaller, is read once, and makes the
 * whole build atomic.
 *
 *   "CRLMUI01" | uint32LE index length | index JSON | file bytes
 *
 * The index is `{"files":{"<path>":[offset,length]}}`, and an offset counts from the first file
 * byte rather than from the start of the archive, so writing the index cannot move what it names.
 */
const MAGIC = "CRLMUI01";
const HEADER = MAGIC.length + 4;

export function packAdminUiArchive(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const names = [...files.keys()].sort();
  const index: Record<string, [number, number]> = {};
  let offset = 0;
  for (const name of names) { const bytes = files.get(name)!; index[name] = [offset, bytes.length]; offset += bytes.length; }
  const text = Buffer.from(JSON.stringify({ files: index }), "utf8");
  const head = Buffer.alloc(HEADER);
  head.write(MAGIC, 0, "latin1");
  head.writeUInt32LE(text.length, MAGIC.length);
  return Buffer.concat([head, text, ...names.map(name => Buffer.from(files.get(name)!))]);
}

export interface AdminUiArchive {
  names(): string[];
  file(path: string): Buffer | null;
}
export function readAdminUiArchive(bytes: Uint8Array): AdminUiArchive {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < HEADER || buffer.toString("latin1", 0, MAGIC.length) !== MAGIC) throw new Error("That is not a Corealm admin UI archive");
  const length = buffer.readUInt32LE(MAGIC.length);
  if (HEADER + length > buffer.length) throw new Error("The admin UI archive index runs past its end");
  const index = JSON.parse(buffer.toString("utf8", HEADER, HEADER + length)) as { files: Record<string, [number, number]> };
  const start = HEADER + length;
  return {
    names: () => Object.keys(index.files),
    file(path) {
      const entry = Object.prototype.hasOwnProperty.call(index.files, path) ? index.files[path] : undefined;
      if (!entry || entry[0] < 0 || entry[1] < 0 || start + entry[0] + entry[1] > buffer.length) return null;
      return buffer.subarray(start + entry[0], start + entry[0] + entry[1]);
    },
  };
}

/**
 * The embedded build as an `AdminUiSource`. A path is a key in the index and nothing else, so no
 * path can leave the archive however it was encoded; `adminUiPath` still rejects the ugly ones first.
 */
export function archiveAdminUi(bytes: Uint8Array): AdminUiSource {
  const archive = readAdminUiArchive(bytes);
  return { async read(path) {
    const file = archive.file(path);
    return file === null ? null : { bytes: file, type: contentType(path) };
  } };
}
