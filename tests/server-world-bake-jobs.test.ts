import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import type { InstalledCatalog } from "../game/src/content/catalogInstall.js";
import { createContentAssetStore, type ContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { MAX_GENERATED_ASSET_BYTES } from "../game/src/multiplayer/contentAssetsContract.js";
import { catalogWorldRevision, createWorldBakes, selectWorldPack, type BakerRunner, type WorldBakes } from "../game/src/multiplayer/serverWorldBake.js";
import { encodeServerWorldPack, loadServerWorldPack, readServerWorldPackHeader } from "../game/src/multiplayer/worldPack.js";

const PACK = "game/public/generated/server-world.pack";
const ACTOR = { accountId: null, credential: "test", at: 0 };
let embedded: Uint8Array, codeRevision: string;
const dirs: string[] = [];
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), "world-bake-")); dirs.push(dir); return dir; };
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

beforeAll(async () => {
  embedded = new Uint8Array(await readFile(PACK));
  codeRevision = readServerWorldPackHeader(embedded).revision;
});

/** The repo's catalog with the sea level moved: another geometry. `step` makes each call a different one. */
function terrainEdit(step: number): InstalledCatalog {
  const terrain = structuredClone((RESOLVED_CATALOG.tables as Record<string, unknown>).worldTerrain) as { coast: { seaLevel: number } }[];
  terrain[0]!.coast.seaLevel -= step * 0.25;
  return { ...RESOLVED_CATALOG, revision: `terrain-${step}`, tables: { ...RESOLVED_CATALOG.tables, worldTerrain: terrain } };
}
/** The repo's catalog with a renamed item: the same geometry. */
function nameEdit(): InstalledCatalog {
  const items = structuredClone(RESOLVED_CATALOG.tables.items) as { name: string }[];
  items[0]!.name = "Renamed";
  return { ...RESOLVED_CATALOG, revision: "renamed", tables: { ...RESOLVED_CATALOG.tables, items } };
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function put(file: string, bytes: Uint8Array | string) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); }

/** Stands in for the child process: writes a pack of the job's revision and one record, as the real baker lays them out. */
function fakeBaker(options: { fail?: string; gates?: Map<string, Promise<void>> } = {}): BakerRunner & { calls: string[] } {
  const calls: string[] = [];
  const run: BakerRunner = async (job, _file, step) => {
    calls.push(job.revision);
    await options.gates?.get(job.revision);
    if (options.fail) throw new Error(options.fail);
    await put(job.packFile, encodeServerWorldPack({ ...loadServerWorldPack(embedded), revision: job.revision }));
    step({ name: "pack", ms: 1, ok: true });
    const record = new TextEncoder().encode(`terrain of ${job.revision}`), file = `${sha(record)}.world`;
    await put(join(job.filesDir, "generated/world", file), record);
    await put(join(job.filesDir, "generated/world/manifest.json"), JSON.stringify({ format: "corealm-world", version: 1, revision: job.revision, scope: "game/1337/world",
      tiles: [], records: { "terrain/world": { file, sha256: sha(record), bytes: record.length } } }));
    step({ name: "records", ms: 1, ok: true });
    await put(join(job.filesDir, "generated/corealm-navmesh.nav"), `nav of ${job.revision}`);
    step({ name: "navmesh", ms: 1, ok: true });
    await put(job.resultFile, JSON.stringify({ files: [], nav: { fingerprint: "f".repeat(64), worldSeed: "1337", strategy: "solo", sourceMeshes: 1, sourceTriangles: 2 } }));
  };
  return Object.assign(run, { calls });
}

interface Harness { bakes: WorldBakes; store: ContentAssetStore; dir: string; restarts: (string | null)[]; messages: any[]; logs: Record<string, unknown>[]; setActive(catalog: InstalledCatalog): void }
async function harness(baker: BakerRunner, options: { active?: InstalledCatalog; dir?: string } = {}): Promise<Harness> {
  const dir = options.dir ?? await temp(), logs: Record<string, unknown>[] = [];
  let active = options.active ?? RESOLVED_CATALOG as InstalledCatalog;
  const choice = await selectWorldPack({ dir: join(dir, "world"), embedded, bundled: RESOLVED_CATALOG.tables, active: active.tables, log: event => logs.push(event) });
  const store = createContentAssetStore({ dir: join(dir, "content-assets") });
  const restarts: (string | null)[] = [], messages: any[] = [];
  const bakes = createWorldBakes({ dir: join(dir, "world"), choice, embedded, seeds: [1337], store, active: () => active,
    baseManifest: async () => JSON.stringify({ assets: [] }), assets: { localDir: null, baseUrl: null }, baker,
    restart: async ({ bytes, revision }) => { expect(loadServerWorldPack(bytes).revision).toBe(revision ?? codeRevision); restarts.push(revision); },
    broadcast: async message => { messages.push(message); return 1; }, graceMs: 0, log: event => logs.push(event) });
  return { bakes, store, dir, restarts, messages, logs, setActive: catalog => { active = catalog; } };
}
const generated = async (store: ContentAssetStore) => Object.keys((await store.index()).files).filter(path => path.startsWith("generated/")).sort();

