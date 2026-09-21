import type { SessionCredentials, WorldDescriptor, WorldFixture, WorldProvider, WorldSession } from "../contracts.js";
import type { ClientCatalog } from "../content/clientCatalog.js";
import { LOCAL_PROVIDER_ID, LOCAL_WORLD_MANIFEST, localWorldDescriptor, packedSeed, parseLocalWorldManifest, type LegacyImport, type LocalHostReady, type LocalHostReply, type LocalHostRequest, type LocalStorageTrouble } from "../worker/localHostProtocol.js";
import { sharedLocalWorldManifest } from "../content/catalogEntry.js";
import type { DebugOp, DebugReply } from "../worker/localDebugProtocol.js";
import type { LabFixtureSpec } from "../featureLab/labSpec.js";
import { labTransferables, type LabOp, type LabWorldData } from "../worker/labProtocol.js";
import { messagePortTransport, type MessagePortTransport } from "./messagePortLink.js";
import { compatible, SessionFailure, worldKey } from "./protocol.js";
import { joinWorldSession, RetryLedger } from "./sessionClient.js";

/**
 * Local play as a world provider: one "Play local" world, no login, hosted by a Web Worker that runs
 * the same host core a server does. `connect` starts the worker, waits for it to boot its world, and
 * then joins it through `joinWorldSession`, the same function a socket session goes through.
 *
 * A worker lives exactly as long as its session. Closing the session saves the character, flushes
 * the store and ends the worker, which is also what frees the store for another tab.
 */

/** The part of a Worker this provider uses, so a test can stand one up over a MessageChannel. */
export interface LocalWorkerLike {
  postMessage(message: LocalHostRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: LocalHostReply }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: unknown) => void): void;
  terminate(): void;
}
/** What the page's old save offers. Absent in a test or a page with no storage. */
export interface LegacySavePort { read(): LegacyImport | null; migrated(): void }

export interface WorkerProviderOptions {
  fixture: WorldFixture;
  /** The seed the page built its scene for. `resolveLocalSeed` answers it from the published manifest. */
  seed: number;
  /** Absolute URL of the public file tree, with a trailing slash. */
  assetBase: string;
  /** This build's base game version, from the published manifest. The picker shows it on the local row. */
  baseVersion?: string;
  spawn(): LocalWorkerLike;
  legacy?: LegacySavePort;
  /** Keep nothing between sessions. */
  memory?: boolean;
  /** A feature-lab session. The worker waits for `provideLabWorld` before it builds its world. */
  lab?: LabFixtureSpec;
  /** Told once per worker start: timings, the seed that was used, what became of an old save. */
  started?(ready: LocalHostReady): void;
  /** The worker could not write its store. The session plays on; the player should be told their progress may not be kept. */
  storageTrouble?(trouble: LocalStorageTrouble): void;
}

/** What `window.__corealmLocalWorker` shows a harness. */
export interface LocalWorkerObservation { starts: number; running: boolean; crashed: boolean; ready: LocalHostReady | null; startMs: number | null; storageTrouble: LocalStorageTrouble | null }

interface Running { worker: LocalWorkerLike; ready: LocalHostReady; transport: MessagePortTransport | null; calls: Map<number, (reply: LocalHostReply) => void>; nextCall: number; ended: boolean }

export class WorkerWorldProvider implements WorldProvider {
  readonly id = LOCAL_PROVIDER_ID;
  readonly world: WorldDescriptor;
  private readonly retries = new RetryLedger();
  private running: Running | null = null;
  /** A worker started before anyone joined, so its world boots beside the scene instead of after it. */
  private warm: Promise<Running> | null = null;
  private crashed = false;
  /** The lab world description, until a worker has taken it. Its arrays are transferred, so it is given once. */
  private labWorld: LabWorldData | null = null;
  private starting: LocalWorkerLike | null = null;
  private starts = 0; private lastReady: LocalHostReady | null = null; private lastStartMs: number | null = null; private trouble: LocalStorageTrouble | null = null;
  constructor(private readonly options: WorkerProviderOptions) { this.world = localWorldDescriptor(options.fixture, options.seed, options.baseVersion); }

