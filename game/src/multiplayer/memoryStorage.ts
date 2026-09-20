import type { PlayerCharacter, PlayerClaim, PlayerWorldRecord, StoredPlayerEdit, StoredPlayerEditResult, WorldCommitResult, WorldKey, WorldStorage, WorldStorageRecord } from "../contracts.js";
import { MemoryAdminStorage, type MemoryPlayerRow, type ServerAdminStorage } from "./adminStorage.js";
import { MemoryCatalogStorage, type CatalogStorage } from "./catalogStorage.js";
import { worldKey } from "./protocol.js";
import { PLAYER_LEASE_MS } from "./sqliteStorage.js";

interface Lease { world: string; sessionId: string; expiresAt: number; reserved: boolean }
interface Account { name: string; character: string | null; lastWorld: WorldKey | null; firstSeen: number; lastSeen: number }

/** The storage contract over plain maps, for tests and hosts that keep nothing. Same lease and fencing rules as SQLite. */
export class MemoryWorldStorage implements WorldStorage {
  /** The same administration surface as SQLite, over the accounts below. Playtime is not accounted here. */
  private readonly roles = new MemoryAdminStorage(() => this.playerRows());
  readonly admin: ServerAdminStorage = this.roles;
  readonly catalog: CatalogStorage = new MemoryCatalogStorage(this.roles.auditWriter);
  private readonly worlds = new Map<string, string>();
  private readonly accounts = new Map<string, Account>();
  private readonly owned = new Map<string, Map<string, string>>();
  private readonly leases = new Map<string, Lease>();
  constructor(private readonly now: () => number = Date.now) {}
  private playerRows(): MemoryPlayerRow[] {
    const at = this.now();
    return [...this.accounts].map(([accountId, account]) => {
      const lease = this.leases.get(accountId);
      const live = lease && !lease.reserved && lease.expiresAt > at ? JSON.parse(lease.world) as [string, string] : null;
      return { accountId, name: account.name, character: account.character ? JSON.parse(account.character) as PlayerCharacter : null,
        lastWorld: account.lastWorld, firstSeen: account.firstSeen, lastSeen: account.lastSeen, playtimeSeconds: 0,
        online: live ? { providerId: live[0]!, worldId: live[1]! } : null,
        recoveryCaches: [...this.owned].flatMap(([world, rows]) => {
          const items = rows.has(accountId) ? (JSON.parse(rows.get(accountId)!) as PlayerWorldRecord).ownedWorld.recoveryCache?.items : undefined;
          const [providerId, worldId] = JSON.parse(world) as [string, string];
          return items ? [{ world: { providerId, worldId }, items }] : [];
        }) };
    });
  }
  private compose(input: WorldKey, residentsOnly: boolean): WorldStorageRecord | null {
    const key = worldKey(input), json = this.worlds.get(key); if (!json) return null;
    const value = JSON.parse(json) as WorldStorageRecord;
    value.players = Object.create(null); value.receipts = Object.create(null);
    for (const [id, stored] of this.owned.get(key) ?? []) {
      const record = JSON.parse(stored) as PlayerWorldRecord, character = this.accounts.get(id)?.character;
      if (!character || residentsOnly && !record.ownedWorld.campfire && !record.ownedWorld.recoveryCache) continue;
      value.players[id] = { ...JSON.parse(character), ownedWorld: record.ownedWorld }; value.receipts[id] = record.receipts;
      if (record.random && value.random) value.random.players[id] = record.random;
    }
    return value;
  }
  async load(key: WorldKey): Promise<WorldStorageRecord | null> { return this.compose(key, false); }
  async openWorld(key: WorldKey): Promise<WorldStorageRecord | null> {
    for (const [id, lease] of this.leases) if (lease.world === worldKey(key)) this.leases.delete(id);
    return this.compose(key, true);
  }
  async claimPlayer(input: WorldKey, playerId: string, sessionId: string, name: string): Promise<PlayerClaim | null> {
    const key = worldKey(input), prior = this.leases.get(playerId), at = this.now();
    if (prior && prior.expiresAt > at && !prior.reserved) return null;
    this.leases.set(playerId, { world: key, sessionId, expiresAt: at + PLAYER_LEASE_MS, reserved: false });
    const account = this.accounts.get(playerId) ?? { name, character: null, lastWorld: null, firstSeen: at, lastSeen: at };
    account.name = name; account.lastSeen = at; this.accounts.set(playerId, account);
    const stored = this.owned.get(key)?.get(playerId);
    return { character: account.character ? JSON.parse(account.character) : null, lastWorld: account.lastWorld, world: stored ? JSON.parse(stored) : null };
  }
  async releasePlayer(key: WorldKey, playerId: string, sessionId: string): Promise<void> {
    const lease = this.leases.get(playerId);
    if (lease?.world === worldKey(key) && lease.sessionId === sessionId) this.leases.delete(playerId);
  }
  async commit(record: WorldStorageRecord): Promise<WorldCommitResult> {
    const key = worldKey(record.key), { leases = {}, audits = [], ...world } = record, fenced: string[] = [];
    // Serialise everything first so a value that cannot be stored changes nothing.
    const payload = JSON.stringify({ ...world, players: {}, receipts: {}, ...(record.random ? { random: { world: record.random.world, players: {} } } : {}),
      ...(record.entityWrites === "patch" ? { entityWrites: undefined, removedEntityIds: undefined, entities: this.patched(key, record) } : {}) });
    const own = <T>(map: Record<string, T> | undefined, id: string): T | undefined => map && Object.hasOwn(map, id) ? map[id] : undefined;
    const rows = Object.entries(record.players).map(([id, { ownedWorld, ...character }]) => ({ id, character: JSON.stringify(character),
      owned: JSON.stringify({ ownedWorld, receipts: own(record.receipts, id) ?? [], random: own(record.random?.players, id) } satisfies PlayerWorldRecord) }));
    let owned = this.owned.get(key); if (!owned) this.owned.set(key, owned = new Map());
    this.worlds.set(key, payload);
    for (const row of rows) {
      owned.set(row.id, row.owned);
      if (!Object.hasOwn(leases, row.id)) continue;
      const write = leases[row.id]!;
      const lease = this.leases.get(row.id), account = this.accounts.get(row.id);
      if (!account || lease?.world !== key || lease.sessionId !== write.sessionId) { fenced.push(row.id); continue; }
      account.character = row.character; account.lastWorld = { ...record.key }; account.lastSeen = this.now();
      if (write.action === "release") this.leases.delete(row.id);
      else { lease.expiresAt = this.now() + PLAYER_LEASE_MS; lease.reserved = write.action === "reserve"; }
    }
    for (const audit of audits) if (!fenced.includes(audit.accountId)) this.roles.auditWriter(audit.by, audit.entry);
    return { fenced };
  }
  private patched(key: string, record: WorldStorageRecord): WorldStorageRecord["entities"] {
    const prior = this.worlds.get(key), entities = new Map((prior ? (JSON.parse(prior) as WorldStorageRecord).entities : []).map(entity => [entity.id, entity]));
    for (const entity of record.entities) entities.set(entity.id, entity);
    for (const id of record.removedEntityIds ?? []) entities.delete(id);
    return [...entities.values()];
  }
  async editStoredPlayer(edit: StoredPlayerEdit): Promise<StoredPlayerEditResult> {
    const lease = this.leases.get(edit.accountId), account = this.accounts.get(edit.accountId);
    if (lease && !lease.reserved && lease.expiresAt > this.now()) return "leased";
    if (!account?.character) return "missing";
    if (JSON.stringify(JSON.parse(account.character)) !== JSON.stringify(edit.expected)) return "changed";
    account.character = JSON.stringify(edit.character);
    this.roles.auditWriter(edit.by, edit.entry);
    return "written";
  }
  async close(): Promise<void> {}
}
