import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { adoptCatalog } from "../game/src/content/resolvedCatalog.js";
import { setBackend } from "../devdocs/src/api/backend.js";
import { publishNote, setPublishNote } from "../devdocs/src/api/publishNote.js";
import { createServerBackend } from "../devdocs/src/api/serverBackend.js";
import type { AdminSession } from "../devdocs/src/api/session.js";
import { onGameCatalog } from "../devdocs/src/model/liveCatalog.js";
import { gameFileUrl, setContentFiles } from "../devdocs/src/viewer/registry.js";

/*
  Live authoring in server mode: the page adopts the server's compiled catalog on every read and
  after every publish, the feature routes are probed rather than assumed, and metadata, files and
  image jobs go to the routes a live server documents for them.
*/

// The fake catalogs carry two tables; record the adoption instead of replacing this process's catalog.
vi.mock("../game/src/content/resolvedCatalog.js", async importOriginal => ({ ...await importOriginal<object>(), adoptCatalog: vi.fn() }));
vi.mock("../game/src/content/creatureRuntime.js", async importOriginal => ({ ...await importOriginal<object>(), reindexCreatures: vi.fn() }));

const SESSION: AdminSession = { server: "https://play.test", audience: "https://play.test", token: "cas_secret", expiresAt: Date.now() + 3_600_000, accountId: "acc_rook", name: "Rook", role: "owner" };
const DESCRIPTOR = { name: "Fallowmarch", endpoint: "wss://play.test/", assetBaseUrl: "https://cdn.test/pack/", identityUrl: null, catalogRevision: "a".repeat(64) };
const FIRST = "a".repeat(64), SECOND = "b".repeat(64);
const SOURCES = { items: [{ id: "worn_sword", name: "Worn Shortsword" }] };
const PUBLISHED = { items: [{ id: "worn_sword", name: "Chipped Shortsword" }] };

interface Call { url: string; method: string; body: unknown }
type Route = { status: number; body: unknown } | { status: number; html: string };

/** A game server whose active revision moves when it publishes. `features` adds the optional routes. */
function fakeServer(features: Record<string, Route> = {}) {
  const calls: Call[] = [];
  let active = FIRST;
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input), route = url.replace(SESSION.server, "");
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined;
    const method = init.method ?? "GET";
    calls.push({ url, method, body });
    const sources = active === FIRST ? SOURCES : PUBLISHED;
    if (route === "/admin/content/sources") return reply(200, { revision: active, revisions: { items: collectionRevision(sources.items) }, sources });
    if (route === `/admin/content/catalog/${active}`) return reply(200, { version: 1, revision: active, formulaRevision: "f".repeat(64), tables: { items: sources.items } });
    if (route === "/admin/content/publish" && method === "POST") { active = SECOND; return reply(200, { revision: SECOND, previous: FIRST, revisions: { items: collectionRevision(PUBLISHED.items) }, live: ["items"], onRestart: [], affected: { items: ["worn_sword"] }, spawns: [], notified: 0 }); }
    if (route === "/admin/content/validate") return reply(200, { revision: FIRST, problems: [] });
    const feature = features[`${method} ${route}`] ?? features[route];
    if (feature) return "html" in feature ? html(feature.status, feature.html) : reply(feature.status, feature.body);
    return reply(404, { error: { code: "not_found", message: "No such admin endpoint" } });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}
function reply(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}
/** What an older server sends for a path outside its API: the devdocs build's page. */
function html(status: number, text: string): Response {
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text } as unknown as Response;
}

const FEATURES: Record<string, Route> = {
  "/admin/meta/items/$all": { status: 200, body: { collection: "items", revision: "r1", records: {} } },
  "GET /admin/files": { status: 200, body: { revision: "i1", files: { "assets/skins/animal_deer/frost/coat.png": { sha256: "1".repeat(64), bytes: 10, type: "image/png", at: "2026-09-27T00:00:00Z" } } } },
  "/admin/imagegen": { status: 200, body: { jobs: [] } },
};
const edit = { operation: "save" as const, revisions: { items: collectionRevision(SOURCES.items) }, changes: [{ kind: "put" as const, collection: "items", id: "worn_sword", record: PUBLISHED.items[0] }] };

