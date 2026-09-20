import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { identityConfiguration } from "../identity/src/configuration.js";
import { startIdentityService } from "../identity/src/server.js";

const config = identityConfiguration(process.argv.slice(2));
const dataDir = resolve(config.dataDir);
await mkdir(dataDir, { recursive: true });
const service = await startIdentityService({
  host: config.host, port: config.port, dataDir, ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  allowedOrigins: config.allowedOrigins, providers: config.providers, allowPrivateServers: config.allowPrivateServers,
});
if (config.rotateKey) service.rotateSigningKey();
console.log(JSON.stringify({ ready: true, host: config.host, port: service.port, publicUrl: service.url,
  providers: config.providers.map(provider => provider.name), origins: config.allowedOrigins }));

let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void service.close().then(() => process.exit(0)).catch(() => process.exit(1));
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, shutdown);
// Local launchers use IPC so Windows can close SQLite cleanly as well as the web listener.
process.on("message", message => {
  if (message && typeof message === "object" && "type" in message && message.type === "shutdown") shutdown();
});
if (process.connected) process.once("disconnect", shutdown);
