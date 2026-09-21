import { WORLD_PROTOCOL_VERSION, type CommandOutcome, type GameCommand, type SessionCatalog, type SessionCredentials, type SessionPhase, type WorldDescriptor, type WorldSession, type WorldUpdate } from "../contracts.js";
import { command, compatible, contentUpdated, descriptor, MAX_PENDING_COMMANDS, record, SessionFailure, worldKey } from "./protocol.js";
import { ReplicatedState } from "./replication.js";

/**
 * The client half of the wire protocol, with no transport in it: join, the first snapshot, commands
 * and their acknowledgements, updates, content-updated, errors and leaving. It is the mirror of
 * `worldHost.ts`. A WebSocket carries it to a server and a MessagePort carries it to the local-play
 * worker, and both go through `joinWorldSession` below, so connected play and local play are one
 * session code path.
 */

/** What the conversation hears from a transport. One listener at a time: the join hands over to the session. */
export interface TransportListener {
  /** One protocol message, already a value. */
  message(value: unknown): void;
  /** Something arrived that is not a protocol message: a frame that did not parse, or one past the size limit. */
  invalid(): void;
  /** The transport reported trouble. Its `closed` follows when the link is really gone. */
  failed(): void;
  /** The link is gone, whoever ended it. */
  closed(): void;
}

/**
 * What the conversation needs from a transport. Everything that only means something on a wire lives
 * behind it: serialising, size limits, the wait for a connection to open, and how long an
 * acknowledgement may take before the link is presumed dead. A MessagePort cannot lose a message
 * without losing the worker, so it has no acknowledgement timeout at all.
 */
export interface SessionTransport {
  readonly open: boolean;
  /** Sends once the link is open. Messages sent earlier are held, in order. */
  send(message: unknown): void;
  close(code: number, reason: string): void;
  listen(listener: TransportListener | null): void;
  /** Settles when the far side has let go, or when the transport stops waiting for it. */
  whenClosed(): Promise<void>;
  /** How long the join may take, from the first byte to the first snapshot. */
  readonly joinTimeoutMs: number;
  /** How long a command may go unacknowledged. Null on a transport that cannot drop a message. */
  readonly ackTimeoutMs: number | null;
  /** Where this session's client catalog comes from, for the revision the join reply named. */
  catalog(world: WorldDescriptor, revision: string): SessionCatalog;
  /** Whether a descriptor in a `joined` reply is remote input. A socket's is; the page's own worker's is not. */
  readonly remote: boolean;
}

/** Commands sent and not yet acknowledged, by operation. They outlive a session so a reconnect can replay them. */
export type CommandRetries = Map<number, GameCommand>;

