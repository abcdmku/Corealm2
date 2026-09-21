import { performance } from "node:perf_hooks";
import type { MessagePort } from "node:worker_threads";
import type { WorldStorage } from "../../contracts.js";
import type { ServerAdminStorage } from "../adminStorage.js";
import type { CatalogStorage } from "../catalogStorage.js";
import { createRpc, type Endpoint } from "./rpc.js";
import { serveStorage, storageShape, type DatabaseStats, type StorageShape } from "./storageProxy.js";

/**
 * The database thread: the one owner of the SQLite connection. It opens the file, which SQLite locks
 * exclusively, and answers storage calls from the main thread and from each world thread, every one
 * on its own port. `node:sqlite` is synchronous, so a call runs to completion before the next message
 * is read: calls from all threads are serialised here, and a commit is one transaction.
 *
 * This module reads no content table, so it needs no catalog installed.
 */
export type DatabaseSpec = { kind: "sqlite"; path: string } | { kind: "memory" };
export interface DatabaseThreadData { role: "database"; database: DatabaseSpec }
/** What the main thread learns when the database is open. */
export interface DatabaseReady { shape: StorageShape }
export interface DatabaseThreadStats { calls: number; commits: number; commitMs: number[]; commitWaitMs: number[]; busyMs: number; utilization: number }

type OpenStorage = WorldStorage & { admin: ServerAdminStorage; catalog: CatalogStorage };
async function open(spec: DatabaseSpec, log: (line: string) => void): Promise<OpenStorage> {
  if (spec.kind === "memory") return new (await import("../memoryStorage.js")).MemoryWorldStorage();
  return new (await import("../sqliteStorage.js")).SqliteWorldStorage(spec.path, { log });
}

export async function runDatabaseThread(data: DatabaseThreadData, parent: MessagePort): Promise<void> {
  const storage = await open(data.database, line => parent.postMessage({ k: "n", m: "log", a: [line] }));
  const stats: DatabaseStats = { calls: 0, commits: 0, commitMs: [], commitWaitMs: [], busyMs: 0 };
  const handlers = serveStorage({ world: storage, admin: storage.admin, catalog: storage.catalog }, stats);
  let utilization = performance.eventLoopUtilization();
  createRpc(parent as Endpoint, {
    ...handlers,
    /** A world thread's own line to the database. The port arrives in the message's transfer list. */
    attach(port: MessagePort) { createRpc(port as Endpoint, handlers); port.on("close", () => port.removeAllListeners()); },
    /** Samples since the last ask, then cleared, so each report covers its own interval. */
    stats(): DatabaseThreadStats {
      const next = performance.eventLoopUtilization(), delta = performance.eventLoopUtilization(next, utilization); utilization = next;
      const report = { ...stats, commitMs: stats.commitMs.splice(0), commitWaitMs: stats.commitWaitMs.splice(0), utilization: delta.utilization };
      return report;
    },
    async close() { await storage.close(); },
  });
  parent.postMessage({ k: "n", m: "ready", a: [{ shape: storageShape(storage) } satisfies DatabaseReady] });
}