beforeEach(() => { vi.mocked(adoptCatalog).mockClear(); setPublishNote(""); setContentFiles("", {}); });
afterEach(() => { setPublishNote(""); });

describe("the live catalog", () => {
  it("adopts the active catalog on the first read and the published one before a save returns", async () => {
    const server = fakeServer();
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    setBackend(backend);
    let heard = 0;
    const stop = onGameCatalog(() => { heard += 1; });

    await backend.collections();
    expect(vi.mocked(adoptCatalog).mock.calls.map(([catalog]) => [catalog.revision, catalog.tables.items])).toEqual([[FIRST, SOURCES.items]]);

    const saved = await backend.transact(edit);
    expect(saved.ok).toBe(true);
    expect(vi.mocked(adoptCatalog).mock.calls.map(([catalog]) => catalog.revision)).toEqual([FIRST, SECOND]);
    expect(vi.mocked(adoptCatalog).mock.calls[1]![0]).toEqual({ version: 1, revision: SECOND, formulaRevision: "f".repeat(64), tables: { items: PUBLISHED.items } });
    expect(heard).toBe(2);
    // The next read is the snapshot the adoption already took.
    expect((await backend.collection("items")).data).toEqual(PUBLISHED.items);
    expect(server.calls.filter(call => call.url.endsWith("/admin/content/sources"))).toHaveLength(2);
    stop();
  });

  it("adopts again after a rollback", async () => {
    const server = fakeServer({ "POST /admin/content/rollback": { status: 200, body: { revision: FIRST } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    await backend.collections();
    await backend.admin("/admin/content/rollback", { method: "POST", body: { revision: FIRST } });
    expect(vi.mocked(adoptCatalog)).toHaveBeenCalledTimes(2);
  });
});

describe("publish notes", () => {
  it("sends the note with a publish, never with a dry run, and clears it after", async () => {
    const server = fakeServer();
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    setPublishNote("  Chip the starter sword  ");
    await backend.transact({ ...edit, operation: "preview" });
    expect((server.calls.find(call => call.url.endsWith("/admin/content/validate"))?.body as Record<string, unknown>).note).toBeUndefined();
    await backend.transact(edit);
    expect((server.calls.find(call => call.url.endsWith("/admin/content/publish"))?.body as Record<string, unknown>).note).toBe("Chip the starter sword");
    expect(publishNote()).toBe("");
  });

  it("sends no note field when the author wrote none", async () => {
    const server = fakeServer();
    await createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch }).transact(edit);
    expect(Object.keys(server.calls.find(call => call.url.endsWith("/admin/content/publish"))?.body as object).sort()).toEqual(["base", "collections"]);
  });
});

describe("feature routes", () => {
  it("offers metadata, the request queue, files and image jobs when the server answers their routes", async () => {
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer(FEATURES).fetch });
    expect(backend.capabilities.files).toBe(false);
    await backend.collections();
    expect(backend.capabilities).toMatchObject({ meta: true, requests: true, files: true, imagegen: true, git: false, bulk: true, assets: false, publish: true });
  });

  it("offers none of them when an older server answers with its page or a 404", async () => {
    const page = "<!doctype html><title>Corealm admin</title>";
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer({
      "/admin/meta/items/$all": { status: 200, html: page }, "GET /admin/files": { status: 200, html: page },
      // Right status, wrong shape: not the route this editor speaks.
      "/admin/imagegen": { status: 200, body: { status: "ok" } },
    }).fetch });
    await backend.collections();
    expect(backend.capabilities).toMatchObject({ meta: false, requests: false, files: false, imagegen: false });
    await expect(backend.patchMeta("items", "worn_sword", { revision: "r", operation: { kind: "status", status: "draft" } })).rejects.toThrow("not available on a live server");
    await expect(backend.putFiles({ "assets/skins/a/b/c.png": "AA==" })).rejects.toThrow("not available on a live server");
    await expect(backend.imagegen.start({ assetId: "a", name: "b", prompt: "c", references: {} })).rejects.toThrow("not available on a live server");
    expect(await backend.imagegen.list()).toEqual([]);
  });

  it("reads and writes authoring metadata under /admin/meta", async () => {
    const server = fakeServer({
      ...FEATURES,
      "PATCH /admin/meta/items/worn_sword": { status: 200, body: { collection: "items", entityId: "worn_sword", revision: "r2", data: { status: "draft", notes: [] } } },
      "/admin/meta/balance/recipes/%24collection": { status: 200, body: { collection: "balance/recipes", entityId: "$collection", revision: "r3", data: {} } },
      "/admin/meta/requests": { status: 200, body: { requests: [] } },
    });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    const patch = { revision: "r1", operation: { kind: "status" as const, status: "draft" as const } };
    expect((await backend.patchMeta("items", "worn_sword", patch)).revision).toBe("r2");
    expect(server.calls.find(call => call.method === "PATCH")).toMatchObject({ url: `${SESSION.server}/admin/meta/items/worn_sword`, body: patch });
    expect(await backend.get("meta/balance/recipes/$collection")).toMatchObject({ revision: "r3" });
    expect(await backend.get("requests")).toEqual({ requests: [] });
  });

  it("stores files in the server's store and serves them from it", async () => {
    const stored = { sha256: "2".repeat(64), bytes: 4, type: "image/png", at: "2026-09-27T00:00:00Z" };
    const server = fakeServer({ ...FEATURES, "POST /admin/files": { status: 200, body: { revision: "i2", files: { ...(FEATURES["GET /admin/files"] as { body: { files: object } }).body.files, "assets/skins/animal_deer/ice/coat.png": stored } } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    setBackend(backend);
    const result = await backend.putFiles({ "assets/skins/animal_deer/ice/coat.png": "iVBORw==" });
    expect(result).toEqual({ files: { "assets/skins/animal_deer/ice/coat.png": { sha256: stored.sha256, bytes: 4 } } });
    expect(server.calls.find(call => call.method === "POST" && call.url.endsWith("/admin/files"))?.body).toEqual({ files: { "assets/skins/animal_deer/ice/coat.png": "iVBORw==" } });
    // A stored path loads from the server, versioned by its hash; anything else from the asset base.
    expect(gameFileUrl("assets/skins/animal_deer/ice/coat.png")).toBe(`${SESSION.server}/content-assets/assets/skins/animal_deer/ice/coat.png?v=222222222222`);
    expect(gameFileUrl("assets/skins/animal_deer/frost/coat.png")).toBe(`${SESSION.server}/content-assets/assets/skins/animal_deer/frost/coat.png?v=111111111111`);
    expect(gameFileUrl("assets/models/deer.glb")).toBe("https://cdn.test/pack/assets/models/deer.glb");
  });

  it("refuses a store that did not keep a file it was sent", async () => {
    const server = fakeServer({ ...FEATURES, "POST /admin/files": { status: 200, body: { revision: "i2", files: {} } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    await expect(backend.putFiles({ "assets/skins/a/b/c.png": "AA==" })).rejects.toThrow("did not store assets/skins/a/b/c.png");
  });

  it("runs image jobs through /admin/imagegen when the server has it", async () => {
    const job = { id: "job1", assetId: "animal_deer", name: "Frost", prompt: "frost", materials: ["coat"], status: "queued", createdAt: "2026-09-27T00:00:00Z" };
    const server = fakeServer({ ...FEATURES, "POST /admin/imagegen": { status: 200, body: { job } }, "POST /admin/imagegen/job1": { status: 200, body: { job: { ...job, status: "running" } } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    expect(await backend.imagegen.start({ assetId: "animal_deer", name: "Frost", prompt: "frost", references: {} })).toEqual(job);
    expect((await backend.imagegen.retry("job1")).status).toBe("running");
    expect(await backend.imagegen.list()).toEqual([]);
  });
});
