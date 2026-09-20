import {
  EQUIP_SLOTS, GAME_COMMAND_METHODS, MAX_WORLD_PLAYERS, WORLD_PROTOCOL_VERSION,
  type CommandEnvelope, type GameCommand, type SessionErrorCode, type WorldConfiguration,
  type WorldDescriptor, type WorldKey,
} from "../contracts.js";
import { CATALOG_REVISION } from "../content/clientCatalog.js";

export const MAX_MESSAGE_BYTES = 16_384;
export const MAX_DIRECTORY_WORLDS = 256;
export const MAX_PENDING_COMMANDS = 64;
export const RECONNECT_RESERVATION_MS = 30_000;
export const RECEIPT_LIMIT = 256;

export class SessionFailure extends Error {
  constructor(readonly code: SessionErrorCode, message: string) { super(message); this.name = "SessionFailure"; }
}
export function worldKey(key: WorldKey): string { return JSON.stringify([key.providerId, key.worldId]); }
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_:.-]{1,128}$/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 256;
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const quantity = (value: unknown): boolean => integer(value) && (value === -1 || value > 0 && value <= 1_000_000);
function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
export function endpoint(value: unknown, directory = false): string {
  if (typeof value !== "string" || value.length > 2048) throw new SessionFailure("INVALID_MESSAGE", "Invalid endpoint");
  let url: URL;
  try { url = new URL(value); } catch { throw new SessionFailure("INVALID_MESSAGE", "Invalid endpoint"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowed = directory ? ["https:", ...(local ? ["http:"] : [])] : ["wss:", ...(local ? ["ws:"] : [])];
  if (!allowed.includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new SessionFailure("INVALID_MESSAGE", "Endpoints require encrypted transport or loopback and cannot contain credentials or query parameters");
  }
  return url.href;
}
/** A static asset host: HTTPS, or plain HTTP on loopback, normalised to end with a slash. */
export function assetBase(value: unknown): string {
  const url = endpoint(value, true);
  return url.endsWith("/") ? url : `${url}/`;
}
export function descriptor(value: unknown): WorldDescriptor {
  if (!record(value) || !only(value, ["providerId", "worldId", "name", "endpoint", "protocolVersion", "fixture", "catalogRevision", "seed", "population", "capacity", "availability", "assetBaseUrl", "authentication"])
    || !id(value.providerId) || !id(value.worldId) || !text(value.name) || !value.name.trim()
    || !integer(value.protocolVersion) || (value.fixture !== "authored" && value.fixture !== "lab") || !integer(value.seed)
    || (value.catalogRevision !== undefined && (typeof value.catalogRevision !== "string" || !CATALOG_REVISION.test(value.catalogRevision)))
    || !integer(value.capacity) || value.capacity < 1 || value.capacity > MAX_WORLD_PLAYERS
    || !integer(value.population) || value.population < 0 || value.population > value.capacity
    || !["available", "full", "unavailable"].includes(String(value.availability))
    || (value.authentication !== undefined && value.authentication !== "account" && value.authentication !== "guest")) {
    throw new SessionFailure("INVALID_MESSAGE", "Invalid world descriptor");
  }
  return { ...value, endpoint: endpoint(value.endpoint),
    ...(value.assetBaseUrl === undefined ? {} : { assetBaseUrl: assetBase(value.assetBaseUrl) }) } as unknown as WorldDescriptor;
}
/** `{type:"content-updated", revision}`: what a server sends every connected peer after a publish or a rollback. */
export function contentUpdated(value: unknown): string {
  if (!record(value) || !only(value, ["type", "revision"]) || typeof value.revision !== "string" || !CATALOG_REVISION.test(value.revision)) {
    throw new SessionFailure("INVALID_MESSAGE", "Invalid content update");
  }
  return value.revision;
}
export function compatible(world: WorldDescriptor): void {
  if (world.protocolVersion !== WORLD_PROTOCOL_VERSION) {
    throw new SessionFailure("INCOMPATIBLE", "This world requires a different game or protocol version");
  }
}
export async function discoverWorlds(configuration?: WorldConfiguration, signal?: AbortSignal): Promise<WorldDescriptor[]> {
  if (configuration === undefined) return [];
  let values: unknown = configuration;
  if (record(configuration) && "directoryUrl" in configuration) {
    if (!only(configuration, ["directoryUrl"])) throw new SessionFailure("INVALID_MESSAGE", "Invalid directory configuration");
    const response = await fetch(endpoint(configuration.directoryUrl, true), { signal, credentials: "omit", redirect: "error" });
    if (!response.ok) throw new SessionFailure("UNAVAILABLE", "World directory is unavailable");
    // Read with a byte limit even when the server omits Content-Length.
    const reader = response.body?.getReader();
    if (!reader) throw new SessionFailure("INVALID_MESSAGE", "Empty directory");
    let length = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 262_144) throw new SessionFailure("INVALID_MESSAGE", "Directory exceeds size limit");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      values = JSON.parse(new TextDecoder().decode(bytes));
    } finally { await reader.cancel(); }
  }
  const list = Array.isArray(values) ? values : [values];
  if (list.length > MAX_DIRECTORY_WORLDS) throw new SessionFailure("INVALID_MESSAGE", "Too many worlds");
  const worlds = list.map(descriptor); const keys = new Set<string>();
  for (const world of worlds) {
    const key = worldKey(world);
    if (keys.has(key)) throw new SessionFailure("INVALID_MESSAGE", "Duplicate world registration");
    keys.add(key);
  }
  return worlds;
}

