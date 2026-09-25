import { afterEach, describe, expect, it } from "vitest";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { WORLD_PROTOCOL_VERSION, type SessionCatalog, type WorldDescriptor } from "../game/src/contracts.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { clientCatalog, serializeClientCatalog } from "../game/src/content/clientCatalog.js";
import type { OverlayRegistry } from "../game/src/content/clientCatalogOverlay.js";
import type { ContentTables } from "../game/src/content/index.js";
import { activeServerCatalog, seedCatalog, type BaseCatalog } from "../game/src/multiplayer/catalogHost.js";
import { MemoryCatalogStorage, type CatalogStorage, type CatalogWrite } from "../game/src/multiplayer/catalogStorage.js";
import { catalogUrl, createServerCatalogOverlay, fetchClientCatalog, type CatalogAddress, type CatalogFetchPorts } from "../game/src/multiplayer/clientCatalogFetch.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";

const A = "a".repeat(64), B = "b".repeat(64), F = "f".repeat(64);
const marker = { version: "0.1.0", revision: A };
const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "lab", seed: 1337, population: 0, capacity: 4, availability: "available" };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const write = (revision: string, at: number, note: string | null = null): CatalogWrite => ({ revision, formulaRevision: F, server: `{"server":"${revision[0]}"}`,
  client: `{"client":"${revision[0]}"}`, sources: `{"items":["${revision[0]}"]}`, by: "acc_test", at, note, base: { version: "0.1.0", revision: A } });
/** A shipped catalog that is not the one this process runs on: same tables, one renamed item. */
const base = (revision: string, itemName: string, version = "0.1.0"): BaseCatalog => ({ version,
  catalog: { version: 1, revision, formulaRevision: F, tables: { ...RESOLVED_CATALOG.tables, items: [{ ...RESOLVED_CATALOG.tables.items[0]!, name: itemName }] } },
  sources: { items: [{ id: RESOLVED_CATALOG.tables.items[0]!.id, name: itemName }] } });

describe.each([
  ["memory", async (): Promise<CatalogStorage> => new MemoryCatalogStorage()],
  ["sqlite", async (): Promise<CatalogStorage> => { const storage = new SqliteWorldStorage(":memory:"); cleanups.push(() => storage.close()); return storage.catalog; }],
])("catalog storage: %s", (_name, open) => {
  it("stores a revision once, moves the active pointer, and records every move", async () => {
    const storage = await open();
    expect(await storage.activeRevision()).toBeNull();
    expect(await storage.sources()).toBeNull();
    expect(await storage.history(10)).toEqual([]);
    expect(await storage.store(write(A, 1000, "first"))).toBe(true);
    // A revision is a content hash: storing it again changes nothing, not even who stored it.
    expect(await storage.store({ ...write(A, 2000), server: "{}", by: "acc_other" })).toBe(false);
    expect(await storage.revisionInfo(A)).toEqual({ revision: A, formulaRevision: F, storedBy: "acc_test", storedAt: 1000, note: "first", base: { version: "0.1.0", revision: A } });
    expect(await storage.catalog(A, "server")).toBe('{"server":"a"}');
    expect(await storage.catalog(A, "client")).toBe('{"client":"a"}');
    expect(await storage.catalog(B, "client")).toBeNull();
    expect(await storage.activeRevision()).toBeNull();

    expect(await storage.activate(A, "seed", 1000)).toEqual({ id: 1, revision: A, previous: null, by: "seed", at: 1000, base: marker });
    await storage.store(write(B, 3000));
    expect(await storage.activate(B, "acc_admin", 3000)).toEqual({ id: 2, revision: B, previous: A, by: "acc_admin", at: 3000, base: marker });
    expect(await storage.activate(B, "acc_again", 3500)).toEqual({ id: 2, revision: B, previous: A, by: "acc_admin", at: 3000, base: marker });
    // Rollback is activating an earlier stored revision.
    expect(await storage.activate(A, "acc_admin", 4000)).toEqual({ id: 3, revision: A, previous: B, by: "acc_admin", at: 4000, base: marker });
    expect(await storage.activeRevision()).toBe(A);
    expect(await storage.sources()).toEqual({ revision: A, sources: '{"items":["a"]}' });
    expect(await storage.sources(B)).toEqual({ revision: B, sources: '{"items":["b"]}' });
    expect(await storage.sources("c".repeat(64))).toBeNull();
    expect((await storage.history(2)).map(move => move.id)).toEqual([3, 2]);
    await expect(storage.activate("c".repeat(64), "acc_admin", 5000)).rejects.toThrow("is not stored");
    await expect(storage.store({ ...write(A, 1), revision: "latest" })).rejects.toThrow("sha256");
    expect(await storage.activeRevision()).toBe(A);
  });

  it("records the base each revision derives from, moves it with the pointer, and keeps each base's sources once", async () => {
    const storage = await open(), next = { version: "0.2.0", revision: B };
    await storage.store(write(A, 1000)); await storage.store(write(B, 2000));
    expect(await storage.activeBase()).toBeNull();
    await storage.activate(A, "seed", 1000);
    expect(await storage.activeBase()).toEqual(marker);
    // The same revision under a new base is a move of its own, audited like one.
    expect(await storage.activate(A, "acc_admin", 1500, undefined, next)).toEqual({ id: 2, revision: A, previous: A, by: "acc_admin", at: 1500, base: next });
    expect([await storage.activeBase(), (await storage.revisionInfo(A))!.base]).toEqual([next, next]);
    expect(await storage.activate(A, "acc_again", 1600, undefined, next)).toMatchObject({ id: 2 });
    // Moving the pointer with no base keeps what the target recorded.
    expect((await storage.activate(B, "acc_admin", 2000)).base).toEqual(marker);
    expect(await storage.storeBase({ revision: B, version: "0.2.0", sources: '{"items":[]}', at: 2000 })).toBe(true);
    expect(await storage.storeBase({ revision: B, version: "0.2.0", sources: '{"items":["changed"]}', at: 3000 })).toBe(false);
    expect([await storage.baseSources(B), await storage.baseSources(A)]).toEqual(['{"items":[]}', null]);
    await expect(storage.storeBase({ revision: A, version: "v1", sources: "{}", at: 1 })).rejects.toThrow("semver");
    await expect(storage.activate(A, "acc_admin", 1, undefined, { version: "1.0", revision: A })).rejects.toThrow("semver");
  });
});

