import type { CommandEnvelope, CommandOutcome, PlayerLeaseWrite, SessionErrorCode, WorldDescriptor, WorldStorage, WorldStorageRecord } from "../contracts.js";
import type { AdminActor, AuditWrite } from "./adminStorage.js";
import { Admission } from "./admission.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "./headlessWorld.js";
import { compatible, descriptor, envelope, MAX_PENDING_COMMANDS, RECEIPT_LIMIT, record, SessionFailure, worldKey } from "./protocol.js";
import { Replicator, ReplicationFrame } from "./replication.js";
import { WORLD_PROTOCOL_VERSION } from "../contracts.js";

/**
 * The host core: hosted worlds, peers, the join, command intake, the tick loop and the final commit,
 * with no transport in it. A peer is a `PeerLink` that carries message objects, so the same code
 * serves WebSocket peers under `referenceServer.ts` and a MessagePort peer inside a Web Worker.
 *
 * This module's import graph is browser-safe: no `node:*`, no `ws`, no `Buffer`, no `process`.
 * `tests/world-host-import-graph.test.ts` holds it to that.
 */

export interface AuthenticatedPlayer { playerId: string; name: string }
export interface AuthenticationAdapter {
  /** What descriptors tell clients to present. Absent means the adapter takes an opaque token, advertised as "guest". */
  readonly authentication?: "account" | "guest";
  authenticate(token: string, world: WorldDescriptor): Promise<AuthenticatedPlayer>;
}

/**
 * What the core needs from a transport. It carries values, not bytes: a socket link serialises them,
 * a MessagePort link posts them. Size limits, backlog accounting, byte metrics and liveness belong to
 * the link, because only the transport knows what they mean. A link with no notion of a dead peer,
 * such as a MessagePort, simply stays `open` until it is closed.
 */
export interface PeerLink {
  /** False once the peer can no longer be sent to. The core stops a join that finds it false. */
  readonly open: boolean;
  /** Deliver one protocol message. False when it was not sent, whatever the reason. */
  send(value: unknown): boolean;
  /** End the connection. The transport reports it back through `PeerConnection.closed()`. */
  close(code: number, reason: string): void;
  /** The transport's own say in a join, checked once the join message is well formed. Throws a `SessionFailure` to refuse, as a disallowed Origin does. */
  admit?(): void;
}
/** One connected link, joined or not. The transport feeds it parsed messages and tells it when the link is gone. */
export interface PeerConnection {
  /** True once this link has joined a world. */
  readonly joined: boolean;
  /** Handle one parsed message. A bad one answers with an error and closes the link; this never rejects. */
  accept(message: unknown): Promise<void>;
  /** Refuse the link for something the transport found, such as a frame that did not parse, exactly as the core refuses a bad message. */
  refuse(error: unknown): void;
  /** The link is gone. A joined player's character is saved by the next commit, which frees or reserves the account. */
  closed(): void;
}

/** One entry of the bounded ring `GET /admin/stats` returns and the TUI draws. */
export interface ServerEvent { at: number; kind: "join" | "leave" | "rejected" | "ban" | "unban" | "kick" | "admin-session" | "owner-setup"; accountId: string | null; detail: string | null }
const EVENT_RING = 256;

export interface Peer<L extends PeerLink = PeerLink> {
  link: L; playerId: string; sessionId: string; replicator: Replicator;
  sequence: number; committed: number; queue: CommandEnvelope[]; receipts: Map<number, { json: string; outcome: CommandOutcome }>;
  rateStart: number; rateCount: number; explicitLeave: boolean;
}
/** Everything one world keeps in memory. Nothing in it refers to a sibling world. */
export interface HostedWorld<L extends PeerLink = PeerLink> {
  runtime: HeadlessWorld; admission: Admission; peers: Map<string, Peer<L>>; receipts: WorldStorageRecord["receipts"]; publicGameplay: Map<string,string>;
  /** Accounts whose character this world writes, and what the next commit does with each lease. */
  leases: Map<string, PlayerLeaseWrite>;
  /** Audit rows that must be written with the character they describe. The next commit writes each and settles it. */
  audits: PendingAudit[];
}
/**
 * What became of an audit row: written with its character, dropped because the account's lease was
 * fenced and the character was not written, or lost because storage failed or the host closed first.
 */
