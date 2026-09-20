import type { IncomingMessage, ServerResponse } from "node:http";
import type { PlayerCharacter, SessionErrorCode, WorldKey } from "../contracts.js";
import {
  ACCOUNT_ID, ADMIN_SESSION_MS, ADMIN_SESSION_PREFIX, API_SCOPES, API_TOKEN_PREFIX, banMessage, hashSecret, newApiTokenId, newSecret,
  setupCodeDigits, type AdminActor, type ApiScope, type ServerAdminStorage, type ServerRole,
} from "./adminStorage.js";
import type { AuthenticatedPlayer, PlayerEditOutcome, ReferenceServerMetrics, ServerEvent } from "./referenceServer.js";
import { accepts, type CatalogHost } from "./catalogHost.js";
import { ADMIN_API_SEGMENTS } from "./adminUi.js";
import { EditFailure, MAX_PLAYER_PATCH_BYTES, playerPatch, playerRevision, type PlayerPatch } from "./playerEdits.js";
import { SettingsFailure, type ServerSettings } from "./serverSettings.js";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { CATALOG_REVISION } from "../content/clientCatalog.js";
import { collectionRevision } from "../content/compiler/revision.js";
import { PublishFailure, publishRequest, type ContentPublisher } from "./contentPublish.js";

/**
 * The admin HTTP API, mounted on the reference server's single route table. JSON in, JSON out,
 * `{error:{code,message}}` on failure, never cached, and never `*` for CORS: a browser origin
 * reaches `/admin/*` only when the host listed it in `allowedOrigins`.
 *
 * The devdocs build is served under `/admin/` too. The API owns the first path segments in
 * `ADMIN_API_SEGMENTS`, for every method; every other path goes to `ui`.
 *
 * Two credentials, both `Authorization: Bearer …`. An admin session (`cas_…`) carries a role and
 * every scope. An API token (`cat_…`) carries only the scopes it was created with and can never
 * mint a token or grant a role.
 */

const MAX_BODY_BYTES = 8_192;
/** A publish carries whole collections. The largest is about 0.5 MiB and all of them together about 2 MiB, so this leaves room to grow. */
export const MAX_CONTENT_BODY_BYTES = 16 * 1024 * 1024;
const MAX_URL_CHARS = 2_048;
const MAX_LABEL_CHARS = 64;
const MAX_REASON_CHARS = 512;
const PLAYER_PAGE_LIMIT = 100;
const AUDIT_PAGE_LIMIT = 200;
const CATALOG_HISTORY_LIMIT = 200;
const MAX_FILTER_CHARS = 128;
const compressGzip = promisify(gzip), compressBrotli = promisify(brotliCompress);
/** The setup code is the one brute-forceable secret on this API, so its window is the tightest. */
const SETUP_ATTEMPTS_PER_MINUTE = 5;
const SETUP_ATTEMPTS_PER_MINUTE_TOTAL = 20;
const LOGIN_ATTEMPTS_PER_MINUTE = 30;

