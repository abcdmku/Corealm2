import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  FAST_TEST_SETTINGS,
  GameDriver,
  type RuntimeSnapshot,
  type SnapshotProfile,
} from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun, repoRoot, resolveInside, safeName } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";

type MouseButton = "left" | "right" | "middle";

export type PlayExpectation = { path: string } & (
  | { equals: unknown }
  | { gt: number }
  | { gte: number }
  | { lt: number }
  | { lte: number }
  | { changedFrom: string }
  | { deltaFrom: { path: string; equals: number } }
);

type PlayAction = (
  | { key: string; holdMs?: number; label?: string }
  | { click: [number, number]; button?: MouseButton; label?: string }
  | { drag: [number, number, number, number]; button?: MouseButton; label?: string }
  | { mouse: [number, number]; label?: string }
  | { waitMs: number; label?: string }
  | { debug: string; args?: unknown[]; label?: string }
  | { inspect: string; label?: string }
  | { screenshot: string; label?: string }
  | { reset: true; label?: string }
  | { reload: true; label?: string }
) & {
  /** Paths begin with before, after, initial or result. Missing paths fail. */
  expect?: PlayExpectation[];
  /** A negative debug probe must name its expected error code explicitly. */
  expectError?: string;
};

export interface PlayScenario {
  name: string;
  /** Full entity rows are for targeted diagnostics only; normal play reports stay lean. */
  snapshot?: SnapshotProfile;
  route?: string;
  actions: PlayAction[];
}

export interface PlayStep {
  index: number;
  action: PlayAction;
  before: RuntimeSnapshot;
  after: RuntimeSnapshot;
  changed: boolean;
  result?: unknown;
  screenshot?: string;
  error?: string;
  assertions: { path: string; passed: boolean; message?: string }[];
}

export interface PlayReport {
  scenario: string;
  startedAt: string;
  initial: RuntimeSnapshot | null;
  actions: PlayStep[];
  final: RuntimeSnapshot | null;
  errors: { console: string[]; page: string[]; requests: string[]; game: string[] };
  screenshots: string[];
  passed: boolean;
  status: "passed" | "failed" | "diagnostic";
}

const MAX_ACTIONS = 50;
const MAX_WAIT_MS = 10_000;

