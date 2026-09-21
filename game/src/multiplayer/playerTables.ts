import type { PlayerCharacter, WorldKey } from "../contracts.js";
import type {
  AdminActor, AdminSessionRecord, ApiScope, ApiTokenRecord, AuditEntry, AuditFilter, AuditWrite, AuditWriter,
  BanRecord, ItemHolder, PlayerDetail, PlayerPage, PlayerSummary, RoleRecord, ServerAdminStorage, ServerRole,
} from "./adminStorage.js";

/**
 * The storage rules that need no Node built-in: the lease clock, the constant-time digest compare,
 * the player cursor and the whole in-memory administration table.
 *
 * `memoryStorage.ts` has to run in a browser worker as well as on the server, and it reached
 * `node:crypto` through `adminStorage.ts` and `node:sqlite` through `sqliteStorage.ts` for exactly
 * these pieces. Nothing here may import a Node built-in, or a module that does at run time;
 * `tests/browser-import-graph.test.ts` fails when one appears. Type-only imports are erased, so the
 * record shapes still live next to the interface they implement.
 */

/** A live lease outlives this much silence from its world, then any world may take the account. */
export const PLAYER_LEASE_MS = 30_000;

/**
 * Constant time over equal-length digests; unequal lengths were never the same secret.
 *
 * The same answer as `timingSafeEqual` over the UTF-8 bytes it replaces: every caller compares hex
 * digests, and two strings of the same length differ in a code unit exactly when their bytes differ.
 */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let at = 0; at < a.length; at++) differences |= a.charCodeAt(at) ^ b.charCodeAt(at);
  return differences === 0;
}

/** Prefix matches, so `player.` finds every player write and `acc_AAAA` every account that starts that way. */
const prefixed = (filter: AuditFilter | undefined, entry: AuditEntry): boolean => !filter || (
  (filter.action === undefined || entry.action.startsWith(filter.action)) && (filter.account === undefined || (entry.accountId ?? "").startsWith(filter.account))
  && (filter.target === undefined || (entry.target ?? "").startsWith(filter.target)));

export function splitCursor(cursor: string): { lastSeen: number; accountId: string } | null {
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
  private readonly overrides = new Map<string, unknown>();
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
  async audit(limit: number, before: number | null, filter?: AuditFilter): Promise<AuditEntry[]> {
    return [...this.entries].reverse().filter(entry => (before === null || entry.id < before) && prefixed(filter, entry)).slice(0, limit);
  }
  async settings(): Promise<Record<string, unknown>> { return structuredClone(Object.fromEntries([...this.overrides].sort(([a], [b]) => a.localeCompare(b)))); }
  async setSettings(changes: Readonly<Record<string, unknown>>, by: AdminActor): Promise<Record<string, unknown>> {
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      const prior = this.overrides.get(key) ?? null;
      if (JSON.stringify(prior) === JSON.stringify(value ?? null)) continue;
      before[key] = prior; after[key] = value ?? null;
      if (value === null || value === undefined) this.overrides.delete(key); else this.overrides.set(key, structuredClone(value));
    }
    if (Object.keys(after).length) this.log(by, { action: "settings.set", target: null, before, after });
    return this.settings();
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
