import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectionRevision } from "../game/src/content/compiler/revision.js";
import { API_SCOPES as SERVER_SCOPES } from "../game/src/multiplayer/adminStorage.js";
import { API_SCOPES as EDITOR_SCOPES, SCOPE_HELP } from "../devdocs/src/api/adminData.js";
import { can, describeBlocker, setBackend, type PublishBlocker } from "../devdocs/src/api/backend.js";
import { createRepoBackend } from "../devdocs/src/api/repoBackend.js";
import { createServerBackend } from "../devdocs/src/api/serverBackend.js";
import { audienceOf, chooseIdentity, exchangeSession, normalizeServerUrl, readDescriptor, AdminFailure, type AdminSession } from "../devdocs/src/api/session.js";

/*
  Server mode against a fake game server: the exact requests it sends, the auth header it carries,
  and every refusal the admin API documents mapped onto a state the editor already has. The error
  codes are literal on purpose — they are the contract with `game/src/multiplayer/contentPublish.ts`.
*/

const SESSION: AdminSession = {
  server: "https://play.test", audience: "https://play.test", token: "cas_secret",
  expiresAt: Date.now() + 3_600_000, accountId: "acc_rook", name: "Rook", role: "owner",
};
const DESCRIPTOR = { name: "Fallowmarch", endpoint: "wss://play.test/", assetBaseUrl: "https://cdn.test/pack/", identityUrl: "https://id.test", catalogRevision: "a".repeat(64) };
const REVISION = "a".repeat(64);
const NEXT_REVISION = "b".repeat(64);

const sources = {
  lootTables: [{ id: "redsill", rolls: [] }],
  items: [{ id: "worn_sword", name: "Worn Shortsword" }],
};
/** What `GET /admin/content/sources` reports beside the sources: the revision a publish checks each one against. */
const REVISIONS = Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, collectionRevision(value)]));

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

function fakeServer(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const calls: Call[] = [];
  const answer = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", headers, body });
    const route = url.replace(SESSION.server, "");
    const override = overrides[route];
    if (override) return response(override.status, override.body);
    if (route === "/admin/content/sources") return response(200, { revision: REVISION, revisions: REVISIONS, sources });
    if (route === `/admin/content/catalog/${REVISION}`) return response(200, { revision: REVISION, tables: { items: [{ id: "worn_sword", attack: 3 }], enemies: [] } });
    if (url === "https://cdn.test/pack/assets/manifest.json") return response(200, { assets: [{ id: "sword_model" }] });
    return response(404, { error: { code: "not_found", message: "No such admin endpoint" } });
  };
  return { calls, fetch: answer as unknown as typeof globalThis.fetch };
}
function response(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 300, status, json: async () => body, text: async () => text } as unknown as Response;
}

describe("the admin surfaces beyond content", () => {
  it("offers exactly the scopes the server has, each with a line saying what it allows", () => {
    // The editor declares them itself: `adminStorage.ts` reaches for `node:crypto` and cannot be in
    // a browser bundle. This is what stops the two lists from drifting apart.
    expect([...EDITOR_SCOPES]).toEqual([...SERVER_SCOPES]);
    expect(Object.keys(SCOPE_HELP).sort()).toEqual([...SERVER_SCOPES].sort());
    for (const scope of EDITOR_SCOPES) expect(SCOPE_HELP[scope].endsWith(".")).toBe(true);
  });
});

