import { afterEach, describe, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { contentRevision } from "../game/src/content/compiler/revision.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { catalogEntities, createMetaRoute } from "../game/src/multiplayer/adminMeta.js";
import { seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
const EMPTY = contentRevision("{}\n");
const SOURCES = {
  equipmentSets: [{ id: "iron-set", members: { head: "iron-helm", body: "iron-plate" } }],
  npcs: [{ id: "smith" }],
  items: [{ id: "iron-helm" }],
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve() {
  const clock = { ms: Date.parse("2026-09-27T12:00:00.000Z") };
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const storage = new SqliteWorldStorage(":memory:", { log: () => {} });
  await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources: SOURCES }, () => {}, { now: () => clock.ms });
  const logs: Record<string, unknown>[] = [];
  const server = await startReferenceServer({
    worlds: [{ providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/", protocolVersion: WORLD_PROTOCOL_VERSION,
      fixture: "authored", seed: 1, population: 0, capacity: 4, availability: "available" } satisfies WorldDescriptor],
    storage, admin: storage.admin, catalog: storage.catalog, build: () => createMultiplayerLabWorld(), now: () => clock.ms, log: event => logs.push(event),
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/",
      fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch, now: () => clock.ms }),
    adminRoutes: [createMetaRoute({ storage: storage.admin, entity: catalogEntities(storage.catalog) })],
  });
  cleanups.push(() => server.close());
  const endpoint = `ws://127.0.0.1:${server.port}/`;
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  };
  const code = logs.find(line => line.event === "owner-setup-code")?.code as string;
  const token = signJoinToken(created.signing, joinTokenClaims({ accountId: OWNER, name: "Owner", endpoint, issuedAt: clock.ms / 1000 }));
  const owner = (await call("/admin/setup", { method: "POST", body: { token, code } })).body.session as string;
  const scoped = async (scopes: string[]) => (await call("/admin/tokens", { method: "POST", token: owner, body: { label: scopes.join(" "), scopes } })).body.token as string;
  return { call, owner, scoped, storage, clock };
}

