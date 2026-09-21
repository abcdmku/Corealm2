import { chromium, type Page } from "playwright";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { startLocalMultiplayer } from "./lib/localMultiplayer.js";
import { installTestDeadline } from "./lib/deadline.js";
import { waitForDebug } from "./lib/wait-for-debug.js";

const mode = process.argv.includes("--prod") ? "prod" : "dev";
const authored = process.argv.includes("--authored");
const budgetMs = authored ? 120_000 : 60_000;
const clearDeadline = installTestDeadline(`multiplayer scene transition ${mode}`, budgetMs);
const started = Date.now();
const out = `test-results/multiplayer-scene-transition-${mode}${authored ? "-authored" : ""}`;
const sentinel = authored ? "coldbrace_gate_south#pf0_0_0" : "feature-lab:bank";

type StageSnapshot = {
  stage: string;
  phase: string;
  titleVisible: boolean;
  debugEntityCount: number;
  replicatedEntityCount: number;
  staleNonRemoteCount: number;
  staleNonRemoteIds: string[];
  missingReplicatedCount: number;
  missingReplicatedIds: string[];
  sentinel: { semantic: boolean; drawn: unknown | null };
  landmark: { id: string; distance: number; replicated: boolean; semantic: boolean; drawn: boolean };
  runtimeErrorCount: number;
  pageErrorCount: number;
  sessionId: string | null;
};

type RafSample = { phase: string; semantic: boolean; drawn: boolean };
type LandmarkSentinel = { id: string; distance: number };

const checks: Record<string, boolean> = {};
const errors: string[] = [];
const stages: StageSnapshot[] = [];
const report: Record<string, unknown> = {
  mode,
  authored,
  budgetMs,
  sentinel,
  passed: false,
  checks,
  stages,
  errors,
};

let server: Awaited<ReturnType<typeof startLocalMultiplayer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page: Page | undefined;
let initialEntityIds: string[] = [];
let initialLandmarkIds: string[] = [];
let landmarkSentinel!: LandmarkSentinel;
let reconnectRaf: RafSample[] = [];

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((id, index) => id === b[index]);
}

