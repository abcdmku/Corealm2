import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { publicHost, type AddressLookup } from "./addresses.js";
import { audienceOf, joinTokenClaims, signJoinToken, MAX_JOIN_TOKEN_CHARS } from "./joinToken.js";
import { pkcePair, type FetchLike, type OAuthProvider, type ProviderIdentity } from "./providers.js";
import { IdentityStore, NAME_PATTERN, type AccountView } from "./store.js";

/**
 * The identity service. It owns accounts, sessions, the signing keys and the public server
 * directory, and it issues short lived join tokens that game servers verify offline.
 */

export interface IdentityServiceOptions {
  providers: readonly OAuthProvider[];
  /** Exact browser origins allowed to call the service and to receive a login redirect. */
  allowedOrigins: readonly string[];
  /** Directory holding `identity.sqlite`. Created by the caller. */
  dataDir: string;
  /** Public origin of this service, used to build the OAuth redirect URI. */
  publicUrl?: string;
  host?: string;
  port?: number;
  /** Unix seconds. Injected so tests can move time without waiting. */
  now?: () => number;
  fetch?: FetchLike;
  /** Resolves directory candidates. Injected so tests need no DNS and no network. */
  lookup?: AddressLookup;
  /** Development only: allows a game server on a loopback or private address into the directory. */
  allowPrivateServers?: boolean;
  log?: (event: Record<string, unknown>) => void;
  sessionTtlSeconds?: number;
  stateTtlSeconds?: number;
  directoryTtlSeconds?: number;
  directoryCapacity?: number;
  tokensPerMinute?: number;
  registrationsPerMinute?: number;
}
export interface IdentityService {
  port: number;
  url: string;
  /** Retires the signing key and starts signing with a new one. Old tokens keep verifying. */
  rotateSigningKey(): string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 8_192;
const MAX_URL_CHARS = 4_096;
const MAX_PROBE_BYTES = 262_144;
const DEFAULTS = {
  sessionTtlSeconds: 30 * 24 * 60 * 60, stateTtlSeconds: 300, directoryTtlSeconds: 600,
  directoryCapacity: 256, tokensPerMinute: 60, registrationsPerMinute: 10,
};

class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "HttpFailure"; }
}

/** A fixed window per key. Enough to stop a loop, cheap enough to run on every request. */
class RateWindow {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number) {}
  allow(key: string, now: number): boolean {
    for (const [name, hit] of this.hits) if (now - hit.start >= 60) this.hits.delete(name);
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= 60) { this.hits.set(key, { start: now, count: 1 }); return true; }
    hit.count++;
    return hit.count <= this.limit;
  }
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
/** A registerable game endpoint: encrypted, or loopback for a LAN host, and free of extras. */
function gameEndpoint(value: unknown): string {
  const raw = text(value, 2048);
  if (!raw) throw new HttpFailure(400, "invalid_request", "An endpoint URL is required");
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpFailure(400, "invalid_request", "An endpoint URL is required"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "wss:" || (loopback && url.protocol === "ws:")) || url.username || url.password || url.search || url.hash)
    throw new HttpFailure(400, "invalid_endpoint", "Game endpoints are WSS URLs, or loopback WS, with no query, fragment or credentials");
  return url.href;
}

