import type { PlayerCharacter, SessionErrorCode, WorldDescriptor, WorldKey } from "../contracts.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import type { CompiledWorld } from "../content/worldData.js";
import { playerSessionState } from "../state/store.js";
import type { AdminActor } from "./adminStorage.js";
import { swapCatalog } from "./contentSwap.js";
import type { HeadlessWorld } from "./headlessWorld.js";
import { applyPlayerOps, editDiff, EditFailure, PLACE_SNAP_METRES, type EditResult, type PlayerOp, type PlayerPatch } from "./playerEdits.js";
import { playerRevision } from "./playerRevision.js";
import { worldKey } from "./protocol.js";
import type { SpawnPlan } from "./spawnPlan.js";
import type { HostedWorld, PeerLink, ServerEvent, WorldHost, WorldHostMetrics } from "./worldHost.js";

/**
 * What a server does to its running worlds, apart from carrying their peers: hold their ticks, edit a
 * live player, move them onto a published catalog, change their capacity, read their state.
 *
 * Two things implement it. `localHostControl` works on a `WorldHost` in this thread, which is the
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

const keyOf = (world: HeadlessWorld): WorldKey => ({ providerId: world.descriptor.providerId, worldId: world.descriptor.worldId });

/** The control of the worlds one `WorldHost` runs in this thread. */
export function localHostControl<L extends PeerLink>(host: WorldHost<L>): HostControl {
  const worlds = (): HostedWorld<L>[] => [...host.worlds.values()];
  const saves = new Map<number, Promise<void>>(); let serial = 0;
  let staged: InstalledCatalog | null = null; let plans: { world: HeadlessWorld; plan: SpawnPlan }[] = [];
  const snapIn = (hosted: HostedWorld<L> | null | undefined) => (position: readonly [number, number, number]) => hosted?.runtime.ports.nav.nearestWalkable(position, PLACE_SNAP_METRES) ?? null;
  return {
    get closed() { return host.closed; },
    metrics: host.metrics, events: host.events, record: host.record,
    status: () => worlds().map(({ runtime, admission, peers }) => ({ key: keyOf(runtime), descriptor: runtime.descriptor,
      population: admission.population, capacity: admission.capacity, tick: runtime.clock.tick, peers: peers.size, available: !host.closed })),
    connected: host.connected,
    betweenTicks: host.betweenTicks,
    async broadcast(message) { return host.broadcast(message); },
    async disconnectAccount(accountId, code, message) { return host.disconnectAccount(accountId, code, message); },
    failClosed: host.failClosed,
    async configure(change) {
      for (const { runtime, admission } of worlds()) {
        if (change.capacity) admission.capacity = runtime.descriptor.capacity = change.capacity[runtime.descriptor.worldId] ?? admission.capacity;
        if (change.description !== undefined) { if (change.description) runtime.descriptor.description = change.description; else delete runtime.descriptor.description; }
        if (change.endpoint !== undefined) runtime.descriptor.endpoint = change.endpoint;
        if (change.baseVersion !== undefined) { if (change.baseVersion) runtime.descriptor.baseVersion = change.baseVersion; else delete runtime.descriptor.baseVersion; }
      }
    },
    async liveCharacter(accountId) {
      for (const hosted of worlds()) {
        if (!hosted.leases.has(accountId)) continue;
        const player = hosted.runtime.players.get(accountId); if (!player) continue;
        const { ownedWorld: _owned, ...character } = playerSessionState(player.store.get());
        return { world: keyOf(hosted.runtime), character };
      }
      return null;
    },
    async editLive(accountId, patch, by) {
      const live = host.holder(accountId); if (!live) return null;
      const world = keyOf(live.runtime);
      const { ownedWorld: _owned, ...before } = playerSessionState(live.runtime.players.get(accountId)!.store.get());
      const revision = playerRevision(before);
      if (patch.expect !== null && patch.expect !== revision) throw new EditFailure(409, "revision_mismatch", `The player changed since revision ${patch.expect} was read. It is now ${revision}`);
      const result = applyPlayerOps(before, patch.ops, { world, snap: snapIn(live) });
      const diff = editDiff(before, result.character);
      if (!diff) return { world, changed: false, warnings: result.warnings, pending: null };
      live.runtime.adoptCharacter(accountId, result.character, result.moved);
      const pending = ++serial;
      const saved = new Promise<void>((resolve, reject) => live.audits.push({ accountId, by,
        entry: { action: "player.edit", target: accountId, before: diff.before, after: { ...diff.after, applied: "live", world: live.runtime.descriptor.worldId } },
        settle: outcome => outcome === "saved" ? resolve() : reject(outcome === "fenced" ? new EditFailure(409, "player_busy", "This player's session ended before the edit was saved")
          : new EditFailure(503, "unavailable", "World storage failed before the edit was saved")) }));
      // Nobody may be waiting yet. The rejection is delivered when `editSaved` asks.
      saved.catch(() => {}); saves.set(pending, saved);
      return { world, changed: true, warnings: result.warnings, pending };
    },
    editSaved(pending) {
      const saved = saves.get(pending); saves.delete(pending);
      return saved ?? Promise.reject(new EditFailure(503, "unavailable", "The edit is not known to this world"));
    },
    async planStoredEdit(lastWorld, character, ops) {
      const last = lastWorld && host.worlds.get(worldKey(lastWorld));
      return applyPlayerOps(character, ops, { world: last ? lastWorld : null, snap: snapIn(last) });
    },
    async adoptStored(accountId, character) {
      for (const hosted of worlds()) if (!hosted.leases.has(accountId)) hosted.runtime.adoptCharacter(accountId, character, false);
    },
    async publishStage(catalog) { staged = catalog; plans = []; },
    async publishCheck(removedItems, spawnGroupIds) {
      const items = new Set(removedItems), groups = new Set(spawnGroupIds), check: PublishCheck = { worlds: [], unplaceable: null, planMs: 0 };
      plans = [];
      for (const { runtime } of worlds()) check.worlds.push({ worldId: runtime.descriptor.worldId,
        holders: items.size ? runtime.itemHolders(items) : [], creatures: [...runtime.livingCreatures()] });
      const planStarted = performance.now();
      if (groups.size && staged) for (const { runtime } of worlds()) {
        if (!runtime.ports.planSpawns) continue;
        try { plans.push({ world: runtime, plan: runtime.ports.planSpawns(staged.tables.world as CompiledWorld, groups, runtime.entities.all()) }); }
        catch (error) { check.unplaceable = { worldId: runtime.descriptor.worldId, message: error instanceof Error ? error.message : String(error) }; plans = []; break; }
      }
      check.planMs = performance.now() - planStarted;
      return check;
    },
    async publishCommit() {
      if (!staged) throw new Error("No catalog was staged for this publish");
      const catalog = staged, planned = plans; staged = null; plans = [];
      swapCatalog(catalog, worlds().map(hosted => hosted.runtime));
      return planned.map(({ world, plan }) => ({ world: world.descriptor.worldId, ...world.applySpawns(plan) }));
    },
    async publishAbort() { staged = null; plans = []; },
  };
}
