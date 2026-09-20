import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PlayerCharacter, PlayerClaim, WorldCommitResult, WorldKey, WorldStorage, WorldStorageRecord } from "../contracts.js";
import type { PlayerSessionState } from "../state/store.js";
import { ADMIN_SCHEMA, SqliteAdminStorage, type ServerAdminStorage } from "./adminStorage.js";
import { worldKey } from "./protocol.js";

export const STORAGE_SCHEMA_VERSION = 2;
/** A live lease outlives this much silence from its world, then any world may take the account. */
export const PLAYER_LEASE_MS = 30_000;
/** Renewal and playtime accounting piggyback on a tick commit this often, never as a write of their own. */
export const PLAYER_LEASE_RENEW_MS = 10_000;

export interface SqliteStorageOptions {
  /** Wall clock in milliseconds. Lease expiry, first seen and last seen use it. */
  now?: () => number;
  /** Receives the one JSON line a schema migration writes. */
  log?: (line: string) => void;
}
type Receipt = WorldStorageRecord["receipts"][string][number];
interface Held { sessionId: string; renewedAt: number; accountedAt: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS worlds (world_key TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS world_entities (world_key TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,entity_id)) STRICT;
CREATE TABLE IF NOT EXISTS world_receipts (world_key TEXT NOT NULL, player_id TEXT NOT NULL, operation INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(world_key,player_id,operation)) STRICT;
CREATE TABLE IF NOT EXISTS players (account_id TEXT PRIMARY KEY, name TEXT NOT NULL, character TEXT, last_world TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, playtime_seconds INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE IF NOT EXISTS world_players (world_key TEXT NOT NULL, account_id TEXT NOT NULL, owned TEXT NOT NULL, random TEXT,
  resident INTEGER NOT NULL, PRIMARY KEY(world_key,account_id)) STRICT;
CREATE TABLE IF NOT EXISTS player_leases (account_id TEXT PRIMARY KEY, world_key TEXT NOT NULL, session_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE INDEX IF NOT EXISTS world_players_resident ON world_players (world_key) WHERE resident=1;`;

const split = (state: PlayerSessionState): { character: PlayerCharacter; owned: PlayerSessionState["ownedWorld"] } => {
  const { ownedWorld, ...character } = state; return { character, owned: ownedWorld };
};
const totalXp = (state: PlayerSessionState): number => Object.values(state.skills ?? {}).reduce((sum, skill) => sum + (skill?.xp ?? 0), 0);

/**
 * One server owns a database. `players` holds each account's character once; `world_players` holds
 * what that account owns in one world; `player_leases` says which world may write the character.
 * A tick's world state, receipts and leased characters share one SQLite transaction.
 *
 * `players.character` is the single source of a player's position: `$.player.position` and
 * `$.player.regionId`, meaningful in `last_world`.
 */
export class SqliteWorldStorage implements WorldStorage {
  readonly entityPatches = true;
  /** Roles, the setup code, bans, admin sessions, API tokens and the audit log, on this connection. */
  readonly admin: ServerAdminStorage;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private closed = false;
  private readonly cachedCharacters = new Map<string, Map<string, string>>();
  private readonly cachedOwned = new Map<string, Map<string, string>>();
  private readonly held = new Map<string, Map<string, Held>>();
  private readonly receiptTails = new Map<string, Map<string, Receipt | undefined>>();
  private readonly receiptHeads = new Map<string, Map<string, number>>();
  private readonly statements = new Map<string, StatementSync>();
  constructor(path: string, options: SqliteStorageOptions = {}) {
    this.now = options.now ?? Date.now;
    this.db = new DatabaseSync(path);
    try {
      // SQLite owns the OS lock, so a crashed process cannot leave a stale lock file.
      this.db.exec("PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      this.migrate(options.log ?? (line => console.log(line)));
    } catch (error) { this.db.close(); throw error; }
    this.admin = new SqliteAdminStorage(this.db);
  }
  /** Raw inspection for tests and migration tooling. Server code reads player data through
   * `WorldStorage` and administration through `admin`; nothing else may hold this handle. */
  get database(): DatabaseSync { return this.db; }
  /** The commit runs ten times a second per world, so its statements are parsed once. */
  private sql(text: string): StatementSync {
    let statement = this.statements.get(text); if (!statement) this.statements.set(text, statement = this.db.prepare(text));
    return statement;
  }

  /** Bring any earlier format to the current one in a single transaction. Reopening is a no-op. */
  private migrate(log: (line: string) => void): void {
    const table = (name: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const version = table("meta") ? Number(this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value ?? 0) : 0;
      if (version > STORAGE_SCHEMA_VERSION) throw new Error(`Database schema ${version} is newer than this server understands`);
      const legacy = version === 0 && table("worlds");
      this.db.exec(SCHEMA); this.db.exec(ADMIN_SCHEMA);
      if (legacy) log(JSON.stringify({ event: "storage-migrated", from: 1, to: STORAGE_SCHEMA_VERSION, ...this.extractPlayers() }));
      this.db.prepare("INSERT INTO meta (key,value) VALUES ('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(STORAGE_SCHEMA_VERSION));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  /**
   * Format 1 kept whole players per world: `world_chunks` rows keyed `["player",id]`, `["random",id]`
   * and `["receipts",id]`, or all of it inside `worlds.payload`. An id found in several worlds keeps
   * the character with the most total skill XP, then the higher world tick, then the lower world
   * key. Every world keeps what the player owns there, its receipts and its random cursor.
   */
  private extractPlayers() {
    const chunked = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='world_chunks'").get() !== undefined;
    const best = new Map<string, { key: string; tick: number; state: PlayerSessionState }>();
    const conflicts = new Map<string, string[]>();
    const putOwned = this.db.prepare("INSERT INTO world_players (world_key,account_id,owned,random,resident) VALUES (?,?,?,?,?)");
    const putReceipt = this.db.prepare("INSERT OR IGNORE INTO world_receipts (world_key,player_id,operation,payload) VALUES (?,?,?,?)");
    const hasReceipts = this.db.prepare("SELECT 1 FROM world_receipts WHERE world_key=? AND player_id=? LIMIT 1");
    const worlds = this.db.prepare("SELECT world_key, payload FROM worlds ORDER BY world_key").all();
    for (const row of worlds) {
      const key = String(row.world_key), value = JSON.parse(String(row.payload)) as WorldStorageRecord;
      let players: WorldStorageRecord["players"] = Object.assign(Object.create(null), value.players), receipts: WorldStorageRecord["receipts"] = Object.assign(Object.create(null), value.receipts);
      const random: Record<string, unknown> = Object.assign(Object.create(null), value.random?.players);
      const chunks = chunked ? this.db.prepare("SELECT chunk_key, payload FROM world_chunks WHERE world_key=?").all(key) : [];
      if (chunks.length) { players = Object.create(null); receipts = Object.create(null); }
      for (const chunk of chunks) {
        const [kind, id] = JSON.parse(String(chunk.chunk_key)) as [string, string];
        if (kind === "player") players[id] = JSON.parse(String(chunk.payload));
        if (kind === "receipts") receipts[id] = JSON.parse(String(chunk.payload));
        if (kind === "random") random[id] = JSON.parse(String(chunk.payload));
      }
      for (const [id, state] of Object.entries(players)) {
        const owned = state.ownedWorld ?? { recoveryCache: null, campfire: null, obstaclesUsed: {} };
        putOwned.run(key, id, JSON.stringify(owned), random[id] ? JSON.stringify(random[id]) : null, owned.campfire || owned.recoveryCache ? 1 : 0);
        const candidate = { key, tick: value.tick, state }, prior = best.get(id);
        if (prior) conflicts.set(id, [...(conflicts.get(id) ?? [prior.key]), key]);
        if (!prior || totalXp(state) > totalXp(prior.state) || totalXp(state) === totalXp(prior.state) && value.tick > prior.tick) best.set(id, candidate);
      }
      // Receipt rows supersede the older per-player receipt chunk, exactly as format 1 read them.
      for (const [id, ledger] of Object.entries(receipts)) if (!hasReceipts.get(key, id))
        for (const receipt of ledger) putReceipt.run(key, id, receipt.operation, JSON.stringify(receipt));
      const world = { ...value, players: {}, receipts: {}, ...(value.random ? { random: { world: value.random.world, players: {} } } : {}) };
      delete (world as { playerWrites?: unknown }).playerWrites;
      this.db.prepare("UPDATE worlds SET payload=? WHERE world_key=?").run(JSON.stringify(world), key);
    }
    const putPlayer = this.db.prepare("INSERT INTO players (account_id,name,character,last_world,first_seen,last_seen) VALUES (?,?,?,?,?,?)");
    const at = this.now();
    for (const [id, { key, state }] of best) putPlayer.run(id, String(state.player?.name ?? id).slice(0, 64), JSON.stringify(split(state).character), key, at, at);
    if (chunked) this.db.exec("DROP TABLE world_chunks");
    return { worlds: worlds.length, players: best.size,
      conflicts: [...conflicts].map(([playerId, found]) => ({ playerId, kept: best.get(playerId)!.key, discarded: found.filter(key => key !== best.get(playerId)!.key) })) };
  }

  private world(key: string): WorldStorageRecord | null {
    const row = this.db.prepare("SELECT payload FROM worlds WHERE world_key=?").get(key);
    if (!row) return null;
    const value = JSON.parse(String(row.payload)) as WorldStorageRecord;
    if (value.entityWrites === "patch") {
      value.entities = this.db.prepare("SELECT payload FROM world_entities WHERE world_key=? ORDER BY rowid").all(key).map(entity => JSON.parse(String(entity.payload)));
      delete value.entityWrites; delete value.removedEntityIds;
    }
    if (value.schemaVersion !== 1 || worldKey(value.key) !== key) throw new Error("Unsupported or mismatched world storage");
    value.players = Object.create(null); value.receipts = Object.create(null);
    return value;
  }
  private receipts(key: string, playerId: string): Receipt[] {
    return this.db.prepare("SELECT payload FROM world_receipts WHERE world_key=? AND player_id=? ORDER BY operation").all(key, playerId).map(row => JSON.parse(String(row.payload)));
  }
  private compose(input: WorldKey, residentsOnly: boolean): WorldStorageRecord | null {
    const key = worldKey(input), value = this.world(key); if (!value) return null;
    const rows = this.db.prepare(`SELECT w.account_id, w.owned, w.random, p.character FROM world_players w JOIN players p ON p.account_id=w.account_id
      WHERE w.world_key=? AND p.character IS NOT NULL${residentsOnly ? " AND w.resident=1" : ""} ORDER BY w.rowid`).all(key);
    for (const row of rows) {
      const id = String(row.account_id), character = JSON.parse(String(row.character)) as PlayerCharacter;
      if (character.player?.id !== id) throw new Error("Stored player identity mismatch");
      value.players[id] = { ...character, ownedWorld: JSON.parse(String(row.owned)) };
      value.receipts[id] = this.receipts(key, id);
      if (row.random && value.random) value.random.players[id] = JSON.parse(String(row.random));
    }
    return value;
  }
  async load(key: WorldKey): Promise<WorldStorageRecord | null> { return this.compose(key, false); }
  async openWorld(key: WorldKey): Promise<WorldStorageRecord | null> {
    // Only one host runs a world, so a lease naming it at start belongs to a life that ended.
    this.db.prepare("DELETE FROM player_leases WHERE world_key=?").run(worldKey(key));
    this.held.delete(worldKey(key));
    return this.compose(key, true);
  }
  async claimPlayer(input: WorldKey, playerId: string, sessionId: string, name: string): Promise<PlayerClaim | null> {
    const key = worldKey(input), at = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM player_leases WHERE expires_at<=?").run(at);
      // Compare and set: the insert lands only when no live session holds the account.
      const taken = this.db.prepare(`INSERT INTO player_leases (account_id,world_key,session_id,claimed_at,expires_at,reserved) VALUES (?,?,?,?,?,0)
        ON CONFLICT(account_id) DO UPDATE SET world_key=excluded.world_key, session_id=excluded.session_id, claimed_at=excluded.claimed_at,
        expires_at=excluded.expires_at, reserved=0 WHERE player_leases.reserved=1`).run(playerId, key, sessionId, at, at + PLAYER_LEASE_MS);
      if (!taken.changes) { this.db.exec("ROLLBACK"); return null; }
      this.db.prepare(`INSERT INTO players (account_id,name,first_seen,last_seen) VALUES (?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET name=excluded.name, last_seen=excluded.last_seen`).run(playerId, name, at, at);
      const player = this.db.prepare("SELECT character, last_world FROM players WHERE account_id=?").get(playerId)!;
      const owned = this.db.prepare("SELECT owned, random FROM world_players WHERE world_key=? AND account_id=?").get(key, playerId);
      const character = player.character ? JSON.parse(String(player.character)) as PlayerCharacter : null;
      if (character && character.player?.id !== playerId) throw new Error("Stored player identity mismatch");
      const [providerId, worldId] = player.last_world ? JSON.parse(String(player.last_world)) as [string, string] : [];
      const claim: PlayerClaim = { character, lastWorld: providerId !== undefined && worldId !== undefined ? { providerId, worldId } : null,
        world: owned ? { ownedWorld: JSON.parse(String(owned.owned)), receipts: this.receipts(key, playerId), ...(owned.random ? { random: JSON.parse(String(owned.random)) } : {}) } : null };
      this.db.exec("COMMIT");
      for (const held of this.held.values()) held.delete(playerId);
      let held = this.held.get(key); if (!held) this.held.set(key, held = new Map());
      held.set(playerId, { sessionId, renewedAt: at, accountedAt: at });
      return claim;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  async releasePlayer(key: WorldKey, playerId: string, sessionId: string): Promise<void> {
    this.db.prepare("DELETE FROM player_leases WHERE account_id=? AND world_key=? AND session_id=?").run(playerId, worldKey(key), sessionId);
    const held = this.held.get(worldKey(key)); if (held?.get(playerId)?.sessionId === sessionId) held.delete(playerId);
  }
  async commit(record: WorldStorageRecord): Promise<WorldCommitResult> {
    const key = worldKey(record.key), at = this.now();
    const patchEntities = record.entityWrites === "patch";
    const { leases = {}, ...world } = record;
    const payload = JSON.stringify({ ...world, ...(patchEntities ? { entities: [], removedEntityIds: [] } : {}), players: {}, receipts: {}, ...(record.random ? { random: { world: record.random.world, players: {} } } : {}) });
    const priorCharacters = this.cachedCharacters.get(key), nextCharacters = new Map<string, string>();
    const priorOwned = this.cachedOwned.get(key), nextOwned = new Map<string, string>();
    const priorReceipts = this.receiptTails.get(key), nextReceipts = new Map<string, Receipt | undefined>();
    const priorHeads = this.receiptHeads.get(key), nextHeads = new Map<string, number>();
    let held = this.held.get(key); if (!held) this.held.set(key, held = new Map());
    const fenced: string[] = [], settled: (() => void)[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (patchEntities) {
        const putEntity = this.sql("INSERT INTO world_entities (world_key,entity_id,payload) VALUES (?,?,?) ON CONFLICT(world_key,entity_id) DO UPDATE SET payload=excluded.payload");
        // Upgrade a full-entity save in the same transaction, retaining omitted old rows.
        const old = this.sql("SELECT payload FROM worlds WHERE world_key=?").get(key);
        if (old) {
          const prior = JSON.parse(String(old.payload)) as WorldStorageRecord;
          if (prior.entityWrites !== "patch") for (const entity of prior.entities) putEntity.run(key, entity.id, JSON.stringify(entity));
        }
        for (const entity of record.entities) putEntity.run(key, entity.id, JSON.stringify(entity));
        const removeEntity = this.sql("DELETE FROM world_entities WHERE world_key=? AND entity_id=?");
        for (const id of record.removedEntityIds ?? []) removeEntity.run(key, id);
      } else this.sql("DELETE FROM world_entities WHERE world_key=?").run(key);
      this.sql("INSERT INTO worlds (world_key, payload) VALUES (?, ?) ON CONFLICT(world_key) DO UPDATE SET payload = excluded.payload").run(key, payload);

      const putOwned = this.sql(`INSERT INTO world_players (world_key,account_id,owned,random,resident) VALUES (?,?,?,?,?)
        ON CONFLICT(world_key,account_id) DO UPDATE SET owned=excluded.owned, random=excluded.random, resident=excluded.resident`);
      // Each statement below changes a row only while the lease still names this world and session.
      const holds = "account_id=? AND world_key=? AND session_id=?";
      const writeFenced = this.sql(`UPDATE players SET character=?, last_world=? WHERE account_id=? AND EXISTS (SELECT 1 FROM player_leases WHERE ${holds})`);
      const write = this.sql("UPDATE players SET character=?, last_world=?, last_seen=?, playtime_seconds=playtime_seconds+? WHERE account_id=?");
      const renew = this.sql(`UPDATE player_leases SET expires_at=?, reserved=? WHERE ${holds}`);
      const free = this.sql(`DELETE FROM player_leases WHERE ${holds}`);
      for (const [id, state] of Object.entries(record.players)) {
        const { character, owned } = split(state), random = record.random && Object.hasOwn(record.random.players, id) ? record.random.players[id] : undefined;
        const ownedJson = `${JSON.stringify(owned)}\n${random ? JSON.stringify(random) : ""}`; nextOwned.set(id, ownedJson);
        if (priorOwned?.get(id) !== ownedJson) putOwned.run(key, id, JSON.stringify(owned), random ? JSON.stringify(random) : null, owned.campfire || owned.recoveryCache ? 1 : 0);
        if (!Object.hasOwn(leases, id)) continue;
        const lease = leases[id]!;
        const json = JSON.stringify(character), holder = held.get(id);
        const current = holder?.sessionId === lease.sessionId ? holder : { sessionId: lease.sessionId, renewedAt: -Infinity, accountedAt: at };
        if (lease.action === "hold" && at - current.renewedAt < PLAYER_LEASE_RENEW_MS) {
          if (priorCharacters?.get(id) === json) { nextCharacters.set(id, json); continue; }
          if (writeFenced.run(json, key, id, id, key, lease.sessionId).changes) nextCharacters.set(id, json); else fenced.push(id);
          continue;
        }
        const kept = lease.action === "release" ? free.run(id, key, lease.sessionId)
          : renew.run(at + PLAYER_LEASE_MS, lease.action === "reserve" ? 1 : 0, id, key, lease.sessionId);
        if (!kept.changes) { fenced.push(id); continue; }
        const seconds = Math.max(0, Math.floor((at - current.accountedAt) / 1000));
        write.run(json, key, at, seconds, id);
        if (lease.action === "hold") { nextCharacters.set(id, json); settled.push(() => held!.set(id, { sessionId: lease.sessionId, renewedAt: at, accountedAt: current.accountedAt + seconds * 1000 })); }
        else settled.push(() => { if (held!.get(id)?.sessionId === lease.sessionId) held!.delete(id); });
      }
      const putReceipt = this.sql("INSERT INTO world_receipts (world_key,player_id,operation,payload) VALUES (?,?,?,?) ON CONFLICT(world_key,player_id,operation) DO UPDATE SET payload=excluded.payload");
      const pruneReceipts = this.sql("DELETE FROM world_receipts WHERE world_key=? AND player_id=? AND operation<?");
      for (const [id, receipts] of Object.entries(record.receipts)) {
        const tail = receipts.at(-1), prior = priorReceipts?.get(id); nextReceipts.set(id, tail);
        const head = receipts[0]?.operation ?? Number.MAX_SAFE_INTEGER; nextHeads.set(id, head);
        if (prior && tail === prior && priorHeads?.get(id) === head) continue;
        for (const receipt of receipts) if (!prior || receipt.operation > prior.operation) putReceipt.run(key, id, receipt.operation, JSON.stringify(receipt));
        pruneReceipts.run(key, id, head);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    for (const apply of settled) apply();
    for (const id of fenced) if (held.get(id)?.sessionId === leases[id]!.sessionId) held.delete(id);
    this.cachedCharacters.set(key, nextCharacters); this.cachedOwned.set(key, nextOwned);
    this.receiptTails.set(key, nextReceipts); this.receiptHeads.set(key, nextHeads);
    return { fenced };
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    this.db.close();
    this.statements.clear(); this.cachedCharacters.clear(); this.cachedOwned.clear(); this.held.clear(); this.receiptTails.clear(); this.receiptHeads.clear();
  }
}
