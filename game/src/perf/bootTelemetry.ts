/**
 * Low-cost boot timing shared by the game and the production boot runner.
 *
 * Times in the exported report are milliseconds from the page navigation start in a browser. A
 * caller-created instance starts at zero when it is constructed unless `timelineOriginMs` is set.
 * Span details accept JSON values only, so Playwright can read the report without a serializer.
 */

export const BOOT_TELEMETRY_SCHEMA_VERSION = 1 as const;
export const BOOT_TELEMETRY_GLOBAL = "__corealmBootTelemetry" as const;

export const BOOT_SPANS = {
  TOTAL: "boot.total",
  JS_EVALUATION: "boot.js.evaluate",
  NAVIGATION_WASM_INIT: "boot.wasm.navigation.initialize",
  MANIFEST_LOAD: "boot.assets.manifest.load",
  ANIMATION_LOAD: "boot.assets.animations.load",
  TERRAIN_BUILD: "boot.terrain.build",
  TERRAIN_RESTAMP: "boot.terrain.restamp",
  DUNGEON_BUILD: "boot.dungeon.build",
  CAMERA_DUNGEON: "boot.camera.dungeon",
  CAMERA_STRUCTURES: "boot.camera.structures",
  NAVIGATION_IMPORT: "boot.navigation.import",
  NAVIGATION_BUILD: "boot.navigation.build",
  SCATTER_CANDIDATES: "boot.scatter.candidates",
  SCATTER_MESHES: "boot.scatter.meshes",
  ENTITY_PRELOAD: "boot.entities.preload",
  GLTF_PARSE: "boot.entities.gltf.parse",
  FIRST_ENTITY_SYNC: "boot.entities.firstSync",
  PLAYER_CONSTRUCTION: "boot.player.construct",
  UI_CONSTRUCTION: "boot.ui.construct",
  SHADER_COMPILE: "boot.shaders.compile",
  BOOT_SCREEN_REMOVAL: "boot.screen.remove",
  FIRST_RENDERED_FRAME: "boot.frame.first",
} as const;

export const BOOT_MILESTONES = {
  SESSION_START: "boot.session.start",
  JS_EVALUATED: "boot.js.evaluated",
  WASM_READY: "boot.wasm.ready",
  MANIFEST_READY: "boot.assets.manifest.ready",
  ANIMATIONS_READY: "boot.assets.animations.ready",
  TERRAIN_READY: "boot.terrain.ready",
  NAVIGATION_READY: "boot.navigation.ready",
  SCATTER_SPAWN_READY: "boot.scatter.spawn.ready",
  ENTITIES_READY: "boot.entities.ready",
  PLAYER_READY: "boot.player.ready",
  UI_READY: "boot.ui.ready",
  SHADERS_READY: "boot.shaders.ready",
  BOOT_SCREEN_REMOVED: "boot.screen.removed",
  FIRST_RENDERED_FRAME: "boot.frame.first",
  FIRST_PLAYABLE: "boot.playable",
} as const;

export type BootSpanName = (typeof BOOT_SPANS)[keyof typeof BOOT_SPANS];
export type BootMilestoneName = (typeof BOOT_MILESTONES)[keyof typeof BOOT_MILESTONES];
export type BootSpanOutcome = "ok" | "error" | "cancelled";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type BootTelemetryDetail = Readonly<Record<string, JsonValue>>;

export interface BootMarkRecord {
  name: string;
  atMs: number;
  detail?: BootTelemetryDetail;
}

export interface BootSpanRecord {
  id: string;
  name: string;
  parentId: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  outcome: BootSpanOutcome;
  /** False for umbrella spans such as `boot.total`, which must not hide attribution gaps. */
  attributed: boolean;
  detail?: BootTelemetryDetail;
  error?: string;
}

export interface BootActiveSpanRecord {
  id: string;
  name: string;
  parentId: string | null;
  startMs: number;
  elapsedMs: number;
  attributed: boolean;
  detail?: BootTelemetryDetail;
}

export interface BootSpanOptions {
  parentId?: string | null;
  detail?: BootTelemetryDetail;
  /** Defaults to false for `boot.total` and true for every other span. */
  attributed?: boolean;
  /** A report-relative timestamp. Omit this to use the telemetry clock. */
  startMs?: number;
}

export interface BootSpanEndOptions {
  outcome?: BootSpanOutcome;
  detail?: BootTelemetryDetail;
  error?: string;
  /** A report-relative timestamp. Omit this to use the telemetry clock. */
  endMs?: number;
}

