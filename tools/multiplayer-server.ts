import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WORLD_CONTENT_VERSION, WORLD_LAB_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { createAuthoredWorld } from "../game/src/multiplayer/authoredWorld.js";
import { startReferenceServer, type AuthenticationAdapter } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { SessionFailure } from "../game/src/multiplayer/protocol.js";
import { hostConfiguration } from "../game/src/multiplayer/hostConfiguration.js";

const config = hostConfiguration(process.argv.slice(2));
let authentication: AuthenticationAdapter;
if (config.developmentGuests) {
  authentication = { async authenticate(token) {
    if (!/^guest:[A-Za-z0-9_.-]{1,40}$/.test(token)) throw new SessionFailure("UNAUTHORIZED", "A valid development guest name is required");
    return { playerId: token.slice(6), name: token.slice(6) };
  } };
} else {
  const module = await import(pathToFileURL(resolve(config.authModule!)).href);
  authentication = module.default ?? module;
  if (typeof authentication.authenticate !== "function") throw new Error("Authentication module must export authenticate(token, world)");
}
const directory = resolve(config.data);
await mkdir(directory, { recursive: true });
const worlds: WorldDescriptor[] = config.worlds.map(world => ({
  providerId: "reference", worldId: world.id, name: world.name,
  endpoint: config.publicEndpoint, protocolVersion: WORLD_PROTOCOL_VERSION,
  contentVersion: config.authored ? WORLD_CONTENT_VERSION : WORLD_LAB_CONTENT_VERSION,
  seed: world.seed, capacity: world.capacity, population: 0, availability: "available",
  ...(config.assetBaseUrl ? { assetBaseUrl: config.assetBaseUrl } : {}),
}));
const storage = new SqliteWorldStorage(resolve(directory, "worlds.sqlite"));
const server = await startReferenceServer({ worlds, port: config.port, host: config.host, storage,
  allowedOrigins: config.allowedOrigins.length ? config.allowedOrigins : undefined,
  build: world => config.authored ? createAuthoredWorld(world.seed) : createMultiplayerLabWorld(world.seed), authentication,
}).catch(async error => { await storage.close(); throw error; });
console.log(JSON.stringify({ ready: true, host: config.host, port: server.port,
  fixture: config.authored ? "authored-world" : "production-lab", developmentGuests: config.developmentGuests,
  configFile: config.configFile, assetBaseUrl: config.assetBaseUrl ?? null, identityUrl: config.identityUrl ?? null,
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
