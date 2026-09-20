import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import type { AuthenticationAdapter } from "../game/src/multiplayer/referenceServer.js";
import { installCatalog } from "../game/src/content/catalogInstall.js";
import { activeServerCatalog, seedCatalog } from "../game/src/multiplayer/catalogHost.js";
import { repoBaseCatalog } from "./lib/repoCatalog.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { guestAuthentication } from "../game/src/multiplayer/guestAuthentication.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { hostConfiguration } from "../game/src/multiplayer/hostConfiguration.js";
import { directoryAdminUi } from "../game/src/multiplayer/adminUi.js";

const config = hostConfiguration(process.argv.slice(2));
let authentication: AuthenticationAdapter;
if (config.authentication === "account") authentication = await createIdentityAuthentication({ identityUrl: config.identityUrl! });
else if (config.authentication === "guest") authentication = guestAuthentication;
else {
  const module = await import(pathToFileURL(resolve(config.authModule!)).href);
  authentication = module.default ?? module;
  if (typeof authentication.authenticate !== "function") throw new Error("Authentication module must export authenticate(token, world)");
}
const directory = resolve(config.data);
await mkdir(directory, { recursive: true });
const worlds: WorldDescriptor[] = config.worlds.map(world => ({
  providerId: "reference", worldId: world.id, name: world.name,
  endpoint: config.publicEndpoint, protocolVersion: WORLD_PROTOCOL_VERSION,
  fixture: config.authored ? "authored" : "lab",
  seed: world.seed, capacity: world.capacity, population: 0, availability: "available",
  ...(config.assetBaseUrl ? { assetBaseUrl: config.assetBaseUrl } : {}),
}));
const storage = new SqliteWorldStorage(resolve(directory, "worlds.sqlite"));
// Install before import. The simulation reads content tables as its modules load, so the database's
// catalog goes in first and the server graph is imported only after it. Nothing above this line may
// import a module that reads content; `installCatalog` throws if one did.
const revision = await (async () => {
  await seedCatalog(storage.catalog, await repoBaseCatalog(), event => console.log(JSON.stringify(event)), { follow: config.followRepoCatalog });
  const catalog = await activeServerCatalog(storage.catalog);
  installCatalog(catalog);
  return catalog.revision;
})().catch(async error => { await storage.close(); throw error; });
const { startReferenceServer } = await import("../game/src/multiplayer/referenceServer.js");
const { createAuthoredWorld } = await import("../game/src/multiplayer/authoredWorld.js");
const { createMultiplayerLabWorld } = await import("../game/src/multiplayer/labWorld.js");
const server = await startReferenceServer({ worlds, port: config.port, host: config.host, storage, admin: storage.admin, catalog: storage.catalog,
  allowedOrigins: config.allowedOrigins.length ? config.allowedOrigins : undefined,
  // A publish checks asset ids against the host the clients load from, or against this checkout's manifest.
  assets: { ...(config.assetBaseUrl ? { assetBaseUrl: config.assetBaseUrl } : {}), bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
  ...(config.ownerAccount ? { ownerAccount: config.ownerAccount } : {}),
  ...(config.identityUrl ? { identityUrl: config.identityUrl } : {}),
  settings: { ...(config.name ? { name: config.name } : {}), ...(config.description ? { description: config.description } : {}), registerWithDirectory: config.registerWithDirectory },
  adminUi: directoryAdminUi(resolve(config.adminUiDir)),
  build: world => config.authored ? createAuthoredWorld(world.seed) : createMultiplayerLabWorld(world.seed), authentication,
}).catch(async error => { await storage.close(); throw error; });
console.log(JSON.stringify({ ready: true, host: config.host, port: server.port,
  fixture: config.authored ? "authored-world" : "production-lab", authentication: config.authentication,
  catalogRevision: revision, configFile: config.configFile, assetBaseUrl: config.assetBaseUrl ?? null, identityUrl: config.identityUrl ?? null,
  worlds: config.worlds }));
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void server.close().then(() => process.exit(0)).catch(() => process.exit(1));
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);
// Local launchers use IPC so Windows can close SQLite cleanly as well as the web listener.
process.on("message", message => {
  if (message && typeof message === "object" && "type" in message && message.type === "shutdown") shutdown();
});
if (process.connected) process.once("disconnect", shutdown);
