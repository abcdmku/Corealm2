import type { SessionErrorCode } from "../contracts.js";
import { endpoint, record, SessionFailure } from "./protocol.js";

/**
 * The client half of the identity service.
 *
 * Login is a full page redirect that comes back with the session in the URL fragment, so the first
 * thing this does is read that fragment and rewrite the address bar without it: a session token
 * must not sit in the URL, in the history, or in a `Referer` header. The session itself is kept in
 * `localStorage` under one key, with the expiry the service reported.
 *
 * Join tokens are never stored. They live 60 seconds and are single use, so every join asks for a
 * new one for the endpoint it is about to connect to, reconnects included.
 *
 * Nothing here touches the DOM. `location`, `history` and `localStorage` arrive as ports so tests
 * can run in Node.
 */

const SESSION_KEY = "corealm.identity.v1";
const MAX_TOKEN_CHARS = 4_096;
const MAX_RESPONSE_CHARS = 65_536;
const MAX_DIRECTORY_SERVERS = 256;

export interface IdentityAccount { id: string; name: string }
export interface DirectoryServer { name: string; endpoint: string; description?: string }

export interface IdentityPorts {
  fetch?: typeof globalThis.fetch;
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  /** The page URL, fragment included. */
  href?(): string;
  /** Rewrites the address bar without navigating: how the session leaves the URL and the history. */
  replace?(url: string): void;
  /** A full page load, which is what leaving for the identity service is. */
  navigate?(url: string): void;
  /** Unix seconds, matching the service's `expiresAt`. */
  now?(): number;
}

interface StoredSession { token: string; expiresAt: number; account: IdentityAccount }

/**
 * What the service puts in the fragment when a login does not produce a session. A wrong password
 * never gets this far — that is answered on the service's own page — so this is the short list of
 * ways the round trip itself can end badly.
 */
const LOGIN_FAILURES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
};

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
function session(value: unknown): StoredSession | null {
  if (!record(value)) return null;
  const account = record(value.account) ? value.account : {};
  const token = text(value.token, 512), id = text(account.id, 128), name = text(account.name, 64);
  if (!token || !id || !name || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= 0) return null;
  return { token, expiresAt: Number(value.expiresAt), account: { id, name } };
}
function directoryServer(value: unknown): DirectoryServer | null {
  if (!record(value)) return null;
  const name = text(value.name, 48);
  if (!name) return null;
  let address: string;
  try { address = endpoint(value.endpoint); } catch { return null; }
  const description = text(value.description, 200);
  return { name, endpoint: address, ...(description ? { description } : {}) };
}

