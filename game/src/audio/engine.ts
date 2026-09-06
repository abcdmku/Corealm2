import type { AudioBus, AudioCueId, AudioVolumes, Vec3 } from "../contracts.js";
import type { AudioCatalog, AudioCueDefinition, AudioLoopDefinition, AudioVariant } from "./catalog.js";

const BUS_IDS: readonly AudioBus[] = ["music", "ambient", "sfx"];
const DEFAULT_VOLUMES: AudioVolumes = { music: 0.7, ambient: 0.8, sfx: 0.9 };

export type AudioDiagnosticKind =
  | "context-unavailable"
  | "unlock-failed"
  | "fetch-failed"
  | "decode-failed"
  | "playback-failed"
  | "missing-loop";

export interface AudioDiagnostic {
  kind: AudioDiagnosticKind;
  message: string;
  name?: string;
  url?: string;
  cause?: unknown;
}

export interface AudioEngineOptions {
  initialVolumes?: Partial<AudioVolumes>;
  contextFactory?: () => AudioContext;
  fetcher?: typeof fetch;
  nowMs?: () => number;
  onDiagnostic?: (diagnostic: AudioDiagnostic) => void;
  onVolumesChange?: (volumes: AudioVolumes) => void;
  defaultCueConcurrency?: number;
  defaultCueIntervalMs?: number;
  maxOneShots?: number;
  historyLimit?: number;
}

export interface PlayCueOptions {
  gain?: number;
  playbackRate?: number;
  /** World source position. UI and player contact cues omit it and remain centred. */
  position?: Vec3;
  maxDistance?: number;
}

export interface StartLoopOptions {
  fadeInMs?: number;
  gain?: number;
}

export interface AudioEngineSnapshot {
  unlocked: boolean;
  disposed: boolean;
  volumes: AudioVolumes;
  activeOneShots: number;
  pendingOneShots: number;
  activeLoops: readonly string[];
  desiredLoops: readonly string[];
  cachedBuffers: number;
  historyCount: number;
}

export type AudioHistoryEntry =
  | { seq: number; atMs: number; kind: "cue"; cue: AudioCueId; url: string }
  | { seq: number; atMs: number; kind: "loop-start"; name: string; url: string; bus: AudioBus }
  | { seq: number; atMs: number; kind: "loop-stop"; name: string };

type AudioHistoryEvent =
  | { kind: "cue"; cue: AudioCueId; url: string }
  | { kind: "loop-start"; name: string; url: string; bus: AudioBus }
  | { kind: "loop-stop"; name: string };

interface LoopRequest {
  token: number;
  gain: number;
  fadeInMs: number;
}

interface ActiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface ActiveVoice {
  cue: AudioCueId;
  source: AudioBufferSourceNode;
  gain: GainNode;
  generation: number;
  panner: PannerNode | null;
}

interface PendingLoopStart {
  token: number;
  promise: Promise<boolean>;
}

/** Browser Web Audio playback with catalog-driven files and no simulation writes. */
export class AudioEngine {
  private readonly contextFactory: () => AudioContext;
  private readonly fetcher: typeof fetch;
  private readonly nowMs: () => number;
  private readonly onDiagnostic?: (diagnostic: AudioDiagnostic) => void;
  private readonly onVolumesChange?: (volumes: AudioVolumes) => void;
  private readonly defaultCueConcurrency: number;
  private readonly defaultCueIntervalMs: number;
  private readonly maxOneShots: number;
  private readonly historyLimit: number;

  private readonly volumes: AudioVolumes;
  private readonly busNodes = new Map<AudioBus, GainNode>();
  private readonly bufferCache = new Map<string, Promise<AudioBuffer | null>>();
  private readonly activeVoices = new Set<ActiveVoice>();
  private readonly cueReservations = new Map<AudioCueId, number>();
  /** Next ordered variant per cue. Repeated actions stay predictable without sounding identical. */
  private readonly cueVariantIndexes = new Map<AudioCueId, number>();
  private readonly lastCueAtMs = new Map<AudioCueId, number>();
  private readonly activeLoops = new Map<string, ActiveLoop>();
  private readonly fadingLoops = new Set<AudioBufferSourceNode>();
  private readonly desiredLoops = new Map<string, LoopRequest>();
  private readonly pendingLoopStarts = new Map<string, PendingLoopStart>();
  private readonly gestureCleanups = new Set<() => void>();
  private readonly playbackHistory: AudioHistoryEntry[] = [];

