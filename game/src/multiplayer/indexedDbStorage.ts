/**
 * Local play's durable store: the in-memory world storage with write-behind persistence.
 *
 * The host commits ten times a second. A commit that awaited IndexedDB would put a database round
 * trip inside the tick loop, so a commit here only applies in memory (`MemoryWorldStorage`, whose
 * lease and fencing rules are the ones the server runs) and marks the rows it changed. A timer
 * writes the marked rows through a `KeyValuePort` about every `flushMs`, and `close()` writes them
 * at once.
 *
 * Crash consistency comes from two rules. Every marked row holds the value as of the commit that
 * marked it, copied there and then, and one flush writes every row marked since the last successful
 * flush in a single port batch — one IndexedDB transaction. So a batch is always a consistent cut
 * of the world: a killed tab loses at most `flushMs` of play, and never lands with an item both on
 * the ground and in an inventory.
 *
 * Nothing here may import a Node built-in: `tests/browser-import-graph.test.ts` guards that.
 */
import type {
  PlayerClaim, StoredPlayerEdit, StoredPlayerEditResult, SemanticEntity,
  WorldCommitResult, WorldKey, WorldStorageRecord,
} from "../contracts.js";
import { MemoryWorldStorage, type Account } from "./memoryStorage.js";
import { worldKey } from "./protocol.js";

/** The little of a key-value database this storage needs. One `write` batch is one transaction. */
export interface KeyValuePort {
  get(store: string, key: string): Promise<unknown>;
  getAll(store: string): Promise<[string, unknown][]>;
  write(batch: { store: string; key: string; value?: unknown; delete?: true }[]): Promise<void>;
  close(): Promise<void>;
}

type PortWrite = { store: string; key: string; value?: unknown; delete?: true };

/**
 * Few stores, each holding whole rows the hydrate path can hand straight to memory:
 * `meta` one record, `worlds` one per world without its entities, `entities` one per entity so a
 * flush writes only the handful a tick changed, `players` one per account, `worldPlayers` one per
 * account per world (owned objects, receipts and that world's random cursor).
 */
export const LOCAL_STORE_NAMES = ["meta", "worlds", "entities", "players", "worldPlayers"] as const;
export type LocalStoreName = (typeof LOCAL_STORE_NAMES)[number];

/** Record shapes in the stores. Bump with a step in `UPGRADES`; never renumber downwards. */
export const LOCAL_SCHEMA_VERSION = 1;
/** The IndexedDB database version, which only ever creates the object stores above. */
const DATABASE_VERSION = 1;
const DEFAULT_DATABASE = "corealm.local";
const DEFAULT_LOCK = "corealm.local-world";
const META_KEY = "store";
/** No key in any store contains a NUL, so it separates a composite key without escaping. */
const SEPARATOR = "\u0000";

export interface LocalStoreMeta {
  schemaVersion: number;
  /** The catalog revision the last commit was written under, for diagnosis. */
  catalogRevision: string | null;
  updatedAt: number;
}

/** Forward-only, keyed by the version being left. A store from the future is refused instead. */
const UPGRADES: Record<number, (port: KeyValuePort) => Promise<void>> = {};

/**
 * Held for the lifetime of one open store, so a second tab cannot write over the first. `release`
 * may report when the lock is really gone, which `close()` awaits so the next open can take it.
 */
export interface LocalStoreLock { release(): void | Promise<void> }

/** A second tab tried to open local play. The first one still owns the store. */
export class LocalPlayBusyError extends Error {
  readonly code = "LOCAL_PLAY_BUSY";
  constructor(message = "Local play is already open in another tab") { super(message); this.name = "LocalPlayBusyError"; }
}

/** A flush failed: quota, a blocked upgrade, an aborted transaction. The data is still in memory. */
export interface LocalStorageErrorEvent {
  type: "storage-error";
  error: unknown;
  /** Consecutive failed flushes, this one included. */
  attempt: number;
  /** Rows still waiting to be written. */
  pending: number;
  /** True once the store gave up retrying and play continues in memory only. */
  degraded: boolean;
}

export interface LocalWorldStorageOptions {
  /** Defaults to `indexedDbPort()`. Tests pass `memoryPort()`. */
  port?: KeyValuePort;
  /** Write-behind cadence while dirty. Default 5000 ms. */
  flushMs?: number;
  now?: () => number;
  /** Single-owner guard, injectable for tests. Null means another owner holds the store. */
  guard?: (name: string) => Promise<LocalStoreLock | null>;
  lockName?: string;
  databaseName?: string;
  onError?: (event: LocalStorageErrorEvent) => void;
  /** Consecutive failed flushes before the store stops retrying and runs in memory. Default 5. */
  maxFlushFailures?: number;
}

