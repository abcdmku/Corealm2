import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PlayerCharacter, Vec3, WorldKey } from "../contracts.js";

/**
 * Everything a server knows about who may administer it: roles, the one-time owner setup code,
 * bans, admin sessions, scoped API tokens, the audit log and the read side of the players table.
 *
 * Every method is asynchronous and takes plain data. M9 moves the database to its own thread, so
 * nothing outside an implementation of this interface may hold a database handle.
 */

/** Per-server rights by account id. `owner` is `admin` plus role and token management. */
export const SERVER_ROLES = ["owner", "admin"] as const;
export type ServerRole = typeof SERVER_ROLES[number];
/** The complete scope set an API token may carry. An admin session holds all of them. */
export const API_SCOPES = ["content:read", "content:publish", "players:read", "players:write", "stats:read"] as const;
export type ApiScope = typeof API_SCOPES[number];
/** Identity account ids, the only thing a role or a ban is keyed by. */
export const ACCOUNT_ID = /^acc_[A-Za-z0-9_-]{22,120}$/;
export const ADMIN_SESSION_PREFIX = "cas_";
export const API_TOKEN_PREFIX = "cat_";
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
/** Crockford base32 without O, I, L and U: a code read aloud cannot become another code. */
const SETUP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SETUP_CHARS = 20;

