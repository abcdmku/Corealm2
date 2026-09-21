import type { IncomingMessage } from "node:http";
import { MessageChannel, type Worker } from "node:worker_threads";
import type { WebSocket } from "ws";
import type { PlayerCharacter, SessionErrorCode, WorldDescriptor, WorldKey } from "../../contracts.js";
import type { InstalledCatalog } from "../../content/catalogInstall.js";
import { swapCatalog } from "../contentSwap.js";
import { HoldFailure, type HostControl, type LiveCharacter, type LiveEdit, type PublishCheck, type SpawnCounts, type WorldStatus } from "../hostControl.js";
import { applyPlayerOps, EditFailure, type EditResult } from "../playerEdits.js";
import { compatible, descriptor, record, SessionFailure, worldKey } from "../protocol.js";
import { sendFrame, WebSocketLink } from "../webSocketLink.js";
import { createWorldHost, type AuthenticatedPlayer, type AuthenticationAdapter, type WorldHostMetrics } from "../worldHost.js";
import { threadReady as ready, type DatabaseThread } from "./databaseClient.js";
import type { DatabaseThreadStats } from "./databaseThread.js";
import type { ThreadLauncher } from "./launch.js";
import type { OutboundBatch, PeerEncoding } from "./peerChannel.js";
import { createRpc, reviveWith, ThreadUnavailable, type Endpoint, type Rpc } from "./rpc.js";
export type { DatabaseThread } from "./databaseClient.js";
import type { CatalogSource, WorldBuild, WorldReady, WorldReport, WorldThreadData } from "./worldThread.js";

/**
 * The main thread's side of a server that runs each world in its own thread.
 *
 * What stays here: the sockets, with their framing, size limits, backlog accounting and liveness; the
 * verification of join tokens and the ban check, which every world asks for over its port; the events
 * ring, the log and the whole-server metrics; and the routing of each socket to the thread of the
 * world it joined. What a world does is the `worldHost` core's business, in that world's thread.
 *
 * Nothing here shares memory with a world. Which world holds an account is the database's lease, and
 * the three things the single-process core did across worlds in memory are done with messages:
 * a join waits for the save of a session the account just closed in another world, a world is told
 * when an account joined elsewhere, and the tick hold is a barrier over every world.
 */
reviveWith(error => error.name === "EditFailure" && error.status && error.code ? new EditFailure(error.status as 400 | 409 | 503, error.code, error.message, error.opIndex ?? null) : null);

/** How the host was asked to run its worlds. `"off"` never reaches this module: it runs no threads at all. */
export type ThreadMode = "auto" | "on";

export interface ThreadedHostOptions {
  launch: ThreadLauncher;
  database: DatabaseThread;
  worlds: WorldDescriptor[];
  /** The catalog this server runs, stamped on every descriptor. */
  catalogRevision: string;
  catalog: CatalogSource; build: WorldBuild;
  authentication: AuthenticationAdapter;
  /** What the host was configured with. `"auto"` means threads were chosen because this server has more than one world. */
  mode?: ThreadMode;
  beforeAdmission(player: AuthenticatedPlayer, world: WorldDescriptor): Promise<void>;
  allowedOrigins?: readonly string[];
  now(): number;
  log(event: Record<string, unknown>): void;
  /** How replication frames cross to the main thread. `bytes` is the default; `docs/multiplayer-hosting.md` has the measurement. */
  peerEncoding?: PeerEncoding;
  /** How long a world may take to reach its tick boundary for a hold before the operation that asked is refused. */
  holdTimeoutMs?: number;
  /** Start a crashed world again, with a growing pause between tries. On by default. */
  restart?: boolean;
  /** Failures inside `restartWindowMs` after which the world is left down. Default 5. */
  restartLimit?: number;
  /** How long a failure is remembered. Default ten minutes. */
  restartWindowMs?: number;
  reportMs?: number;
}
export interface WorldDiagnostics {
  worldId: string; available: boolean; restarts: number; bootMs: number; buildMs: number;
  /** Crashes and failed starts still inside the restart window. */
  failures: number;
  /** The world failed too often and is not being started again. It stays unavailable until the server restarts. */
  abandoned: boolean;
  /** Recent tick times in milliseconds, oldest first. `clearTicks` empties them. */
  ticks: number[]; stages: WorldHostMetrics["stages"];
  heapUsedBytes: number; utilization: number; cpuMs: number | null;
}
export interface ThreadedHost {
  control: HostControl;
  /** Take a socket the HTTP server upgraded. */
  accept(ws: WebSocket, request: IncomingMessage): void;
  /** Tell every world where the listener is, once it is bound, and start their loops. */
  start(endpoint: string | null): Promise<void>;
  /** Ask every world for its numbers now instead of waiting for its next report. At most one ask in flight. */
  refresh(): Promise<void>;
  diagnostics(): Promise<{ mode: ThreadMode; worlds: WorldDiagnostics[]; database: DatabaseThreadStats }>;
  clearTicks(): void;
  /** Terminate sockets that went silent. The reference server calls it once a second. */
  dropSilent(): void;
  close(disconnectPeers: () => Promise<void>): Promise<void>;
}