describe("authoring metadata on a live server", () => {
  it("reads an empty record, adds a note under the admin's account, and answers a stale revision with 409", async () => {
    const { call, owner, clock } = await serve();
    const empty = await call("/admin/meta/npcs/smith", { token: owner });
    expect(empty).toEqual({ status: 200, body: { collection: "npcs", entityId: "smith", revision: EMPTY,
      data: { status: "draft", notes: [], candidates: [], history: [], sourceRefs: [] } } });

    const noted = await call("/admin/meta/npcs/smith", { method: "PATCH", token: owner,
      body: { revision: EMPTY, operation: { kind: "note", text: "Voice lines read flat.", label: "audio" } } });
    expect(noted.status).toBe(200);
    const at = new Date(clock.ms).toISOString();
    expect(noted.body.data.notes).toEqual([{ at, by: OWNER, text: "Voice lines read flat.", label: "audio" }]);
    expect(noted.body.data.history).toEqual([{ at, by: OWNER, action: "note.add" }]);
    expect(noted.body.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(noted.body.revision).not.toBe(EMPTY);
    expect((await call("/admin/meta/npcs/smith", { token: owner })).body).toEqual(noted.body);

    const stale = await call("/admin/meta/npcs/smith", { method: "PATCH", token: owner, body: { revision: EMPTY, operation: { kind: "status", status: "candidate" } } });
    expect(stale).toEqual({ status: 409, body: { error: { code: "stale_meta", message: "Metadata changed since it was read. Reload before saving.", revision: noted.body.revision } } });

    const audit = await call("/admin/audit?action=meta.", { token: owner });
    expect(audit.body.entries.map((entry: any) => [entry.action, entry.target, entry.accountId])).toEqual([["meta.note", "npcs/smith", OWNER]]);
  });

  it("digests a collection with open requests and art verdicts, and queues requests across collections", async () => {
    const { call, owner } = await serve();
    const opened = await call("/admin/meta/items/iron-helm", { method: "PATCH", token: owner,
      body: { revision: EMPTY, operation: { kind: "request.open", requestId: "helm-icon", requestKind: "art", text: "Icon reads as a bucket." } } });
    expect(opened.status).toBe(200);
    const reviewed = await call("/admin/meta/items/iron-helm", { method: "PATCH", token: owner,
      body: { revision: opened.body.revision, operation: { kind: "art", key: "body:female", verdict: "polish" } } });
    const verdict = await call("/admin/meta/items/iron-helm", { method: "PATCH", token: owner,
      body: { revision: reviewed.body.revision, operation: { kind: "art", verdict: "approved" } } });
    expect(verdict.status).toBe(200);

    const digest = await call("/admin/meta/items/$all", { token: owner });
    expect(digest.body).toEqual({ collection: "items", revision: verdict.body.revision, records: {
      "iron-helm": { status: "draft", openRequests: 1, notes: 1, candidates: 0, art: "approved", artChecks: { "body:female": "polish" } } } });

    const queue = await call("/admin/meta/requests", { token: owner });
    expect(queue.status).toBe(200);
    expect(queue.body.revisions).toEqual({ items: verdict.body.revision });
    expect(queue.body.requests.map((entry: any) => [entry.collection, entry.entityId, entry.request.id, entry.request.state, entry.note.text]))
      .toEqual([["items", "iron-helm", "helm-icon", "open", "Icon reads as a bucket."]]);

    const closed = await call("/admin/meta/items/iron-helm", { method: "PATCH", token: owner,
      body: { revision: verdict.body.revision, operation: { kind: "request.close", requestId: "helm-icon" } } });
    expect(closed.body.data.notes[0].request.state).toBe("closed");
    expect((await call("/admin/meta/requests", { token: owner })).body.requests).toEqual([]);
  });

  it("notes set pieces only on members, keeps generated item ids, and refuses unknown records and collections", async () => {
    const { call, owner } = await serve();
    const piece = await call("/admin/meta/equipmentSets/iron-set", { method: "PATCH", token: owner,
      body: { revision: EMPTY, operation: { kind: "piece", slot: "head", note: "Visor clips the nose." } } });
    expect(piece.body.data.pieces).toEqual({ head: { note: "Visor clips the nose." } });
    const notMember = await call("/admin/meta/equipmentSets/iron-set", { method: "PATCH", token: owner,
      body: { revision: piece.body.revision, operation: { kind: "piece", slot: "feet", note: "No boots." } } });
    expect(notMember).toEqual({ status: 400, body: { error: { code: "invalid_request", message: "Piece is not a member of this set" } } });

    // Items generated from progression are not in the sources, and still take notes.
    expect((await call("/admin/meta/items/generated-mithril-helm", { token: owner })).status).toBe(200);
    expect(await call("/admin/meta/npcs/nobody", { token: owner })).toEqual({ status: 404, body: { error: { code: "not_found", message: "Unknown entity" } } });
    expect((await call("/admin/meta/nonsense/x", { token: owner })).body.error.message).toBe("Unknown collection");
    const invalid = await call("/admin/meta/npcs/smith", { method: "PATCH", token: owner, body: { revision: EMPTY, operation: { kind: "note", text: "  " } } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_request");
    expect(invalid.body.error.diagnostics.length).toBeGreaterThan(0);
  });

  it("reads with content:read, writes only with content:publish, and refuses anonymous callers", async () => {
    const { call, scoped } = await serve();
    const reader = await scoped(["content:read"]);
    const publisher = await scoped(["content:publish"]);
    expect((await call("/admin/meta/npcs/smith")).status).toBe(401);
    expect((await call("/admin/meta/requests")).status).toBe(401);
    expect((await call("/admin/meta/npcs/smith", { token: reader })).status).toBe(200);
    expect((await call("/admin/meta/requests", { token: reader })).status).toBe(200);
    const refused = await call("/admin/meta/npcs/smith", { method: "PATCH", token: reader, body: { revision: EMPTY, operation: { kind: "note", text: "Hi" } } });
    expect(refused).toEqual({ status: 403, body: { error: { code: "forbidden", message: "This credential is missing the content:publish scope" } } });
    expect((await call("/admin/meta/npcs/smith", { token: publisher })).status).toBe(403);
    const written = await call("/admin/meta/npcs/smith", { method: "PATCH", token: publisher, body: { revision: EMPTY, operation: { kind: "note", text: "Hi" } } });
    expect(written.status).toBe(200);
    expect(written.body.data.notes[0].by).toBe(OWNER);
  });

  it("stores a balance collection's canonical text and revision in the database", async () => {
    const { call, owner, storage } = await serve();
    const noted = await call("/admin/meta/balance/sets/$collection", { method: "PATCH", token: owner,
      body: { revision: EMPTY, operation: { kind: "status", status: "candidate" } } });
    expect(noted.status).toBe(200);
    expect(noted.body.collection).toBe("balance/sets");
    expect(await storage.admin.authoringMetaAll()).toEqual([{ collection: "balance/sets", revision: noted.body.revision,
      records: `${JSON.stringify({ $collection: noted.body.data }, null, 2)}\n` }]);
  });
});