/** 32 random bytes behind a type prefix. Shown once, then only its hash exists. */
export function newSecret(prefix: typeof ADMIN_SESSION_PREFIX | typeof API_TOKEN_PREFIX): string {
  return prefix + randomBytes(32).toString("base64url");
}
/** Secrets are stored only as this hash, so a copied database impersonates nobody. */
export function hashSecret(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
/** Constant time for equal-length hex digests; unequal lengths were never the same secret. */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8"), right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
/** 100 bits in four groups of five, for a human to read off a console and type into devdocs. */
export function newSetupCode(): string {
  const code = Array.from({ length: SETUP_CHARS }, () => SETUP_ALPHABET[randomInt(SETUP_ALPHABET.length)]!).join("");
  return code.replace(/(.{5})(?=.)/g, "$1-");
}
/** Accepts what a human types: any case, any separators, with O, I and L read as 0, 1 and 1. */
export function setupCodeDigits(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const text = value.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
  return text.length === SETUP_CHARS && [...text].every(char => SETUP_ALPHABET.includes(char)) ? text : null;
}
export function newApiTokenId(): string { return `tok_${randomUUID().replace(/-/g, "").slice(0, 16)}`; }
/** What a banned player is told, by the join refusal and by the kick, in exactly the same words. */
export function banMessage(ban: { reason: string; expiresAt: number | null }): string {
  return ban.expiresAt === null ? `Banned from this server: ${ban.reason}`
    : `Banned from this server until ${new Date(ban.expiresAt).toISOString()}: ${ban.reason}`;
}

/**
 * Who performed an admin write and when. `credential` is exactly what the audit row records:
 * `session`, `token:<id>`, `setup` for the one-time code, `config` for `ownerAccount`, and
 * `login` for the join token that mints a session.
 */
export interface AdminActor { accountId: string | null; credential: string; at: number }
/** What M4 publish and M5 player edits pass to `record`, which is the only way to write the log. */
export interface AuditWrite { action: string; target: string | null; before?: unknown; after?: unknown }
export interface AuditEntry { id: number; at: number; accountId: string | null; credential: string; action: string; target: string | null; before: unknown; after: unknown }

export interface RoleRecord { accountId: string; name: string | null; role: ServerRole; grantedBy: string | null; grantedAt: number }
export interface BanRecord { accountId: string; name: string | null; reason: string; expiresAt: number | null; bannedBy: string; bannedAt: number }
export interface AdminSessionRecord { accountId: string; role: ServerRole; expiresAt: number }
/** Token metadata. The secret exists once, in the reply that created it. */
export interface ApiTokenRecord { id: string; label: string; scopes: ApiScope[]; createdBy: string; createdAt: number; lastUsedAt: number | null; expiresAt: number | null }
export interface PlayerSummary {
  accountId: string; name: string; firstSeen: number; lastSeen: number; playtimeSeconds: number;
  lastWorld: WorldKey | null; position: Vec3 | null; regionId: string | null;
  /** The world holding a live lease on this account, or null when the account is offline. */
  online: WorldKey | null;
  ban: BanRecord | null;
}
/** One player with the private state devdocs edits: inventory, bank, equipment, skills. */
export interface PlayerDetail extends PlayerSummary { character: PlayerCharacter | null }
export interface PlayerPage { players: PlayerSummary[]; cursor: string | null }
/** One stored character holding one item, for the publish that wants to remove that item's definition. */
/** `world` is set for a recovery cache, which lies in one world. The character places are the account's own. */
export interface ItemHolder { accountId: string; name: string; itemId: string; place: "inventory" | "bank" | "equipment" | "recovery-cache"; world: WorldKey | null }
/** Writes one audit row inside a transaction the caller already holds. Only storage that shares the connection gets one. */
export type AuditWriter = (by: AdminActor, entry: AuditWrite) => void;

export interface ServerAdminStorage {
  listRoles(): Promise<RoleRecord[]>;
  roleOf(accountId: string): Promise<RoleRecord | null>;
  /** Grant or change a role, audited in the same transaction. */
  setRole(accountId: string, role: ServerRole, by: AdminActor): Promise<RoleRecord>;
  revokeRole(accountId: string, by: AdminActor): Promise<boolean>;

  /** Replace the one-time owner code, hashed, or clear it with null. */
  setSetupCodeHash(hash: string | null): Promise<void>;
  /** Spend the code: makes the account owner and clears the code together. Null when it does not match. */
  claimSetupCode(hash: string, by: AdminActor): Promise<RoleRecord | null>;

  listBans(now: number): Promise<BanRecord[]>;
  /** The live ban on an account. An expired ban is not one, and needs no sweep to stop applying. */
  banOf(accountId: string, now: number): Promise<BanRecord | null>;
  setBan(ban: { accountId: string; reason: string; expiresAt: number | null }, by: AdminActor): Promise<BanRecord>;
  removeBan(accountId: string, by: AdminActor): Promise<boolean>;

  createAdminSession(hash: string, accountId: string, role: ServerRole, expiresAt: number, by: AdminActor): Promise<void>;
  adminSession(hash: string, now: number): Promise<AdminSessionRecord | null>;
  revokeAdminSession(hash: string, by: AdminActor): Promise<boolean>;
  /** Every session of an account, for a ban or a role that was taken away. */
  revokeAdminSessionsFor(accountId: string): Promise<number>;

  listApiTokens(): Promise<ApiTokenRecord[]>;
  createApiToken(input: { id: string; hash: string; label: string; scopes: ApiScope[]; expiresAt: number | null }, by: AdminActor): Promise<ApiTokenRecord>;
  /** Resolve a presented token and stamp its use. An expired token resolves to null. */
  useApiToken(hash: string, now: number): Promise<ApiTokenRecord | null>;
  revokeApiToken(id: string, by: AdminActor): Promise<boolean>;

  /** The one audit helper. Every admin write outside this module goes through it. */
  record(by: AdminActor, entry: AuditWrite): Promise<void>;
  /** Newest first. `before` is an exclusive id, which is the cursor the previous page ends with. */
  audit(limit: number, before: number | null): Promise<AuditEntry[]>;

  listPlayers(query: string | null, limit: number, cursor: string | null, now: number): Promise<PlayerPage>;
  player(accountId: string, now: number): Promise<PlayerDetail | null>;
  /** Stored characters that hold any of these items in their inventory, bank or equipment, and stored recovery caches in any world, without loading a character. At most `limit` rows. */
  itemHolders(itemIds: readonly string[], limit: number): Promise<ItemHolder[]>;
}

const SETUP_CODE_KEY = "setup_code_hash";
export const ADMIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS server_roles (account_id TEXT PRIMARY KEY, role TEXT NOT NULL, granted_by TEXT, granted_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS player_bans (account_id TEXT PRIMARY KEY, reason TEXT NOT NULL, expires_at INTEGER, banned_by TEXT NOT NULL, banned_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, scopes TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER) STRICT;
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, account_id TEXT, credential TEXT NOT NULL,
  action TEXT NOT NULL, target TEXT, "before" TEXT, "after" TEXT) STRICT;`;

const scopeList = (value: unknown): ApiScope[] => {
  const parsed: unknown = JSON.parse(String(value));
  return Array.isArray(parsed) ? parsed.filter((scope): scope is ApiScope => (API_SCOPES as readonly unknown[]).includes(scope)) : [];
};
const worldOf = (value: unknown): WorldKey | null => {
  if (value === null || value === undefined) return null;
  const [providerId, worldId] = JSON.parse(String(value)) as [string, string];
  return providerId !== undefined && worldId !== undefined ? { providerId, worldId } : null;
};
const vector = (value: unknown): Vec3 | null => {
  if (typeof value !== "string") return null;
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.length === 3 && parsed.every(n => typeof n === "number") ? parsed as unknown as Vec3 : null;
};
const json = (value: unknown): unknown => value === null || value === undefined ? null : JSON.parse(String(value));

/**
 * The admin tables, on the connection `SqliteWorldStorage` already owns. The database is opened
 * with `locking_mode=EXCLUSIVE`, so a second connection to the same file cannot exist.
 *
 * Every write below takes one `BEGIN IMMEDIATE` transaction that also inserts the audit row, and
 * contains no `await`, so a world commit can never interleave with it.
 */
export class SqliteAdminStorage implements ServerAdminStorage {
  constructor(private readonly db: DatabaseSync) {}
  private transact<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = run(); this.db.exec("COMMIT"); return value; }
    catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  private log(by: AdminActor, entry: AuditWrite): void {
    this.db.prepare(`INSERT INTO audit_log (at, account_id, credential, action, target, "before", "after") VALUES (?,?,?,?,?,?,?)`)
      .run(by.at, by.accountId, by.credential, entry.action, entry.target,
        entry.before === undefined ? null : JSON.stringify(entry.before), entry.after === undefined ? null : JSON.stringify(entry.after));
  }
  private name(accountId: string): string | null {
    const row = this.db.prepare("SELECT name FROM players WHERE account_id=?").get(accountId);
    return row ? String(row.name) : null;
  }
  private roleRow(accountId: string): RoleRecord | null {
    const row = this.db.prepare(`SELECT r.account_id, r.role, r.granted_by, r.granted_at, p.name FROM server_roles r
      LEFT JOIN players p ON p.account_id=r.account_id WHERE r.account_id=?`).get(accountId);
    return row ? { accountId: String(row.account_id), name: row.name == null ? null : String(row.name), role: String(row.role) as ServerRole,
      grantedBy: row.granted_by == null ? null : String(row.granted_by), grantedAt: Number(row.granted_at) } : null;
  }
  private banRow(accountId: string, now: number): BanRecord | null {
    const row = this.db.prepare(`SELECT b.account_id, b.reason, b.expires_at, b.banned_by, b.banned_at, p.name FROM player_bans b
      LEFT JOIN players p ON p.account_id=b.account_id WHERE b.account_id=? AND (b.expires_at IS NULL OR b.expires_at>?)`).get(accountId, now);
    return row ? { accountId: String(row.account_id), name: row.name == null ? null : String(row.name), reason: String(row.reason),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at), bannedBy: String(row.banned_by), bannedAt: Number(row.banned_at) } : null;
  }
  private tokenRow(id: string): ApiTokenRecord | null {
    const row = this.db.prepare("SELECT id,label,scopes,created_by,created_at,last_used_at,expires_at FROM api_tokens WHERE id=?").get(id);
    return row ? { id: String(row.id), label: String(row.label), scopes: scopeList(row.scopes), createdBy: String(row.created_by),
      createdAt: Number(row.created_at), lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at) } : null;
  }

  async listRoles(): Promise<RoleRecord[]> {
    return this.db.prepare(`SELECT r.account_id, r.role, r.granted_by, r.granted_at, p.name FROM server_roles r
      LEFT JOIN players p ON p.account_id=r.account_id ORDER BY r.role, r.account_id`).all()
      .map(row => ({ accountId: String(row.account_id), name: row.name == null ? null : String(row.name), role: String(row.role) as ServerRole,
        grantedBy: row.granted_by == null ? null : String(row.granted_by), grantedAt: Number(row.granted_at) }));
  }
  async roleOf(accountId: string): Promise<RoleRecord | null> { return this.roleRow(accountId); }
  async setRole(accountId: string, role: ServerRole, by: AdminActor): Promise<RoleRecord> {
    return this.transact(() => {
      const before = this.roleRow(accountId);
      this.db.prepare(`INSERT INTO server_roles (account_id,role,granted_by,granted_at) VALUES (?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET role=excluded.role, granted_by=excluded.granted_by, granted_at=excluded.granted_at`)
        .run(accountId, role, by.accountId, by.at);
      const after = this.roleRow(accountId)!;
      this.log(by, { action: by.credential === "setup" ? "owner.setup" : "role.set", target: accountId,
        before: before && { role: before.role }, after: { role } });
      return after;
    });
  }
  async revokeRole(accountId: string, by: AdminActor): Promise<boolean> {
    return this.transact(() => {
      const before = this.roleRow(accountId);
      if (!before) return false;
      this.db.prepare("DELETE FROM server_roles WHERE account_id=?").run(accountId);
      this.db.prepare("DELETE FROM admin_sessions WHERE account_id=?").run(accountId);
      this.log(by, { action: "role.revoke", target: accountId, before: { role: before.role }, after: null });
      return true;
    });
  }

  async setSetupCodeHash(hash: string | null): Promise<void> {
    if (hash === null) this.db.prepare("DELETE FROM server_settings WHERE key=?").run(SETUP_CODE_KEY);
    else this.db.prepare("INSERT INTO server_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SETUP_CODE_KEY, hash);
  }
  async claimSetupCode(hash: string, by: AdminActor): Promise<RoleRecord | null> {
    return this.transact(() => {
      const row = this.db.prepare("SELECT value FROM server_settings WHERE key=?").get(SETUP_CODE_KEY);
      if (!row || !sameDigest(String(row.value), hash)) return null;
      this.db.prepare("DELETE FROM server_settings WHERE key=?").run(SETUP_CODE_KEY);
      const before = this.roleRow(by.accountId!);
      this.db.prepare(`INSERT INTO server_roles (account_id,role,granted_by,granted_at) VALUES (?,'owner',NULL,?)
        ON CONFLICT(account_id) DO UPDATE SET role='owner', granted_at=excluded.granted_at`).run(by.accountId, by.at);
      this.log(by, { action: "owner.setup", target: by.accountId, before: before && { role: before.role }, after: { role: "owner" } });
      return this.roleRow(by.accountId!)!;
    });
  }

  async listBans(now: number): Promise<BanRecord[]> {
    return this.db.prepare(`SELECT b.account_id, b.reason, b.expires_at, b.banned_by, b.banned_at, p.name FROM player_bans b
      LEFT JOIN players p ON p.account_id=b.account_id WHERE b.expires_at IS NULL OR b.expires_at>? ORDER BY b.banned_at DESC`).all(now)
      .map(row => ({ accountId: String(row.account_id), name: row.name == null ? null : String(row.name), reason: String(row.reason),
        expiresAt: row.expires_at == null ? null : Number(row.expires_at), bannedBy: String(row.banned_by), bannedAt: Number(row.banned_at) }));
  }
  async banOf(accountId: string, now: number): Promise<BanRecord | null> { return this.banRow(accountId, now); }
  async setBan(ban: { accountId: string; reason: string; expiresAt: number | null }, by: AdminActor): Promise<BanRecord> {
    return this.transact(() => {
      const before = this.banRow(ban.accountId, by.at);
      this.db.prepare(`INSERT INTO player_bans (account_id,reason,expires_at,banned_by,banned_at) VALUES (?,?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET reason=excluded.reason, expires_at=excluded.expires_at, banned_by=excluded.banned_by, banned_at=excluded.banned_at`)
        .run(ban.accountId, ban.reason, ban.expiresAt, by.accountId ?? by.credential, by.at);
      this.db.prepare("DELETE FROM admin_sessions WHERE account_id=?").run(ban.accountId);
      this.log(by, { action: "ban.set", target: ban.accountId, before: before && { reason: before.reason, expiresAt: before.expiresAt },
        after: { reason: ban.reason, expiresAt: ban.expiresAt } });
      return this.banRow(ban.accountId, by.at)!;
    });
  }
  async removeBan(accountId: string, by: AdminActor): Promise<boolean> {
    return this.transact(() => {
      const before = this.banRow(accountId, by.at);
      if (!this.db.prepare("DELETE FROM player_bans WHERE account_id=?").run(accountId).changes) return false;
      this.log(by, { action: "ban.remove", target: accountId, before: before && { reason: before.reason, expiresAt: before.expiresAt }, after: null });
      return true;
    });
  }

  async createAdminSession(hash: string, accountId: string, role: ServerRole, expiresAt: number, by: AdminActor): Promise<void> {
    this.transact(() => {
      this.db.prepare("INSERT INTO admin_sessions (token_hash,account_id,created_at,expires_at) VALUES (?,?,?,?)").run(hash, accountId, by.at, expiresAt);
      this.log(by, { action: "session.create", target: accountId, after: { role, expiresAt } });
    });
  }
  async adminSession(hash: string, now: number): Promise<AdminSessionRecord | null> {
    const row = this.db.prepare(`SELECT s.account_id, s.expires_at, r.role FROM admin_sessions s
      JOIN server_roles r ON r.account_id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash, now);
    return row ? { accountId: String(row.account_id), role: String(row.role) as ServerRole, expiresAt: Number(row.expires_at) } : null;
  }
  async revokeAdminSession(hash: string, by: AdminActor): Promise<boolean> {
    return this.transact(() => {
      if (!this.db.prepare("DELETE FROM admin_sessions WHERE token_hash=?").run(hash).changes) return false;
      this.log(by, { action: "session.revoke", target: by.accountId, after: null });
      return true;
    });
  }
  async revokeAdminSessionsFor(accountId: string): Promise<number> {
    return Number(this.db.prepare("DELETE FROM admin_sessions WHERE account_id=?").run(accountId).changes);
  }

  async listApiTokens(): Promise<ApiTokenRecord[]> {
    return this.db.prepare("SELECT id,label,scopes,created_by,created_at,last_used_at,expires_at FROM api_tokens ORDER BY created_at DESC, id").all()
      .map(row => ({ id: String(row.id), label: String(row.label), scopes: scopeList(row.scopes), createdBy: String(row.created_by),
        createdAt: Number(row.created_at), lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
        expiresAt: row.expires_at == null ? null : Number(row.expires_at) }));
  }
  async createApiToken(input: { id: string; hash: string; label: string; scopes: ApiScope[]; expiresAt: number | null }, by: AdminActor): Promise<ApiTokenRecord> {
    return this.transact(() => {
      this.db.prepare("INSERT INTO api_tokens (id,token_hash,label,scopes,created_by,created_at,last_used_at,expires_at) VALUES (?,?,?,?,?,?,NULL,?)")
        .run(input.id, input.hash, input.label, JSON.stringify(input.scopes), by.accountId, by.at, input.expiresAt);
      this.log(by, { action: "token.create", target: input.id, after: { label: input.label, scopes: input.scopes, expiresAt: input.expiresAt } });
      return this.tokenRow(input.id)!;
    });
  }
  async useApiToken(hash: string, now: number): Promise<ApiTokenRecord | null> {
    const row = this.db.prepare("SELECT id FROM api_tokens WHERE token_hash=? AND (expires_at IS NULL OR expires_at>?)").get(hash, now);
    if (!row) return null;
    this.db.prepare("UPDATE api_tokens SET last_used_at=? WHERE id=?").run(now, String(row.id));
    return this.tokenRow(String(row.id));
  }
  async revokeApiToken(id: string, by: AdminActor): Promise<boolean> {
    return this.transact(() => {
      const before = this.tokenRow(id);
      if (!before) return false;
      this.db.prepare("DELETE FROM api_tokens WHERE id=?").run(id);
      this.log(by, { action: "token.revoke", target: id, before: { label: before.label, scopes: before.scopes }, after: null });
      return true;
    });
  }

  async record(by: AdminActor, entry: AuditWrite): Promise<void> { this.transact(() => this.log(by, entry)); }
  /** For `SqliteCatalogStorage`, which moves the active catalog and audits the move in one transaction. */
  readonly auditWriter: AuditWriter = (by, entry) => this.log(by, entry);
  async audit(limit: number, before: number | null): Promise<AuditEntry[]> {
    const rows = before === null
      ? this.db.prepare(`SELECT id,at,account_id,credential,action,target,"before","after" FROM audit_log ORDER BY id DESC LIMIT ?`).all(limit)
      : this.db.prepare(`SELECT id,at,account_id,credential,action,target,"before","after" FROM audit_log WHERE id<? ORDER BY id DESC LIMIT ?`).all(before, limit);
    return rows.map(row => ({ id: Number(row.id), at: Number(row.at), accountId: row.account_id == null ? null : String(row.account_id),
      credential: String(row.credential), action: String(row.action), target: row.target == null ? null : String(row.target),
      before: json(row.before), after: json(row.after) }));
  }

  async listPlayers(query: string | null, limit: number, cursor: string | null, now: number): Promise<PlayerPage> {
    const where: string[] = [], params: (string | number)[] = [now];
    if (query) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.account_id LIKE ? ESCAPE '\\')"); const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`; params.push(like, like); }
    const seek = cursor === null ? null : splitCursor(cursor);
    if (seek) { where.push("(p.last_seen<? OR (p.last_seen=? AND p.account_id>?))"); params.push(seek.lastSeen, seek.lastSeen, seek.accountId); }
    const rows = this.db.prepare(`SELECT p.account_id, p.name, p.first_seen, p.last_seen, p.playtime_seconds, p.last_world,
        json_extract(p.character,'$.player.position') AS position, json_extract(p.character,'$.player.regionId') AS region,
        l.world_key AS lease_world FROM players p
      LEFT JOIN player_leases l ON l.account_id=p.account_id AND l.reserved=0 AND l.expires_at>?
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.last_seen DESC, p.account_id ASC LIMIT ?`).all(...[...params, limit + 1]);
    const page = rows.slice(0, limit).map(row => ({
      accountId: String(row.account_id), name: String(row.name), firstSeen: Number(row.first_seen), lastSeen: Number(row.last_seen),
      playtimeSeconds: Number(row.playtime_seconds), lastWorld: worldOf(row.last_world), position: vector(row.position),
      regionId: row.region == null ? null : String(row.region), online: worldOf(row.lease_world), ban: this.banRow(String(row.account_id), now),
    }));
    const last = page.at(-1);
    return { players: page, cursor: rows.length > limit && last ? `${last.lastSeen}.${last.accountId}` : null };
  }
  async player(accountId: string, now: number): Promise<PlayerDetail | null> {
    const row = this.db.prepare(`SELECT p.account_id, p.name, p.first_seen, p.last_seen, p.playtime_seconds, p.last_world, p.character,
      l.world_key AS lease_world FROM players p LEFT JOIN player_leases l ON l.account_id=p.account_id AND l.reserved=0 AND l.expires_at>?
      WHERE p.account_id=?`).get(now, accountId);
    if (!row) return null;
    const character = row.character == null ? null : JSON.parse(String(row.character)) as PlayerCharacter;
    return { accountId: String(row.account_id), name: String(row.name), firstSeen: Number(row.first_seen), lastSeen: Number(row.last_seen),
      playtimeSeconds: Number(row.playtime_seconds), lastWorld: worldOf(row.last_world), position: character?.player?.position ?? null,
      regionId: character?.player?.regionId ?? null, online: worldOf(row.lease_world), ban: this.banRow(accountId, now), character };
  }
  async itemHolders(itemIds: readonly string[], limit: number): Promise<ItemHolder[]> {
    if (!itemIds.length) return [];
    // JSON1 walks each character where it lies. Nothing is parsed into this process but the rows that match.
    const held = (path: string, place: ItemHolder["place"]) => `SELECT p.account_id, p.name, json_extract(slot.value,'$.itemId') AS item_id, '${place}' AS place, NULL AS world_key
      FROM players p, json_each(p.character,'${path}') slot WHERE p.character IS NOT NULL AND json_extract(slot.value,'$.itemId') IN (SELECT value FROM json_each(?1))`;
    // What a dead player left behind lies in the world they died in, in that world's row for them.
    const cached = `SELECT w.account_id, COALESCE(p.name, w.account_id) AS name, json_extract(slot.value,'$.itemId') AS item_id, 'recovery-cache' AS place, w.world_key
      FROM world_players w LEFT JOIN players p ON p.account_id=w.account_id, json_each(w.owned,'$.recoveryCache.items') slot
      WHERE json_type(w.owned,'$.recoveryCache.items')='array' AND json_extract(slot.value,'$.itemId') IN (SELECT value FROM json_each(?1))`;
    return this.db.prepare(`${held("$.inventory.slots", "inventory")} UNION ALL ${held("$.bank.slots", "bank")} UNION ALL ${held("$.equipment", "equipment")} UNION ALL ${cached} ORDER BY 1, 3 LIMIT ?2`)
      .all(JSON.stringify(itemIds), limit).map(row => ({ accountId: String(row.account_id), name: String(row.name), itemId: String(row.item_id), place: String(row.place) as ItemHolder["place"], world: worldOf(row.world_key) }));
  }
}

