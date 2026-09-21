import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { publicHost, type AddressLookup } from "./addresses.js";
import { audienceOf, joinTokenClaims, signJoinToken, MAX_JOIN_TOKEN_CHARS } from "./joinToken.js";
import { displayOrigin, formPage, noticePage, pageHeaders, type PageKind } from "./pages.js";
import { HashingBusy, passwordProblem, ScryptHasher, type PasswordHashing } from "./passwords.js";
import { IdentityStore, NAME_PATTERN, reservedName, type AccountView } from "./store.js";

/**
 * The identity service. It owns accounts, sessions, the signing keys and the public server
 * directory, and it issues short lived join tokens that game servers verify offline.
 *
 * An account is a username and a password. The password is typed on this origin and nowhere else:
 * the game client and devdocs send a browser to `GET /login?return=<their URL>` and get it back with
 * a session in the fragment, exactly as they did when this was an OAuth service. Neither of them
 * ever sees a password, so there is no JSON password endpoint and no CORS rule that would let one
 * be posted from another origin.
 */

export type FetchLike = typeof globalThis.fetch;

export interface IdentityServiceOptions {
  /** Exact browser origins allowed to call the service and to receive a login redirect. */
  allowedOrigins: readonly string[];
  /** Directory holding `identity.sqlite`. Created by the caller. */
  dataDir: string;
  /** Public origin of this service. Also what a form POST's `Origin` header has to match. */
  publicUrl?: string;
  host?: string;
  port?: number;
  /** Whether `GET /register` hands out accounts, or answers that registration is closed. */
  registration?: "open" | "closed";
  /** Injected so tests can hash with a cost that runs in milliseconds. */
  hasher?: PasswordHashing;
  /** Read `X-Forwarded-For` for the per-address limits. Only ever with a proxy you run in front. */
  trustProxy?: boolean;
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
  loginWindowSeconds?: number;
  loginsPerName?: number;
  loginsPerAddress?: number;
  registrationWindowSeconds?: number;
  registrationsPerAddress?: number;
  registrationsPerWindow?: number;
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
const MAX_FIELD_CHARS = 1_024;
const DEFAULTS = {
  sessionTtlSeconds: 30 * 24 * 60 * 60, stateTtlSeconds: 900, directoryTtlSeconds: 600,
  directoryCapacity: 256, tokensPerMinute: 60, registrationsPerMinute: 10,
  // Ten tries per name per quarter hour, then the window has to run out. Nothing locks an account:
  // a permanent lock is a denial of service lever anyone who knows a name can pull.
  loginWindowSeconds: 900, loginsPerName: 10, loginsPerAddress: 30,
  registrationWindowSeconds: 3_600, registrationsPerAddress: 5, registrationsPerWindow: 60,
};
/** One wording for every refused sign-in, whoever the name belongs to. */
const SIGN_IN_REFUSED = "That username and password do not match.";
const BUSY = "The service is busy signing people in. Try again in a moment.";
const EXPIRED_FORM = "This form expired or was already used. Start signing in again from the game.";

class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "HttpFailure"; }
}