describe("seeding", () => {
  it("seeds an empty store, and afterwards keeps the database's catalog over a different shipped one", async () => {
    const storage = new MemoryCatalogStorage(), logs: Record<string, unknown>[] = [];
    expect(await seedCatalog(storage, base(A, "Shipped first"), event => logs.push(event), { now: () => 1000 })).toBe(A);
    expect(logs).toEqual([{ event: "catalog-seeded", revision: A, baseVersion: "0.1.0" }]);
    expect(await storage.history(10)).toEqual([{ id: 1, revision: A, previous: null, by: "seed", at: 1000, base: marker }]);
    expect(JSON.parse((await storage.baseSources(A))!)).toEqual(base(A, "Shipped first").sources);
    expect(JSON.parse((await storage.sources())!.sources)).toEqual(base(A, "Shipped first").sources);
    expect(JSON.parse((await storage.catalog(A, "client"))!).tables.items).toEqual([{ ...RESOLVED_CATALOG.tables.items[0]!, name: "Shipped first" }]);
    expect((await activeServerCatalog(storage)).tables.items).toEqual([{ ...RESOLVED_CATALOG.tables.items[0]!, name: "Shipped first" }]);

    // A deploy with a newer base: the database wins, and says once that an update is there to take.
    logs.length = 0;
    expect(await seedCatalog(storage, base(B, "Shipped later", "0.2.0"), event => logs.push(event), { now: () => 2000 })).toBe(A);
    expect(logs).toEqual([{ event: "base-update-available", current: marker, bundled: { version: "0.2.0", revision: B },
      message: "This server ships a different base game than its content derives from. Nothing was changed. Open devdocs, Server, Base game to preview the update and apply it, or restart the server with --apply-base-update." }]);
    expect(await storage.activeRevision()).toBe(A);
    expect(await storage.catalog(B, "server")).toBeNull();
    // The same base again is silent.
    logs.length = 0;
    expect(await seedCatalog(storage, base(A, "Shipped first"), event => logs.push(event))).toBe(A);
    expect(logs).toEqual([]);
  });
  it("follows the shipped catalog only when a developer's launcher asks for it", async () => {
    const storage = new MemoryCatalogStorage(), logs: Record<string, unknown>[] = [];
    await seedCatalog(storage, base(A, "First"), () => {}, { now: () => 1000 });
    expect(await seedCatalog(storage, base(B, "Edited in the repo"), event => logs.push(event), { now: () => 2000, follow: true })).toBe(B);
    expect(logs).toEqual([{ event: "catalog-followed", revision: B, previousRevision: A, baseVersion: "0.1.0" }]);
    expect(await storage.history(10)).toEqual([{ id: 2, revision: B, previous: A, by: "follow", at: 2000, base: { version: "0.1.0", revision: B } }, { id: 1, revision: A, previous: null, by: "seed", at: 1000, base: marker }]);
  });
  it("refuses to start a server whose store is active on a catalog this process does not run", async () => {
    const storage = new MemoryCatalogStorage();
    await seedCatalog(storage, base(A, "Another catalog"), () => {});
    await expect(startReferenceServer({ worlds: [world], storage: new SqliteWorldStorage(":memory:"), catalog: storage, build: () => createMultiplayerLabWorld(),
      authentication: { authenticate: async token => ({ playerId: token, name: token }) } })).rejects.toThrow("Install the active catalog before importing the server");
  });
});