async function run(): Promise<void> {
  await mkdir(out, { recursive: true });
  const saveDirectory = await mkdtemp(`${out}/save-`);
  const args = [
    "--web-port", "0", "--world-port", "0", "--data", saveDirectory,
    ...(authored ? [] : ["--lab"]),
    ...(mode === "prod" ? ["--skip-build"] : []),
  ];

  server = await startLocalMultiplayer(mode, args);
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Keep the reconnect test on the shipped WebSocket path. The send shim captures native sockets;
  // the test closes one of those sockets later, which exercises the normal network-failure path.
  await context.addInitScript(`
    window.__name = (fn) => fn;
    window.__corealmTestSockets = [];
    (() => {
      const sockets = window.__corealmTestSockets;
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (payload) {
        if (!sockets.includes(this)) sockets.push(this);
        return send.call(this, payload);
      };
    })();
  `);
  await context.addInitScript(() => {
    localStorage.setItem("corealm.settings.v1", JSON.stringify({
      renderScale: 0.7,
      shadowQuality: "low",
      drawDistance: "near",
      music: 0,
      ambient: 0,
      sfx: 0,
    }));
  });
  page = await context.newPage();
  page.setDefaultTimeout(6_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

  const launchUrl = new URL(server.url);
  if (!launchUrl.pathname.endsWith("index.html")) {
    launchUrl.pathname = `${launchUrl.pathname.replace(/\/$/, "")}/index.html`;
  }
  launchUrl.searchParams.set("worldMenu", "1");
  if (!authored) {
    launchUrl.searchParams.set("mode", "combat");
    launchUrl.searchParams.set("multiplayer", "1");
  }
  await page.goto(launchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForFunction(() => {
    const debug = Reflect.get(window, "__gameDebug") as { getState?: () => { ready?: boolean } } | undefined;
    return debug?.getState?.().ready === true;
  }, undefined, { timeout: authored ? 60_000 : 25_000 });

  const selector = page.locator("#multiplayer-selector");
  await selector.waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("textbox", { name: "Development guest name", exact: true }).waitFor({ state: "visible" });
  checks.initialSelectorVisible = await selector.isVisible();

  const landmarkHandle = await waitForDebug(page, async ({ authored }) => {
    const debug = Reflect.get(window, "__gameDebug") as {
      listEntities?: (filter?: { archetype?: string }) => Array<{
        id?: unknown;
        position?: unknown;
        interactions?: unknown;
      }>;
      getDrawnBounds?: (id: string) => unknown | null;
      getPlayerPosition?: () => { x: number; z: number };
    } | undefined;
    const player = debug?.getPlayerPosition?.();
    const rows = await debug?.listEntities?.({ archetype: "landmark" }) ?? [];
    const staticRows = rows.filter(row => {
      const interactions = row.interactions;
      return Array.isArray(interactions) && interactions.every(interaction => interaction === "inspect");
    });
    const initialLandmarkIds = staticRows
      .map(row => row.id)
      .filter((id): id is string => typeof id === "string");
    const candidate = staticRows.map(row => {
      const position = row.position;
      if (!Array.isArray(position) || position.length < 3 || typeof row.id !== "string"
        || !player || !Number.isFinite(Number(position[0])) || !Number.isFinite(Number(position[2]))) return null;
      const distance = Math.hypot(Number(position[0]) - player.x, Number(position[2]) - player.z);
      let drawn = false;
      try { drawn = Boolean(debug?.getDrawnBounds?.(row.id)); } catch { drawn = false; }
      return { id: row.id, distance, drawn };
    }).find(row => row?.drawn && (!authored || (row.distance > 52 && row.distance < 128)));
    return candidate ? { id: candidate.id, distance: candidate.distance, initialLandmarkIds } : false;
  }, { authored }, { timeout: authored ? 45_000 : 20_000 });
  const landmark = landmarkHandle as { id: string; distance: number; initialLandmarkIds: string[] };
  landmarkSentinel = { id: landmark.id, distance: landmark.distance };
  initialLandmarkIds = landmark.initialLandmarkIds;
  report.landmark = { ...landmarkSentinel, initialStaticCount: initialLandmarkIds.length };

  const recordStage = async (stage: string): Promise<StageSnapshot> => {
    const snapshot = await page!.evaluate(async ({ stage, sentinel, initialLandmarkIds, landmarkSentinel }) => {
      const debug = Reflect.get(window, "__gameDebug") as {
        getEntities?: () => Array<{ id: string }>;
        getEntity?: (id: string) => unknown | null;
        getDrawnBounds?: (id: string) => unknown | null;
        getErrors?: () => unknown[];
      } | undefined;
      const multiplayer = Reflect.get(window, "__multiplayerLab") as { observe?: () => unknown } | undefined;
      const observed = multiplayer?.observe?.() as {
        phase?: string;
        entities?: Array<{ id: string }>;
        sessionId?: string | null;
      } | undefined;
      const debugIds = [...new Set((await debug?.getEntities?.() ?? [])
        .map(entity => entity.id).filter((id): id is string => typeof id === "string"))].sort();
      const replicatedIds = [...new Set((observed?.entities ?? [])
        .map(entity => entity.id).filter((id): id is string => typeof id === "string"))].sort();
      const nonRemoteIds = debugIds.filter(id => !id.startsWith("remote:"));
      const staticLandmarks = new Set(initialLandmarkIds);
      const stale = replicatedIds.length > 0
        ? nonRemoteIds.filter(id => !replicatedIds.includes(id) && !staticLandmarks.has(id))
        : [];
      const missing = replicatedIds.length > 0 ? replicatedIds.filter(id => !nonRemoteIds.includes(id)) : [];
      let drawn: unknown | null = null;
      try { drawn = debug?.getDrawnBounds?.(sentinel) ?? null; } catch { drawn = null; }
      let landmarkDrawn = false;
      try { landmarkDrawn = Boolean(debug?.getDrawnBounds?.(landmarkSentinel.id)); } catch { landmarkDrawn = false; }
      let runtimeErrorCount = 0;
      try { runtimeErrorCount = debug?.getErrors?.().length ?? 0; } catch { runtimeErrorCount = 0; }
      const title = document.querySelector<HTMLElement>(".title");
      return {
        stage,
        phase: observed?.phase ?? document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") ?? "missing",
        titleVisible: title ? !title.hidden : false,
        debugEntityCount: debugIds.length,
        replicatedEntityCount: replicatedIds.length,
        staleNonRemoteCount: stale.length,
        staleNonRemoteIds: stale.slice(0, 8),
        missingReplicatedCount: missing.length,
        missingReplicatedIds: missing.slice(0, 8),
        sentinel: { semantic: debugIds.includes(sentinel), drawn },
        landmark: {
          id: landmarkSentinel.id,
          distance: landmarkSentinel.distance,
          replicated: replicatedIds.includes(landmarkSentinel.id),
          semantic: Boolean(await debug?.getEntity?.(landmarkSentinel.id)),
          drawn: landmarkDrawn,
        },
        runtimeErrorCount,
        pageErrorCount: 0,
        sessionId: observed?.sessionId ?? null,
      } satisfies StageSnapshot;
    }, { stage, sentinel, initialLandmarkIds, landmarkSentinel });
    snapshot.pageErrorCount = errors.length;
    stages.push(snapshot);
    return snapshot;
  };

  const readEntityIds = async (): Promise<string[]> => page!.evaluate(async () => {
    const debug = Reflect.get(window, "__gameDebug") as { getEntities?: () => Array<{ id: string }> } | undefined;
    return [...new Set((await debug?.getEntities?.() ?? []).map(entity => entity.id)
      .filter((id): id is string => typeof id === "string"))].sort();
  });

  await waitForDebug(page, async id => {
    const debug = Reflect.get(window, "__gameDebug") as {
      getEntity?: (entityId: string) => unknown;
      getDrawnBounds?: (entityId: string) => unknown | null;
    } | undefined;
    return Boolean(await debug?.getEntity?.(id) && debug?.getDrawnBounds?.(id));
  }, sentinel, { timeout: authored ? 30_000 : 15_000 });
  initialEntityIds = await readEntityIds();
  await recordStage("offline-initial");

  const ensureWorldsVisible = async (): Promise<void> => {
    if (await selector.isVisible().catch(() => false)) return;
    const title = page!.getByRole("dialog", { name: "Corealm", exact: true });
    if (!(await title.isVisible().catch(() => false))) {
      await page!.getByRole("button", { name: "Open menu", exact: true }).click();
    }
    const worlds = page!.getByRole("button", { name: "Worlds", exact: true });
    if (await worlds.isVisible().catch(() => false)) await worlds.click();
    await selector.waitFor({ state: "visible", timeout: 5_000 });
  };

  await ensureWorldsVisible();
  const guestName = page!.getByRole("textbox", { name: "Development guest name", exact: true });
  const join = page!.getByRole("button", { name: "Join world", exact: true });
  await guestName.fill("invalid name");
  await page!.locator(".worlds__row--world input").first().check();
  await join.click();
  await page!.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "unavailable", undefined, { timeout: 7_000 });
  const invalid = await recordStage("invalid-guest-unavailable");
  const invalidStatus = await page!.locator("#multiplayer-selector [role=status]").innerText();
  checks.invalidGuestRejected = /valid development guest name/i.test(invalidStatus)
    && invalid.phase === "unavailable";
  checks.sceneFrozenOnInvalid = invalid.sentinel.semantic && invalid.sentinel.drawn !== null;
  await page!.getByRole("button", { name: "Return to game", exact: true }).click();
  await page!.waitForFunction(() => {
    const title = document.querySelector<HTMLElement>(".title");
    return !title || title.hidden;
  }, undefined, { timeout: 3_000 });
  await page!.screenshot({ path: `${out}/invalid-return.png`, timeout: 5_000 });
  await recordStage("invalid-return-game");

  await ensureWorldsVisible();
  await guestName.fill("scene-transition");
  await page!.locator(".worlds__row--world input").first().check();
  await join.click();
  await page!.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", undefined, { timeout: 8_000 });
  await page!.waitForFunction(id => {
    const debug = Reflect.get(window, "__gameDebug") as { getDrawnBounds?: (entityId: string) => unknown | null } | undefined;
    const lab = Reflect.get(window, "__multiplayerLab") as { observe?: () => unknown } | undefined;
    const observed = lab?.observe?.() as { entities?: Array<{ id: string }> } | undefined;
    return Boolean(observed?.entities?.some(entity => entity.id === id) && debug?.getDrawnBounds?.(id));
  }, sentinel, { timeout: 10_000 });
  await page!.waitForFunction(() => {
    const title = document.querySelector<HTMLElement>(".title");
    return !title || title.hidden;
  }, undefined, { timeout: 3_000 });
  const connected = await recordStage("valid-first-snapshot");
  checks.validJoinConnected = connected.phase === "connected";
  checks.titleHiddenAfterJoin = !connected.titleVisible;
  checks.firstSnapshotReconciled = connected.replicatedEntityCount > 0
    && connected.staleNonRemoteCount === 0
    && connected.missingReplicatedCount === 0;
  checks.scenePresentAfterJoin = connected.sentinel.semantic && connected.sentinel.drawn !== null;
  checks.staticLandmarkOutsideServerSnapshot = !connected.landmark.replicated;
  checks.staticLandmarkPresentAfterJoin = connected.landmark.semantic && connected.landmark.drawn;
  const sessionBeforeReconnect = connected.sessionId;
  if (!sessionBeforeReconnect) throw new Error("Connected snapshot did not expose a session id");

  await page!.waitForFunction(() => {
    const sockets = Reflect.get(window, "__corealmTestSockets") as WebSocket[] | undefined;
    return sockets?.some(socket => socket.readyState === WebSocket.OPEN) === true;
  }, undefined, { timeout: 3_000 });
  const rafPromise = page!.evaluate(async ({ sentinel, durationMs }) => {
    const samples: RafSample[] = [];
    const end = performance.now() + durationMs;
    await new Promise<void>(resolve => {
      const frame = async (at: number) => {
        const debug = Reflect.get(window, "__gameDebug") as {
          getEntity?: (id: string) => unknown;
          getDrawnBounds?: (id: string) => unknown | null;
        } | undefined;
        samples.push({
          phase: document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") ?? "missing",
          semantic: Boolean(await debug?.getEntity?.(sentinel)),
          drawn: Boolean(debug?.getDrawnBounds?.(sentinel)),
        });
        if (at < end) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    return samples;
  }, { sentinel, durationMs: 4_000 });
  const closeResult = await page!.evaluate(() => {
    const sockets = Reflect.get(window, "__corealmTestSockets") as WebSocket[] | undefined;
    const socket = sockets?.slice().reverse().find(candidate => candidate.readyState === WebSocket.OPEN);
    if (!socket) return { closed: false, reason: "No open native WebSocket was captured" };
    socket.close(4008, "test network failure");
    return { closed: true, url: socket.url };
  });
  checks.nativeSocketCaptured = closeResult.closed;
  if (!closeResult.closed) throw new Error(closeResult.reason);
  await page!.waitForFunction(oldSessionId => {
    const lab = Reflect.get(window, "__multiplayerLab") as { observe?: () => unknown } | undefined;
    const observed = lab?.observe?.() as { phase?: string; sessionId?: string | null } | undefined;
    return observed?.phase === "connected" && typeof observed.sessionId === "string" && observed.sessionId !== oldSessionId;
  }, sessionBeforeReconnect, { timeout: 10_000 });
  reconnectRaf = await rafPromise;
  const phases = new Set(reconnectRaf.map(sample => sample.phase));
  const missingSemanticFrames = reconnectRaf.filter(sample => !sample.semantic).length;
  const missingDrawnFrames = reconnectRaf.filter(sample => !sample.drawn).length;
  report.reconnectRaf = {
    frames: reconnectRaf.length,
    phases: [...phases],
    missingSemanticFrames,
    missingDrawnFrames,
  };
  checks.bankNeverDisappearedOnRaf = reconnectRaf.length > 30
    && missingSemanticFrames === 0
    && missingDrawnFrames === 0;
  const reconnected = await recordStage("reconnected-after-native-close");
  checks.reconnected = reconnected.phase === "connected"
    && reconnected.sessionId !== null
    && reconnected.sessionId !== sessionBeforeReconnect;
  checks.reconnectPublishedNewSession = checks.reconnected;
  checks.reconnectedScenePresent = reconnected.sentinel.semantic && reconnected.sentinel.drawn !== null;
  checks.staticLandmarkPresentAfterReconnect = !reconnected.landmark.replicated
    && reconnected.landmark.semantic && reconnected.landmark.drawn;
  await page!.screenshot({ path: `${out}/reconnected.png`, timeout: 5_000 });

  await ensureWorldsVisible();
  await page!.locator(".worlds__row--local input").check(); await page!.getByRole("button", { name: "Leave world", exact: true }).click();
  await page!.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "offline", undefined, { timeout: 8_000 });
  await waitForDebug(page!, async expected => {
    const debug = Reflect.get(window, "__gameDebug") as { getEntities?: () => Array<{ id: string }> } | undefined;
    const ids = [...new Set((await debug?.getEntities?.() ?? []).map(entity => entity.id))].sort();
    return ids.length === expected.length && ids.every((id, index) => id === expected[index]);
  }, initialEntityIds, { timeout: 8_000 });
  const offline = await recordStage("leave-restored-offline");
  const offlineIds = await readEntityIds();
  checks.leaveRestoresOffline = offline.phase === "offline";
  checks.leaveRestoresInitialEntities = sameIds(initialEntityIds, offlineIds);
  checks.leaveScenePresent = offline.sentinel.semantic && offline.sentinel.drawn !== null;
  checks.staticLandmarkPresentOffline = offline.landmark.semantic && offline.landmark.drawn;
  await page!.getByRole("button", { name: "Return to game", exact: true }).click();
  await page!.waitForFunction(() => {
    const title = document.querySelector<HTMLElement>(".title");
    return !title || title.hidden;
  }, undefined, { timeout: 3_000 });
  await page!.screenshot({ path: `${out}/offline-return.png`, timeout: 5_000 });

  checks.noRuntimeErrors = errors.length === 0 && stages.every(stage => stage.runtimeErrorCount === 0);
  checks.withinBudget = Date.now() - started < budgetMs;
}

try {
  await run();
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.initialEntityCount = initialEntityIds.length;
  report.initialEntityIds = initialEntityIds.slice(0, 16);
  report.initialEntityIdsTruncated = Math.max(0, initialEntityIds.length - 16);
  report.errors = errors;
  report.durationMs = Date.now() - started;
  report.passed = !report.failure && Object.values(checks).every(Boolean);
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  clearDeadline();
}

console.log(JSON.stringify({
  passed: report.passed,
  checks,
  errors,
  durationMs: report.durationMs,
}));
if (!report.passed) process.exitCode = 1;