describe("reads", () => {
  it("takes the collection revisions from the server rather than hashing anything", async () => {
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer().fetch });
    expect((await backend.collection("lootTables")).revision).toBe(REVISIONS.lootTables);
    // `tests/multiplayer-publish.test.ts` is the other half: a real server's reported revisions are
    // what its publish endpoint accepts. Here it only has to arrive unchanged.
  });

  it("refuses a server that sends sources without their revisions", async () => {
    const server = fakeServer({ "/admin/content/sources": { status: 200, body: { revision: REVISION, sources } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    await expect(backend.collections()).rejects.toThrow("without their revisions");
  });

  it("lists source collections, the compiled tables and the asset manifest", async () => {
    const server = fakeServer();
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    const collections = await backend.collections();
    expect(collections.map(row => row.name)).toEqual(["items", "lootTables", "compiled-items", "compiled-enemies", "assets"]);
    expect(collections.find(row => row.name === "lootTables")).toMatchObject({ editable: true, count: 1, shape: "array", idKey: "id" });
    expect(collections.find(row => row.name === "compiled-items")?.editable).toBe(false);

    const loot = await backend.collection("lootTables");
    expect(loot.data).toEqual(sources.lootTables);
    expect(loot.revision).toBe(REVISIONS.lootTables);
    expect((await backend.collection("compiled-items")).data).toEqual([{ id: "worn_sword", attack: 3 }]);
  });

  it("presents the session as a bearer token on every admin request", async () => {
    const server = fakeServer();
    await createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch }).collections();
    const admin = server.calls.filter(call => call.url.startsWith(SESSION.server));
    expect(admin.map(call => call.url)).toEqual([`${SESSION.server}/admin/content/sources`, `${SESSION.server}/admin/content/catalog/${REVISION}`]);
    for (const call of admin) expect(call.headers.Authorization).toBe("Bearer cas_secret");
    // The asset manifest is a public file on another host and must not carry the admin session.
    expect(server.calls.find(call => call.url.startsWith("https://cdn.test"))?.headers.Authorization).toBeUndefined();
  });

  it("reads once and again after a publish moves the revision", async () => {
    const server = fakeServer({ "/admin/content/publish": { status: 200, body: { revision: NEXT_REVISION, previous: REVISION, live: [], onRestart: [], affected: {}, problems: [], spawns: [], notified: 0 } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    await backend.collections();
    await backend.collection("items");
    expect(server.calls.filter(call => call.url.endsWith("/admin/content/sources"))).toHaveLength(1);
    await backend.transact({ operation: "save", revisions: { items: REVISIONS.items! }, changes: [{ kind: "put", collection: "items", id: "worn_sword", record: { id: "worn_sword", name: "Chipped Shortsword" } }] });
    await backend.collection("items");
    expect(server.calls.filter(call => call.url.endsWith("/admin/content/sources"))).toHaveLength(2);
  });
});

describe("writes", () => {
  const edit = { kind: "put", collection: "lootTables", id: "redsill", record: { id: "redsill", rolls: [{ itemId: "worn_sword" }] } } as const;
  const sent = { lootTables: REVISIONS.lootTables! };

  it("sends a dry run to validate and a save to publish, as whole collections", async () => {
    const publishedRevision = collectionRevision([edit.record]);
    const result = { revision: NEXT_REVISION, previous: REVISION, unchanged: false, stored: true, revisions: { lootTables: publishedRevision }, live: ["lootTables"], onRestart: [], affected: { lootTables: ["redsill"], enemies: ["redsill_frog"] }, problems: [{ path: "lootTables[redsill]", message: "warm", severity: "warning" }], spawns: [{ world: "corealm", added: 0, pending: 7, retiring: 0, removed: 0 }], notified: 12 };
    const server = fakeServer({ "/admin/content/validate": { status: 200, body: { ...result, stored: false, revisions: {}, spawns: [] } }, "/admin/content/publish": { status: 200, body: result } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });

    const preview = await backend.transact({ operation: "preview", revisions: sent, changes: [edit] });
    const validate = server.calls.find(call => call.url.endsWith("/admin/content/validate"))!;
    expect(validate.method).toBe("POST");
    expect(validate.body).toEqual({ base: REVISION, collections: { lootTables: { revision: sent.lootTables, value: [edit.record] } } });
    expect(preview.ok).toBe(true);
    // A dry run stores nothing, so the collection is still at the revision it was read at.
    if (preview.ok) expect(preview.body.revisions).toEqual({ ...REVISIONS });
    // Only the collection that changed is sent; the sources run to megabytes.
    expect(Object.keys((validate.body as { collections: object }).collections)).toEqual(["lootTables"]);

    const saved = await backend.transact({ operation: "save", revisions: sent, changes: [edit] });
    expect(server.calls.some(call => call.url.endsWith("/admin/content/publish"))).toBe(true);
    if (!saved.ok) throw new Error("expected the publish to succeed");
    expect(saved.body.revision).toBe(NEXT_REVISION);
    expect(saved.body.affected).toEqual([{ collection: "lootTables", id: "redsill" }, { collection: "enemies", id: "redsill_frog" }]);
    expect(saved.body.diagnostics).toEqual([{ path: "lootTables[redsill]", message: "warm", severity: "warning" }]);
    expect(saved.body.publish).toMatchObject({ revision: NEXT_REVISION, previous: REVISION, live: ["lootTables"], onRestart: [], notified: 12 });
    expect(saved.body.publish?.spawns).toEqual([{ world: "corealm", added: 0, pending: 7, retiring: 0, removed: 0 }]);
    expect(saved.body.collections[0]?.revision).toBe(publishedRevision);
    expect(saved.body.revisions).toEqual({ ...REVISIONS, lootTables: publishedRevision });
  });

  it("carries a rename through every collection before sending it", async () => {
    const server = fakeServer({ "/admin/content/validate": { status: 200, body: { revision: NEXT_REVISION, previous: REVISION, live: [], onRestart: [], affected: {}, problems: [], spawns: [], notified: 0 } } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    await backend.transact({ operation: "preview", revisions: { items: REVISIONS.items! }, changes: [{ kind: "rename", collection: "items", id: "worn_sword", nextId: "chipped_sword" }] });
    const body = server.calls.find(call => call.url.endsWith("/admin/content/validate"))!.body as { collections: Record<string, { value: unknown }> };
    expect(body.collections.items!.value).toEqual([{ id: "chipped_sword", name: "Worn Shortsword" }]);
  });

  it("answers a save that changes nothing without asking the server", async () => {
    const server = fakeServer();
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    const result = await backend.transact({ operation: "save", revisions: {}, changes: [{ kind: "put", collection: "items", id: "worn_sword", record: sources.items[0] }] });
    expect(result.ok).toBe(true);
    expect(server.calls.some(call => call.url.includes("publish"))).toBe(false);
  });
});

describe("refusals", () => {
  const edit = { kind: "put", collection: "lootTables", id: "redsill", record: { id: "redsill", rolls: [] as unknown[] } } as const;
  const sent = { lootTables: "0".repeat(64), items: "1".repeat(64) };
  async function refuse(status: number, body: unknown) {
    const server = fakeServer({ "/admin/content/publish": { status, body } });
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch });
    return backend.transact({ operation: "save", revisions: sent, changes: [{ ...edit, record: { id: "redsill", rolls: [{ itemId: "x" }] } }] });
  }

  it("409 stale_collections moves only the stale revisions, which is what marks a conflict", async () => {
    const result = await refuse(409, { error: { code: "stale_collections", message: "Content changed on the server since this edit began. Your draft has been preserved.", stale: ["lootTables"], revisions: { lootTables: REVISION }, revision: REVISION } });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.status).toBe(409);
    expect(result.body.revisions).toEqual({ lootTables: REVISION, items: sent.items });
    expect(result.body.error).toContain("Your draft has been preserved");
  });

  it("422 content_invalid becomes compile diagnostics", async () => {
    const result = await refuse(422, { error: { code: "content_invalid", message: "Content failed validation.", problems: [{ path: "lootTables[redsill].rolls[0].itemId", message: "Unknown item x", severity: "error" }] } });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.status).toBe(422);
    expect(result.body.diagnostics).toEqual([{ path: "lootTables[redsill].rolls[0].itemId", message: "Unknown item x", severity: "error" }]);
    // Nothing is stale, so no record may be turned into a conflict.
    expect(result.body.revisions).toEqual(sent);
  });

  it("409 definition_in_use lists the holders and leaves the revisions alone", async () => {
    const blockers: PublishBlocker[] = [
      { kind: "item", id: "worn_sword", heldBy: "player", place: "bank", accountId: "acc_1", name: "Rook" },
      { kind: "creature", id: "redsill_frog", heldBy: "world", world: "corealm", alive: 4 },
    ];
    const result = await refuse(409, { error: { code: "definition_in_use", message: "This publish removes a definition that still has live instances. Mark it retired instead.", blockers } });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.body.revisions).toEqual(sent);
    expect(result.body.blockers).toEqual(blockers);
    expect(describeBlocker(blockers[0]!)).toBe("worn_sword: Rook holds one in their bank");
    expect(describeBlocker(blockers[1]!)).toBe("redsill_frog: 4 alive in corealm");
  });

  it("502 asset_manifest_unavailable, 422 spawn_unplaceable and 403 each say what happened", async () => {
    const manifest = await refuse(502, { error: { code: "asset_manifest_unavailable", message: "The asset host did not answer." } });
    expect(manifest.ok).toBe(false);
    if (!manifest.ok) expect(manifest.body.error).toBe("The asset host did not answer. Publishing is paused until the asset host answers.");

    const spawn = await refuse(422, { error: { code: "spawn_unplaceable", message: "No walkable floor for redsill_frog", world: "corealm" } });
    if (!spawn.ok) expect(spawn.body.error).toBe("No walkable floor for redsill_frog (corealm)");

    const forbidden = await refuse(403, { error: { code: "forbidden", message: "This credential is missing the content:publish scope" } });
    if (!forbidden.ok) { expect(forbidden.status).toBe(403); expect(forbidden.body.error).toContain("Nothing was published."); }
  });

  it("401 clears the session through the port so the shell can go back to sign-in", async () => {
    const server = fakeServer({ "/admin/content/sources": { status: 401, body: { error: { code: "unauthorized", message: "This admin session has expired or was revoked" } } } });
    let expired = 0;
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: server.fetch, onUnauthorized: () => { expired += 1; } });
    await expect(backend.collections()).rejects.toThrow("expired");
    expect(expired).toBe(1);
  });
});

