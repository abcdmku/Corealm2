import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { createWorldRoute } from "../game/src/multiplayer/adminWorld.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createContentAssetStore, type ContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { catalogWorldRevision, createWorldBakes, selectWorldPack, type BakerRunner, type WorldBakes } from "../game/src/multiplayer/serverWorldBake.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { encodeServerWorldPack, loadServerWorldPack, readServerWorldPackHeader } from "../game/src/multiplayer/worldPack.js";
import { readContentSources } from "../tools/content/compile.js";
import { repoRoot } from "../tools/lib/paths.js";
import placementWorld from "./fixtures/placementWorld.js";

/**
 * The server as `tools/multiplayer-server.ts` wires it: a publish that moves geometry queues a bake,
 * `/admin/world` reports and re-runs it, and the worlds come back on the new revision. The child
 * process is a stand-in that lays out its files as the real baker does.
 */
const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function put(file: string, bytes: Uint8Array | string) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); }

describe("world bakes on a running server", () => {
  let server: Awaited<ReturnType<typeof startReferenceServer>>, storage: SqliteWorldStorage, store: ContentAssetStore, bakes: WorldBakes;
  let file: string, dir: string, session: string, embedded: Uint8Array;
  const baked: string[] = [];
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  };
  async function publish(change: (draft: Record<string, any>) => void) {
    const active = (await call("/admin/content/sources", { token: session })).body as { revision: string; revisions: Record<string, string>; sources: Record<string, any> };
    const draft = structuredClone(active.sources);
    change(draft);
    const collections = Object.fromEntries(Object.keys(draft).filter(name => JSON.stringify(draft[name]) !== JSON.stringify(active.sources[name]))
      .map(name => [name, { revision: active.revisions[name]!, value: draft[name] }]));
    return call("/admin/content/publish", { method: "POST", token: session, body: { base: active.revision, collections } });
  }
  const baker: BakerRunner = async (job, _file, step) => {
    baked.push(job.revision);
    await put(job.packFile, encodeServerWorldPack({ ...loadServerWorldPack(embedded), revision: job.revision }));
    step({ name: "pack", ms: 1, ok: true });
    const record = new TextEncoder().encode(`terrain of ${job.revision}`), name = `${sha(record)}.world`;
    await put(join(job.filesDir, "generated/world", name), record);
    await put(join(job.filesDir, "generated/world/manifest.json"), JSON.stringify({ format: "corealm-world", version: 1, revision: job.revision, scope: "game/1337/world",
      tiles: [], records: { "terrain/world": { file: name, sha256: sha(record), bytes: record.length } } }));
    await put(join(job.filesDir, "generated/corealm-navmesh.nav"), "nav");
    step({ name: "records", ms: 1, ok: true }); step({ name: "navmesh", ms: 1, ok: true });
    await put(job.resultFile, JSON.stringify({ files: [], nav: { fingerprint: "f".repeat(64), worldSeed: "1337", strategy: "solo", sourceMeshes: 1, sourceTriangles: 2 } }));
  };

  beforeAll(async () => {
    embedded = new Uint8Array(await readFile("game/public/generated/server-world.pack"));
    file = join(tmpdir(), `corealm-bake-${randomUUID()}.sqlite`);
    dir = await mkdtemp(join(tmpdir(), "corealm-bake-"));
    const created = createSigningKey();
    const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
    storage = new SqliteWorldStorage(file, { log: () => {} });
    await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: Object.fromEntries(await readContentSources()) }, () => {});
    store = createContentAssetStore({ dir: join(dir, "content-assets"), audit: (by, entry) => storage.admin.record(by, entry) });
    const choice = await selectWorldPack({ dir: join(dir, "world"), embedded, bundled: RESOLVED_CATALOG.tables, active: RESOLVED_CATALOG.tables, log: () => {} });
    bakes = createWorldBakes({ dir: join(dir, "world"), choice, embedded, seeds: [1337], store, active: () => RESOLVED_CATALOG,
      baseManifest: () => readFile("game/public/assets/manifest.json", "utf8"), assets: { localDir: null, baseUrl: null }, baker,
      // The fixture world stands in for a world built from the pack: this test is about the job, not the terrain.
      restart: ({ revision, notice }) => server.restartWorlds({ build: placementWorld, thread: { kind: "lab" }, worldRevision: revision, notice: { code: "UNAVAILABLE", message: notice } }),
      broadcast: message => server.broadcast(message), graceMs: 0, log: () => {} });
    server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
      ownerAccount: OWNER, log: () => {}, contentAssets: store, worldActivated: bakes.activated,
      adminRoutes: [store.route, createWorldRoute({ bakes, audit: (by, entry) => storage.admin.record(by, entry) })],
      assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
      authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
    await bakes.start();
    const joinToken = signJoinToken(created.signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
    session = (await call("/admin/session", { method: "POST", body: { token: joinToken } })).body.session;
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("bakes a geometry publish, reports it at /admin/world and moves the worlds onto it", async () => {
    const codeRevision = readServerWorldPackHeader(embedded).revision;
    const reader = (await call("/admin/tokens", { method: "POST", token: session, body: { label: "reader", scopes: ["content:read"] } })).body.token as string;
    const publisher = (await call("/admin/tokens", { method: "POST", token: session, body: { label: "publisher", scopes: ["content:publish"] } })).body.token as string;
    expect(await call("/admin/world", { token: reader })).toMatchObject({ status: 200, body: { revision: codeRevision, base: true, source: "build", canBake: false, history: [] } });
    expect(await call("/admin/world", { method: "POST", token: publisher, body: {} })).toMatchObject({ status: 409, body: { error: { code: "nothing_to_bake" } } });

    const renamed = await publish(draft => { draft.items[0].name = "Renamed"; });
    expect(renamed.status).toBe(200);
    expect(renamed.body.bake).toBeUndefined();

    const moved = await publish(draft => { draft.worldTerrain[0].coast.seaLevel -= 0.25; });
    expect(moved.status).toBe(200);
    const revision = await catalogWorldRevision(codeRevision, RESOLVED_CATALOG.tables);
    expect(revision).not.toBe(codeRevision);
    expect(moved.body.bake).toMatchObject({ revision, catalogRevision: moved.body.revision, status: "queued" });
    await bakes.idle();

    const status = (await call("/admin/world", { token: reader })).body;
    expect(status).toMatchObject({ revision, base: false, source: "baked", canBake: true });
    expect(status.history[0]).toMatchObject({ revision, status: "ready", navFingerprint: "f".repeat(64) });
    expect((await call("/worlds")).body[0].worldRevision).toBe(revision);
    const index = (await call("/content-assets/index.json")).body;
    expect(Object.keys(index.files).filter((path: string) => path.startsWith("generated/")).sort()).toEqual(status.history[0].files);
    const manifest = await (await fetch(`http://127.0.0.1:${server.port}/content-assets/generated/world/manifest.json`)).json();
    expect(manifest.revision).toBe(revision);

    expect((await call("/admin/world", { method: "POST", token: reader, body: {} })).status).toBe(403);
    const again = await call("/admin/world", { method: "POST", token: publisher, body: {} });
    expect(again.status).toBe(202);
    expect(again.body.queued ?? again.body.active).toMatchObject({ revision });
    await bakes.idle();
    expect(baked).toEqual([revision, revision]);
    const audit = (await call("/admin/audit?action=world.bake", { token: session })).body;
    expect(audit.entries ?? audit).toContainEqual(expect.objectContaining({ action: "world.bake", target: revision }));
  }, 120_000);
});

describe("the server's module graph", () => {
  const FORBIDDEN = /node_modules\/(three|@gltf-transform\/[^/]+|meshoptimizer|draco3d|draco3dgltf|playwright|playwright-core|jsdom|@recast-navigation\/three)\/|^game\/src\/multiplayer\/bake\//;
  const graph = async (entry: string) => Object.keys((await build({ absWorkingDir: repoRoot, entryPoints: [entry], bundle: true, write: false, metafile: true,
    platform: "node", format: "esm", outdir: join(repoRoot, ".tmp/world-bake-graph"), logLevel: "silent", external: ["node:sea"] })).metafile.inputs);

  it("keeps the baker's three and GLB reader out of the bake jobs and their route, and has them in the baker", async () => {
    for (const entry of ["game/src/multiplayer/serverWorldBake.ts", "game/src/multiplayer/adminWorld.ts"]) expect((await graph(entry)).filter(file => FORBIDDEN.test(file))).toEqual([]);
    const baker = await graph("game/src/multiplayer/bake/bakerEntry.ts");
    expect(baker.some(file => /node_modules\/three\//.test(file))).toBe(true);
    expect(baker.some(file => /node_modules\/@gltf-transform\/core\//.test(file))).toBe(true);
  }, 120_000);
});