describe("start-time pack selection", () => {
  it("runs the build's own pack while the geometry is the build's, even after a rename", async () => {
    const dir = await temp(), logs: Record<string, unknown>[] = [];
    const choice = await selectWorldPack({ dir, embedded, bundled: RESOLVED_CATALOG.tables, active: nameEdit().tables, log: event => logs.push(event) });
    expect(choice).toMatchObject({ source: "build", revision: null, wanted: null, codeRevision });
    expect(choice.bytes).toBe(embedded);
  });

  it("falls back to the build's pack and says a bake is due when the geometry changed and nothing is baked", async () => {
    const dir = await temp(), logs: Record<string, unknown>[] = [];
    const choice = await selectWorldPack({ dir, embedded, bundled: RESOLVED_CATALOG.tables, active: terrainEdit(1).tables, log: event => logs.push(event) });
    expect(choice).toMatchObject({ source: "fallback", revision: null, wanted: await catalogWorldRevision(codeRevision, terrainEdit(1).tables) });
    expect(logs).toContainEqual(expect.objectContaining({ event: "world.bake_needed" }));
  });

  it("loads the baked pack for the active geometry, and the last good one when the active geometry has none", async () => {
    const first = await harness(fakeBaker(), { active: terrainEdit(1) });
    await first.bakes.start(); await first.bakes.idle();
    const wanted = await catalogWorldRevision(codeRevision, terrainEdit(1).tables);
    expect(first.restarts).toEqual([wanted]);

    const again = await selectWorldPack({ dir: join(first.dir, "world"), embedded, bundled: RESOLVED_CATALOG.tables, active: terrainEdit(1).tables, log: () => {} });
    expect(again).toMatchObject({ source: "baked", revision: wanted, wanted });
    expect(loadServerWorldPack(again.bytes).revision).toBe(wanted);

    const other = await selectWorldPack({ dir: join(first.dir, "world"), embedded, bundled: RESOLVED_CATALOG.tables, active: terrainEdit(2).tables, log: () => {} });
    expect(other).toMatchObject({ source: "fallback", revision: wanted });

    // A damaged pack is never started on: the server starts on the build's own world instead of refusing.
    await writeFile(join(first.dir, "world", `${wanted}.pack`), new Uint8Array(64));
    const damaged = await selectWorldPack({ dir: join(first.dir, "world"), embedded, bundled: RESOLVED_CATALOG.tables, active: terrainEdit(1).tables, log: () => {} });
    expect(damaged).toMatchObject({ source: "fallback", revision: null });
  });
});