describe("capabilities", () => {
  beforeEach(() => setBackend(createRepoBackend()));

  it("repo mode has every surface and server mode has the content ones", () => {
    expect(createRepoBackend().capabilities).toEqual({ write: true, meta: true, requests: true, git: true, bulk: true, assets: true, formulas: true, publish: false });
    const server = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer().fetch });
    expect(server.capabilities).toEqual({ write: true, meta: false, requests: false, git: false, bulk: false, assets: false, formulas: false, publish: true });
  });

  it("`can` follows the installed backend", () => {
    expect(can("git")).toBe(true);
    setBackend(createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer().fetch }));
    expect(can("git")).toBe(false);
    expect(can("publish")).toBe(true);
    expect(can("write")).toBe(true);
    setBackend(createRepoBackend());
  });

  it("refuses a repo-only path with a reason rather than a 404", async () => {
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer().fetch });
    await expect(backend.get("git/status")).rejects.toThrow("not available on a live server");
    await expect(backend.get("meta/items/$all")).rejects.toThrow("not available on a live server");
    await expect(backend.get("requests")).rejects.toThrow("not available on a live server");
    await expect(backend.admin("/__devdocs/assets/upload")).rejects.toThrow("not available on a live server");
  });

  it("drops the workspaces and views a live server has no answer for", async () => {
    // The navigation reads capabilities once at load, exactly as the shell does, so the module is
    // evaluated again for each mode this asks about.
    const load = async (): Promise<{ key: string; views: { key: string }[] }[]> => {
      vi.resetModules();
      const module = await import("../devdocs/src/ui/workspaces.js");
      return module.WORKSPACES as unknown as { key: string; views: { key: string }[] }[];
    };
    const { setBackend: setOnServer } = await import("../devdocs/src/api/backend.js");
    setOnServer(createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch: fakeServer().fetch }));
    const onServer = await load();
    expect(onServer.find(row => row.key === "home")?.views.map(view => view.key)).toEqual(["overview"]);
    expect(onServer.find(row => row.key === "tuning")?.views.some(view => view.key === "formulas")).toBe(false);

    vi.resetModules();
    const { setBackend: setInRepo } = await import("../devdocs/src/api/backend.js");
    setInRepo(createRepoBackend());
    const inRepo = await import("../devdocs/src/ui/workspaces.js");
    expect((inRepo.WORKSPACES as unknown as { key: string; views: { key: string }[] }[]).find(row => row.key === "home")?.views.map(view => view.key)).toEqual(["overview", "requests", "changes"]);
  });
});