/** Shape checks occur before the production executor applies content and gameplay validation. */
export function command(value: unknown): GameCommand {
  if (!record(value) || !only(value, ["method", "args"]) || typeof value.method !== "string"
    || !Array.isArray(value.args)) throw new SessionFailure("INVALID_MESSAGE", "Invalid command");
  const a = value.args; const method = value.method; let valid = false;
  const oneId = () => a.length === 1 && id(a[0]);
  switch (method) {
    case "chat": valid = typeof a[0] === "string" && a[0].trim().length > 0 && a[0].length <= 280 && (a.length === 1
      || a.length === 2 && (a[1] === "nearby" || a[1] === "party")
      || a.length === 3 && a[1] === "whisper" && typeof a[2] === "string" && a[2].trim().length > 0 && a[2].length <= 128); break;
    case "who": valid = a.length === 0; break;
    case "party": valid = ["create", "leave", "disband"].includes(a[0]) ? a.length === 1
      : ["invite", "accept", "decline", "kick"].includes(a[0]) && a.length === 2 && id(a[1]); break;
    case "hunt": valid = a[0] === "accept" ? a.length === 2 && id(a[1])
      : a.length === 1 && ["refresh", "claim", "abandon"].includes(a[0]); break;
    case "steer": valid = a.length === 2 && a.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1); break;
    case "stop": valid = a.length === 0; break;
    case "moveTo": valid = a.length === 1 && record(a[0]) && (
      only(a[0], ["entityId"]) && id(a[0].entityId)
      || only(a[0], ["position"]) && Array.isArray(a[0].position) && a[0].position.length === 3
      && a[0].position.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 100_000)
      || only(a[0], ["locationId"]) && id(a[0].locationId)); break;
    case "attack": case "buildCampfire": valid = oneId(); break;
    case "equipItem": valid = (a.length === 1 || a.length === 2) && id(a[0]) && (a[1] == null || EQUIP_SLOTS.includes(a[1])); break;
    case "unequipItem": valid = a.length === 1 && EQUIP_SLOTS.includes(a[0]); break;
    case "setPreferredSpell": valid = a.length === 1 && (a[0] === null || id(a[0])); break;
    case "interact": case "cast": valid = a.length === 2 && a.every(id); break;
    case "castNow": valid = oneId(); break;
    case "castArea": valid = a.length === 2 && id(a[0]) && Array.isArray(a[1]) && a[1].length === 3
      && a[1].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000); break;
    case "takeLoot": valid = a.length >= 1 && a.length <= 3 && id(a[0]) && (a[1] == null || integer(a[1]) && a[1] >= 0 && a[1] < 400)
      && (a[2] == null || typeof a[2] === "string" && a[2].length <= 512); break;
    case "useItem": valid = (a.length === 1 || a.length === 2) && id(a[0]) && (a[1] == null || record(a[1]) && only(a[1], ["itemId"]) && id(a[1].itemId)); break;
    case "produce": valid = a.length === 2 && id(a[0]) && quantity(a[1]); break;
    case "produceAt": valid = a.length === 3 && id(a[0]) && id(a[1]) && quantity(a[2]); break;
    case "dialogue": valid = a[0] === "choose"
      ? a.length === 2 && typeof a[1] === "string" && /^[A-Za-z0-9_:.#-]{1,128}$/.test(a[1])
      : a.length === 1 && ["state", "end"].includes(a[0]); break;
    case "bank": case "shop": {
      const ops = method === "bank" ? ["list", "deposit", "withdraw", "depositAll"] : ["list", "buy", "sell"];
      valid = (a.length === 1 || a.length === 2) && ops.includes(a[0]) && (a[1] == null || record(a[1])
        && only(a[1], method === "bank" ? ["itemId", "quantity", "filter"] : ["shopId", "itemId", "quantity"])
        && (a[1].itemId === undefined || id(a[1].itemId)) && (a[1].shopId === undefined || id(a[1].shopId))
        && (a[1].quantity === undefined || quantity(a[1].quantity)) && (a[1].filter === undefined || text(a[1].filter)));
      break;
    }
  }
  if (!valid || !["steer", "chat", "party", "who"].includes(method) && !(GAME_COMMAND_METHODS as readonly string[]).includes(method)) {
    throw new SessionFailure("INVALID_MESSAGE", "Invalid command arguments");
  }
  return structuredClone(value) as unknown as GameCommand;
}
export function envelope(value: unknown): CommandEnvelope {
  if (!record(value) || !only(value, ["sessionId", "sequence", "operation", "command"]) || !id(value.sessionId)
    || !integer(value.sequence) || value.sequence < 1 || !integer(value.operation) || value.operation < 1) throw new SessionFailure("INVALID_MESSAGE", "Invalid command envelope");
  return { sessionId: value.sessionId, sequence: value.sequence, operation: value.operation, command: command(value.command) };
}
