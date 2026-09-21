import { WORLD_PROTOCOL_VERSION, type PlayerCharacter, type PlayerWorldRecord, type SessionErrorCode, type WorldDescriptor, type WorldFixture } from "../contracts.js";
import type { ClientCatalog } from "../content/clientCatalog.js";

/**
 * What the page and the local-play worker say to each other, outside the session itself.
 *
 * The session (join, snapshot, commands, updates) travels over a MessagePort and is the same
 * protocol a socket carries. These messages go over the worker's own channel and cover what a
 * server does with a process and a disk: start, hand out the client catalog, flush, shut down.
 *
 * This module imports no content and nothing from the host, so both sides can load it first.
 */

/** Published beside the client build. It names the two big files by revision, so it is the only one fetched uncached. */
export const LOCAL_WORLD_MANIFEST = "local-world.json";
export interface LocalWorldManifest {
  version: 1;
  /** The server catalog: every compiled table plus `formulaRevision`. The file name carries a hash of its bytes. */
  catalog: { revision: string; formulaRevision: string; file: string; bytes: number };
  /** The server world pack. One file name, so its URL carries `revision` as a query to get past a cache. */
  pack: { file: string; revision: string; seeds: number[]; bytes: number };
}
export function parseLocalWorldManifest(value: unknown): LocalWorldManifest {
  const record = (input: unknown): input is Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input);
  const file = (input: unknown): input is string => typeof input === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(input);
  if (!record(value) || value.version !== 1 || !record(value.catalog) || !record(value.pack)
    || typeof value.catalog.revision !== "string" || typeof value.catalog.formulaRevision !== "string" || !file(value.catalog.file)
    || !file(value.pack.file) || typeof value.pack.revision !== "string" || !Array.isArray(value.pack.seeds) || value.pack.seeds.length === 0
    || !value.pack.seeds.every(Number.isSafeInteger)) throw new Error("The local world manifest is malformed");
  return value as unknown as LocalWorldManifest;
}

/** The one account local play has. It needs no login, so it needs no more than a fixed id. */
export const LOCAL_ACCOUNT_ID = "local:player";
export const LOCAL_PROVIDER_ID = "local";
export const DEFAULT_LOCAL_NAME = "Adventurer";

/** The seed local play runs: the one asked for when the pack holds it, otherwise the pack's first. */
export function packedSeed(seeds: readonly number[], wanted: number): number {
  return seeds.includes(wanted) ? wanted : seeds[0]!;
}

/**
 * The local world, as both sides name it. The page lists it before a worker exists and the worker
 * hosts it, so it is a pure function of fixture and seed. The seed is in the id because a stored
 * world only loads into the seed it was written for.
 */
export function localWorldDescriptor(fixture: WorldFixture, seed: number): WorldDescriptor {
  return { providerId: LOCAL_PROVIDER_ID, worldId: `${fixture}-${seed}`, name: "Play local", endpoint: "local:worker", protocolVersion: WORLD_PROTOCOL_VERSION,
    fixture, seed, population: 0, capacity: 1, availability: "available", authentication: "guest" };
}

/** An old main-thread save, already migrated and validated by the page. The shape `legacySaveImport` returns. */
export interface LegacyImport { character: PlayerCharacter; owned: PlayerWorldRecord["ownedWorld"]; seed: number; savedAt: number }
/** `imported`: the save became the local character. `existing`: a local character was already stored, so the save was left alone. */
export type LegacyOutcome = "none" | "imported" | "existing";

export interface LocalHostStart {
  type: "start";
  /** Absolute URL of the public file tree, with a trailing slash. */
  assetBase: string;
  fixture: WorldFixture;
  seed: number;
  legacy?: LegacyImport;
  /** Keep nothing: for harnesses and focused sessions that must not touch the player's character. */
  memory?: boolean;
}
export type LocalHostRequest =
  | LocalHostStart
  | { type: "connect"; port: MessagePort }
  | { type: "catalog"; id: number }
  | { type: "flush"; id?: number }
  | { type: "close"; id: number };

export interface LocalHostTimings { manifestMs: number; catalogMs: number; packMs: number; installMs: number; importMs: number; storageMs: number; worldMs: number; totalMs: number }
export interface LocalHostReady {
  type: "ready";
  world: WorldDescriptor;
  catalogRevision: string;
  /** They differ when the pack has no world for the seed that was asked for. The character then starts at the safe spawn. */
  seed: { requested: number; used: number };
  legacy: LegacyOutcome;
  storage: "indexeddb" | "memory";
  timings: LocalHostTimings;
}
/**
 * A write to the local store failed: quota, a blocked upgrade, an aborted transaction. Play goes on
 * from memory and the store retries, until `degraded`, after which nothing more is saved this session.
 */
export interface LocalStorageTrouble { type: "storage-error"; message: string; attempt: number; pending: number; degraded: boolean }
export type LocalHostReply =
  | LocalHostReady
  | LocalStorageTrouble
  | { type: "failed"; code: SessionErrorCode; message: string }
  | { type: "catalog"; id: number; catalog: ClientCatalog }
  | { type: "flushed"; id: number; ok: boolean }
  | { type: "closed"; id: number };