  private context: AudioContext | null = null;
  private unlockPromise: Promise<boolean> | null = null;
  private readonly unlockPreloadUrls = new Set<string>();
  private pendingOneShots = 0;
  private oneShotGeneration = 0;
  private loopToken = 0;
  private unlocked = false;
  private disposed = false;
  private listenerPosition: Vec3 = [0, 0, 0];
  private listenerForward: Vec3 = [0, 0, -1];

  setListenerPose(position: Vec3, forward: Vec3 = [0, 0, -1]): void {
    if (this.disposed || !position.every(Number.isFinite) || !forward.every(Number.isFinite)) return;
    this.listenerPosition = [...position];
    const length = Math.hypot(...forward);
    if (length > 0.001) this.listenerForward = [forward[0] / length, forward[1] / length, forward[2] / length];
    this.applyListenerPose();
  }

  private applyListenerPose(): void {
    const listener = this.context?.listener;
    if (!listener || !this.context) return;
    const at = this.context.currentTime;
    const [x, y, z] = this.listenerPosition;
    const [fx, fy, fz] = this.listenerForward;
    listener.positionX.setValueAtTime(x, at); listener.positionY.setValueAtTime(y, at); listener.positionZ.setValueAtTime(z, at);
    listener.forwardX.setValueAtTime(fx, at); listener.forwardY.setValueAtTime(fy, at); listener.forwardZ.setValueAtTime(fz, at);
    listener.upX.setValueAtTime(0, at); listener.upY.setValueAtTime(1, at); listener.upZ.setValueAtTime(0, at);
  }
  private historySequence = 0;