export interface BootSpanInput extends BootSpanOptions, BootSpanEndOptions {
  name: string;
  startMs: number;
  endMs: number;
  id?: string;
}

export interface BootSpanHandle {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly ended: boolean;
  end(detail?: BootTelemetryDetail): BootSpanRecord;
  fail(error: unknown, detail?: BootTelemetryDetail): BootSpanRecord;
  cancel(detail?: BootTelemetryDetail): BootSpanRecord;
  startChild(name: string, options?: Omit<BootSpanOptions, "parentId">): BootSpanHandle;
}

export interface BootResourceInput {
  name: string;
  initiatorType?: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  deliveryType?: string;
  nextHopProtocol?: string;
  responseStatus?: number;
  /** Set only when the caller has a stronger answer than the first-playable timestamp. */
  preReady?: boolean;
  detail?: BootTelemetryDetail;
}

export interface BootResourceRecord {
  id: string;
  name: string;
  initiatorType: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  deliveryType: string;
  nextHopProtocol: string;
  responseStatus: number;
  preReady: boolean;
  detail?: BootTelemetryDetail;
}

export interface BootAttributionGap {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface BootAttribution {
  startMs: number;
  endMs: number;
  durationMs: number;
  accountedMs: number;
  unattributedMs: number;
  /** Accounted duration divided by window duration, in the range 0..1. */
  coverage: number;
  maxGapMs: number;
  gaps: BootAttributionGap[];
}

export interface BootAttributionOptions {
  startMs?: number;
  endMs?: number;
  /** Gaps smaller than this still count as unattributed time but are omitted from `gaps`. */
  minimumGapMs?: number;
}

export interface BootTelemetrySnapshot {
  schemaVersion: typeof BOOT_TELEMETRY_SCHEMA_VERSION;
  sessionId: string;
  startedAtEpochMs: number;
  generatedAtEpochMs: number;
  generatedAtMs: number;
  firstPlayableMs: number | null;
  marks: BootMarkRecord[];
  spans: BootSpanRecord[];
  activeSpans: BootActiveSpanRecord[];
  resources: BootResourceRecord[];
  counters: Record<string, number>;
  instrumentationOverheadMs: number;
  instrumentationOperations: number;
  attribution: BootAttribution;
}

export interface BootTelemetryOptions {
  /** Monotonic clock used for report-relative timestamps. */
  now?: () => number;
  /** Wall clock used only for the report header. */
  epochNow?: () => number;
  /** Clock used to time instrumentation itself. It does not affect span timestamps. */
  overheadNow?: () => number;
  sessionId?: string;
  /** Origin in the `now` clock's units. Defaults to navigation start in a browser. */
  timelineOriginMs?: number;
  startedAtEpochMs?: number;
  captureResources?: boolean;
  /** Old records are dropped first. This keeps a runaway session from growing the boot report. */
  resourceBufferSize?: number;
}

export interface BootTelemetryGlobalHook {
  readonly schemaVersion: typeof BOOT_TELEMETRY_SCHEMA_VERSION;
  snapshot(): BootTelemetrySnapshot;
  getAttribution(options?: BootAttributionOptions): BootAttribution;
  exportJson(space?: number): string;
}

interface ActiveSpan {
  id: string;
  name: string;
  parentId: string | null;
  startMs: number;
  attributed: boolean;
  detail?: BootTelemetryDetail;
}

const DEFAULT_RESOURCE_BUFFER_SIZE = 1_024;
const MAX_DETAIL_DEPTH = 8;

/**
 * Records one boot session. Concurrent async spans use explicit parent ids; a process-wide implicit
 * stack would assign the wrong parent as soon as physics and navigation initialize in parallel.
 */
export class BootTelemetry {
  private readonly clock: () => number;
  private readonly epochClock: () => number;
  private readonly overheadClock: () => number;
  private readonly timelineOriginMs: number;
  private readonly resourceBufferSize: number;
  private readonly marks: BootMarkRecord[] = [];
  private readonly spans: BootSpanRecord[] = [];
  private readonly activeSpans = new Map<string, ActiveSpan>();
  private readonly resources: BootResourceRecord[] = [];
  private readonly resourcesByKey = new Map<string, BootResourceRecord>();
  private readonly counters = new Map<string, number>();
  private resourceObserver: PerformanceObserver | null = null;
  private spanSequence = 0;
  private resourceSequence = 0;
  private overheadMs = 0;
  private overheadOperations = 0;

