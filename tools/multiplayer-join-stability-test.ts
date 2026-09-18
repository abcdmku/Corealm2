import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import {
  WORLD_CONTENT_VERSION,
  WORLD_LAB_CONTENT_VERSION,
  WORLD_PROTOCOL_VERSION,
  SKILL_IDS,
  type WorldDescriptor,
} from "../game/src/contracts.js";
import { setSkillLevel } from "../game/src/state/store.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startAuthoredTestHost } from "./lib/authoredTestHost.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

/**
 * Narrow browser reproduction for a second-player join stalling the first player and/or making
 * the remote view disappear while the renderer prepares a body or a newly equipped item.
 *
 * The lab path is the normal acceptance gate. `--authored` is deliberately available for the
 * later final-world wiring check and uses the existing 120-second authored host budget. The root
 * agent should run that mode only after the lab result is accepted.
 */

const authored = process.argv.includes("--authored");
const profileEnabled = process.argv.includes("--profile");
const observeOnly = process.argv.includes("--observe-only");
const budget = authored ? 120_000 : 60_000;
const clearDeadline = installTestDeadline("multiplayer join stability", budget);
const startedAtMs = Date.now();
const out = `test-results/multiplayer-join-stability${authored ? "-authored" : ""}`;
await mkdir(out, { recursive: true });

const world: WorldDescriptor = {
  providerId: "reference",
  worldId: authored ? "authored" : "join-stability",
  name: authored ? "Authored join stability" : "Join stability lab",
  endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION,
  contentVersion: authored ? WORLD_CONTENT_VERSION : WORLD_LAB_CONTENT_VERSION,
  seed: 1337,
  capacity: 1000,
  population: 0,
  availability: "available",
};

type PhaseMarker = {
  phase: string;
  atMs: number;
  elapsedMs: number;
  details?: Record<string, unknown>;
};

type RafSample = {
  startAtMs: number;
  endAtMs: number;
  atMs: number;
  elapsedMs: number;
};

type LongTaskSample = {
  atMs: number;
  elapsedMs: number;
  durationMs: number;
  name: string;
};

type GlSlowCall = {
  method: string;
  atMs: number;
  elapsedMs: number;
  durationMs: number;
};

type BrowserTrace = {
  page: string;
  timeOriginMs: number;
  bootAtMs: number;
  phaseMarkers: PhaseMarker[];
  raf: RafSample[];
  presentation: PresentationSample[];
  longTasks: LongTaskSample[];
  glSlowCalls: GlSlowCall[];
};

type PresentationSample = {
  atMs: number;
  elapsedMs: number;
  submitted: number;
  completed: number;
  skipped: number;
  pending: number;
  pendingMs: number;
  completedAtMs: number;
  failed: boolean;
};

type NetworkCommand = {
  sequence: number;
  operation?: number;
  method?: string;
  atMs: number;
};

type NetworkAck = {
  sequence: number;
  status?: string;
  atMs: number;
  latencyMs?: number;
};

type NetworkUpdate = {
  sequence: number;
  tick: number;
  acknowledgedCommand: number;
  snapshot: boolean;
  playerIds: string[];
  atMs: number;
};

type NetworkTrace = {
  page: string;
  sockets: number;
  socketOpens: number;
  socketCloses: number;
  commands: NetworkCommand[];
  acknowledgements: NetworkAck[];
  updates: NetworkUpdate[];
  joins: { atMs: number; worldId?: string }[];
  joined: { atMs: number; sessionId?: string; playerId?: string }[];
  assetRequests: { atMs: number; url: string; resourceType: string; method: string }[];
  errors: { atMs: number; message: string }[];
};

type RenderDiagnostic = {
  equipment?: Record<string, string>;
  renderedMeshes?: number;
  expectedMeshes?: number;
  complete?: boolean;
  mode?: string;
  sourceReady?: boolean;
  preparing?: boolean;
  pendingReplacement?: boolean;
  [key: string]: unknown;
};

type MotionDiagnostic = {
  path?: string | null;
  drawnPosition?: number[];
  drawnRotationY?: number;
  motion?: string | null;
  [key: string]: unknown;
};

type PresentationRow = {
  id: string;
  equipment?: Record<string, string>;
  materials?: string[];
  motion?: MotionDiagnostic | null;
  render?: RenderDiagnostic | null;
  activity?: unknown;
};

type PlayerRow = { id: string; position: number[]; [key: string]: unknown };

type LabObservation = {
  phase: string;
  players: PlayerRow[];
  visiblePlayerIds: string[];
  presentation: PresentationRow[];
  player: { position: number[]; [key: string]: unknown };
  tick: number | null;
  sessionId: string | null;
  [key: string]: unknown;
};

type PresenceSample = {
  atMs: number;
  elapsedMs: number;
  semanticPresent: boolean;
  visiblePresent: boolean;
  presentationPresent: boolean;
  motionPresent: boolean;
  renderAvailable: boolean;
  renderedMeshes: number | null;
  expectedMeshes: number | null;
  renderComplete: boolean | null;
  renderPresent: boolean | null;
  displayPresent: boolean;
  equipment?: Record<string, string>;
  motionPath?: string | null;
  renderMode?: string;
  tick: number | null;
  sessionId: string | null;
};

type ScreenshotWindow = {
  name: string;
  startAtMs: number;
  endAtMs: number;
};

type PageRecord = {
  name: string;
  context: BrowserContext;
  page: Page;
  trace: BrowserTrace;
  network: NetworkTrace;
};

type JoinMotionHandle = {
  stop(): Promise<{
    before: LabObservation;
    after: LabObservation;
    beforeCamera: Record<string, unknown> | null;
    afterCamera: Record<string, unknown> | null;
  }>;
};

type JoinTiming = {
  playerId: string;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  error?: string;
};

const errors: { page: string; source: string; message: string }[] = [];
const screenshots: ScreenshotWindow[] = [];
const checks: Record<string, boolean> = {};
const joinTimings: JoinTiming[] = [];
const pages: PageRecord[] = [];
const pendingOperations: Promise<unknown>[] = [];
let activeJoinMotion: JoinMotionHandle | undefined;

function markCheck(name: string, value: boolean): void {
  checks[name] = Boolean(value);
}

function parseFrame(payload: unknown): Record<string, any> | null {
  try {
    const value = JSON.parse(String(payload));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
  } catch {
    return null;
  }
}

