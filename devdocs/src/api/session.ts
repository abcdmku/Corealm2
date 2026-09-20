/**
 * The admin session devdocs holds against one game server.
 *
 * Signing in is three steps and only the middle one involves the game server's identity: the browser
 * signs in to the identity service (which the *page* names, never the server — a hostile server that
 * could name its own identity service could harvest sessions), asks it for a join token minted for
 * this server's public endpoint, and exchanges that token at `POST /admin/session` for a session that
 * lasts 12 hours. The join token is single use and lives 60 seconds; only the session is kept.
 *
 * The session lives in `sessionStorage`, not `localStorage`: it is an administrative credential for
 * one tab, and closing the tab should end it. Drafts live in the draft store and survive an expiry,
 * so a 401 puts the author back on the sign-in screen with their work intact.
 */

const SESSION_KEY = "corealm.devdocs.admin.v1";
const SERVER_KEY = "corealm.devdocs.server.v1";
const ACCOUNT_ID = /^acc_[A-Za-z0-9_-]{1,64}$/;

export type ServerRole = "owner" | "admin";

export interface AdminSession {
  /** The game server's base URL, no trailing slash. */
  server: string;
  /** The audience the join token was minted for: the server's own public endpoint origin. */
  audience: string;
  token: string;
  expiresAt: number;
  accountId: string;
  name: string;
  role: ServerRole;
}

const storage = (): Storage | undefined => {
  try { return typeof sessionStorage === "undefined" ? undefined : sessionStorage; } catch { return undefined; }
};
const local = (): Storage | undefined => {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
};

function parse(value: unknown, now: number): AdminSession | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const text = (field: unknown, max: number): string | null => typeof field === "string" && field.length > 0 && field.length <= max ? field : null;
  const server = text(row.server, 2048), audience = text(row.audience, 2048), token = text(row.token, 512);
  const accountId = text(row.accountId, 128), name = text(row.name, 64);
  if (!server || !audience || !token || !accountId || !name) return null;
  if (row.role !== "owner" && row.role !== "admin") return null;
  if (!Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) <= now) return null;
  return { server, audience, token, expiresAt: Number(row.expiresAt), accountId, name, role: row.role };
}

/** The session this tab holds, or null. An expired one is dropped here rather than presented. */
export function readSession(now = Date.now()): AdminSession | null {
  let raw: string | null = null;
  try { raw = storage()?.getItem(SESSION_KEY) ?? null; } catch { return null; }
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { clearSession(); return null; }
  const session = parse(value, now);
  if (!session) { clearSession(); return null; }
  return session;
}
export function writeSession(session: AdminSession): void {
  try { storage()?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Private mode still works until the tab closes. */ }
}
export function clearSession(): void {
  try { storage()?.removeItem(SESSION_KEY); } catch { /* Nothing to forget. */ }
}

/** The server address an admin typed last, so a devdocs hosted away from its server asks once. */
export function rememberedServer(): string | null {
  try { return local()?.getItem(SERVER_KEY) ?? null; } catch { return null; }
}
export function rememberServer(url: string): void {
  try { local()?.setItem(SERVER_KEY, url); } catch { /* Remembering is a convenience. */ }
}

/** A base URL for a game server: an origin with an optional path, `http` or `https`, no query. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter the address of the game server.");
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new Error("That is not a usable server address."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("A server address is http or https.");
  if (url.search || url.hash || url.username || url.password) throw new Error("A server address carries no query, fragment or credentials.");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The identity service address, which belongs to the page and never to a game server. */
export function identityUrl(): string | null {
  const configured = (globalThis as { __COREALM_IDENTITY_URL__?: unknown }).__COREALM_IDENTITY_URL__;
  const baked = import.meta.env?.VITE_COREALM_IDENTITY_URL;
  const raw = typeof configured === "string" && configured.trim() ? configured.trim()
    : typeof baked === "string" ? baked.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

/** `GET /admin/info`, which is public because the login screen needs it before there is a session. */
export interface ServerDescriptor {
  name: string;
  /** The public endpoint. The join token's audience comes from this, not from the typed address. */
  endpoint: string;
  assetBaseUrl: string;
  /** The identity service this server verifies join tokens against, for the same-origin case only. */
  identityUrl: string | null;
  catalogRevision: string;
}

/**
 * A join token's audience is the server's public endpoint reduced to an origin, which is not
 * necessarily the address the admin typed: a host behind a proxy, or reached by LAN address, still
 * mints tokens for the endpoint it published. `/admin/info` reports it, so it is read rather than guessed.
 * Mirrors `audienceOf()` in `identity/src/joinToken.ts`, which is server-only code.
 */
export function audienceOf(endpoint: string): string {
  const url = new URL(endpoint);
  const protocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol;
  return `${protocol}//${url.host}`;
}

const MAX_INFO_BYTES = 262_144;

/** Reads `GET /admin/info` for the server's name, token audience, asset host and catalog revision. */
export async function readDescriptor(server: string, fetcher: typeof globalThis.fetch = fetch, signal?: AbortSignal): Promise<ServerDescriptor> {
  const response = await fetcher(`${server}/admin/info`, { credentials: "omit", ...(signal ? { signal } : {}) });
  if (response.status === 501) throw new Error("That server does not use accounts, so it has no administration.");
  if (!response.ok) throw new Error(`That server did not answer (${response.status}). Check the address.`);
  const text = await response.text();
  if (text.length > MAX_INFO_BYTES) throw new Error("That server returned an unusable description.");
  let info: unknown;
  try { info = JSON.parse(text); } catch { throw new Error("That address does not look like a Corealm server."); }
  if (info === null || typeof info !== "object" || Array.isArray(info)) throw new Error("That address does not look like a Corealm server.");
  const row = info as Record<string, unknown>;
  if (typeof row.endpoint !== "string") throw new Error("That server published no endpoint, so it cannot be signed in to.");
  return {
    name: typeof row.name === "string" && row.name ? row.name : server,
    endpoint: row.endpoint,
    assetBaseUrl: typeof row.assetBaseUrl === "string" ? row.assetBaseUrl : "",
    identityUrl: typeof row.identityUrl === "string" && row.identityUrl ? row.identityUrl : null,
    catalogRevision: typeof row.catalogRevision === "string" ? row.catalogRevision : "",
  };
}

const origin = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch { return null; }
};

