import { readFileSync } from "node:fs";
import { endpoint } from "./protocol.js";
import { MAX_DESCRIPTION_CHARS, SERVER_NAME } from "./serverSettings.js";

/** One world on this server. Worlds differ by id, name, seed and capacity; everything else is shared. */
export interface HostWorld { id: string; name: string; seed: number; capacity: number }

export interface HostConfiguration {
  authored: boolean; host: string; port: number;
  /**
   * How players prove who they are. Exactly one source is configured: `identityUrl` gives "account",
   * `guests` or `developmentGuests` gives "guest", `authModule` gives "module".
   */
  authentication: "account" | "guest" | "module";
  /** Guests on a loopback listener only. The launcher's switch: it can never open a public guest server by accident. */
  developmentGuests: boolean;
  /** Guests on any listener, for a LAN or offline server. Anyone who can reach it picks any name, so the owner asks for it by name. */
  guests: boolean;
  data: string; publicEndpoint: string; allowedOrigins: string[];
  /** Static host the client loads models, textures, audio and generated world data from. */
  assetBaseUrl?: string;
  /** Identity service whose published keys verify join tokens. Setting it selects account authentication. */
  identityUrl?: string;
  /** Account id made owner at start, instead of the one-time setup code. Setting it stops a code being printed. */
  ownerAccount?: string;
  authModule?: string;
  /**
   * Defaults for settings an admin may change while the server runs: what the public directory lists
   * this server as, what the picker says about it, and whether it registers with that directory.
   * A value an admin stored in the database overrides the one here.
   */
  name?: string;
  description?: string;
  registerWithDirectory: boolean;
  /** Directory holding the devdocs server-mode build, served at `/admin/`. */
  adminUiDir: string;
  /**
   * `--follow-repo-catalog`, a flag only. At start the catalog the server ships with replaces the
   * database's active one when they differ. The local launchers set it so repo content edits reach
   * the local server. A live server leaves it off: its database is the source of truth.
   */
  followRepoCatalog: boolean;
  worlds: HostWorld[];
  /** The file the settings below came from, or null when there was none. */
  configFile: string | null;
}

/** Reads a configuration file, or returns undefined when it does not exist. Injected for tests. */
export type ConfigReader = (path: string) => string | undefined;

const DEFAULT_CONFIG_FILE = "corealm-server.json";
const DEFAULT_SEED = 1337;
const DEFAULT_CAPACITY = 64;
const WORLD_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FILE_KEYS = ["host", "port", "publicEndpoint", "allowedOrigins", "data", "assetBaseUrl", "identityUrl", "ownerAccount",
  "authored", "developmentGuests", "guests", "authModule", "worlds", "name", "description", "registerWithDirectory", "adminUiDir"];
/** The same account id shape the identity service mints and the join token carries. */
const OWNER_ACCOUNT = /^acc_[A-Za-z0-9_-]{22,120}$/;
const WORLD_KEYS = ["id", "name", "seed", "capacity"];

