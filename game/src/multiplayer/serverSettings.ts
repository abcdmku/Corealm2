import { MAX_WORLD_PLAYERS } from "../contracts.js";

/**
 * Settings an admin changes while the server runs. The configuration file, with its flags and
 * environment variables, gives the defaults. A value stored in the database overrides its default,
 * and clearing it with null gives the default back. Nothing here needs a restart.
 */
export interface ServerSettings {
  /** What the public directory lists this server as. */
  name: string;
  /** Shown beside the server in the picker, through `/worlds`. */
  description: string | null;
  /** Register with the identity service's public directory, and keep the entry alive. */
  registerWithDirectory: boolean;
  /** Player capacity by world id. */
  capacity: Record<string, number>;
}
export const DEFAULT_SERVER_NAME = "Corealm server";
/** The identity service's own rule for a directory name, so a name that saves here also registers there. */
export const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{2,47}$/;
export const MAX_DESCRIPTION_CHARS = 200;
const CAPACITY_KEY = "capacity.";

export class SettingsFailure extends Error {
  constructor(readonly status: 400 | 409, message: string) { super(message); this.name = "SettingsFailure"; }
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * `PATCH /admin/settings` as stored keys: `name`, `description`, `registerWithDirectory` and
 * `capacity.<worldId>`. Null clears an override. Validated whole before anything is stored.
 */
export function settingsPatch(body: Record<string, unknown>, worldIds: readonly string[], canRegister: boolean): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "name") {
      if (value !== null && (typeof value !== "string" || !SERVER_NAME.test(value))) throw new SettingsFailure(400, "name must be 3 to 48 letters, digits, spaces or _ . ' - and start with a letter or digit");
      changes.name = value;
    } else if (key === "description") {
      if (value !== null && (typeof value !== "string" || !value.trim() || value.trim().length > MAX_DESCRIPTION_CHARS)) throw new SettingsFailure(400, `description must be 1 to ${MAX_DESCRIPTION_CHARS} characters, or null`);
      changes.description = typeof value === "string" ? value.trim() : null;
    } else if (key === "registerWithDirectory") {
      if (value !== null && typeof value !== "boolean") throw new SettingsFailure(400, "registerWithDirectory must be true, false or null");
      if (value === true && !canRegister) throw new SettingsFailure(409, "This server has no identity service to register with");
      changes.registerWithDirectory = value;
    } else if (key === "worlds") {
      if (!isRecord(value)) throw new SettingsFailure(400, "worlds must be an object keyed by world id");
      for (const [worldId, entry] of Object.entries(value)) {
        if (!worldIds.includes(worldId)) throw new SettingsFailure(400, `This server hosts no world ${JSON.stringify(worldId.slice(0, 128))}`);
        if (!isRecord(entry) || Object.keys(entry).some(field => field !== "capacity")) throw new SettingsFailure(400, `worlds.${worldId} must be {capacity}`);
        const capacity = entry.capacity;
        if (capacity !== null && (!Number.isSafeInteger(capacity) || (capacity as number) < 1 || (capacity as number) > MAX_WORLD_PLAYERS)) throw new SettingsFailure(400, `worlds.${worldId}.capacity must be 1 through ${MAX_WORLD_PLAYERS}, or null`);
        changes[CAPACITY_KEY + worldId] = capacity;
      }
    } else throw new SettingsFailure(400, `Unknown setting ${JSON.stringify(key.slice(0, 64))}`);
  }
  if (!Object.keys(changes).length) throw new SettingsFailure(400, "A settings patch names at least one of name, description, registerWithDirectory and worlds");
  return changes;
}

/** Defaults with the stored overrides laid over them. A stored value that no longer validates is ignored, not fatal. */
export function effectiveSettings(defaults: ServerSettings, overrides: Readonly<Record<string, unknown>>): ServerSettings {
  const settings: ServerSettings = { ...defaults, capacity: { ...defaults.capacity } };
  if (typeof overrides.name === "string" && SERVER_NAME.test(overrides.name)) settings.name = overrides.name;
  if (typeof overrides.description === "string" && overrides.description.length <= MAX_DESCRIPTION_CHARS) settings.description = overrides.description;
  if (typeof overrides.registerWithDirectory === "boolean") settings.registerWithDirectory = overrides.registerWithDirectory;
  for (const worldId of Object.keys(defaults.capacity)) {
    const capacity = overrides[CAPACITY_KEY + worldId];
    if (Number.isSafeInteger(capacity) && (capacity as number) >= 1 && (capacity as number) <= MAX_WORLD_PLAYERS) settings.capacity[worldId] = capacity as number;
  }
  return settings;
}

/** Re-register well inside the ten minutes after which the directory drops a silent server. */
export const DIRECTORY_HEARTBEAT_MS = 4 * 60 * 1000;
export interface DirectoryOptions {
  identityUrl: string;
  /** The public endpoint players join, which is also what the directory lists. */
  endpoint(): string;
  settings(): ServerSettings;
  fetch?: typeof fetch;
  intervalMs?: number;
  log(event: Record<string, unknown>): void;
}

/**
 * Keeps this server in the identity service's public directory while `registerWithDirectory` is on.
 * The directory is a convenience: a refusal or an unreachable service is logged and play goes on.
 */
export function createDirectoryHeartbeat(options: DirectoryOptions) {
  const send = options.fetch ?? fetch;
  let timer: ReturnType<typeof setInterval> | null = null, lastOutcome = "";
  async function beat(): Promise<boolean> {
    const { name, description } = options.settings(), endpoint = options.endpoint();
    let outcome: string, detail: Record<string, unknown> = {};
    try {
      const response = await send(new URL("servers/register", options.identityUrl), { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, endpoint, ...(description ? { description } : {}) }) });
      outcome = response.ok ? "registered" : "refused";
      if (!response.ok) detail = { status: response.status, reason: await response.json().then(body => String((body as { error?: { code?: unknown } })?.error?.code ?? ""), () => "") };
    } catch (error) { outcome = "unreachable"; detail = { message: error instanceof Error ? error.message : String(error) }; }
    // Every four minutes forever: only a change of fortune is worth a line.
    if (outcome !== lastOutcome) options.log({ event: `directory.${outcome}`, endpoint, name, ...detail });
    lastOutcome = outcome;
    return outcome === "registered";
  }
  return {
    /** Start or stop to match the setting. Turning it on registers at once. */
    sync(): void {
      const wanted = options.settings().registerWithDirectory;
      if (wanted && !timer) { timer = setInterval(() => void beat(), options.intervalMs ?? DIRECTORY_HEARTBEAT_MS); timer.unref(); void beat(); }
      else if (wanted) void beat();
      else if (timer) { clearInterval(timer); timer = null; lastOutcome = ""; options.log({ event: "directory.stopped" }); }
    },
    beat,
    close(): void { if (timer) clearInterval(timer); timer = null; },
  };
}