  constructor(private readonly catalog: AudioCatalog, options: AudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? createBrowserAudioContext;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.nowMs = options.nowMs ?? defaultNowMs;
    this.onDiagnostic = options.onDiagnostic;
    this.onVolumesChange = options.onVolumesChange;
    this.defaultCueConcurrency = positiveInteger(options.defaultCueConcurrency, 4);
    this.defaultCueIntervalMs = nonNegative(options.defaultCueIntervalMs, 40);
    this.maxOneShots = positiveInteger(options.maxOneShots, 32);
    this.historyLimit = positiveInteger(options.historyLimit, 128);
    this.volumes = mergeVolumes(DEFAULT_VOLUMES, options.initialVolumes);
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setVolume(bus: AudioBus, value: number): AudioVolumes {
    if (this.disposed) return this.getVolumes();
    this.volumes[bus] = clamp01(value);
    this.applyBusGain(bus);
    this.publishVolumes();
    return this.getVolumes();
  }

  setVolumes(values: Partial<AudioVolumes>): AudioVolumes {
    if (this.disposed) return this.getVolumes();
    for (const bus of BUS_IDS) {
      const value = values[bus];
      if (value !== undefined) this.volumes[bus] = clamp01(value);
    }
    for (const bus of BUS_IDS) this.applyBusGain(bus);
    this.publishVolumes();
    return this.getVolumes();
  }

  /**
   * Installs capture listeners early in boot. They remain until a resume succeeds, because a
   * denied or synthetic event must not consume the only unlock attempt.
   */
  installGestureUnlock(
    target: EventTarget | null = typeof window === "undefined" ? null : window,
    preloadUrls: readonly string[] = [],
  ): () => void {
    for (const url of preloadUrls) if (url) this.unlockPreloadUrls.add(url);
    if (this.disposed) return () => undefined;
    if (this.unlocked) {
      this.warmUnlockPreloads();
      return () => undefined;
    }
    if (!target) return () => undefined;

    const handler = (): void => { void this.unlock(); };
    const eventNames = ["pointerdown", "keydown", "touchstart"] as const;
    const listenerOptions: AddEventListenerOptions = { capture: true, passive: true };
    for (const eventName of eventNames) {
      target.addEventListener(eventName, handler, listenerOptions);
    }

    let installed = true;
    const cleanup = (): void => {
      if (!installed) return;
      installed = false;
      for (const eventName of eventNames) target.removeEventListener(eventName, handler, listenerOptions);
      this.gestureCleanups.delete(cleanup);
    };
    this.gestureCleanups.add(cleanup);
    return cleanup;
  }

  /** Returns false instead of rejecting when Web Audio is absent or the browser still blocks it. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.unlocked && this.context?.state === "running") {
      this.warmUnlockPreloads();
      return true;
    }
    if (this.unlockPromise) return this.unlockPromise;

    const attempt = this.performUnlock();
    this.unlockPromise = attempt;
    try {
      const unlocked = await attempt;
      if (unlocked) this.warmUnlockPreloads();
      return unlocked;
    } finally {
      if (this.unlockPromise === attempt) this.unlockPromise = null;
    }
  }

  isUnlocked(): boolean {
    return this.unlocked && this.context?.state === "running";
  }

  /** Schedules a polyphonic one-shot. Missing cues and all runtime failures resolve to false. */
  async playCue(cue: AudioCueId, options: PlayCueOptions = {}): Promise<boolean> {
    if (this.disposed) return false;
    const generation = this.oneShotGeneration;
    const definition = this.catalog.cues?.[cue];
    if (!definition || definition.variants.length === 0) return false;
    if (this.volumes.sfx === 0) return false;
    if (!(await this.unlock()) || generation !== this.oneShotGeneration) return false;

    const maxConcurrent = positiveInteger(definition.maxConcurrent, this.defaultCueConcurrency);
    const reserved = this.cueReservations.get(cue) ?? 0;
    if (reserved >= maxConcurrent || this.activeVoices.size + this.pendingOneShots >= this.maxOneShots) {
      return false;
    }

    const now = this.nowMs();
    const minIntervalMs = nonNegative(definition.minIntervalMs, this.defaultCueIntervalMs);
    const lastAt = this.lastCueAtMs.get(cue);
    if (lastAt !== undefined && now - lastAt < minIntervalMs) return false;

    this.lastCueAtMs.set(cue, now);
    this.reserveCue(cue);
    const variant = this.nextVariant(cue, definition.variants);
    const buffer = await this.loadBuffer(variant.url);
    if (!buffer || this.disposed || !this.context || generation !== this.oneShotGeneration) {
      if (generation === this.oneShotGeneration) this.releasePendingCue(cue);
      return false;
    }

    const context = this.context;
    let source: AudioBufferSourceNode | null = null;
    let voiceGain: GainNode | null = null;
    let panner: PannerNode | null = null;
    let voice: ActiveVoice | null = null;
    let pending = true;
    try {
      source = context.createBufferSource();
      voiceGain = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate(definition, options.playbackRate);
      voiceGain.gain.value = clamp01(
        finiteOr(definition.gain, 1) * finiteOr(variant.gain, 1) * finiteOr(options.gain, 1),
      );
      source.connect(voiceGain);
      if (options.position?.every(Number.isFinite)) {
        panner = context.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "linear";
        panner.refDistance = 1;
        panner.maxDistance = Math.max(1.01, positiveFinite(options.maxDistance ?? 34, 34));
        panner.rolloffFactor = 1;
        panner.positionX.value = options.position[0];
        panner.positionY.value = options.position[1];
        panner.positionZ.value = options.position[2];
        this.applyListenerPose();
        voiceGain.connect(panner);
        panner.connect(this.requireBus("sfx"));
      } else voiceGain.connect(this.requireBus("sfx"));

      voice = { cue, source, gain: voiceGain, generation, panner };
      let ended = false;
      const finish = (): void => {
        if (ended) return;
        ended = true;
        this.activeVoices.delete(voice!);
        if (generation === this.oneShotGeneration) this.decrementCueReservation(cue);
        disconnect(source);
        disconnect(voiceGain);
        disconnect(panner);
      };
      source.onended = finish;
      this.pendingOneShots -= 1;
      pending = false;
      this.activeVoices.add(voice);
      source.start(0, startOffsetSeconds(variant, buffer));
      this.record({ kind: "cue", cue, url: variant.url });
      return true;
    } catch (cause) {
      if (pending) this.pendingOneShots = Math.max(0, this.pendingOneShots - 1);
      this.decrementCueReservation(cue);
      if (voice) this.activeVoices.delete(voice);
      stopSource(source);
      disconnect(source);
      disconnect(voiceGain);
      disconnect(panner);
      this.report({ kind: "playback-failed", message: `Could not play cue ${cue}.`, name: cue, cause });
      return false;
    }
  }

  /** Requests a catalog loop by name. A request made while locked starts after a later gesture. */
  async startLoop(name: string, options: StartLoopOptions = {}): Promise<boolean> {
    if (this.disposed) return false;
    const definition = this.catalog.loops?.[name];
    if (!definition) {
      this.report({ kind: "missing-loop", message: `Audio loop ${name} is not in the catalog.`, name });
      return false;
    }

    const request: LoopRequest = {
      token: ++this.loopToken,
      gain: clamp01(finiteOr(options.gain, 1)),
      fadeInMs: nonNegative(options.fadeInMs, nonNegative(definition.fadeMs, 800)),
    };
    this.desiredLoops.set(name, request);

    if (!(await this.unlock())) return false;
    return this.activateLoop(name, definition, request);
  }

  stopLoop(name: string, fadeMs?: number): boolean {
    this.desiredLoops.delete(name);
    const active = this.activeLoops.get(name);
    if (!active || !this.context) return false;

    this.activeLoops.delete(name);
    const durationMs = nonNegative(fadeMs, nonNegative(this.catalog.loops?.[name]?.fadeMs, 800));
    const now = this.context.currentTime;
    rampGain(active.gain.gain, 0, durationMs, now);
    this.fadingLoops.add(active.source);
    stopSource(active.source, now + durationMs / 1000);
    this.record({ kind: "loop-stop", name });
    return true;
  }

  /** Keeps the old loop alive if the replacement cannot fetch or decode. */
  async crossfade(from: string | null, to: string, fadeMs?: number): Promise<boolean> {
    if (from === to) return this.startLoop(to, { fadeInMs: 0 });
    const fromWasActive = from !== null && this.activeLoops.has(from);
    const started = await this.startLoop(to, { fadeInMs: fadeMs });
    if (started) {
      if (from) this.stopLoop(from, fadeMs);
      return true;
    }
    if (from && !fromWasActive) this.desiredLoops.delete(from);
    return false;
  }

  stopOneShots(cue?: AudioCueId): number {
    let stopped = 0;
    for (const voice of [...this.activeVoices]) {
      if (cue !== undefined && voice.cue !== cue) continue;
      stopped += 1;
      stopSource(voice.source);
    }
    return stopped;
  }

  /** Stops current voices and invalidates every pending one-shot from the previous world. */
  resetOneShots(): number {
    this.oneShotGeneration += 1;
    const stopped = this.activeVoices.size;
    for (const voice of this.activeVoices) {
      stopSource(voice.source);
      disconnect(voice.source);
      disconnect(voice.gain);
      disconnect(voice.panner);
    }
    this.activeVoices.clear();
    this.pendingOneShots = 0;
    this.cueReservations.clear();
    this.cueVariantIndexes.clear();
    this.lastCueAtMs.clear();
    return stopped;
  }

  /** Fetches and decodes each unique catalog URL once. Call after unlock to avoid autoplay noise. */
  async preload(urls: readonly string[] = catalogUrls(this.catalog)): Promise<{ loaded: number; failed: number }> {
    if (!(await this.unlock())) return { loaded: 0, failed: urls.length };
    const uniqueUrls = [...new Set(urls.filter((url) => url.length > 0))];
    const buffers = await Promise.all(uniqueUrls.map((url) => this.loadBuffer(url)));
    const loaded = buffers.filter((buffer) => buffer !== null).length;
    return { loaded, failed: buffers.length - loaded };
  }

  clearBufferCache(): void {
    this.bufferCache.clear();
  }

  /** Bounded, deterministic playback evidence for browser tests and `__gameDebug`. */
  history(limit = this.historyLimit): readonly AudioHistoryEntry[] {
    const count = Math.max(0, Math.floor(limit));
    return this.playbackHistory.slice(Math.max(0, this.playbackHistory.length - count)).map((entry) => ({ ...entry }));
  }

  clearHistory(): void {
    this.playbackHistory.length = 0;
  }

  snapshot(): AudioEngineSnapshot {
    return {
      unlocked: this.isUnlocked(),
      disposed: this.disposed,
      volumes: this.getVolumes(),
      activeOneShots: this.activeVoices.size,
      pendingOneShots: this.pendingOneShots,
      activeLoops: [...this.activeLoops.keys()].sort(),
      desiredLoops: [...this.desiredLoops.keys()].sort(),
      cachedBuffers: this.bufferCache.size,
      historyCount: this.playbackHistory.length,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    for (const cleanup of [...this.gestureCleanups]) cleanup();
    this.desiredLoops.clear();
    this.pendingLoopStarts.clear();

    for (const voice of [...this.activeVoices]) {
      stopSource(voice.source);
      disconnect(voice.source);
      disconnect(voice.gain);
      disconnect(voice.panner);
    }
    for (const active of this.activeLoops.values()) stopSource(active.source);
    for (const source of this.fadingLoops) stopSource(source);
    this.activeVoices.clear();
    this.activeLoops.clear();
    this.fadingLoops.clear();
    this.cueReservations.clear();
    this.cueVariantIndexes.clear();
    this.lastCueAtMs.clear();
    this.bufferCache.clear();
    this.playbackHistory.length = 0;
    this.pendingOneShots = 0;
    this.oneShotGeneration += 1;

    for (const node of this.busNodes.values()) disconnect(node);
    this.busNodes.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") {
      try {
        await context.close();
      } catch {
        // Closing is best-effort. The graph has already been disconnected and forgotten.
      }
    }
  }

  private async performUnlock(): Promise<boolean> {
    let context: AudioContext;
    try {
      context = this.ensureContext();
    } catch (cause) {
      this.report({
        kind: "context-unavailable",
        message: "Web Audio is unavailable in this browser.",
        cause,
      });
      return false;
    }

    try {
      if (context.state !== "running") await context.resume();
    } catch (cause) {
      this.report({ kind: "unlock-failed", message: "The browser did not unlock audio.", cause });
      return false;
    }
    if (this.disposed || this.context !== context) return false;
    if (context.state !== "running") return false;

    this.unlocked = true;
    for (const cleanup of [...this.gestureCleanups]) cleanup();
    for (const [name, request] of this.desiredLoops) {
      const definition = this.catalog.loops?.[name];
      if (definition) void this.activateLoop(name, definition, request);
    }
    return true;
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const context = this.contextFactory();
    this.context = context;
    try {
      for (const bus of BUS_IDS) {
        const node = context.createGain();
        node.gain.value = this.volumes[bus];
        node.connect(context.destination);
        this.busNodes.set(bus, node);
      }
      return context;
    } catch (cause) {
      for (const node of this.busNodes.values()) disconnect(node);
      this.busNodes.clear();
      this.context = null;
      void context.close().catch(() => undefined);
      throw cause;
    }
  }

  private requireBus(bus: AudioBus): GainNode {
    const node = this.busNodes.get(bus);
    if (!node) throw new Error(`Audio bus ${bus} has not been created.`);
    return node;
  }

  private applyBusGain(bus: AudioBus): void {
    const node = this.busNodes.get(bus);
    if (!node || !this.context) return;
    const now = this.context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(this.volumes[bus], now);
  }

  private publishVolumes(): void {
    if (!this.onVolumesChange) return;
    try {
      this.onVolumesChange(this.getVolumes());
    } catch {
      // A persistence listener cannot break audio controls.
    }
  }

  private reserveCue(cue: AudioCueId): void {
    this.pendingOneShots += 1;
    this.cueReservations.set(cue, (this.cueReservations.get(cue) ?? 0) + 1);
  }

  private releasePendingCue(cue: AudioCueId): void {
    this.pendingOneShots = Math.max(0, this.pendingOneShots - 1);
    this.decrementCueReservation(cue);
  }

  private decrementCueReservation(cue: AudioCueId): void {
    const remaining = (this.cueReservations.get(cue) ?? 1) - 1;
    if (remaining > 0) this.cueReservations.set(cue, remaining);
    else this.cueReservations.delete(cue);
  }

  private nextVariant(cue: AudioCueId, variants: AudioCueDefinition["variants"]): AudioVariant {
    const current = this.cueVariantIndexes.get(cue) ?? 0;
    const selected = variants[current % variants.length]!;
    this.cueVariantIndexes.set(cue, (current + 1) % variants.length);
    return typeof selected === "string" ? { url: selected } : selected;
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!url || this.disposed) return null;
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    const promise = this.fetchAndDecode(url);
    this.bufferCache.set(url, promise);
    return promise;
  }