const TICK_RING = 36_000;
const RELEASE_WAIT_MS = 5_000;
const UNAVAILABLE = { type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } };
const RESTART_LIMIT = 5, RESTART_WINDOW_MS = 600_000;

export interface RestartBudget {
  /** Failures still inside the window. */
  readonly failures: number;
  /** The limit was reached: this world is not being started again. */
  readonly abandoned: boolean;
  /** Record a crash or a failed start. Returns the pause before the next try, or null to stop trying. */
  failed(at: number): number | null;
}
/**
 * How long to wait before starting a crashed world again, and when to stop.
 *
 * A world that fails, is started, and fails again within seconds will do that forever: the bug is in
 * its own data or code, and the thousandth try goes the same way as the second. So failures inside
 * the window are counted, and at the limit the world is left down for an operator to look at. The
 * window is also what forgives: a failure older than it is dropped, so a world that ran longer than
 * the window before it died starts its count again from one.
 */
export function restartBudget(limit = RESTART_LIMIT, windowMs = RESTART_WINDOW_MS): RestartBudget {
  const times: number[] = [];
  let abandoned = false;
  return {
    get failures() { return times.length; },
    get abandoned() { return abandoned; },
    failed(at) {
      if (abandoned) return null;
      while (times.length && at - times[0]! >= windowMs) times.shift();
      times.push(at);
      if (times.length >= limit) { abandoned = true; return null; }
      // One second, then two, four and so on up to a minute, for as long as the world keeps failing.
      return Math.min(60_000, 1000 * 2 ** (times.length - 1));
    },
  };
}

interface Routed { id: number; ws: WebSocket; link: WebSocketLink; thread: WorldThread; account: string | null; deadline: ReturnType<typeof setTimeout> | null }
interface WorldThread {
  index: number; key: string; input: WorldDescriptor; descriptor: WorldDescriptor;
  worker: Worker | null; rpc: Rpc | null; available: boolean; restarts: number; budget: RestartBudget; bootMs: number; buildMs: number;
  report: WorldReport | null; ticks: number[]; stages: WorldHostMetrics["stages"]; cpuMs: number | null;
  peers: Map<number, Routed>;
}