  readonly sessionId: string;
  readonly startedAtEpochMs: number;

  constructor(options: BootTelemetryOptions = {}) {
    this.clock = options.now ?? monotonicNow;
    this.epochClock = options.epochNow ?? Date.now;
    this.overheadClock = options.overheadNow ?? monotonicNow;

    const browserTimeline = options.now === undefined && hasBrowserPerformance();
    const constructedAt = finite(this.clock(), 0);
    this.timelineOriginMs = options.timelineOriginMs ?? (browserTimeline ? 0 : constructedAt);
    this.startedAtEpochMs = options.startedAtEpochMs
      ?? (browserTimeline ? finite(globalThis.performance.timeOrigin, this.epochClock()) : this.epochClock());
    this.sessionId = options.sessionId ?? `${Math.round(this.startedAtEpochMs)}-${Math.round(constructedAt)}`;
    this.resourceBufferSize = positiveInteger(options.resourceBufferSize, DEFAULT_RESOURCE_BUFFER_SIZE);

    this.marks.push({ name: BOOT_MILESTONES.SESSION_START, atMs: 0 });
    if (options.captureResources ?? browserTimeline) this.startResourceCapture();
  }

  /** Current time in the report's coordinate system. */
  elapsedMs(): number {
    return roundMs(this.clock() - this.timelineOriginMs);
  }

  mark(name: string, detail?: BootTelemetryDetail): BootMarkRecord {
    const overheadStarted = this.overheadClock();
    const record: BootMarkRecord = {
      name,
      atMs: this.elapsedMs(),
      ...detailField(detail),
    };
    this.marks.push(record);
    this.trackOverhead(overheadStarted);
    return record;
  }

  /** Records a named milestone once. Repeated readiness callbacks return the original mark. */
  milestone(name: BootMilestoneName, detail?: BootTelemetryDetail): BootMarkRecord {
    const existing = this.marks.find((mark) => mark.name === name);
    return existing ?? this.mark(name, detail);
  }

  /** Records an instantaneous span and a same-named mark at one timestamp. */
  instant(name: string, detail?: BootTelemetryDetail): BootSpanRecord {
    const atMs = this.elapsedMs();
    this.marks.push({ name, atMs, ...detailField(detail) });
    return this.recordSpan({ name, startMs: atMs, endMs: atMs, detail });
  }

  startSpan(name: string, options: BootSpanOptions = {}): BootSpanHandle {
    const overheadStarted = this.overheadClock();
    const id = `span-${++this.spanSequence}`;
    const parentId = options.parentId ?? null;
    const active: ActiveSpan = {
      id,
      name,
      parentId,
      startMs: roundMs(options.startMs ?? this.elapsedMs()),
      attributed: options.attributed ?? name !== BOOT_SPANS.TOTAL,
      ...detailField(options.detail),
    };
    this.activeSpans.set(id, active);

    let completed: BootSpanRecord | null = null;
    const finish = (end: BootSpanEndOptions): BootSpanRecord => {
      completed ??= this.finishSpan(id, end);
      return completed;
    };
    const telemetry = this;
    const handle: BootSpanHandle = {
      id,
      name,
      parentId,
      get ended(): boolean { return completed !== null; },
      end: (detail) => finish({ outcome: "ok", detail }),
      fail: (error, detail) => finish({ outcome: "error", error: describeError(error), detail }),
      cancel: (detail) => finish({ outcome: "cancelled", detail }),
      startChild: (childName, childOptions = {}) => telemetry.startSpan(childName, {
        ...childOptions,
        parentId: id,
      }),
    };
    this.trackOverhead(overheadStarted);
    return handle;
  }