  async discover(): Promise<WorldDescriptor[]> { return [this.world]; }
  /** Local play has no login. The host's adapter ignores the token and answers with the one local account. */
  async authenticate(): Promise<SessionCredentials> { return { token: "local" }; }

  observe(): LocalWorkerObservation { return { starts: this.starts, running: this.running !== null, crashed: this.crashed, ready: this.lastReady, startMs: this.lastStartMs, storageTrouble: this.trouble }; }

  async connect(world: WorldDescriptor, credentials: SessionCredentials, signal?: AbortSignal): Promise<WorldSession> {
    compatible(world);
    if (worldKey(world) !== worldKey(this.world)) throw new SessionFailure("UNAVAILABLE", "Wrong provider");
    if (signal?.aborted) throw new SessionFailure("SESSION_EXPIRED", "Join cancelled");
    // A worker that died takes its session with it, and the session controller's answer to a lost
    // session is to join again. Starting a fresh worker behind the player's back would hide a crash
    // that may well repeat, so the first join after one is refused and the picker offers the restart.
    if (this.crashed) { this.crashed = false; throw new SessionFailure("UNAVAILABLE", "Local play stopped unexpectedly. Choose Play local to start it again."); }
    const warm = this.warm; this.warm = null;
    if (!warm && this.running) await this.stop(this.running);
    const running = await (warm ?? this.start(signal));
    try {
      if (signal?.aborted) throw new SessionFailure("SESSION_EXPIRED", "Join cancelled");
      const channel = new MessageChannel();
      const transport = messagePortTransport(channel.port1, { catalog: (_world, revision) => ({ revision, load: () => this.catalog(running) }) });
      running.transport = transport;
      running.worker.postMessage({ type: "connect", port: channel.port2 }, [channel.port2]);
      const session = await joinWorldSession(transport, world, credentials, this.retries, signal);
      const close = session.close.bind(session);
      // Leaving the world is the end of the worker: the host saves the character on the way out.
      session.close = async () => { await close(); await this.stop(running); };
      return session;
    } catch (error) { await this.stop(running); throw error; }
  }

  /**
   * Start the worker now, because local play is what this page is about to join: `?play=local`, or
   * "Play local" chosen while the scene is still loading. Booting the world takes seconds, and they
   * overlap with the scene's own. A failed start is reported by the join that follows.
   */
  prestart(): void {
    if (this.running || this.warm || this.crashed) return;
    this.warm = this.start(); this.warm.catch(() => {});
  }

  /**
   * One operation on local play's debug channel (`worker/localDebugProtocol.ts`). Resolves after the
   * update that carries its effect has been applied to this page's session, because the host posts
   * that update and then the answer on one port. Rejects when no local session is joined.
   */
  async debug(op: DebugOp | LabOp): Promise<unknown> {
    const transport = this.running && !this.running.ended ? this.running.transport : null;
    if (!transport?.open) throw new Error("UNAVAILABLE: join the local world before using debug writes and whole-world reads");
    const reply = await transport.debug(op) as DebugReply;
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }

  /**
   * The lab world, described by the page once its scene is drawn. A lab worker that is already booting takes it now;
   * one started later takes it with its start. The typed arrays are handed over, so pass copies of anything the scene still reads.
   */
  provideLabWorld(data: LabWorldData): void {
    if (!this.options.lab) throw new Error("Only a lab session takes a lab world");
    if (this.starting) this.starting.postMessage({ type: "lab-world", data }, labTransferables(data)); else this.labWorld = data;
  }

  /** `visibilitychange` to hidden and `pagehide`: the worker cannot see either, and its next timed flush may never come. */
  flush(): void { if (this.running && !this.running.ended) this.running.worker.postMessage({ type: "flush" }); }

