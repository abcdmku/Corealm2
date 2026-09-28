import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SessionError, WorldDescriptor } from "../contracts.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import { geometryContentHash } from "../world/geometryContent.js";
import { worldGeometryRevision, type ServerWorldBake } from "../world/serverWorldContract.js";
import type { WorldDataManifest } from "../world/worldDataFormat.js";
import type { AdminActor, AuditWrite } from "./adminStorage.js";
import type { ContentAssetStore } from "./contentAssets.js";
import { CONTENT_MANIFEST_OVERLAY, MAX_GENERATED_ASSET_BYTES } from "./contentAssetsContract.js";
import type { HeadlessWorldPorts } from "./headlessWorld.js";
import type { WorldBuild } from "./threads/worldThread.js";

/**
 * A live server's own world geometry (`world/serverWorldContract.ts`).
 *
 * The build ships one baked world. When a publish changes what shapes it (terrain, regions,
 * placements, habitats, resource models, creature bodies: `world/geometryContent.ts`), the server
 * bakes that geometry itself, in a child process, and moves its worlds onto the result:
 *
 *   queued -> baking -> ready       the worlds run it, clients reload onto it
 *                    -> failed      the worlds keep what they ran
 *   queued -> superseded            a newer publish came first
 *
 * One bake at a time. A newer publish replaces a queued one; a bake already running finishes, and
 * its result is kept on disk but not run when a newer one waits. The child (`bake/bakerEntry.ts`)
 * loads three, gltf-transform and recast, which is why it is a process of its own: this module and
 * everything the server imports stay free of them (`tests/server-import-graph.test.ts`).
 *
 * Everything lives in `<data>/world/`:
 *
 *   <revision>.pack          the server world pack of that geometry
 *   <revision>/files/...     its client files under their store paths (`generated/world/*.world`,
 *                            `generated/world/manifest.json`, `generated/corealm-navmesh.nav`)
 *   <revision>/bake.json     the finished bake record; present only once the files are whole
 *   current.json             the baked revision the worlds last ran, `{ revision: null }` for the build's
 *   history.json             finished bakes, newest first
 *   jobs/<revision>/         one bake's inputs and scratch space, removed when it ends
 *   asset-cache/             GLBs fetched from the asset host, kept across bakes
 *
 * The file store serves the running revision's client files and nothing else under `generated/`,
 * because a path in the store wins over the asset host: a stale world manifest there would shadow
 * the build's own.
 */

/** The build's own world. Its revision is the build's `generationRevision`, which is what descriptors mean by an absent `worldRevision`. */
export type WorldSource = "build" | "baked" | "fallback";

export interface WorldPackChoice {
  bytes: Uint8Array;
  /** The geometry revision the worlds run, or null for the build's own world. */
  revision: string | null;
  /** The geometry revision the active catalog asks for, or null when that is the build's own world. */
  wanted: string | null;
  /** `fallback`: the wanted pack is not baked yet, so this is the last good one (or the build's) and a bake is due. */
  source: WorldSource;
  /** The build's `generationRevision`, read from the embedded pack. */
  codeRevision: string;
  /** `worldGeometryRevision` of the build's own content. A catalog with this revision runs the embedded pack. */
  buildRevision: string;
}

type Tables = Readonly<Record<string, unknown>>;
const worldPack = () => import("./worldPack.js");
const packFile = (dir: string, revision: string) => join(dir, `${revision}.pack`);
const archiveDir = (dir: string, revision: string) => join(dir, revision);
const REVISION = /^[a-f0-9]{64}$/;

/** The geometry revision a catalog asks for, under the build whose embedded pack names `codeRevision`. */
export async function catalogWorldRevision(codeRevision: string, tables: Tables): Promise<string> {
  return worldGeometryRevision(codeRevision, await geometryContentHash(tables));
}