export async function createThreadedHost(options: ThreadedHostOptions): Promise<ThreadedHost> {
  const { now, log, database } = options, holdTimeoutMs = options.holdTimeoutMs ?? 10_000, reportMs = options.reportMs ?? 1000;
  const advertised = options.authentication.authentication ?? "guest";
  // The lobby is a core that hosts no world. It answers every socket that does not name a world of this server, with
  // the same refusals and in the same order as a world would, and its ring and metrics are the server's.
  const lobby = await createWorldHost<WebSocketLink>({ worlds: [], storage: database.storage.world, build: () => Promise.reject(new Error("The lobby builds no world")),
    authentication: options.authentication, now, log });
  const metrics = lobby.metrics;
  let closed = false, closing = false, serial = 0;
  /** Accounts whose closed session is being saved by its world. A join anywhere waits here first. */
  const saving = new Map<string, { done: Promise<void>; resolve(): void; peer: number }>();
  const joined = new Map<string, Set<Routed>>();

  const threads: WorldThread[] = [];
  for (const [index, input] of options.worlds.entries()) {
    const world = descriptor({ ...input, catalogRevision: options.catalogRevision, authentication: input.authentication ?? advertised }); compatible(world);
    if (threads.some(thread => thread.key === worldKey(world))) throw new Error("Duplicate hosted world");
    threads.push({ index, key: worldKey(world), input: world, descriptor: world, worker: null, rpc: null, available: false, restarts: 0,
      budget: restartBudget(options.restartLimit, options.restartWindowMs), bootMs: 0, buildMs: 0,
      report: null, ticks: [], stages: { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }, cpuMs: null, peers: new Map() });
  }
  const live = (): WorldThread[] => threads.filter(thread => thread.available && thread.rpc);

  function failClosed(): void {
    if (closed) return; closed = true;
    lobby.failClosed();
    for (const thread of threads) thread.rpc?.note("failClosed");
    for (const waiting of saving.values()) waiting.resolve();
    saving.clear();
  }
  database.onExit(reason => { if (!closing && !closed) { log({ event: "database.failed", level: "error", message: reason }); failClosed(); } });

  function absorb(thread: WorldThread, report: WorldReport): void {
    thread.report = report; thread.cpuMs = report.cpuMs === null ? thread.cpuMs : (thread.cpuMs ?? 0) + report.cpuMs;
    thread.ticks.push(...report.ticks); if (thread.ticks.length > TICK_RING) thread.ticks.splice(0, thread.ticks.length - TICK_RING);
    metrics.ticks.push(...report.ticks); if (metrics.ticks.length > TICK_RING) metrics.ticks.splice(0, metrics.ticks.length - TICK_RING);
    for (const stage of ["simulationMs", "snapshotMs", "commitMs", "replicationMs", "samples"] as const) { thread.stages[stage] += report.stages[stage]; metrics.stages[stage] += report.stages[stage]; }
    metrics.commands += report.commands; metrics.rejected += report.rejected; metrics.errors += report.errors; metrics.backlogDisconnects += report.backlogDisconnects;
  }
  function settle(account: string, peer?: number): void {
    const waiting = saving.get(account); if (!waiting || (peer !== undefined && waiting.peer !== peer)) return;
    saving.delete(account); waiting.resolve();
  }

  /** Everything the main thread answers for one world, and everything it hears from it. */
  function handlersFor(thread: WorldThread): Record<string, (...args: never[]) => unknown> {
    const handlers = {
      authenticate: (token: string, _world: WorldKey) => options.authentication.authenticate(token, thread.descriptor),
      async beforeAdmission(player: AuthenticatedPlayer, _world: WorldKey) {
        await options.beforeAdmission(player, thread.descriptor);
        // The account may have just left another world. Its character is that world's to save before this one reads it.
        await saving.get(player.playerId)?.done;
      },
      "peer.out"(batch: OutboundBatch) {
        const bytes = batch.bytes === null ? null : Buffer.from(batch.bytes);
        for (const op of batch.ops) {
          const peer = thread.peers.get(op[0]); if (!peer) continue;
          if (op.length === 4) peer.ws.close(op[1], op[2]);
          else if (op.length === 2) sendFrame(peer.ws, metrics, op[1], Buffer.byteLength(op[1]));
          else sendFrame(peer.ws, metrics, bytes!.subarray(op[1], op[1] + op[2]), op[2]);
        }
      },
      "peer.joined"(id: number, account: string | null) {
        const peer = thread.peers.get(id); if (!peer) return;
        if (peer.deadline) { clearTimeout(peer.deadline); peer.deadline = null; }
        if (account === null) return;
        peer.account = account;
        let sessions = joined.get(account); if (!sessions) joined.set(account, sessions = new Set()); sessions.add(peer);
        // The claim took the account's lease, so a session or a kept place in any other world is over.
        for (const other of live()) if (other !== thread) other.rpc!.note("account.elsewhere", [account]);
      },
      "peer.left"(id: number, releasing: boolean) { if (!releasing) for (const [account, waiting] of saving) if (waiting.peer === id) settle(account, id); },
      "account.released"(account: string) { settle(account); },
      event(event: Parameters<typeof lobby.record>[0]) { lobby.record(event); },
      report(report: WorldReport) { absorb(thread, report); },
      failed() {
        if (closed || closing) return;
        log({ event: "world.failed", level: "error", world: thread.descriptor.worldId, message: "World storage or simulation failed. The server has stopped serving." });
        failClosed();
      },
      /** A closing world asks for its sockets to go. Every world asks; the sockets are dropped once. */
      disconnectPeers: () => disconnected ??= disconnect(),
    };
    return handlers as unknown as Record<string, (...args: never[]) => unknown>;
  }
  let disconnect: () => Promise<void> = async () => {}; let disconnected: Promise<void> | null = null;

  async function boot(thread: WorldThread): Promise<void> {
    const channel = new MessageChannel();
    database.rpc.note("attach", [channel.port1], [channel.port1 as never]);
    const data: WorldThreadData = { role: "world", world: thread.input, authentication: advertised, database: channel.port2, shape: { entityPatches: database.storage.world.entityPatches === true, editStoredPlayer: typeof database.storage.world.editStoredPlayer === "function" },
      catalog: options.catalog, build: options.build, peerEncoding: options.peerEncoding ?? "bytes", reportMs };
    const worker = options.launch(data, [channel.port2], `corealm-world-${thread.input.worldId}`);
    const handlers = handlersFor(thread), rpc = createRpc(worker as unknown as Endpoint, handlers, (error, method) => log({ event: "thread.message_failed", level: "error", world: thread.input.worldId, method, message: error instanceof Error ? error.message : String(error) }));
    let gone = false;
    const stopped = (reason: string): void => {
      if (gone) return; gone = true; rpc.fail(reason);
      if (thread.worker === worker) crashed(thread, reason);
    };
    const opened = ready<WorldReady>(worker, { handlers }, `World ${thread.input.worldId}`);
    worker.on("error", error => stopped(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
    worker.on("exit", code => stopped(`exit ${code}`));
    const started = await opened;
    if (started.catalogRevision !== current.revision) {
      gone = true; void worker.terminate();
      throw new Error(`World ${thread.input.worldId} runs catalog ${started.catalogRevision}, not the server's ${current.revision}`);
    }
    thread.worker = worker; thread.rpc = rpc; thread.bootMs = started.bootMs; thread.buildMs = started.buildMs;
    thread.descriptor = { ...started.descriptor, ...configured(thread) };
    await rpc.call("configure", [configuredChange()]);
    thread.available = true;
  }
  /** The catalog and settings in force, which a world that starts late must be brought onto. */
  const current: { revision: string; capacity: Record<string, number> | null; description: string | null | undefined; endpoint: string | null; baseVersion: string | null | undefined } = { revision: options.catalogRevision, capacity: null, description: undefined, endpoint: null, baseVersion: undefined };
  const configuredChange = () => ({ ...(current.capacity ? { capacity: current.capacity } : {}), ...(current.description !== undefined ? { description: current.description } : {}), ...(current.endpoint !== null ? { endpoint: current.endpoint } : {}),
    ...(current.baseVersion !== undefined ? { baseVersion: current.baseVersion } : {}) });
  function configured(thread: WorldThread): Partial<WorldDescriptor> {
    const capacity = current.capacity?.[thread.input.worldId];
    return { ...(capacity !== undefined ? { capacity } : {}), ...(current.endpoint !== null ? { endpoint: current.endpoint } : {}), ...(current.description ? { description: current.description } : {}),
      ...(current.baseVersion ? { baseVersion: current.baseVersion } : {}) };
  }

  /** A world's thread ended while the server runs. The others keep going. */
  function crashed(thread: WorldThread, reason: string): void {
    thread.worker = null; thread.rpc = null;
    const wasAvailable = thread.available; thread.available = false;
    if (closing || closed) return;
    log({ event: "world.crashed", level: "error", world: thread.descriptor.worldId, message: reason, restarts: thread.restarts, peers: thread.peers.size });
    metrics.errors++;
    for (const peer of [...thread.peers.values()]) { sendFrame(peer.ws, metrics, JSON.stringify(UNAVAILABLE), Buffer.byteLength(JSON.stringify(UNAVAILABLE))); peer.ws.close(1011, "World unavailable"); }
    for (const [account, waiting] of [...saving]) if (thread.peers.has(waiting.peer) || !wasAvailable) settle(account);
    // A hold in progress cannot finish honestly without this world, and a catalog may be half way in. Stop, as a failed commit does.
    if (holding) { log({ event: "world.crashed_in_hold", level: "error", world: thread.descriptor.worldId }); failClosed(); return; }
    // The dead thread frees nothing. Its leases are the database's to free, exactly as the next start of this world would.
    void database.storage.world.openWorld(thread.descriptor).catch(error => log({ event: "world.lease_release_failed", level: "error", world: thread.descriptor.worldId, message: error instanceof Error ? error.message : String(error) }));
    if (options.restart !== false) restartLater(thread);
  }
  /** One second, then two, four and so on, until the world has failed too often to be worth starting again. */
  function restartLater(thread: WorldThread): void {
    const pause = thread.budget.failed(now());
    if (pause === null) {
      log({ event: "world.abandoned", level: "error", world: thread.descriptor.worldId, failures: thread.budget.failures, restarts: thread.restarts,
        windowMs: options.restartWindowMs ?? RESTART_WINDOW_MS,
        message: `World ${thread.descriptor.worldId} failed ${thread.budget.failures} times and is not being started again. It stays unavailable until this server restarts.` });
      return;
    }
    thread.restarts++;
    setTimeout(() => {
      if (closing || closed || thread.worker) return;
      boot(thread).then(() => thread.rpc?.call("start")).then(() => log({ event: "world.restarted", world: thread.descriptor.worldId, restarts: thread.restarts }),
        error => { log({ event: "world.restart_failed", level: "error", world: thread.descriptor.worldId, message: error instanceof Error ? error.message : String(error) }); restartLater(thread); });
    }, pause).unref();
  }

  // Worlds boot side by side: each has its own thread to build on.
  try { await Promise.all(threads.map(boot)); }
  catch (error) { closing = true; await Promise.all(threads.map(thread => thread.worker?.terminate())); throw error; }

  let holding = false; let holds: Promise<unknown> = Promise.resolve(); let barrier = 0;
  async function betweenTicks<T>(run: () => Promise<T>): Promise<T> {
    const next = holds.then(async () => {
      const id = ++barrier, held = live();
      holding = true;
      try {
        try { await Promise.all(held.map(thread => thread.rpc!.call("hold", [id], { timeoutMs: holdTimeoutMs }))); }
        catch (error) {
          if (closed) throw new HoldFailure("The server has stopped serving");
          throw new HoldFailure(error instanceof ThreadUnavailable ? error.message : `A world could not be held: ${error instanceof Error ? error.message : String(error)}`);
        }
        return await run();
      } finally {
        holding = false;
        for (const thread of held) thread.rpc?.note("resume", [id]);
      }
    });
    holds = next.catch(() => {});
    return next;
  }
  const each = <T>(method: string, args: unknown[] = []): Promise<T[]> => Promise.all(live().map(thread => thread.rpc!.call<T>(method, args)));
  const edits = new Map<number, { thread: WorldThread; pending: number }>(); let editSerial = 0;

  const control: HostControl = {
    get closed() { return closed || closing; },
    metrics, events: lobby.events, record: lobby.record,
    status: (): WorldStatus[] => threads.map(thread => ({ key: { providerId: thread.descriptor.providerId, worldId: thread.descriptor.worldId }, descriptor: thread.descriptor,
      population: thread.available ? thread.report?.population ?? 0 : 0, capacity: thread.report?.capacity ?? thread.descriptor.capacity, tick: thread.report?.tick ?? 0,
      peers: thread.peers.size, available: thread.available && !closed })),
    connected: accountId => (joined.get(accountId)?.size ?? 0) > 0,
    betweenTicks,
    broadcast: async message => (await each<number>("broadcast", [message])).reduce((sum, told) => sum + told, 0),
    disconnectAccount: async (accountId: string, code: SessionErrorCode, message: string) => (await each<boolean>("disconnectAccount", [accountId, code, message])).some(Boolean),
    failClosed,
    async configure(change) {
      if (change.capacity) current.capacity = { ...change.capacity };
      if (change.description !== undefined) current.description = change.description;
      if (change.endpoint !== undefined) current.endpoint = change.endpoint;
      if (change.baseVersion !== undefined) current.baseVersion = change.baseVersion;
      for (const thread of threads) {
        const next = { ...thread.descriptor, ...configured(thread) };
        if (change.description !== undefined && !change.description) delete next.description;
        if (change.baseVersion !== undefined && !change.baseVersion) delete next.baseVersion;
        thread.descriptor = next;
      }
      await each("configure", [change]);
    },
    async liveCharacter(accountId) {
      for (const found of await each<LiveCharacter | null>("liveCharacter", [accountId])) if (found) return found;
      return null;
    },
    async editLive(accountId, patch, by) {
      for (const thread of live()) {
        const edit = await thread.rpc!.call<LiveEdit | null>("editLive", [accountId, patch, by]); if (!edit) continue;
        if (edit.pending === null) return edit;
        const id = ++editSerial; edits.set(id, { thread, pending: edit.pending });
        return { ...edit, pending: id };
      }
      return null;
    },
    editSaved(pending) {
      const edit = edits.get(pending); edits.delete(pending);
      if (!edit?.thread.rpc) return Promise.reject(new EditFailure(503, "unavailable", "The world that held this player stopped before the edit was saved"));
      return edit.thread.rpc.call<void>("editSaved", [edit.pending]).catch(error => { throw error instanceof ThreadUnavailable ? new EditFailure(503, "unavailable", "The world that held this player stopped before the edit was saved") : error; });
    },
    async planStoredEdit(lastWorld, character, ops): Promise<EditResult> {
      const thread = lastWorld ? live().find(candidate => candidate.key === worldKey(lastWorld)) : undefined;
      // Only that world's thread has its navigation mesh. With no such world here, nothing can be placed, which the ops say themselves.
      if (thread) return thread.rpc!.call<EditResult>("planStoredEdit", [lastWorld, character, ops]);
      return applyPlayerOps(character, ops, { world: null, snap: () => null });
    },
    adoptStored: async (accountId: string, character: PlayerCharacter) => { await each("adoptStored", [accountId, character]); },
    publishStage: async (catalog: InstalledCatalog) => { staged = catalog; await each("publishStage", [catalog]); },
    async publishCheck(removedItems, spawnGroupIds) {
      const checks = await each<PublishCheck>("publishCheck", [removedItems, spawnGroupIds]);
      return { worlds: checks.flatMap(check => check.worlds), unplaceable: checks.find(check => check.unplaceable)?.unplaceable ?? null, planMs: Math.max(0, ...checks.map(check => check.planMs)) };
    },
    async publishCommit() {
      if (!staged) throw new Error("No catalog was staged for this publish");
      const catalog = staged; staged = null;
      const spawns = (await each<SpawnCounts[]>("publishCommit")).flat();
      // The main thread compiles the next publish against the running tables, so it moves too. It hosts no world.
      swapCatalog(catalog, []);
      current.revision = catalog.revision;
      for (const thread of threads) thread.descriptor = { ...thread.descriptor, catalogRevision: catalog.revision };
      return spawns;
    },
    async publishAbort() { staged = null; await each("publishAbort").catch(() => {}); },
  };
  let staged: InstalledCatalog | null = null;

  let refreshing: Promise<void> | null = null;
  const refresh = (): Promise<void> => refreshing ??= Promise.all(live().map(async thread => absorb(thread, await thread.rpc!.call<WorldReport>("report", [], { timeoutMs: 2000 })))).then(() => {}, () => {}).finally(() => { refreshing = null; });

  function accept(ws: WebSocket, request: IncomingMessage): void {
    const link = new WebSocketLink(ws, metrics, request.headers.origin, options.allowedOrigins ? [...options.allowedOrigins] : undefined);
    let routed: Routed | null = null; let lobbyPeer: ReturnType<typeof lobby.connect> = null; let decided = false;
    if (closed || closing) { lobby.connect(link); return; }
    let deadline: ReturnType<typeof setTimeout> | null = setTimeout(() => ws.close(4001, "Authentication timeout"), 5000);
    ws.on("error", () => { metrics.errors++; });
    ws.on("pong", () => { link.lastSeen = Date.now(); });
    ws.on("message", (bytes, binary) => {
      link.lastSeen = Date.now();
      if (routed) { if (binary) routed.thread.rpc?.note("peer.binary", [routed.id]); else routed.thread.rpc?.note("peer.message", [routed.id, bytes.toString()]); return; }
      if (!decided) {
        decided = true;
        // Only the first message decides. A join that names a running world of this server goes to that world's thread, whole and unparsed.
        let text: string | null = null, thread: WorldThread | undefined;
        if (!binary) try {
          text = bytes.toString(); const message: unknown = JSON.parse(text);
          if (record(message) && message.type === "join" && typeof message.providerId === "string" && typeof message.worldId === "string")
            thread = live().find(candidate => candidate.key === worldKey({ providerId: message.providerId as string, worldId: message.worldId as string }));
        } catch { /* The lobby answers what does not parse. */ }
        if (thread && text !== null && !closed) {
          routed = { id: ++serial, ws, link, thread, account: null, deadline }; deadline = null;
          thread.peers.set(routed.id, routed);
          thread.rpc!.note("peer.open", [routed.id, link.originAllowed]); thread.rpc!.note("peer.message", [routed.id, text]);
          return;
        }
        lobbyPeer = lobby.connect(link);
      }
      if (!lobbyPeer) return;
      if (binary) { lobbyPeer.refuse(new SessionFailure("INVALID_MESSAGE", "Text messages required")); return; }
      let message: unknown;
      try { message = JSON.parse(bytes.toString()); } catch (error) { lobbyPeer.refuse(error); return; }
      void lobbyPeer.accept(message);
    });
    ws.on("close", () => {
      if (deadline) clearTimeout(deadline);
      lobbyPeer?.closed();
      if (!routed) return;
      if (routed.deadline) clearTimeout(routed.deadline);
      const { thread, account, id } = routed;
      thread.peers.delete(id);
      if (account !== null) {
        const sessions = joined.get(account); sessions?.delete(routed); if (sessions && !sessions.size) joined.delete(account);
        // Until the world says otherwise, the account's character may be waiting for a saving commit there.
        if (thread.rpc) {
          settle(account);
          let resolve!: () => void; const done = new Promise<void>(settled => { resolve = settled; });
          saving.set(account, { done, resolve, peer: id });
          setTimeout(() => settle(account, id), RELEASE_WAIT_MS).unref();
        }
      }
      thread.rpc?.note("peer.closed", [id]);
    });
  }

  return {
    control, accept, refresh,
    async start(endpoint) { if (endpoint !== null) await control.configure({ endpoint }); await each("start"); },
    async diagnostics() {
      await refresh();
      return { mode: options.mode ?? "auto", database: await database.stats(), worlds: threads.map(thread => ({ worldId: thread.descriptor.worldId, available: thread.available, restarts: thread.restarts,
        failures: thread.budget.failures, abandoned: thread.budget.abandoned, bootMs: thread.bootMs, buildMs: thread.buildMs,
        ticks: [...thread.ticks], stages: { ...thread.stages }, heapUsedBytes: thread.report?.heapUsedBytes ?? 0, utilization: thread.report?.utilization ?? 0, cpuMs: thread.cpuMs })) };
    },
    clearTicks() { metrics.ticks.length = 0; for (const thread of threads) { thread.ticks.length = 0; thread.cpuMs = thread.cpuMs === null ? null : 0; thread.stages = { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }; } },
    dropSilent() { for (const thread of threads) for (const peer of thread.peers.values()) if (peer.account !== null && peer.link.silent) peer.ws.terminate(); },
    async close(disconnectPeers) {
      closing = true; disconnect = disconnectPeers;
      // Each world stops its loop, waits for its tick, asks for the sockets to go, then saves every held character and frees its account.
      await Promise.all(threads.map(async thread => {
        if (!thread.rpc) return;
        try { await thread.rpc.call("close", [], { timeoutMs: 30_000 }); }
        catch (error) { log({ event: "world.close_failed", level: "error", world: thread.descriptor.worldId, message: error instanceof Error ? error.message : String(error) }); }
      }));
      await (disconnected ??= disconnect());
      await lobby.close(async () => {});
      await Promise.all(threads.map(thread => thread.worker?.terminate()));
    },
  };
}
