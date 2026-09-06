/** Root runs against the stable server; --url and --out are optional.
 * Existing final-world quest/bank/save integration. Setup seeds the two earlier quest objectives,
 * places the player, and opens interactions through the production dispatcher. Replies and bank
 * deposits use real UI input. Does not certify earlier traversal objectives or boss gates.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request } from "playwright";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";
import { createInitialState, setSkillLevel, type GameState } from "../../../game/src/state/store.js";

type Debug = NonNullable<Window["__gameDebug"]> & { getSaveBlob(): string; saveNow(): void; teleport(to: [number, number, number]): boolean };

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1] ?? fallback;
};
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", "test-results/finish-gameplay-deferred-rewards");
const questId = "the_carters_wager";
const seed = createInitialState(8124, 0);
setSkillLevel(seed, "agility", 3);
seed.quests[questId] = { status: "active", stage: 2, counters: {}, flags: {} };
seed.world.obstaclesUsed.wall_vault = 1;
seed.inventory.slots.fill(null);
seed.inventory.slots = seed.inventory.slots.map((_, slotIndex) => ({ slotIndex, itemId: "grithe_ore", quantity: 1 }));
const trace: { label: string; state: unknown }[] = [];
const report: Record<string, unknown> = { passed: false, trace, url,
  setup: "Seed active Carter's Wager at final conversation, Agility 3, prior wall traversal, full 28-slot ore inventory. Teleport to NPC/bank for bounded interaction checks.",
  worldLabException: "Existing authored quest giver, bank, and production persistent save must operate together; labs disable browser persistence.",
  visualEvidence: "Reduced graphics captures prove UI state only; inspect them separately." };
mkdirSync(out, { recursive: true });
const started = Date.now();
const hardLimit = setTimeout(() => {
  report.error = "Deferred reward gate exceeded 59 seconds including cleanup";
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  process.exit(1);
}, 59_000);
const driver = new GameDriver({ url, close: async () => {} }, { settings: FAST_TEST_SETTINGS,
  browserArgs: GAMEPLAY_HARDWARE_ARGS });
const pending = new Set<Request>();
let replacing = new Set<Request>();
const requestErrors: string[] = [];
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(4_000);
  page.on("request", (r) => pending.add(r));
  page.on("requestfinished", (r) => pending.delete(r));
  page.on("requestfailed", (r) => {
    if (!(replacing.has(r) && r.failure()?.errorText === "net::ERR_ABORTED")) requestErrors.push(`${r.url()}: ${r.failure()?.errorText}`);
    pending.delete(r);
  });
  await page.addInitScript((json) => {
    if (sessionStorage.getItem("finish-reward-seeded")) return;
    localStorage.setItem("corealm.save.v1", json);
    sessionStorage.setItem("finish-reward-seeded", "yes");
  }, JSON.stringify(seed));
  await page.goto(new URL("/index.html", url).href, { waitUntil: "domcontentloaded", timeout: 5_000 });
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 30_000 });
  report.renderer = await assertGameplayHardware(page);
  const read = () => page.evaluate(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState);
  const snapshot = async (label: string) => {
    const clock = await page.evaluate(() => window.__gameDebug!.getState().clock) as { paused: boolean; timeScale: number };
    assert.equal(clock.paused, false);
    assert.equal(clock.timeScale, 1);
    const state = await read();
    trace.push({ label, state: { currency: state.currency, skills: state.skills, quests: state.quests,
      inventory: state.inventory, bank: state.bank, equipment: state.equipment } });
    return state;
  };
  const count = (state: GameState, item: string) => state.inventory.slots.reduce((n, slot) => n + (slot?.itemId === item ? slot.quantity : 0), 0);
  const resume = page.getByRole("button", { name: "Return to game", exact: true });
  if (await resume.isVisible()) await resume.click();
  const placeAt = async (id?: string) => page.evaluate(({ id }) => {
    const debug = window.__gameDebug as Debug;
    const entities = debug.getEntities() as { id: string; archetype: string; regionId: string; position: { x: number; y: number; z: number } }[];
    const entity = id ? entities.find((e) => e.id === id)
      : entities.find((e) => e.archetype === "bank" && e.regionId === "fallowmarch");
    if (!entity) throw new Error(`Missing interaction fixture ${id ?? "bank"}`);
    if (!debug.teleport([entity.position.x + 1.5, entity.position.y, entity.position.z])) throw new Error("Setup teleport failed");
    return entity.id;
  }, { id });
  await placeAt("npc_carter_bel");
  const before = await snapshot("before final conversation with full inventory");
  assert.equal(count(before, "grithe_ore"), 28);
  const interaction = await driver.callDebug("callTool", ["corealm_interact", { entityId: "npc_carter_bel", interaction: "talk" }]);
  trace.push({ label: "production talk dispatch", state: interaction });
  assert(!(interaction && typeof interaction === "object" && "error" in interaction), JSON.stringify(interaction));
  const choose = async (id: string) => {
    await page.waitForFunction((id) => {
      const state = JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState;
      return state.dialogue?.options.some((option) => option.id === id && option.enabled);
    }, id);
    const state = await read();
    const choice = state.dialogue?.options.find((option) => option.id === id);
    assert(choice?.enabled, `Expected available reply ${id}`);
    await page.getByRole("group", { name: "Replies", exact: true }).getByRole("button", { name: choice.text, exact: false }).click();
  };
  await choose("bel_root#report");
  await choose("bel_wager_report#truth");
  await page.waitForFunction((id) => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests[id]?.status === "complete", questId);
  const completed = await snapshot("real conversation completes and defers all four items");
  assert.equal(completed.currency, before.currency + 260);
  assert.equal(completed.skills.agility.xp, before.skills.agility.xp + 180);
  assert.equal(completed.quests[questId]!.counters["pending:seared_minnow"], 4);
  assert.equal(count(completed, "seared_minnow"), 0);
  await page.keyboard.press("Escape");
  const openBank = async () => {
    const id = await placeAt();
    assert.equal(await driver.callDebug("openBank", [id]), true);
    await page.locator("#panel-bank").waitFor({ state: "visible" });
  };
  await openBank();
  const deposit = async () => {
    const state = await read();
    const index = state.inventory.slots.findIndex((slot) => slot?.itemId === "grithe_ore");
    assert(index >= 0);
    await page.locator(`#panel-bank .bank-column--inventory [data-slot-index="${index}"]`).click();
  };
  await deposit();
  await page.waitForFunction(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests.the_carters_wager.counters["pending:seared_minnow"] === 3);
  const partial = await snapshot("one UI deposit releases exactly one deferred reward");
  assert.equal(count(partial, "grithe_ore"), 27);
  assert.equal(count(partial, "seared_minnow"), 1);
  assert.equal(partial.currency, completed.currency);
  assert.deepEqual(partial.skills, completed.skills);
  await driver.screenshot(out, "01-partial-reward-bank");
  await page.evaluate(() => (window.__gameDebug as Debug).saveNow());
  replacing = new Set(pending);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 5_000 });
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 20_000 });
  if (await resume.isVisible()) await resume.click();
  const restored = await snapshot("partial reward survives actual reload");
  assert.deepEqual(restored.inventory, partial.inventory);
  assert.deepEqual(restored.bank, partial.bank);
  assert.equal(restored.quests[questId]!.counters["pending:seared_minnow"], 3);
  await openBank();
  for (let i = 0; i < 3; i++) await deposit();
  await page.waitForFunction(() => !JSON.parse((window.__gameDebug as Debug).getSaveBlob()).quests.the_carters_wager.counters["pending:seared_minnow"]);
  const final = await snapshot("all four rewards delivered without repeating XP or money");
  assert.equal(count(final, "grithe_ore"), 24);
  assert.equal(count(final, "seared_minnow"), 4);
  assert.equal(final.bank.slots.filter((s) => s.itemId === "grithe_ore").reduce((n, s) => n + s.quantity, 0), 4);
  assert.equal(final.currency, completed.currency);
  assert.deepEqual(final.skills, completed.skills);
  assert.deepEqual(final.equipment, before.equipment);
  await driver.screenshot(out, "02-reward-delivered-once");
  assert.deepEqual(await driver.callDebug("getErrors"), []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(requestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  if (driver.page && Date.now() - started < 53_000) {
    report.failureState = await driver.page.evaluate(() => JSON.parse((window.__gameDebug as Debug).getSaveBlob())).catch(() => null);
    await driver.screenshot(out, "failure").catch(() => undefined);
  }
} finally {
  report.requestErrors = requestErrors;
  report.consoleErrors = driver.consoleErrors;
  report.pageErrors = driver.pageErrors;
  await driver.close();
  clearTimeout(hardLimit);
  report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, elapsedMs: report.elapsedMs }));
}

