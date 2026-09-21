import type { WorldStorage } from "../../contracts.js";
import type { ServerAdminStorage } from "../adminStorage.js";
import type { CatalogStorage } from "../catalogStorage.js";
import type { Handlers, Rpc } from "./rpc.js";

/**
 * The three storage interfaces over messages. The database thread owns the only connection and
 * answers with `serveStorage`; every other thread holds `remoteStorage`, which implements the same
 * interfaces by asking. Both sides are generic over the method lists below, which is possible
 * because M3 and M4 made every storage method asynchronous and every argument and result plain data.
 *
 * One call is one message and one answer, and the database thread runs each to completion before it
 * reads the next, so a commit is one transaction exactly as it is in process, and its fencing answer
 * goes back to the world that committed.
 */
const WORLD_METHODS = ["load", "openWorld", "claimPlayer", "releasePlayer", "commit", "editStoredPlayer"] as const satisfies readonly (keyof WorldStorage)[];
const ADMIN_METHODS = ["listRoles", "roleOf", "setRole", "revokeRole", "setSetupCodeHash", "claimSetupCode", "listBans", "banOf", "setBan", "removeBan",
  "createAdminSession", "adminSession", "revokeAdminSession", "revokeAdminSessionsFor", "listApiTokens", "createApiToken", "useApiToken", "revokeApiToken",
  "record", "audit", "settings", "setSettings", "listPlayers", "player", "itemHolders"] as const satisfies readonly (keyof ServerAdminStorage)[];
const CATALOG_METHODS = ["activeRevision", "catalog", "sources", "revisionInfo", "store", "activate", "history", "activeBase", "storeBase", "baseSources"] as const satisfies readonly (keyof CatalogStorage)[];

export interface StorageSet { world: WorldStorage; admin: ServerAdminStorage; catalog: CatalogStorage }
/** What a proxy has to know before its first call: which optional parts the real storage has. */
export interface StorageShape { entityPatches: boolean; editStoredPlayer: boolean }
export const storageShape = (storage: WorldStorage): StorageShape => ({ entityPatches: storage.entityPatches === true, editStoredPlayer: typeof storage.editStoredPlayer === "function" });

/** How long the database thread spent on commits, and how long they waited to reach it. Milliseconds. */
export interface DatabaseStats { calls: number; commits: number; commitMs: number[]; commitWaitMs: number[]; busyMs: number }
const SAMPLE_LIMIT = 4096;
const wallNow = (): number => performance.timeOrigin + performance.now();

/** Handlers for one port. `stats` is shared by every port of the database thread. */
export function serveStorage(storage: StorageSet, stats: DatabaseStats): Handlers {
  const handlers: Record<string, (...args: unknown[]) => unknown> = Object.create(null);
  const bind = (prefix: string, target: object, methods: readonly string[]): void => {
    for (const method of methods) {
      const run = (target as Record<string, unknown>)[method];
      if (typeof run !== "function") continue;
      handlers[`${prefix}.${method}`] = async (sentAt: unknown, ...args: unknown[]) => {
        const started = wallNow(); stats.calls++;
        try { return await (run as (...values: unknown[]) => unknown).apply(target, args); }
        finally {
          const ended = wallNow(); stats.busyMs += ended - started;
          if (prefix === "world" && method === "commit") {
            stats.commits++; stats.commitMs.push(ended - started); stats.commitWaitMs.push(Math.max(0, started - Number(sentAt)));
            if (stats.commitMs.length > SAMPLE_LIMIT) { stats.commitMs.shift(); stats.commitWaitMs.shift(); }
          }
        }
      };
    }
  };
  bind("world", storage.world, WORLD_METHODS); bind("admin", storage.admin, ADMIN_METHODS); bind("catalog", storage.catalog, CATALOG_METHODS);
  return handlers as Handlers;
}

function remote<T extends object>(rpc: Rpc, prefix: string, methods: readonly string[], extra: Partial<T> = {}): T {
  const proxy: Record<string, unknown> = { ...extra };
  for (const method of methods) proxy[method] = (...args: unknown[]) => rpc.call(`${prefix}.${method}`, [wallNow(), ...args]);
  return proxy as T;
}

/**
 * The storage interfaces as seen from a thread that does not own the database. `close` closes
 * nothing: the connection belongs to the database thread, and whoever started that thread ends it.
 */
export function remoteStorage(rpc: Rpc, shape: StorageShape): StorageSet {
  const world = remote<WorldStorage>(rpc, "world", WORLD_METHODS.filter(method => method !== "editStoredPlayer" || shape.editStoredPlayer),
    { ...(shape.entityPatches ? { entityPatches: true as const } : {}), close: async () => {} });
  return { world, admin: remote<ServerAdminStorage>(rpc, "admin", ADMIN_METHODS), catalog: remote<CatalogStorage>(rpc, "catalog", CATALOG_METHODS) };
}
