import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createSigningKey, type IdentityKey, type SigningKey } from "./joinToken.js";

/** One SQLite file holds accounts, credentials, sessions, login states, keys and the directory. */

export interface Account { id: string; name: string; createdAt: number }
export interface AccountView extends Account {
  /** False for an account migrated off OAuth: it has a name but no password until an operator sets one. */
  claimed: boolean;
}
/** What a login, a registration or a password change carries between the form and its POST. */
export type LoginPurpose = "login" | "register" | "password";
export interface LoginState { state: string; purpose: LoginPurpose; returnUrl: string; createdAt: number }
export interface DirectoryEntry { name: string; endpoint: string; description?: string; registeredAt: number; lastSeenAt: number }

/** Display names are what other players see, so keep them short, printable and unambiguous. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
/** Names the service speaks with, or that would let one player pass for staff. Compared lowercased. */
export const RESERVED_NAMES: readonly string[] = [
  "admin", "administrator", "moderator", "owner", "system", "server", "corealm", "support", "staff", "guest", "local", "root", "null", "undefined",
];
export function reservedName(name: string): boolean { return RESERVED_NAMES.includes(name.toLowerCase()); }
/** Retired keys stay published well past the 60 second token lifetime, then go. */
export const KEY_RETENTION_SECONDS = 3_600;
/** Bumped whenever the shape below changes. Version 1 is the move from OAuth links to passwords. */
export const SCHEMA_VERSION = 1;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS signing_keys (kid TEXT PRIMARY KEY, private_key TEXT NOT NULL, public_key TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, retired_at INTEGER) STRICT",
  "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, password_hash TEXT, created_at INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT",
  "CREATE TABLE IF NOT EXISTS login_states (state_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, return_url TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT",
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
      this.migrate();
      for (const statement of SCHEMA) this.db.exec(statement);
      this.db.prepare("DELETE FROM schema_version").run();
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
    } catch (error) { this.db.close(); throw error; }
  }

  private columns(table: string): string[] {
    return this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
  }

  /**
   * Forward only, and safe to run on a database that never saw OAuth.
   *
   * A database from the OAuth service keeps its accounts and its signing keys. The provider links go,
   * and an account that had no password — which is all of them — stays as a name nobody can sign in
   * to until an operator claims it with `identity-admin`. Public registration cannot take it, so a
   * migrated name is not up for grabs. Login states are seconds old and are simply dropped.
   */
  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL) STRICT");
    const row = this.db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
    if (row && Number(row.version) >= SCHEMA_VERSION) return;
    this.db.exec("DROP TABLE IF EXISTS account_providers");
    const accounts = this.columns("accounts");
    if (accounts.length && !accounts.includes("password_hash")) this.db.exec("ALTER TABLE accounts ADD COLUMN password_hash TEXT");
    const states = this.columns("login_states");
    if (states.length && !states.includes("purpose")) this.db.exec("DROP TABLE login_states");
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
  private view(row: Record<string, unknown>): AccountView {
    return { id: String(row.id), name: String(row.name), createdAt: Number(row.created_at), claimed: row.password_hash !== null };
  }
  account(id: string): AccountView | null {
    const row = this.db.prepare("SELECT id, name, created_at, password_hash FROM accounts WHERE id=?").get(id);
    return row ? this.view(row) : null;
  }
  /** The stored hash comes back with the account so a login needs one lookup, not two. */
  accountByName(name: string): (AccountView & { passwordHash: string | null }) | null {
    const row = this.db.prepare("SELECT id, name, created_at, password_hash FROM accounts WHERE name_key=?").get(name.toLowerCase());
    return row ? { ...this.view(row), passwordHash: row.password_hash === null ? null : String(row.password_hash) } : null;
  }
  listAccounts(): AccountView[] {
    return this.db.prepare("SELECT id, name, created_at, password_hash FROM accounts ORDER BY name_key").all().map(row => this.view(row));
  }
  /** Null when the name is taken, case-insensitively. The caller has already hashed the password. */
  createAccount(name: string, passwordHash: string, now: number): AccountView | null {
    if (!NAME_PATTERN.test(name)) return null;
    const id = newAccountId();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT id FROM accounts WHERE name_key=?").get(name.toLowerCase())) { this.db.exec("ROLLBACK"); return null; }
      this.db.prepare("INSERT INTO accounts (id, name, name_key, password_hash, created_at) VALUES (?,?,?,?,?)").run(id, name, name.toLowerCase(), passwordHash, now);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.account(id)!;
  }
  /** Used by a password change, by a rehash at stronger parameters, and by the operator tool. */
  setPassword(accountId: string, passwordHash: string): boolean {
    return this.db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(passwordHash, accountId).changes > 0;
  }
  deleteAccount(accountId: string): boolean {
    this.db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId);
    return this.db.prepare("DELETE FROM accounts WHERE id=?").run(accountId).changes > 0;
  }
  renameAccount(accountId: string, name: string): boolean {
    if (!NAME_PATTERN.test(name) || reservedName(name)) return false;
    const taken = this.db.prepare("SELECT id FROM accounts WHERE name_key=? AND id<>?").get(name.toLowerCase(), accountId);
    if (taken) return false;
    return this.db.prepare("UPDATE accounts SET name=?, name_key=? WHERE id=?").run(name, name.toLowerCase(), accountId).changes > 0;
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
  /** One row per form the service handed out: what it was for, and where it may redirect afterwards. */
  createLoginState(input: Omit<LoginState, "state" | "createdAt">, now: number, ttlSeconds: number): string {
    const state = randomToken(24);
    this.db.prepare("INSERT INTO login_states (state_hash, purpose, return_url, created_at, expires_at) VALUES (?,?,?,?,?)")
      .run(hashToken(state), input.purpose, input.returnUrl, now, now + ttlSeconds);
    return state;
  }
  /** Single use: the row is deleted whether or not it was still valid. */
  consumeLoginState(state: string, now: number): LoginState | null {
    const hash = hashToken(state);
    const row = this.db.prepare("SELECT purpose, return_url, created_at, expires_at FROM login_states WHERE state_hash=?").get(hash);
    this.db.prepare("DELETE FROM login_states WHERE state_hash=? OR expires_at <= ?").run(hash, now);
    if (!row || Number(row.expires_at) <= now) return null;
    const purpose = String(row.purpose);
    if (purpose !== "login" && purpose !== "register" && purpose !== "password") return null;
    return { state, purpose, returnUrl: String(row.return_url), createdAt: Number(row.created_at) };
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
