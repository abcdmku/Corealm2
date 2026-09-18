import { endpoint } from "./protocol.js";

export interface HostConfiguration {
  authored: boolean; developmentGuests: boolean; host: string; port: number;
  capacity: number; data: string; publicEndpoint: string; allowedOrigins: string[];
  authModule?: string; worldIds: string[];
}

/** Validate deployment choices before opening storage or preparing expensive world geometry. */
export function hostConfiguration(args: readonly string[], env: NodeJS.ProcessEnv = process.env): HostConfiguration {
  const value = (flag: string, variable: string, fallback?: string) => {
    const index = args.indexOf(flag);
    if (index >= 0 && (!args[index + 1] || args[index + 1]!.startsWith("--"))) throw new Error(`${flag} requires a value`);
    return index >= 0 ? args[index + 1]! : env[variable] ?? fallback;
  };
  const authored = args.includes("--authored");
  const developmentGuests = args.includes("--development-guests");
  const host = value("--host", "COREALM_HOST", "127.0.0.1")!;
  const port = Number(value("--port", "COREALM_PORT", "4180"));
  const capacity = Number(value("--capacity", "COREALM_CAPACITY", "64"));
  const data = value("--data", "COREALM_DATA", "local-worlds")!;
  const authModule = value("--auth-module", "COREALM_AUTH_MODULE");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be 0 through 65535");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new Error("Capacity must be 1 through 1000");
  if (developmentGuests === Boolean(authModule)) throw new Error("Choose an authentication module or explicit development guests");
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (port === 0 && !loopback) throw new Error("Ephemeral ports require a loopback listener");
  if (developmentGuests && !loopback) throw new Error("Development guests require a loopback listener");
  const configuredEndpoint = value("--public-endpoint", "COREALM_PUBLIC_ENDPOINT");
  if (!loopback && !configuredEndpoint) throw new Error("A remote listener requires a public WSS endpoint");
  const publicEndpoint = endpoint(configuredEndpoint ?? `ws://127.0.0.1:${port}/`);
  if (!loopback && new URL(publicEndpoint).protocol !== "wss:") throw new Error("Remote hosting requires WSS");
  const allowedOrigins = (value("--origins", "COREALM_ALLOWED_ORIGINS", "")!).split(",").map(s => s.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:")))
      throw new Error("Allowed origins must be exact HTTPS origins or local HTTP origins");
  }
  if (new URL(publicEndpoint).protocol === "wss:" && !allowedOrigins.length) throw new Error("Public hosting requires explicit allowed origins");
  const worldIds = value("--worlds", "COREALM_WORLDS", authored ? "corealm" : "yard")!.split(",").map(s => s.trim());
  if (!worldIds.length || new Set(worldIds).size !== worldIds.length || worldIds.some(id => !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)))
    throw new Error("World IDs must be unique nonempty identifiers");
  return { authored, developmentGuests, host, port, capacity, data, publicEndpoint, allowedOrigins, authModule, worldIds };
}
