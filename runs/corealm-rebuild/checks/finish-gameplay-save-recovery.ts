/** Root-only Chromium gate. Run each case separately with --case malformed|future|invalid|new-game.
 * Uses the authored world because persistence is disabled in compact labs. Initial storage is
 * explicit setup; recovery/new-game acceptance uses the production UI. Captures need review.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request } from "playwright";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";
import { createInitialState, SAVE_VERSION, type GameState } from "../../../game/src/state/store.js";

type Debug = NonNullable<Window["__gameDebug"]> & { getSaveBlob(): string; saveNow(): void; teleport(to: [number, number, number]): boolean };

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const scenario = arg("--case", "malformed");
assert(["malformed", "future", "invalid", "new-game"].includes(scenario));
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", `test-results/finish-gameplay-save-recovery/${scenario}`);
const initial = createInitialState(8124, 0);
initial.currency = 317;
initial.player.name = "Recovery acceptance";
const future = structuredClone(initial);
future.meta.saveVersion = SAVE_VERSION + 100;
const invalid = structuredClone(initial);
invalid.currency = -9;
const rejectedRaw = scenario === "future" ? JSON.stringify(future)
  : scenario === "invalid" ? JSON.stringify(invalid) : "{\n  \"character\": broken original\n";
const key = "corealm.save.v1";
const report: Record<string, unknown> = {
  passed: false, scenario, url,
  worldLabException: "Testing production browser-storage load and recovery; compact labs intentionally disable persistence.",
  setup: "Seed one isolated browser context with rejected save text before world boot. Import a known valid character through Settings.",
  visualEvidence: "Reduced graphics semantic captures; not production art acceptance.",
};
const trace: { label: string; value: unknown }[] = [];
report.trace = trace;
mkdirSync(out, { recursive: true });
const started = Date.now();
const hardLimit = setTimeout(() => {
  report.error = "Save recovery gate exceeded 59 seconds including cleanup";
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  process.exit(1);
}, 59_000);
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, settings: FAST_TEST_SETTINGS,
  browserArgs: GAMEPLAY_HARDWARE_ARGS,
});
const pending = new Set<Request>();
let replacing = new Set<Request>();
const requestErrors: string[] = [];
const expectedAborts: string[] = [];

try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(4_000);
  page.on("request", (request) => pending.add(request));
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => {
    const detail = `${request.url()}: ${request.failure()?.errorText}`;
    if (replacing.has(request) && request.failure()?.errorText === "net::ERR_ABORTED") expectedAborts.push(detail);
    else requestErrors.push(detail);
    pending.delete(request);
  });
  await page.addInitScript(({ key, raw }) => {
    // The sentinel survives document reload and must never reseed the recovered character.
    if (sessionStorage.getItem("finish-save-seeded")) return;
    localStorage.setItem(key, raw);
    sessionStorage.setItem("finish-save-seeded", "yes");
  }, { key, raw: rejectedRaw });
  await page.goto(new URL("/index.html", url).href, { waitUntil: "domcontentloaded", timeout: 5_000 });
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 30_000 });
  report.renderer = await assertGameplayHardware(page);
  const read = () => page.evaluate(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState);
  const stored = () => page.evaluate((key) => localStorage.getItem(key), key);
  const snapshot = async (label: string) => {
    const clock = await page.evaluate(() => window.__gameDebug!.getState().clock) as { paused: boolean; timeScale: number };
    assert.equal(clock.paused, false);
    assert.equal(clock.timeScale, 1);
    const state = await read();
    trace.push({ label, value: { currency: state.currency, player: state.player,
      inventory: state.inventory, equipment: state.equipment, bank: state.bank, quests: state.quests } });
    return state;
  };
  assert.equal(await stored(), rejectedRaw);
  const bootErrors = await driver.callDebug("getErrors") as { source: string; message: string }[];
  assert.equal(bootErrors.length, 1, "Only the deliberately rejected save may produce a boot diagnostic");
  assert.equal(bootErrors[0]!.source, "persistence");
  assert.match(bootErrors[0]!.message, /^Save could not be loaded:/);
  const menu = page.getByRole("dialog", { name: "Corealm", exact: true });
  if (!await menu.isVisible()) await page.keyboard.press("Escape");
  await menu.getByRole("heading", { name: "Save needs recovery" }).waitFor();
  const before = await snapshot("rejected load uses temporary character");
  assert.notEqual(before.currency, initial.currency);
  // Diagnostic save/pagehide probes supplement the real import interaction below.
  await page.evaluate(() => {
    (window.__gameDebug as Debug).saveNow();
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
  });
  assert.equal(await stored(), rejectedRaw, "saveNow/pagehide must preserve exact rejected bytes");
  await driver.screenshot(out, "01-protected-original");
  if (scenario === "new-game") {
    await menu.getByRole("button", { name: "New game", exact: true }).click();
    const destroy = menu.getByRole("button", { name: "Delete save and start over", exact: true });
    assert.equal(await destroy.isDisabled(), true);
    assert.equal(await stored(), rejectedRaw, "Opening confirmation cannot delete the original");
    await menu.getByRole("button", { name: "Keep original save" }).click();
    assert.equal(await stored(), rejectedRaw);
    await menu.getByRole("button", { name: "New game", exact: true }).click();
    await menu.getByRole("checkbox").check();
    await destroy.click();
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true);
    await page.evaluate(() => (window.__gameDebug as Debug).saveNow());
    const saved = JSON.parse((await stored())!) as GameState;
    assert.equal(saved.meta.saveVersion, SAVE_VERSION);
    assert.equal(saved.currency, createInitialState().currency);
    await snapshot("explicit confirmed new game saves normally");
  } else {
    await menu.getByRole("button", { name: "Recover save", exact: true }).click();
    const input = page.getByLabel("Choose a save file to recover", { exact: true });
    await input.setInputFiles({ name: "invalid-save.json", mimeType: "application/json", buffer: Buffer.from("{") });
    await page.getByText(/The original is still protected\./).waitFor();
    assert.equal(await stored(), rejectedRaw, "Rejected import is atomic");
    const afterBad = await snapshot("invalid import leaves temporary character intact");
    assert.equal(afterBad.currency, before.currency);
    assert.deepEqual(afterBad.inventory, before.inventory);
    assert.deepEqual(afterBad.equipment, before.equipment);
    await input.setInputFiles({ name: "working-save.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(initial)) });
    await page.getByText("Save recovered. Your character is loaded and saving is active.", { exact: true }).waitFor();
    const recovered = await snapshot("valid import applies character");
    assert.equal(recovered.currency, 317);
    assert.equal(recovered.player.name, initial.player.name);
    assert.deepEqual(recovered.inventory, initial.inventory);
    assert.deepEqual(recovered.equipment, initial.equipment);
    assert.deepEqual(recovered.bank, initial.bank);
    assert.equal(JSON.parse((await stored())!).currency, 317);
    await driver.screenshot(out, "02-recovered-character");
    replacing = new Set(pending);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 5_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 20_000 });
    const restored = await snapshot("actual reload keeps recovered character");
    assert.equal(restored.currency, recovered.currency);
    assert.deepEqual(restored.inventory, recovered.inventory);
    assert.deepEqual(restored.equipment, recovered.equipment);
    assert.deepEqual(restored.bank, recovered.bank);
  }
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(requestErrors, []);
  // Rejected-save diagnostics are expected; unexpected renderer/runtime faults are not.
  const gameErrors = await driver.callDebug("getErrors") as { source: string; message: string }[];
  assert.deepEqual(gameErrors.filter((error) => error.source !== "persistence"), []);
  assert(gameErrors.length <= 1, "No additional game diagnostics are expected");
  report.gameErrors = gameErrors;
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  report.consoleErrors = driver.consoleErrors;
  report.pageErrors = driver.pageErrors;
  report.requestErrors = requestErrors;
  report.expectedReloadAborts = expectedAborts;
  await driver.close();
  clearTimeout(hardLimit);
  report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenario, error: report.error, elapsedMs: report.elapsedMs }));
}