export async function startIdentityService(options: IdentityServiceOptions): Promise<IdentityService> {
  const settings = {
    sessionTtlSeconds: options.sessionTtlSeconds ?? DEFAULTS.sessionTtlSeconds,
    stateTtlSeconds: options.stateTtlSeconds ?? DEFAULTS.stateTtlSeconds,
    directoryTtlSeconds: options.directoryTtlSeconds ?? DEFAULTS.directoryTtlSeconds,
    directoryCapacity: options.directoryCapacity ?? DEFAULTS.directoryCapacity,
    tokensPerMinute: options.tokensPerMinute ?? DEFAULTS.tokensPerMinute,
    registrationsPerMinute: options.registrationsPerMinute ?? DEFAULTS.registrationsPerMinute,
  };
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;
  const lookup: AddressLookup = options.lookup ?? (hostname => dnsLookup(hostname, { all: true, verbatim: true }));
  const log = options.log ?? ((event: Record<string, unknown>) => console.log(JSON.stringify(event)));
  const providers = new Map<string, OAuthProvider>();
  for (const provider of options.providers) {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(provider.name)) throw new Error("Provider names are lowercase identifiers");
    if (providers.has(provider.name)) throw new Error(`Duplicate provider ${provider.name}`);
    providers.set(provider.name, provider);
  }
  if (!providers.size) throw new Error("At least one OAuth provider is required");
  const origins = new Set<string>();
  for (const origin of options.allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin) throw new Error("Allowed origins must be exact scheme://host[:port] values");
    origins.add(origin);
  }
  if (!origins.size) throw new Error("At least one allowed web origin is required");

  const store = new IdentityStore(`${options.dataDir.replace(/[\\/]+$/, "")}/identity.sqlite`);
  store.activeSigningKey(now());
  const tokenLimit = new RateWindow(settings.tokensPerMinute);
  const registerLimit = new RateWindow(settings.registrationsPerMinute);
  let publicUrl = options.publicUrl?.replace(/\/+$/, "") ?? "";

  function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload), ...headers });
    response.end(payload);
  }
  function corsFor(request: IncomingMessage): Record<string, string> {
    const origin = request.headers.origin;
    // Exact match only, and no credentials header: sessions travel as bearer tokens.
    return typeof origin === "string" && origins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  }
  async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += (chunk as Buffer).length;
      if (length > MAX_BODY_BYTES) throw new HttpFailure(413, "payload_too_large", "Request bodies are capped at 8 KiB");
      chunks.push(chunk as Buffer);
    }
    if (!length) return {};
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpFailure(400, "invalid_request", "A JSON body is required"); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpFailure(400, "invalid_request", "A JSON object body is required");
    return value as Record<string, unknown>;
  }
  function bearer(request: IncomingMessage): { token: string; account: AccountView } {
    const header = request.headers.authorization;
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token.length > 512) throw new HttpFailure(401, "unauthorized", "A session is required");
    const account = store.sessionAccount(token, now());
    if (!account) throw new HttpFailure(401, "unauthorized", "A session is required");
    return { token, account };
  }
  function redirectTarget(value: unknown): string {
    const raw = text(value, 2048);
    if (!raw) throw new HttpFailure(400, "invalid_request", "A return URL is required");
    let url: URL;
    try { url = new URL(raw); } catch { throw new HttpFailure(400, "invalid_return", "The return URL must be an allowed origin"); }
    // The allow-list is what keeps this from being an open redirect that leaks a session.
    if (!origins.has(url.origin) || url.username || url.password) throw new HttpFailure(400, "invalid_return", "The return URL must be an allowed origin");
    return url.href;
  }
  function redirect(response: ServerResponse, location: string): void {
    response.writeHead(302, { Location: location, "Cache-Control": "no-store", "Content-Length": 0, "Referrer-Policy": "no-referrer" });
    response.end();
  }
  /** The web apps are static and cross origin, so the session comes back in the fragment. */
  function returnWith(target: string, values: Record<string, string>): string {
    const url = new URL(target);
    url.hash = new URLSearchParams(values).toString();
    return url.href;
  }
  function beginLogin(response: ServerResponse, provider: OAuthProvider, returnUrl: string, intent: "login" | "link", accountId: string | null): void {
    const pkce = provider.pkce ? pkcePair() : null;
    const state = store.createLoginState({ provider: provider.name, returnUrl, verifier: pkce?.verifier ?? null, intent, accountId }, now(), settings.stateTtlSeconds);
    log({ event: "login.start", provider: provider.name, intent });
    redirect(response, provider.authorizeUrl(state, `${publicUrl}/callback/${provider.name}`, pkce?.challenge));
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!request.url || request.url.length > MAX_URL_CHARS) throw new HttpFailure(414, "invalid_request", "Request URL is too long");
    const url = new URL(request.url, "http://identity.invalid");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method ?? "GET";
    const segments = path.split("/").filter(Boolean);

    if (method === "OPTIONS") {
      const cors = corsFor(request);
      response.writeHead(cors["Access-Control-Allow-Origin"] ? 204 : 403, {
        ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "600", "Content-Length": 0,
      });
      response.end(); return;
    }
    if (method === "GET" && path === "/healthz") { json(response, 200, { ok: true }); return; }

    if (method === "GET" && path === "/.well-known/corealm-keys.json") {
      json(response, 200, { keys: store.publishedKeys(now()) },
        { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" });
      return;
    }

    if (method === "GET" && segments[0] === "login" && segments.length === 2) {
      const provider = providers.get(segments[1]!);
      if (!provider) throw new HttpFailure(404, "unknown_provider", "No such login provider");
      beginLogin(response, provider, redirectTarget(url.searchParams.get("return")), "login", null);
      return;
    }

    if (method === "GET" && segments[0] === "callback" && segments.length === 2) {
      const provider = providers.get(segments[1]!);
      if (!provider) throw new HttpFailure(404, "unknown_provider", "No such login provider");
      const state = text(url.searchParams.get("state"), 256);
      if (!state) throw new HttpFailure(400, "invalid_state", "The login state is missing, expired or already used");
      const login = store.consumeLoginState(state, now());
      if (!login || login.provider !== provider.name) throw new HttpFailure(400, "invalid_state", "The login state is missing, expired or already used");
      const denial = text(url.searchParams.get("error"), 128);
      if (denial) { log({ event: "login.denied", provider: provider.name }); redirect(response, returnWith(login.returnUrl, { error: "access_denied" })); return; }
      const code = text(url.searchParams.get("code"), 1024);
      if (!code || /[\s#?&]/.test(code)) throw new HttpFailure(400, "invalid_request", "An authorization code is required");
      let identity: ProviderIdentity | undefined;
      try {
        identity = await provider.exchange(code, `${publicUrl}/callback/${provider.name}`, { ...(login.verifier ? { codeVerifier: login.verifier } : {}), fetch: fetchImpl });
      } catch (error) {
        log({ event: "login.failed", provider: provider.name, reason: error instanceof Error ? error.message : "exchange failed" });
        redirect(response, returnWith(login.returnUrl, { error: "exchange_failed" })); return;
      }
      if (typeof identity?.providerUserId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.providerUserId)) {
        log({ event: "login.failed", provider: provider.name, reason: "invalid provider identity" });
        redirect(response, returnWith(login.returnUrl, { error: "exchange_failed" })); return;
      }
      const suggestedName = typeof identity.suggestedName === "string" ? identity.suggestedName : "player";
      if (login.intent === "link") {
        const account = login.accountId ? store.account(login.accountId) : null;
        if (!account) throw new HttpFailure(401, "unauthorized", "The account that started this link no longer exists");
        const linked = store.linkProvider(account.id, provider.name, identity.providerUserId, now());
        log({ event: linked ? "account.linked" : "account.link_conflict", provider: provider.name, accountId: account.id });
        redirect(response, returnWith(login.returnUrl, linked ? { linked: provider.name } : { error: "provider_already_linked" }));
        return;
      }
      const account = store.findOrCreateAccount(provider.name, identity.providerUserId, suggestedName, now());
      const session = store.createSession(account.id, now(), settings.sessionTtlSeconds);
      log({ event: "login.complete", provider: provider.name, accountId: account.id });
      redirect(response, returnWith(login.returnUrl, {
        session: session.token, expiresAt: String(session.expiresAt), account: account.id, name: account.name,
      }));
      return;
    }

    if (method === "POST" && path === "/logout") {
      const session = bearer(request);
      store.revokeSession(session.token);
      log({ event: "session.revoked", accountId: session.account.id });
      json(response, 200, { ok: true }, corsFor(request)); return;
    }

    if (method === "POST" && path === "/logout/all") {
      const session = bearer(request);
      const revoked = store.revokeAllSessions(session.account.id);
      log({ event: "session.revoked_all", accountId: session.account.id, revoked });
      json(response, 200, { ok: true, revoked }, corsFor(request)); return;
    }

    if (method === "GET" && path === "/account") {
      const { account } = bearer(request);
      json(response, 200, { id: account.id, name: account.name, providers: account.providers }, corsFor(request)); return;
    }

    if (method === "POST" && path === "/account/name") {
      const { account } = bearer(request);
      const name = text((await body(request)).name, 64);
      if (!name || !NAME_PATTERN.test(name)) throw new HttpFailure(400, "invalid_name", "Names are 3 to 24 characters of letters, digits, underscore or hyphen");
      if (!store.renameAccount(account.id, name)) throw new HttpFailure(409, "name_taken", "That display name is taken");
      log({ event: "account.renamed", accountId: account.id });
      json(response, 200, { id: account.id, name, providers: account.providers }, corsFor(request)); return;
    }

    if (method === "POST" && segments[0] === "account" && segments[1] === "link" && segments.length === 3) {
      const { account } = bearer(request);
      const provider = providers.get(segments[2]!);
      if (!provider) throw new HttpFailure(404, "unknown_provider", "No such login provider");
      const returnUrl = redirectTarget((await body(request)).return);
      const pkce = provider.pkce ? pkcePair() : null;
      const state = store.createLoginState({ provider: provider.name, returnUrl, verifier: pkce?.verifier ?? null, intent: "link", accountId: account.id }, now(), settings.stateTtlSeconds);
      log({ event: "account.link_start", provider: provider.name, accountId: account.id });
      json(response, 200, { url: provider.authorizeUrl(state, `${publicUrl}/callback/${provider.name}`, pkce?.challenge) }, corsFor(request));
      return;
    }

    if (method === "POST" && path === "/token") {
      const { account } = bearer(request);
      const issuedAt = now();
      if (!tokenLimit.allow(account.id, issuedAt)) throw new HttpFailure(429, "rate_limited", "Too many join tokens; slow down");
      let endpoint: string;
      try { endpoint = audienceOf(String((await body(request)).audience ?? "")); }
      catch { throw new HttpFailure(400, "invalid_audience", "An audience endpoint URL is required"); }
      const claims = joinTokenClaims({ accountId: account.id, name: account.name, endpoint, issuedAt });
      const token = signJoinToken(store.activeSigningKey(issuedAt), claims);
      if (token.length > MAX_JOIN_TOKEN_CHARS) throw new HttpFailure(500, "token_failed", "Join token exceeds the join message limit");
      log({ event: "token.issued", accountId: account.id, audience: claims.aud, jti: claims.jti });
      json(response, 200, { token, expiresAt: claims.exp }, corsFor(request));
      return;
    }

    if (method === "GET" && path === "/servers") {
      json(response, 200, { servers: store.listServers(now(), settings.directoryTtlSeconds) },
        { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=30" });
      return;
    }

    if (method === "POST" && path === "/servers/register") {
      // Proxy headers are forgeable, so the window is keyed on the socket peer.
      const peer = request.socket.remoteAddress ?? "unknown";
      if (!registerLimit.allow(peer, now())) throw new HttpFailure(429, "rate_limited", "Too many registrations; slow down");
      const input = await body(request);
      const endpoint = gameEndpoint(input.endpoint);
      const name = text(input.name, 48);
      if (!name || !/^[A-Za-z0-9][A-Za-z0-9 _.'-]{2,47}$/.test(name)) throw new HttpFailure(400, "invalid_request", "A server name of 3 to 48 printable characters is required");
      const description = input.description === undefined ? undefined : text(input.description, 200) ?? undefined;
      if (input.description !== undefined && description === undefined) throw new HttpFailure(400, "invalid_request", "A description must be 1 to 200 characters");
      if (!options.allowPrivateServers && !await publicHost(new URL(endpoint).hostname, lookup)) {
        log({ event: "directory.refused", endpoint, reason: "private address" });
        throw new HttpFailure(422, "private_endpoint", "The endpoint does not resolve to a public address");
      }
      if (!await reachable(endpoint)) throw new HttpFailure(422, "unreachable", "The endpoint did not answer GET /worlds with a world list");
      if (!store.registerServer({ name, endpoint, ...(description ? { description } : {}) }, now(), settings.directoryCapacity))
        throw new HttpFailure(503, "directory_full", "The server directory is full");
      log({ event: "directory.registered", endpoint, name });
      json(response, 200, { ok: true }, { "Access-Control-Allow-Origin": "*" });
      return;
    }

    throw new HttpFailure(404, "not_found", "No such endpoint");
  }

  /**
   * Only list a server that answers as one. A redirect is a failure, not a hop to follow: the
   * address check applies to the endpoint that was submitted, not to wherever it points next.
   */
  async function reachable(endpoint: string): Promise<boolean> {
    try {
      const response = await fetchImpl(`${audienceOf(endpoint)}/worlds`, { redirect: "manual", signal: AbortSignal.timeout(4_000) });
      if (!response.ok) return false;
      if (Number(response.headers.get("content-length") ?? 0) > MAX_PROBE_BYTES) return false;
      const reader = response.body?.getReader();
      if (!reader) return false;
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_PROBE_BYTES) return false;
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      return Array.isArray(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch { return false; }
  }

  const http = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      const failure = error instanceof HttpFailure ? error : new HttpFailure(500, "internal_error", "The identity service failed to handle the request");
      if (!(error instanceof HttpFailure)) log({ event: "request.failed", path: request.url?.split("?")[0], reason: error instanceof Error ? error.message : "unknown" });
      if (response.headersSent) { response.end(); return; }
      json(response, failure.status, { error: { code: failure.code, message: failure.message } }, corsFor(request));
    });
  });
  http.headersTimeout = 10_000;
  http.requestTimeout = 20_000;
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve); });
  const address = http.address();
  if (!address || typeof address === "string") { store.close(); await new Promise<void>(resolve => http.close(() => resolve())); throw new Error("Identity service did not bind"); }
  if (!publicUrl) publicUrl = `http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}`;
  log({ event: "identity.ready", port: address.port, publicUrl, providers: [...providers.keys()], origins: [...origins] });

  let closing: Promise<void> | null = null;
  return {
    port: address.port, url: publicUrl,
    rotateSigningKey() { const key = store.rotateSigningKey(now()); log({ event: "keys.rotated", kid: key.kid }); return key.kid; },
    close() {
      closing ??= new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => { store.close(); resolve(); }); });
      return closing;
    },
  };
}