export class IdentityClient {
  private readonly base: string;
  private readonly ports: IdentityPorts;
  private readonly listeners = new Set<() => void>();
  private stored: StoredSession | null = null;
  private failure: string | null = null;
  constructor(baseUrl: string, ports: IdentityPorts = {}) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.ports = ports;
    this.stored = this.read();
    this.consumeFragment();
  }

  /** The signed-in account, or null. An expired session counts as signed out and is dropped here. */
  account(): IdentityAccount | null {
    if (this.stored && this.stored.expiresAt <= this.now()) this.clear();
    return this.stored?.account ?? null;
  }
  /** Why the last login attempt produced no session, for the selector to show once. */
  loginFailure(): string | null { return this.failure; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /**
   * Leaves the page for the identity service's own sign-in form and comes back to the same URL, so
   * the player keeps their place in the picker. The password is typed there and never here: this
   * code has no password field and no password endpoint to send one to.
   */
  login(): void { this.leave("/login"); }

  /** The same round trip for a password change. It returns signed in, with every other session gone. */
  changePassword(): void { this.leave("/password"); }

  private leave(path: string): void {
    const url = new URL(this.href()); url.hash = "";
    this.failure = null;
    this.navigate(`${this.base}${path}?return=${encodeURIComponent(url.href)}`);
  }

  async logout(): Promise<void> {
    const current = this.stored;
    this.clear();
    if (!current) return;
    // The local session is gone either way; revoking it on the service is best effort.
    try { await this.fetch()(`${this.base}/logout`, { method: "POST", credentials: "omit", redirect: "error", headers: { Authorization: `Bearer ${current.token}` } }); }
    catch { /* Offline sign-out still signs this browser out. */ }
  }

  /** Confirms a stored session against the service and picks up a name changed elsewhere. */
  async refresh(): Promise<IdentityAccount | null> {
    if (!this.account()) return null;
    try {
      const body = await this.call("/account", { method: "GET" });
      return this.adopt(body);
    } catch (error) {
      // A revoked session already cleared itself in `call`. Anything else leaves it alone.
      if (error instanceof SessionFailure && error.code === "UNAUTHORIZED") return null;
      return this.stored?.account ?? null;
    }
  }

  async rename(name: string): Promise<IdentityAccount> {
    return this.adopt(await this.call("/account/name", { method: "POST", body: { name } }));
  }

  /**
   * A fresh join token for one endpoint. Single use and 60 seconds long, so callers request one per
   * join attempt and never keep it.
   */
  async joinToken(target: string, signal?: AbortSignal): Promise<string> {
    if (!this.account()) throw new SessionFailure("UNAUTHORIZED", "Sign in to join this world");
    const body = await this.call("/token", { method: "POST", body: { audience: target }, signal });
    const token = text(body.token, MAX_TOKEN_CHARS);
    if (!token || !Number.isSafeInteger(body.expiresAt)) throw new SessionFailure("INVALID_MESSAGE", "The identity service returned an unusable join token");
    return token;
  }

  /** The public server directory. Needs no session. */
  async servers(signal?: AbortSignal): Promise<DirectoryServer[]> {
    const response = await this.fetch()(`${this.base}/servers`, { credentials: "omit", redirect: "error", ...(signal ? { signal } : {}) });
    if (!response.ok) throw await this.failed(response);
    const body = await this.json(response);
    if (!Array.isArray(body.servers) || body.servers.length > MAX_DIRECTORY_SERVERS) throw new SessionFailure("INVALID_MESSAGE", "The identity service returned an unusable server directory");
    // One malformed row must not hide the servers that parsed.
    return body.servers.map(directoryServer).filter((server): server is DirectoryServer => server !== null);
  }

  private adopt(body: Record<string, unknown>): IdentityAccount {
    const id = text(body.id, 128), name = text(body.name, 64);
    if (!id || !name) throw new SessionFailure("INVALID_MESSAGE", "The identity service returned an unusable account");
    const account = { id, name };
    if (this.stored) this.write({ ...this.stored, account });
    return account;
  }

  private async call(path: string, request: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal }): Promise<Record<string, unknown>> {
    const current = this.stored;
    if (!current) throw new SessionFailure("UNAUTHORIZED", "Sign in first");
    const response = await this.fetch()(`${this.base}${path}`, {
      method: request.method, credentials: "omit", redirect: "error",
      headers: { Authorization: `Bearer ${current.token}`, ...(request.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (response.status === 401) { this.clear(); throw new SessionFailure("UNAUTHORIZED", "Your sign-in expired. Sign in again."); }
    if (!response.ok) throw await this.failed(response);
    return this.json(response);
  }

  /** `{"error":{"code","message"}}`, mapped onto the codes the session layer already understands. */
  private async failed(response: Response): Promise<SessionFailure> {
    const code: SessionErrorCode = response.status === 429 ? "RATE_LIMITED"
      : response.status >= 400 && response.status < 500 ? "INVALID_MESSAGE" : "UNAVAILABLE";
    let message = "The identity service could not answer";
    try {
      const body = await this.json(response);
      const detail = record(body.error) ? text(body.error.message, 256) : null;
      if (detail) message = detail;
    } catch { /* A body that is not the documented error shape leaves the status message. */ }
    return new SessionFailure(code, message);
  }

  private async json(response: Response): Promise<Record<string, unknown>> {
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new SessionFailure("INVALID_MESSAGE", "The identity service returned an oversized response");
    let value: unknown;
    try { value = JSON.parse(body); } catch { throw new SessionFailure("INVALID_MESSAGE", "The identity service returned invalid JSON"); }
    if (!record(value)) throw new SessionFailure("INVALID_MESSAGE", "The identity service returned an unusable response");
    return value;
  }

  /**
   * Reads the login result out of the fragment and takes it out of the URL in the same step, so a
   * copied address, a bookmark or a back button never carries a session.
   */
  private consumeFragment(): void {
    let url: URL;
    try { url = new URL(this.href()); } catch { return; }
    const hash = url.hash.replace(/^#/, "");
    if (!hash) return;
    const values = new URLSearchParams(hash);
    if (!values.has("session") && !values.has("error")) return;
    url.hash = "";
    this.replace(url.href);
    const error = values.get("error");
    if (error) { this.failure = LOGIN_FAILURES[error] ?? "Sign-in did not finish. Try again."; this.publish(); return; }
    const token = values.get("session");
    if (token === null) { this.publish(); return; }
    const parsed = session({ token, expiresAt: Number(values.get("expiresAt")), account: { id: values.get("account"), name: values.get("name") } });
    if (!parsed || parsed.expiresAt <= this.now()) { this.failure = "Sign-in returned an unusable session. Try again."; this.publish(); return; }
    this.failure = null;
    this.write(parsed);
  }

  private read(): StoredSession | null {
    let raw: string | null = null;
    try { raw = this.storage()?.getItem(SESSION_KEY) ?? null; } catch { return null; }
    if (!raw) return null;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    const parsed = session(value);
    if (!parsed || parsed.expiresAt <= this.now()) { this.forget(); return null; }
    return parsed;
  }
  private write(next: StoredSession): void {
    this.stored = next;
    try { this.storage()?.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* Private mode: this session still works until the tab closes. */ }
    this.publish();
  }
  private clear(): void { this.stored = null; this.forget(); this.publish(); }
  private forget(): void { try { this.storage()?.removeItem(SESSION_KEY); } catch { /* Nothing to forget. */ } }
  private publish(): void { for (const listener of [...this.listeners]) listener(); }

  private storage(): IdentityPorts["storage"] {
    if (this.ports.storage) return this.ports.storage;
    return typeof localStorage === "undefined" ? undefined : localStorage;
  }
  private fetch(): typeof globalThis.fetch { return this.ports.fetch ?? globalThis.fetch.bind(globalThis); }
  private href(): string { return this.ports.href?.() ?? (typeof location === "undefined" ? "http://localhost/" : location.href); }
  private replace(url: string): void {
    if (this.ports.replace) { this.ports.replace(url); return; }
    if (typeof history !== "undefined") history.replaceState(history.state, "", url);
  }
  private navigate(url: string): void {
    if (this.ports.navigate) { this.ports.navigate(url); return; }
    if (typeof location !== "undefined") location.assign(url);
  }
  private now(): number { return this.ports.now?.() ?? Math.floor(Date.now() / 1000); }
}