function splitCursor(cursor: string): { lastSeen: number; accountId: string } | null {
  const dot = cursor.indexOf(".");
  const lastSeen = Number(cursor.slice(0, dot));
  return dot > 0 && Number.isSafeInteger(lastSeen) ? { lastSeen, accountId: cursor.slice(dot + 1) } : null;
}

/** One stored player row, as the memory world storage keeps it. */
export interface MemoryPlayerRow {
  accountId: string; name: string; character: PlayerCharacter | null; lastWorld: WorldKey | null;
  firstSeen: number; lastSeen: number; playtimeSeconds: number; online: WorldKey | null;
  /** What the account left in each world it died in. */
  recoveryCaches?: { world: WorldKey; items: readonly { itemId: string }[] }[];
}

/** The same rules over plain maps, for tests and hosts that keep nothing. */
export class MemoryAdminStorage implements ServerAdminStorage {
  private readonly roles = new Map<string, RoleRecord>();
  private readonly bans = new Map<string, BanRecord>();
  private readonly sessions = new Map<string, { accountId: string; expiresAt: number }>();
  private readonly tokens = new Map<string, { record: ApiTokenRecord; hash: string }>();
  private readonly entries: AuditEntry[] = [];
  private setupHash: string | null = null;
  constructor(private readonly source: () => Iterable<MemoryPlayerRow> = () => []) {}
  private log(by: AdminActor, entry: AuditWrite): void {
    this.entries.push({ id: this.entries.length + 1, at: by.at, accountId: by.accountId, credential: by.credential, action: entry.action,
      target: entry.target, before: entry.before === undefined ? null : structuredClone(entry.before), after: entry.after === undefined ? null : structuredClone(entry.after) });
  }
  private named(accountId: string): string | null {
    for (const row of this.source()) if (row.accountId === accountId) return row.name;
    return null;
  }
  private liveBan(accountId: string, now: number): BanRecord | null {
    const ban = this.bans.get(accountId);
    return ban && (ban.expiresAt === null || ban.expiresAt > now) ? { ...ban, name: this.named(accountId) } : null;
  }
  async listRoles(): Promise<RoleRecord[]> {
    return [...this.roles.values()].map(role => ({ ...role, name: this.named(role.accountId) }))
      .sort((a, b) => a.role.localeCompare(b.role) || a.accountId.localeCompare(b.accountId));
  }
  async roleOf(accountId: string): Promise<RoleRecord | null> {
    const role = this.roles.get(accountId);
    return role ? { ...role, name: this.named(accountId) } : null;
  }
  async setRole(accountId: string, role: ServerRole, by: AdminActor): Promise<RoleRecord> {
    const before = this.roles.get(accountId);
    const record: RoleRecord = { accountId, name: this.named(accountId), role, grantedBy: by.accountId, grantedAt: by.at };
    this.roles.set(accountId, record);
    this.log(by, { action: by.credential === "setup" ? "owner.setup" : "role.set", target: accountId, before: before && { role: before.role }, after: { role } });
    return record;
  }
  async revokeRole(accountId: string, by: AdminActor): Promise<boolean> {
    const before = this.roles.get(accountId);
    if (!before) return false;
    this.roles.delete(accountId);
    for (const [hash, session] of this.sessions) if (session.accountId === accountId) this.sessions.delete(hash);
    this.log(by, { action: "role.revoke", target: accountId, before: { role: before.role }, after: null });
    return true;
  }
  async setSetupCodeHash(hash: string | null): Promise<void> { this.setupHash = hash; }
  async claimSetupCode(hash: string, by: AdminActor): Promise<RoleRecord | null> {
    if (!this.setupHash || !sameDigest(this.setupHash, hash)) return null;
    this.setupHash = null;
    return this.setRole(by.accountId!, "owner", by);
  }
  async listBans(now: number): Promise<BanRecord[]> {
    return [...this.bans.keys()].map(id => this.liveBan(id, now)).filter((ban): ban is BanRecord => ban !== null).sort((a, b) => b.bannedAt - a.bannedAt);
  }
  async banOf(accountId: string, now: number): Promise<BanRecord | null> { return this.liveBan(accountId, now); }
  async setBan(ban: { accountId: string; reason: string; expiresAt: number | null }, by: AdminActor): Promise<BanRecord> {
    const before = this.liveBan(ban.accountId, by.at);
    const record: BanRecord = { ...ban, name: this.named(ban.accountId), bannedBy: by.accountId ?? by.credential, bannedAt: by.at };
    this.bans.set(ban.accountId, record);
    for (const [hash, session] of this.sessions) if (session.accountId === ban.accountId) this.sessions.delete(hash);
    this.log(by, { action: "ban.set", target: ban.accountId, before: before && { reason: before.reason, expiresAt: before.expiresAt },
      after: { reason: ban.reason, expiresAt: ban.expiresAt } });
    return record;
  }
  async removeBan(accountId: string, by: AdminActor): Promise<boolean> {
    const before = this.bans.get(accountId);
    if (!this.bans.delete(accountId)) return false;
    this.log(by, { action: "ban.remove", target: accountId, before: { reason: before!.reason, expiresAt: before!.expiresAt }, after: null });
    return true;
  }
  async createAdminSession(hash: string, accountId: string, role: ServerRole, expiresAt: number, by: AdminActor): Promise<void> {
    this.sessions.set(hash, { accountId, expiresAt });
    this.log(by, { action: "session.create", target: accountId, after: { role, expiresAt } });
  }
  async adminSession(hash: string, now: number): Promise<AdminSessionRecord | null> {
    const session = this.sessions.get(hash), role = session && this.roles.get(session.accountId);
    return session && role && session.expiresAt > now ? { accountId: session.accountId, role: role.role, expiresAt: session.expiresAt } : null;
  }
  async revokeAdminSession(hash: string, by: AdminActor): Promise<boolean> {
    if (!this.sessions.delete(hash)) return false;
    this.log(by, { action: "session.revoke", target: by.accountId, after: null });
    return true;
  }
  async revokeAdminSessionsFor(accountId: string): Promise<number> {
    let revoked = 0;
    for (const [hash, session] of this.sessions) if (session.accountId === accountId && this.sessions.delete(hash)) revoked++;
    return revoked;
  }
  async listApiTokens(): Promise<ApiTokenRecord[]> {
    return [...this.tokens.values()].map(entry => ({ ...entry.record })).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }
  async createApiToken(input: { id: string; hash: string; label: string; scopes: ApiScope[]; expiresAt: number | null }, by: AdminActor): Promise<ApiTokenRecord> {
    const record: ApiTokenRecord = { id: input.id, label: input.label, scopes: [...input.scopes], createdBy: by.accountId ?? by.credential,
      createdAt: by.at, lastUsedAt: null, expiresAt: input.expiresAt };
    this.tokens.set(input.id, { record, hash: input.hash });
    this.log(by, { action: "token.create", target: input.id, after: { label: input.label, scopes: input.scopes, expiresAt: input.expiresAt } });
    return { ...record };
  }
  async useApiToken(hash: string, now: number): Promise<ApiTokenRecord | null> {
    for (const entry of this.tokens.values()) if (sameDigest(entry.hash, hash)) {
      if (entry.record.expiresAt !== null && entry.record.expiresAt <= now) return null;
      entry.record.lastUsedAt = now;
      return { ...entry.record };
    }
    return null;
  }
  async revokeApiToken(id: string, by: AdminActor): Promise<boolean> {
    const entry = this.tokens.get(id);
    if (!entry) return false;
    this.tokens.delete(id);
    this.log(by, { action: "token.revoke", target: id, before: { label: entry.record.label, scopes: entry.record.scopes }, after: null });
    return true;
  }
  async record(by: AdminActor, entry: AuditWrite): Promise<void> { this.log(by, entry); }
  readonly auditWriter: AuditWriter = (by, entry) => this.log(by, entry);
  async audit(limit: number, before: number | null): Promise<AuditEntry[]> {
    return [...this.entries].reverse().filter(entry => before === null || entry.id < before).slice(0, limit);
  }
  private summary(row: MemoryPlayerRow, now: number): PlayerSummary {
    return { accountId: row.accountId, name: row.name, firstSeen: row.firstSeen, lastSeen: row.lastSeen, playtimeSeconds: row.playtimeSeconds,
      lastWorld: row.lastWorld, position: row.character?.player?.position ?? null, regionId: row.character?.player?.regionId ?? null,
      online: row.online, ban: this.liveBan(row.accountId, now) };
  }
  async listPlayers(query: string | null, limit: number, cursor: string | null, now: number): Promise<PlayerPage> {
    const seek = cursor === null ? null : splitCursor(cursor);
    const needle = query?.toLowerCase();
    const rows = [...this.source()]
      .filter(row => !needle || row.name.toLowerCase().includes(needle) || row.accountId.toLowerCase().includes(needle))
      .sort((a, b) => b.lastSeen - a.lastSeen || a.accountId.localeCompare(b.accountId))
      .filter(row => !seek || row.lastSeen < seek.lastSeen || (row.lastSeen === seek.lastSeen && row.accountId > seek.accountId));
    const page = rows.slice(0, limit).map(row => this.summary(row, now));
    const last = page.at(-1);
    return { players: page, cursor: rows.length > limit && last ? `${last.lastSeen}.${last.accountId}` : null };
  }
  async player(accountId: string, now: number): Promise<PlayerDetail | null> {
    for (const row of this.source()) if (row.accountId === accountId) return { ...this.summary(row, now), character: row.character };
    return null;
  }
  async itemHolders(itemIds: readonly string[], limit: number): Promise<ItemHolder[]> {
    const wanted = new Set(itemIds), found: ItemHolder[] = [];
    for (const row of this.source()) {
      for (const cache of row.recoveryCaches ?? []) for (const slot of cache.items) if (wanted.has(slot.itemId)) found.push({ accountId: row.accountId, name: row.name, itemId: slot.itemId, place: "recovery-cache", world: cache.world });
      const character = row.character; if (!character) continue;
      const places: [ItemHolder["place"], readonly ({ itemId: string } | null)[]][] = [["inventory", character.inventory.slots], ["bank", character.bank.slots], ["equipment", Object.values(character.equipment)]];
      for (const [place, slots] of places) for (const slot of slots) if (slot && wanted.has(slot.itemId)) found.push({ accountId: row.accountId, name: row.name, itemId: slot.itemId, place, world: null });
    }
    return found.sort((a, b) => a.accountId.localeCompare(b.accountId) || a.itemId.localeCompare(b.itemId)).slice(0, limit);
  }
}