const rowKey = (store: string, key: string): string => `${store}${SEPARATOR}${key}`;
const entityKey = (world: string, id: string): string => `${world}${SEPARATOR}${id}`;

/** Everything a world record keeps outside its entities and its players. */
type StoredWorldRow =
  Omit<WorldStorageRecord, "entities" | "players" | "receipts" | "leases" | "audits" | "entityWrites" | "removedEntityIds" | "random">
  & { random?: { world: NonNullable<WorldStorageRecord["random"]>["world"] } };

/**
 * The storage local play runs on. Everything `WorldStorage` promises, plus the write-behind
 * controls the worker needs: `flush()` before it acknowledges a save, `dirty` for its shutdown path.
 */
export class LocalWorldStorage extends MemoryWorldStorage {
  /** Entity rows are written one at a time, so a tick that moved one creature writes one row. */
  readonly entityPatches = true;
  private readonly port: KeyValuePort;
  private readonly lock: LocalStoreLock;
  private readonly flushMs: number;
  private readonly maxFailures: number;
  private readonly onError: ((event: LocalStorageErrorEvent) => void) | undefined;
  private readonly clock: () => number;
  /** Rows changed since the last successful flush, at their committed values. The consistent cut. */
  private readonly pending = new Map<string, PortWrite>();
  /** Which entity rows each world has on disk, so a full commit can delete the ones it dropped. */
  private readonly entityIds = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private failures = 0;
  private degraded = false;
  private closed = false;
  private revision: string | null | undefined;

  constructor(port: KeyValuePort, lock: LocalStoreLock, options: LocalWorldStorageOptions = {}) {
    const clock = options.now ?? Date.now;
    super(clock);
    this.port = port; this.lock = lock; this.clock = clock;
    this.flushMs = options.flushMs ?? 5_000;
    this.maxFailures = options.maxFlushFailures ?? 5;
    this.onError = options.onError;
  }

  /** Rows are waiting to be written. False right after a successful flush. */
  get dirty(): boolean { return this.pending.size > 0; }
  /** The store gave up on the port after `maxFlushFailures` and play continues in memory only. */
  get memoryOnly(): boolean { return this.degraded; }

  /** Read the port back into memory. Leases are never stored, so a dead tab leaves none behind. */
  async hydrate(): Promise<void> {
    const meta = await this.port.get("meta", META_KEY) as LocalStoreMeta | undefined;
    const version = meta?.schemaVersion ?? LOCAL_SCHEMA_VERSION;
    if (version > LOCAL_SCHEMA_VERSION) {
      throw new Error(`This local save was written by a newer build (schema ${version} > ${LOCAL_SCHEMA_VERSION})`);
    }
    for (let at = version; at < LOCAL_SCHEMA_VERSION; at++) await UPGRADES[at]?.(this.port);
    const [worlds, entities, players, worldPlayers] = await Promise.all([
      this.port.getAll("worlds"), this.port.getAll("entities"), this.port.getAll("players"), this.port.getAll("worldPlayers"),
    ]);
    const byWorld = new Map<string, SemanticEntity[]>();
    for (const [key, value] of entities) {
      const world = key.slice(0, key.indexOf(SEPARATOR)), entity = value as SemanticEntity;
      let list = byWorld.get(world); if (!list) byWorld.set(world, list = []);
      list.push(entity);
      let ids = this.entityIds.get(world); if (!ids) this.entityIds.set(world, ids = new Set());
      ids.add(entity.id);
    }
    for (const [key, value] of worlds) {
      const { random, ...row } = value as StoredWorldRow;
      this.worlds.set(key, JSON.stringify({
        ...row, players: {}, receipts: {}, entities: byWorld.get(key) ?? [],
        ...(random ? { random: { world: random.world, players: {} } } : {}),
      } satisfies WorldStorageRecord));
    }
    for (const [key, value] of players) this.accounts.set(key, value as Account);
    for (const [key, value] of worldPlayers) {
      const at = key.indexOf(SEPARATOR), world = key.slice(0, at);
      let rows = this.owned.get(world); if (!rows) this.owned.set(world, rows = new Map());
      rows.set(key.slice(at + 1), value as string);
    }
    this.revision = meta?.catalogRevision;
    if (!meta) this.mark("meta", META_KEY, { schemaVersion: LOCAL_SCHEMA_VERSION, catalogRevision: null, updatedAt: this.clock() } satisfies LocalStoreMeta);
  }