  measureSync<T>(
    name: string,
    operation: (span: BootSpanHandle) => T,
    options: BootSpanOptions = {},
  ): T {
    const span = this.startSpan(name, options);
    try {
      const value = operation(span);
      span.end();
      return value;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  }

  async measureAsync<T>(
    name: string,
    operation: (span: BootSpanHandle) => PromiseLike<T>,
    options: BootSpanOptions = {},
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const value = await operation(span);
      span.end();
      return value;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  }

  /** Adds a timing measured outside this class, such as navigation response end to boot entry. */
  recordSpan(input: BootSpanInput): BootSpanRecord {
    const overheadStarted = this.overheadClock();
    const startMs = roundMs(Math.min(input.startMs, input.endMs));
    const endMs = roundMs(Math.max(input.startMs, input.endMs));
    const record: BootSpanRecord = {
      id: input.id ?? `span-${++this.spanSequence}`,
      name: input.name,
      parentId: input.parentId ?? null,
      startMs,
      endMs,
      durationMs: roundMs(endMs - startMs),
      outcome: input.outcome ?? "ok",
      attributed: input.attributed ?? input.name !== BOOT_SPANS.TOTAL,
      ...detailField(input.detail),
      ...(input.error ? { error: input.error } : {}),
    };
    this.spans.push(record);
    this.trackOverhead(overheadStarted);
    return record;
  }

  recordResource(input: BootResourceInput): BootResourceRecord {
    const overheadStarted = this.overheadClock();
    const nowMs = this.elapsedMs();
    const startMs = roundMs(input.startMs ?? nowMs);
    const suppliedDuration = nonNegative(input.durationMs);
    const endMs = roundMs(input.endMs ?? (suppliedDuration === undefined ? startMs : startMs + suppliedDuration));
    const durationMs = roundMs(suppliedDuration ?? Math.max(0, endMs - startMs));
    const key = resourceKey(input.name, input.initiatorType ?? "", startMs, durationMs);
    const duplicate = this.resourcesByKey.get(key);
    if (duplicate) {
      this.trackOverhead(overheadStarted);
      return duplicate;
    }

    const firstPlayableMs = this.firstPlayableMs();
    const record: BootResourceRecord = {
      id: `resource-${++this.resourceSequence}`,
      name: input.name,
      initiatorType: input.initiatorType ?? "",
      startMs,
      endMs,
      durationMs,
      transferSize: nonNegative(input.transferSize) ?? 0,
      encodedBodySize: nonNegative(input.encodedBodySize) ?? 0,
      decodedBodySize: nonNegative(input.decodedBodySize) ?? 0,
      deliveryType: input.deliveryType ?? "",
      nextHopProtocol: input.nextHopProtocol ?? "",
      responseStatus: nonNegative(input.responseStatus) ?? 0,
      preReady: input.preReady ?? (firstPlayableMs === null || startMs <= firstPlayableMs),
      ...detailField(input.detail),
    };
    this.resources.push(record);
    this.resourcesByKey.set(key, record);
    if (this.resources.length > this.resourceBufferSize) this.resources.shift();
    this.trackOverhead(overheadStarted);
    return record;
  }

  /** Pulls buffered Resource Timing entries. The observer also calls this conversion for new rows. */
  recordPerformanceResources(): number {
    const overheadStarted = this.overheadClock();
    const performanceApi = globalThis.performance;
    if (!performanceApi?.getEntriesByType) {
      this.trackOverhead(overheadStarted);
      return 0;
    }
    const before = this.resources.length;
    for (const entry of performanceApi.getEntriesByType("resource")) {
      if (entry.entryType === "resource") this.recordPerformanceResource(entry as PerformanceResourceTiming);
    }
    this.trackOverhead(overheadStarted);
    return this.resources.length - before;
  }

  startResourceCapture(): boolean {
    const overheadStarted = this.overheadClock();
    if (this.resourceObserver || typeof PerformanceObserver === "undefined") {
      this.trackOverhead(overheadStarted);
      return this.resourceObserver !== null;
    }
    try {
      this.resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "resource") {
            this.recordPerformanceResource(entry as PerformanceResourceTiming);
          }
        }
      });
      this.resourceObserver.observe({ type: "resource", buffered: true });
      this.trackOverhead(overheadStarted);
      return true;
    } catch {
      this.resourceObserver?.disconnect();
      this.resourceObserver = null;
      this.trackOverhead(overheadStarted);
      return false;
    }
  }

  stopResourceCapture(): void {
    const overheadStarted = this.overheadClock();
    this.resourceObserver?.disconnect();
    this.resourceObserver = null;
    this.trackOverhead(overheadStarted);
  }

  increment(name: string, amount = 1): number {
    return this.setCounter(name, (this.counters.get(name) ?? 0) + amount);
  }

  setCounter(name: string, value: number): number {
    const overheadStarted = this.overheadClock();
    const safeValue = finite(value, 0);
    this.counters.set(name, safeValue);
    this.trackOverhead(overheadStarted);
    return safeValue;
  }

  /**
   * Finds time with no attributed span. Overlapping and nested spans are merged before durations
   * are added, so parallel WASM initialization cannot make coverage exceed 100 percent.
   */
  getAttribution(options: BootAttributionOptions = {}): BootAttribution {
    const startMs = roundMs(options.startMs ?? 0);
    const endMs = roundMs(Math.max(startMs, options.endMs ?? this.timelineEndMs()));
    const minimumGapMs = Math.max(0, options.minimumGapMs ?? 0);
    const intervals: Array<{ startMs: number; endMs: number }> = [];

    for (const span of this.spans) {
      if (!span.attributed || span.endMs <= startMs || span.startMs >= endMs) continue;
      intervals.push({
        startMs: Math.max(startMs, span.startMs),
        endMs: Math.min(endMs, span.endMs),
      });
    }
    const nowMs = this.elapsedMs();
    for (const span of this.activeSpans.values()) {
      if (!span.attributed || nowMs <= startMs || span.startMs >= endMs) continue;
      intervals.push({
        startMs: Math.max(startMs, span.startMs),
        endMs: Math.min(endMs, nowMs),
      });
    }
    intervals.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

    const merged: Array<{ startMs: number; endMs: number }> = [];
    for (const interval of intervals) {
      if (interval.endMs <= interval.startMs) continue;
      const previous = merged.at(-1);
      if (previous && interval.startMs <= previous.endMs) {
        previous.endMs = Math.max(previous.endMs, interval.endMs);
      } else {
        merged.push({ ...interval });
      }
    }

    const allGaps: BootAttributionGap[] = [];
    let cursor = startMs;
    let accountedMs = 0;
    for (const interval of merged) {
      if (interval.startMs > cursor) allGaps.push(gap(cursor, interval.startMs));
      accountedMs += interval.endMs - interval.startMs;
      cursor = Math.max(cursor, interval.endMs);
    }
    if (cursor < endMs) allGaps.push(gap(cursor, endMs));

    const durationMs = roundMs(endMs - startMs);
    accountedMs = roundMs(Math.min(durationMs, accountedMs));
    const unattributedMs = roundMs(Math.max(0, durationMs - accountedMs));
    const maxGapMs = roundMs(allGaps.reduce((largest, item) => Math.max(largest, item.durationMs), 0));
    return {
      startMs,
      endMs,
      durationMs,
      accountedMs,
      unattributedMs,
      coverage: durationMs > 0 ? Math.min(1, accountedMs / durationMs) : 1,
      maxGapMs,
      gaps: allGaps.filter((item) => item.durationMs >= minimumGapMs),
    };
  }

  snapshot(): BootTelemetrySnapshot {
    this.recordPerformanceResources();
    const generatedAtMs = this.elapsedMs();
    const firstPlayableMs = this.firstPlayableMs();
    const resources = this.resources.map((resource) => ({
      ...resource,
      preReady: firstPlayableMs === null ? resource.preReady : resource.startMs <= firstPlayableMs,
    }));
    return {
      schemaVersion: BOOT_TELEMETRY_SCHEMA_VERSION,
      sessionId: this.sessionId,
      startedAtEpochMs: this.startedAtEpochMs,
      generatedAtEpochMs: this.startedAtEpochMs + generatedAtMs,
      generatedAtMs,
      firstPlayableMs,
      marks: this.marks.map((mark) => ({ ...mark })),
      spans: this.spans.map((span) => ({ ...span })),
      activeSpans: [...this.activeSpans.values()].map((span) => ({
        id: span.id,
        name: span.name,
        parentId: span.parentId,
        startMs: span.startMs,
        elapsedMs: roundMs(Math.max(0, generatedAtMs - span.startMs)),
        attributed: span.attributed,
        ...detailField(span.detail),
      })),
      resources,
      counters: Object.fromEntries([...this.counters.entries()].sort(([left], [right]) => left.localeCompare(right))),
      instrumentationOverheadMs: roundMs(this.overheadMs),
      instrumentationOperations: this.overheadOperations,
      attribution: this.getAttribution({ endMs: this.timelineEndMs(generatedAtMs) }),
    };
  }

  exportJson(space = 0): string {
    return JSON.stringify(this.snapshot(), null, Math.max(0, Math.min(10, Math.trunc(space))));
  }

  private finishSpan(id: string, options: BootSpanEndOptions): BootSpanRecord {
    const overheadStarted = this.overheadClock();
    const active = this.activeSpans.get(id);
    if (!active) throw new Error(`Boot telemetry span is not active: ${id}`);
    const endMs = roundMs(Math.max(active.startMs, options.endMs ?? this.elapsedMs()));
    const record: BootSpanRecord = {
      id: active.id,
      name: active.name,
      parentId: active.parentId,
      startMs: active.startMs,
      endMs,
      durationMs: roundMs(endMs - active.startMs),
      outcome: options.outcome ?? "ok",
      attributed: active.attributed,
      ...detailField(mergeDetail(active.detail, options.detail)),
      ...(options.error ? { error: options.error } : {}),
    };
    this.activeSpans.delete(id);
    this.spans.push(record);
    this.trackOverhead(overheadStarted);
    return record;
  }

  private recordPerformanceResource(entry: PerformanceResourceTiming): void {
    const extra = entry as PerformanceResourceTiming & {
      deliveryType?: string;
      responseStatus?: number;
    };
    this.recordResource({
      name: entry.name,
      initiatorType: entry.initiatorType,
      startMs: entry.startTime - this.timelineOriginMs,
      endMs: entry.responseEnd - this.timelineOriginMs,
      durationMs: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      deliveryType: extra.deliveryType,
      nextHopProtocol: entry.nextHopProtocol,
      responseStatus: extra.responseStatus,
    });
  }

  private firstPlayableMs(): number | null {
    const playable = this.marks.find((mark) => mark.name === BOOT_MILESTONES.FIRST_PLAYABLE)
      ?? this.marks.find((mark) => mark.name === BOOT_MILESTONES.FIRST_RENDERED_FRAME);
    if (playable) return playable.atMs;
    const firstFrame = this.spans.find((span) => span.name === BOOT_SPANS.FIRST_RENDERED_FRAME);
    return firstFrame?.endMs ?? null;
  }

  private timelineEndMs(fallback = this.elapsedMs()): number {
    return this.firstPlayableMs() ?? fallback;
  }

  private trackOverhead(startedAt: number): void {
    this.overheadMs += Math.max(0, this.overheadClock() - startedAt);
    this.overheadOperations += 1;
  }
}

