import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createAssetHost } from "../game/src/multiplayer/assetManifest.js";
import { ContentAssetFailure, createContentAssetStore, MAX_CONTENT_ASSET_BYTES, type ContentAssetStore } from "../game/src/multiplayer/contentAssets.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { descriptor as parseDescriptor } from "../game/src/multiplayer/protocol.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld from "./fixtures/placementWorld.js";
import { contentAssetOverride } from "../game/src/app/config.js";
import { createContentAssetOverlay } from "../game/src/app/contentAssetOverlay.js";
import { CreatureLooks } from "../game/src/render/creatureSkins.js";
import type { CreatureSkin } from "../game/src/content/schema/creatureSkins.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
const ACTOR = { accountId: OWNER, credential: "session", at: 0 };
/** A real 1x1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const MAP = "assets/skins/animal_deer/frost/coat.png";

const dirs: string[] = [];
async function tempDir(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), "corealm-files-")); dirs.push(dir); return dir; }
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

describe("content asset store", () => {
  it("stores, reads, replaces and removes files, and its revision follows the files, not the clock", async () => {
    const dir = await tempDir(), audits: { action: string }[] = [];
    let ms = Date.parse("2026-09-27T00:00:00Z");
    const store = createContentAssetStore({ dir, now: () => ms, audit: async (_by, entry) => { audits.push(entry); } });
    const empty = await store.index();
    expect(empty.files).toEqual({});

    const first = await store.put({ [MAP]: PNG.toString("base64") }, ACTOR);
    expect(first.files[MAP]).toEqual({ sha256: createHash("sha256").update(PNG).digest("hex"), bytes: PNG.length, type: "image/png", at: "2026-09-27T00:00:00.000Z" });
    expect(first.revision).not.toBe(empty.revision);
    expect((await store.read(MAP))!.bytes.equals(PNG)).toBe(true);
    expect(await readFile(join(dir, "files", "assets", "skins", "animal_deer", "frost", "coat.png"))).toEqual(PNG);

    // The same bytes again change nothing and write no audit row.
    ms += 1000;
    expect(await store.put({ [MAP]: PNG.toString("base64") }, ACTOR)).toEqual(first);

    // A reopened store reads the same index from disk.
    expect(await createContentAssetStore({ dir }).index()).toEqual(first);

    const other = Buffer.concat([PNG, Buffer.from([0])]);
    const replaced = await store.put({ [MAP]: other.toString("base64"), "audio/sfx/server/bell.ogg": Buffer.from("OggS").toString("base64") }, ACTOR);
    expect(replaced.revision).not.toBe(first.revision);
    expect(replaced.files["audio/sfx/server/bell.ogg"]!.type).toBe("audio/ogg");

    const removed = await store.remove(["audio/sfx/server/bell.ogg", MAP], ACTOR);
    expect(removed).toEqual({ revision: empty.revision, files: {} });
    await expect(stat(join(dir, "files", "assets", "skins", "animal_deer", "frost", "coat.png"))).rejects.toThrow();
    expect(await store.read(MAP)).toBeNull();
    await expect(store.remove([MAP], ACTOR)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(audits.map(entry => entry.action)).toEqual(["content.files.put", "content.files.put", "content.files.remove"]);
  });

  it("refuses paths outside the contract, bad base64, empty files and files over the cap, and writes nothing", async () => {
    const dir = await tempDir();
    const store = createContentAssetStore({ dir });
    const good = PNG.toString("base64");
    for (const path of ["assets/skins/../../index.json", "assets/skins/./a.png", "../outside.png", "/assets/skins/a/b.png", "assets\\skins\\a.png",
      "assets/skins/a/.hidden.png", "assets/skins/a/b.exe", "assets/skins/a/b.png.html", "assets/manifest.json", "generated/terrain.bin", "game/secret.png", "audio/../x.ogg"]) {
      await expect(store.put({ [path]: good }, ACTOR), path).rejects.toMatchObject({ status: 400, code: "invalid_path" });
    }
    await expect(store.put({ [MAP]: "not base64!" }, ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(store.put({ [MAP]: "" }, ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(store.put({}, ACTOR)).rejects.toMatchObject({ status: 400 });
    const tooBig = Buffer.alloc(MAX_CONTENT_ASSET_BYTES + 1).toString("base64");
    // One bad file refuses the whole request.
    await expect(store.put({ [MAP]: good, "assets/skins/animal_deer/frost/big.png": tooBig }, ACTOR)).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
    expect((await store.index()).files).toEqual({});
    await expect(stat(join(dir, "files"))).rejects.toThrow();
    expect(new ContentAssetFailure(400, "x", "y")).toBeInstanceOf(Error);
  });

  it("adds its paths to a publish's asset pool and answers which files exist anywhere", async () => {
    const store = createContentAssetStore({ dir: await tempDir() });
    await store.put({ [MAP]: PNG.toString("base64") }, ACTOR);
    const onDisk = new Set(["assets/skins/animal_deer/base/coat.png"]);
    const host = createAssetHost({ bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")),
      bundledFile: async path => onDisk.has(path), contentAssets: store });
    const pools = await host.pools({});
    expect(pools.asset!.has(MAP)).toBe(true);
    expect(pools.asset!.has("animal_deer")).toBe(true);
    expect(await host.missingFiles([MAP, "assets/skins/animal_deer/base/coat.png", "assets/skins/animal_deer/gone/coat.png"])).toEqual(["assets/skins/animal_deer/gone/coat.png"]);
    // A remote host is asked with HEAD, once per path while the answer is fresh.
    const asked: string[] = [];
    const remote = createAssetHost({ assetBaseUrl: "https://assets.test/corealm/", contentAssets: store,
      fetch: (async (url: string, init: RequestInit) => { asked.push(`${init.method} ${url}`); return new Response(null, { status: url.endsWith("here.png") ? 200 : 404 }); }) as typeof fetch });
    expect(await remote.missingFiles([MAP, "assets/skins/a/b/here.png", "assets/skins/a/b/gone.png"])).toEqual(["assets/skins/a/b/gone.png"]);
    expect(await remote.missingFiles(["assets/skins/a/b/gone.png"])).toEqual(["assets/skins/a/b/gone.png"]);
    expect(asked).toEqual(["HEAD https://assets.test/corealm/assets/skins/a/b/here.png", "HEAD https://assets.test/corealm/assets/skins/a/b/gone.png"]);
  });
});

describe("content assets on a running server", () => {
  const world: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
    protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };
  let server: Awaited<ReturnType<typeof startReferenceServer>>, storage: SqliteWorldStorage, store: ContentAssetStore, file: string, session: string;
  const onDisk = new Set<string>();
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(url(path), { method: init.method ?? "GET",
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

  beforeAll(async () => {
    file = join(tmpdir(), `corealm-files-${randomUUID()}.sqlite`);
    const created = createSigningKey();
    const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
    storage = new SqliteWorldStorage(file, { log: () => {} });
    await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: Object.fromEntries(await readContentSources()) }, () => {});
    store = createContentAssetStore({ dir: await tempDir(), audit: (by, entry) => storage.admin.record(by, entry) });
    server = await startReferenceServer({ worlds: [world], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
      ownerAccount: OWNER, log: () => {}, adminRoutes: [store.route], contentAssets: store,
      assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")), bundledFile: async path => onDisk.has(path) },
      authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
    const joinToken = signJoinToken(created.signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
    session = (await call("/admin/session", { method: "POST", body: { token: joinToken } })).body.session;
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
  });

  it("names its file store in /worlds, /admin/info and the descriptor a client parses", async () => {
    const expected = `http://127.0.0.1:${server.port}/content-assets/`;
    const worlds = (await call("/worlds")).body as unknown[];
    expect((worlds[0] as WorldDescriptor).contentAssetUrl).toBe(expected);
    expect(parseDescriptor(worlds[0], "socket").contentAssetUrl).toBe(expected);
    expect([...server.worlds.values()][0]!.runtime.descriptor.contentAssetUrl).toBe(expected);
    expect((await call("/admin/info")).body.contentAssetUrl).toBe(expected);
    expect(() => parseDescriptor({ ...(worlds[0] as object), contentAssetUrl: "javascript:alert(1)" }, "socket")).toThrow();
    expect(() => parseDescriptor({ ...(worlds[0] as object), contentAssetUrl: "http://evil.example/files/" }, "socket")).toThrow();
  });

  it("gates /admin/files by scope and audits writes", async () => {
    const reader = (await call("/admin/tokens", { method: "POST", token: session, body: { label: "reader", scopes: ["content:read"] } })).body.token as string;
    const players = (await call("/admin/tokens", { method: "POST", token: session, body: { label: "players", scopes: ["players:read"] } })).body.token as string;
    const publisher = (await call("/admin/tokens", { method: "POST", token: session, body: { label: "files", scopes: ["content:publish"] } })).body.token as string;
    expect((await call("/admin/files")).status).toBe(401);
    expect((await call("/admin/files", { token: players })).status).toBe(403);
    expect((await call("/admin/files", { token: reader })).status).toBe(200);
    const put = { files: { "assets/icons/items/48/server_blade.png": PNG.toString("base64") } };
    expect((await call("/admin/files", { method: "POST", token: reader, body: put })).status).toBe(403);
    const stored = await call("/admin/files", { method: "POST", token: publisher, body: put });
    expect(stored.status).toBe(200);
    expect(stored.body.files["assets/icons/items/48/server_blade.png"].bytes).toBe(PNG.length);
    expect((await call("/admin/files", { method: "POST", token: session, body: { files: { "assets/../x.png": PNG.toString("base64") } } })).body.error.code).toBe("invalid_path");
    expect((await call("/admin/files", { method: "PUT", token: session, body: put })).status).toBe(405);
    expect((await call("/admin/files", { method: "DELETE", token: reader, body: { paths: ["assets/icons/items/48/server_blade.png"] } })).status).toBe(403);
    const deleted = await call("/admin/files", { method: "DELETE", token: session, body: { paths: ["assets/icons/items/48/server_blade.png"] } });
    expect(deleted.status).toBe(200);
    expect(deleted.body.files).toEqual({});
    const audit = (await call("/admin/audit?action=content.files.put", { token: session })).body;
    expect(JSON.stringify(audit)).toContain("assets/icons/items/48/server_blade.png");
    // A body over the route's cap is refused before it is read whole.
    const huge = await fetch(url("/admin/files"), { method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json", "Content-Length": String(65 * 1024 * 1024) }, body: "{}" }).catch(() => null);
    if (huge) expect(huge.status).toBe(413);
  });

  it("serves a stored file publicly with CORS, type, ETag and an immutable cache only for its own hash", async () => {
    const index = (await call("/admin/files", { method: "POST", token: session, body: { files: { [MAP]: PNG.toString("base64") } } })).body;
    const sha = index.files[MAP].sha256 as string;
    const listed = await fetch(url("/content-assets/index.json"));
    expect(listed.headers.get("access-control-allow-origin")).toBe("*");
    expect(listed.headers.get("cache-control")).toBe("no-cache");
    expect(listed.headers.get("etag")).toBe(`"${index.revision}"`);
    expect((await listed.json()).files[MAP].sha256).toBe(sha);
    expect((await fetch(url("/content-assets/index.json"), { headers: { "If-None-Match": `"${index.revision}"` } })).status).toBe(304);

    const plain = await fetch(url(`/content-assets/${MAP}`));
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-type")).toBe("image/png");
    expect(plain.headers.get("access-control-allow-origin")).toBe("*");
    expect(plain.headers.get("etag")).toBe(`"${sha}"`);
    expect(plain.headers.get("cache-control")).toBe("no-cache");
    expect(Buffer.from(await plain.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await fetch(url(`/content-assets/${MAP}?v=${sha}`))).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await fetch(url(`/content-assets/${MAP}?v=${"0".repeat(64)}`))).headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(url(`/content-assets/${MAP}`), { headers: { "If-None-Match": `"${sha}"` } })).status).toBe(304);
    expect((await fetch(url("/content-assets/assets/skins/animal_deer/frost/none.png"))).status).toBe(404);
    expect((await fetch(url("/content-assets/..%2F..%2Findex.json"))).status).toBe(404);
    expect((await fetch(url(`/content-assets/${MAP}`), { method: "POST" })).status).toBe(405);
  });

  it("publishes a skin whose map is in the store and refuses one whose map is nowhere", async () => {
    await call("/admin/files", { method: "POST", token: session, body: { files: { [MAP]: PNG.toString("base64") } } });
    const skin = (id: string, map: string) => ({ id, assetId: "animal_deer", name: `Deer ${id}`, kind: "upload", maps: { coat: map }, createdAt: "2026-09-27T00:00:00.000Z" });
    const refused = await publish(draft => {
      draft.creatureSkins = [...(draft.creatureSkins ?? []), skin("lost", "skins/animal_deer/lost/coat.png")];
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("content_invalid");
    expect(JSON.stringify(refused.body)).toContain("assets/skins/animal_deer/lost/coat.png");

    const accepted = await publish(draft => {
      draft.creatureSkins = [...(draft.creatureSkins ?? []), skin("frost", "skins/animal_deer/frost/coat.png")];
      const deer = (draft.creatureDefinitions as any[]).find(row => row.id === "deer_t5");
      deer.presentation.skinId = "frost";
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.stored).toBe(true);
    expect(accepted.body.changedCollections.sort()).toEqual(["creatureDefinitions", "creatureSkins"]);

    // A client that joined this world resolves the published skin's map to this server, and the URL serves the PNG.
    const joined = parseDescriptor((await call("/worlds")).body[0], "socket");
    const overlay = createContentAssetOverlay();
    await overlay.enter(joined.contentAssetUrl);
    const published = (await call("/admin/content/sources", { token: session })).body.sources as Record<string, any>;
    const loaded: string[] = [];
    const looks = new CreatureLooks({ baseUrl: () => "https://assets.example/corealm/assets/", skin: id => (published.creatureSkins as CreatureSkin[]).find(row => row.id === id),
      loadImage: async at => { loaded.push(at); return { width: 1, height: 1 } as unknown as HTMLCanvasElement; } });
    const deerSkin = (published.creatureDefinitions as any[]).find(row => row.id === "deer_t5").presentation.skinId as string;
    await looks.whenLoaded(looks.resolve("animal_deer", deerSkin)!);
    const sha = createHash("sha256").update(PNG).digest("hex");
    expect(loaded).toEqual([`http://127.0.0.1:${server.port}/content-assets/${MAP}?v=${sha}`]);
    const served = await fetch(loaded[0]!);
    expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
    overlay.leave();
    expect(contentAssetOverride(MAP)).toBeNull();

    // A map the running catalog already names was checked when it arrived; editing the skin again does not probe it.
    const renamed = await publish(draft => { (draft.creatureSkins as any[]).find(row => row.id === "frost").name = "Frost deer"; });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
  });
});