export type AuditOutcome = "saved" | "fenced" | "failed";
export interface PendingAudit { accountId: string; by: AdminActor; entry: AuditWrite; settle(outcome: AuditOutcome): void }
export interface WorldHostMetrics {
  ticks: number[]; stages: { simulationMs: number; snapshotMs: number; commitMs: number; replicationMs: number; samples: number };
  commands: number; rejected: number;
  /** Counted by the transport, which is the only place a message has a size. */
  bytesOut: number;
  backlogDisconnects: number; errors: number;
}
export interface HostPace { paused: boolean; timeScale: number }
/** The most ticks one timer turn runs back to back when the loop is scaled up, so a slow tick cannot starve the transport. */
const MAX_TICK_BURST = 32;
const THOROUGH_SNAPSHOT_TICKS = 10;
/** How the tick loop waits. The default is the global timers, which is what a worker and the server want. */
export interface HostTimers { set(run: () => void, delayMs: number): unknown; clear(handle: unknown): void }

export interface WorldHostOptions {
  worlds: WorldDescriptor[];
  storage: WorldStorage;
  build(world: WorldDescriptor): Promise<HeadlessWorldPorts>;
  authentication: AuthenticationAdapter;
  /** The catalog this process runs, stamped on every descriptor. Absent leaves each descriptor's own. A publish moves it through `contentSwap.ts`. */
  catalogRevision?: string;
  /** Runs after authentication and before the player lease is claimed. Throw a SessionFailure to refuse the join. Bans live here. */
  beforeAdmission?(player: AuthenticatedPlayer, world: WorldDescriptor): Promise<void>;
  /** Wall clock in milliseconds, for the events ring. */
  now?(): number;
  /** One JSON object per session event. Absent logs nothing. */
  log?(event: Record<string, unknown>): void;
  timers?: HostTimers;
  /**
   * Compare the whole entity table with storage once a second instead of every tick, and only what is near a player in
   * between (`HeadlessWorld.snapshot`). For local play, whose world is one player's. The final commit is always thorough.
   */
  sparseSnapshots?: boolean;
}

export interface WorldHost<L extends PeerLink = PeerLink> {
  /** Live objects keyed by `worldKey`. Capacity and description are changed on them directly. */
  readonly worlds: ReadonlyMap<string, HostedWorld<L>>;
  readonly metrics: WorldHostMetrics;
  readonly events: readonly ServerEvent[];
  /** True once the host stopped serving: closed, or failed closed. */
  readonly closed: boolean;
  /** Add to the events ring. Joins, leaves and refusals are also logged. */
  record(event: Omit<ServerEvent, "at">): void;
  /** Take a new link. Null when the host no longer serves: the link was told so and closed. */
  connect(link: L): PeerConnection | null;
  /** Start the self-scheduling tick loop. A host that is stepped by hand never calls it. */
  start(): void;
  /** Run one tick now, after any hold, as the loop would. For tests and hosts that own time. */
  step(): Promise<void>;
  /** Runs `run` once no tick is in flight, and starts no tick until it settles. */
  betweenTicks<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Replicate without simulating: every joined peer gets an update of its world as it stands now. For
   * a host that changed state between ticks, whose loop may be paused. `full` sends whole snapshots.
   */
  publish(full?: boolean): void;
  /**
   * How the loop keeps time. Ticks stay 100 ms of simulation each; `timeScale` changes how often one
   * runs, and `paused` stops the loop running any. `step()` still runs one. Only local play's debug
   * channel calls this. A server never does, and at scale 1 the loop is exactly the one it always ran.
   */
  readonly pace: Readonly<HostPace>;
  setPace(pace: Partial<HostPace>): void;
  /** Stop serving, as a failed commit does: no further acknowledgements or snapshots. */
  failClosed(): void;
  /** Tell every joined peer in every world. Returns how many were told. */
  broadcast(message: unknown): number;
  /** Refuse a live session from every world, through the ordinary leave path: save, then release. */
  disconnectAccount(accountId: string, code: SessionErrorCode, message: string): boolean;
  /** The world that writes this account's character: connected, or disconnected and not yet saved. */
  holder(accountId: string): HostedWorld<L> | null;
  connected(accountId: string): boolean;
  /**
   * Stop the loop, wait for the tick in flight, let the transport drop its peers, then save every held
   * character and free its account. Storage stays open: it belongs to whoever opened it.
   */
  close(disconnectPeers?: () => Promise<void>): Promise<void>;
}