function get(port: number, path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((done, fail) => {
    const call = request({ host: "127.0.0.1", port, path, method, headers }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => done({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    call.on("error", fail); call.end();
  });
}

describe("serving the client catalog", () => {
  it("names the revision in /worlds and the join reply, and serves that revision immutably, compressed, to any origin", async () => {
    const storage = new SqliteWorldStorage(":memory:");
    await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: {} }, () => {});
    await storage.catalog.store(write(A, 1, "stored, never active"));
    const server = await startReferenceServer({ worlds: [world], storage, catalog: storage.catalog, build: () => createMultiplayerLabWorld(),
      authentication: { authenticate: async token => ({ playerId: token, name: token }) } });
    cleanups.push(() => server.close());
    const revision = RESOLVED_CATALOG.revision, expected = serializeClientCatalog(clientCatalog(RESOLVED_CATALOG));

    const listed = JSON.parse((await get(server.port, "/worlds")).body.toString()) as WorldDescriptor[];
    expect(listed.map(entry => [entry.worldId, entry.fixture, entry.catalogRevision])).toEqual([["yard", "lab", revision]]);
    expect(listed[0]).not.toHaveProperty("contentVersion");

    const plain = await get(server.port, `/catalog/${revision}`, { Origin: "https://anywhere.example" });
    expect(plain.status).toBe(200);
    expect({ type: plain.headers["content-type"], cache: plain.headers["cache-control"], etag: plain.headers.etag, vary: plain.headers.vary,
      cors: plain.headers["access-control-allow-origin"], encoding: plain.headers["content-encoding"], length: plain.headers["content-length"] })
      .toEqual({ type: "application/json", cache: "public, max-age=31536000, immutable", etag: `"${revision}"`, vary: "Accept-Encoding",
        cors: "*", encoding: undefined, length: String(Buffer.byteLength(expected)) });
    expect(plain.body.toString()).toBe(expected);
    for (const secret of ["lootRolls", "lootTables", "habitats", "groupsByRegion", "aggroRadius", "maxHit", "sourceMap"]) expect(expected.includes(secret), secret).toBe(false);

    const gzip = await get(server.port, `/catalog/${revision}`, { "Accept-Encoding": "gzip, deflate" });
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gzip.body).toString()).toBe(expected);
    const brotli = await get(server.port, `/catalog/${revision}`, { "Accept-Encoding": "gzip, deflate, br" });
    expect(brotli.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(brotli.body).toString()).toBe(expected);
    expect(brotli.body.length).toBeLessThan(expected.length / 5);
    expect((await get(server.port, `/catalog/${revision}`, { "Accept-Encoding": "br;q=0, gzip" })).headers["content-encoding"]).toBe("gzip");
    const head = await get(server.port, `/catalog/${revision}`, {}, "HEAD");
    expect([head.status, head.body.length, head.headers["content-length"]]).toEqual([200, 0, String(Buffer.byteLength(expected))]);
    expect((await get(server.port, `/catalog/${revision}`, { "If-None-Match": `"${revision}"` })).status).toBe(304);

    // Any stored revision is served, so a client a publish behind still loads. Nothing else is.
    expect((await get(server.port, `/catalog/${A}`)).body.toString()).toBe('{"client":"a"}');
    for (const path of [`/catalog/${B}`, "/catalog/latest", `/catalog/${revision.toUpperCase()}`, `/catalog/${revision}/extra`, "/catalog/", `/catalog/..%2f${revision}`]) {
      const missing = await get(server.port, path);
      expect([path, missing.status, missing.headers["cache-control"]]).toEqual([path, 404, "no-store"]);
    }
    expect((await get(server.port, `/catalog/${revision}`, {}, "POST")).status).toBe(405);

    // The session plays on the revision the join reply named, even when discovery saw an older one.
    const selected = { ...world, endpoint: `ws://127.0.0.1:${server.port}/`, catalogRevision: B };
    const provider = new WebSocketProvider("reference", [selected], async () => ({ token: "alice" }));
    const session = await provider.connect(selected, { token: "alice" }); cleanups.push(() => session.close());
    expect(session.catalog).toMatchObject({ revision, url: `http://127.0.0.1:${server.port}/catalog/${revision}` });
    expect((await session.catalog!.load()).tables.items).toEqual(RESOLVED_CATALOG.tables.items);
  });
  it("derives the catalog address from the socket endpoint and refuses a malformed revision", () => {
    expect(catalogUrl("wss://worlds.example.com/", A)).toBe(`https://worlds.example.com/catalog/${A}`);
    expect(catalogUrl("wss://worlds.example.com/realm/", A)).toBe(`https://worlds.example.com/realm/catalog/${A}`);
    expect(catalogUrl("ws://127.0.0.1:4180/", A)).toBe(`http://127.0.0.1:4180/catalog/${A}`);
    expect(() => catalogUrl("wss://worlds.example.com/", "../admin/stats")).toThrow("Invalid catalog revision");
    expect(() => catalogUrl("ws://worlds.example.com/", A)).toThrow();
  });
});