async function installBrowserInstrumentation(context: BrowserContext, pageName: string): Promise<void> {
  await context.addInitScript("window.__name = (fn) => fn");
  await context.addInitScript((name: string) => {
    const start = performance.now();
    const timeOrigin = performance.timeOrigin;
    const trace: BrowserTrace = {
      page: name,
      timeOriginMs: timeOrigin,
      bootAtMs: timeOrigin + start,
      phaseMarkers: [],
      raf: [],
      presentation: [],
      longTasks: [],
      glSlowCalls: [],
    };
    const cap = <T>(rows: T[], limit = 16_000): void => {
      if (rows.length > limit) rows.splice(0, rows.length - limit);
    };
    const mark = (phase: string, details?: Record<string, unknown>): PhaseMarker => {
      const elapsedMs = performance.now();
      const marker = { phase, atMs: timeOrigin + elapsedMs, elapsedMs, ...(details ? { details } : {}) };
      trace.phaseMarkers.push(marker);
      cap(trace.phaseMarkers, 512);
      return marker;
    };
    Reflect.set(trace, "mark", mark);
    Reflect.set(window, "__joinStabilityTrace", trace);
    mark("boot-init");

    let previousAtMs: number | null = null;
    const sampleFrame = (timestamp: number) => {
      const elapsedMs = timestamp;
      const atMs = timeOrigin + elapsedMs;
      if (previousAtMs !== null) {
        trace.raf.push({ startAtMs: previousAtMs, endAtMs: atMs, atMs, elapsedMs });
        cap(trace.raf);
      }
      previousAtMs = atMs;
      const debug = Reflect.get(window, "__gameDebug") as { getPresentationState?: () => {
        submitted?: unknown; completed?: unknown; skipped?: unknown; pending?: unknown;
        pendingMs?: unknown; completedAt?: unknown; failed?: unknown;
      } } | undefined;
      if (typeof debug?.getPresentationState === "function") {
        try {
          const state = debug.getPresentationState();
          const numberOrZero = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
          trace.presentation.push({
            atMs,
            elapsedMs,
            submitted: numberOrZero(state.submitted),
            completed: numberOrZero(state.completed),
            skipped: numberOrZero(state.skipped),
            pending: numberOrZero(state.pending),
            pendingMs: numberOrZero(state.pendingMs),
            completedAtMs: state.completedAt && typeof state.completedAt === "number"
              ? timeOrigin + state.completedAt : 0,
            failed: state.failed === true,
          });
          cap(trace.presentation);
        } catch {
          // Debug surfaces can be replaced while the authored world transitions into gameplay.
        }
      }
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            trace.longTasks.push({
              atMs: timeOrigin + entry.startTime,
              elapsedMs: entry.startTime,
              durationMs: entry.duration,
              name: entry.name,
            });
          }
          cap(trace.longTasks);
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Some Chromium builds expose PerformanceObserver without the longtask entry type.
      }
    }
  }, pageName);

  if (profileEnabled) {
    await context.addInitScript(() => {
      const trace = (): BrowserTrace | null => Reflect.get(window, "__joinStabilityTrace") as BrowserTrace | null;
      const wrap = (ctorName: "WebGLRenderingContext" | "WebGL2RenderingContext", method: string) => {
        const ctor = Reflect.get(window, ctorName) as unknown as { prototype?: Record<string, unknown> } | undefined;
        const prototype = ctor?.prototype;
        const original = prototype?.[method];
        if (!prototype || typeof original !== "function") return;
        prototype[method] = function (this: unknown, ...args: unknown[]) {
          const started = performance.now();
          try {
            return (original as (...input: unknown[]) => unknown).apply(this, args);
          } finally {
            const elapsedMs = performance.now();
            const durationMs = elapsedMs - started;
            if (durationMs >= 4) {
              const current = trace();
              current?.glSlowCalls.push({
                method: `${ctorName}.${method}`,
                atMs: performance.timeOrigin + started,
                elapsedMs: started,
                durationMs,
              });
            }
          }
        };
      };
      for (const ctor of ["WebGLRenderingContext", "WebGL2RenderingContext"] as const) {
        wrap(ctor, "getProgramInfoLog");
        wrap(ctor, "getProgramParameter");
      }
    });
  }
}

function installSocketInstrumentation(page: Page, network: NetworkTrace): void {
  page.on("websocket", (socket) => {
    network.sockets += 1;
    const sent = new Map<number, number>();
    socket.on("framesent", (frame) => {
      const atMs = Date.now();
      const message = parseFrame(frame.payload);
      if (!message) return;
      if (message.type === "join") {
        network.joins.push({ atMs, worldId: typeof message.worldId === "string" ? message.worldId : undefined });
      } else if (message.type === "command" && message.envelope && Number.isSafeInteger(message.envelope.sequence)) {
        const sequence = Number(message.envelope.sequence);
        const method = message.envelope.command?.method;
        const row: NetworkCommand = {
          sequence,
          operation: Number.isSafeInteger(message.envelope.operation) ? Number(message.envelope.operation) : undefined,
          method: typeof method === "string" ? method : undefined,
          atMs,
        };
        network.commands.push(row);
        sent.set(sequence, atMs);
      }
      if (network.commands.length > 4096) network.commands.splice(0, network.commands.length - 4096);
      if (network.joins.length > 32) network.joins.splice(0, network.joins.length - 32);
    });
    socket.on("framereceived", (frame) => {
      const atMs = Date.now();
      const message = parseFrame(frame.payload);
      if (!message) return;
      if (message.type === "joined") {
        network.joined.push({ atMs, sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined,
          playerId: typeof message.playerId === "string" ? message.playerId : undefined });
      } else if (message.type === "ack" && message.outcome && Number.isSafeInteger(message.outcome.sequence)) {
        const sequence = Number(message.outcome.sequence);
        const sentAt = sent.get(sequence);
        network.acknowledgements.push({ sequence, status: typeof message.outcome.status === "string" ? message.outcome.status : undefined,
          atMs, ...(sentAt === undefined ? {} : { latencyMs: atMs - sentAt }) });
        sent.delete(sequence);
      } else if (message.type === "update" && message.update && Number.isSafeInteger(message.update.sequence)
        && Number.isSafeInteger(message.update.tick)) {
        network.updates.push({
          sequence: Number(message.update.sequence),
          tick: Number(message.update.tick),
          acknowledgedCommand: Number.isSafeInteger(message.update.acknowledgedCommand) ? Number(message.update.acknowledgedCommand) : 0,
          snapshot: message.update.snapshot === true,
          playerIds: Array.isArray(message.update.players) ? message.update.players
            .map((player: unknown) => (player && typeof player === "object" && typeof (player as { id?: unknown }).id === "string")
              ? String((player as { id: string }).id) : "")
            .filter(Boolean) : [],
          atMs,
        });
      } else if (message.type === "error") {
        network.errors.push({ atMs, message: String(message.error?.message ?? "network error") });
      }
      if (network.acknowledgements.length > 4096) network.acknowledgements.splice(0, network.acknowledgements.length - 4096);
      if (network.updates.length > 4096) network.updates.splice(0, network.updates.length - 4096);
      if (network.joined.length > 32) network.joined.splice(0, network.joined.length - 32);
      if (network.errors.length > 128) network.errors.splice(0, network.errors.length - 128);
    });
    socket.on("close", () => { network.socketCloses += 1; });
    network.socketOpens += 1;
  });
}