/** A fixed window per key. Enough to stop a loop, cheap enough to run on every request. */
class RateWindow {
  private readonly hits = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowSeconds = 60) {}
  allow(key: string, now: number): boolean {
    for (const [name, hit] of this.hits) if (now - hit.start >= this.windowSeconds) this.hits.delete(name);
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= this.windowSeconds) { this.hits.set(key, { start: now, count: 1 }); return true; }
    hit.count++;
    return hit.count <= this.limit;
  }
  /** A sign-in that worked clears the name's window, so one player's typos cannot lock them out. */
  forget(key: string): void { this.hits.delete(key); }
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
    loginWindowSeconds: options.loginWindowSeconds ?? DEFAULTS.loginWindowSeconds,
    loginsPerName: options.loginsPerName ?? DEFAULTS.loginsPerName,
    loginsPerAddress: options.loginsPerAddress ?? DEFAULTS.loginsPerAddress,
    registrationWindowSeconds: options.registrationWindowSeconds ?? DEFAULTS.registrationWindowSeconds,
    registrationsPerAddress: options.registrationsPerAddress ?? DEFAULTS.registrationsPerAddress,
    registrationsPerWindow: options.registrationsPerWindow ?? DEFAULTS.registrationsPerWindow,
  };
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;
  const lookup: AddressLookup = options.lookup ?? (hostname => dnsLookup(hostname, { all: true, verbatim: true }));
  const log = options.log ?? ((event: Record<string, unknown>) => console.log(JSON.stringify(event)));
  const hasher = options.hasher ?? new ScryptHasher();
  const registrationOpen = (options.registration ?? "open") === "open";
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
  const renameLimit = new RateWindow(settings.loginsPerName, settings.loginWindowSeconds);
  const loginNameLimit = new RateWindow(settings.loginsPerName, settings.loginWindowSeconds);
  const loginAddressLimit = new RateWindow(settings.loginsPerAddress, settings.loginWindowSeconds);
  const signUpAddressLimit = new RateWindow(settings.registrationsPerAddress, settings.registrationWindowSeconds);
  const signUpLimit = new RateWindow(settings.registrationsPerWindow, settings.registrationWindowSeconds);
  let publicUrl = options.publicUrl?.replace(/\/+$/, "") ?? "";

  function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload), ...headers });
    response.end(payload);
  }
  /** Every HTML answer, including the failures, carries the same locked-down headers. */
  function html(response: ServerResponse, status: number, body: string, returnOrigin?: string): void {
    response.writeHead(status, { ...pageHeaders(returnOrigin), "Content-Length": Buffer.byteLength(body) });
    response.end(body);
  }
  function notice(response: ServerResponse, status: number, heading: string, body: string): void {
    html(response, status, noticePage({ title: `${heading} · Corealm`, heading, body }));
  }
  function corsFor(request: IncomingMessage): Record<string, string> {
    const origin = request.headers.origin;
    // Exact match only, and no credentials header: sessions travel as bearer tokens.
    return typeof origin === "string" && origins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
  }
  /** The socket peer, or the proxy's report of it when a proxy in front is explicitly trusted. */
  function clientAddress(request: IncomingMessage): string {
    if (options.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.socket.remoteAddress ?? "unknown";
  }
  async function rawBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += (chunk as Buffer).length;
      if (length > MAX_BODY_BYTES) throw new HttpFailure(413, "payload_too_large", "Request bodies are capped at 8 KiB");
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }
  async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await rawBody(request);
    if (!raw.length) return {};
    let value: unknown;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new HttpFailure(400, "invalid_request", "A JSON body is required"); }
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
  /** The allow-list is what keeps this from being an open redirect that leaks a session. */
  function allowedReturn(value: unknown): string | null {
    const raw = text(value, 2048);
    if (!raw) return null;
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    return origins.has(url.origin) && !url.username && !url.password ? url.href : null;
  }
  function redirectTarget(value: unknown): string {
    const target = allowedReturn(value);
    if (!target) throw new HttpFailure(400, "invalid_return", "The return URL must be an allowed origin");
    return target;
  }
  /** 303 after a form, so a refresh on the way back does not re-post the password. */
  function redirect(response: ServerResponse, location: string): void {
    response.writeHead(303, {
      Location: location, "Cache-Control": "no-store", "Content-Length": 0,
      "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    });
    response.end();
  }
  /** The web apps are static and cross origin, so the session comes back in the fragment. */
  function returnWith(target: string, values: Record<string, string>): string {
    const url = new URL(target);
    url.hash = new URLSearchParams(values).toString();
    return url.href;
  }
  function signedIn(response: ServerResponse, account: AccountView, returnUrl: string): void {
    const session = store.createSession(account.id, now(), settings.sessionTtlSeconds);
    redirect(response, returnWith(returnUrl, {
      session: session.token, expiresAt: String(session.expiresAt), account: account.id, name: account.name,
    }));
  }

  /** A form page with a fresh single-use state bound to the return URL it was built for. */
  function form(response: ServerResponse, kind: PageKind, returnUrl: string, status = 200, detail: { username?: string; error?: string } = {}): void {
    const state = store.createLoginState({ purpose: kind, returnUrl }, now(), settings.stateTtlSeconds);
    html(response, status, formPage({ kind, state, returnUrl, registrationOpen, ...detail }), displayOrigin(returnUrl));
  }

  /**
   * A password form is posted from this origin by a browser the service itself sent the page to.
   * The state already binds the destination; this is what stops another site posting its own form
   * here and signing a player into an account they did not choose.
   *
   * `Sec-Fetch-Site` leads, because these pages are served with `Referrer-Policy: no-referrer` and
   * that makes a browser send `Origin: null` on the form POST — by the letter of the Fetch standard,
   * not as a quirk. A browser old enough to send neither header is refused rather than trusted.
   */
  function sameOriginPost(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const host = request.headers.host;
    const named = typeof origin === "string" && origin !== "null";
    const matches = named && (origin === publicUrl || (typeof host === "string" && (origin === `http://${host}` || origin === `https://${host}`)));
    const site = request.headers["sec-fetch-site"];
    if (typeof site === "string") return site === "same-origin" && (!named || matches);
    return matches;
  }
  function field(values: URLSearchParams, name: string): string {
    const value = values.get(name);
    return typeof value === "string" && value.length <= MAX_FIELD_CHARS ? value : "";
  }

  async function handleForm(request: IncomingMessage, response: ServerResponse, kind: PageKind): Promise<void> {
    const values = new URLSearchParams((await rawBody(request)).toString("utf8"));
    if (!sameOriginPost(request)) { notice(response, 403, "Sign-in refused", "This form was sent from another site. Start signing in again from the game."); return; }
    const state = store.consumeLoginState(field(values, "state"), now());
    // The return URL comes from the row the service wrote, never from the body, and is checked
    // again in case the allow-list changed while the form was open.
    const returnUrl = state && state.purpose === kind ? allowedReturn(state.returnUrl) : null;
    if (!returnUrl) { notice(response, 400, "This form expired", EXPIRED_FORM); return; }
    const username = field(values, "username").trim();
    const password = field(values, "password");
    const address = clientAddress(request);
    try {
      if (kind === "login") await signIn(response, returnUrl, username, password, address);
      else if (kind === "register") await signUp(response, returnUrl, username, password, address);
      else await changePassword(response, returnUrl, username, field(values, "current"), password, address);
    } catch (error) {
      if (!(error instanceof HashingBusy)) throw error;
      log({ event: "hash.busy", purpose: kind });
      form(response, kind, returnUrl, 503, { error: BUSY });
    }
  }

  async function signIn(response: ServerResponse, returnUrl: string, username: string, password: string, address: string): Promise<void> {
    const key = username.toLowerCase();
    if (!loginNameLimit.allow(key, now()) || !loginAddressLimit.allow(address, now())) {
      log({ event: "login.rate_limited" });
      form(response, "login", returnUrl, 429, { error: "Too many sign-in attempts. Wait a few minutes, then try again." });
      return;
    }
    const account = NAME_PATTERN.test(username) ? store.accountByName(username) : null;
    // An unknown name, an unclaimed account and a wrong password all run one real hash and answer
    // the same thing, so none of the three can be told apart by what comes back or how long it took.
    const result = await hasher.verify(password, account?.passwordHash ?? null);
    if (!result.ok || !account) {
      log({ event: "login.refused" });
      form(response, "login", returnUrl, 401, { error: SIGN_IN_REFUSED });
      return;
    }
    if (result.stale) store.setPassword(account.id, await hasher.hash(password));
    loginNameLimit.forget(key);
    log({ event: "login.complete", accountId: account.id, rehashed: result.stale });
    signedIn(response, account, returnUrl);
  }

  async function signUp(response: ServerResponse, returnUrl: string, username: string, password: string, address: string): Promise<void> {
    if (!registrationOpen) { notice(response, 403, "Registration is closed", "This Corealm is not taking new accounts. Ask the operator for one."); return; }
    if (!signUpAddressLimit.allow(address, now()) || !signUpLimit.allow("all", now())) {
      log({ event: "register.rate_limited" });
      form(response, "register", returnUrl, 429, { error: "Too many accounts have been created recently. Try again later." });
      return;
    }
    const refuse = (status: number, error: string) => form(response, "register", returnUrl, status, { username, error });
    if (!NAME_PATTERN.test(username)) { refuse(400, "A username is 3 to 24 characters of letters, digits, underscore or hyphen."); return; }
    if (reservedName(username)) { refuse(400, "That username is reserved. Choose another."); return; }
    const problem = passwordProblem(password, username);
    if (problem) { refuse(400, problem); return; }
    // Hash before the insert: the name is only claimed once there is a credential to claim it with.
    const account = store.createAccount(username, await hasher.hash(password), now());
    if (!account) { refuse(409, "That username is taken. Choose another."); return; }
    log({ event: "account.created", accountId: account.id });
    signedIn(response, account, returnUrl);
  }

  async function changePassword(response: ServerResponse, returnUrl: string, username: string, current: string, next: string, address: string): Promise<void> {
    const key = username.toLowerCase();
    if (!loginNameLimit.allow(key, now()) || !loginAddressLimit.allow(address, now())) {
      form(response, "password", returnUrl, 429, { error: "Too many attempts. Wait a few minutes, then try again." });
      return;
    }
    const account = NAME_PATTERN.test(username) ? store.accountByName(username) : null;
    const result = await hasher.verify(current, account?.passwordHash ?? null);
    if (!result.ok || !account) {
      log({ event: "password.refused" });
      form(response, "password", returnUrl, 401, { error: SIGN_IN_REFUSED });
      return;
    }
    const problem = passwordProblem(next, username);
    if (problem) { form(response, "password", returnUrl, 400, { username, error: problem }); return; }
    store.setPassword(account.id, await hasher.hash(next));
    // A password change is what someone does when they think a session leaked, so every session
    // that existed goes; the browser doing the changing gets a new one on the way back.
    const revoked = store.revokeAllSessions(account.id);
    loginNameLimit.forget(key);
    log({ event: "password.changed", accountId: account.id, revoked });
    signedIn(response, account, returnUrl);
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!request.url || request.url.length > MAX_URL_CHARS) throw new HttpFailure(414, "invalid_request", "Request URL is too long");
    const url = new URL(request.url, "http://identity.invalid");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method ?? "GET";

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

    // The pages. Passwords are typed here and only here, so these are the only routes that render
    // HTML, and they are served with a policy that permits nothing but their own inline stylesheet.
    if ((method === "GET" || method === "POST") && (path === "/login" || path === "/register" || path === "/password")) {
      const kind = path.slice(1) as PageKind;
      if (method === "POST") { await handleForm(request, response, kind); return; }
      if (kind === "register" && !registrationOpen) {
        notice(response, 403, "Registration is closed", "This Corealm is not taking new accounts. Ask the operator for one.");
        return;
      }
      const returnUrl = allowedReturn(url.searchParams.get("return"));
      if (!returnUrl) {
        notice(response, 400, "Sign-in refused", "This link does not name a Corealm site that may receive a sign-in. Start again from the game.");
        return;
      }
      form(response, kind, returnUrl);
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
      json(response, 200, { id: account.id, name: account.name }, corsFor(request)); return;
    }

    // A rename is a bearer call from the game origin, so it asks for no password: a password must
    // not travel to an origin that is not this one. It is limited like a sign-in instead.
    if (method === "POST" && path === "/account/name") {
      const { account } = bearer(request);
      if (!renameLimit.allow(account.id, now())) throw new HttpFailure(429, "rate_limited", "Too many name changes; slow down");
      const name = text((await body(request)).name, 64);
      if (!name || !NAME_PATTERN.test(name)) throw new HttpFailure(400, "invalid_name", "Names are 3 to 24 characters of letters, digits, underscore or hyphen");
      if (reservedName(name)) throw new HttpFailure(400, "reserved_name", "That display name is reserved");
      if (!store.renameAccount(account.id, name)) throw new HttpFailure(409, "name_taken", "That display name is taken");
      log({ event: "account.renamed", accountId: account.id });
      json(response, 200, { id: account.id, name }, corsFor(request)); return;
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
      // Proxy headers are forgeable, so the window is keyed on the socket peer unless a proxy is trusted.
      if (!registerLimit.allow(clientAddress(request), now())) throw new HttpFailure(429, "rate_limited", "Too many registrations; slow down");
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
      const failure = error instanceof HttpFailure ? error
        : error instanceof HashingBusy ? new HttpFailure(503, "busy", BUSY)
        : new HttpFailure(500, "internal_error", "The identity service failed to handle the request");
      if (failure.status >= 500 && !(error instanceof HashingBusy)) log({ event: "request.failed", path: request.url?.split("?")[0], reason: error instanceof Error ? error.message : "unknown" });
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
  log({ event: "identity.ready", port: address.port, publicUrl, registration: registrationOpen ? "open" : "closed", origins: [...origins] });

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