export function createBootTelemetry(options: BootTelemetryOptions = {}): BootTelemetry {
  return new BootTelemetry(options);
}

export const bootTelemetry = createBootTelemetry();

export function getBootTelemetryDiagnostics(): BootTelemetrySnapshot {
  return bootTelemetry.snapshot();
}

const globalHook: BootTelemetryGlobalHook = Object.freeze({
  schemaVersion: BOOT_TELEMETRY_SCHEMA_VERSION,
  snapshot: () => bootTelemetry.snapshot(),
  getAttribution: (options?: BootAttributionOptions) => bootTelemetry.getAttribution(options),
  exportJson: (space?: number) => bootTelemetry.exportJson(space),
});

installGlobalHook(globalHook);

function installGlobalHook(hook: BootTelemetryGlobalHook): void {
  try {
    Object.defineProperty(globalThis, BOOT_TELEMETRY_GLOBAL, {
      configurable: true,
      enumerable: false,
      value: hook,
    });
  } catch {
    // A hardened page can forbid new globals. The imported singleton remains usable in that case.
  }
}

function hasBrowserPerformance(): boolean {
  return typeof window !== "undefined"
    && typeof globalThis.performance?.now === "function"
    && Number.isFinite(globalThis.performance.timeOrigin);
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : Math.max(0, value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.trunc(value));
}

function roundMs(value: number): number {
  return Math.round(finite(value, 0) * 1_000) / 1_000;
}

function gap(startMs: number, endMs: number): BootAttributionGap {
  return { startMs, endMs, durationMs: roundMs(endMs - startMs) };
}

function resourceKey(name: string, initiatorType: string, startMs: number, durationMs: number): string {
  return `${name}\u0000${initiatorType}\u0000${startMs}\u0000${durationMs}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

function mergeDetail(
  first: BootTelemetryDetail | undefined,
  second: BootTelemetryDetail | undefined,
): BootTelemetryDetail | undefined {
  if (!first) return second;
  if (!second) return first;
  return { ...first, ...second };
}

function detailField(
  detail: BootTelemetryDetail | undefined,
): { detail?: BootTelemetryDetail } {
  const safe = sanitizeDetail(detail);
  return safe ? { detail: safe } : {};
}

function sanitizeDetail(detail: BootTelemetryDetail | undefined): BootTelemetryDetail | undefined {
  if (!detail) return undefined;
  const sanitized = sanitizeJson(detail, new WeakSet<object>(), 0);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") return undefined;
  return sanitized;
}

function sanitizeJson(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= MAX_DETAIL_DEPTH || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeJson(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = sanitizeJson(item, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}
