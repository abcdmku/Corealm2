import type { Worker } from "node:worker_threads";
import type { WorldStorage } from "../../contracts.js";
import type { DatabaseReady, DatabaseSpec, DatabaseThreadStats } from "./databaseThread.js";
import type { ThreadLauncher } from "./launch.js";
import { createRpc, type Endpoint, type Rpc } from "./rpc.js";
import { remoteStorage, type StorageSet } from "./storageProxy.js";

/**
 * Starting the database thread and holding its storage. This module reads no content table, because
 * a server opens its database first: the catalog it installs comes out of it.
 */
/** The database thread as the main thread holds it. `storage.world.close()` closes the database and ends the thread. */
export interface DatabaseThread { storage: StorageSet; worker: Worker; rpc: Rpc; stats(): Promise<DatabaseThreadStats>; onExit(listener: (reason: string) => void): void }

export function threadReady<T>(worker: Worker, rpc: { handlers: Record<string, (...args: never[]) => unknown> }, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    rpc.handlers.ready = ((value: T) => resolve(value)) as never;
    worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`${what} stopped before it was ready (exit ${code})`)));
  });
}

export async function startDatabaseThread(launch: ThreadLauncher, database: DatabaseSpec, log: (line: string) => void = () => {}): Promise<DatabaseThread> {
  const worker = launch({ role: "database", database }, [], "corealm-database");
  const handlers: Record<string, (...args: never[]) => unknown> = { log: ((line: string) => log(line)) as never };
  const rpc = createRpc(worker as unknown as Endpoint, handlers);
  const exits: ((reason: string) => void)[] = []; let ended = false;
  const opened = threadReady<DatabaseReady>(worker, { handlers }, "The database thread");
  const gone = (reason: string): void => { if (ended) return; ended = true; rpc.fail(reason); for (const listener of exits) listener(reason); };
  worker.on("error", error => gone(`The database thread failed: ${error instanceof Error ? error.message : String(error)}`));
  worker.on("exit", code => gone(`The database thread stopped (exit ${code})`));
  const { shape } = await opened;
  const storage = remoteStorage(rpc, shape);
  let closing: Promise<void> | null = null;
  const world: WorldStorage = { ...storage.world, close: () => closing ??= (async () => { if (ended) return; ended = true; try { await rpc.call("close"); } finally { rpc.fail("The database is closed"); await worker.terminate(); } })() };
  return { storage: { ...storage, world }, worker, rpc, stats: () => rpc.call<DatabaseThreadStats>("stats"), onExit: listener => { exits.push(listener); } };
}