function readConfigFile(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Authored worlds keep the display name the standalone host has always shown. */
const worldName = (id: string): string => id === "corealm" ? "Corealm" : id;

/**
 * Validate deployment choices before opening storage or preparing expensive world geometry.
 *
 * Settings come from `corealm-server.json`, environment variables and flags, in that order of
 * increasing precedence. `readFile` exists so the configuration file is testable without a disk.
 */
export function hostConfiguration(args: readonly string[], env: NodeJS.ProcessEnv = process.env,
  readFile: ConfigReader = readConfigFile): HostConfiguration {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index >= 0 && (!args[index + 1] || args[index + 1]!.startsWith("--"))) throw new Error(`${name} requires a value`);
    return index >= 0 ? args[index + 1]! : undefined;
  };
  const configPath = flag("--config") ?? env.COREALM_CONFIG;
  const path = configPath ?? DEFAULT_CONFIG_FILE;
  const text = readFile(path);
  if (text === undefined && configPath) throw new Error(`Configuration file not found: ${path}`);
  let file: Record<string, unknown> = {};
  if (text !== undefined) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error(`${path} is not valid JSON`); }
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
    for (const key of Object.keys(parsed)) if (!FILE_KEYS.includes(key)) throw new Error(`${path}: unknown setting "${key}"`);
    file = parsed;
  }
  const fileText = (key: string): string | undefined => {
    const value = file[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) throw new Error(`${path}: ${key} must be a nonempty string`);
    return value;
  };
  const fileFlag = (key: string): boolean => {
    const value = file[key];
    if (value === undefined) return false;
    if (typeof value !== "boolean") throw new Error(`${path}: ${key} must be true or false`);
    return value;
  };
  const value = (name: string, variable: string, key: string, fallback?: string): string | undefined =>
    flag(name) ?? env[variable] ?? fileText(key) ?? fallback;

  const authored = args.includes("--authored") || fileFlag("authored");
  const developmentGuests = args.includes("--development-guests") || fileFlag("developmentGuests");
  const guests = args.includes("--guests") || fileFlag("guests");
  const host = value("--host", "COREALM_HOST", "host", "127.0.0.1")!;
  const filePort = file.port;
  if (filePort !== undefined && !Number.isSafeInteger(filePort)) throw new Error(`${path}: port must be an integer`);
  const port = Number(flag("--port") ?? env.COREALM_PORT ?? (filePort === undefined ? "4180" : String(filePort)));
  const data = value("--data", "COREALM_DATA", "data", "local-worlds")!;
  const authModule = value("--auth-module", "COREALM_AUTH_MODULE", "authModule");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port must be 0 through 65535");
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (port === 0 && !loopback) throw new Error("Ephemeral ports require a loopback listener");
  if (developmentGuests && !loopback) throw new Error("Development guests require a loopback listener");
  const configuredEndpoint = value("--public-endpoint", "COREALM_PUBLIC_ENDPOINT", "publicEndpoint");
  if (!loopback && !configuredEndpoint) throw new Error("A remote listener requires a public WSS endpoint");
  const publicEndpoint = endpoint(configuredEndpoint ?? `ws://127.0.0.1:${port}/`);
  if (!loopback && new URL(publicEndpoint).protocol !== "wss:") throw new Error("Remote hosting requires WSS");
  const fileOrigins = file.allowedOrigins;
  if (fileOrigins !== undefined && (!Array.isArray(fileOrigins) || fileOrigins.some(entry => typeof entry !== "string")))
    throw new Error(`${path}: allowedOrigins must be an array of origin strings`);
  const allowedOrigins = (flag("--origins") ?? env.COREALM_ALLOWED_ORIGINS)?.split(",").map(s => s.trim()).filter(Boolean)
    ?? (fileOrigins as string[] | undefined)?.map(entry => entry.trim()).filter(Boolean) ?? [];
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:")))
      throw new Error("Allowed origins must be exact HTTPS origins or local HTTP origins");
  }
  if (new URL(publicEndpoint).protocol === "wss:" && !allowedOrigins.length) throw new Error("Public hosting requires explicit allowed origins");
  const assetBaseUrl = httpBase(value("--asset-base-url", "COREALM_ASSET_BASE_URL", "assetBaseUrl"), "assetBaseUrl");
  const identityUrl = httpBase(value("--identity-url", "COREALM_IDENTITY_URL", "identityUrl"), "identityUrl");
  const ownerAccount = value("--owner-account", "COREALM_OWNER_ACCOUNT", "ownerAccount");
  if (ownerAccount !== undefined && !OWNER_ACCOUNT.test(ownerAccount)) throw new Error("ownerAccount must be an identity account id, acc_ followed by 22 to 120 URL-safe characters");
  const sources = [identityUrl !== undefined, guests || developmentGuests, authModule !== undefined].filter(Boolean).length;
  if (sources !== 1) throw new Error("Choose exactly one way to authenticate players: an identity service URL, guests, or an authentication module");
  const authentication = identityUrl !== undefined ? "account" : authModule !== undefined ? "module" : "guest";
  const name = value("--name", "COREALM_SERVER_NAME", "name");
  if (name !== undefined && !SERVER_NAME.test(name)) throw new Error("name must be 3 to 48 letters, digits, spaces or _ . ' - and start with a letter or digit");
  const description = value("--description", "COREALM_SERVER_DESCRIPTION", "description")?.trim();
  if (description !== undefined && (!description || description.length > MAX_DESCRIPTION_CHARS)) throw new Error(`description must be 1 to ${MAX_DESCRIPTION_CHARS} characters`);
  const registerWithDirectory = args.includes("--register-with-directory") || fileFlag("registerWithDirectory");
  if (registerWithDirectory && identityUrl === undefined) throw new Error("registerWithDirectory needs an identity service URL: the directory is the identity service's");
  const adminUiDir = value("--admin-ui-dir", "COREALM_ADMIN_UI_DIR", "adminUiDir", "dist/devdocs-server")!;

  const capacityText = flag("--capacity") ?? env.COREALM_CAPACITY;
  const capacityOverride = capacityText === undefined ? undefined : Number(capacityText);
  if (capacityOverride !== undefined && (!Number.isInteger(capacityOverride) || capacityOverride < 1 || capacityOverride > 1000))
    throw new Error("Capacity must be 1 through 1000");
  const shorthand = (list: string): HostWorld[] => list.split(",").map(entry => entry.trim())
    .map(id => ({ id, name: worldName(id), seed: DEFAULT_SEED, capacity: capacityOverride ?? DEFAULT_CAPACITY }));
  const listed = flag("--worlds") ?? env.COREALM_WORLDS;
  const worlds = (listed !== undefined ? shorthand(listed)
    : parseWorlds(file.worlds, path, capacityOverride) ?? shorthand(authored ? "corealm" : "yard"))
    .map(world => capacityOverride === undefined ? world : { ...world, capacity: capacityOverride });
  if (!worlds.length || new Set(worlds.map(world => world.id)).size !== worlds.length
    || worlds.some(world => !WORLD_ID.test(world.id))) throw new Error("World IDs must be unique nonempty identifiers");
  return { authored, authentication, developmentGuests, guests, host, port, data, publicEndpoint, allowedOrigins,
    assetBaseUrl, identityUrl, ownerAccount, authModule, name, description, registerWithDirectory, adminUiDir, followRepoCatalog: args.includes("--follow-repo-catalog"), worlds, configFile: text === undefined ? null : path };
}