export async function runPlayScenario(
  runCandidate: string,
  scenarioCandidate: string,
  options: { url?: string } = {},
): Promise<PlayReport> {
  const runDir = await prepareRun(runCandidate);
  const scenarioPath = resolveInside(repoRoot, scenarioCandidate);
  const scenario = validateScenario(JSON.parse(await readFile(scenarioPath, "utf8")) as unknown);
  const server = options.url
    ? { url: options.url, close: async () => {} }
    : await startGameServer();
  const capturesVisuals = scenario.actions.some((action) => "screenshot" in action);
  const driver = new GameDriver(server, capturesVisuals ? {} : { settings: FAST_TEST_SETTINGS });
  const report: PlayReport = {
    scenario: scenario.name,
    startedAt: new Date().toISOString(),
    initial: null,
    actions: [],
    final: null,
    errors: { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors, game: [] },
    screenshots: [],
    passed: false,
    status: "diagnostic",
  };

  try {
    await driver.launch();
    await driver.open(120_000, scenario.route ?? "/");
    let current = await driver.snapshot(scenario.snapshot);
    report.initial = current;

    for (let index = 0; index < scenario.actions.length; index += 1) {
      const action = scenario.actions[index]!;
      const before = current;
      const step: PlayStep = { index: index + 1, action, before, after: before, changed: false, assertions: [] };
      try {
        if ("key" in action) await driver.press(action.key, boundedWait(action.holdMs ?? 0));
        else if ("click" in action) await driver.click(...action.click, action.button);
        else if ("drag" in action) await driver.drag(...action.drag, action.button);
        else if ("mouse" in action) await driver.moveMouse(...action.mouse);
        else if ("waitMs" in action) await driver.wait(boundedWait(action.waitMs));
        else if ("debug" in action) step.result = await driver.callDebug(action.debug, action.args ?? []);
        else if ("inspect" in action) step.result = await driver.callDebug(action.inspect);
        else if ("screenshot" in action) {
          step.screenshot = await driver.screenshot(path.join(runDir, "screenshots"), action.screenshot);
          report.screenshots.push(step.screenshot);
        } else if ("reset" in action) await driver.reset();
        else if ("reload" in action) await driver.reload();
        const resultError = checkActionResult(step.result, action.expectError);
        if (resultError) throw new Error(resultError);
        if (!("waitMs" in action)) await driver.wait(120);
      } catch (error) {
        step.error = error instanceof Error ? error.message : String(error);
      }
      step.after = await driver.snapshot(scenario.snapshot);
      step.changed = semanticFingerprint(step.before) !== semanticFingerprint(step.after);
      step.assertions = (action.expect ?? []).map((expectation) => {
        const message = evaluateExpectation(expectation, {
          before: step.before, after: step.after, initial: report.initial, result: step.result,
        });
        return { path: expectation.path, passed: message === null, ...(message ? { message } : {}) };
      });
      report.actions.push(step);
      current = step.after;
      if (step.error || step.assertions.some((assertion) => !assertion.passed)) break;
    }

    report.final = current;
    const gameErrors = await driver.callDebug("getErrors");
    if (Array.isArray(gameErrors)) report.errors.game = gameErrors.map((error) => JSON.stringify(error));
    report.status = playStatus(report);
    report.passed = report.status === "passed";
  } finally {
    await driver.close();
    await server.close();
  }

  const output = path.join(runDir, "test-results", `play-${safeName(scenario.name)}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function boundedWait(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > MAX_WAIT_MS) {
    throw new Error(`Action duration must be between 0 and ${MAX_WAIT_MS} ms`);
  }
  return value;
}

export function validateScenario(input: unknown): PlayScenario {
  if (!isRecord(input)) throw new Error("Scenario must be an object");
  const value = input as Partial<PlayScenario>;
  if (typeof value.name !== "string" || value.name.trim().length === 0) throw new Error("Scenario needs a name");
  if (value.snapshot !== undefined && value.snapshot !== "lean" && value.snapshot !== "full") {
    throw new Error("Scenario snapshot must be either lean or full");
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > MAX_ACTIONS) {
    throw new Error(`Scenario needs 1 to ${MAX_ACTIONS} actions`);
  }
  allowedKeys(input, ["name", "snapshot", "route", "actions"], "scenario");
  if (value.route !== undefined && (typeof value.route !== "string" || !value.route.startsWith("/") || value.route.startsWith("//"))) {
    throw new Error("Scenario route must be a local path");
  }
  const fields: Record<string, string[]> = {
    key: ["holdMs"], click: ["button"], drag: ["button"], mouse: [], waitMs: [],
    debug: ["args"], inspect: [], screenshot: [], reset: [], reload: [],
  };
  for (const [index, action] of value.actions.entries()) {
    const label = `Action ${index + 1}`;
    if (!isRecord(action)) throw new Error(`${label} must be an object`);
    const kinds = Object.keys(fields).filter((key) => Object.hasOwn(action, key));
    if (kinds.length !== 1) throw new Error(`${label} needs exactly one recognized action`);
    const kind = kinds[0]!;
    allowedKeys(action, [kind, ...fields[kind]!, "label", "expect", "expectError"], label);
    const item = (action as Record<string, unknown>)[kind];
    if (["key", "debug", "inspect", "screenshot"].includes(kind) && (typeof item !== "string" || !item.trim())) {
      throw new Error(`${label}.${kind} must be a non-empty string`);
    }
    if (["click", "mouse", "drag"].includes(kind)
      && (!Array.isArray(item) || item.length !== (kind === "drag" ? 4 : 2) || !item.every(Number.isFinite))) {
      throw new Error(`${label}.${kind} has invalid coordinates`);
    }
    if (kind === "waitMs") boundedWait(item as number);
    if ("holdMs" in action) boundedWait(action.holdMs as number);
    if (["reset", "reload"].includes(kind) && item !== true) throw new Error(`${label}.${kind} must be true`);
    if ("args" in action && !Array.isArray(action.args)) throw new Error(`${label}.args must be an array`);
    if ("button" in action && !["left", "right", "middle"].includes(action.button as string)) throw new Error(`${label}.button is invalid`);
    if ("label" in action && typeof action.label !== "string") throw new Error(`${label}.label must be a string`);
    if ("expectError" in action && (!["debug", "inspect"].includes(kind) || typeof action.expectError !== "string" || !action.expectError)) {
      throw new Error(`${label}.expectError needs a debug or inspect action and an error code`);
    }
    if ("expect" in action) {
      if (!Array.isArray(action.expect) || !action.expect.length) throw new Error(`${label}.expect must be a non-empty array`);
      action.expect.forEach(validateExpectation);
    }
  }
  return value as PlayScenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function allowedKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label}: unknown field ${key}`);
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && /^(before|after|initial|result)(\.[\w:-]+)*$/.test(value)
    && !value.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part));
}

