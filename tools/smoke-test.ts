import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FAST_TEST_SETTINGS, GameDriver, type RuntimeSnapshot } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";

export interface SmokeReport {
  passed: boolean;
  checks: Record<string, boolean>;
  initial: RuntimeSnapshot | null;
  afterInput: RuntimeSnapshot | null;
  afterReset: RuntimeSnapshot | null;
  bank: {
    entity: unknown;
    interaction: unknown;
    beforeQuantity: number;
    afterQuantity: number;
    panelOpen: boolean;
  } | null;
  errors: { console: string[]; page: string[]; requests: string[] };
  durationMs: number;
}

const REQUIRED_METHODS = [
  "getState",
  "getPlayer",
  "getPlayerPosition",
  "getCamera",
  "getEntities",
  "getCurrentActivity",
  "getObjectives",
  "getNavigationState",
  "reset",
] as const;

export async function runSmokeTest(runCandidate: string, options: { url?: string; hardware?: boolean } = {}): Promise<SmokeReport> {
  const started = Date.now();
  const runDir = await prepareRun(runCandidate);
  const server = options.url ? { url: options.url, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    // The smoke gate proves renderer startup and gameplay state transitions, not visual quality.
    // Keep software-rendered CI fast enough to remain a useful per-change check.
    settings: FAST_TEST_SETTINGS,
    ...(options.hardware ? { browserArgs: [
      "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    ] } : {}),
  });
  const report: SmokeReport = {
    passed: false,
    checks: {},
    initial: null,
    afterInput: null,
    afterReset: null,
    bank: null,
    errors: { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors },
    durationMs: 0,
  };

  try {
    await driver.launch();
    // Cold SwiftShader boots vary substantially across hosted and local runners.
    await driver.open(120_000);
    await waitForSimulationTick(driver);
    report.initial = await driver.snapshot();

    const browserFacts = await driver.page!.evaluate((methods) => {
      const api = window.__gameDebug as unknown as Record<string, unknown> | undefined;
      const canvas = document.querySelector("canvas");
      return {
        readyState: document.readyState,
        canvas: canvas instanceof HTMLCanvasElement,
        webgl: canvas instanceof HTMLCanvasElement && Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl")),
        methods: Object.fromEntries(methods.map((name) => [name, typeof api?.[name] === "function"])),
      };
    }, REQUIRED_METHODS);

    report.checks.pageLoads = browserFacts.readyState === "complete";
    report.checks.rendererInitializes = browserFacts.canvas && browserFacts.webgl;
    report.checks.debugApiExists = REQUIRED_METHODS.every((method) => browserFacts.methods[method]);
    report.checks.playerFinite = finiteValue(report.initial.player) && finiteValue(report.initial.playerPosition);
    report.checks.cameraFinite = finiteValue(report.initial.camera);
    report.checks.navigationReady = navigationReady(report.initial.navigation);

    await driver.click(640, 360);
    await driver.press("w", 700);
    await driver.wait(120);
    report.afterInput = await driver.snapshot();
    report.checks.inputChangesState = moved(report.initial.playerPosition, report.afterInput.playerPosition);

    // Final-world integration proof for banking. Debug calls only place the player and grant the
    // test item; opening and moving it both go through the same public agent tools used in play.
    const bankEntity = await driver.callDebug("getEntity", ["coldbrace_bank"]);
    const teleported = await driver.callDebug("teleport", [{ entityId: "coldbrace_bank" }]);
    const before = await driver.callDebug("callTool", ["corealm_bank", { op: "list", filter: "copper" }]);
    await driver.callDebug("giveItem", ["grithe_ore", 5, "inventory"]);
    const interaction = await driver.callDebug("callTool", [
      "corealm_interact",
      { entityId: "coldbrace_bank", interaction: "bank" },
    ]);
    await driver.page!.locator("#panel-bank:not([hidden])").waitFor({
      state: "visible",
      // The full authored world can still be compiling deferred assets on software rendering.
      timeout: 20_000,
    }).catch(() => undefined);
    const panelOpen = await driver.page!.locator("#panel-bank").isVisible();
    await driver.callDebug("callTool", [
      "corealm_bank",
      { op: "deposit", itemId: "grithe_ore", quantity: -1 },
    ]);
    const after = await driver.callDebug("callTool", ["corealm_bank", { op: "list", filter: "copper" }]);
    const beforeQuantity = bankQuantity(before, "grithe_ore");
    const afterQuantity = bankQuantity(after, "grithe_ore");
    report.bank = { entity: bankEntity, interaction, beforeQuantity, afterQuantity, panelOpen };
    report.checks.finalWorldBankEntityLoads = teleported === true
      && isRecord(bankEntity)
      && bankEntity.archetype === "bank"
      && Array.isArray(bankEntity.interactions)
      && bankEntity.interactions.includes("bank");
    report.checks.finalWorldBankInteractionOpensPanel = panelOpen
      && isRecord(interaction)
      && typeof interaction.started === "string";
    report.checks.finalWorldBankMovesAgentQuantity = afterQuantity - beforeQuantity === 5;

    await driver.reset();
    // Reset restores the navigation landing. Movement grounds it on the first simulation tick;
    // a fixed 150 ms sleep can sample before that tick while a frame is still rendering.
    await waitForSimulationTick(driver);
    report.afterReset = await driver.snapshot();
    report.checks.resetWorks = samePosition(report.initial.playerPosition, report.afterReset.playerPosition)
      && JSON.stringify(report.initial.objectives) === JSON.stringify(report.afterReset.objectives);
    report.checks.noFatalErrors = driver.consoleErrors.length === 0
      && driver.pageErrors.length === 0
      && driver.requestErrors.length === 0;
    report.passed = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.errors.page.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await driver.close();
    await server.close();
    report.durationMs = Date.now() - started;
  }

  await writeFile(path.join(runDir, "test-results", "smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function waitForSimulationTick(driver: GameDriver): Promise<void> {
  await driver.page!.waitForFunction(() => {
    const state = window.__gameDebug?.getState() as { clock?: { tick?: number } } | undefined;
    return (state?.clock?.tick ?? 0) > 0;
  }, undefined, { timeout: 8_000 });
}

function finiteValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteValue);
  if (value && typeof value === "object") return Object.values(value).every(finiteValue);
  return true;
}

function point(value: unknown): { x: number; y: number; z: number } | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  return typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
    ? { x: p.x, y: p.y, z: p.z }
    : null;
}

function moved(before: unknown, after: unknown): boolean {
  const a = point(before);
  const b = point(after);
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) > 0.1;
}

function samePosition(before: unknown, after: unknown): boolean {
  const a = point(before);
  const b = point(after);
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.05;
}

function navigationReady(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>).status === "ready";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bankQuantity(value: unknown, itemId: string): number {
  if (!isRecord(value) || !Array.isArray(value.slots)) return 0;
  const stack = value.slots.find((entry) => isRecord(entry) && entry.itemId === itemId);
  return isRecord(stack) && typeof stack.quantity === "number" ? stack.quantity : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npm run smoke -- --run runs/<id> [--url http://127.0.0.1:4174] [--hardware]");
  const report = await runSmokeTest(runCandidate, { url: argValue(args, "--url"), hardware: args.includes("--hardware") });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, errors: report.errors }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("smoke test");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