/** What the admin API reads and does to the running server. `referenceServer` supplies it. */
export interface AdminServerPorts {
  /** Epoch milliseconds the listener came up. */
  startedAt: number;
  metrics: ReferenceServerMetrics;
  worlds(): { key: WorldKey; name: string; playersOnline: number; capacity: number; tick: number }[];
  /** The bounded ring M6's TUI reads too, oldest first. */
  events(): readonly ServerEvent[];
  record(event: Omit<ServerEvent, "at">): void;
  /** The live character of an online account, from the world that holds it. */
  liveCharacter(accountId: string): { world: WorldKey; character: PlayerCharacter } | null;
  /** Disconnect an account from every world through the normal leave path: save, then release. */
  disconnect(accountId: string, code: SessionErrorCode, message: string): boolean;
  /** Whether a connection of this account is open in any world. */
  connected(accountId: string): boolean;
  /** Apply a validated patch to the live player, or to the stored one when no world holds them. Throws `EditFailure`. */
  editPlayer(accountId: string, patch: PlayerPatch, by: AdminActor): Promise<PlayerEditOutcome>;
  /** What this server is and where its parts live. No secrets: the login screen reads it before anyone has signed in. */
  info(): { name: string; description: string | null; endpoint: string; assetBaseUrl: string | null; identityUrl: string | null; authentication: string;
    catalogRevision: string; host: string; registerWithDirectory: boolean; worlds: { providerId: string; worldId: string; name: string; seed: number; capacity: number }[] };
  settings: {
    get(): Promise<{ settings: ServerSettings; overrides: Record<string, unknown>; defaults: ServerSettings }>;
    /** Validate, store with its audit row, and apply to the running worlds. Throws `SettingsFailure`. */
    patch(body: Record<string, unknown>, by: AdminActor): Promise<{ settings: ServerSettings; overrides: Record<string, unknown>; defaults: ServerSettings }>;
  };
}
export interface AdminApiOptions {
  admin: ServerAdminStorage;
  /** The running catalog and its store. */
  catalog: CatalogHost;
  /** Publish, validate and rollback, under `content:publish`. */
  publisher: ContentPublisher;
  /** Verifies a join token exactly as a join does, including audience and replay. */
  authenticate(token: string): Promise<AuthenticatedPlayer>;
  allowedOrigins: readonly string[];
  server: AdminServerPorts;
  /** Everything under `/admin` that is not the API: the devdocs build. */
  ui(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  now?(): number;
  log?(event: Record<string, unknown>): void;
}

class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ApiFailure"; }
}
/** A fixed window per key. Enough to stop a loop, cheap enough to run on every attempt. */
class RateWindow {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number) {}
  allow(key: string, now: number): boolean {
    for (const [name, hit] of this.hits) if (now - hit.start >= 60_000) this.hits.delete(name);
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= 60_000) { this.hits.set(key, { start: now, count: 1 }); return true; }
    return ++hit.count <= this.limit;
  }
}

/** One resolved caller. A session holds every scope; a token holds exactly what it was given. */
interface Credential {
  kind: "session" | "token";
  accountId: string | null;
  role: ServerRole | null;
  tokenId: string | null;
  scopes: readonly ApiScope[];
  hash: string;
}
const actorOf = (credential: Credential, at: number): AdminActor =>
  ({ accountId: credential.accountId, credential: credential.kind === "session" ? "session" : `token:${credential.tokenId}`, at });

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}
function accountId(value: unknown): string {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new ApiFailure(400, "invalid_request", "An account id is required");
  return value;
}
function futureMs(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= now) throw new ApiFailure(400, "invalid_request", "An expiry must be epoch milliseconds in the future");
  return value as number;
}
function scopeList(value: unknown): ApiScope[] {
  if (!Array.isArray(value) || !value.length || value.length > API_SCOPES.length) throw new ApiFailure(400, "invalid_request", "At least one scope is required");
  const scopes = [...new Set(value)];
  for (const scope of scopes) if (!(API_SCOPES as readonly unknown[]).includes(scope)) throw new ApiFailure(400, "invalid_scope", `Unknown scope ${JSON.stringify(scope)}`);
  return scopes as ApiScope[];
}
function counted(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new ApiFailure(400, "invalid_request", `A limit is 1 to ${max}`);
  return limit;
}

