import type { SessionError, SessionPhase, WorldDescriptor, WorldProvider, WorldSession, WorldUpdate } from "../contracts.js";
import { compatible, descriptor, SessionFailure } from "./protocol.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, WorldProvider>();
  register(provider: WorldProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }
  get(id: string): WorldProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new SessionFailure("UNAVAILABLE", "World provider is not installed");
    return provider;
  }
}

export interface SessionControllerPorts {
  validate?(world:WorldDescriptor):void;
  clear(): void;
  apply(update: WorldUpdate): void;
  /** `failure` carries the code behind a refused join, which the picker answers differently. */
  phase(phase: SessionPhase, message?: string, failure?: SessionError): void;
  offline(): Promise<void>;
}

/** Generation checks cover authentication, connection, and late replicated packets. */
export class SessionController {
  private generation = 0;
  private abort: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private current: WorldSession | null = null;
  private teardown: Promise<void> = Promise.resolve();
  constructor(private readonly providers: ProviderRegistry, private readonly ports: SessionControllerPorts) {}
  get session(): WorldSession | null { return this.current; }
  async join(input: WorldDescriptor): Promise<void> {
    const generation = ++this.generation;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.abort?.abort(); this.abort = new AbortController();
    const signal = this.abort.signal;
    const prior = this.current; this.current = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeStatus?.(); this.unsubscribeStatus = null;
    this.ports.phase("connecting");
    this.teardown = this.teardown.catch(() => {}).then(async () => { try { await prior?.close(); } finally { this.ports.clear(); } });
    try {
      await this.teardown;
      if (generation !== this.generation) return;
      const world = descriptor(input); compatible(world);
      this.ports.validate?.(world);
      const provider = this.providers.get(world.providerId);
      const credentials = await provider.authenticate(world, signal);
      if (generation !== this.generation) return;
      const session = await provider.connect(world, credentials, signal);
      if (generation !== this.generation) { await session.close(); return; }
      this.current = session;
      this.unsubscribeStatus = session.subscribeStatus?.((phase) => {
        if (generation !== this.generation || phase !== "reconnecting") return;
        this.ports.phase("reconnecting", "Connection lost. Reconnecting…");
        this.reconnectTimer = setTimeout(() => { if (generation === this.generation) void this.join(world); }, 500);
      }) ?? null;
      // Providers must replay their validated initial snapshot to new subscribers.
      this.unsubscribe = session.subscribe((update) => {
        if (generation !== this.generation || update.sessionId !== session.id) return;
        this.ports.apply(update);
      });
      this.ports.phase("connected");
    } catch (error) {
      if (generation !== this.generation) return;
      const failure: SessionError = error instanceof SessionFailure ? { code: error.code, message: error.message }
        : { code: "UNAVAILABLE", message: "Could not join this world" };
      this.ports.phase(failure.code === "FULL" ? "full" : failure.code === "INCOMPATIBLE" ? "incompatible" : "unavailable",
        failure.message, failure);
    }
  }
  async leave(): Promise<void> {
    const generation = ++this.generation; this.abort?.abort(); this.abort = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.unsubscribeStatus?.(); this.unsubscribeStatus = null;
    const prior = this.current; this.current = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.ports.phase("leaving");
    this.teardown = this.teardown.catch(() => {}).then(async () => { try { await prior?.close(); } finally { this.ports.clear(); } });
    try { await this.teardown; } catch { /* A broken transport must still release the local session. */ }
    if (generation !== this.generation) return;
    await this.ports.offline();
    if (generation === this.generation) this.ports.phase("offline");
  }
}