/** A baked revision whose pack loads and whose client files are whole. Null otherwise. */
async function bakedPack(dir: string, revision: string): Promise<Uint8Array | null> {
  try {
    await stat(join(archiveDir(dir, revision), "bake.json"));
    const bytes = new Uint8Array(await readFile(packFile(dir, revision)));
    const { loadServerWorldPack } = await worldPack();
    if (loadServerWorldPack(bytes).revision !== revision) return null;
    return bytes;
  } catch { return null; }
}

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`);
  await rename(temporary, file);
}

/**
 * What the worlds start on. Never refuses: the build's own pack when the active catalog's geometry is
 * the build's; else the pack baked for it; else the last one the worlds ran, or the build's, with a
 * log line saying a bake is due (the manager queues it once the server is up).
 */
export async function selectWorldPack(options: { dir: string; embedded: Uint8Array; bundled: Tables; active: Tables; log(event: Record<string, unknown>): void }): Promise<WorldPackChoice> {
  const { readServerWorldPackHeader } = await worldPack();
  const codeRevision = readServerWorldPackHeader(options.embedded).revision;
  const [buildRevision, activeRevision] = await Promise.all([catalogWorldRevision(codeRevision, options.bundled), catalogWorldRevision(codeRevision, options.active)]);
  const base = { codeRevision, buildRevision };
  if (activeRevision === buildRevision) {
    options.log({ event: "world.pack", source: "build", revision: codeRevision });
    return { ...base, bytes: options.embedded, revision: null, wanted: null, source: "build" };
  }
  const baked = await bakedPack(options.dir, activeRevision);
  if (baked) {
    options.log({ event: "world.pack", source: "baked", revision: activeRevision });
    return { ...base, bytes: baked, revision: activeRevision, wanted: activeRevision, source: "baked" };
  }
  const last = (await readJson<{ revision: string | null }>(join(options.dir, "current.json")))?.revision ?? null;
  const lastBytes = last && REVISION.test(last) ? await bakedPack(options.dir, last) : null;
  options.log({ event: "world.bake_needed", level: "warn", wanted: activeRevision, running: lastBytes ? last : codeRevision,
    message: `The active content changes the world's geometry and no world is baked for it yet. The worlds start on ${lastBytes ? "the last baked world" : "the build's own world"} and a bake is queued.` });
  return { ...base, bytes: lastBytes ?? options.embedded, revision: lastBytes ? last : null, wanted: activeRevision, source: "fallback" };
}

// ------------------------------------------------------------------ baker

/** Everything one bake needs, written to `jobs/<revision>/job.json` for the child. Paths are absolute. */
export interface BakerJob {
  revision: string; codeRevision: string; catalogRevision: string;
  /** Seeds the pack holds: every world's. */
  seeds: number[];
  /** The seed the client records are baked for: the first world's. */
  recordsSeed: number;
  /** The server catalog (`InstalledCatalog` JSON) the child installs before anything else. */
  catalogFile: string;
  /** `manifest.json` (the host's merged with this server's model overlay) and, once fetched, the GLBs the bake reads. */
  assetsDir: string;
  /** Models this server added, under their manifest `file` paths. Win over every other source. */
  overlayDir: string;
  /** GLBs fetched from the asset host, kept across bakes. */
  cacheDir: string;
  /** A checkout's `game/public/assets`, read before the asset host. */
  localAssetsDir: string | null;
  /** The asset host, `assets/<file>` under it. */
  assetBaseUrl: string | null;
  /** Where the child writes the pack. */
  packFile: string;
  /** Where the child writes the client files, under their store paths. */
  filesDir: string;
  /** Where the child writes `BakerResult`. */
  resultFile: string;
}
export type BakeStepName = NonNullable<ServerWorldBake["steps"]>[number]["name"];
export interface BakeStep { name: BakeStepName; ms?: number; ok?: boolean }
/** The navmesh identity a client checks `generated/corealm-navmesh.nav` against. */
export interface NavRelease { fingerprint: string; worldSeed: string; strategy: "solo" | "tiled"; sourceMeshes: number; sourceTriangles: number }
export interface BakerResult { files: string[]; nav: NavRelease }
/** Runs one bake to completion or throws. `step` reports each finished step as it lands. */
export type BakerRunner = (job: BakerJob, jobFile: string, step: (step: BakeStep) => void) => Promise<void>;

/** The single executable runs the baker as itself with this flag: the root entry hands it to `runEmbeddedBaker`. */
export const WORLD_BAKER_FLAG = "--world-baker";
/** The baker bundle's SEA asset key (`tools/build-server-exe.ts`). */
export const WORLD_BAKER_ASSET = "world-baker.cjs";
/** The baker entry in a checkout, relative to the repository root. */
export const WORLD_BAKER_ENTRY = "game/src/multiplayer/bake/bakerEntry.ts";
const BAKE_TIMEOUT_MS = 45 * 60_000;

