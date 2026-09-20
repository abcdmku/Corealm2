import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createSigningKey, type IdentityKey, type SigningKey } from "./joinToken.js";

/** One SQLite file holds accounts, provider links, sessions, login states, keys and the directory. */

export interface Account { id: string; name: string; createdAt: number }
export interface AccountView extends Account { providers: string[] }
export interface LoginState {
  state: string; provider: string; returnUrl: string; verifier: string | null;
  intent: "login" | "link"; accountId: string | null; createdAt: number;
}
export interface DirectoryEntry { name: string; endpoint: string; description?: string; registeredAt: number; lastSeenAt: number }

/** Display names are what other players see, so keep them short, printable and unambiguous. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
/** Retired keys stay published well past the 60 second token lifetime, then go. */
export const KEY_RETENTION_SECONDS = 3_600;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS signing_keys (kid TEXT PRIMARY KEY, private_key TEXT NOT NULL, public_key TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, retired_at INTEGER) STRICT",
  "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS account_providers (provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, account_id TEXT NOT NULL, linked_at INTEGER NOT NULL, PRIMARY KEY (provider, provider_user_id)) STRICT",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS login_states (state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, return_url TEXT NOT NULL, verifier TEXT, intent TEXT NOT NULL, account_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS servers (endpoint TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, registered_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL) STRICT",
];

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString("base64url"); }
/** Bearer tokens and login states are stored hashed: a stolen database cannot impersonate anyone. */
export function hashToken(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
export function newAccountId(): string { return `acc_${randomBytes(16).toString("base64url")}`; }

export class IdentityStore {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
      for (const statement of SCHEMA) this.db.exec(statement);
    } catch (error) { this.db.close(); throw error; }
  }

  // Keys ---------------------------------------------------------------------
  /** The key that signs. Generated on first start so a fresh deployment needs no key ceremony. */
  activeSigningKey(now: number): SigningKey {
    const row = this.db.prepare("SELECT kid, private_key FROM signing_keys WHERE status='active' ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    if (row) return { kid: String(row.kid), privateKey: String(row.private_key) };
    const created = createSigningKey();
    this.db.prepare("INSERT INTO signing_keys (kid, private_key, public_key, status, created_at, retired_at) VALUES (?,?,?,'active',?,NULL)")
      .run(created.signing.kid, created.signing.privateKey, created.publicKey, now);
    return created.signing;
  }
  /** Rotate: the current key is retired but stays published until its last token has expired. */
  rotateSigningKey(now: number): SigningKey {
    this.db.prepare("UPDATE signing_keys SET status='retired', retired_at=? WHERE status='active'").run(now);
    this.db.prepare("DELETE FROM signing_keys WHERE status='retired' AND retired_at < ?").run(now - KEY_RETENTION_SECONDS);
    return this.activeSigningKey(now);
  }
  publishedKeys(now: number): IdentityKey[] {
    this.db.prepare("DELETE FROM signing_keys WHERE status='retired' AND retired_at < ?").run(now - KEY_RETENTION_SECONDS);
    // The active key leads: a client that reads only the first row still verifies fresh tokens.
    return this.db.prepare("SELECT kid, public_key, status FROM signing_keys ORDER BY status='active' DESC, created_at DESC, rowid DESC").all().map(row => ({
      kid: String(row.kid), alg: "EdDSA" as const, publicKey: String(row.public_key),
      status: String(row.status) === "active" ? "active" as const : "retired" as const,
    }));
  }

  // Accounts -----------------------------------------------------------------
  account(id: string): AccountView | null {
    const row = this.db.prepare("SELECT id, name, created_at FROM accounts WHERE id=?").get(id);
    if (!row) return null;
    const providers = this.db.prepare("SELECT provider FROM account_providers WHERE account_id=? ORDER BY provider").all(id).map(p => String(p.provider));
    return { id: String(row.id), name: String(row.name), createdAt: Number(row.created_at), providers };
  }
  accountForProvider(provider: string, providerUserId: string): AccountView | null {
    const row = this.db.prepare("SELECT account_id FROM account_providers WHERE provider=? AND provider_user_id=?").get(provider, providerUserId);
    return row ? this.account(String(row.account_id)) : null;
  }
  /** Second login with the same provider id lands on the same account; a new one gets a name. */
  findOrCreateAccount(provider: string, providerUserId: string, suggestedName: string, now: number): AccountView {
    const existing = this.accountForProvider(provider, providerUserId);
    if (existing) return existing;
    const id = newAccountId();
    const name = this.availableName(suggestedName);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO accounts (id, name, name_key, created_at) VALUES (?,?,?,?)").run(id, name, name.toLowerCase(), now);
      this.db.prepare("INSERT INTO account_providers (provider, provider_user_id, account_id, linked_at) VALUES (?,?,?,?)").run(provider, providerUserId, id, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.account(id)!;
  }
  /** Returns false when that provider identity already belongs to some other account. */
  linkProvider(accountId: string, provider: string, providerUserId: string, now: number): boolean {
    const owner = this.db.prepare("SELECT account_id FROM account_providers WHERE provider=? AND provider_user_id=?").get(provider, providerUserId);
    if (owner) return String(owner.account_id) === accountId;
    this.db.prepare("INSERT INTO account_providers (provider, provider_user_id, account_id, linked_at) VALUES (?,?,?,?)").run(provider, providerUserId, accountId, now);
    return true;
  }
  renameAccount(accountId: string, name: string): boolean {
    if (!NAME_PATTERN.test(name)) return false;
    const taken = this.db.prepare("SELECT id FROM accounts WHERE name_key=? AND id<>?").get(name.toLowerCase(), accountId);
    if (taken) return false;
    return this.db.prepare("UPDATE accounts SET name=?, name_key=? WHERE id=?").run(name, name.toLowerCase(), accountId).changes > 0;
  }
  /** Providers hand out names Corealm cannot use. Clean it, then suffix until it is free. */
  availableName(suggested: string): string {
    const cleaned = String(suggested ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
    const base = cleaned.length >= 3 ? cleaned : `player${cleaned}`.slice(0, 24);
    const free = (name: string) => !this.db.prepare("SELECT id FROM accounts WHERE name_key=?").get(name.toLowerCase());
    if (free(base)) return base;
    for (let suffix = 2; suffix < 10_000; suffix++) {
      const tail = String(suffix);
      const candidate = `${base.slice(0, 24 - tail.length)}${tail}`;
      if (free(candidate)) return candidate;
    }
    return `player${randomBytes(6).toString("hex")}`.slice(0, 24);
  }

  // Sessions -----------------------------------------------------------------
  createSession(accountId: string, now: number, ttlSeconds: number): { token: string; expiresAt: number } {
    const token = randomToken(), expiresAt = now + ttlSeconds;
    this.db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?,?,?,?)").run(hashToken(token), accountId, now, expiresAt);
    return { token, expiresAt };
  }
  sessionAccount(token: string, now: number): AccountView | null {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const row = this.db.prepare("SELECT account_id FROM sessions WHERE token_hash=? AND expires_at > ?").get(hashToken(token), now);
    return row ? this.account(String(row.account_id)) : null;
  }
  revokeSession(token: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token)).changes > 0;
  }
  /** Signs the account out everywhere, which is the answer to a token that leaked. */
  revokeAllSessions(accountId: string): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId).changes);
  }

  // Login states -------------------------------------------------------------
  createLoginState(input: Omit<LoginState, "state" | "createdAt">, now: number, ttlSeconds: number): string {
    const state = randomToken(24);
    this.db.prepare("INSERT INTO login_states (state_hash, provider, return_url, verifier, intent, account_id, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(hashToken(state), input.provider, input.returnUrl, input.verifier, input.intent, input.accountId, now, now + ttlSeconds);
    return state;
  }
  /** Single use: the row is deleted whether or not it was still valid. */
  consumeLoginState(state: string, now: number): LoginState | null {
    const hash = hashToken(state);
    const row = this.db.prepare("SELECT provider, return_url, verifier, intent, account_id, created_at, expires_at FROM login_states WHERE state_hash=?").get(hash);
    this.db.prepare("DELETE FROM login_states WHERE state_hash=? OR expires_at <= ?").run(hash, now);
    if (!row || Number(row.expires_at) <= now) return null;
    return {
      state, provider: String(row.provider), returnUrl: String(row.return_url),
      verifier: row.verifier === null ? null : String(row.verifier),
      intent: String(row.intent) === "link" ? "link" : "login",
      accountId: row.account_id === null ? null : String(row.account_id), createdAt: Number(row.created_at),
    };
  }

  // Server directory ---------------------------------------------------------
  registerServer(entry: { name: string; endpoint: string; description?: string }, now: number, capacity: number): boolean {
    const existing = this.db.prepare("SELECT registered_at FROM servers WHERE endpoint=?").get(entry.endpoint);
    if (!existing && Number(this.db.prepare("SELECT COUNT(*) AS total FROM servers").get()!.total) >= capacity) return false;
    this.db.prepare("INSERT INTO servers (endpoint, name, description, registered_at, last_seen_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET name=excluded.name, description=excluded.description, last_seen_at=excluded.last_seen_at")
      .run(entry.endpoint, entry.name, entry.description ?? null, now, now);
    return true;
  }
  listServers(now: number, ttlSeconds: number): DirectoryEntry[] {
    this.db.prepare("DELETE FROM servers WHERE last_seen_at < ?").run(now - ttlSeconds);
    return this.db.prepare("SELECT name, endpoint, description, registered_at, last_seen_at FROM servers ORDER BY name").all().map(row => ({
      name: String(row.name), endpoint: String(row.endpoint),
      ...(row.description === null ? {} : { description: String(row.description) }),
      registeredAt: Number(row.registered_at), lastSeenAt: Number(row.last_seen_at),
    }));
  }

  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