  private warmUnlockPreloads(): void {
    for (const url of this.unlockPreloadUrls) void this.loadBuffer(url);
  }

  private async fetchAndDecode(url: string): Promise<AudioBuffer | null> {
    let bytes: ArrayBuffer;
    try {
      const response = await this.fetcher(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
    } catch (cause) {
      this.report({ kind: "fetch-failed", message: `Could not fetch audio ${url}.`, url, cause });
      return null;
    }

    if (!this.context || this.disposed) return null;
    try {
      return await this.context.decodeAudioData(bytes);
    } catch (cause) {
      this.report({ kind: "decode-failed", message: `Could not decode audio ${url}.`, url, cause });
      return null;
    }
  }

  private activateLoop(
    name: string,
    definition: AudioLoopDefinition,
    request: LoopRequest,
  ): Promise<boolean> {
    const active = this.activeLoops.get(name);
    if (active && this.context) {
      rampGain(active.gain.gain, request.gain * clamp01(finiteOr(definition.gain, 1)), 0, this.context.currentTime);
      return Promise.resolve(true);
    }

    const pending = this.pendingLoopStarts.get(name);
    if (pending?.token === request.token) return pending.promise;
    const promise = this.loadAndStartLoop(name, definition, request);
    this.pendingLoopStarts.set(name, { token: request.token, promise });
    void promise.finally(() => {
      if (this.pendingLoopStarts.get(name)?.promise === promise) this.pendingLoopStarts.delete(name);
    });
    return promise;
  }

  private async loadAndStartLoop(
    name: string,
    definition: AudioLoopDefinition,
    request: LoopRequest,
  ): Promise<boolean> {
    const buffer = await this.loadBuffer(definition.url);
    if (!buffer || !this.context || this.disposed) return false;
    if (this.desiredLoops.get(name)?.token !== request.token) return false;
    if (this.activeLoops.has(name)) return true;

    const context = this.context;
    let source: AudioBufferSourceNode | null = null;
    let loopGain: GainNode | null = null;
    try {
      source = context.createBufferSource();
      loopGain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      if (definition.loopStart !== undefined && Number.isFinite(definition.loopStart)) {
        source.loopStart = Math.max(0, definition.loopStart);
      }
      if (definition.loopEnd !== undefined && Number.isFinite(definition.loopEnd)) {
        source.loopEnd = Math.max(0, definition.loopEnd);
      }

      const targetGain = request.gain * clamp01(finiteOr(definition.gain, 1));
      loopGain.gain.value = request.fadeInMs > 0 ? 0 : targetGain;
      source.connect(loopGain);
      loopGain.connect(this.requireBus(definition.bus));

      const active: ActiveLoop = { source, gain: loopGain };
      source.onended = (): void => {
        if (this.activeLoops.get(name)?.source === source) this.activeLoops.delete(name);
        this.fadingLoops.delete(source!);
        disconnect(source);
        disconnect(loopGain);
      };
      this.activeLoops.set(name, active);
      source.start();
      if (request.fadeInMs > 0) rampGain(loopGain.gain, targetGain, request.fadeInMs, context.currentTime);
      this.record({ kind: "loop-start", name, url: definition.url, bus: definition.bus });
      return true;
    } catch (cause) {
      if (this.activeLoops.get(name)?.source === source) this.activeLoops.delete(name);
      stopSource(source);
      disconnect(source);
      disconnect(loopGain);
      this.report({ kind: "playback-failed", message: `Could not start loop ${name}.`, name, cause });
      return false;
    }
  }

  private report(diagnostic: AudioDiagnostic): void {
    if (!this.onDiagnostic) return;
    try {
      this.onDiagnostic(diagnostic);
    } catch {
      // Diagnostics are observational. A reporter cannot turn a handled audio error into one.
    }
  }

  private record(entry: AudioHistoryEvent): void {
    this.playbackHistory.push({ ...entry, seq: ++this.historySequence, atMs: this.nowMs() } as AudioHistoryEntry);
    const overflow = this.playbackHistory.length - this.historyLimit;
    if (overflow > 0) this.playbackHistory.splice(0, overflow);
  }
}

function createBrowserAudioContext(): AudioContext {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) throw new Error("AudioContext is not available.");
  return new Context();
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function mergeVolumes(defaults: AudioVolumes, updates: Partial<AudioVolumes> | undefined): AudioVolumes {
  return {
    music: clamp01(updates?.music ?? defaults.music),
    ambient: clamp01(updates?.ambient ?? defaults.ambient),
    sfx: clamp01(updates?.sfx ?? defaults.sfx),
  };
}

function playbackRate(definition: AudioCueDefinition, override: number | undefined): number {
  if (override !== undefined) return positiveFinite(override, 1);
  const configured = definition.playbackRate;
  if (typeof configured === "number") return positiveFinite(configured, 1);
  if (!configured) return 1;
  const low = positiveFinite(Math.min(configured[0], configured[1]), 1);
  const high = positiveFinite(Math.max(configured[0], configured[1]), low);
  return (low + high) / 2;
}

/** Skips a recording's pre-roll, never past its end. */
function startOffsetSeconds(variant: AudioVariant, buffer: AudioBuffer): number {
  const offset = variant.startOffsetS;
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) return 0;
  return Math.min(offset, Math.max(0, buffer.duration - 0.01));
}

function catalogUrls(catalog: AudioCatalog): string[] {
  const urls: string[] = [];
  for (const definition of Object.values(catalog.cues ?? {})) {
    if (!definition) continue;
    for (const variant of definition.variants) urls.push(typeof variant === "string" ? variant : variant.url);
  }
  for (const definition of Object.values(catalog.loops ?? {})) urls.push(definition.url);
  return urls;
}

function rampGain(param: AudioParam, target: number, durationMs: number, now: number): void {
  const value = clamp01(target);
  param.cancelScheduledValues(now);
  if (durationMs <= 0) {
    param.setValueAtTime(value, now);
    return;
  }
  param.setValueAtTime(clamp01(param.value), now);
  param.linearRampToValueAtTime(value, now + durationMs / 1000);
}

function stopSource(source: AudioBufferSourceNode | null, when?: number): void {
  if (!source) return;
  try {
    source.stop(when);
  } catch {
    // Already-ended and never-started sources both throw InvalidStateError in some browsers.
  }
}

function disconnect(node: { disconnect(): void } | null): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // Disconnect is idempotent at the engine boundary even where a browser implementation is not.
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
