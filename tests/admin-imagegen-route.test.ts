import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import type { CreatureSkin } from "../game/src/content/schema/creatureSkins.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createContentAssetStore, type ContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { PublishFailure, type ContentPublisher } from "../game/src/multiplayer/contentPublish.js";
import { createImagegenRoute, parseImagegenConfig, type ImagegenRoute } from "../game/src/multiplayer/adminImagegen.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import type { ImagegenGenerator } from "../game/src/multiplayer/imagegenRunner.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { readContentSources } from "../tools/content/compile.js";
import type { ImagegenJob } from "../devdocs/shared/skinContracts.js";
import placementWorld from "./fixtures/placementWorld.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
const ASSET = "animal_deer", MATERIAL = "animal_deer_mat";
const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };

const dirs: string[] = [];
async function tempDir(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "corealm-imagegen-route-")); dirs.push(dir); return dir; }

interface Served {
  call(path: string, init?: { method?: string; token?: string; body?: unknown }): Promise<{ status: number; body: any }>;
  session: string;
  close(): Promise<void>;
}

/** A reference server with the image route mounted, signed in as the owner. */
async function serve(route: ImagegenRoute["route"], extra: { sources?: Record<string, unknown>; store?: ContentAssetStore; storage?: SqliteWorldStorage } = {}): Promise<Served> {
  const file = join(tmpdir(), `corealm-imagegen-${randomUUID()}.sqlite`);
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const storage = extra.storage ?? new SqliteWorldStorage(file, { log: () => {} });
  await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: extra.sources ?? { npcs: [{ id: "smith" }] } }, () => {});
  const server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
    ownerAccount: OWNER, log: () => {}, adminRoutes: [...(extra.store ? [extra.store.route] : []), route], ...(extra.store ? { contentAssets: extra.store } : {}),
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")), bundledFile: async () => false },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
  const call: Served["call"] = async (path, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const joinToken = signJoinToken(created.signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
  const session = (await call("/admin/session", { method: "POST", body: { token: joinToken } })).body.session as string;
  return { call, session, close: async () => { await server.close(); for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); } };
}

afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

describe("image job config", () => {
  it("offers nothing without a block and refuses a malformed one", () => {
    expect(parseImagegenConfig(undefined)).toBeNull();
    expect(parseImagegenConfig({})).toEqual({});
    expect(parseImagegenConfig({ command: " node paint.js {output} ", effort: "low", timeoutMinutes: 5 })).toEqual({ command: "node paint.js {output}", effort: "low", timeoutMinutes: 5 });
    for (const bad of [[], "codex", { command: "" }, { effort: "Max!" }, { timeoutMinutes: 0 }, { timeoutMinutes: 999 }, { model: "x" }]) expect(() => parseImagegenConfig(bad), JSON.stringify(bad)).toThrow(/imagegen/);
  });
});

describe("image jobs on a server without an imagegen block", () => {
  let served: Served;
  beforeAll(async () => {
    const route = createImagegenRoute({ config: null, dir: await tempDir(), store: { put: async () => { throw new Error("unused"); } },
      catalog: { activeRevision: async () => null, sources: async () => null }, publisher: () => null,
      admin: { listApiTokens: async () => [], roleOf: async () => null, banOf: async () => null } });
    expect(route.service).toBeNull();
    served = await serve(route.route);
  }, 60_000);
  afterAll(async () => { await served?.close(); });

  it("answers every path 404 not_offered, which the devdocs probe reads as absent", async () => {
    for (const [method, path] of [["GET", "/admin/imagegen"], ["POST", "/admin/imagegen"], ["GET", "/admin/imagegen/20260927t120000-abcdef"]] as const) {
      const answer = await served.call(path, { method, token: served.session, ...(method === "POST" ? { body: {} } : {}) });
      expect(answer.status, path).toBe(404);
      expect(answer.body.error.code).toBe("not_offered");
    }
  });
});

