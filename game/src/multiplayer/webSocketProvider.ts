import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type CommandOutcome, type GameCommand, type SessionCredentials, type SessionPhase, type WorldDescriptor, type WorldProvider, type WorldSession, type WorldUpdate } from "../contracts.js";
import { command, compatible, descriptor, discoverWorlds, MAX_PENDING_COMMANDS, record, SessionFailure, worldKey } from "./protocol.js";
import { ReplicatedState, MAX_OUTBOUND_BYTES } from "./replication.js";

export class WebSocketSession implements WorldSession {
  private sequence = 0;
  private closed = false;
  private lastUpdate: WorldUpdate;
  private readonly listeners = new Set<(update: WorldUpdate) => void>();
  private readonly statusListeners = new Set<(phase: SessionPhase) => void>();
  private readonly pending = new Map<number, { operation: number; resolve(outcome: CommandOutcome): void; timer: ReturnType<typeof setTimeout> }>();
  readonly state: ReplicatedState;
  constructor(readonly id: string, readonly playerId: string, readonly world: WorldDescriptor, private readonly socket: WebSocket, initial: WorldUpdate,
    private nextOperation: number, private readonly retries: Map<number, GameCommand>) {
    this.state = new ReplicatedState(id,playerId); this.state.apply(initial); this.lastUpdate = initial;
    socket.addEventListener("message", (event) => {
      try {
        if (typeof event.data !== "string" || event.data.length > MAX_OUTBOUND_BYTES) throw new Error("Invalid server response");
        const message = JSON.parse(event.data);
        if (message.type === "ack") {
          const outcome = message.outcome as CommandOutcome; const pending = this.pending.get(outcome.sequence);
          if (pending) { clearTimeout(pending.timer); this.pending.delete(outcome.sequence); this.retries.delete(pending.operation); pending.resolve(outcome); }
        } else if (message.type === "update") {
          const update = message.update as WorldUpdate;
          if (this.state.apply(update)) { this.lastUpdate = update; for (const listener of this.listeners) listener(update); }
        } else if (message.type === "error") { this.failPending(); socket.close(4000, "World error"); }
      } catch {
        this.failPending(); socket.close(4000, "Invalid replication");
      }
    });
    socket.addEventListener("close", () => {
      const unexpected = !this.closed; this.closed = true; this.failPending();
      if (unexpected) for (const listener of this.statusListeners) listener("reconnecting");
    });
    socket.addEventListener("error", () => this.failPending());
  }
  async command(input: GameCommand): Promise<CommandOutcome> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) throw new SessionFailure("SESSION_EXPIRED", "World connection is closed");
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
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) throw new SessionFailure("SESSION_EXPIRED", "World connection is closed");
    if (this.pending.size >= MAX_PENDING_COMMANDS) throw new SessionFailure("BACKLOG", "Too many pending commands");
    const sequence = ++this.sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ status: "unknown", sequence, error: { code: "UNKNOWN_OUTCOME", message: "No authoritative acknowledgement received" } });
        // Stop accepting intents until a new snapshot and bounded retry reconciliation succeed.
        this.failPending(); this.socket.close(4000,"Acknowledgement timeout");
      }, 5000);
      this.pending.set(sequence, { operation, resolve, timer }); this.retries.set(operation, value);
      this.socket.send(JSON.stringify({ type: "command", envelope: { sessionId: this.id, sequence, operation, command: value } }));
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
  private failPending(): void {
    for (const [sequence, pending] of this.pending) { clearTimeout(pending.timer); pending.resolve({ status: "unknown", sequence,
      error: { code: "UNKNOWN_OUTCOME", message: "Connection lost before authoritative acknowledgement" } }); }
    this.pending.clear();
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; this.failPending(); this.listeners.clear();
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "leave" }));
    this.socket.close(1000, "Left world");
    await new Promise<void>((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) { resolve(); return; }
      const timeout = setTimeout(resolve, 1500);
      this.socket.addEventListener("close", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
  }
}

export class WebSocketProvider implements WorldProvider {
  private readonly retries = new Map<string, Map<number, GameCommand>>();
  constructor(readonly id: string, private readonly worlds: WorldDescriptor[],
    private readonly authenticatePlayer: (world: WorldDescriptor, signal?: AbortSignal) => Promise<SessionCredentials>) {}
  discover(signal?: AbortSignal): Promise<WorldDescriptor[]> { return discoverWorlds(this.worlds, signal); }
  authenticate(world: WorldDescriptor, signal?: AbortSignal): Promise<SessionCredentials> { return this.authenticatePlayer(world, signal); }
  async connect(world: WorldDescriptor, credentials: SessionCredentials, signal?: AbortSignal): Promise<WorldSession> {
    compatible(world);
    if (world.providerId !== this.id) throw new SessionFailure("UNAVAILABLE", "Wrong provider");
    if (signal?.aborted) throw new SessionFailure("SESSION_EXPIRED", "Join cancelled");
    const socket = new WebSocket(world.endpoint);
    return new Promise((resolve, reject) => {
      let identity: { sessionId: string; playerId: string; nextOperation: number } | null = null;
      const timeout = setTimeout(() => fail(new SessionFailure("UNAVAILABLE", "World connection timed out")), 5000);
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); socket.removeEventListener("message", message); socket.removeEventListener("close", disconnect); socket.removeEventListener("error", disconnect); };
      const fail = (error: Error) => { cleanup(); socket.close(); reject(error); };
      const abort = () => fail(new SessionFailure("SESSION_EXPIRED", "Join cancelled"));
      const disconnect = () => fail(new SessionFailure("UNAVAILABLE", "World connection failed"));
      const message = (event: MessageEvent) => {
        try {
          if (typeof event.data !== "string" || event.data.length > MAX_OUTBOUND_BYTES) throw new Error("Invalid response");
          const data = JSON.parse(event.data);
          if (!record(data)) throw new Error("Invalid response");
          if (data.type === "error" && record(data.error)) { fail(new SessionFailure(data.error.code as SessionFailure["code"], String(data.error.message))); return; }
          if (data.type === "joined" && typeof data.sessionId === "string" && typeof data.playerId === "string" && Number.isSafeInteger(data.nextOperation)) {
 const joined=descriptor(data.world);compatible(joined);
 if(worldKey(joined)!==worldKey(world)||joined.seed!==world.seed||joined.contentVersion!==world.contentVersion)throw new SessionFailure('INCOMPATIBLE','Joined world differs from selected world');
 identity = { sessionId: data.sessionId, playerId: data.playerId, nextOperation: Number(data.nextOperation) };
}
          if (data.type === "update" && identity && record(data.update) && data.update.snapshot === true && data.update.sessionId === identity.sessionId && data.update.privateState) {
            cleanup();
            const key = JSON.stringify([worldKey(world), identity.playerId]);
            let retries = this.retries.get(key); if (!retries) { retries = new Map(); this.retries.set(key, retries); }
            const session = new WebSocketSession(identity.sessionId, identity.playerId, world, socket, data.update as unknown as WorldUpdate, identity.nextOperation, retries);
            void session.resume().then(() => resolve(session), (error) => { void session.close(); reject(error); });
          }
        } catch (error) { fail(error instanceof SessionFailure ? error : new SessionFailure("INVALID_MESSAGE", "Invalid initial snapshot")); }
      };
      signal?.addEventListener("abort", abort, { once: true });
      socket.addEventListener("message", message); socket.addEventListener("close", disconnect); socket.addEventListener("error", disconnect);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "join", providerId: world.providerId, worldId: world.worldId,
        token: credentials.token, protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: world.contentVersion })), { once: true });
    });
  }
}