function validateExpectation(value: unknown): void {
  if (!isRecord(value) || !validPath(value.path)) throw new Error("Expectation needs a before/after/initial/result path");
  const operators = ["equals", "gt", "gte", "lt", "lte", "changedFrom", "deltaFrom"];
  const selected = operators.filter((key) => Object.hasOwn(value, key));
  if (selected.length !== 1) throw new Error("Expectation needs exactly one comparison");
  allowedKeys(value, ["path", ...selected], "expectation");
  const operator = selected[0]!;
  if (["gt", "gte", "lt", "lte"].includes(operator) && !Number.isFinite(value[operator])) throw new Error("Numeric expectation needs a finite number");
  if (operator === "changedFrom" && !validPath(value.changedFrom)) throw new Error("changedFrom needs a snapshot path");
  if (operator === "deltaFrom") {
    const delta = value.deltaFrom;
    if (!isRecord(delta) || !validPath(delta.path) || !Number.isFinite(delta.equals)) throw new Error("deltaFrom needs a path and finite equals value");
    allowedKeys(delta, ["path", "equals"], "deltaFrom");
  }
}

function readPath(context: unknown, path: string): unknown {
  let value = context;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error(`Missing semantic path: ${path}`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Returns a failure message, never treats an absent value as a passing comparison. */
export function evaluateExpectation(expectation: PlayExpectation, context: unknown): string | null {
  try {
    validateExpectation(expectation);
    const actual = readPath(context, expectation.path);
    let passed: boolean;
    if ("equals" in expectation) passed = isDeepStrictEqual(actual, expectation.equals);
    else if ("changedFrom" in expectation) passed = !isDeepStrictEqual(actual, readPath(context, expectation.changedFrom));
    else {
      if (typeof actual !== "number" || !Number.isFinite(actual)) throw new Error(`${expectation.path} is not a finite number`);
      if ("deltaFrom" in expectation) {
        const previous = readPath(context, expectation.deltaFrom.path);
        if (typeof previous !== "number" || !Number.isFinite(previous)) throw new Error(`${expectation.deltaFrom.path} is not a finite number`);
        passed = Math.abs(actual - previous - expectation.deltaFrom.equals) < 1e-8;
      } else if ("gt" in expectation) passed = actual > expectation.gt;
      else if ("gte" in expectation) passed = actual >= expectation.gte;
      else if ("lt" in expectation) passed = actual < expectation.lt;
      else passed = actual <= expectation.lte;
    }
    return passed ? null : `Expectation failed: ${JSON.stringify(expectation)}; actual ${JSON.stringify(actual)?.slice(0, 400)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function checkActionResult(result: unknown, expectedError?: string): string | null {
  const failed = isRecord(result) && (result.ok === false || Boolean(result.error));
  const error = failed ? result.error : null;
  const code = isRecord(error) ? error.code : error;
  if (expectedError !== undefined) return failed && code === expectedError ? null : `Expected error ${expectedError}, received ${String(code ?? "success")}`;
  return failed ? `Action returned failure: ${JSON.stringify(result).slice(0, 800)}` : null;
}

export function playStatus(report: Pick<PlayReport, "actions" | "errors">): PlayReport["status"] {
  if (Object.values(report.errors).some((errors) => errors.length)
    || report.actions.some((step) => step.error || step.assertions.some((assertion) => !assertion.passed))) return "failed";
  return report.actions.some((step) => step.assertions.length || step.action.expectError) ? "passed" : "diagnostic";
}

function semanticFingerprint(snapshot: RuntimeSnapshot): string {
  const state = structuredClone(snapshot.state) as Record<string, unknown> | null;
  if (state && typeof state === "object") {
    delete state.clock;
    delete state.renderer;
  }
  return JSON.stringify({
    state,
    playerPosition: snapshot.playerPosition,
    camera: snapshot.camera,
    entities: snapshot.entities,
    currentActivity: snapshot.currentActivity,
    objectives: snapshot.objectives,
    navigation: snapshot.navigation,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  const scenarioCandidate = argValue(args, "--scenario");
  if (!runCandidate || !scenarioCandidate) {
    throw new Error("Usage: npm run play -- --run runs/<id> --scenario <file> [--url http://127.0.0.1:4174]");
  }
  const report = await runPlayScenario(
    runCandidate,
    scenarioCandidate,
    { url: argValue(args, "--url") },
  );
  console.log(JSON.stringify({
    scenario: report.scenario,
    passed: report.passed,
    status: report.status,
    actions: report.actions.map((step) => ({
      index: step.index,
      label: step.action.label,
      changed: step.changed,
      error: step.error,
      screenshot: step.screenshot,
      assertions: step.assertions,
    })),
    errors: report.errors,
    screenshots: report.screenshots,
  }, null, 2));
  if (report.status === "failed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("scripted play");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