export class ClientWorldSession implements WorldSession {
  private sequence = 0;
  private closed = false;
  private lastUpdate: WorldUpdate;
  private readonly listeners = new Set<(update: WorldUpdate) => void>();
  private readonly statusListeners = new Set<(phase: SessionPhase) => void>();
  private readonly contentListeners = new Set<(revision: string) => void>();
  private readonly pending = new Map<number, { operation: number; resolve(outcome: CommandOutcome): void; timer: ReturnType<typeof setTimeout> | null }>();
  readonly state: ReplicatedState;
  readonly catalog: SessionCatalog;
  /** `world` is the descriptor the host sent at join, so its `catalogRevision` is the one this session plays on. */
  constructor(readonly id: string, readonly playerId: string, readonly world: WorldDescriptor & { catalogRevision: string }, private readonly transport: SessionTransport, initial: WorldUpdate,
    private nextOperation: number, private readonly retries: CommandRetries) {
    this.state = new ReplicatedState(id, playerId); this.state.apply(initial); this.lastUpdate = initial;
    this.catalog = transport.catalog(world, world.catalogRevision);
    transport.listen({
      message: (message) => {
        try {
          if (!record(message)) throw new Error("Invalid host message");
          if (message.type === "ack") {
            const outcome = message.outcome as CommandOutcome; const pending = this.pending.get(outcome.sequence);
            if (pending) { if (pending.timer) clearTimeout(pending.timer); this.pending.delete(outcome.sequence); this.retries.delete(pending.operation); pending.resolve(outcome); }
          } else if (message.type === "update") {
            const update = message.update as WorldUpdate;
            if (this.state.apply(update)) { this.lastUpdate = update; for (const listener of this.listeners) listener(update); }
          } else if (message.type === "content-updated") {
            const revision = contentUpdated(message);
            for (const listener of this.contentListeners) listener(revision);
          } else if (message.type === "error") { this.failPending(); transport.close(4000, "World error"); }
        } catch {
          this.failPending(); transport.close(4000, "Invalid replication");
        }
      },
      invalid: () => { this.failPending(); transport.close(4000, "Invalid replication"); },
      failed: () => this.failPending(),
      closed: () => {
        const unexpected = !this.closed; this.closed = true; this.failPending();
        if (unexpected) for (const listener of this.statusListeners) listener("reconnecting");
      },
    });
  }
  async command(input: GameCommand): Promise<CommandOutcome> {
    if (this.closed || !this.transport.open) throw new SessionFailure("SESSION_EXPIRED", "World connection is closed");
    if (this.pending.size >= MAX_PENDING_COMMANDS) throw new SessionFailure("BACKLOG", "Too many pending commands");
    return this.submit(command(input), this.nextOperation++);
  }
  async resume(): Promise<void> {
    for (const [operation, input] of [...this.retries].sort(([a], [b]) => a - b)) {
      this.nextOperation = Math.max(this.nextOperation, operation + 1);
      const outcome = await this.submit(input, operation);
      if (outcome.status === "unknown") throw new SessionFailure("UNKNOWN_OUTCOME", outcome.error.message);
    }
  }
  private async submit(value: GameCommand, operation: number): Promise<CommandOutcome> {
    if (this.closed || !this.transport.open) throw new SessionFailure("SESSION_EXPIRED", "World connection is closed");
    if (this.pending.size >= MAX_PENDING_COMMANDS) throw new SessionFailure("BACKLOG", "Too many pending commands");
    const sequence = ++this.sequence;
    return new Promise((resolve) => {
      const wait = this.transport.ackTimeoutMs;
      const timer = wait === null ? null : setTimeout(() => {
        resolve({ status: "unknown", sequence, error: { code: "UNKNOWN_OUTCOME", message: "No authoritative acknowledgement received" } });
        // Stop accepting intents until a new snapshot and bounded retry reconciliation succeed.
        this.failPending(); this.transport.close(4000, "Acknowledgement timeout");
      }, wait);
      this.pending.set(sequence, { operation, resolve, timer }); this.retries.set(operation, value);
      this.transport.send({ type: "command", envelope: { sessionId: this.id, sequence, operation, command: value } });
    });
  }
  subscribe(listener: (update: WorldUpdate) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.lastUpdate, snapshot: true, baseSequence: null, players: [...this.state.players.values()], entities: [...this.state.entities.values()],
      privateState: this.state.privateState, events: [], actions: [], removedPlayers: [], removedEntities: [] });
    return () => this.listeners.delete(listener);
  }
  subscribeStatus(listener: (phase: SessionPhase) => void): () => void {
    this.statusListeners.add(listener); return () => this.statusListeners.delete(listener);
  }
  subscribeContent(listener: (revision: string) => void): () => void {
    this.contentListeners.add(listener); return () => this.contentListeners.delete(listener);
  }
  private failPending(): void {
    for (const [sequence, pending] of this.pending) { if (pending.timer) clearTimeout(pending.timer); pending.resolve({ status: "unknown", sequence,
      error: { code: "UNKNOWN_OUTCOME", message: "Connection lost before authoritative acknowledgement" } }); }
    this.pending.clear();
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; this.failPending(); this.listeners.clear();
    if (this.transport.open) this.transport.send({ type: "leave" });
    this.transport.close(1000, "Left world");
    await this.transport.whenClosed();
  }
}