describe("world bake jobs", () => {
  it("bakes a geometry publish: queued, baking, ready, files in the store, worlds restarted, clients told", async () => {
    const baker = fakeBaker(), h = await harness(baker);
    await h.bakes.start();
    expect(await h.bakes.activated(nameEdit())).toBeNull();
    h.setActive(terrainEdit(1));
    const queued = await h.bakes.activated(terrainEdit(1));
    const revision = await catalogWorldRevision(codeRevision, terrainEdit(1).tables);
    expect(queued).toMatchObject({ revision, catalogRevision: "terrain-1", status: "queued" });
    await h.bakes.idle();

    const status = h.bakes.status();
    expect(status).toMatchObject({ revision, base: false, source: "baked", canBake: true, navRelease: { fingerprint: "f".repeat(64) } });
    expect(status.history[0]).toMatchObject({ revision, status: "ready", navFingerprint: "f".repeat(64) });
    expect(status.history[0]!.steps!.map(step => step.name)).toEqual(["pack", "records", "navmesh", "publish"]);
    expect(h.restarts).toEqual([revision]);
    expect(h.messages.map(message => message.type)).toEqual(["world-restarting", "content-updated"]);
    expect(h.messages[1]).toEqual({ type: "content-updated", revision: "terrain-1", worldRevision: revision });
    const files = await generated(h.store);
    expect(files).toEqual(status.history[0]!.files);
    expect(files).toContain("generated/world/manifest.json");
    expect(files).toContain("generated/corealm-navmesh.nav");
    expect(JSON.parse((await h.store.read("generated/world/manifest.json"))!.bytes.toString()).revision).toBe(revision);

    // Back to the build's geometry: no bake, the build's pack, and the store serves no generated file to shadow the asset host.
    h.setActive(nameEdit());
    expect(await h.bakes.activated(nameEdit())).toMatchObject({ revision: codeRevision, status: "queued" });
    await h.bakes.idle();
    expect(baker.calls).toEqual([revision]);
    expect(h.restarts).toEqual([revision, null]);
    expect(h.bakes.status()).toMatchObject({ revision: codeRevision, base: true, source: "build", canBake: false });
    expect(await generated(h.store)).toEqual([]);

    // A rollback onto a geometry baked before runs it from disk.
    h.setActive(terrainEdit(1));
    await h.bakes.activated(terrainEdit(1)); await h.bakes.idle();
    expect(baker.calls).toEqual([revision]);
    expect(h.restarts).toEqual([revision, null, revision]);
    expect(await generated(h.store)).toEqual(files);
  });

  it("keeps the running world when a bake fails", async () => {
    const h = await harness(fakeBaker({ fail: "recast ran out of memory" }));
    await h.bakes.start();
    h.setActive(terrainEdit(1));
    await h.bakes.activated(terrainEdit(1)); await h.bakes.idle();
    const status = h.bakes.status();
    expect(status).toMatchObject({ revision: codeRevision, base: true, source: "fallback", wanted: await catalogWorldRevision(codeRevision, terrainEdit(1).tables) });
    expect(status.history[0]).toMatchObject({ status: "failed", error: "recast ran out of memory" });
    expect(h.restarts).toEqual([]);
    expect(await generated(h.store)).toEqual([]);
    expect(h.logs).toContainEqual(expect.objectContaining({ event: "world.bake_failed", message: "recast ran out of memory" }));
  });

  it("supersedes a queued bake with a newer publish and never runs a finished one a newer bake waits behind", async () => {
    let open!: () => void;
    const first = await catalogWorldRevision(codeRevision, terrainEdit(1).tables), third = await catalogWorldRevision(codeRevision, terrainEdit(3).tables);
    const baker = fakeBaker({ gates: new Map([[first, new Promise<void>(settle => { open = settle; })]]) }), h = await harness(baker);
    await h.bakes.start();
    h.setActive(terrainEdit(1)); await h.bakes.activated(terrainEdit(1));
    await expect.poll(() => baker.calls).toEqual([first]);
    // The worlds move on twice while the first bake runs. The second publish only waits, and the third replaces it.
    h.setActive(terrainEdit(2)); await h.bakes.activated(terrainEdit(2));
    h.setActive(terrainEdit(3)); await h.bakes.activated(terrainEdit(3));
    expect(h.bakes.status().queued).toMatchObject({ revision: third, status: "queued" });
    open(); await h.bakes.idle();

    const history = h.bakes.status().history;
    expect(history.map(bake => [bake.catalogRevision, bake.status])).toEqual([["terrain-3", "ready"], ["terrain-1", "superseded"], ["terrain-2", "superseded"]]);
    expect(baker.calls).toEqual([first, third]);
    expect(h.restarts).toEqual([third]);
  });

  it("queues the bake a start fell back from, and a manual bake runs again from scratch", async () => {
    const baker = fakeBaker(), h = await harness(baker, { active: terrainEdit(1) });
    await h.bakes.start(); await h.bakes.idle();
    const revision = await catalogWorldRevision(codeRevision, terrainEdit(1).tables);
    expect(h.bakes.status()).toMatchObject({ revision, source: "baked" });
    expect(await h.bakes.bakeNow()).toMatchObject({ revision, status: "queued" });
    await h.bakes.idle();
    expect(baker.calls).toEqual([revision, revision]);
    // Already running it: nothing restarts.
    expect(h.restarts).toEqual([revision]);
    expect(h.bakes.status().history.map(bake => bake.status)).toEqual(["ready", "ready"]);

    h.setActive(nameEdit());
    await expect(h.bakes.bakeNow()).rejects.toThrow("nothing to bake");
  });
});

describe("the file store's generated world files", () => {
  it("takes a world record up to 32 MiB and an authored file only up to 16", async () => {
    const store = createContentAssetStore({ dir: await temp() });
    const big = new Uint8Array(20 * 1024 * 1024).fill(7);
    await store.putBytes({ [`generated/world/${"a".repeat(64)}.world`]: big }, ACTOR);
    expect((await store.index()).files[`generated/world/${"a".repeat(64)}.world`]).toMatchObject({ bytes: big.length });
    await expect(store.putBytes({ "assets/models/big.glb": big }, ACTOR)).rejects.toMatchObject({ status: 413 });
    await expect(store.put({ "assets/models/big.glb": Buffer.from(big).toString("base64") }, ACTOR)).rejects.toMatchObject({ status: 413 });
    await expect(store.putBytes({ "generated/corealm-navmesh.nav": new Uint8Array(MAX_GENERATED_ASSET_BYTES + 1) }, ACTOR)).rejects.toMatchObject({ status: 413 });
    await expect(store.putBytes({ "generated/other.bin": big }, ACTOR)).rejects.toMatchObject({ status: 400, code: "invalid_path" });
  });
});

describe("the baker's asset fetch", () => {
  it("brings the texture files a GLB names beside itself", async () => {
    const { externalFiles } = await import("../game/src/multiplayer/bake/bakerEntry.js");
    const json = new TextEncoder().encode(JSON.stringify({ images: [{ uri: "../../textures/imported/abc%20d.png" }, { uri: "data:image/png;base64,AAAA" }, { bufferView: 0 }], buffers: [{ byteLength: 4 }] }).padEnd(84, " "));
    const glb = new Uint8Array(20 + json.length), view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.length, true);
    view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); glb.set(json, 20);
    expect(externalFiles("models/farm/crate.glb", glb)).toEqual(["textures/imported/abc d.png"]);
    expect(externalFiles("textures/imported/abc.png", glb)).toEqual([]);
  });
});
