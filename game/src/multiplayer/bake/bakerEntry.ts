import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { installCatalog, type InstalledCatalog } from "../../content/catalogInstall.js";
import type { BakerJob, BakerResult, BakeStepName } from "../serverWorldBake.js";

/**
 * The world baker: one bake of a server's world geometry, in a process of its own. A server starts
 * it (`serverWorldBake.ts`, `bakerProcess`) with the path of a `BakerJob`, and it:
 *
 *   1. installs the job's catalog, before any content module loads (install before import);
 *   2. bakes the server world pack for every seed (`bake/authoredWorld.ts`, the `world:build` pack step);
 *   3. bakes the client world records and navmesh (`world/bake/nodeWorldBake.ts`);
 *   4. checks them as the release gates do (`tools/lib/world-artifact.ts`) and writes a `BakerResult`.
 *
 * Progress goes to stdout as `{"bake":"step",...}` lines, a failure as `{"bake":"error",...}` and a
 * non-zero exit. GLBs come from the job's overlay (this server's models), the asset cache, a
 * checkout's `game/public/assets`, then the asset host, and only the ones the bake reads are fetched.
 *
 * This module loads three, gltf-transform and recast through its dynamic imports. The server never
 * imports it: packaged, it is a separate bundle (`world-baker.cjs`) the server only reads as data.
 */

const say = (event: Record<string, unknown>): void => { process.stdout.write(`${JSON.stringify(event)}\n`); };

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }

/** Files a model names beside itself: `images[].uri` and `buffers[].uri` of a `.glb`'s JSON chunk, resolved against its folder. */
export function externalFiles(file: string, bytes: Uint8Array): string[] {
  if (!file.endsWith(".glb") || bytes.length < 20) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return [];
  let json: { images?: { uri?: string }[]; buffers?: { uri?: string }[] };
  try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))); } catch { return []; }
  return [...json.images ?? [], ...json.buffers ?? []].map(entry => entry.uri).filter((uri): uri is string => typeof uri === "string" && !/^[a-z]+:/i.test(uri))
    .map(uri => posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(uri)))).filter(path => !path.startsWith(".."));
}

/** Puts a manifest `file`, and whatever it names beside itself, into the bake's asset directory from the first source that has it, once, and answers its path. */
function assetMaterializer(job: BakerJob, sizes: ReadonlyMap<string, number | undefined>) {
  const pending = new Map<string, Promise<void>>();
  const place = async (target: string, source: string): Promise<void> => {
    await mkdir(dirname(target), { recursive: true });
    try { await link(source, target); } catch { await copyFile(source, target); }
  };
  async function fetchToCache(file: string, expected: number | undefined): Promise<string> {
    const cached = join(job.cacheDir, ...file.split("/"));
    const size = await stat(cached).then(found => found.size, () => -1);
    if (size >= 0 && (expected === undefined || size === expected)) return cached;
    if (!job.assetBaseUrl) throw new Error(`No asset host is configured to fetch ${file} from`);
    const url = new URL(`assets/${file}`, job.assetBaseUrl);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The asset host answered ${response.status} for ${url.href}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (expected !== undefined && bytes.length !== expected) throw new Error(`${url.href} is ${bytes.length} bytes, but the manifest says ${expected}`);
    await mkdir(dirname(cached), { recursive: true });
    const temporary = `${cached}.${process.pid}.tmp`;
    await writeFile(temporary, bytes); await rename(temporary, cached);
    return cached;
  }
  async function materialize(file: string): Promise<void> {
    const target = join(job.assetsDir, ...file.split("/"));
    if (existsSync(target)) return;
    const overlay = join(job.overlayDir, ...file.split("/"));
    const local = job.localAssetsDir ? join(job.localAssetsDir, ...file.split("/")) : null;
    await place(target, await exists(overlay) ? overlay : local && await exists(local) ? local : await fetchToCache(file, sizes.get(file)));
    // A model may keep its textures in files of their own, which the GLB reader opens beside it.
    await Promise.all(externalFiles(file, new Uint8Array(await readFile(target))).map(ensure));
  }
  const ensure = async (file: string): Promise<string> => {
    let done = pending.get(file);
    if (!done) { done = materialize(file); pending.set(file, done); }
    await done;
    return join(job.assetsDir, ...file.split("/"));
  };
  return ensure;
}

/** The records a release manifest must list, as `tools/lib/world-artifact.ts` computes them. */
async function expectedRecords(): Promise<{ tiles: string[]; keys: string[] }> {
  const [{ buildWorldTerrainSpec, buildFairyTerrainSpec }, { scatterTilesForBounds }, { WORLD_SITES }] = await Promise.all([
    import("../../app/worldSpec.js"), import("../../world/scatter.js"), import("../../content/worldSites.js")]);
  const tiles = [buildWorldTerrainSpec(), buildFairyTerrainSpec()].flatMap(spec => {
    const padding = spec.coast?.collar ?? 0;
    return scatterTilesForBounds({ minX: spec.bounds.minX - padding, maxX: spec.bounds.maxX + padding, minZ: spec.bounds.minZ - padding, maxZ: spec.bounds.maxZ + padding }).map(tile => tile.id);
  });
  const keys = ["terrain/world", "terrain/fairy", "spawns/world", "assembly/semantic", "assembly/fairyDressing",
    ...WORLD_SITES.filter(site => site.dressing.length && site.cutFace?.stations.length).map(site => `site-cut/${site.id}`),
    ...tiles.map(tile => `scatter/${tile}`)].sort();
  return { tiles, keys };
}

