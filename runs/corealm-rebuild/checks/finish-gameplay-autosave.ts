/** Root-only normal-clock autosave check. --case valid|protected --url <stable server> --out <dir>.
 * The stored character and one currency mutation are setup. Only the unmodified production
 * ten-second scheduler may write during observation; no saveNow or time acceleration is used.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";
import { createInitialState, type GameState } from "../../../game/src/state/store.js";
type Debug = NonNullable<Window["__gameDebug"]> & { setCurrency(value: number): void; getSaveBlob(): string };
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] ?? fallback; };
const scenario = arg("--case", "valid");
assert(["valid", "protected"].includes(scenario));
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", `test-results/finish-gameplay-autosave/${scenario}`);
const seed = createInitialState(8124, 0);
seed.currency = 317;
const raw = scenario === "valid" ? JSON.stringify(seed) : "{\nprotected autosave original\n";
const report: Record<string, unknown> = { passed: false, scenario,
  worldLabException: "Production persistence and its normal autosave scheduler are disabled in lab mode.",
  setup: "Seed isolated browser storage; use debug setCurrency to dirty the temporary or loaded character.",
  assertions: "Observe at least 11 seconds of real running simulation and unchanged timeScale. No manual save or accelerated clock." };
mkdirSync(out, { recursive: true });
const started = Date.now();
const timer = setTimeout(() => { report.error = "59-second deadline"; writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); process.exit(1); }, 59_000);
const driver = new GameDriver({ url, close: async () => {} }, { settings: FAST_TEST_SETTINGS,
  browserArgs: GAMEPLAY_HARDWARE_ARGS });
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(4_000);
  await page.addInitScript((raw) => localStorage.setItem("corealm.save.v1", raw), raw);
  await driver.open(30_000, "/index.html");
  report.renderer = await assertGameplayHardware(page);
  const read = () => page.evaluate(() => ({ raw: localStorage.getItem("corealm.save.v1"),
    state: JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState,
    clock: window.__gameDebug!.getState().clock as { elapsedMs: number; paused: boolean; timeScale: number } }));
  const before = await read();
  if (scenario === "protected") assert.equal(before.raw, raw);
  else assert.equal(before.state.currency, 317);
  await driver.callDebug("setCurrency", [719]);
  const observed = Date.now();
  // The ordinary scheduler uses real elapsed time, independent of browser frame rate.
  await page.waitForFunction((elapsedMs) => {
    const clock = window.__gameDebug!.getState().clock as { elapsedMs: number };
    return clock.elapsedMs >= elapsedMs + 11_000;
  }, before.clock.elapsedMs, { timeout: 18_000 });
  const after = await read();
  assert(Date.now() - observed >= 10_000, "Scheduler evidence requires real elapsed time");
  assert.equal(after.clock.timeScale, 1); assert.equal(after.clock.paused, false);
  assert.equal(after.state.currency, 719);
  assert(after.clock.elapsedMs >= before.clock.elapsedMs + 11_000);
  if (scenario === "protected") assert.equal(after.raw, raw, "Autosave cannot replace the original rejected bytes");
  else {
    assert(after.raw);
    const saved = JSON.parse(after.raw) as GameState;
    assert.equal(saved.currency, 719, "Normal autosave must save the changed character");
    assert(saved.meta.lastSavedAtMs >= observed);
    assert.deepEqual(saved.inventory, after.state.inventory);
    assert.deepEqual(saved.equipment, after.state.equipment);
  }
  report.before = { raw: before.raw, currency: before.state.currency, clock: before.clock };
  report.after = { raw: after.raw, currency: after.state.currency, clock: after.clock };
  const errors = await driver.callDebug("getErrors") as { source: string; message: string }[];
  if (scenario === "protected") {
    assert.equal(errors.length, 1); assert.equal(errors[0]!.source, "persistence");
    assert.match(errors[0]!.message, /^Save could not be loaded:/);
  } else assert.deepEqual(errors, []);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
} finally {
  report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  await driver.close(); clearTimeout(timer); report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenario, error: report.error, elapsedMs: report.elapsedMs }));
}