  private start(signal?: AbortSignal): Promise<Running> {
    const began = performance.now(); this.starts++;
    const legacy = this.options.legacy?.read() ?? null;
    const worker = this.options.spawn();
    return new Promise<Running>((resolve, reject) => {
      let running: Running | null = null;
      const refuse = (error: Error): void => { signal?.removeEventListener("abort", abort); worker.terminate(); reject(error); };
      const abort = (): void => refuse(new SessionFailure("SESSION_EXPIRED", "Join cancelled"));
      const died = (): void => {
        if (!running) { refuse(new SessionFailure("UNAVAILABLE", "Local play could not start in this browser")); return; }
        if (running.ended) return;
        running.ended = true; this.crashed = true; if (this.running === running) this.running = null;
        worker.terminate(); running.calls.clear(); running.transport?.lost();
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.addEventListener("error", died); worker.addEventListener("messageerror", died);
      worker.addEventListener("message", ({ data }) => {
        if (data.type === "storage-error") { this.trouble = data; this.options.storageTrouble?.(data); return; }
        if (running) { if ("id" in data) { const settle = running.calls.get(data.id); running.calls.delete(data.id); settle?.(data); } return; }
        if (data.type === "failed") { refuse(new SessionFailure(data.code, data.message)); return; }
        if (data.type !== "ready") return;
        signal?.removeEventListener("abort", abort);
        // The worker has the old save in its store now, or already had a character. Either way it is never offered again.
        if (legacy && data.legacy !== "none") this.options.legacy?.migrated();
        this.lastReady = data; this.lastStartMs = performance.now() - began; this.options.started?.(data);
        this.running = running = { worker, ready: data, transport: null, calls: new Map(), nextCall: 1, ended: false };
        if (this.starting === worker) this.starting = null;
        resolve(running);
      });
      worker.postMessage({ type: "start", assetBase: this.options.assetBase, fixture: this.options.fixture, seed: this.options.seed,
        ...(legacy ? { legacy } : {}), ...(this.options.memory ? { memory: true } : {}), ...(this.options.lab ? { lab: this.options.lab } : {}) });
      if (this.options.lab) {
        this.starting = worker;
        const world = this.labWorld; this.labWorld = null;
        if (world) worker.postMessage({ type: "lab-world", data: world }, labTransferables(world));
      }
    });
  }

  private call<T extends LocalHostReply>(running: Running, request: (id: number) => LocalHostRequest, waitMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (running.ended) { reject(new SessionFailure("UNAVAILABLE", "Local play has stopped")); return; }
      const id = running.nextCall++;
      const timer = setTimeout(() => { running.calls.delete(id); reject(new SessionFailure("UNAVAILABLE", "Local play did not answer")); }, waitMs);
      running.calls.set(id, (answer) => { clearTimeout(timer); resolve(answer as T); });
      running.worker.postMessage(request(id));
    });
  }

  private async catalog(running: Running): Promise<ClientCatalog> {
    return (await this.call<Extract<LocalHostReply, { type: "catalog" }>>(running, id => ({ type: "catalog", id }), 10_000)).catalog;
  }

  /** Save, flush, close the store, then end the worker. A worker that does not answer is ended anyway. */
  private async stop(running: Running): Promise<void> {
    if (running.ended) return;
    await this.call(running, id => ({ type: "close", id }), 5000).catch(() => {});
    running.ended = true; if (this.running === running) this.running = null;
    running.worker.terminate();
  }
}

/**
 * The seed local play will run, decided before the page builds its scene, because the scene and the
 * worker's world must be the same seed. `wanted` is the old save's seed, or the one remembered from
 * the last session. The pack holds a fixed set, and anything else falls back to its first.
 */
export async function resolveLocalSeed(assetBase: string, wanted: number, fetcher: typeof fetch = fetch): Promise<{ seed: number; fallback: boolean; baseVersion?: string }> {
  const url = new URL(`generated/${LOCAL_WORLD_MANIFEST}`, assetBase).href;
  // The entry fetched this manifest moments ago to find its catalog. The same answer serves here.
  let manifest = sharedLocalWorldManifest(url);
  if (!manifest) {
    const response = await fetcher(url, { cache: "no-cache", credentials: "omit" });
    if (!response.ok) throw new Error(`The local world manifest answered ${response.status}`);
    manifest = parseLocalWorldManifest(await response.json());
  }
  const seed = packedSeed(manifest.pack.seeds, wanted);
  return { seed, fallback: seed !== wanted, ...(manifest.baseVersion ? { baseVersion: manifest.baseVersion } : {}) };
}