/**
 * The real baker: a child process. From a checkout it is `node --import tsx bakerEntry.ts <job>`;
 * packaged, it is this executable again with `--world-baker <job>`, which compiles the embedded
 * baker bundle. Lines on its stdout that parse as `{ bake: "step", ... }` are progress; any other
 * output goes to the log. A non-zero exit fails the bake with the child's last error.
 */
export function bakerProcess(options: { sea: boolean; root?: string; log?(event: Record<string, unknown>): void }): BakerRunner {
  return (job, jobFile, step) => new Promise<void>((settle, refuse) => {
    const root = options.root ?? process.cwd();
    const args = options.sea ? [WORLD_BAKER_FLAG, jobFile] : ["--import", "tsx", resolve(root, WORLD_BAKER_ENTRY), jobFile];
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let error: string | null = null, tail = "", buffered = "";
    const timer = setTimeout(() => { error = `The bake took longer than ${BAKE_TIMEOUT_MS / 60_000} minutes and was stopped`; child.kill(); }, BAKE_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      buffered += chunk;
      for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
        const line = buffered.slice(0, at).trim(); buffered = buffered.slice(at + 1);
        if (!line) continue;
        let event: Record<string, unknown> | null = null;
        try { event = JSON.parse(line) as Record<string, unknown>; } catch { /* plain output */ }
        if (event?.bake === "step") step({ name: event.name as BakeStepName, ms: Number(event.ms), ok: event.ok !== false });
        else if (event?.bake === "error") error = String(event.message);
        else options.log?.({ event: "world.baker", revision: job.revision, message: line.slice(0, 500) });
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { tail = (tail + chunk).slice(-4000); });
    child.on("error", failure => { clearTimeout(timer); refuse(failure); });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code === 0 && error === null) settle();
      else refuse(new Error(error ?? `The baker exited with ${code}: ${tail.trim().split("\n").slice(-5).join(" | ") || "no output"}`));
    });
  });
}

/**
 * The packaged server's baker: compiles the embedded baker bundle and runs one job. The root entry
 * calls it when started with `WORLD_BAKER_FLAG`, before anything else. The bundle is only data to
 * the server, so its three and recast never enter the server's own module graph.
 */
