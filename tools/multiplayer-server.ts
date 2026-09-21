import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import type { AuthenticationAdapter, ReferenceServerMetrics, ServerEvent, WorldStatus } from "../game/src/multiplayer/referenceServer.js";
import type { HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import type { WorldStorage } from "../game/src/contracts.js";
import type { ServerAdminStorage } from "../game/src/multiplayer/adminStorage.js";
import type { CatalogStorage } from "../game/src/multiplayer/catalogStorage.js";
import { startDatabaseThread, type DatabaseThread } from "../game/src/multiplayer/threads/databaseClient.js";
import { moduleLauncher, seaLauncher } from "../game/src/multiplayer/threads/launch.js";
import { quietSqliteWarning, runThread, threadRole } from "../game/src/multiplayer/threads/threadRoles.js";
// Type only: `worldPack.ts` reads content tables through the world assembly, so it must not be
// evaluated before `installCatalog`. Its two functions are reached through `await import()` below.
import type { ServerWorldPack } from "../game/src/multiplayer/worldPack.js";
import { installCatalog } from "../game/src/content/catalogInstall.js";
import { activeServerCatalog, seedCatalog, type BaseCatalog } from "../game/src/multiplayer/catalogHost.js";
import { guestAuthentication } from "../game/src/multiplayer/guestAuthentication.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { hostConfiguration } from "../game/src/multiplayer/hostConfiguration.js";
import { directoryAdminUi } from "../game/src/multiplayer/adminUi.js";
import {
  ADMIN_UI_ASSET, ASSET_MANIFEST_ASSET, SEED_CATALOG_ASSET, SERVER_WORLD_PACK_FILE, archiveAdminUi, buildInfo, embedded, repoPathOf, serverBaseDir,
} from "../game/src/multiplayer/embedded.js";
import { createServerLogger, fileWriter, streamWriter, type ServerLogger } from "../game/src/multiplayer/serverLog.js";
import { startServerConsole, type ConsoleStats } from "../game/src/multiplayer/serverConsole.js";

/**
 * The Corealm game server: one process, one database, one or more worlds.
 *
 * It is the same program in a checkout and as a single executable. What differs is where its files
 * come from — `game/src/multiplayer/embedded.ts` answers that — and where it looks for
 * `corealm-server.json`: beside the executable when packaged, in the working directory otherwise.
 *
 * Install before import. The simulation reads content tables as its modules load, so the database's
 * catalog goes in first and the server graph is imported only after it. That ordering has to survive
 * bundling as well: every import below is either a type or a module that reads no content table, and
 * the heavy half is reached through `await import()`, which esbuild keeps lazy.
 *
 * With more than one world, or `threads: "on"`, each world runs in a thread of its own and one more
 * thread owns the database. Those threads run this same program: started as a worker it runs the
 * role it was given instead of a server, which is what lets the single executable start them from
 * the one bundle it carries. Install before import then holds in every world thread separately.
 */

const USAGE = `corealm-server - the Corealm game server

Usage:
  corealm-server [options]

Options:
  --config <path>          Configuration file. Defaults to corealm-server.json beside the server.
  --write-sample-config    Write a documented corealm-server.json and exit.
  --tui                    Draw the live console. Log lines go to server.log in the data directory.
  --host, --port, --data, --public-endpoint, --origins, --asset-base-url, --identity-url,
  --owner-account, --auth-module, --name, --description, --admin-ui-dir, --worlds, --capacity,
  --authored, --guests, --development-guests, --register-with-directory, --threads
                           Override one setting from the configuration file.
  --version                Print the build and exit.
  --help                   Print this and exit.

Every setting, and the environment variable for each, is in docs/multiplayer-hosting.md.
`;

/** The smallest file that starts a server, shown to an operator who has none. */
const MINIMAL_CONFIG = {
  host: "127.0.0.1", port: 4180, data: "./data", guests: true, authored: true,
  worlds: [{ id: "corealm", name: "Corealm", seed: 1337, capacity: 64 }],
};
/** What `--write-sample-config` writes: a public server, with every setting an operator has to choose. */
const SAMPLE_CONFIG = {
  host: "0.0.0.0", port: 4180,
  publicEndpoint: "wss://worlds.example.com/",
  allowedOrigins: ["https://play.example.com"],
  data: "./data",
  assetBaseUrl: "https://assets.example.com/corealm/",
  identityUrl: "https://identity.example.com/",
  name: "Corealm server",
  description: "A public Corealm world",
  authored: true,
  worlds: [{ id: "corealm", name: "Corealm", seed: 1337, capacity: 200 }],
};
const SAMPLE_NOTES = `Settings, in the order above:
  host             Address to listen on. 0.0.0.0 for a public server, 127.0.0.1 for a private one.
  port             TCP port to listen on.
  publicEndpoint   The wss:// address players reach this server at. Join tokens are minted for it,
                   so it must be exactly what the reverse proxy publishes.
  allowedOrigins   Exact origins allowed to call /admin. The page the client is served from.
  data             Directory for worlds.sqlite, server.log and backups. Relative to this file.
  assetBaseUrl     Static host the client loads models, textures and terrain from.
  identityUrl      Identity service whose keys verify join tokens. Setting it selects accounts.
                   Replace it with "guests": true for a LAN or offline server.
  name             What the public directory lists this server as.
  description      One line about the server, shown in the world picker.
  authored         true for the full Corealm world, false for the compact lab fixture.
  worlds           One entry per world. Only id is required; name, seed and capacity have defaults.
                   With more than one, each world runs in its own thread: size the machine at one
                   core per world plus two. "threads": "off" keeps them all in one.

Full documentation: docs/multiplayer-hosting.md
`;

/** No configuration at all. A packaged server has nothing else to go on, so it says so and stops. */
const EX_CONFIG = 78;

function flagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * The authored world, always from the baked server world pack: geometry as plain data, no GLB
 * reader and no renderer. `game/src/multiplayer/bake/` builds the pack and is not on this path.
 *
 * A pack that is missing, of another format, or whose bytes do not match its hash stops the server
 * here rather than half way through building a world. A seed the pack does not hold is the pack's
 * own error, because only the pack knows which seeds were baked.
 */
async function loadWorldPack(bytes: Uint8Array, where: string): Promise<ServerWorldPack> {
  const { loadServerWorldPack } = await import("../game/src/multiplayer/worldPack.js");
  try { return loadServerWorldPack(bytes); }
  catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${where} is missing or stale. Bake it with: npm run world:build`);
  }
}
async function authoredWorld(pack: ServerWorldPack, seed: number): Promise<HeadlessWorldPorts> {
  const { createPackedWorld } = await import("../game/src/multiplayer/worldPack.js");
  return createPackedWorld(pack, seed);
}

/** The catalog this server ships with: an embedded asset when packaged, compiled from the checkout otherwise. */
async function shippedCatalog(): Promise<BaseCatalog> {
  const packed = embedded.json(SEED_CATALOG_ASSET);
  if (packed !== null) return packed as BaseCatalog;
  const { repoBaseCatalog } = await import("./lib/repoCatalog.js");
  return repoBaseCatalog();
}

/** What the console reads off the running server. The reference server's handle already is this. */
interface ConsoleSource {
  port: number;
  metrics: ReferenceServerMetrics;
  catalog: { revision: string };
  settings: { name: string };
  status(): WorldStatus[];
  events: readonly ServerEvent[];
}

export function consoleStats(server: ConsoleSource, logPath: string | null,
  config: { host: string; authentication: string; startedAt: number; now: number }): ConsoleStats {
  const metrics = server.metrics;
  const sorted = [...metrics.ticks].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const uptimeSeconds = Math.max(0, (config.now - config.startedAt) / 1000);
  const memory = process.memoryUsage();
  return {
    name: server.settings.name, host: config.host, port: server.port, authentication: config.authentication,
    catalogRevision: server.catalog.revision, uptimeSeconds,
    worlds: server.status().map(world => ({
      worldId: world.key.worldId, name: world.descriptor.name,
      playersOnline: world.population, capacity: world.capacity, tick: world.tick,
    })),
    tick: {
      lastMs: metrics.ticks.at(-1) ?? 0,
      meanMs: sorted.length ? total / sorted.length : 0,
      p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0,
    },
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
    bytesOut: metrics.bytesOut, bytesOutPerSecond: uptimeSeconds > 0 ? metrics.bytesOut / uptimeSeconds : 0,
    commands: metrics.commands, rejected: metrics.rejected, errors: metrics.errors,
    events: server.events, logPath,
  };
}

const started = Date.now();

async function main(argv: readonly string[]): Promise<number> {
  quietSqliteWarning();
  // Started as one of the server's own threads: run that role. It ends when the main thread ends it.
  if (threadRole() !== null) { await runThread(); return 0; }
  const build = buildInfo();
  if (argv.includes("--help") || argv.includes("-h")) { process.stdout.write(USAGE); return 0; }
  if (argv.includes("--version")) {
    process.stdout.write(`${build.name} ${build.version} (built ${build.builtAt}, node ${process.versions.node})\n`);
    return 0;
  }
  const base = serverBaseDir({ sea: embedded.sea, execPath: process.execPath, cwd: process.cwd() });
  const named = flagValue(argv, "--config") ?? process.env.COREALM_CONFIG;
  const configPath = resolve(base, named ?? "corealm-server.json");
  if (argv.includes("--write-sample-config")) {
    if (existsSync(configPath)) { process.stderr.write(`${configPath} already exists. Move it aside first.\n`); return 1; }
    await writeFile(configPath, `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote ${configPath}\n\n${SAMPLE_NOTES}`);
    return 0;
  }
  // A packaged server is configured by its file. A checkout is configured by the launcher's flags,
  // which is why only the executable insists on one.
  if (embedded.sea && !existsSync(configPath)) {
    process.stderr.write(`No configuration file at ${configPath}\n\n`
      + `Write a documented one beside the server with:\n  ${build.name} --write-sample-config\n\n`
      + `The smallest file that starts a server:\n${JSON.stringify(MINIMAL_CONFIG, null, 2)}\n\n`
      + "Every setting is in docs/multiplayer-hosting.md.\n");
    return EX_CONFIG;
  }

  const config = hostConfiguration(argv, process.env, path => {
    try { return readFileSync(resolve(base, path), "utf8"); } catch { return undefined; }
  });
  const directory = resolve(base, config.data);
  await mkdir(directory, { recursive: true });

  // stdout carries log lines until the console takes it, and the console hands them to a file.
  const wantsConsole = argv.includes("--tui");
  const logger: ServerLogger = createServerLogger();
  const logPath = wantsConsole && process.stdout.isTTY ? resolve(directory, "server.log") : null;
  if (wantsConsole && !process.stdout.isTTY) logger.warn("console.unavailable", { message: "--tui needs a terminal on stdout. Writing log lines instead." });

  const packBytes = config.authored ? embedded.asset(SERVER_WORLD_PACK_FILE) : null;
  if (config.authored && packBytes === null) {
    throw new Error(embedded.sea
      ? `This build carries no ${SERVER_WORLD_PACK_FILE}. Rebuild the server with: npm run server:build`
      : `No ${repoPathOf(SERVER_WORLD_PACK_FILE)}. Bake it with: npm run world:build`);
  }
  logger.info("start", { version: build.version, builtAt: build.builtAt, node: process.versions.node, packaged: embedded.sea,
    configFile: config.configFile === null ? null : resolve(base, config.configFile), data: directory,
    world: config.authored ? "pack" : "lab", threads: config.threads });

  let authentication: AuthenticationAdapter;
  if (config.authentication === "account") authentication = await createIdentityAuthentication({ identityUrl: config.identityUrl! });
  else if (config.authentication === "guest") authentication = guestAuthentication;
  else {
    const module = await import(pathToFileURL(resolve(base, config.authModule!)).href);
    authentication = module.default ?? module;
    if (typeof authentication.authenticate !== "function") throw new Error("Authentication module must export authenticate(token, world)");
  }
  const worlds: WorldDescriptor[] = config.worlds.map(world => ({
    providerId: "reference", worldId: world.id, name: world.name,
    endpoint: config.publicEndpoint, protocolVersion: WORLD_PROTOCOL_VERSION,
    fixture: config.authored ? "authored" : "lab",
    seed: world.seed, capacity: world.capacity, population: 0, availability: "available",
    ...(config.assetBaseUrl ? { assetBaseUrl: config.assetBaseUrl } : {}),
  }));
  // Storage still reports a migration as a finished JSON line, which the logger re-levels and redacts.
  const storageLog = (line: string): void => { try { logger.emit(JSON.parse(line) as Record<string, unknown>); } catch { logger.info("storage", { message: line }); } };
  // With threads, the database thread opens the file and this thread asks it. Without, this thread opens it. Either way `storage` is the same interfaces.
  // A packaged server starts its threads from the bundle it carries; a checkout starts them from the source file, like everything else in it.
  const launchThreads = embedded.sea ? seaLauncher() : moduleLauncher(pathToFileURL(resolve(process.cwd(), "game/src/multiplayer/threads/threadEntry.ts")));
  let database: DatabaseThread | null = null;
  let storage: WorldStorage & { admin: ServerAdminStorage; catalog: CatalogStorage };
  if (config.threads) {
    database = await startDatabaseThread(launchThreads, { kind: "sqlite", path: resolve(directory, "worlds.sqlite") }, storageLog);
    storage = Object.assign(database.storage.world, { admin: database.storage.admin, catalog: database.storage.catalog });
  } else {
    const { SqliteWorldStorage } = await import("../game/src/multiplayer/sqliteStorage.js");
    storage = new SqliteWorldStorage(resolve(directory, "worlds.sqlite"), { log: storageLog });
  }
  const revision = await (async () => {
    await seedCatalog(storage.catalog, await shippedCatalog(), event => logger.emit(event), { follow: config.followRepoCatalog });
    const catalog = await activeServerCatalog(storage.catalog);
    installCatalog(catalog);
    return catalog.revision;
  })().catch(async error => { await storage.close(); throw error; });

  const { startReferenceServer } = await import("../game/src/multiplayer/referenceServer.js");
  const { createMultiplayerLabWorld } = await import("../game/src/multiplayer/labWorld.js");
  // Read and check the pack once, before the first world is built, so a stale file is one clear error.
  const checkedPack = packBytes === null ? null
    : await loadWorldPack(packBytes, embedded.sea ? `The ${SERVER_WORLD_PACK_FILE} in this build` : repoPathOf(SERVER_WORLD_PACK_FILE)!);
  if (checkedPack) logger.info("world-pack", { revision: checkedPack.revision, seeds: checkedPack.seeds, bytes: packBytes!.length });
  // With threads the worlds are built elsewhere, each from its own reading of the pack, so this thread keeps none.
  const pack = database ? null : checkedPack;
  // Every world thread reads the pack through one block of shared memory, so ten megabytes are held once however many worlds there are.
  let sharedPack: Uint8Array | null = null;
  if (database && packBytes) { sharedPack = new Uint8Array(new SharedArrayBuffer(packBytes.byteLength)); sharedPack.set(packBytes); }
  const manifest = embedded.text(ASSET_MANIFEST_ASSET);
  const adminUiArchive = embedded.asset(ADMIN_UI_ASSET);
  const server = await startReferenceServer({
    worlds, port: config.port, host: config.host, storage, admin: storage.admin, catalog: storage.catalog, log: event => logger.emit(event),
    allowedOrigins: config.allowedOrigins.length ? config.allowedOrigins : undefined,
    // A publish checks asset ids against the host the clients load from, or against the manifest this server ships with.
    assets: { ...(config.assetBaseUrl ? { assetBaseUrl: config.assetBaseUrl } : {}),
      ...(manifest === null ? {} : { bundledManifest: async () => JSON.parse(manifest) }) },
    ...(config.ownerAccount ? { ownerAccount: config.ownerAccount } : {}),
    ...(config.identityUrl ? { identityUrl: config.identityUrl } : {}),
    settings: { ...(config.name ? { name: config.name } : {}), ...(config.description ? { description: config.description } : {}), registerWithDirectory: config.registerWithDirectory },
    adminUi: adminUiArchive ? archiveAdminUi(adminUiArchive) : directoryAdminUi(resolve(base, config.adminUiDir)),
    build: world => pack ? authoredWorld(pack, world.seed) : createMultiplayerLabWorld(world.seed), authentication,
    ...(database ? { threads: { launch: launchThreads, database, catalog: { kind: "storage" as const }, build: sharedPack ? { kind: "pack" as const, bytes: sharedPack } : { kind: "lab" as const } } } : {}),
  }).catch(async error => { await storage.close(); throw error; });

  // `ready: true` and `port` are what every launcher and proof script waits for.
  logger.emit({ event: "ready", ready: true, host: config.host, port: server.port,
    fixture: config.authored ? "authored-world" : "production-lab", authentication: config.authentication,
    catalogRevision: revision, configFile: config.configFile, assetBaseUrl: config.assetBaseUrl ?? null, identityUrl: config.identityUrl ?? null,
    worlds: config.worlds });

  const ui = logPath === null ? null : startServerConsole({
    stats: () => consoleStats(server, logPath, { host: config.host, authentication: config.authentication, startedAt: started, now: Date.now() }),
  });
  if (logPath !== null) {
    // The boot lines stay on the main screen, where an operator watched them; the file picks up here.
    logger.route(fileWriter(logPath));
    logger.info("console.started", { port: server.port, catalogRevision: revision, worlds: config.worlds.length });
  }

  let closing = false;
  const shutdown = (reason: string) => {
    if (closing) return;
    closing = true;
    ui?.stop();
    if (logPath !== null) logger.route(streamWriter(process.stdout));
    logger.info("shutdown", { reason });
    void server.close().then(() => process.exit(0)).catch(error => {
      logger.error("error", { where: "shutdown", message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
  };
  // SIGHUP is here for the console: a terminal that goes away must still leave the alternate screen.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => shutdown(signal));
  // Local launchers use IPC so Windows can close SQLite cleanly as well as the web listener.
  process.on("message", message => {
    if (message && typeof message === "object" && "type" in message && message.type === "shutdown") shutdown("ipc");
  });
  if (process.connected) process.once("disconnect", () => shutdown("disconnect"));
  return 0;
}

// No top-level await: this file is bundled to CommonJS for the single executable, which has none.
void main(process.argv.slice(2)).then(
  code => { if (code !== 0) process.exit(code); },
  (error: unknown) => {
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: "error", event: "start.failed",
      message: error instanceof Error ? error.message : String(error) })}\n`);
    process.exit(1);
  });
