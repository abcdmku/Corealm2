import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { createWorldCreatureResolver, setMeasuredFootprints } from "../game/src/content/worldCreatureResolver.js";
import type { ResolvedCreature } from "../game/src/content/creatureCompiler.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { activeFileReferences, createAssetHost } from "../game/src/multiplayer/assetManifest.js";
import { createContentAssetStore, type ContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { CONTENT_MANIFEST_OVERLAY, type ContentAssetIndex } from "../game/src/multiplayer/contentAssetsContract.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { manifestOverlayEntries, setManifestOverlay } from "../game/src/render/assets.js";
import { footprintRadius } from "../game/src/render/manifestOverlay.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld from "./fixtures/placementWorld.js";
import type { DevdocsBackend } from "../devdocs/src/api/backend.js";
import { setContentFiles } from "../devdocs/src/viewer/registry.js";
import { removeModel, saveModel } from "../devdocs/src/workspaces/assets/modelStore.js";
import { bundleModelFiles, type BundledModel } from "../devdocs/src/workspaces/assets/modelFiles.js";
import { AdminFailure } from "../devdocs/src/api/session.js";
import { CREATURE_MOTION_TIMING } from "../game/src/content/creatureMotionTiming.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
const ACTOR = { accountId: OWNER, credential: "session", at: 0 };
const DEER = "game/public/assets/models/animal/animal_deer.glb";
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); setManifestOverlay(null); setMeasuredFootprints([]); });
async function deerModel(): Promise<BundledModel> { return bundleModelFiles([{ name: "animal_deer.glb", bytes: new Uint8Array(await readFile(DEER)) }]); }

describe("footprints of a server's models", () => {
  it("resolves a creature on a model with no generated footprint from its measured size, and refuses one never measured", () => {
    const creature = { id: "moonhart_t5", assetId: "animal_moonhart", scale: 1.2, availability: "world", enemy: { tier: 5 } } as unknown as ResolvedCreature;
    const resolve = createWorldCreatureResolver(new Map([[creature.id, creature]]), []);
    setMeasuredFootprints([]);
    expect(() => resolve("moonhart_t5")).toThrow(/no measured footprint for animal_moonhart/);
    setMeasuredFootprints([{ id: "animal_moonhart", size: { x: 1.4, y: 2, z: 2.2 } }]);
    expect(resolve("moonhart_t5")!.bodyRadius).toBeCloseTo(1.1 * 1.2 * tierSilhouetteScale(5), 6);
    // A base model keeps its generated radius even when a server entry measures it differently.
    setMeasuredFootprints([{ id: "animal_deer", size: { x: 40, y: 1, z: 40 } }]);
    const deer = { ...creature, id: "deer", assetId: "animal_deer", scale: 1 } as ResolvedCreature;
    expect(createWorldCreatureResolver(new Map([["deer", deer]]), [])("deer")!.bodyRadius).toBeLessThan(5);
  });
});