describe("sign-in", () => {
  it("normalises a typed server address and refuses one that carries more than an origin", () => {
    expect(normalizeServerUrl(" play.example.com ")).toBe("https://play.example.com");
    expect(normalizeServerUrl("http://127.0.0.1:4250/")).toBe("http://127.0.0.1:4250");
    expect(normalizeServerUrl("https://host.test/corealm/")).toBe("https://host.test/corealm");
    expect(() => normalizeServerUrl("")).toThrow("Enter the address");
    expect(() => normalizeServerUrl("ftp://host.test")).toThrow("http or https");
    expect(() => normalizeServerUrl("https://host.test/?token=x")).toThrow("no query");
  });

  it("takes the token audience from the server's published endpoint, not the typed address", async () => {
    expect(audienceOf("wss://play.example.com/")).toBe("https://play.example.com");
    expect(audienceOf("ws://127.0.0.1:4250/")).toBe("http://127.0.0.1:4250");
    const info = { name: "Fallowmarch", endpoint: "wss://public.example.com/", assetBaseUrl: "https://cdn.test/pack/", identityUrl: "https://id.test/", catalogRevision: REVISION, worlds: [] };
    const asked: string[] = [];
    const descriptor = await readDescriptor("http://10.0.0.5:4250", (async (url: string) => { asked.push(url); return response(200, info); }) as unknown as typeof globalThis.fetch);
    expect(asked).toEqual(["http://10.0.0.5:4250/admin/info"]);
    expect(descriptor).toEqual({ name: "Fallowmarch", endpoint: "wss://public.example.com/", assetBaseUrl: "https://cdn.test/pack/", identityUrl: "https://id.test/", catalogRevision: REVISION });
    // The typed address is a LAN one; the token must still be minted for the published origin.
    expect(audienceOf(descriptor.endpoint)).toBe("https://public.example.com");
  });

  it("says so when a host does not use accounts", async () => {
    const fetcher = (async () => response(501, { error: { code: "admin_unavailable", message: "no accounts" } })) as unknown as typeof globalThis.fetch;
    await expect(readDescriptor("http://127.0.0.1:4250", fetcher)).rejects.toThrow("does not use accounts");
  });

  it("lets the page name the identity service, and a self-served build fall back to its own server", () => {
    // Typed address, page configured: the page wins and the server never gets a say.
    expect(chooseIdentity("https://id.test", "https://play.test", "https://id.test/", "https://admin.test")).toEqual({ ok: true, url: "https://id.test" });
    // Served by the game server itself, page says nothing: same origin, same trust domain.
    expect(chooseIdentity(null, "https://play.test", "https://id.test/", "https://play.test")).toEqual({ ok: true, url: "https://id.test" });
    // Typed address, page says nothing: a server reached by address does not choose the login.
    const refused = chooseIdentity(null, "https://play.test", "https://id.test/", "https://admin.test");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("does not get to choose one");
    // Both name one and they disagree: this admin is at the wrong server.
    const mismatch = chooseIdentity("https://id.test", "https://play.test", "https://evil.test/", "https://play.test");
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toContain("https://evil.test");
    const nowhere = chooseIdentity(null, "https://play.test", null, "https://play.test");
    expect(nowhere.ok).toBe(false);
  });

  it("exchanges a join token at /admin/session and a setup code at /admin/setup", async () => {
    const calls: Call[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, headers: {}, body: JSON.parse(String(init.body)) });
      return response(200, { session: "cas_new", expiresAt: Date.now() + 43_200_000, accountId: "acc_rook", name: "Rook", role: "owner" });
    }) as unknown as typeof globalThis.fetch;

    const signed = await exchangeSession({ server: "https://play.test", audience: "https://play.test", joinToken: "jt" }, fetcher);
    expect(calls[0]).toMatchObject({ url: "https://play.test/admin/session", method: "POST", body: { token: "jt" } });
    expect(signed).toMatchObject({ accountId: "acc_rook", role: "owner", token: "cas_new", server: "https://play.test" });

    await exchangeSession({ server: "https://play.test", audience: "https://play.test", joinToken: "jt", setupCode: "K7M3Q-2WXPR" }, fetcher);
    expect(calls[1]).toMatchObject({ url: "https://play.test/admin/setup", method: "POST", body: { token: "jt", code: "K7M3Q-2WXPR" } });
  });

  it("reports an account with no role on this server as a 403 the screen can act on", async () => {
    const fetcher = (async () => response(403, { error: { code: "forbidden", message: "This account holds no role on this server" } })) as unknown as typeof globalThis.fetch;
    const failure = await exchangeSession({ server: "https://play.test", audience: "https://play.test", joinToken: "jt" }, fetcher).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdminFailure);
    expect(failure).toMatchObject({ status: 403, code: "forbidden", message: "This account holds no role on this server" });
  });
});