  override async commit(record: WorldStorageRecord): Promise<WorldCommitResult> {
    const result = await super.commit(record);
    const key = worldKey(record.key);
    const { entities: _entities, players: _players, receipts: _receipts, leases: _leases, audits: _audits,
      entityWrites: _writes, removedEntityIds: _removed, random, ...rest } = record;
    this.mark("worlds", key, structuredClone({ ...rest, ...(random ? { random: { world: random.world } } : {}) } satisfies StoredWorldRow));
    this.markEntities(key, record);
    for (const id of Object.keys(record.players)) this.markPlayer(key, id);
    this.markMeta(record.catalogRevision);
    this.schedule();
    return result;
  }

  override async claimPlayer(key: WorldKey, playerId: string, sessionId: string, name: string): Promise<PlayerClaim | null> {
    const claim = await super.claimPlayer(key, playerId, sessionId, name);
    // A claim creates the account row and moves `lastSeen`; the lease itself is never stored.
    if (claim) { this.markPlayer(worldKey(key), playerId); this.schedule(); }
    return claim;
  }

  override async editStoredPlayer(edit: StoredPlayerEdit): Promise<StoredPlayerEditResult> {
    const result = await super.editStoredPlayer(edit);
    if (result === "written") { this.markAccount(edit.accountId); this.schedule(); }
    return result;
  }

  /**
   * Write every row marked since the last successful flush as one batch, then leave the store
   * clean. Never throws: a store that cannot write must not take the host down with it.
   */
  async flush(): Promise<void> {
    while (this.running) await this.running;
    if (!this.pending.size || this.degraded) return;
    this.running = this.writePending();
    try { await this.running; } finally { this.running = null; }
  }

  private async writePending(): Promise<void> {
    const batch = [...this.pending.values()];
    this.pending.clear();
    try {
      await this.port.write(batch);
      this.failures = 0;
    } catch (error) {
      // Put back only the rows no later commit has already replaced, so the next batch stays one
      // consistent cut rather than a stale row beside a fresh one.
      for (const write of batch) {
        const at = rowKey(write.store, write.key);
        if (!this.pending.has(at)) this.pending.set(at, write);
      }
      this.failures++;
      this.degraded = this.failures >= this.maxFailures;
      this.onError?.({ type: "storage-error", error, attempt: this.failures, pending: this.pending.size, degraded: this.degraded });
    }
  }

  override async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    await this.flush();
    await this.port.close();
    await this.lock.release();
  }

  private mark(store: LocalStoreName, key: string, value: unknown): void {
    this.pending.set(rowKey(store, key), { store, key, value });
  }

  private drop(store: LocalStoreName, key: string): void {
    this.pending.set(rowKey(store, key), { store, key, delete: true });
  }

  /** The memory store already holds the exact strings a hydrate hands back, so copy those. */
  private markAccount(id: string): void {
    const account = this.accounts.get(id);
    if (account) this.mark("players", id, { ...account, lastWorld: account.lastWorld ? { ...account.lastWorld } : null } satisfies Account);
  }

  private markPlayer(world: string, id: string): void {
    this.markAccount(id);
    const owned = this.owned.get(world)?.get(id);
    if (owned !== undefined) this.mark("worldPlayers", entityKey(world, id), owned);
  }

  private markEntities(world: string, record: WorldStorageRecord): void {
    let known = this.entityIds.get(world); if (!known) this.entityIds.set(world, known = new Set());
    if (record.entityWrites === "patch") {
      for (const entity of record.entities) { known.add(entity.id); this.mark("entities", entityKey(world, entity.id), structuredClone(entity)); }
      for (const id of record.removedEntityIds ?? []) { known.delete(id); this.drop("entities", entityKey(world, id)); }
      return;
    }
    // A full record replaces the world's entities, so rows it no longer names are gone.
    const next = new Set(record.entities.map(entity => entity.id));
    for (const id of known) if (!next.has(id)) this.drop("entities", entityKey(world, id));
    for (const entity of record.entities) this.mark("entities", entityKey(world, entity.id), structuredClone(entity));
    this.entityIds.set(world, next);
  }

  private markMeta(catalogRevision: string | null): void {
    if (this.revision === catalogRevision) return;
    this.revision = catalogRevision;
    this.mark("meta", META_KEY, { schemaVersion: LOCAL_SCHEMA_VERSION, catalogRevision, updatedAt: this.clock() } satisfies LocalStoreMeta);
  }

  private schedule(): void {
    if (this.timer !== null || this.closed || this.degraded || !this.pending.size) return;
    // A failed flush backs off: the quota does not clear in the next five seconds.
    const delay = this.failures ? this.flushMs * 2 ** Math.min(this.failures, 4) : this.flushMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().then(() => this.schedule());
    }, delay);
    // Node keeps the process alive for a pending timer; a write-behind timer must not.
    (this.timer as { unref?: () => void }).unref?.();
  }
}