export async function runBaker(jobFile: string): Promise<number> {
  try {
    const job = JSON.parse(await readFile(jobFile, "utf8")) as BakerJob;
    // Before any content module: every one of them reads its tables as it loads.
    installCatalog(JSON.parse(await readFile(job.catalogFile, "utf8")) as InstalledCatalog);
    const manifestText = await readFile(join(job.assetsDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestText) as { assets: { id: string; file: string; bytes?: number }[] };
    const byId = new Map(manifest.assets.map(entry => [entry.id, entry]));
    const materialize = assetMaterializer(job, new Map(manifest.assets.map(entry => [entry.file, entry.bytes])));
    const { NodeGeometryAssets } = await import("./nodeGeometryAssets.js");
    // The pack bake opens its own `NodeGeometryAssets` over the directory. Every reader of a GLB goes through `load`, so the file is put in place just before it is read.
    const read = NodeGeometryAssets.prototype.load;
    NodeGeometryAssets.prototype.load = async function (this: typeof NodeGeometryAssets.prototype, id: string) { const entry = byId.get(id); if (entry) await materialize(entry.file); return read.call(this, id); };

    const step = (name: BakeStepName, started: number): void => say({ bake: "step", name, ms: Math.round(performance.now() - started), ok: true });
    const write = async (path: string, bytes: Uint8Array): Promise<void> => {
      const file = join(job.filesDir, ...path.split("/"));
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
    };

    let started = performance.now();
    const [{ bakeServerWorldPack }, { encodeServerWorldPack, loadServerWorldPack }] = await Promise.all([import("./authoredWorld.js"), import("../worldPack.js")]);
    const pack = encodeServerWorldPack(await bakeServerWorldPack(job.seeds, job.revision, job.assetsDir));
    const loaded = loadServerWorldPack(pack);
    if (loaded.revision !== job.revision || job.seeds.some(seed => !loaded.seeds.includes(seed))) throw new Error("The baked pack does not hold what was asked");
    await mkdir(dirname(job.packFile), { recursive: true }); await writeFile(job.packFile, pack);
    step("pack", started);

    started = performance.now();
    const [{ bakeWorldRecords }, { RESOLVED_TABLES }, { BakeGeometryAssets }] = await Promise.all([import("../../world/bake/nodeWorldBake.js"), import("../../content/resolvedCatalog.js"), import("../../world/bake/bakeAssets.js")]);
    // The manifest here is already the host's with this server's models merged over it.
    const assets = await BakeGeometryAssets.open({ manifest: async () => JSON.parse(manifestText), read: async file => new Uint8Array(await readFile(await materialize(file))) });
    const files: string[] = [];
    const baked = await bakeWorldRecords({ tables: RESOLVED_TABLES, codeRevision: job.codeRevision, geometryRevision: job.revision, seed: job.recordsSeed, assets,
      onRecord: async (_key, bytes, entry) => { const path = `generated/world/${entry.file}`; await write(path, bytes); files.push(path); },
      log: message => say({ bake: "log", message }) });
    const expected = await expectedRecords();
    if (JSON.stringify(baked.manifest.tiles) !== JSON.stringify(expected.tiles) || JSON.stringify(Object.keys(baked.manifest.records).sort()) !== JSON.stringify(expected.keys))
      throw new Error("The world records do not cover the whole island");
    if (Object.values(baked.manifest.records).reduce((sum, record) => sum + record.bytes, 0) > 128 * 1024 * 1024) throw new Error("The world records exceed the 128 MiB release budget");
    await write("generated/world/manifest.json", new TextEncoder().encode(`${JSON.stringify(baked.manifest, null, 2)}\n`));
    step("records", started);

    started = performance.now();
    await write("generated/corealm-navmesh.nav", baked.navmesh.nav);
    step("navmesh", started);

    const result: BakerResult = { files: [...files, "generated/world/manifest.json", "generated/corealm-navmesh.nav"], nav: baked.navmesh.release };
    await writeFile(job.resultFile, JSON.stringify(result));
    return 0;
  } catch (error) {
    say({ bake: "error", message: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}

// Run directly (a checkout): `node --import tsx game/src/multiplayer/bake/bakerEntry.ts <job.json>`. Packaged, `runEmbeddedBaker` calls `runBaker`.
if (/bakerEntry\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  // Recast and the GLB reader keep handles open, so the process ends here rather than when they let go.
  void runBaker(process.argv[2] ?? "").then(code => process.exit(code));
}