/**
 * Which identity service to sign in through, and whether it may be used at all.
 *
 * The page decides. A game server an admin typed the address of must not get to choose where the
 * login goes, or a hostile address could point the browser at a lookalike and collect the session.
 * The one exception is a build the game server served itself: the page and the API are then the same
 * origin and the same trust domain, so its `/admin/info` may answer when the page names nothing.
 * When both name one and they disagree, neither is used: the admin is at the wrong server.
 */
export type IdentityChoice = { ok: true; url: string } | { ok: false; reason: string };

export function chooseIdentity(configured: string | null, server: string, reported: string | null, pageOrigin: string | null): IdentityChoice {
  const sameOrigin = pageOrigin !== null && origin(server) === pageOrigin;
  if (configured && reported && origin(configured) !== origin(reported)) {
    return { ok: false, reason: `This server signs in through ${origin(reported) ?? reported}, and this page is configured for ${origin(configured) ?? configured}. Sign in from a page configured for that identity service.` };
  }
  if (configured) return { ok: true, url: configured };
  if (sameOrigin && reported) {
    const url = origin(reported) === null ? null : reported.replace(/\/+$/, "");
    if (url) return { ok: true, url };
  }
  if (reported) return { ok: false, reason: "This page names no identity service. A server reached by address does not get to choose one, so set `window.__COREALM_IDENTITY_URL__` on the page or build it with `VITE_COREALM_IDENTITY_URL`." };
  return { ok: false, reason: "Neither this page nor this server names an identity service, so there is no way to sign in." };
}

export class AdminFailure extends Error {
  /** Fields the endpoint put beside `code` and `message`: `stale`, `revisions`, `blockers`, `problems`, `world`. */
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Readonly<Record<string, unknown>> = {}) {
    super(message); this.name = "AdminFailure";
  }
}

/** `{"error":{"code","message",...}}`, which is what every admin endpoint answers a failure with. */
export async function adminFailure(response: Response): Promise<AdminFailure> {
  let code = "unknown", message = `The server answered ${response.status}.`, details: Record<string, unknown> = {};
  try {
    const body = await response.json() as { error?: unknown };
    if (body.error !== null && typeof body.error === "object" && !Array.isArray(body.error)) {
      const { code: reported, message: reason, ...rest } = body.error as Record<string, unknown>;
      if (typeof reported === "string") code = reported;
      if (typeof reason === "string") message = reason;
      details = rest;
    }
  } catch { /* A body that is not the documented shape leaves the status message. */ }
  return new AdminFailure(response.status, code, message, details);
}

export interface SignInInput {
  server: string;
  audience: string;
  /** A fresh join token for `audience`, from the identity service. */
  joinToken: string;
  /** Present only when claiming an unowned server with its one-time setup code. */
  setupCode?: string;
}

/**
 * Exchanges a join token for an admin session. `POST /admin/setup` when a setup code is given, which
 * makes the caller owner of a server that has none, and `POST /admin/session` otherwise.
 */
export async function exchangeSession(input: SignInInput, fetcher: typeof globalThis.fetch = fetch): Promise<AdminSession> {
  const path = input.setupCode ? "/admin/setup" : "/admin/session";
  const response = await fetcher(`${input.server}${path}`, {
    method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
    body: JSON.stringify(input.setupCode ? { token: input.joinToken, code: input.setupCode } : { token: input.joinToken }),
  });
  if (!response.ok) throw await adminFailure(response);
  // The reply names the secret `session`; it is the bearer token from here on.
  const body = await response.json() as Record<string, unknown>;
  const session = parse({ ...body, token: body.session, server: input.server, audience: input.audience }, Date.now());
  if (!session) throw new AdminFailure(response.status, "invalid_response", "That server returned an unusable admin session.");
  return session;
}

/** Best effort: the local session is gone either way. */
export async function revokeSession(session: AdminSession, fetcher: typeof globalThis.fetch = fetch): Promise<void> {
  clearSession();
  try { await fetcher(`${session.server}/admin/session`, { method: "DELETE", credentials: "omit", headers: { Authorization: `Bearer ${session.token}` } }); }
  catch { /* Signing out of this browser does not depend on the server hearing about it. */ }
}

export { ACCOUNT_ID };