function installAssetInstrumentation(page: Page, network: NetworkTrace): void {
  page.on("request", (request) => {
    const url = request.url();
    // Keep the browser event stream bounded while retaining every model request. The equipment
    // assertions below match the authored manifest path, rather than relying on an entity id.
    if (!/\.(?:glb|gltf|bin)(?:[?#]|$)/i.test(url)) return;
    network.assetRequests.push({ atMs: Date.now(), url, resourceType: request.resourceType(), method: request.method() });
    if (network.assetRequests.length > 8192) network.assetRequests.splice(0, network.assetRequests.length - 8192);
  });
}

async function markPhase(record: PageRecord, phase: string, details?: Record<string, unknown>): Promise<PhaseMarker | null> {
  return record.page.evaluate(({ phase, details }) => {
    const trace = Reflect.get(window, "__joinStabilityTrace") as (BrowserTrace & {
      mark?: (name: string, values?: Record<string, unknown>) => PhaseMarker;
    }) | null;
    return trace?.mark?.(phase, details) ?? null;
  }, { phase, details });
}

async function observe(page: Page): Promise<LabObservation> {
  return page.evaluate(() => {
    const surface = Reflect.get(window, "__multiplayerLab") as { observe(): LabObservation } | undefined;
    if (!surface) return { phase: "missing", players: [], visiblePlayerIds: [], presentation: [], player: { position: [] }, tick: null, sessionId: null };
    const state = surface.observe();
    // Copy only motion evidence across DevTools. Serializing the full resident world here
    // stalls Chromium itself and contaminates the frame window this test is measuring.
    return {
      phase: state.phase,
      players: state.players.map(({ id, position }) => ({ id, position })),
      visiblePlayerIds: state.visiblePlayerIds,
      presentation: state.presentation,
      player: { position: state.player.position },
      tick: state.tick,
      sessionId: state.sessionId,
    };
  });
}

async function camera(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const debug = Reflect.get(window, "__gameDebug") as { getCamera?: () => Record<string, unknown> } | undefined;
    return typeof debug?.getCamera === "function" ? debug.getCamera() : null;
  });
}

async function phaseMarker(record: PageRecord, phase: string): Promise<PhaseMarker | null> {
  return record.page.evaluate((name) => {
    const trace = Reflect.get(window, "__joinStabilityTrace") as BrowserTrace | undefined;
    return trace?.phaseMarkers.find((marker) => marker.phase === name) ?? null;
  }, phase);
}

async function capture(record: PageRecord, name: string): Promise<void> {
  const before = await markPhase(record, `screenshot:${name}:start`);
  await record.page.screenshot({ path: `${out}/${name}.png`, timeout: 5000 });
  const after = await markPhase(record, `screenshot:${name}:end`);
  if (before && after) screenshots.push({ name, startAtMs: before.atMs, endAtMs: after.atMs });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cameraYaw(value: Record<string, unknown> | null): number | null {
  return finiteNumber(value?.yaw);
}

function position2(value: { position?: unknown } | null): [number, number] | null {
  const position = value?.position;
  if (!Array.isArray(position) || position.length < 3) return null;
  const x = finiteNumber(position[0]);
  const z = finiteNumber(position[2]);
  return x === null || z === null ? null : [x, z];
}

async function driveFirstPlayer(record: PageRecord): Promise<{
  before: LabObservation;
  after: LabObservation;
  beforeCamera: Record<string, unknown> | null;
  afterCamera: Record<string, unknown> | null;
}> {
  await markPhase(record, "alice-motion-start");
  const before = await observe(record.page);
  const beforeCamera = await camera(record.page);
  const canvas = record.page.locator("canvas").first();
  await canvas.click({ position: { x: 620, y: 360 } });
  await record.page.keyboard.down("w");
  let orbitHeld = false;
  try {
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Gameplay canvas has no bounds");
    const x = box.x + box.width * 0.52;
    const y = box.y + box.height * 0.46;
    await record.page.mouse.move(x, y);
    await record.page.mouse.down({ button: "right" });
    orbitHeld = true;
    for (let index = 1; index <= 12; index++) {
      await record.page.mouse.move(x + index * 8, y + (index % 3) * 2);
      await record.page.waitForTimeout(45);
      if (index === 4) await record.page.keyboard.up("w");
    }
    await record.page.mouse.up({ button: "right" });
    orbitHeld = false;
    await record.page.waitForTimeout(650);
  } finally {
    if (orbitHeld) await record.page.mouse.up({ button: "right" }).catch(() => {});
    await record.page.keyboard.up("w").catch(() => {});
  }
  const after = await observe(record.page);
  const afterCamera = await camera(record.page);
  await markPhase(record, "alice-motion-ready", {
    playerPosition: after.player.position,
    cameraYaw: cameraYaw(afterCamera),
  });
  return { before, after, beforeCamera, afterCamera };
}

/** Hold the real movement and orbit controls while Bob's join is in flight. */
async function beginJoinMotion(record: PageRecord): Promise<JoinMotionHandle> {
  const before = await observe(record.page);
  const beforeCamera = await camera(record.page);
  await markPhase(record, "alice-motion-during-join-start", {
    playerPosition: before.player.position,
    cameraYaw: cameraYaw(beforeCamera),
  });
  const canvas = record.page.locator("canvas").first();
  await canvas.click({ position: { x: 620, y: 360 } });
  await record.page.keyboard.down("w");
  const box = await canvas.boundingBox();
  if (!box) {
    await record.page.keyboard.up("w").catch(() => {});
    throw new Error("Gameplay canvas has no bounds for join-overlap motion");
  }
  const x = box.x + box.width * 0.52;
  const y = box.y + box.height * 0.46;
  await record.page.mouse.move(x, y);
  await record.page.mouse.down({ button: "right" });
  let stopped = false;
  let orbitFailure: unknown;
  const orbit = (async () => {
    let index = 0;
    try {
      while (!stopped) {
        index += 1;
        await record.page.mouse.move(x + (index % 30) * 7, y + ((index % 5) - 2) * 2);
        await record.page.waitForTimeout(45);
        // Keep both players in the ordinary follow camera while orbiting through preparation.
        if (index === 6) await record.page.keyboard.up("w");
      }
    } catch (error) {
      if (!stopped) orbitFailure = error;
    }
  })();
  return {
    stop: async () => {
      if (stopped) {
        return { before, after: await observe(record.page), beforeCamera, afterCamera: await camera(record.page) };
      }
      stopped = true;
      await orbit;
      await record.page.mouse.up({ button: "right" }).catch(() => {});
      await record.page.keyboard.up("w").catch(() => {});
      if (orbitFailure) throw orbitFailure;
      const after = await observe(record.page);
      const afterCamera = await camera(record.page);
      await markPhase(record, "alice-motion-during-join-end", {
        playerPosition: after.player.position,
        cameraYaw: cameraYaw(afterCamera),
      });
      return { before, after, beforeCamera, afterCamera };
    },
  };
}

async function refreshTrace(record: PageRecord): Promise<void> {
  try {
    const trace = await record.page.evaluate(() => Reflect.get(window, "__joinStabilityTrace") as BrowserTrace);
    if (trace) record.trace = trace;
  } catch (error) {
    errors.push({ page: record.name, source: "trace-refresh", message: pageSafeError(error) });
  }
}

async function samplePresence(page: Page, playerId: string, durationMs: number): Promise<PresenceSample[]> {
  return page.evaluate(async ({ playerId, durationMs }) => {
    const trace = Reflect.get(window, "__joinStabilityTrace") as BrowserTrace | undefined;
    const started = performance.now();
    const rows: PresenceSample[] = [];
    await new Promise<void>((resolve) => {
      const frame = () => {
        const elapsedMs = performance.now();
        const atMs = performance.timeOrigin + elapsedMs;
        const state = (Reflect.get(window, "__multiplayerLab") as { observe(): LabObservation }).observe();
        const semanticPresent = state.players.some((player) => player.id === `remote:${playerId}`);
        const visiblePresent = state.visiblePlayerIds.includes(playerId);
        const presentation = state.presentation.find((row) => row.id === playerId);
        const motionPresent = presentation?.motion != null;
        const render = presentation?.render ?? null;
        const renderAvailable = render !== null;
        const renderedMeshes = typeof render?.renderedMeshes === "number" ? render.renderedMeshes : null;
        const expectedMeshes = typeof render?.expectedMeshes === "number" ? render.expectedMeshes : null;
        const renderComplete = typeof render?.complete === "boolean" ? render.complete : null;
        const renderPresent = renderAvailable
          ? (renderComplete !== null ? renderComplete && (renderedMeshes ?? 0) > 0 : renderedMeshes !== null && renderedMeshes > 0)
          : null;
        const presentationPresent = presentation !== undefined;
        const displayPresent = semanticPresent && visiblePresent && presentationPresent && motionPresent
          && (renderAvailable ? renderPresent === true : true);
        rows.push({
          atMs,
          elapsedMs,
          semanticPresent,
          visiblePresent,
          presentationPresent,
          motionPresent,
          renderAvailable,
          renderedMeshes,
          expectedMeshes,
          renderComplete,
          renderPresent,
          displayPresent,
          ...(presentation?.equipment ? { equipment: presentation.equipment } : {}),
          motionPath: presentation?.motion?.path ?? null,
          ...(presentation?.render?.mode ? { renderMode: presentation.render.mode } : {}),
          tick: state.tick,
          sessionId: state.sessionId,
        });
        if (elapsedMs - started >= durationMs) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    if (trace) {
      const marker = {
        phase: `presence-sample:${playerId}`,
        atMs: performance.timeOrigin + started,
        elapsedMs: started,
        details: { durationMs, samples: rows.length },
      };
      trace.phaseMarkers.push(marker);
    }
    return rows;
  }, { playerId, durationMs });
}

function presenceAnalysis(samples: PresenceSample[], afterAtMs?: number): Record<string, unknown> {
  const relevant = afterAtMs === undefined ? samples : samples.filter((sample) => sample.atMs >= afterAtMs);
  const renderDiagnosticAvailable = relevant.some((sample) => sample.renderAvailable);
  const incompleteRenderCount = relevant.filter((sample) => sample.renderedMeshes !== null
    && sample.renderedMeshes > 0 && sample.renderComplete === false).length;
  const firstDisplayIndex = relevant.findIndex((sample) => sample.displayPresent);
  if (firstDisplayIndex < 0) {
    return {
      samples: relevant.length,
      renderDiagnosticAvailable,
      firstDisplayAtMs: null,
      disappearanceRuns: [],
      disappearanceCount: 0,
      maxDisappearanceMs: null,
      noRepeatedDisappearance: false,
      incompleteRenderCount,
      last: relevant.at(-1) ?? null,
    };
  }
  const afterFirst = relevant.slice(firstDisplayIndex);
  const runs: { startAtMs: number; endAtMs: number; durationMs: number; sampleCount: number }[] = [];
  let missing: PresenceSample[] = [];
  const closeRun = () => {
    if (!missing.length) return;
    const first = missing[0]!;
    const last = missing.at(-1)!;
    runs.push({ startAtMs: first.atMs, endAtMs: last.atMs, durationMs: Math.max(0, last.atMs - first.atMs), sampleCount: missing.length });
    missing = [];
  };
  for (const sample of afterFirst) {
    if (sample.displayPresent) closeRun();
    else missing.push(sample);
  }
  closeRun();
  const maxDisappearanceMs = runs.reduce((max, run) => Math.max(max, run.durationMs), 0);
  return {
    samples: relevant.length,
    renderDiagnosticAvailable,
    firstDisplayAtMs: afterFirst[0]!.atMs,
    firstDisplayLatencyMs: afterFirst[0]!.atMs - relevant[0]!.atMs,
    disappearanceRuns: runs,
    disappearanceCount: runs.length,
    maxDisappearanceMs,
    noRepeatedDisappearance: runs.length === 0,
    incompleteRenderCount,
    last: relevant.at(-1) ?? null,
  };
}

function summarize(values: number[]): { count: number; p50: number; p95: number; max: number } {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: at(1) };
}

function markerAt(trace: BrowserTrace, phase: string): number | undefined {
  return trace.phaseMarkers.find((marker) => marker.phase === phase)?.atMs;
}

function framePacing(trace: BrowserTrace, startPhase: string, endPhase: string): Record<string, unknown> {
  const startAtMs = markerAt(trace, startPhase);
  const endAtMs = markerAt(trace, endPhase);
  if (startAtMs === undefined || endAtMs === undefined || endAtMs < startAtMs) {
    return {
      startAtMs,
      endAtMs,
      available: false,
      raf: summarize([]),
      presentationAvailable: false,
      presentationSamples: 0,
      completionAdvances: 0,
      completionGapsMs: summarize([]),
      pendingMs: summarize([]),
      maxObservedMs: null,
      passed: false,
    };
  }

  const raf = trace.raf
    .filter((row) => row.startAtMs >= startAtMs && row.endAtMs <= endAtMs)
    .map((row) => row.endAtMs - row.startAtMs);
  const presentation = trace.presentation
    .filter((row) => row.atMs >= startAtMs && row.atMs <= endAtMs);
  const completionTimes: number[] = [];
  let previousCompleted = -1;
  for (const row of presentation) {
    if (row.completed <= previousCompleted) continue;
    previousCompleted = row.completed;
    const completedAtMs = row.completedAtMs > 0 ? row.completedAtMs : row.atMs;
    if (!completionTimes.length || completedAtMs > completionTimes.at(-1)!) completionTimes.push(completedAtMs);
  }
  const completionGaps = completionTimes.length
    ? [completionTimes[0]! - startAtMs, ...completionTimes.slice(1).map((at, index) => at - completionTimes[index]!), endAtMs - completionTimes.at(-1)!]
    : [endAtMs - startAtMs];
  const pendingMs = presentation.map((row) => row.pendingMs);
  const rafStats = summarize(raf);
  const completionStats = summarize(completionGaps);
  const pendingStats = summarize(pendingMs);
  const maxObservedMs = Math.max(rafStats.max, completionStats.max, pendingStats.max);
  return {
    startAtMs,
    endAtMs,
    available: true,
    raf: rafStats,
    presentationAvailable: presentation.length > 0,
    presentationSamples: presentation.length,
    presentationEntries: presentation,
    completionAdvances: Math.max(0, completionTimes.length - 1),
    completionGapsMs: completionStats,
    pendingMs: pendingStats,
    maxObservedMs,
    // A browser without the debug presentation surface must not silently pass the GPU gate.
    passed: rafStats.max < 150 && rafStats.p95 < 50 && presentation.length > 0 && maxObservedMs <= 150,
  };
}

function traceSummary(trace: BrowserTrace): Record<string, unknown> {
  const screenshotRanges = screenshots.filter((shot) => shot.startAtMs <= (trace.raf.at(-1)?.endAtMs ?? Infinity)
    && shot.endAtMs >= (trace.raf[0]?.startAtMs ?? -Infinity));
  const insideScreenshot = (startAtMs: number, endAtMs: number) => screenshotRanges.some((shot) =>
    startAtMs < shot.endAtMs && endAtMs > shot.startAtMs);
  const connectedAt = trace.phaseMarkers.find(marker => marker.phase === "connected")?.atMs ?? Infinity;
  const raf = trace.raf.filter((sample) => sample.startAtMs >= connectedAt && !insideScreenshot(sample.startAtMs, sample.endAtMs));
  const longTasks = trace.longTasks.filter((task) => task.atMs >= connectedAt && !insideScreenshot(task.atMs, task.atMs + task.durationMs));
  return {
    page: trace.page,
    timeOriginMs: trace.timeOriginMs,
    phaseMarkers: trace.phaseMarkers,
    raf: {
      samples: raf.length,
      intervalsMs: summarize(raf.map((sample) => sample.elapsedMs - (sample.startAtMs - trace.timeOriginMs))),
      maxIntervalMs: Math.max(0, ...raf.map((sample) => sample.elapsedMs - (sample.startAtMs - trace.timeOriginMs))),
      entries: raf,
      excludedScreenshotIntervals: trace.raf.length - raf.length,
    },
    presentation: {
      samples: trace.presentation.length,
      entries: trace.presentation,
    },
    longTasks: {
      count: longTasks.length,
      totalMs: longTasks.reduce((sum, task) => sum + task.durationMs, 0),
      maxMs: Math.max(0, ...longTasks.map((task) => task.durationMs)),
      entries: longTasks,
      excludedScreenshotEntries: trace.longTasks.length - longTasks.length,
    },
    glSlowCalls: trace.glSlowCalls,
    windows: ["second-join", "equipment"].map(name => {
      const startPhase = name === "equipment"
        ? (markerAt(trace, "equipment-window-start") !== undefined ? "equipment-window-start" : "equipment-change-start")
        : `${name}-window-start`;
      const start = trace.phaseMarkers.find(marker => marker.phase === startPhase)?.atMs;
      const end = trace.phaseMarkers.find(marker => marker.phase === `${name}-window-end`)?.atMs;
      return {
        name,
        start,
        end,
        frames: summarize(raf.filter(row => start !== undefined && end !== undefined && row.startAtMs >= start && row.endAtMs <= end).map(row => row.endAtMs - row.startAtMs)),
        pacing: framePacing(trace, startPhase, `${name}-window-end`),
      };
    }),
  };
}

function pageSafeError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function waitForConnected(record: PageRecord, timeoutMs: number): Promise<boolean> {
  try {
    await record.page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: timeoutMs });
    return true;
  } catch (error) {
    errors.push({ page: record.name, source: "join", message: pageSafeError(error) });
    return false;
  }
}

async function closeLabPanel(record: PageRecord): Promise<void> {
  const back = record.page.getByRole("button", { name: "Back to menu", exact: true });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await record.page.getByRole("button", { name: "Return to game", exact: true }).click();
  }
  const close = record.page.getByRole("button", { name: "Close Feature lab", exact: true });
  if (await close.count() && await close.isVisible().catch(() => false)) await close.click();
}

async function openPage(name: string, endpoint: string, game: { url: string }): Promise<PageRecord> {
  const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  await installBrowserInstrumentation(context, name);
  await context.addInitScript(({ descriptor }) => {
    window.__COREALM_MULTIPLAYER__ = descriptor;
    window.__COREALM_DEVELOPMENT_GUESTS__ = true;
    localStorage.setItem("corealm.settings.v1", JSON.stringify({
      renderScale: 0.7,
      shadowQuality: "low",
      drawDistance: "near",
      music: 0,
      ambient: 0,
      sfx: 0,
    }));
  }, { descriptor: { ...world, endpoint } });
  const page = await context.newPage();
  const trace: BrowserTrace = {
    page: name,
    timeOriginMs: 0,
    bootAtMs: 0,
    phaseMarkers: [],
    raf: [],
    presentation: [],
    longTasks: [],
    glSlowCalls: [],
  };
  const network: NetworkTrace = {
    page: name,
    sockets: 0,
    socketOpens: 0,
    socketCloses: 0,
    commands: [],
    acknowledgements: [],
    updates: [],
    joins: [],
    joined: [],
    assetRequests: [],
    errors: [],
  };
  const record: PageRecord = { name, context, page, trace, network };
  pages.push(record);
  installSocketInstrumentation(page, network);
  installAssetInstrumentation(page, network);
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push({ page: name, source: "pageerror", message: error.stack ?? error.message }));
  page.on("console", (message) => { if (message.type() === "error") errors.push({ page: name, source: "console", message: message.text() }); });
  await page.goto(`${game.url}/index.html${authored ? "" : "?mode=combat&multiplayer=1&worldMenu=1"}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!(Reflect.get(window, "__multiplayerLab")), null, { timeout: authored ? 60_000 : 25_000 });
  await markPhase(record, "lab-ready");
  if (!(await page.locator("#multiplayer-selector").isVisible())) {
    const menu = page.getByRole("button", { name: "Open menu", exact: true });
    if (await menu.isVisible().catch(() => false)) await menu.click();
    await page.getByRole("button", { name: "Worlds", exact: true }).click();
  }
  await page.getByRole("textbox", { name: "Development guest name" }).fill(name);
  await markPhase(record, "ready-for-join", { playerId: name });
  return record;
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let game: Awaited<ReturnType<typeof startGameServer>> | undefined;
let local: Awaited<ReturnType<typeof startReferenceServer>> | undefined;
let authoredHost: Awaited<ReturnType<typeof startAuthoredTestHost>> | undefined;
let profiler: CDPSession | undefined;
let profilerStarted = false;
let failure: string | null = null;
let presenceJoin: PresenceSample[] = [];
let presenceEquipment: PresenceSample[] = [];
let motionEvidence: Record<string, unknown> = {};
let cameraEvidence: Record<string, unknown> = {};
let framePacingEvidence: Record<string, unknown> = {};
let equipmentEvidence: Record<string, unknown> = {};

try {
  if (authored) authoredHost = await startAuthoredTestHost(65_000);
  else {
    local = await startReferenceServer({
      worlds: [world],
      storage: new SqliteWorldStorage(":memory:"),
      build: () => createMultiplayerLabWorld(),
      authentication: { authenticate: async (token) => {
        const id = token.startsWith("guest:") ? token.slice(6) : token;
        return { playerId: id, name: id };
      } },
    });
  }
  const endpoint = `ws://127.0.0.1:${(authoredHost ?? local)!.port}/`;
  if (authored) console.log(JSON.stringify({ phase: "host-ready", elapsedMs: Date.now() - startedAtMs }));
  if (local) {
    const runtime = [...local.worlds.values()][0]!.runtime;
    const originalJoin = runtime.join.bind(runtime);
    runtime.join = (playerId: string) => {
      const started = Date.now();
      const timing: JoinTiming = { playerId, startedAtMs: started };
      joinTimings.push(timing);
      try {
        const player = originalJoin(playerId);
        timing.endedAtMs = Date.now(); timing.durationMs = timing.endedAtMs - started;
        return player;
      } catch (error) {
        timing.endedAtMs = Date.now(); timing.durationMs = timing.endedAtMs - started; timing.error = pageSafeError(error);
        throw error;
      }
    };
  }

  game = await startGameServer();
  browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  // Browser initialization is independent; keep server startup plus two real world boots inside
  // the authored gate's budget. The actual player joins below remain strictly sequential.
  const [alice, bob] = await Promise.all([openPage("alice", endpoint, game), openPage("bob", endpoint, game)]);
  if (authored) console.log(JSON.stringify({ phase: "browsers-ready", elapsedMs: Date.now() - startedAtMs }));
  if (profileEnabled) {
    profiler = await alice.context.newCDPSession(alice.page);
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.setSamplingInterval", { interval: 1000 });
    await profiler.send("Profiler.start");
    profilerStarted = true;
    await markPhase(alice, "profile-start");
  }

  await markPhase(alice, "join-click");
  const aliceJoinStarted = Date.now();
  await alice.page.locator(".worlds__row--world input").first().check();
  await alice.page.getByRole("button", { name: "Join world", exact: true }).click();
  const aliceConnected = await waitForConnected(alice, authored ? 20_000 : 7_000);
  await markPhase(alice, aliceConnected ? "connected" : "connect-timeout", { nodeElapsedMs: Date.now() - aliceJoinStarted });
  markCheck("firstPlayerConnected", aliceConnected);
  if (!aliceConnected) throw new Error("Alice did not connect before the movement phase");
  await closeLabPanel(alice);

  const motion = await driveFirstPlayer(alice);
  const beforePosition = position2(motion.before.player);
  const afterPosition = position2(motion.after.player);
  const travel = beforePosition && afterPosition ? Math.hypot(afterPosition[0] - beforePosition[0], afterPosition[1] - beforePosition[1]) : 0;
  const yawBefore = cameraYaw(motion.beforeCamera);
  const yawAfter = cameraYaw(motion.afterCamera);
  const yawDelta = yawBefore === null || yawAfter === null ? 0 : Math.abs(Math.atan2(Math.sin(yawAfter - yawBefore), Math.cos(yawAfter - yawBefore)));
  motionEvidence = { before: motion.before, after: motion.after, travel, beforeCamera: motion.beforeCamera, afterCamera: motion.afterCamera, yawDelta };
  cameraEvidence = { before: motion.beforeCamera, after: motion.afterCamera };
  markCheck("firstPlayerMovedBeforeSecondJoin", travel > 0.35);
  markCheck("firstPlayerRotatedCameraBeforeSecondJoin", yawDelta > 0.04);
  markCheck("firstPlayerReceivedMovementAcknowledgement", alice.network.acknowledgements.some((ack) => ack.status === "accepted"));
  await capture(alice, "alice-before-bob-join");

  // Start the observer before Bob's join so the report contains the whole join-to-first-render window.
  await markPhase(alice, "second-join-window-start");
  activeJoinMotion = await beginJoinMotion(alice);
  const presencePromise = samplePresence(alice.page, "bob", authored ? 10_000 : 6_000);
  pendingOperations.push(presencePromise);
  await markPhase(bob, "join-click");
  const bobJoinStarted = Date.now();
  await bob.page.locator(".worlds__row--world input").first().check();
  await bob.page.getByRole("button", { name: "Join world", exact: true }).click();
  const bobConnected = await waitForConnected(bob, authored ? 20_000 : 7_000);
  await markPhase(bob, bobConnected ? "connected" : "connect-timeout", { nodeElapsedMs: Date.now() - bobJoinStarted });
  markCheck("secondPlayerConnected", bobConnected);
  if (!bobConnected) throw new Error("Bob did not connect");
  await closeLabPanel(bob);
  // Keep the controls held through the connected boundary, then stop and read separate motion and
  // camera evidence. This deliberately overlaps the join instead of proving only a pre-join move.
  // Keep the camera active long enough for the first atomic remote presentation to finish its
  // GPU handoff. This still belongs to the join window and avoids stopping just after the socket
  // reports connected while the observer is showing its first complete frame.
  await bob.page.waitForTimeout(2_000);
  const overlapMotion = await activeJoinMotion.stop();
  activeJoinMotion = undefined;
  const overlapBeforePosition = position2(overlapMotion.before.player);
  const overlapAfterPosition = position2(overlapMotion.after.player);
  const overlapTravel = overlapBeforePosition && overlapAfterPosition
    ? Math.hypot(overlapAfterPosition[0] - overlapBeforePosition[0], overlapAfterPosition[1] - overlapBeforePosition[1]) : 0;
  const overlapYawBefore = cameraYaw(overlapMotion.beforeCamera);
  const overlapYawAfter = cameraYaw(overlapMotion.afterCamera);
  const overlapYawDelta = overlapYawBefore === null || overlapYawAfter === null
    ? 0 : Math.abs(Math.atan2(Math.sin(overlapYawAfter - overlapYawBefore), Math.cos(overlapYawAfter - overlapYawBefore)));
  motionEvidence = { ...motionEvidence, duringSecondJoin: {
    before: overlapMotion.before,
    after: overlapMotion.after,
    travel: overlapTravel,
  } };
  cameraEvidence = { ...cameraEvidence, duringSecondJoin: {
    before: overlapMotion.beforeCamera,
    after: overlapMotion.afterCamera,
    yawDelta: overlapYawDelta,
  } };
  markCheck("firstPlayerMovedDuringSecondJoin", overlapTravel > 0.15);
  markCheck("firstPlayerRotatedCameraDuringSecondJoin", overlapYawDelta > 0.04);
  presenceJoin = await presencePromise;
  await markPhase(alice, "second-join-window-end", { samples: presenceJoin.length });
  await refreshTrace(alice);
  const bobJoinStart = (await phaseMarker(alice, "second-join-window-start"))?.atMs;
  const joinAnalysis = presenceAnalysis(presenceJoin, bobJoinStart);
  markCheck("remoteFirstDisplay", joinAnalysis.firstDisplayAtMs !== null);
  markCheck("renderDiagnosticAvailableAfterJoin", joinAnalysis.renderDiagnosticAvailable === true);
  markCheck("remoteStableAfterFirstDisplay", joinAnalysis.noRepeatedDisappearance === true);
  markCheck("remoteDisplayHasRenderedMeshes", presenceJoin.some((sample) => sample.renderPresent === true && (sample.renderedMeshes ?? 0) > 0));
  markCheck("remoteDisplayNeverPartiallyRendered", presenceJoin.every((sample) => sample.renderedMeshes === null
    || sample.renderedMeshes <= 0 || sample.renderComplete !== false));
  markCheck("joinDeliveredAuthoritativeTick", bob.network.updates.some((update) => update.snapshot && Number.isFinite(update.tick)));
  markCheck("joinReceivedAckOrUpdate", bob.network.acknowledgements.length > 0 || bob.network.updates.length > 0);
  await capture(alice, "bob-first-display");

  // Alice's first gear change is deliberately performed through the shipped inventory UI. Bob is
  // the observer here, so this also covers the cold remote equipment asset path.
  const equipmentItemId = authored ? "worn_sword" : "kaldite_sword";
  const equipmentLabel = authored ? "Worn Shortsword" : "Cobalt Sword";
  if (!authored && local) {
    const runtime = [...local.worlds.values()][0]!.runtime;
    const aliceRuntime = runtime.players.get("alice");
    const bobRuntime = runtime.players.get("bob");
    if (!aliceRuntime || !bobRuntime) throw new Error("Lab runtime players were not available for equipment setup");
    for (const skill of SKILL_IDS) setSkillLevel(aliceRuntime.store.get(), skill, 99);
    aliceRuntime.store.markDirty();
    const bobMainHand = bobRuntime.store.get().equipment.mainHand?.itemId ?? null;
    if (bobMainHand === equipmentItemId) throw new Error(`Bob already had cold equipment ${equipmentItemId}`);
    const added = aliceRuntime.inventory.addItem(equipmentItemId, 1);
    if (!added.ok) throw new Error(`Could not grant Alice ${equipmentItemId}: ${added.error.message}`);
    equipmentEvidence = { itemId: equipmentItemId, label: equipmentLabel, grantedTo: "alice", bobMainHandBefore: bobMainHand };
  } else {
    equipmentEvidence = { itemId: equipmentItemId, label: equipmentLabel, grantedTo: "starter-inventory" };
  }
  await markPhase(alice, "equipment-window-start", { itemId: equipmentItemId });
  const equipmentPromise = samplePresence(bob.page, "alice", authored ? 10_000 : 6_000);
  pendingOperations.push(equipmentPromise);
  await markPhase(alice, "equipment-change-start");
  await markPhase(bob, "equipment-window-start", { itemId: equipmentItemId });
  activeJoinMotion = await beginJoinMotion(bob);
  const inventoryButton = alice.page.locator('.dock__btn[data-panel="inventory"]');
  await inventoryButton.click();
  const inventoryPanel = alice.page.getByRole("dialog", { name: "Inventory", exact: true });
  await inventoryPanel.waitFor({ state: "visible" });
  const sword = inventoryPanel.getByRole("button", { name: equipmentLabel, exact: true });
  await sword.waitFor({ state: "visible", timeout: 7000 });
  await sword.click();
  await alice.page.waitForTimeout(150);
  await markPhase(alice, "equipment-command-sent");
  await markPhase(bob, "equipment-command-sent");
  try {
    await bob.page.waitForFunction((itemId) => {
      const state = (Reflect.get(window, "__multiplayerLab") as { observe(): LabObservation }).observe();
      return state.presentation.some((row) => row.id === "alice" && row.equipment?.mainHand === itemId
        && row.render?.equipment?.mainHand === itemId && row.render.complete === true && !row.render.pendingReplacement);
    }, equipmentItemId, { timeout: authored ? 10_000 : 6_000 });
    markCheck("remoteEquipmentReplicated", true);
  } catch (error) {
    markCheck("remoteEquipmentReplicated", false);
    errors.push({ page: "bob", source: "equipment", message: pageSafeError(error) });
  }
  await bob.page.waitForTimeout(650);
  const equipmentMotion = await activeJoinMotion.stop();
  activeJoinMotion = undefined;
  const equipmentYawBefore = cameraYaw(equipmentMotion.beforeCamera);
  const equipmentYawAfter = cameraYaw(equipmentMotion.afterCamera);
  equipmentEvidence = { ...equipmentEvidence, cameraBefore: equipmentMotion.beforeCamera,
    cameraAfter: equipmentMotion.afterCamera };
  markCheck("observerRotatedCameraDuringEquipmentChange", equipmentYawBefore !== null && equipmentYawAfter !== null
    && Math.abs(Math.atan2(Math.sin(equipmentYawAfter - equipmentYawBefore), Math.cos(equipmentYawAfter - equipmentYawBefore))) > 0.04);
  presenceEquipment = await equipmentPromise;
  await markPhase(bob, "equipment-window-end", { samples: presenceEquipment.length });
  await markPhase(alice, "equipment-window-end", { samples: presenceEquipment.length });
  await refreshTrace(bob);
  await refreshTrace(alice);
  const equipmentStart = (await phaseMarker(bob, "equipment-window-start"))?.atMs;
  const equipmentAnalysis = presenceAnalysis(presenceEquipment, equipmentStart);
  markCheck("remoteStableDuringEquipmentChange", equipmentAnalysis.noRepeatedDisappearance === true);
  markCheck("equipmentRenderHasMeshes", presenceEquipment.some((sample) => sample.renderPresent === true && (sample.renderedMeshes ?? 0) > 0));
  markCheck("equipmentRenderNeverPartiallyRendered", presenceEquipment.every((sample) => sample.renderedMeshes === null
    || sample.renderedMeshes <= 0 || sample.renderComplete !== false));
  const expectedAssetToken = authored ? "corealm_sword_1.glb" : "corealm_sword_3.glb";
  const coldAssetRequests = bob.network.assetRequests.filter((request) => request.atMs >= (equipmentStart ?? 0)
    && request.url.toLowerCase().includes(expectedAssetToken));
  const priorAssetRequests = bob.network.assetRequests.filter((request) => request.atMs < (equipmentStart ?? 0)
    && request.url.toLowerCase().includes(expectedAssetToken));
  equipmentEvidence = {
    ...equipmentEvidence,
    expectedAssetToken,
    coldAssetRequests,
    priorAssetRequests,
    bobAssetRequests: bob.network.assetRequests,
  };
  if (!authored) {
    markCheck("remoteEquipmentAssetWasCold", priorAssetRequests.length === 0);
    markCheck("remoteEquipmentAssetRequested", coldAssetRequests.length > 0);
  }
  const joinPacing = framePacing(alice.trace, "second-join-window-start", "second-join-window-end");
  const equipmentPacing = framePacing(bob.trace, "equipment-window-start", "equipment-window-end");
  framePacingEvidence = { join: joinPacing, equipment: equipmentPacing };
  markCheck("joinObserverFramePacing", joinPacing.passed === true);
  markCheck("equipmentObserverFramePacing", equipmentPacing.passed === true);
  await closeLabPanel(alice);
  await capture(bob, "remote-equipment-after-join");

  markCheck("noRuntimeErrors", errors.length === 0);
  markCheck("withinBudget", Date.now() - startedAtMs < budget);
  markCheck("serverJoinTimingRecorded", authored || joinTimings.length >= 2);
} catch (error) {
  failure = pageSafeError(error);
  errors.push({ page: "harness", source: "fatal", message: failure });
  for (const record of pages) {
    await record.page.screenshot({ path: `${out}/${record.name}-failure.png`, timeout: 3000 }).catch(() => {});
  }
} finally {
  if (activeJoinMotion) {
    try {
      await activeJoinMotion.stop();
    } catch (error) {
      errors.push({ page: "alice", source: "join-motion-cleanup", message: pageSafeError(error) });
    }
    activeJoinMotion = undefined;
  }
  const pendingResults = await Promise.allSettled(pendingOperations);
  for (const result of pendingResults) {
    if (result.status === "rejected") {
      errors.push({ page: "harness", source: "pending-operation", message: pageSafeError(result.reason) });
    }
  }
  if (profiler && profilerStarted) {
    try {
      const stopped = await profiler.send("Profiler.stop");
      await writeFile(`${out}/alice.cpuprofile`, JSON.stringify(stopped.profile));
    } catch (error) {
      errors.push({ page: "alice", source: "profile", message: pageSafeError(error) });
    }
  }
  for (const record of pages) {
    try {
      const trace = await record.page.evaluate(() => Reflect.get(window, "__joinStabilityTrace") as BrowserTrace);
      record.trace = trace;
    } catch (error) {
      errors.push({ page: record.name, source: "trace", message: pageSafeError(error) });
    }
  }
  const reports = {
    passed: failure === null && errors.length === 0 && Object.values(checks).every(Boolean),
    observeOnly,
    authored,
    profileEnabled,
    failure,
    checks,
    errors,
    durationMs: Date.now() - startedAtMs,
    budgetMs: budget,
    screenshots,
    joinTimings,
    serverMetrics: local?.metrics ?? null,
    motionEvidence,
    cameraEvidence,
    framePacing: framePacingEvidence,
    equipment: equipmentEvidence,
    presence: {
      join: { analysis: presenceAnalysis(presenceJoin), samples: presenceJoin },
      equipment: { analysis: presenceAnalysis(presenceEquipment), samples: presenceEquipment },
    },
    pages: pages.map((record) => ({
      name: record.name,
      network: record.network,
      trace: traceSummary(record.trace),
    })),
  };
  await writeFile(`${out}/report.json`, JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({
    passed: reports.passed,
    observeOnly,
    checks,
    errors,
    durationMs: reports.durationMs,
    report: `${out}/report.json`,
  }));
  await browser?.close();
  await game?.close();
  await local?.close();
  await authoredHost?.close();
  clearDeadline();
}

if (!observeOnly && (failure !== null || errors.length > 0 || !Object.values(checks).every(Boolean))) process.exitCode = 1;