describe("image jobs on a server", () => {
  let served: Served, store: ContentAssetStore, route: ImagegenRoute, jobsDir: string;
  let publisher: Pick<ContentPublisher, "publish"> | null = null;
  const painted: string[] = [];
  /** When set, painting waits for it: a test changes the world while a job is in flight. */
  let hold: Promise<void> | null = null;
  const generator: ImagegenGenerator = { generator: "fake painter", run: async input => {
    await hold;
    painted.push(input.name);
    expect(input.task).toContain(`material "${MATERIAL}" on the 3D model "${ASSET}", 16x8 pixels`);
    await sharp({ create: { width: 32, height: 16, channels: 3, background: { r: 30, g: 60, b: 200 } } }).png().toFile(input.output);
  } };

  beforeAll(async () => {
    const file = join(tmpdir(), `corealm-imagegen-store-${randomUUID()}.sqlite`);
    const storage = new SqliteWorldStorage(file, { log: () => {} });
    dirs.push(file, `${file}-wal`, `${file}-shm`);
    store = createContentAssetStore({ dir: await tempDir(), audit: (by, entry) => storage.admin.record(by, entry) });
    jobsDir = await tempDir();
    route = createImagegenRoute({ config: parseImagegenConfig({}), dir: jobsDir, store, catalog: storage.catalog, publisher: () => publisher, generator,
      admin: storage.admin, audit: (by, entry) => storage.admin.record(by, entry) });
    served = await serve(route.route, { sources: Object.fromEntries(await readContentSources()), store, storage });
  }, 120_000);
  afterAll(async () => { await served?.close(); });

  const request = async () => ({ assetId: ASSET, name: "Frost Deer", prompt: "Frost-rimed grey coat with pale blue flecks",
    references: { [MATERIAL]: (await sharp({ create: { width: 16, height: 8, channels: 3, background: { r: 120, g: 90, b: 60 } } }).png().toBuffer()).toString("base64") } });

  it("gates the routes by scope", async () => {
    const token = async (scopes: string[]) => (await served.call("/admin/tokens", { method: "POST", token: served.session, body: { label: scopes.join(" "), scopes } })).body.token as string;
    const [reader, players, author] = [await token(["content:read"]), await token(["players:read"]), await token(["content:publish"])];
    expect((await served.call("/admin/imagegen")).status).toBe(401);
    expect((await served.call("/admin/imagegen", { token: players })).status).toBe(403);
    expect(await served.call("/admin/imagegen", { token: reader })).toEqual({ status: 200, body: { jobs: [] } });
    expect((await served.call("/admin/imagegen", { method: "POST", token: reader, body: await request() })).status).toBe(403);
    expect((await served.call("/admin/imagegen/20260927t120000-abcdef", { method: "POST", token: reader })).status).toBe(403);
    expect((await served.call("/admin/imagegen/20260927t120000-abcdef", { token: reader })).status).toBe(404);
    expect((await served.call("/admin/imagegen/a/b", { token: reader })).status).toBe(404);
    expect((await served.call("/admin/imagegen", { method: "DELETE", token: author })).status).toBe(405);
    const refused = await served.call("/admin/imagegen", { method: "POST", token: author, body: { ...await request(), prompt: "" } });
    expect([refused.status, refused.body.error.code]).toEqual([400, "invalid_request"]);
    expect((await served.call("/admin/imagegen", { method: "POST", token: author, body: { ...await request(), kind: "icon", itemId: "iron_sword" } })).body.error.message)
      .toBe("This host does not paint icon jobs");
  });

  it("paints, keeps the maps through a failed publish, and on Retry stores them and publishes the creatureSkins row", async () => {
    const created = await served.call("/admin/imagegen", { method: "POST", token: served.session, body: await request() });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const job = created.body.job as ImagegenJob;
    expect(job).toMatchObject({ kind: "skin", assetId: ASSET, name: "Frost Deer", materials: [MATERIAL], status: "queued" });
    await route.service!.idle();
    // No publisher yet (the reference server makes it after its routes): the job fails with its map painted.
    const failed = (await served.call(`/admin/imagegen/${job.id}`, { token: served.session })).body.job as ImagegenJob;
    expect(failed).toMatchObject({ status: "failed", error: "This server cannot publish content yet" });

    // Stand-in for the running server's publisher: its own publish endpoint, which runs every real check.
    publisher = { publish: async request => {
      const answer = await served.call("/admin/content/publish", { method: "POST", token: served.session, body: request });
      if (answer.status !== 200) throw new PublishFailure(answer.status, answer.body.error.code, answer.body.error.message, answer.body.error);
      return answer.body;
    } };
    expect((await served.call(`/admin/imagegen/${job.id}`, { method: "POST", token: served.session })).body.job.status).toBe("queued");
    await route.service!.idle();
    const done = (await served.call(`/admin/imagegen/${job.id}`, { token: served.session })).body.job as ImagegenJob;
    const map = `skins/${ASSET}/frost-deer/${MATERIAL}.png`;
    expect(done, done.log).toMatchObject({ status: "done", skinId: "frost-deer", outputs: [`assets/${map}`] });
    expect(painted).toEqual([MATERIAL]);

    const stored = await store.read(`assets/${map}`);
    expect(await sharp(stored!.bytes).metadata()).toMatchObject({ width: 16, height: 8, format: "png" });
    const sources = (await served.call("/admin/content/sources", { token: served.session })).body.sources as { creatureSkins: CreatureSkin[] };
    expect(sources.creatureSkins.find(skin => skin.id === "frost-deer")).toEqual({ id: "frost-deer", assetId: ASSET, name: "Frost Deer", kind: "imagegen",
      maps: { [MATERIAL]: map }, prompt: "Frost-rimed grey coat with pale blue flecks", generator: "fake painter",
      sha256: { [MATERIAL]: stored!.entry.sha256 }, createdAt: expect.stringMatching(/^2\d{3}-/) });
    const audit = (await served.call("/admin/audit", { token: served.session })).body.entries as { action: string; target: string; accountId: string; after: any }[];
    expect(audit.find(entry => entry.action === "content.publish")?.after.note).toBe(`Image job ${job.id}`);
    expect(audit.filter(entry => entry.action.startsWith("imagegen.")).map(entry => [entry.action, entry.target, entry.accountId]))
      .toEqual(expect.arrayContaining([["imagegen.create", job.id, OWNER], ["imagegen.retry", job.id, OWNER]]));
    expect(audit.some(entry => entry.action === "content.files.put")).toBe(true);
  }, 120_000);
  it("fails a job whose creator's token was revoked while it painted, and publishes it as the admin who retries", async () => {
    const created = await served.call("/admin/tokens", { method: "POST", token: served.session, body: { label: "painter", scopes: ["content:read", "content:publish"] } });
    const [secret, tokenId] = [created.body.token as string, created.body.id as string];
    let release!: () => void;
    hold = new Promise(resolve => { release = resolve; });
    const posted = await served.call("/admin/imagegen", { method: "POST", token: secret, body: { ...await request(), name: "Ash Deer" } });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const job = posted.body.job as ImagegenJob;
    expect((await served.call(`/admin/tokens/${tokenId}`, { method: "DELETE", token: served.session })).status).toBe(200);
    release(); hold = null;
    await route.service!.idle();

    const failed = (await served.call(`/admin/imagegen/${job.id}`, { token: served.session })).body.job as ImagegenJob;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe(`The API token that started this job (${tokenId}) was revoked. The painted images are kept: Retry as a current admin to publish them.`);
    const skinsOf = async () => ((await served.call("/admin/content/sources", { token: served.session })).body.sources as { creatureSkins: CreatureSkin[] }).creatureSkins;
    expect((await skinsOf()).some(skin => skin.id === "ash-deer")).toBe(false);

    const paintedBefore = painted.length;
    const previous = publisher!, publishedBy: { credential: string }[] = [];
    publisher = { publish: (body, by) => { publishedBy.push(by); return previous.publish(body, by); } };
    expect((await served.call(`/admin/imagegen/${job.id}`, { method: "POST", token: served.session })).body.job.status).toBe("queued");
    await route.service!.idle();
    const done = (await served.call(`/admin/imagegen/${job.id}`, { token: served.session })).body.job as ImagegenJob;
    expect(done, done.log).toMatchObject({ status: "done", skinId: "ash-deer" });
    expect(painted.length).toBe(paintedBefore);
    expect((await skinsOf()).find(skin => skin.id === "ash-deer")?.name).toBe("Ash Deer");
    // The retry's caller published it: the session, not the revoked token.
    expect(publishedBy.map(by => by.credential)).toEqual(["session"]);
    publisher = previous;
  }, 120_000);
});