/** Every provider keeps one of these, so a reconnect to the same world as the same player replays what was in flight. */
export class RetryLedger {
  private readonly held = new Map<string, CommandRetries>();
  of(world: WorldDescriptor, playerId: string): CommandRetries {
    const key = JSON.stringify([worldKey(world), playerId]);
    let retries = this.held.get(key); if (!retries) { retries = new Map(); this.held.set(key, retries); }
    return retries;
  }
}

/**
 * Join `world` over `transport` and return the live session: send the join, check the `joined` reply
 * against the world that was chosen, wait for the first snapshot, then replay any commands a previous
 * connection left unacknowledged. Both providers call this and nothing else speaks the protocol.
 */
export function joinWorldSession(transport: SessionTransport, world: WorldDescriptor, credentials: SessionCredentials, ledger: RetryLedger, signal?: AbortSignal): Promise<WorldSession> {
  compatible(world);
  if (signal?.aborted) { transport.close(1000, "Join cancelled"); return Promise.reject(new SessionFailure("SESSION_EXPIRED", "Join cancelled")); }
  return new Promise((resolve, reject) => {
    let identity: { sessionId: string; playerId: string; nextOperation: number; world: WorldDescriptor & { catalogRevision: string } } | null = null;
    const timeout = setTimeout(() => fail(new SessionFailure("UNAVAILABLE", "World connection timed out")), transport.joinTimeoutMs);
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); transport.listen(null); };
    const fail = (error: Error) => { cleanup(); transport.close(1000, "Join failed"); reject(error); };
    const abort = () => fail(new SessionFailure("SESSION_EXPIRED", "Join cancelled"));
    const disconnect = () => fail(new SessionFailure("UNAVAILABLE", "World connection failed"));
    signal?.addEventListener("abort", abort, { once: true });
    transport.listen({
      invalid: () => fail(new SessionFailure("INVALID_MESSAGE", "Invalid initial snapshot")),
      failed: disconnect, closed: disconnect,
      message: (data) => {
        try {
          if (!record(data)) throw new Error("Invalid response");
          if (data.type === "error" && record(data.error)) { fail(new SessionFailure(data.error.code as SessionFailure["code"], String(data.error.message))); return; }
          if (data.type === "joined" && typeof data.sessionId === "string" && typeof data.playerId === "string" && Number.isSafeInteger(data.nextOperation)) {
            const joined = descriptor(data.world, transport.remote ? "socket" : "any"); compatible(joined);
            if (worldKey(joined) !== worldKey(world) || joined.seed !== world.seed || joined.fixture !== world.fixture) throw new SessionFailure("INCOMPATIBLE", "Joined world differs from selected world");
            // The revision seen at discovery may be a publish behind. Only the join reply names what this session plays on.
            const catalogRevision = joined.catalogRevision; if (catalogRevision === undefined) throw new SessionFailure("INVALID_MESSAGE", "The server did not name its content catalog");
            identity = { sessionId: data.sessionId, playerId: data.playerId, nextOperation: Number(data.nextOperation), world: { ...world, catalogRevision } };
          }
          if (data.type === "update" && identity && record(data.update) && data.update.snapshot === true && data.update.sessionId === identity.sessionId && data.update.privateState) {
            cleanup();
            const session = new ClientWorldSession(identity.sessionId, identity.playerId, identity.world, transport, data.update as unknown as WorldUpdate, identity.nextOperation, ledger.of(world, identity.playerId));
            void session.resume().then(() => resolve(session), (error) => { void session.close(); reject(error); });
          }
        } catch (error) { fail(error instanceof SessionFailure ? error : new SessionFailure("INVALID_MESSAGE", "Invalid initial snapshot")); }
      },
    });
    transport.send({ type: "join", providerId: world.providerId, worldId: world.worldId, token: credentials.token, protocolVersion: WORLD_PROTOCOL_VERSION });
  });
}
