import { performance } from "node:perf_hooks";
import type { MessagePort } from "node:worker_threads";
import type { SessionErrorCode, WorldDescriptor, WorldKey } from "../../contracts.js";
import { installCatalog, type InstalledCatalog } from "../../content/catalogInstall.js";
import type { AdminActor } from "../adminStorage.js";
import type { HeadlessWorldPorts } from "../headlessWorld.js";
import type { PlayerOp, PlayerPatch } from "../playerEdits.js";
import type { WorldConfiguration } from "../hostControl.js";
import type { AuthenticatedPlayer, PeerConnection, ServerEvent, WorldHostMetrics } from "../worldHost.js";
import { SessionFailure } from "../protocol.js";
import { createOutbox, ThreadPeerLink, type OutboundBatch, type PeerEncoding } from "./peerChannel.js";
import { createRpc, type Endpoint } from "./rpc.js";
import { remoteStorage, type StorageShape } from "./storageProxy.js";

/**
 * One world's thread: a `worldHost` core that hosts exactly that world, its storage reached through
 * the database thread, its peers reached through the main thread.
 *
 * Install before import holds per thread, because every thread has its own module graph and its own
 * content registry. This module imports nothing that reads a content table; the core, the control
 * and the world builder are reached through `await import()` after the catalog is in.
 */
export type CatalogSource =
  /** The database's active server catalog, which is what a server runs. */
  | { kind: "storage" }
  /** A module that installs one when imported, such as `content/bundledCatalog.js`. For tests and tools that run on the repo's content. */
  | { kind: "module"; specifier: string };
export type WorldBuild =
  /** The baked server world pack. The bytes are a view over shared memory, so no world copies them. */
  | { kind: "pack"; bytes: Uint8Array }
  | { kind: "lab" }
  /** `export default` or the named export is `(world, options) => Promise<HeadlessWorldPorts>`. For fixtures. */
  | { kind: "module"; specifier: string; name?: string; options?: unknown };
export interface WorldThreadData {
  role: "world";
  world: WorldDescriptor;
  /** What descriptors advertise. Tokens are verified on the main thread. */
  authentication: "account" | "guest";
  database: MessagePort; shape: StorageShape;
  catalog: CatalogSource; build: WorldBuild;
  peerEncoding: PeerEncoding;
  /** How often metrics go to the main thread, in milliseconds. */
  reportMs: number;
}
/** Sent once the world is built, its baseline committed and its loop ready to start. */
export interface WorldReady { descriptor: WorldDescriptor; catalogRevision: string; bootMs: number; buildMs: number }
/** What a world tells the main thread about once a second. Counters are since the last report. */
export interface WorldReport {
  population: number; capacity: number; tick: number; peers: number;
  ticks: number[]; stages: WorldHostMetrics["stages"]; commands: number; rejected: number; errors: number; backlogDisconnects: number;
  heapUsedBytes: number; utilization: number; cpuMs: number | null;
}

async function build(spec: WorldBuild, world: WorldDescriptor): Promise<HeadlessWorldPorts> {
  if (spec.kind === "pack") {
    const { createPackedWorld, loadServerWorldPack } = await import("../worldPack.js");
    return createPackedWorld(loadServerWorldPack(spec.bytes), world.seed);
  }
  if (spec.kind === "lab") return (await import("../labWorld.js")).createMultiplayerLabWorld(world.seed);
  const module = await import(spec.specifier) as Record<string, unknown>;
  const make = module[spec.name ?? "default"];
  if (typeof make !== "function") throw new Error(`World module ${spec.specifier} has no ${spec.name ?? "default"} export`);
  return (make as (world: WorldDescriptor, options: unknown) => Promise<HeadlessWorldPorts>)(world, spec.options);
}

