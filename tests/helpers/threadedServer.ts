import { RESOLVED_CATALOG } from "../../game/src/content/resolvedCatalog.js";
import { seedCatalog } from "../../game/src/multiplayer/catalogHost.js";
import { startReferenceServer, type ReferenceServerOptions, type ThreadedHosting } from "../../game/src/multiplayer/referenceServer.js";
import { startDatabaseThread } from "../../game/src/multiplayer/threads/databaseClient.js";
import type { DatabaseSpec } from "../../game/src/multiplayer/threads/databaseThread.js";
import { moduleLauncher } from "../../game/src/multiplayer/threads/launch.js";
import type { WorldBuild } from "../../game/src/multiplayer/threads/worldThread.js";

/**
 * A reference server with a thread per world, for tests. The worlds run on the catalog compiled into
 * the repo, exactly as this process does: each world thread installs it by importing
 * `bundledCatalog.ts`, which is what `vitest.setup.ts` does here.
 */
const ENTRY = new URL("../../game/src/multiplayer/threads/threadEntry.ts", import.meta.url);
const BUNDLED_CATALOG = new URL("../../game/src/content/bundledCatalog.ts", import.meta.url).href;
export const fixtureWorld = (file: string, options?: unknown): WorldBuild => ({ kind: "module", specifier: new URL(`../fixtures/${file}`, import.meta.url).href, ...(options === undefined ? {} : { options }) });

export interface ThreadedServerOptions extends Omit<ReferenceServerOptions, "storage" | "admin" | "catalog" | "build" | "threads"> {
  database?: DatabaseSpec;
  build?: WorldBuild;
  /** Source collections for the seeded catalog. Without them nothing can be published. */
  sources?: Record<string, unknown>;
  /** The base version the seeded catalog records. */
  seedVersion?: string;
  /** Mount `/admin`. Needs account authentication. */
  admin?: boolean;
  threads?: Partial<Pick<ThreadedHosting, "mode" | "peerEncoding" | "holdTimeoutMs" | "restart" | "restartLimit" | "restartWindowMs" | "reportMs">>;
}
export async function startThreadedServer(options: ThreadedServerOptions) {
  const { database: spec = { kind: "memory" }, build = { kind: "lab" }, sources = {}, seedVersion = "0.1.0", admin = false, threads, ...rest } = options;
  const launch = moduleLauncher(ENTRY);
  const database = await startDatabaseThread(launch, spec);
  try {
    await seedCatalog(database.storage.catalog, { version: seedVersion, catalog: RESOLVED_CATALOG, sources }, () => {}, { now: options.now });
    const server = await startReferenceServer({ ...rest, storage: database.storage.world, catalog: database.storage.catalog, ...(admin ? { admin: database.storage.admin } : {}),
      build: () => Promise.reject(new Error("A threaded server builds its worlds in their threads")),
      threads: { launch, database, build, catalog: { kind: "module", specifier: BUNDLED_CATALOG }, reportMs: 100, ...threads } });
    return Object.assign(server, { database });
  } catch (error) { await database.storage.world.close(); throw error; }
}
