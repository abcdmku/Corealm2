import type { WorldKey } from "../contracts.js";
import type { InstalledCatalog } from "../content/catalogInstall.js";
import type { CompiledWorld } from "../content/worldData.js";
import { playerSessionState } from "../state/store.js";
import { swapCatalog } from "./contentSwap.js";
import type { HeadlessWorld } from "./headlessWorld.js";
import type { HostControl, PublishCheck } from "./hostControl.js";
import { applyPlayerOps, editDiff, EditFailure, PLACE_SNAP_METRES } from "./playerEdits.js";
import { playerRevision } from "./playerRevision.js";
import { worldKey } from "./protocol.js";
import type { SpawnPlan } from "./spawnPlan.js";
import type { HostedWorld, PeerLink, WorldHost } from "./worldHost.js";

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
