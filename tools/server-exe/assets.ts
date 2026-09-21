import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  ADMIN_UI_ASSET, ASSET_MANIFEST_ASSET, BUILD_INFO_ASSET, SEED_CATALOG_ASSET, SERVER_WORLD_PACK_FILE, packAdminUiArchive,
  type BuildInfo,
} from "../../game/src/multiplayer/embedded.js";
import { repoBaseCatalog } from "../lib/repoCatalog.js";

/**
 * What goes inside the executable: the baked world, the admin UI, the catalog the server seeds an
 * empty database with, the asset manifest a publish checks ids against, and a record of the build.
 *
 * Each is staged as a file under `dist/server/assets/` and named in the SEA configuration, so the
 * whole set is inspectable after a build instead of only existing inside a blob.
 */

const run = promisify(execFile);

export interface StagedAsset { name: string; path: string; bytes: number; from: string }

export interface AssetOptions {
  root: string;
  /** Where the staged copies are written. Emptied first. */
  stageDir: string;
  /** The devdocs server-mode build. `npm run devdocs:build:server` writes `dist/devdocs-server`. */
  adminUiDir: string;
  version: string;
  log?(message: string): void;
}

/** Every file of a built directory, `/`-separated and relative to it, which is how the archive keys them. */
export async function collectFiles(directory: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.set(relative(directory, path).split("\\").join("/"), await readFile(path));
    }
  };
  await walk(directory);
  return files;
}

async function headCommit(root: string): Promise<string | null> {
  try { return (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim() || null; } catch { return null; }
}

export async function stageAssets(options: AssetOptions): Promise<{ assets: StagedAsset[]; build: BuildInfo }> {
  const log = options.log ?? (() => {});
  const stage = resolve(options.stageDir);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const staged: StagedAsset[] = [];
  const put = async (name: string, bytes: Uint8Array, from: string): Promise<void> => {
    const path = join(stage, name);
    await writeFile(path, bytes);
    staged.push({ name, path, bytes: bytes.length, from });
  };

  const adminUi = resolve(options.adminUiDir);
  if (!await stat(join(adminUi, "index.html")).then(entry => entry.isFile(), () => false)) {
    throw new Error(`${adminUi} has no index.html. Run: npm run devdocs:build:server`);
  }
  const files = await collectFiles(adminUi);
  await put(ADMIN_UI_ASSET, packAdminUiArchive(files), `${options.adminUiDir} (${files.size} files)`);

  // The catalog this release ships with, compiled from the checkout, with the `formulaRevision` of
  // the formulas that are in the bundle. A publish on the running server compiles with that same
  // value, so a bundled server and this build agree on every revision they produce. It carries the base
  // version, `package.json`'s, beside the catalog: what the server's content says it comes from.
  const base = await repoBaseCatalog();
  await put(SEED_CATALOG_ASSET, Buffer.from(JSON.stringify(base), "utf8"), "game/content/data + game/src/content");

  const manifest = join(options.root, "game/public/assets/manifest.json");
  await put(ASSET_MANIFEST_ASSET, await readFile(manifest), "game/public/assets/manifest.json");

  const packPath = join(options.root, "game/public/generated", SERVER_WORLD_PACK_FILE);
  const pack = await readFile(packPath).catch(() => null);
  if (pack) await put(SERVER_WORLD_PACK_FILE, pack, relative(options.root, packPath).split("\\").join("/"));
  else log(`no ${SERVER_WORLD_PACK_FILE} under game/public/generated: the authored world still boots from the shipped GLBs`);

  const build: BuildInfo = {
    name: "corealm-server",
    version: options.version,
    builtAt: new Date().toISOString(),
    node: process.versions.node,
    commit: await headCommit(options.root),
    catalogRevision: base.catalog.revision,
    formulaRevision: base.catalog.formulaRevision,
    baseVersion: base.version,
    worldPack: pack !== null,
  };
  await put(BUILD_INFO_ASSET, Buffer.from(`${JSON.stringify(build, null, 2)}\n`, "utf8"), "the build");
  return { assets: staged, build };
}