export async function runWorldThread(data: WorldThreadData, parent: MessagePort): Promise<void> {
  const started = performance.now();
  const storage = remoteStorage(createRpc(data.database as Endpoint, {}), data.shape);
  if (data.catalog.kind === "storage") {
    const revision = await storage.catalog.activeRevision();
    const text = revision === null ? null : await storage.catalog.catalog(revision, "server");
    if (text === null) throw new Error("The database holds no active server catalog for this world to run");
    installCatalog(JSON.parse(text) as InstalledCatalog);
  } else await import(data.catalog.specifier);
  const [{ createWorldHost }, { localHostControl }, { RESOLVED_CATALOG }] = await Promise.all([import("../worldHost.js"), import("../localHostControl.js"), import("../../content/resolvedCatalog.js")]);

  const outbox = createOutbox(data.peerEncoding, (batch: OutboundBatch, transfer) => main.note("peer.out", [batch], transfer));
  const connections = new Map<number, { link: ThreadPeerLink; connection: PeerConnection; account: string | null }>();
  /** Accounts whose closed connection waits for the commit that saves it. */
  const releasing = new Set<string>();
  /** `closing`: the server is shutting down. `told`: the main thread is the one that said to fail closed. */
  let closing = false, told = false;
  const buildStarted = performance.now();
  const host = await createWorldHost<ThreadPeerLink>({
    worlds: [data.world], storage: storage.world, build: world => build(data.build, world), catalogRevision: RESOLVED_CATALOG.revision,
    authentication: { authentication: data.authentication, authenticate: (token, world) => main.call<AuthenticatedPlayer>("authenticate", [token, keyOf(world)]) },
    beforeAdmission: (player, world) => main.call<void>("beforeAdmission", [player, keyOf(world)]),
    releasing(accountId, waiting) { if (waiting) releasing.add(accountId); else if (releasing.delete(accountId)) main.note("account.released", [accountId]); },
    // The events ring and the log live on the main thread, which stamps each entry with its own clock and logs it.
    event({ at: _at, ...event }) { main.note("event", [event satisfies Omit<ServerEvent, "at">]); },
    // A failed commit stops this world. The main thread stops the server, as one process does today.
    failed() { if (!closing && !told) main.note("failed", []); },
  });
  const buildMs = performance.now() - buildStarted;
  const control = localHostControl(host), hosted = [...host.worlds.values()][0]!;

  let lastReport = { ticks: 0, commands: 0, rejected: 0, errors: 0, backlog: 0, stages: { ...host.metrics.stages } };
  let utilization = performance.eventLoopUtilization(); let cpu = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : null;
  const report = (): WorldReport => {
    // Taking the samples out of the core's ring is fine: nothing else in this thread reads it.
    const metrics = host.metrics, fresh = metrics.ticks.splice(0);
    const stages = { simulationMs: metrics.stages.simulationMs - lastReport.stages.simulationMs, snapshotMs: metrics.stages.snapshotMs - lastReport.stages.snapshotMs,
      commitMs: metrics.stages.commitMs - lastReport.stages.commitMs, replicationMs: metrics.stages.replicationMs - lastReport.stages.replicationMs, samples: metrics.stages.samples - lastReport.stages.samples };
    const next = performance.eventLoopUtilization(), delta = performance.eventLoopUtilization(next, utilization); utilization = next;
    const cpuNow = cpu ? process.threadCpuUsage() : null, cpuMs = cpu && cpuNow ? (cpuNow.user - cpu.user + cpuNow.system - cpu.system) / 1000 : null; cpu = cpuNow;
    const result: WorldReport = { population: hosted.admission.population, capacity: hosted.admission.capacity, tick: hosted.runtime.clock.tick, peers: hosted.peers.size, ticks: fresh, stages,
      commands: metrics.commands - lastReport.commands, rejected: metrics.rejected - lastReport.rejected, errors: metrics.errors - lastReport.errors,
      backlogDisconnects: metrics.backlogDisconnects - lastReport.backlog, heapUsedBytes: process.memoryUsage().heapUsed, utilization: delta.utilization, cpuMs };
    lastReport = { ticks: 0, commands: metrics.commands, rejected: metrics.rejected, errors: metrics.errors, backlog: metrics.backlogDisconnects, stages: { ...metrics.stages } };
    return result;
  };

  /** Holds taken for the main thread's barrier, by barrier id. A released id that never got its hold is remembered so the late hold lets go at once. */
  const holds = new Map<number, () => void>(), cancelled = new Set<number>();
  let reporter: ReturnType<typeof setInterval> | null = null;

  const main = createRpc(parent as Endpoint, {
    "peer.open"(id: number, originAllowed: boolean) {
      const link = new ThreadPeerLink(id, outbox, originAllowed), connection = host.connect(link);
      if (connection) connections.set(id, { link, connection, account: null });
    },
    async "peer.message"(id: number, text: string) {
      const entry = connections.get(id); if (!entry) return;
      let message: unknown;
      try { message = JSON.parse(text); } catch (error) { entry.connection.refuse(error); return; }
      const wasJoined = entry.connection.joined;
      await entry.connection.accept(message);
      if (!wasJoined && entry.connection.joined) {
        const peer = [...hosted.peers.values()].find(candidate => candidate.link === entry.link);
        entry.account = peer?.playerId ?? null;
        main.note("peer.joined", [id, entry.account]);
      }
    },
    "peer.binary"(id: number) { connections.get(id)?.connection.refuse(new SessionFailure("INVALID_MESSAGE", "Text messages required")); },
    "peer.closed"(id: number) {
      const entry = connections.get(id);
      // A socket of this world's previous life, or one the closed host never took. Nothing is being saved for it.
      if (!entry) { main.note("peer.left", [id, false]); return; }
      connections.delete(id); entry.link.gone(); entry.connection.closed();
      // Whether the account now waits for a saving commit. The main thread holds a join elsewhere until `account.released`.
      main.note("peer.left", [id, entry.account !== null && releasing.has(entry.account)]);
    },
    /** The account joined another world of this server. */
    "account.elsewhere"(accountId: string) { host.joinedElsewhere(accountId); },

    /** Take the tick hold for a barrier. Answers once no tick is in flight; `resume` lets the loop go on. */
    hold(barrier: number) {
      return new Promise<void>((held, refused) => {
        host.betweenTicks(() => new Promise<void>(release => {
          if (cancelled.delete(barrier)) { release(); return; }
          holds.set(barrier, release); held();
        })).catch(refused);
      });
    },
    resume(barrier: number) { const release = holds.get(barrier); if (release) { holds.delete(barrier); release(); } else cancelled.add(barrier); },

    broadcast: (message: unknown) => control.broadcast(message),
    disconnectAccount: (accountId: string, code: SessionErrorCode, message: string) => control.disconnectAccount(accountId, code, message),
    configure: (change: WorldConfiguration) => control.configure(change),
    liveCharacter: (accountId: string) => control.liveCharacter(accountId),
    editLive: (accountId: string, patch: PlayerPatch, by: AdminActor) => control.editLive(accountId, patch, by),
    editSaved: (pending: number) => control.editSaved(pending),
    planStoredEdit: (lastWorld: WorldKey | null, character: never, ops: PlayerOp[]) => control.planStoredEdit(lastWorld, character, ops),
    adoptStored: (accountId: string, character: never) => control.adoptStored(accountId, character),
    publishStage: (catalog: InstalledCatalog) => control.publishStage(catalog),
    publishCheck: (removedItems: string[], spawnGroupIds: string[]) => control.publishCheck(removedItems, spawnGroupIds),
    publishCommit: () => control.publishCommit(),
    publishAbort: () => control.publishAbort(),
    failClosed() { told = true; host.failClosed(); },

    start() { host.start(); reporter = setInterval(() => main.note("report", [report()]), data.reportMs); },
    report: () => report(),
    /** Stop the loop, let the main thread drop the sockets, then save every held character and free its account. */
    async close() {
      closing = true; if (reporter) clearInterval(reporter);
      await host.close(() => main.call<void>("disconnectPeers"));
    },
  });
  parent.postMessage({ k: "n", m: "ready", a: [{ descriptor: hosted.runtime.descriptor, catalogRevision: RESOLVED_CATALOG.revision, bootMs: performance.now() - started, buildMs } satisfies WorldReady] });
}

const keyOf = (world: WorldKey): WorldKey => ({ providerId: world.providerId, worldId: world.worldId });