export async function runEmbeddedBaker(jobFile: string): Promise<number> {
  const [{ getAsset }, { compileFunction }, { createRequire }] = await Promise.all([import("node:sea"), import("node:vm"), import("node:module")]);
  const source = getAsset(WORLD_BAKER_ASSET, "utf8");
  const run = compileFunction(source, ["require", "module", "exports", "__filename", "__dirname"], { filename: WORLD_BAKER_ASSET });
  const module = { exports: {} as { runBaker?(file: string): Promise<number> } };
  run(createRequire(process.execPath), module, module.exports, process.execPath, dirname(process.execPath));
  if (typeof module.exports.runBaker !== "function") throw new Error(`${WORLD_BAKER_ASSET} exports no runBaker`);
  return module.exports.runBaker(jobFile);
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Reads every client file of a finished bake, checking each against the manifest and the caps. Throws with what is wrong. */
async function readBakedFiles(filesDir: string, revision: string): Promise<Record<string, Uint8Array>> {
  const read = async (path: string): Promise<Uint8Array> => {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(join(filesDir, ...path.split("/")))); }
    catch { throw new Error(`The bake wrote no ${path}`); }
    if (!bytes.length) throw new Error(`${path} is empty`);
    if (bytes.length > MAX_GENERATED_ASSET_BYTES) throw new Error(`${path} is ${bytes.length} bytes, over the file store's ${MAX_GENERATED_ASSET_BYTES / 1_048_576} MiB cap`);
    return bytes;
  };
  const files: Record<string, Uint8Array> = {};
  const manifestBytes = files["generated/world/manifest.json"] = await read("generated/world/manifest.json");
  let manifest: WorldDataManifest;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as WorldDataManifest; } catch { throw new Error("generated/world/manifest.json is not JSON"); }
  if (manifest.format !== "corealm-world" || manifest.version !== 1) throw new Error("generated/world/manifest.json is not a world manifest");
  if (manifest.revision !== revision) throw new Error(`The world manifest names revision ${manifest.revision}, not ${revision}`);
  for (const [key, record] of Object.entries(manifest.records ?? {})) {
    if (!/^[a-f0-9]{64}\.world$/.test(record.file)) throw new Error(`Record ${key} has an invalid file name`);
    const path = `generated/world/${record.file}`, bytes = files[path] ??= await read(path);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Record ${key} (${record.file}) does not match the manifest`);
  }
  files["generated/corealm-navmesh.nav"] = await read("generated/corealm-navmesh.nav");
  return files;
}

// ------------------------------------------------------------------ bakes

export interface WorldStatusBody {
  /** The geometry revision every world runs now: the build's `generationRevision` for the build's own world. */
  revision: string;
  /** The worlds run the build's own world. */
  base: boolean;
  source: WorldSource;
  codeRevision: string;
  /** What the active catalog asks for, when that is not what runs. */
  wanted?: string;
  active?: ServerWorldBake;
  queued?: ServerWorldBake;
  /** Finished bakes, newest first. */
  history: ServerWorldBake[];
  /** `POST /admin/world` would bake: the active catalog's geometry is not the build's own. */
  canBake: boolean;
  navRelease?: NavRelease;
}

export interface WorldBakesOptions {
  /** `<data>/world`. */
  dir: string;
  /** What the worlds started on (`selectWorldPack`). */
  choice: WorldPackChoice;
  /** The build's own pack. */
  embedded: Uint8Array;
  /** The seed of every world this server runs, first world first. */
  seeds: readonly number[];
  store: Pick<ContentAssetStore, "index" | "putBytes" | "remove" | "read">;
  /** The catalog the worlds run now, for a manual bake. */
  active(): InstalledCatalog;
  /** The host manifest (`assets/manifest.json`) as text: the one this server ships, or the asset host's. */
  baseManifest(): Promise<string>;
  /** Where GLBs come from: a checkout's `game/public/assets`, then the asset host. */
  assets: { localDir: string | null; baseUrl: string | null };
  /** The child process. Tests hand in a fake. */
  baker: BakerRunner;
  /** Run every world on this pack. `revision` null is the build's own world. `serverWorldRestart` builds one from the reference server. */
  restart(next: { bytes: Uint8Array; revision: string | null; notice: string }): Promise<void>;
  broadcast(message: unknown): Promise<number>;
  audit?(by: AdminActor, entry: AuditWrite): Promise<void>;
  /** How long players are warned before their world restarts. Default 5 s. */
  graceMs?: number;
  /** Baked revisions kept on disk besides the running one. Default 2. */
  keep?: number;
  now?(): number;
  log(event: Record<string, unknown>): void;
}

interface Job { record: ServerWorldBake; target: string | null; force: boolean }
const HISTORY_LIMIT = 20;
const BAKE_ACTOR: AdminActor = { accountId: null, credential: "world-bake", at: 0 };

export type WorldBakes = ReturnType<typeof createWorldBakes>;

export function createWorldBakes(options: WorldBakesOptions) {
  const { dir, choice, log } = options, now = options.now ?? Date.now, graceMs = options.graceMs ?? 5000;
  const iso = () => new Date(now()).toISOString();
  /** The geometry the worlds run; null is the build's own. */
  let running: string | null = choice.revision;
  let wanted: string | null = choice.wanted;
  let active: Job | null = null, queued: Job | null = null;
  let history: ServerWorldBake[] = [];
  let navRelease: NavRelease | undefined;
  let drained: Promise<void> = Promise.resolve();
  const loaded = readJson<ServerWorldBake[]>(join(dir, "history.json")).then(found => { history = Array.isArray(found) ? found.slice(0, HISTORY_LIMIT) : []; });
  const shown = (revision: string | null): string => revision ?? choice.codeRevision;
  const actor = (): AdminActor => ({ ...BAKE_ACTOR, at: now() });

  async function finish(job: Job): Promise<void> {
    job.record.finishedAt = iso();
    history = [structuredClone(job.record), ...history].slice(0, HISTORY_LIMIT);
    await writeJson(join(dir, "history.json"), history).catch(error => log({ event: "world.history_write_failed", level: "error", message: String(error) }));
  }
  const cached = async (revision: string): Promise<boolean> => (await bakedPack(dir, revision)) !== null;

  /** The store's `generated/` files become exactly `revision`'s: none for the build's own world. */
  async function syncStore(revision: string | null): Promise<void> {
    const files = revision ? await readBakedFiles(join(archiveDir(dir, revision), "files"), revision) : {};
    const index = await options.store.index();
    const differs = Object.entries(files).some(([path, bytes]) => index.files[path]?.sha256 !== sha256(bytes));
    if (differs) {
      // In slices, so a whole world is never held twice over in one write.
      let batch: Record<string, Uint8Array> = {}, size = 0;
      for (const [path, bytes] of Object.entries(files)) {
        if (index.files[path]?.sha256 === sha256(bytes)) continue;
        batch[path] = bytes; size += bytes.length;
        if (size > 48 * 1_048_576) { await options.store.putBytes(batch, actor()); batch = {}; size = 0; }
      }
      if (Object.keys(batch).length) await options.store.putBytes(batch, actor());
    }
    const stale = Object.keys((await options.store.index()).files).filter(path => path.startsWith("generated/") && !(path in files));
    for (let at = 0; at < stale.length; at += 1000) await options.store.remove(stale.slice(at, at + 1000), actor());
  }

  /** Move every world onto `target`, which is baked (or null, the build's own). Nothing happens when it already runs. */
  async function activate(job: Job): Promise<void> {
    const { target } = job;
    if (target === running) return;
    const bytes = target ? await bakedPack(dir, target) : options.embedded;
    if (!bytes) throw new Error(`The world baked for ${target} is missing or damaged`);
    const notice = "The world is restarting on its new terrain. Join again in a moment.";
    await options.broadcast({ type: "world-restarting", worldRevision: shown(target), inMs: graceMs, message: notice });
    if (graceMs > 0) await new Promise(settle => setTimeout(settle, graceMs));
    await syncStore(target);
    await options.restart({ bytes, revision: target, notice });
    running = target;
    await writeJson(join(dir, "current.json"), { revision: target });
    navRelease = target ? (await readJson<{ nav?: NavRelease }>(join(archiveDir(dir, target), "bake.json")))?.nav : undefined;
    // Anyone who joined the restarted world already has its revision in `joined`. This reaches them too.
    const notified = await options.broadcast({ type: "content-updated", revision: job.record.catalogRevision, worldRevision: shown(target) });
    log({ event: "world.restarted", revision: shown(target), base: target === null, catalogRevision: job.record.catalogRevision, notified });
    await prune();
  }

  /** Keeps the running revision and the newest few others. */
  async function prune(): Promise<void> {
    const keep = new Set([running, ...history.filter(bake => bake.status === "ready").map(bake => bake.revision)].filter(Boolean).slice(0, 1 + (options.keep ?? 2)));
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const revision = name.replace(/\.pack$/, "");
      if (!REVISION.test(revision) || keep.has(revision) || revision === active?.target || revision === queued?.target) continue;
      await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async function bake(job: Job): Promise<void> {
    const revision = job.target!, jobDir = join(dir, "jobs", revision);
    const partialPack = `${packFile(dir, revision)}.partial`, partialDir = `${archiveDir(dir, revision)}.partial`;
    await rm(jobDir, { recursive: true, force: true }); await rm(partialDir, { recursive: true, force: true });
    await mkdir(join(jobDir, "assets"), { recursive: true });
    try {
      // The catalog the worlds run now. A later publish that kept this geometry is as good a source; one that moved it queued its own bake.
      const catalog = options.active();
      if (await catalogWorldRevision(choice.codeRevision, catalog.tables) !== revision) throw new Superseded(catalog.revision);
      await writeFile(join(jobDir, "catalog.json"), JSON.stringify(catalog));
      // The host's manifest with this server's models over it, by id, as a client and the server see it.
      const manifest = JSON.parse(await options.baseManifest()) as { assets: { id: string; file: string }[] };
      const overlayFile = await options.store.read(CONTENT_MANIFEST_OVERLAY);
      const overlay = overlayFile ? (JSON.parse(overlayFile.bytes.toString("utf8")) as { assets?: { id: string; file: string }[] }).assets ?? [] : [];
      const ids = new Set(overlay.map(entry => entry.id));
      await writeFile(join(jobDir, "assets", "manifest.json"), JSON.stringify({ ...manifest, assets: [...manifest.assets.filter(entry => !ids.has(entry.id)), ...overlay] }));
      for (const entry of overlay) {
        const file = await options.store.read(`assets/${entry.file}`);
        if (!file) continue;
        const target = join(jobDir, "overlay", ...entry.file.split("/"));
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, file.bytes);
      }
      const spec: BakerJob = {
        revision, codeRevision: choice.codeRevision, catalogRevision: catalog.revision,
        seeds: [...new Set(options.seeds)], recordsSeed: options.seeds[0] ?? 1337,
        catalogFile: join(jobDir, "catalog.json"), assetsDir: join(jobDir, "assets"), overlayDir: join(jobDir, "overlay"),
        cacheDir: join(dir, "asset-cache"), localAssetsDir: options.assets.localDir, assetBaseUrl: options.assets.baseUrl,
        packFile: partialPack, filesDir: join(partialDir, "files"), resultFile: join(jobDir, "result.json"),
      };
      const jobFile = join(jobDir, "job.json");
      await writeFile(jobFile, JSON.stringify(spec, null, 1));
      job.record.steps = [];
      await options.baker(spec, jobFile, step => { job.record.steps!.push(step); log({ event: "world.bake_step", revision, ...step }); });
      // The child checked its own output against the release gates. These are the checks this process can make without three: the pack loads, the files match their manifest.
      const result = await readJson<BakerResult>(spec.resultFile);
      if (!result?.nav?.fingerprint) throw new Error("The baker wrote no result");
      const packBytes = new Uint8Array(await readFile(partialPack).catch(() => { throw new Error("The baker wrote no pack"); }));
      const { loadServerWorldPack } = await worldPack();
      const pack = loadServerWorldPack(packBytes);
      if (pack.revision !== revision) throw new Error(`The pack names revision ${pack.revision}, not ${revision}`);
      const missing = spec.seeds.filter(seed => !pack.seeds.includes(seed));
      if (missing.length) throw new Error(`The pack holds no world for seed ${missing.join(", ")}`);
      const files = await readBakedFiles(spec.filesDir, revision);
      job.record.files = Object.keys(files).sort();
      job.record.navFingerprint = result.nav.fingerprint;
      await rm(archiveDir(dir, revision), { recursive: true, force: true });
      await rename(partialDir, archiveDir(dir, revision));
      await rename(partialPack, packFile(dir, revision));
      // Written last: a revision without it is not baked (`bakedPack`).
      await writeJson(join(archiveDir(dir, revision), "bake.json"), { ...job.record, status: "ready", nav: result.nav });
    } finally {
      await rm(jobDir, { recursive: true, force: true }).catch(() => {});
      await rm(partialDir, { recursive: true, force: true }).catch(() => {});
      await rm(partialPack, { force: true }).catch(() => {});
    }
  }

  async function run(job: Job): Promise<void> {
    active = job;
    job.record.status = "baking"; job.record.startedAt = iso();
    log({ event: "world.bake_started", revision: job.record.revision, catalogRevision: job.record.catalogRevision });
    try {
      if (job.target !== null && (job.force || !await cached(job.target))) await bake(job);
      if (queued) {
        // A newer publish is waiting: its world is the one to run. This one stays on disk.
        job.record.status = "superseded";
        log({ event: "world.bake_superseded", revision: job.record.revision, by: queued.record.revision });
        return;
      }
      const started = performance.now();
      await activate(job);
      (job.record.steps ??= []).push({ name: "publish", ms: Math.round(performance.now() - started), ok: true });
      job.record.status = "ready";
      log({ event: "world.bake_ready", revision: job.record.revision, files: job.record.files?.length ?? 0 });
    } catch (error) {
      if (error instanceof Superseded) {
        job.record.status = "superseded";
        log({ event: "world.bake_superseded", revision: job.record.revision, catalogRevision: error.catalogRevision });
        return;
      }
      job.record.status = "failed";
      job.record.error = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      log({ event: "world.bake_failed", level: "error", revision: job.record.revision, message: job.record.error, running: shown(running) });
    } finally {
      await finish(job);
      active = null;
    }
  }

  function kick(): void {
    drained = drained.then(async () => {
      await loaded;
      while (queued && !active) { const next = queued; queued = null; await run(next); }
    });
  }

  /** Queue the world `catalog` asks for. Null when that is what runs and nothing is pending. */
  async function request(catalog: Pick<InstalledCatalog, "revision" | "tables">, force = false): Promise<ServerWorldBake | null> {
    const revision = await catalogWorldRevision(choice.codeRevision, catalog.tables);
    const target = revision === choice.buildRevision ? null : revision;
    wanted = target;
    const pending = queued ?? active;
    if (!force && pending && pending.target === target && pending.record.catalogRevision === catalog.revision) return structuredClone(pending.record);
    if (!force && !pending && target === running) return null;
    if (queued) { queued.record.status = "superseded"; void finish(queued); log({ event: "world.bake_superseded", revision: queued.record.revision, by: shown(target) }); }
    queued = { target, force, record: { revision: shown(target), catalogRevision: catalog.revision, status: "queued", queuedAt: iso() } };
    log({ event: "world.bake_queued", revision: shown(target), catalogRevision: catalog.revision, force });
    const record = structuredClone(queued.record);
    kick();
    return record;
  }

  return {
    /** The publish hook (`PublishPorts.activated`). */
    activated: (catalog: InstalledCatalog) => request(catalog),
    /** `POST /admin/world`: bake the active catalog's world again, even if it is on disk. */
    async bakeNow(): Promise<ServerWorldBake> {
      const catalog = options.active();
      const revision = await catalogWorldRevision(choice.codeRevision, catalog.tables);
      if (revision === choice.buildRevision) throw new WorldBakeRefused("The active content's geometry is the build's own, so there is nothing to bake.");
      return (await request(catalog, true))!;
    },
    status(): WorldStatusBody {
      return { revision: shown(running), base: running === null, source: running === wanted ? (running === null ? "build" : "baked") : "fallback",
        codeRevision: choice.codeRevision, ...(wanted !== running ? { wanted: shown(wanted) } : {}),
        ...(active ? { active: structuredClone(active.record) } : {}), ...(queued ? { queued: structuredClone(queued.record) } : {}),
        history: structuredClone(history), canBake: wanted !== null, ...(navRelease ? { navRelease } : {}) };
    },
    /**
     * Once the worlds are up: bring the file store in line with what they run, and queue the bake the
     * start fell back from.
     */
    async start(): Promise<void> {
      await loaded;
      navRelease = running ? (await readJson<{ nav?: NavRelease }>(join(archiveDir(dir, running), "bake.json")))?.nav : undefined;
      await syncStore(running).catch(error => log({ event: "world.store_sync_failed", level: "error", message: error instanceof Error ? error.message : String(error) }));
      if (choice.source === "fallback") await request(options.active());
    },
    /** Settles once nothing is queued or baking. For tests and shutdown. */
    async idle(): Promise<void> { for (let seen: Promise<void> | null = null; seen !== drained;) { seen = drained; await drained; } },
  };
}

/** The worlds moved to other geometry before this bake read its catalog. The bake that geometry queued is the one to run. */
class Superseded extends Error {
  constructor(readonly catalogRevision: string) { super(`The worlds moved to catalog ${catalogRevision}`); }
}

export class WorldBakeRefused extends Error {
  constructor(message: string) { super(message); this.name = "WorldBakeRefused"; }
}

/** What `restartWorlds` of the reference server needs to run every world on a pack: a local build, and shared bytes for world threads. */
interface WorldRestartHost {
  restartWorlds(next: { build(world: WorldDescriptor): Promise<HeadlessWorldPorts>; thread: WorldBuild; worldRevision: string | null; notice: SessionError }): Promise<void>;
}
/** `WorldBakesOptions.restart` for a reference server: every world is built from `bytes`, and world threads read them from one block of shared memory. */
export function serverWorldRestart(server: () => WorldRestartHost): WorldBakesOptions["restart"] {
  return async ({ bytes, revision, notice }) => {
    const { createPackedWorld, loadServerWorldPack } = await worldPack();
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.byteLength)); shared.set(bytes);
    const pack = loadServerWorldPack(shared);
    await server().restartWorlds({ build: world => createPackedWorld(pack, world.seed), thread: { kind: "pack", bytes: shared }, worldRevision: revision,
      notice: { code: "UNAVAILABLE", message: notice } });
  };
}