const GLOBAL_TIMERS: HostTimers = { set: (run, delayMs) => setTimeout(run, delayMs), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export async function createWorldHost<L extends PeerLink = PeerLink>(options: WorldHostOptions): Promise<WorldHost<L>> {
  const now = options.now ?? Date.now, timers = options.timers ?? GLOBAL_TIMERS, storage = options.storage;
  const worlds = new Map<string, HostedWorld<L>>();
  for (const input of options.worlds) {
    const world = descriptor({ ...input, ...(options.catalogRevision === undefined ? {} : { catalogRevision: options.catalogRevision }),
      authentication: input.authentication ?? options.authentication.authentication ?? "guest" }); compatible(world);
    if (worlds.has(worldKey(world))) throw new Error("Duplicate hosted world");
    const saved = await storage.openWorld(world);
    worlds.set(worldKey(world), { runtime: new HeadlessWorld(world, await options.build(world), saved), admission: new Admission(world.capacity), peers: new Map(),
      receipts: Object.assign(Object.create(null), saved?.receipts ?? {}), publicGameplay: new Map(), leases: new Map(), audits: [] });
  }
  // Establish the complete entity baseline before accepting clients. Subsequent ticks only
  // clone and persist changed rows. Failure here never advertises a ready world.
  if (storage.entityPatches) for (const hosted of worlds.values()) {
    const initial = hosted.runtime.snapshot(hosted.receipts, true);
    await storage.commit(initial);
    hosted.runtime.committed(initial);
  }
  const metrics: WorldHostMetrics = { ticks: [], stages: { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }, commands: 0, rejected: 0, bytesOut: 0, backlogDisconnects: 0, errors: 0 };
  const events: ServerEvent[] = [];
  const recordEvent = (event: Omit<ServerEvent, "at">): void => {
    events.push({ at: now(), ...event }); if (events.length > EVENT_RING) events.shift();
    // Who came, who left and who was turned away is the operator's log. The admin API logs its own writes.
    if (event.kind === "join" || event.kind === "leave" || event.kind === "rejected") options.log?.({ event: `session.${event.kind}`, accountId: event.accountId, detail: event.detail });
  };
  /** Every link the transport handed over and has not reported gone, joined or not. */
  const links = new Set<L>();
  let closed = false; let failed = false; let ticking = false; let inFlight: Promise<void> = Promise.resolve();
  // A closed connection saves and frees its account on the next commit. A join by that account waits for it here.
  const releasing = new Map<string, { done: Promise<void>; resolve(): void }>();
  function released(playerId: string): void { releasing.get(playerId)?.resolve(); releasing.delete(playerId); }
  /** Remove a session whose lease this world no longer holds. Its character is never written again. */
  function evict(hosted: HostedWorld<L>, playerId: string, sessionId: string): void {
    if (hosted.leases.get(playerId)?.sessionId !== sessionId) return;
    hosted.leases.delete(playerId); hosted.runtime.leave(playerId); hosted.admission.leave(playerId, sessionId, false); released(playerId);
    const stale = hosted.peers.get(sessionId); if (!stale) return;
    stale.link.send({ type: "error", error: { code: "SESSION_EXPIRED", message: "This player joined from another connection" } }); stale.link.close(4000, "SESSION_EXPIRED");
  }
  function disconnectAccount(accountId: string, code: SessionErrorCode, message: string): boolean {
    let found = false;
    for (const hosted of worlds.values()) for (const peer of [...hosted.peers.values()]) {
      if (peer.playerId !== accountId) continue;
      peer.explicitLeave = true; found = true;
      peer.link.send({ type: "error", error: { code, message } }); peer.link.close(4000, code);
    }
    return found;
  }
  function holder(accountId: string): HostedWorld<L> | null {
    for (const hosted of worlds.values()) if (hosted.leases.has(accountId) && hosted.runtime.players.has(accountId)) return hosted;
    return null;
  }
  /** Hand the pending audit rows to a commit, and tell each what became of it. */
  function auditsOf(hosted: HostedWorld<L>): { rows: PendingAudit[]; settle(fenced: readonly string[] | null): void } {
    const rows = hosted.audits.splice(0);
    return { rows, settle(fenced) { for (const row of rows) row.settle(!fenced ? "failed" : fenced.includes(row.accountId) ? "fenced" : "saved"); } };
  }
  function failClosed(): void {
    closed = true; failed = true;
    for (const hosted of worlds.values()) auditsOf(hosted).settle(null);
    for (const waiting of [...releasing.keys()]) released(waiting);
    for (const link of links) { link.send({ type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } }); link.close(1011, "World unavailable"); }
  }
  /** A publish swaps content between ticks: the tick in flight finishes, and the next one waits for `run` to settle. */
  let hold: Promise<void> | null = null; let running: Promise<void> = Promise.resolve();
  async function betweenTicks<T>(run: () => Promise<T>): Promise<T> {
    while (hold) await hold;
    let release!: () => void; hold = new Promise<void>(settle => { release = settle; });
    // `running` is the last tick that actually started. `inFlight` may be a tick that is itself waiting on this hold.
    try { await running; return await run(); } finally { hold = null; release(); }
  }

  function connect(link: L): PeerConnection | null {
    if (closed) {
      link.send({ type: "error", error: { code: "UNAVAILABLE", message: "World unavailable" } });
      link.close(1011, "World unavailable"); return null;
    }
    links.add(link);
    let peer: Peer<L> | null = null; let hosted: HostedWorld<L> | null = null; let authenticating = false;
    function refuse(error: unknown): void {
      metrics.rejected++;
      const failure = error instanceof SessionFailure ? error : new SessionFailure("INVALID_MESSAGE", "Invalid request");
      if (!peer) recordEvent({ kind: "rejected", accountId: null, detail: failure.code });
      link.send({ type: "error", error: { code: failure.code, message: failure.message } }); link.close(4000, failure.code);
    }
    async function receive(message: unknown): Promise<void> {
      if (!record(message)) throw new SessionFailure("INVALID_MESSAGE", "Invalid message");
      if (!peer) {
        if (authenticating) throw new SessionFailure("RATE_LIMITED", "Authentication already in progress");
        authenticating = true;
        if (message.type !== "join" || typeof message.providerId !== "string" || typeof message.worldId !== "string"
          || typeof message.token !== "string" || message.token.length > 4096) throw new SessionFailure("UNAUTHORIZED", "Authentication required");
        if (message.protocolVersion !== WORLD_PROTOCOL_VERSION) throw new SessionFailure("INCOMPATIBLE", "Incompatible game version");
        link.admit?.();
        hosted = worlds.get(worldKey({ providerId: message.providerId, worldId: message.worldId })) ?? null;
        if (!hosted) throw new SessionFailure("UNAVAILABLE", "World is unavailable");
        const identity = await options.authentication.authenticate(message.token, hosted.runtime.descriptor);
        if (typeof identity?.playerId!=="string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.playerId) || typeof identity.name!=="string") throw new SessionFailure("UNAUTHORIZED", "Invalid authenticated identity");
        const name = identity.name.slice(0,64);
        await options.beforeAdmission?.({ playerId: identity.playerId, name }, hosted.runtime.descriptor);
        hosted.admission.check(identity.playerId);
        await releasing.get(identity.playerId)?.done;
        if (!link.open) return;
        if (closed) throw new SessionFailure("UNAVAILABLE", "World unavailable");
        // The lease is the server-wide login: one live session per account across every world.
        const sessionId = crypto.randomUUID();
        const claim = await storage.claimPlayer(hosted.runtime.descriptor, identity.playerId, sessionId, name);
        if (!claim) throw new SessionFailure("DUPLICATE_LOGIN", "This player is already connected");
        let admitted = false;
        try {
          await inFlight;
          if (!link.open) { await storage.releasePlayer(hosted.runtime.descriptor, identity.playerId, sessionId); return; }
          if (closed) throw new SessionFailure("UNAVAILABLE", "World unavailable");
          hosted.admission.join(identity.playerId, sessionId); admitted = true;
          // The claim proves any other session of this account lost its lease, and a place held elsewhere is moot.
          for (const other of worlds.values()) {
            const stale = other.leases.get(identity.playerId); if (stale) evict(other, identity.playerId, stale.sessionId);
            if (other !== hosted) other.admission.forget(identity.playerId);
          }
          hosted.leases.set(identity.playerId, { sessionId, action: "hold" });
          if (claim.world) hosted.receipts[identity.playerId] = claim.world.receipts;
          const player = hosted.runtime.join(identity.playerId, claim); player.store.get().player.name = name;
          peer = { link, playerId: identity.playerId, sessionId, replicator: new Replicator(sessionId, identity.playerId), sequence: 0, committed: 0,
            queue: [], receipts: new Map(), rateStart: Date.now(), rateCount: 0, explicitLeave: false };
          hosted.peers.set(sessionId, peer);
          link.send({ type: "joined", sessionId, playerId: identity.playerId, world: hosted.runtime.descriptor,
            nextOperation: (hosted.receipts[identity.playerId]?.at(-1)?.operation ?? 0) + 1 });
          recordEvent({ kind: "join", accountId: identity.playerId, detail: hosted.runtime.descriptor.worldId });
          link.send({ type: "update", update: peer.replicator.update(hosted.runtime, 0, new Map(), true) });
        } catch (error) {
          if (admitted) { hosted.admission.leave(identity.playerId, sessionId, false); hosted.runtime.leave(identity.playerId); }
          if (hosted.leases.get(identity.playerId)?.sessionId === sessionId) hosted.leases.delete(identity.playerId);
          await storage.releasePlayer(hosted.runtime.descriptor, identity.playerId, sessionId).catch(() => {});
          throw error;
        }
        return;
      }
      if (Date.now() - peer.rateStart >= 1000) { peer.rateStart = Date.now(); peer.rateCount = 0; }
      if (++peer.rateCount > 40) throw new SessionFailure("RATE_LIMITED", "Input rate exceeded");
      if (message.type === "leave") { peer.explicitLeave = true; link.close(1000, "Left world"); return; }
      if (message.type === "snapshot") {
        await inFlight;
        if (!closed && link.open) link.send({ type: "update", update: peer.replicator.update(hosted!.runtime, peer.committed, new Map(), true) });
        return;
      }
      if (message.type !== "command") throw new SessionFailure("INVALID_MESSAGE", "Unknown message type");
      const input = envelope(message.envelope);
      if (input.sessionId !== peer.sessionId) throw new SessionFailure("SESSION_EXPIRED", "Stale session");
      const receipt = peer.receipts.get(input.sequence);
      if (receipt) {
        if (receipt.json !== JSON.stringify(input.command)) throw new SessionFailure("INVALID_MESSAGE", "Sequence reused with a different command");
        if (input.sequence <= peer.committed) link.send({ type: "ack", outcome: receipt.outcome });
        return;
      }
      const queued = peer.queue.find((command) => command.sequence === input.sequence);
      if (queued) {
        if (JSON.stringify(queued.command) !== JSON.stringify(input.command)) throw new SessionFailure("INVALID_MESSAGE", "Sequence reused with a different command");
        return;
      }
      if (input.sequence !== peer.sequence + peer.queue.length + 1) throw new SessionFailure("OUT_OF_ORDER", "Command sequence gap or expired receipt");
      if (peer.queue.length >= MAX_PENDING_COMMANDS) throw new SessionFailure("BACKLOG", "Command queue exceeded");
      peer.queue.push(input);
    }
    return {
      get joined() { return peer !== null; },
      async accept(message) { try { await receive(message); } catch (error) { refuse(error); } },
      refuse,
      closed() {
        links.delete(link);
        if (!peer || !hosted) return;
        hosted.peers.delete(peer.sessionId);
        const lease = hosted.leases.get(peer.playerId);
        if (lease?.sessionId !== peer.sessionId) return;
        hosted.runtime.leave(peer.playerId);
        // The next commit saves the character, then frees the account or keeps it for the reconnect window.
        lease.action = peer.explicitLeave ? "release" : "reserve";
        recordEvent({ kind: "leave", accountId: peer.playerId, detail: hosted.runtime.descriptor.worldId });
        let resolve!: () => void; const done = new Promise<void>(settle => { resolve = settle; });
        releasing.set(peer.playerId, { done, resolve });
        hosted.admission.leave(peer.playerId, peer.sessionId, !peer.explicitLeave);
      },
    };
  }

  /** One update to every open peer of a world. `committed` is the character state the tick just saved, when a tick is what asks. */
  function replicate(hosted: HostedWorld<L>, full: boolean, committed?: WorldStorageRecord["players"]): void {
    const cache = new ReplicationFrame(hosted.runtime,hosted.publicGameplay); const entityCache = new Map();
    for (const peer of hosted.peers.values()) {
      // A link its transport has declared dead gets no update. The transport is already closing it.
      if (!peer.link.open) continue;
      try { peer.link.send({ type: "update", update: peer.replicator.update(hosted.runtime, peer.committed, cache, full, entityCache, committed?.[peer.playerId]) }); }
      catch { metrics.backlogDisconnects++; peer.link.send({ type: "error", error: { code: "BACKLOG", message: "Client interest exceeds replication limit" } }); peer.link.close(4008, "BACKLOG"); }
    }
  }
  let committing: ReturnType<typeof auditsOf> | null = null;
  /** One world's tick: commands, simulation, snapshot, commit, acknowledgements, replication. It reads no sibling world. */
  async function tickWorld(hosted: HostedWorld<L>): Promise<void> {
    const pending: { peer: Peer<L>; outcome: CommandOutcome }[] = [];
    for (const peer of hosted.peers.values()) {
      for (const input of peer.queue.splice(0)) {
        const ledger = hosted.receipts[peer.playerId] ??= [];
        const prior = ledger.find((receipt) => receipt.operation === input.operation);
        const json = JSON.stringify(input.command);
        const latestOperation = ledger.at(-1)?.operation ?? 0;
        const result = prior ? prior.command === json
          ? prior.outcome.status === "accepted" ? { ok: true as const, value: prior.outcome.result }
            : { ok: false as const, error: prior.outcome.error }
          : { ok: false as const, error: { code: "INVALID_MESSAGE", message: "Operation reused with a different command" } }
          : input.operation !== latestOperation + 1
            ? { ok: false as const, error: { code: "OUT_OF_ORDER", message: "Operation is expired or out of order" } }
            : hosted.runtime.execute(peer.playerId, input.command);
        const outcome: CommandOutcome = result.ok ? { status: "accepted", sequence: input.sequence, tick: hosted.runtime.clock.tick, result: result.value }
          : { status: "rejected", sequence: input.sequence, tick: hosted.runtime.clock.tick, error: result.error };
        peer.sequence = input.sequence; peer.receipts.set(input.sequence, { json: JSON.stringify(input.command), outcome });
        if (!prior && input.operation === latestOperation + 1) {
          ledger.push({ operation: input.operation, command: json, sequence: input.sequence, outcome });
          if (ledger.length > RECEIPT_LIMIT) ledger.shift();
        }
        if (peer.receipts.size > RECEIPT_LIMIT) peer.receipts.delete(peer.receipts.keys().next().value!);
        pending.push({ peer, outcome }); metrics.commands++;
      }
    }
    const simulationStart = performance.now(); hosted.runtime.tick();
    const snapshotStart = performance.now();
    const snapshot = hosted.runtime.snapshot(hosted.receipts, storage.entityPatches === true, !options.sparseSnapshots || hosted.runtime.clock.tick % THOROUGH_SNAPSHOT_TICKS === 0);
    const written = [...hosted.leases].map(([id, lease]) => [id, { ...lease }] as const);
    snapshot.leases = Object.assign(Object.create(null), Object.fromEntries(written));
    const edits = auditsOf(hosted); committing = edits;
    if (edits.rows.length) snapshot.audits = edits.rows.map(({ accountId, by, entry }) => ({ accountId, by, entry }));
    const commitStart = performance.now(); const { fenced } = await storage.commit(snapshot);
    committing = null; edits.settle(fenced);
    hosted.runtime.committed(snapshot);
    for (const [id, lease] of written) {
      if (fenced.includes(id)) evict(hosted, id, lease.sessionId);
      else if (lease.action !== "hold" && hosted.leases.get(id)?.sessionId === lease.sessionId) { hosted.leases.delete(id); released(id); }
    }
    const replicationStart = performance.now();
    for (const { peer, outcome } of pending) { peer.committed = outcome.sequence; peer.link.send({ type: "ack", outcome }); }
    replicate(hosted, false, snapshot.players);
    metrics.stages.simulationMs += snapshotStart-simulationStart; metrics.stages.snapshotMs += commitStart-snapshotStart;
    metrics.stages.commitMs += replicationStart-commitStart; metrics.stages.replicationMs += performance.now()-replicationStart; metrics.stages.samples++;
    for(const id of hosted.runtime.evictInactive(id=>hosted.leases.has(id)))delete hosted.receipts[id];
  }
  async function tick(): Promise<void> {
    if (closed || ticking) return; ticking = true; const start = performance.now();
    try {
      for (const hosted of worlds.values()) await tickWorld(hosted);
    } catch {
      metrics.errors++;
      // No further acknowledgements or snapshots after a failed commit. Fail closed.
      committing?.settle(null); committing = null;
      failClosed();
    } finally {
      metrics.ticks.push(performance.now() - start); if (metrics.ticks.length > 36_000) metrics.ticks.shift(); ticking = false;
    }
  }
  /** A tick that waits out a hold first. `inFlight` is what joins and snapshots wait for. */
  // Turns run one after another, so a `step()` asked for while the loop's tick is in flight still runs its own tick.
  const turn = async (): Promise<void> => { while (hold) await hold; await (running = running.then(tick)); };
  let timer: unknown;
  const pace: HostPace = { paused: false, timeScale: 1 };
  let lastTurnAt = performance.now();
  const scheduleTick = (delay = 100): void => {
    timer = timers.set(() => {
      const started = performance.now(), since = started - lastTurnAt; lastTurnAt = started;
      if (pace.paused) { if (!closed) scheduleTick(100); return; }
      // Scaled up, a turn runs as many ticks as the time since the last one is worth, because a timer cannot fire every millisecond.
      const due = pace.timeScale > 1 ? Math.max(1, Math.min(MAX_TICK_BURST, Math.round(since * pace.timeScale / 100))) : 1;
      inFlight = (async () => { for (let ran = 0; ran < due && !closed && !(ran && pace.paused); ran++) await turn(); })().finally(() => {
        // An overloaded simulation must yield to transport work between ticks.
        if (!closed) scheduleTick(Math.max(pace.timeScale > 1 ? 1 : 5, 100 / pace.timeScale - (performance.now() - started)));
      });
    }, delay);
  };

  return { worlds, metrics, events, get closed() { return closed; }, record: recordEvent, connect, betweenTicks, failClosed, disconnectAccount, holder,
    start() { lastTurnAt = performance.now(); scheduleTick(); },
    step() { return inFlight = turn(); },
    publish(full = false) { if (!closed) for (const hosted of worlds.values()) replicate(hosted, full); },
    pace,
    setPace(next) {
      if (next.paused !== undefined) pace.paused = next.paused;
      if (next.timeScale !== undefined && Number.isFinite(next.timeScale) && next.timeScale > 0) pace.timeScale = next.timeScale;
    },
    broadcast(message) {
      let told = 0;
      for (const hosted of worlds.values()) for (const peer of hosted.peers.values()) if (peer.link.send(message)) told++;
      return told;
    },
    connected: accountId => [...worlds.values()].some(hosted => [...hosted.peers.values()].some(peer => peer.playerId === accountId)),
    async close(disconnectPeers) {
      closed = true; timers.clear(timer);
      await inFlight;
      if (disconnectPeers) await disconnectPeers(); else for (const link of [...links]) link.close(1001, "World closed");
      // Save every held character and free its account, unless storage already failed closed.
      if (!failed) for (const hosted of worlds.values()) if (hosted.leases.size) {
        const snapshot = hosted.runtime.snapshot(hosted.receipts, storage.entityPatches === true);
        snapshot.leases = Object.assign(Object.create(null), Object.fromEntries([...hosted.leases].map(([id, lease]) => [id, { sessionId: lease.sessionId, action: "release" as const }])));
        const edits = auditsOf(hosted);
        if (edits.rows.length) snapshot.audits = edits.rows.map(({ accountId, by, entry }) => ({ accountId, by, entry }));
        await storage.commit(snapshot).then(({ fenced }) => edits.settle(fenced), () => { metrics.errors++; edits.settle(null); });
      }
      for (const hosted of worlds.values()) auditsOf(hosted).settle(null);
      for (const waiting of [...releasing.keys()]) released(waiting);
    },
  };
}