describe("the client's copy of a server catalog", () => {
  const catalog = (revision: string, name: string) => JSON.stringify({ version: 1, revision, tables: { items: [{ id: "sword", name }], recipes: [], resources: [],
    spells: [], shops: [], regions: [], creatures: [], enemies: [] } });
  const source = (revision: string): CatalogAddress => ({ revision, url: `https://worlds.example.com/catalog/${revision}` });
  /** What a socket session hands the overlay: the same address, loaded through this page's fetch and cache. */
  const session = (revision: string, ports: CatalogFetchPorts): SessionCatalog => ({ revision, load: signal => fetchClientCatalog(source(revision), ports, signal) });
  function page(replies: Record<string, () => Response | Promise<Response>>) {
    const held = new Map<string, string>(), fetched: string[] = [];
    const cache = { match: async (url: string) => held.has(url) ? new Response(held.get(url)!) : undefined,
      put: async (url: string, response: Response) => { held.set(url, await response.text()); },
      delete: async (key: string | Request) => held.delete(typeof key === "string" ? key : key.url),
      keys: async () => [...held.keys()].map(url => ({ url }) as Request) };
    return { held, fetched, ports: { caches: { open: async () => cache as unknown as Cache },
      fetch: (async (url: string) => { fetched.push(url); return (replies[url] ?? (() => new Response("", { status: 404 })))(); }) as typeof fetch } };
  }
  function registry(): OverlayRegistry & { names(): string[] } {
    const empty: ContentTables = { items: [{ id: "sword", name: "Build sword" }] as unknown as ContentTables["items"], resources: [], recipes: [], spells: [], enemies: [], shops: [] };
    let tables = empty;
    return { register(next) { tables = { ...tables, ...next }; }, names: () => tables.items.map(item => item.name),
      allItems: () => tables.items, allResources: () => tables.resources, allRecipes: () => tables.recipes, allSpells: () => tables.spells, allEnemies: () => tables.enemies, allShops: () => tables.shops };
  }

  it("fetches a revision once, serves it from the cache after, and drops that server's older revisions", async () => {
    const { held, fetched, ports } = page({ [source(A).url]: () => new Response(catalog(A, "Sword A")), [source(B).url]: () => new Response(catalog(B, "Sword B")) });
    held.set("https://elsewhere.example.com/catalog/" + A, "another server's");
    expect((await fetchClientCatalog(source(A), ports)).tables.items).toEqual([{ id: "sword", name: "Sword A" }]);
    expect((await fetchClientCatalog(source(A), ports)).tables.items).toEqual([{ id: "sword", name: "Sword A" }]);
    expect(fetched).toEqual([source(A).url]);
    await fetchClientCatalog(source(B), ports);
    expect([...held.keys()]).toEqual(["https://elsewhere.example.com/catalog/" + A, source(B).url]);
  });
  it("refuses and never caches a reply that is missing, another revision, or not a catalog", async () => {
    const { held, ports } = page({ [source(A).url]: () => new Response(catalog(B, "Wrong revision")), [source(B).url]: () => new Response("<html>") });
    await expect(fetchClientCatalog(source(A), ports)).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    await expect(fetchClientCatalog(source(B), ports)).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    await expect(fetchClientCatalog(source("c".repeat(64)), ports)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(held.size).toBe(0);
  });
  it("shows the server's names while connected, the build's after leaving, and drops a fetch the player left behind", async () => {
    let release: ((response: Response) => void) | undefined;
    const { ports } = page({ [source(A).url]: () => new Response(catalog(A, "Server sword")), [source(B).url]: () => new Promise<Response>(resolve => { release = resolve; }) });
    const held = registry(), failures: unknown[] = [];
    const overlay = createServerCatalogOverlay(held, { failed: error => failures.push(error) });
    await overlay.enter(session(A, ports));
    expect([overlay.revision, held.names()]).toEqual([A, ["Server sword"]]);
    overlay.leave();
    expect([overlay.revision, held.names()]).toEqual([null, ["Build sword"]]);

    const slow = overlay.enter(session(B, ports));
    await expect.poll(() => release !== undefined, { interval: 1 }).toBe(true);
    overlay.leave(); release!(new Response(catalog(B, "Too late"))); await slow;
    expect([overlay.revision, held.names()]).toEqual([null, ["Build sword"]]);

    await overlay.enter(session("c".repeat(64), ports));
    expect([overlay.revision, held.names(), failures.length]).toEqual([null, ["Build sword"], 1]);
    // Whatever carries the catalog, the overlay only applies the revision the session joined.
    await overlay.enter({ revision: A, load: async () => JSON.parse(catalog(B, "Another revision")) });
    expect([overlay.revision, held.names(), failures.length]).toEqual([null, ["Build sword"], 2]);
  });
});

describe("saves and catalog revisions", () => {
  it("records the revision a save was written under, loads it under another, and still refuses another fixture or seed", async () => {
    const ports = await createMultiplayerLabWorld();
    const first = new HeadlessWorld({ ...world, catalogRevision: A }, ports);
    first.join("alice"); first.tick();
    const saved = first.snapshot({}, false);
    expect([saved.fixture, saved.catalogRevision, saved.seed]).toEqual(["lab", A, 1337]);
    expect(saved).not.toHaveProperty("contentVersion");

    const later = new HeadlessWorld({ ...world, catalogRevision: B }, await createMultiplayerLabWorld(), structuredClone(saved));
    expect(later.clock.tick).toBe(saved.tick);
    expect(later.snapshot({}, false).catalogRevision).toBe(B);
    expect(() => new HeadlessWorld({ ...world, fixture: "authored", catalogRevision: A }, ports, structuredClone(saved))).toThrow("Stored world fixture or seed does not match configuration");
    expect(() => new HeadlessWorld({ ...world, seed: 7, catalogRevision: A }, ports, structuredClone(saved))).toThrow("Stored world fixture or seed does not match configuration");
  });
  it("gives a saved creature the model the running catalog builds it with, and keeps its saved state", async () => {
    const first = new HeadlessWorld({ ...world, catalogRevision: A }, await createMultiplayerLabWorld());
    first.entities.get("multiplayer:frog")!.combat!.health = 1;
    const saved = structuredClone(first.snapshot({}, false));
    expect(saved.entities.find(entity => entity.id === "multiplayer:frog")!.view).toMatchObject({ assetId: "animal_frog", scale: 2.2 });
    // An admin gave the frog another model. The world is rebuilt from that catalog on the next start.
    const ports = await createMultiplayerLabWorld();
    Object.assign(ports.entities.find(entity => entity.id === "multiplayer:frog")!.view!, { assetId: "creature_redbrush_fox", scale: 1.5 });
    const restored = new HeadlessWorld({ ...world, catalogRevision: B }, ports, saved).entities.get("multiplayer:frog")!;
    expect(restored.view).toMatchObject({ assetId: "creature_redbrush_fox", scale: 1.5 });
    expect(restored.combat!.health).toBe(1);
    expect(restored.view!.rotationY).toBe(saved.entities.find(entity => entity.id === "multiplayer:frog")!.view!.rotationY);
  });
  it("migrates a format 2 database: contentVersion becomes the fixture, and the revision is unknown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "corealm-catalog-")), file = join(directory, "worlds.sqlite");
    cleanups.push(async () => {
      if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("corealm-catalog-")) throw new Error("Unsafe test cleanup path");
      await rm(directory, { recursive: true, force: true });
    });
    const key = (worldId: string) => JSON.stringify(["reference", worldId]);
    const payload = (worldId: string, contentVersion: string) => JSON.stringify({ parties: [], schemaVersion: 1, key: { providerId: "reference", worldId }, contentVersion,
      seed: 1337, tick: 42, world: { nodes: {}, enemies: {}, lootPiles: {} }, entities: [], receipts: {}, players: {} });
    // A database exactly as format 2 left it: the world tables, schema_version 2, no catalog tables.
    const current = new SqliteWorldStorage(file, { log: () => {} });
    current.database.exec("DROP TABLE catalog_history; DROP TABLE catalog_active; DROP TABLE catalogs; UPDATE meta SET value='2' WHERE key='schema_version'");
    const put = current.database.prepare("INSERT INTO worlds (world_key,payload) VALUES (?,?)");
    put.run(key("corealm"), payload("corealm", "corealm-pve-1")); put.run(key("yard"), payload("yard", "corealm-pve-1:lab"));
    await current.close();

    const lines: string[] = [];
    let storage = new SqliteWorldStorage(file, { log: line => lines.push(line) });
    cleanups.push(() => storage.close());
    expect(lines.map(line => JSON.parse(line))).toEqual([{ event: "storage-migrated", from: 2, to: 3, worlds: 2 }]);
    const rows = () => storage.database.prepare(`SELECT world_key, json_extract(payload,'$.fixture') AS fixture, json_type(payload,'$.catalogRevision') AS revision,
      json_type(payload,'$.contentVersion') AS legacy, json_extract(payload,'$.tick') AS tick FROM worlds ORDER BY world_key`).all().map(row => ({ ...row }));
    const migrated = [{ world_key: key("corealm"), fixture: "authored", revision: "null", legacy: null, tick: 42 }, { world_key: key("yard"), fixture: "lab", revision: "null", legacy: null, tick: 42 }];
    expect(rows()).toEqual(migrated);
    expect({ ...storage.database.prepare("SELECT value FROM meta WHERE key='schema_version'").get() }).toEqual({ value: "4" });
    expect(await storage.catalog.activeRevision()).toBeNull();

    // The migrated lab save loads into a lab world running any catalog, and not into the authored fixture.
    const saved = (await storage.openWorld({ providerId: "reference", worldId: "yard" }))!;
    expect([saved.fixture, saved.catalogRevision, saved.tick]).toEqual(["lab", null, 42]);
    expect(new HeadlessWorld({ ...world, catalogRevision: B }, await createMultiplayerLabWorld(), saved).clock.tick).toBe(42);
    const authored = (await storage.openWorld({ providerId: "reference", worldId: "corealm" }))!;
    expect(() => new HeadlessWorld({ ...world, worldId: "corealm", catalogRevision: B }, { nav: null as never, entities: [], spawn: [0, 0, 0] } as never, authored)).toThrow("Stored world fixture or seed");

    // Reopening does nothing.
    await storage.close(); lines.length = 0;
    storage = new SqliteWorldStorage(file, { log: line => lines.push(line) });
    expect(lines).toEqual([]);
    expect(rows()).toEqual(migrated);
  });
});