export function createAdminApi(options: AdminApiOptions) {
  const { admin, server, catalog, publisher } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((event: Record<string, unknown>) => console.log(JSON.stringify(event)));
  const origins = new Set(options.allowedOrigins);
  const setupPerAddress = new RateWindow(SETUP_ATTEMPTS_PER_MINUTE);
  const setupTotal = new RateWindow(SETUP_ATTEMPTS_PER_MINUTE_TOTAL);
  const loginPerAddress = new RateWindow(LOGIN_ATTEMPTS_PER_MINUTE);
  /** The last server catalog asked for, compressed once. It runs to megabytes and an editor asks for the same one again. */
  let servedCatalog: { revision: string; identity: Buffer; gzip: Buffer; br: Buffer } | null = null;
  /** The last sources revision map, as its finished JSON. Hashing every collection parses megabytes, and an editor reloads. */
  let servedRevisions: { revision: string; json: string } | null = null;

  function cors(request: IncomingMessage): Record<string, string> {
    const origin = request.headers.origin;
    // Exact match only, and no credentials header: both credentials travel as bearer tokens.
    return typeof origin === "string" && origins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  }
  function json(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): void {
    const payload = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(payload), ...cors(request) });
    response.end(payload);
  }
  async function body(request: IncomingMessage, cap = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let length = 0;
    // Counted as it streams, so an oversized body is dropped at the cap and never buffered whole.
    const tooLarge = () => new ApiFailure(413, "payload_too_large", `Request bodies are capped at ${cap >= 1_048_576 ? `${cap / 1_048_576} MiB` : `${cap / 1024} KiB`}`);
    if (Number(request.headers["content-length"]) > cap) throw tooLarge();
    for await (const chunk of request) {
      length += (chunk as Buffer).length;
      if (length > cap) throw tooLarge();
      chunks.push(chunk as Buffer);
    }
    if (!length) return {};
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiFailure(400, "invalid_request", "A JSON object body is required"); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure(400, "invalid_request", "A JSON object body is required");
    for (const key of Object.keys(value)) if (key === "__proto__") throw new ApiFailure(400, "invalid_request", "A JSON object body is required");
    return value as Record<string, unknown>;
  }
  const caller = (request: IncomingMessage): string => request.socket.remoteAddress ?? "unknown";

  function presented(request: IncomingMessage): string {
    const header = request.headers.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token.length > 512) throw new ApiFailure(401, "unauthorized", "An admin session or API token is required");
    return token;
  }
  async function credential(request: IncomingMessage): Promise<Credential> {
    const token = presented(request), hash = hashSecret(token), at = now();
    if (token.startsWith(ADMIN_SESSION_PREFIX)) {
      const session = await admin.adminSession(hash, at);
      if (!session) throw new ApiFailure(401, "unauthorized", "This admin session has expired or was revoked");
      if (await admin.banOf(session.accountId, at)) throw new ApiFailure(403, "forbidden", "This account is banned from this server");
      return { kind: "session", accountId: session.accountId, role: session.role, tokenId: null, scopes: API_SCOPES, hash };
    }
    if (token.startsWith(API_TOKEN_PREFIX)) {
      const record = await admin.useApiToken(hash, at);
      if (!record) throw new ApiFailure(401, "unauthorized", "This API token has expired or was revoked");
      return { kind: "token", accountId: record.createdBy, role: null, tokenId: record.id, scopes: record.scopes, hash };
    }
    throw new ApiFailure(401, "unauthorized", "An admin session or API token is required");
  }
  /** Roles, tokens and settings are session work: a token can never widen its own rights. */
  async function session(request: IncomingMessage): Promise<Credential> {
    const held = await credential(request);
    if (held.kind !== "session") throw new ApiFailure(403, "forbidden", "This endpoint requires an admin session, not an API token");
    return held;
  }
  async function scoped(request: IncomingMessage, scope: ApiScope): Promise<Credential> {
    const held = await credential(request);
    if (!held.scopes.includes(scope)) throw new ApiFailure(403, "forbidden", `This credential is missing the ${scope} scope`);
    return held;
  }
  async function owner(request: IncomingMessage): Promise<Credential> {
    const held = await session(request);
    if (held.role !== "owner") throw new ApiFailure(403, "forbidden", "Only the owner manages roles");
    return held;
  }

  async function issueSession(player: AuthenticatedPlayer, role: ServerRole, at: number): Promise<Record<string, unknown>> {
    const secret = newSecret(ADMIN_SESSION_PREFIX), expiresAt = at + ADMIN_SESSION_MS;
    await admin.createAdminSession(hashSecret(secret), player.playerId, role, expiresAt, { accountId: player.playerId, credential: "login", at });
    server.record({ kind: "admin-session", accountId: player.playerId, detail: role });
    log({ event: "admin.session", accountId: player.playerId, role });
    return { session: secret, expiresAt, accountId: player.playerId, name: player.name, role };
  }

  function stats(): Record<string, unknown> {
    const at = now(), metrics = server.metrics;
    const uptimeSeconds = Math.max(0, (at - server.startedAt) / 1000);
    const ticks = [...metrics.ticks].sort((a, b) => a - b);
    const total = ticks.reduce((sum, value) => sum + value, 0);
    const samples = metrics.stages.samples || 1;
    const memory = process.memoryUsage();
    return {
      startedAt: server.startedAt, uptimeSeconds,
      worlds: server.worlds().map(world => ({ providerId: world.key.providerId, worldId: world.key.worldId, name: world.name,
        playersOnline: world.playersOnline, capacity: world.capacity, tick: world.tick })),
      tick: { samples: ticks.length, lastMs: metrics.ticks.at(-1) ?? 0, meanMs: ticks.length ? total / ticks.length : 0,
        p95Ms: ticks.length ? ticks[Math.min(ticks.length - 1, Math.floor(ticks.length * 0.95))]! : 0, maxMs: ticks.at(-1) ?? 0 },
      stages: { samples: metrics.stages.samples, simulationMs: metrics.stages.simulationMs / samples, snapshotMs: metrics.stages.snapshotMs / samples,
        commitMs: metrics.stages.commitMs / samples, replicationMs: metrics.stages.replicationMs / samples },
      commands: metrics.commands, rejected: metrics.rejected, errors: metrics.errors, backlogDisconnects: metrics.backlogDisconnects,
      bytesOut: metrics.bytesOut, bytesOutPerSecond: uptimeSeconds > 0 ? metrics.bytesOut / uptimeSeconds : 0,
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
      events: server.events().map(event => ({ ...event })),
      // The publish history is `GET /admin/content/revision`.
      catalogRevision: catalog.revision, server: server.info(),
    };
  }

  /** The private state devdocs shows. M5 adds `PATCH` and kick beside this reader. */
  function playerBody(stored: Awaited<ReturnType<ServerAdminStorage["player"]>>): Record<string, unknown> {
    const detail = stored!;
    const live = detail.online ? server.liveCharacter(detail.accountId) : null;
    const character = live?.character ?? detail.character;
    return {
      accountId: detail.accountId, name: detail.name, firstSeen: detail.firstSeen, lastSeen: detail.lastSeen,
      playtimeSeconds: detail.playtimeSeconds, lastWorld: detail.lastWorld, online: live?.world ?? detail.online,
      position: character?.player.position ?? detail.position, regionId: character?.player.regionId ?? detail.regionId,
      ban: detail.ban, currency: character?.currency ?? null, skills: character?.skills ?? null,
      inventory: character?.inventory.slots ?? null, bank: character?.bank.slots ?? null, equipment: character?.equipment ?? null,
      // What `PATCH` takes back as `expect.revision`. It moves when anything an edit can touch moves, except position.
      revision: character ? playerRevision(character) : null,
    };
  }

  async function dispatch(request: IncomingMessage, response: ServerResponse, url: URL, segments: string[]): Promise<void> {
    const method = request.method ?? "GET", at = now();
    const rest = segments.slice(1), target = rest[1] === undefined ? null : decodeURIComponent(rest[1]);
    const deeper = (rest[0] === "players" && rest[2] === "kick") || (rest[0] === "content" && rest[1] === "catalog") ? 3 : 2;
    if (rest.length > deeper) throw new ApiFailure(404, "not_found", "No such admin endpoint");

    if (method === "GET" && rest[0] === "info" && rest.length === 1) {
      // Public on purpose: the login screen needs the identity service and the token audience before there is a session.
      const { host: _host, registerWithDirectory: _listed, ...info } = server.info();
      json(request, response, 200, info); return;
    }

    if (method === "POST" && rest[0] === "setup" && rest.length === 1) {
      if (!setupPerAddress.allow(caller(request), at) || !setupTotal.allow("", at)) throw new ApiFailure(429, "rate_limited", "Too many setup attempts");
      const input = await body(request);
      const digits = setupCodeDigits(input.code);
      const token = text(input.token, 4096);
      if (!token) throw new ApiFailure(400, "invalid_request", "A join token is required");
      const player = await identify(token);
      // One answer for a wrong code and a spent code: an attacker learns nothing from either.
      const granted = digits && await admin.claimSetupCode(hashSecret(digits), { accountId: player.playerId, credential: "setup", at });
      if (!granted) { log({ event: "admin.setup_refused", accountId: player.playerId }); throw new ApiFailure(403, "forbidden", "The setup code is not valid"); }
      server.record({ kind: "owner-setup", accountId: player.playerId, detail: null });
      log({ event: "admin.owner", accountId: player.playerId, via: "setup-code" });
      json(request, response, 200, await issueSession(player, "owner", at)); return;
    }
    if (rest[0] === "session" && rest.length === 1) {
      if (method === "POST") {
        if (!loginPerAddress.allow(caller(request), at)) throw new ApiFailure(429, "rate_limited", "Too many sign-in attempts");
        const token = text((await body(request)).token, 4096);
        if (!token) throw new ApiFailure(400, "invalid_request", "A join token is required");
        const player = await identify(token);
        const role = await admin.roleOf(player.playerId);
        const ban = await admin.banOf(player.playerId, at);
        if (!role || ban) throw new ApiFailure(403, "forbidden", ban ? "This account is banned from this server" : "This account holds no role on this server");
        json(request, response, 200, await issueSession(player, role.role, at)); return;
      }
      if (method === "DELETE") {
        const held = await session(request);
        await admin.revokeAdminSession(held.hash, actorOf(held, at));
        json(request, response, 200, { ok: true }); return;
      }
    }
    if (method === "GET" && rest[0] === "me" && rest.length === 1) {
      const held = await credential(request);
      const { name, endpoint, assetBaseUrl, identityUrl, catalogRevision } = server.info();
      json(request, response, 200, { credential: held.kind, accountId: held.accountId, tokenId: held.tokenId,
        role: held.role, scopes: [...held.scopes], server: { name, endpoint, assetBaseUrl, identityUrl, catalogRevision } }); return;
    }

    if (rest[0] === "roles") {
      if (method === "GET" && rest.length === 1) { await session(request); json(request, response, 200, { roles: await admin.listRoles() }); return; }
      if (method === "PUT" && target !== null) {
        const held = await owner(request);
        const id = accountId(target);
        if ((await body(request)).role !== "admin") throw new ApiFailure(400, "invalid_request", "Only the admin role can be granted");
        const existing = await admin.roleOf(id);
        if (existing?.role === "owner") throw new ApiFailure(409, "conflict", "An owner cannot be demoted");
        json(request, response, 200, { role: await admin.setRole(id, "admin", actorOf(held, at)) }); return;
      }
      if (method === "DELETE" && target !== null) {
        const held = await owner(request);
        const id = accountId(target);
        const existing = await admin.roleOf(id);
        if (!existing) throw new ApiFailure(404, "not_found", "That account holds no role");
        if (existing.role === "owner" && (await admin.listRoles()).filter(role => role.role === "owner").length <= 1)
          throw new ApiFailure(409, "conflict", "The last owner cannot be removed");
        if (existing.role === "owner" && held.accountId !== id) throw new ApiFailure(409, "conflict", "An owner cannot be demoted");
        await admin.revokeRole(id, actorOf(held, at));
        json(request, response, 200, { ok: true }); return;
      }
    }

    if (rest[0] === "bans") {
      if (method === "GET" && rest.length === 1) {
        await scoped(request, "players:read");
        json(request, response, 200, { bans: await admin.listBans(at) }); return;
      }
      if (method === "POST" && rest.length === 1) {
        const held = await scoped(request, "players:write");
        const input = await body(request);
        const id = accountId(input.accountId);
        const reason = text(input.reason, MAX_REASON_CHARS);
        if (!reason) throw new ApiFailure(400, "invalid_request", "A ban reason is required");
        if ((await admin.roleOf(id))?.role === "owner") throw new ApiFailure(409, "conflict", "An owner cannot be banned");
        const ban = await admin.setBan({ accountId: id, reason, expiresAt: futureMs(input.expiresAt, at) }, actorOf(held, at));
        const kicked = server.disconnect(id, "BANNED", banMessage(ban));
        server.record({ kind: "ban", accountId: id, detail: reason });
        log({ event: "admin.ban", accountId: id, by: held.accountId, kicked });
        json(request, response, 200, { ban, kicked }); return;
      }
      if (method === "DELETE" && target !== null) {
        const held = await scoped(request, "players:write");
        if (!await admin.removeBan(accountId(target), actorOf(held, at))) throw new ApiFailure(404, "not_found", "That account is not banned");
        server.record({ kind: "unban", accountId: target, detail: null });
        json(request, response, 200, { ok: true }); return;
      }
    }

    if (rest[0] === "tokens") {
      if (method === "GET" && rest.length === 1) { await session(request); json(request, response, 200, { tokens: await admin.listApiTokens() }); return; }
      if (method === "POST" && rest.length === 1) {
        const held = await session(request);
        const input = await body(request);
        const label = text(input.label, MAX_LABEL_CHARS);
        if (!label) throw new ApiFailure(400, "invalid_request", "A token label is required");
        const secret = newSecret(API_TOKEN_PREFIX);
        const record = await admin.createApiToken({ id: newApiTokenId(), hash: hashSecret(secret), label,
          scopes: scopeList(input.scopes), expiresAt: futureMs(input.expiresAt, at) }, actorOf(held, at));
        log({ event: "admin.token_created", id: record.id, by: held.accountId, scopes: record.scopes });
        // The only time this secret exists outside the caller's hands.
        json(request, response, 201, { token: secret, ...record }); return;
      }
      if (method === "DELETE" && target !== null) {
        const held = await session(request);
        if (!await admin.revokeApiToken(target, actorOf(held, at))) throw new ApiFailure(404, "not_found", "No such API token");
        json(request, response, 200, { ok: true }); return;
      }
    }

    if (method === "GET" && rest[0] === "audit" && rest.length === 1) {
      await session(request);
      const before = url.searchParams.get("before");
      if (before !== null && !/^[0-9]{1,15}$/.test(before)) throw new ApiFailure(400, "invalid_request", "A cursor is an audit row id");
      const filter: { action?: string; account?: string; target?: string } = {};
      for (const key of ["action", "account", "target"] as const) {
        const prefix = url.searchParams.get(key);
        if (prefix === null) continue;
        if (!prefix || prefix.length > MAX_FILTER_CHARS) throw new ApiFailure(400, "invalid_request", `An ${key} filter is a prefix of 1 to ${MAX_FILTER_CHARS} characters`);
        filter[key] = prefix;
      }
      json(request, response, 200, { entries: await admin.audit(counted(url.searchParams.get("limit"), 50, AUDIT_PAGE_LIMIT), before === null ? null : Number(before), filter) });
      return;
    }
    if (rest[0] === "settings" && rest.length === 1 && (method === "GET" || method === "PATCH")) {
      const held = await session(request);
      if (method === "GET") { json(request, response, 200, await server.settings.get()); return; }
      try { json(request, response, 200, await server.settings.patch(await body(request), actorOf(held, at))); return; }
      catch (error) { if (error instanceof SettingsFailure) throw new ApiFailure(error.status, error.status === 400 ? "invalid_request" : "conflict", error.message); throw error; }
    }
    if (method === "GET" && rest[0] === "content" && rest[1] === "catalog" && rest.length === 3) {
      await scoped(request, "content:read");
      const wanted = rest[2] === "active" ? catalog.revision : rest[2]!;
      if (!CATALOG_REVISION.test(wanted)) throw new ApiFailure(400, "invalid_request", "A revision is 64 lowercase hex characters, or active");
      if (servedCatalog?.revision !== wanted) {
        const text = await catalog.storage.catalog(wanted, "server");
        if (text === null) throw new ApiFailure(404, "not_found", "No catalog with that revision is stored");
        const identity = Buffer.from(text);
        const [zipped, br] = await Promise.all([compressGzip(identity, { level: 6 }), compressBrotli(identity, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: identity.length } })]);
        servedCatalog = { revision: wanted, identity, gzip: zipped, br };
      }
      // The server catalog holds loot odds and spawn tables, so it is private to the caller. A revision is a content
      // hash and never changes; `active` is a pointer and is asked again every time.
      const etag = `"${wanted}"`, headers = { "Content-Type": "application/json", ETag: etag, "X-Catalog-Revision": wanted,
        "Cache-Control": rest[2] === "active" ? "private, no-cache" : "private, max-age=31536000, immutable", ...cors(request), Vary: "Origin, Accept-Encoding",
        "Access-Control-Expose-Headers": "ETag, X-Catalog-Revision" };
      if (request.headers["if-none-match"] === etag) { response.writeHead(304, headers).end(); return; }
      const coding = accepts(request.headers["accept-encoding"], "br") ? "br" : accepts(request.headers["accept-encoding"], "gzip") ? "gzip" : null;
      const payload = coding === null ? servedCatalog.identity : servedCatalog[coding];
      response.writeHead(200, { ...headers, "Content-Length": payload.length, ...(coding ? { "Content-Encoding": coding } : {}) });
      response.end(payload); return;
    }
    if (method === "GET" && rest[0] === "content" && rest.length === 2) {
      await scoped(request, "content:read");
      if (rest[1] === "revision") {
        json(request, response, 200, { revision: catalog.revision, history: await catalog.storage.history(counted(url.searchParams.get("limit"), 50, CATALOG_HISTORY_LIMIT)) }); return;
      }
      if (rest[1] === "sources") {
        const wanted = url.searchParams.get("revision") ?? catalog.revision;
        if (!CATALOG_REVISION.test(wanted)) throw new ApiFailure(400, "invalid_request", "A revision is 64 lowercase hex characters");
        const found = await catalog.storage.sources(wanted);
        if (!found) throw new ApiFailure(404, "not_found", "No catalog with that revision is stored");
        // `revisions` is what a publish compares a draft against, by the same function, so an editor
        // never has to hash a collection itself to know what to send back.
        if (servedRevisions?.revision !== found.revision) {
          const parsed = JSON.parse(found.sources) as Record<string, unknown>;
          servedRevisions = { revision: found.revision, json: JSON.stringify(Object.fromEntries(Object.keys(parsed).map(name => [name, collectionRevision(parsed[name])]))) };
        }
        // Source collections run to megabytes, so the stored text is spliced in rather than parsed and written again.
        const payload = `{"revision":${JSON.stringify(found.revision)},"revisions":${servedRevisions.json},"sources":${found.sources}}`;
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload), ...cors(request) });
        response.end(payload); return;
      }
    }
    if (method === "POST" && rest[0] === "content" && rest.length === 2 && (rest[1] === "publish" || rest[1] === "validate" || rest[1] === "rollback")) {
      const held = await scoped(request, "content:publish");
      const input = await body(request, rest[1] === "rollback" ? MAX_BODY_BYTES : MAX_CONTENT_BODY_BYTES);
      try {
        if (rest[1] === "rollback") {
          if (typeof input.revision !== "string" || !CATALOG_REVISION.test(input.revision) || Object.keys(input).length !== 1) throw new ApiFailure(400, "invalid_request", "A rollback is {revision}, 64 lowercase hex characters");
          json(request, response, 200, await publisher.rollback(input.revision, actorOf(held, at))); return;
        }
        const wanted = publishRequest(input);
        json(request, response, 200, rest[1] === "validate" ? await publisher.validate(wanted) : await publisher.publish(wanted, actorOf(held, at))); return;
      } catch (error) {
        if (!(error instanceof PublishFailure)) throw error;
        json(request, response, error.status, { error: { code: error.code, message: error.message, ...error.details } }); return;
      }
    }
    if (method === "GET" && rest[0] === "stats" && rest.length === 1) {
      await scoped(request, "stats:read");
      json(request, response, 200, stats()); return;
    }
    if (rest[0] === "players" && target !== null && (method === "PATCH" && rest.length === 2 || method === "POST" && rest[2] === "kick")) {
      const held = await scoped(request, "players:write");
      const id = accountId(target);
      if (method === "POST") {
        const input = await body(request);
        if (Object.keys(input).some(key => key !== "reason") || (input.reason !== undefined && !text(input.reason, MAX_REASON_CHARS))) throw new ApiFailure(400, "invalid_request", `A kick is {reason?}, at most ${MAX_REASON_CHARS} characters`);
        const reason = text(input.reason, MAX_REASON_CHARS);
        if (!server.connected(id)) throw new ApiFailure(409, "not_online", "That player is not connected");
        // Audited first: a kick that happened is always in the log, and one that is in the log at worst found the player already gone.
        await admin.record(actorOf(held, at), { action: "player.kick", target: id, after: { reason } });
        const kicked = server.disconnect(id, "KICKED", reason ? `Kicked from this server: ${reason}` : "Kicked from this server");
        server.record({ kind: "kick", accountId: id, detail: reason });
        log({ event: "admin.kick", accountId: id, by: held.accountId, kicked });
        json(request, response, 200, { kicked }); return;
      }
      try {
        const outcome = await server.editPlayer(id, playerPatch(await body(request, MAX_PLAYER_PATCH_BYTES)), actorOf(held, at));
        if (outcome.changed) log({ event: "admin.player_edit", accountId: id, by: held.accountId, applied: outcome.applied });
        json(request, response, 200, { ...outcome, player: playerBody(await admin.player(id, now())) }); return;
      } catch (error) {
        if (!(error instanceof EditFailure)) throw error;
        const status = error.code === "not_found" ? 404 : error.status;
        json(request, response, status, { error: { code: error.code, message: error.message, ...(error.opIndex === null ? {} : { op: error.opIndex }) } }); return;
      }
    }
    if (method === "GET" && rest[0] === "players") {
      if (rest.length > 2) throw new ApiFailure(404, "not_found", "No such admin endpoint");
      await scoped(request, "players:read");
      if (rest.length === 1) {
        const query = url.searchParams.get("query");
        if (query !== null && query.length > 128) throw new ApiFailure(400, "invalid_request", "A search is at most 128 characters");
        const cursor = url.searchParams.get("cursor");
        if (cursor !== null && !/^[0-9]{1,15}\.[A-Za-z0-9_.:-]{1,128}$/.test(cursor)) throw new ApiFailure(400, "invalid_request", "A cursor comes from a previous page");
        // Summaries read the lease, not the running world: one page must not clone a hundred characters.
        json(request, response, 200, await admin.listPlayers(query, counted(url.searchParams.get("limit"), 25, PLAYER_PAGE_LIMIT), cursor, at));
        return;
      }
      const stored = await admin.player(accountId(target), at);
      if (!stored) throw new ApiFailure(404, "not_found", "No such player on this server");
      json(request, response, 200, playerBody(stored)); return;
    }
    throw new ApiFailure(404, "not_found", "No such admin endpoint");
  }

  /** Join tokens verify exactly as they do for a join, so a stolen admin token is still one use. */
  async function identify(token: string): Promise<AuthenticatedPlayer> {
    let player: AuthenticatedPlayer;
    try { player = await options.authenticate(token); }
    catch { throw new ApiFailure(401, "unauthorized", "The sign-in token is invalid, expired, or was issued for another server"); }
    if (!ACCOUNT_ID.test(player.playerId)) throw new ApiFailure(401, "unauthorized", "The sign-in token does not name an account");
    return player;
  }

  return async function admins(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const raw = request.url ?? "";
    if (raw.length > MAX_URL_CHARS) { json(request, response, 414, { error: { code: "invalid_request", message: "Request URL is too long" } }); return true; }
    const url = new URL(raw, "http://server.invalid");
    const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments[0] !== "admin") return false;
    // The API owns its segments for every method and every Accept header. The rest of `/admin` is the devdocs build.
    if (request.method !== "OPTIONS" && !ADMIN_API_SEGMENTS.includes(segments[1] ?? "")) return options.ui(request, response);
    if (request.method === "OPTIONS") {
      const headers = cors(request);
      response.writeHead(headers["Access-Control-Allow-Origin"] ? 204 : 403, { ...headers, "Cache-Control": "no-store",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600", "Content-Length": 0 });
      response.end(); return true;
    }
    try { await dispatch(request, response, url, segments); }
    catch (error) {
      const failure = error instanceof ApiFailure ? error : new ApiFailure(500, "server_error", "The server failed to answer");
      if (failure.status === 500) log({ event: "admin.error", path: url.pathname, message: error instanceof Error ? error.message : String(error) });
      json(request, response, failure.status, { error: { code: failure.code, message: failure.message } });
    }
    return true;
  };
}

/** The one answer a server that does not use accounts gives to every admin request. */
export function adminUnavailable(request: IncomingMessage, response: ServerResponse): boolean {
  if (!/^\/admin(?![^/?#])/.test(request.url ?? "")) return false;
  const payload = JSON.stringify({ error: { code: "admin_unavailable",
    message: "Administration needs account authentication. Start this host with an identity service URL." } });
  response.writeHead(501, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload), Vary: "Origin" });
  response.end(payload);
  return true;
}
