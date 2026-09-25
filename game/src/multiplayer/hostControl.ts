import type { PlayerCharacter, SessionErrorCode, WorldDescriptor, WorldKey } from "../contracts.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import type { AdminActor } from "./adminStorage.js";
import type { EditResult, PlayerOp, PlayerPatch } from "./playerEdits.js";
import type { ServerEvent, WorldHostMetrics } from "./worldHost.js";

/**
 * What a server does to its running worlds, apart from carrying their peers: hold their ticks, edit a
 * live player, move them onto a published catalog, change their capacity, read their state.
 *
 * This module is only the interface, and it loads no content table. Two things implement it.
 * `localHostControl` (`localHostControl.ts`) works on a `WorldHost` in this thread, which is the
 * whole server when threads are off and one world's thread when they are on. The threaded server's
 * control (`threads/threadedHost.ts`) asks every world thread and merges the answers. So every method
 * is asynchronous and every argument and result is plain data: nothing here may hand out a live
 * object, because the world it belongs to may be in another thread.
 *
 * Except for `betweenTicks`, `status`, `connected` and `broadcast`, a method is only called inside a
 * hold: no tick is in flight anywhere while it runs.
 */
export interface WorldStatus { key: WorldKey; descriptor: WorldDescriptor; population: number; capacity: number; tick: number; peers: number; available: boolean }
export interface LiveCharacter { world: WorldKey; character: PlayerCharacter }
export interface LiveEdit {
  world: WorldKey; changed: boolean; warnings: string[];
  /** Names the audit row that rides the next commit. Null when nothing changed. `editSaved` waits for it. */
  pending: number | null;
}
export type LiveHolder = { heldBy: "player"; id: string; place: string; accountId: string; name: string } | { heldBy: "loot-pile"; id: string; pileId: string };
export interface PublishCheck {
  worlds: { worldId: string; holders: LiveHolder[]; creatures: [id: string, alive: number][] }[];
  /** The first world whose changed spawn groups cannot be placed. Nothing is published then. */
  unplaceable: { worldId: string; message: string } | null;
  /** Milliseconds the slowest world spent planning. */
  planMs: number;
}
export interface SpawnCounts { world: string; added: number; pending: number; retiring: number; removed: number }
/** `baseVersion` null takes it off the descriptor. */
export interface WorldConfiguration { capacity?: Readonly<Record<string, number>>; description?: string | null; endpoint?: string; baseVersion?: string | null }

/** The hold could not be taken, or a world stopped answering inside it. The operation did nothing. */
export class HoldFailure extends Error {
  constructor(message: string) { super(message); this.name = "HoldFailure"; }
}

export interface HostControl {
  readonly closed: boolean;
  readonly metrics: WorldHostMetrics;
  readonly events: readonly ServerEvent[];
  record(event: Omit<ServerEvent, "at">): void;
  status(): WorldStatus[];
  connected(accountId: string): boolean;
  /** Runs `run` once no tick is in flight in any world, and starts none until it settles. Throws `HoldFailure` when the worlds cannot be held. */
  betweenTicks<T>(run: () => Promise<T>): Promise<T>;
  broadcast(message: unknown): Promise<number>;
  disconnectAccount(accountId: string, code: SessionErrorCode, message: string): Promise<boolean>;
  failClosed(): void;

  configure(change: WorldConfiguration): Promise<void>;
  liveCharacter(accountId: string): Promise<LiveCharacter | null>;
  /** Edit the account in the world that holds it. Null when no world does. Throws `EditFailure`. */
  editLive(accountId: string, patch: PlayerPatch, by: AdminActor): Promise<LiveEdit | null>;
  /** Settles when the commit that carries the edit and its audit row has, and rejects with `EditFailure` when it did not save. */
  editSaved(pending: number): Promise<void>;
  /** Work out an edit of a stored character. `lastWorld` answers where they may stand, when this server runs it. Throws `EditFailure`. */
  planStoredEdit(lastWorld: WorldKey | null, character: PlayerCharacter, ops: readonly PlayerOp[]): Promise<EditResult>;
  /** A stored character changed. Worlds that keep a copy for a campfire or cache take the new one. */
  adoptStored(accountId: string, character: PlayerCharacter): Promise<void>;

  /** Hand every world the compiled catalog before the hold, so the hold moves no megabytes. */
  publishStage(catalog: InstalledCatalog): Promise<void>;
  /** Inside the hold: who holds a removed definition, and each world's spawn plan for the staged catalog, kept until commit or abort. */
  publishCheck(removedItems: readonly string[], spawnGroupIds: readonly string[]): Promise<PublishCheck>;
  /** The database has moved: every world swaps onto the staged catalog and applies its plan. A failure here must fail the server closed. */
  publishCommit(): Promise<SpawnCounts[]>;
  publishAbort(): Promise<void>;
}