/**
 * Open the local store. Fails with `LocalPlayBusyError` when another tab already holds it: two tabs
 * writing one IndexedDB would each commit a world the other never saw.
 */
export async function openLocalWorldStorage(options: LocalWorldStorageOptions = {}): Promise<LocalWorldStorage> {
  const lock = await (options.guard ?? singleOwnerLock)(options.lockName ?? DEFAULT_LOCK);
  if (!lock) throw new LocalPlayBusyError();
  let port: KeyValuePort | undefined;
  try {
    port = options.port ?? await indexedDbPort(options.databaseName);
    const storage = new LocalWorldStorage(port, lock, options);
    await storage.hydrate();
    return storage;
  } catch (error) {
    await port?.close().catch(() => {});
    await lock.release();
    throw error;
  }
}

interface LockManagerLike {
  request(name: string, options: { mode: "exclusive"; ifAvailable: true }, run: (lock: unknown) => Promise<void>): Promise<void>;
}

/**
 * Web Locks, which workers have too. The lock is held until the callback's promise settles, so
 * `release` resolves it. A runtime without the API (Node tests) grants an uncontested lock.
 */
async function singleOwnerLock(name: string): Promise<LocalStoreLock | null> {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  if (!locks) return { release() {} };
  let held!: () => void;
  let request!: Promise<void>;
  const until = new Promise<void>(resolve => { held = resolve; });
  return new Promise<LocalStoreLock | null>((resolve, reject) => {
    request = locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) { resolve(null); return; }
      // The lock is gone only once `request` settles, so releasing reports that, not the hand-off.
      resolve({ release: () => { held(); return request; } });
      await until;
    });
    request.catch(reject);
  });
}

/** The port in memory, for tests and for a browser with no IndexedDB. Clones like a database does. */
export function memoryPort(): KeyValuePort {
  const stores = new Map<string, Map<string, unknown>>();
  const of = (store: string): Map<string, unknown> => {
    let rows = stores.get(store); if (!rows) stores.set(store, rows = new Map());
    return rows;
  };
  return {
    async get(store, key) { return structuredClone(of(store).get(key)); },
    async getAll(store) {
      return [...of(store)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, structuredClone(value)] as [string, unknown]);
    },
    async write(batch) {
      // One batch, one transaction: build every row first so a value that cannot be cloned changes nothing.
      const staged = batch.map(write => ({ ...write, value: write.delete ? undefined : structuredClone(write.value) }));
      for (const write of staged) { if (write.delete) of(write.store).delete(write.key); else of(write.store).set(write.key, write.value); }
    },
    async close() {},
  };
}

/** The real thing. One `write` batch is one IndexedDB transaction over every store, so it is atomic. */
export async function indexedDbPort(name = DEFAULT_DATABASE): Promise<KeyValuePort> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) throw new Error("This browser has no IndexedDB, so local play cannot be saved");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      for (const store of LOCAL_STORE_NAMES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onblocked = () => reject(new Error("Another tab is holding an older version of the local save open"));
    request.onerror = () => reject(request.error ?? new Error("Could not open the local save"));
    request.onsuccess = () => resolve(request.result);
  });
  // Another tab asking for a new version would block forever on a connection nobody closes.
  database.onversionchange = () => database.close();
  const settled = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("The local save transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("The local save transaction failed"));
  });
  const read = <T>(store: string, run: (target: IDBObjectStore) => IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    const request = run(database.transaction(store, "readonly").objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The local save could not be read"));
  });
  return {
    async get(store, key) { return read(store, target => target.get(key)); },
    async getAll(store) {
      const [keys, values] = await Promise.all([read(store, target => target.getAllKeys()), read(store, target => target.getAll())]);
      return keys.map((key, at) => [String(key), values[at]] as [string, unknown]);
    },
    async write(batch) {
      if (!batch.length) return;
      const transaction = database.transaction([...LOCAL_STORE_NAMES], "readwrite");
      const done = settled(transaction);
      for (const write of batch) {
        const target = transaction.objectStore(write.store);
        if (write.delete) target.delete(write.key); else target.put(write.value, write.key);
      }
      await done;
    },
    async close() { database.close(); },
  };
}