/** The same rule the browser applies to a descriptor: HTTPS, or plain HTTP only on loopback. */
function httpBase(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  let resolved: string;
  try { resolved = endpoint(value, true); }
  catch { throw new Error(`${label} must be an HTTPS URL, or an http URL on loopback, with no credentials or query`); }
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

function parseWorlds(value: unknown, path: string, capacityOverride: number | undefined): HostWorld[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) throw new Error(`${path}: worlds must be a nonempty array`);
  return value.map(entry => {
    if (!isRecord(entry)) throw new Error(`${path}: every world must be a JSON object`);
    for (const key of Object.keys(entry)) if (!WORLD_KEYS.includes(key)) throw new Error(`${path}: unknown world setting "${key}"`);
    const { id, name, seed, capacity } = entry as { id: unknown; name?: unknown; seed?: unknown; capacity?: unknown };
    if (typeof id !== "string" || !WORLD_ID.test(id)) throw new Error(`${path}: every world needs an id of letters, digits, _ . : or -`);
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 256))
      throw new Error(`${path}: world ${id} name must be text of 1 to 256 characters`);
    if (seed !== undefined && !Number.isSafeInteger(seed)) throw new Error(`${path}: world ${id} seed must be an integer`);
    if (capacity !== undefined && (!Number.isSafeInteger(capacity) || (capacity as number) < 1 || (capacity as number) > 1000))
      throw new Error(`${path}: world ${id} capacity must be 1 through 1000`);
    return { id, name: (name as string | undefined) ?? worldName(id), seed: (seed as number | undefined) ?? DEFAULT_SEED,
      capacity: (capacity as number | undefined) ?? capacityOverride ?? DEFAULT_CAPACITY };
  });
}