describe("a server's own models, uploaded from devdocs and published", () => {
  const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
    protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };
  let server: Awaited<ReturnType<typeof startReferenceServer>>, storage: SqliteWorldStorage, store: ContentAssetStore, file: string, session: string;
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(url(path), { method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${session}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  };
  async function publish(change: (draft: Record<string, any>) => void) {
    const active = (await call("/admin/content/sources")).body as { revision: string; revisions: Record<string, string>; sources: Record<string, any> };
    const draft = structuredClone(active.sources);
    change(draft);
    const collections = Object.fromEntries(Object.keys(draft).filter(name => JSON.stringify(draft[name]) !== JSON.stringify(active.sources[name]))
      .map(name => [name, { revision: active.revisions[name]!, value: draft[name] }]));
    return call("/admin/content/publish", { method: "POST", body: { base: active.revision, collections } });
  }
  const onModel = (assetId: string) => (draft: Record<string, any>) => { (draft.creatureDefinitions as any[]).find(row => row.id === "deer_t5").presentation.assetId = assetId; };
  /** Devdocs' server backend, as far as a model upload uses it: `putFiles` stores and adopts the new index. */
  const devdocs = (): DevdocsBackend => ({
    kind: "server",
    async putFiles(files: Record<string, string>) {
      const stored = await call("/admin/files", { method: "POST", body: { files } });
      if (stored.status !== 200) throw new Error(JSON.stringify(stored.body));
      setContentFiles(url("/content-assets/"), (stored.body as ContentAssetIndex).files);
      return { files: stored.body.files };
    },
    admin: (path: string, init: { method?: string; body?: unknown } = {}) => call(path, init).then(result => {
      if (result.status >= 400) throw new AdminFailure(result.status, result.body.error.code, result.body.error.message, result.body.error);
      return result.body;
    }),
  }) as unknown as DevdocsBackend;

  beforeAll(async () => {
    file = join(tmpdir(), `corealm-models-${randomUUID()}.sqlite`);
    const created = createSigningKey();
    const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
    storage = new SqliteWorldStorage(file, { log: () => {} });
    await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: Object.fromEntries(await readContentSources()) }, () => {});
    const dir = await mkdtemp(join(tmpdir(), "corealm-models-")); dirs.push(dir);
    store = createContentAssetStore({ dir, audit: (by, entry) => storage.admin.record(by, entry),
      references: activeFileReferences({ sources: async () => JSON.parse((await storage.catalog.sources())?.sources ?? "null"), files: { index: () => store.index(), read: path => store.read(path) } }) });
    server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
      ownerAccount: OWNER, log: () => {}, adminRoutes: [store.route], contentAssets: store,
      assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
      authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
    const joinToken = signJoinToken(created.signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
    session = (await fetch(url("/admin/session"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: joinToken }) }).then(response => response.json()) as { session: string }).session;
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
  });

  it("refuses a model id nothing has, then accepts it once the model is uploaded, with its measured footprint", async () => {
    const refused = await publish(onModel("animal_moonhart"));
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain("animal_moonhart");

    const entry = await saveModel(await deerModel(), { id: "animal_moonhart", category: "character", pack: "server-uploads", is: "animal", tags: ["deer", "fairy"] }, devdocs());
    const index = await store.index();
    expect(Object.keys(index.files).sort()).toEqual([CONTENT_MANIFEST_OVERLAY, "assets/models/character/animal_moonhart.glb"]);
    const overlay = JSON.parse((await store.read(CONTENT_MANIFEST_OVERLAY))!.bytes.toString("utf8"));
    expect(overlay.assets).toEqual([entry]);
    // The deer's attack clip timed at upload: its length and the contact point its extras author, as the build times the deer.
    expect({ seconds: entry.attackSeconds, contactNormalized: entry.contactNormalized }).toEqual(CREATURE_MOTION_TIMING.animal_deer);
    // Devdocs merged the stored overlay into its registries.
    expect(manifestOverlayEntries().map(row => row.id)).toEqual(["animal_moonhart"]);

    const accepted = await publish(onModel("animal_moonhart"));
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const sources = (await call("/admin/content/sources")).body as { revision: string };
    const catalog = (await call(`/admin/content/catalog/${sources.revision}`)).body;
    const tables = (catalog.catalog ?? catalog).tables;
    const deer = Object.values(tables.world.creatureByGroup as Record<string, { id: string; assetId: string; bodyRadius: number; stats: { tier: number } }>).find(row => row.assetId === "animal_moonhart")!;
    expect(deer, "a world group of deer_t5 stands on the uploaded model").toBeDefined();
    expect(deer.bodyRadius).toBeCloseTo(footprintRadius(entry.size) * tierSilhouetteScale(deer.stats.tier), 5);

    // Still an unknown id is refused while the overlay holds another.
    expect((await publish(onModel("animal_nowhere"))).status).toBe(422);
  });

  it("keeps both authors' models when two edit the overlay at once, and times the server's combat on them", async () => {
    // Author A reads the index; author B saves a model before A's overlay write lands.
    const racing = devdocs();
    let raced = false;
    const a = { ...racing, admin: async (path: string, init: { method?: string; body?: any } = {}) => {
      if (!raced && init.method === "POST" && init.body?.expect) { raced = true; await saveModel(await deerModel(), { id: "animal_starhart", category: "character", pack: "server-uploads", is: "animal", tags: [] }, devdocs()); }
      return racing.admin(path, init as never);
    } } as DevdocsBackend;
    await saveModel(await deerModel(), { id: "animal_dawnhart", category: "character", pack: "server-uploads", is: "animal", tags: [] }, a);
    expect(raced).toBe(true);
    const overlay = JSON.parse((await store.read(CONTENT_MANIFEST_OVERLAY))!.bytes.toString("utf8")) as { assets: { id: string }[] };
    expect(overlay.assets.map(entry => entry.id)).toEqual(["animal_moonhart", "animal_starhart", "animal_dawnhart"]);
    // A stale write is refused outright by the store.
    const stale = await call("/admin/files", { method: "POST", body: { files: { [CONTENT_MANIFEST_OVERLAY]: Buffer.from("{}").toString("base64") }, expect: "0".repeat(32) } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale");
    // deer_t5 stands on animal_moonhart: its files and the overlay cannot be deleted, and devdocs' remove changes nothing.
    await expect(removeModel("animal_moonhart", devdocs())).rejects.toMatchObject({ status: 409, code: "file_referenced",
      details: { references: { "assets/models/character/animal_moonhart.glb": ["creatureDefinitions/deer_t5"] } } });
    expect((await call("/admin/files", { method: "DELETE", body: { paths: [CONTENT_MANIFEST_OVERLAY] } })).body.error.references[CONTENT_MANIFEST_OVERLAY]).toEqual(["creatureDefinitions/deer_t5"]);
    expect(Object.keys((await store.index()).files)).toContain("assets/models/character/animal_moonhart.glb");
    // The publish read the overlay: its models' attack timing is where the server's combat reads it.
    await publish(onModel("animal_deer"));
    expect(CREATURE_MOTION_TIMING.animal_dawnhart).toEqual(CREATURE_MOTION_TIMING.animal_deer);
    await removeModel("animal_starhart", devdocs());
    await removeModel("animal_dawnhart", devdocs());
  });

  it("drops a removed model from the overlay, the store and the next publish's accepted ids", async () => {
    await publish(onModel("animal_deer"));
    await removeModel("animal_moonhart", devdocs());
    const index = await store.index();
    expect(Object.keys(index.files)).toEqual([CONTENT_MANIFEST_OVERLAY]);
    expect(JSON.parse((await store.read(CONTENT_MANIFEST_OVERLAY))!.bytes.toString("utf8"))).toEqual({ assets: [] });
    expect((await publish(onModel("animal_moonhart"))).status).toBe(422);
  });

  it("gives a publish the overlay's ids even from a store read directly", async () => {
    const host = createAssetHost({ bundledManifest: async () => ({ assets: [{ id: "animal_deer" }] }), contentAssets: store });
    await store.put({ [CONTENT_MANIFEST_OVERLAY]: Buffer.from(JSON.stringify({ assets: [{ id: "animal_ghost", file: "models/character/animal_ghost.glb", pack: "p", category: "character", is: "animal", tags: [], bytes: 1, size: { x: 1, y: 1, z: 1 }, animations: [], materials: [] }, { id: "../bad" }] })).toString("base64") }, ACTOR);
    const pools = await host.pools({});
    expect(pools.asset!.has("animal_ghost")).toBe(true);
    expect(pools.asset!.has("../bad")).toBe(false);
    expect(pools.asset!.has("animal_deer")).toBe(true);
  });
});
