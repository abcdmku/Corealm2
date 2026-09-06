/** Root-only authored Coldbrace shop proof. --url / --out. Setup gives currency/ore and places
 * the player beside the real shop. Every buy and sell is a visible production-panel click.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";
import type { GameEvent, ShopView, Vec3 } from "../../../game/src/contracts.js";
import type { GameState } from "../../../game/src/state/store.js";
type Debug = NonNullable<Window["__gameDebug"]> & { getSaveBlob(): string; getEntity(id: string): { position: Vec3 } | null;
  teleport(position: Vec3): boolean; groundHeight(x: number, z: number): number; clearInventory(): void;
  setCurrency(value: number): void; giveItem(id: string, quantity: number, to: string): unknown;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped: boolean } };
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] ?? fallback; };
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", "test-results/finish-gameplay-shop-world");
const trace: unknown[] = [];
const report: Record<string, unknown> = { passed: false, trace, url,
  scope: "Authored world shop registration, ordinary UI names, quotes, five/one quantities, exact receipts and conservation. Compact shop fixture covers isolated economy.",
  setup: "Give200 marks/five Copper Ore and teleport beside the real Coldbrace shop. Normal Trade dispatcher opens it; transactions use UI buttons." };
mkdirSync(out, { recursive: true });
const started = Date.now();
const timer = setTimeout(() => { report.error = "59-second deadline"; writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); process.exit(1); }, 59_000);
const driver = new GameDriver({ url, close: async () => {} }, { settings: FAST_TEST_SETTINGS,
  browserArgs: GAMEPLAY_HARDWARE_ARGS });
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(4_000);
  await driver.open(30_000, "/index.html");
  report.renderer = await assertGameplayHardware(page);
  const read = () => page.evaluate(() => ({ state: JSON.parse((window.__gameDebug as Debug).getSaveBlob()) as GameState,
    events: (window.__gameDebug as Debug).getEvents(0) }));
  const tool = async <T>(name: string, args: Record<string, unknown>) => {
    const result = await driver.callDebug("callTool", [name, args]);
    assert(!(result && typeof result === "object" && "error" in result), JSON.stringify(result));
    return result as T;
  };
  const resume = page.getByRole("button", { name: "Return to game", exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.evaluate(() => {
    const debug = window.__gameDebug as Debug;
    const shop = debug.getEntity("coldbrace_general");
    if (!shop) throw new Error("Missing authored shop coldbrace_general");
    debug.clearInventory(); debug.setCurrency(200); debug.giveItem("grithe_ore", 5, "inventory");
    const x = shop.position[0] - 2, z = shop.position[2];
    if (!debug.teleport([x, debug.groundHeight(x, z), z])) throw new Error("Could not place player at authored shop approach");
  });
  const initial = await read();
  const quote = await tool<ShopView>("corealm_shop", { op: "list", shopId: "coldbrace_general" });
  assert.equal(quote.sellPrices.grithe_ore, 7);
  const food = quote.stock.find((item) => item.itemId === "seared_minnow");
  assert(food); assert.equal(food.buyPrice, 22); assert.equal(food.sellPrice, 13);
  await tool("corealm_interact", { entityId: "coldbrace_general", interaction: "trade" });
  const panel = page.locator("#panel-shop");
  await panel.waitFor({ state: "visible" });
  const row = (column: number, name: string) => panel.locator(".shop-column").nth(column)
    .getByRole("listitem").filter({ has: page.locator(".shop-row__name", { hasText: name }) });
  assert.equal((await row(1, "Copper Ore").locator(".shop-row__price").innerText()).trim(), "7 ◈");
  assert.equal((await row(0, "Seared Minnow").locator(".shop-row__price").innerText()).trim(), "22 ◈");
  await driver.screenshot(out, "01-world-quotes");
  const count = (state: GameState, id: string) => state.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === id ? slot.quantity : 0), 0);
  const transact = async (buy: boolean, name: string, id: string, quantity: 1 | 5, price: number) => {
    const before = await read();
    await panel.getByRole("radiogroup", { name: "Amount" }).getByRole("radio", { name: String(quantity), exact: true }).click();
    await row(buy ? 0 : 1, name).getByRole("button", { name: buy ? "Buy" : "Sell", exact: true }).click();
    const expectedCurrency = before.state.currency + (buy ? -1 : 1) * quantity * price;
    await page.waitForFunction(({ currency, since, buy, id }) => {
      const debug = window.__gameDebug as Debug;
      return JSON.parse(debug.getSaveBlob()).currency === currency
        && debug.getEvents(since).events.some((event) => event.seq > since
          && event.type === (buy ? "item.received" : "item.lost") && event.data.itemId === id);
    }, { currency: expectedCurrency, since: before.events.nextSeq, buy, id });
    const after = await read();
    assert.equal(count(after.state, id) - count(before.state, id), (buy ? 1 : -1) * quantity);
    assert.equal(after.state.currency, expectedCurrency);
    assert.deepEqual(after.state.bank, initial.state.bank); assert.deepEqual(after.state.equipment, initial.state.equipment);
    assert.equal(after.events.dropped, false);
    const receipts = after.events.events.filter((event) => event.seq > before.events.nextSeq);
    trace.push({ label: "transaction observed after normal event flush", buy, name, quantity, receipts });
    const moved = receipts.filter((event) => event.type === (buy ? "item.received" : "item.lost") && event.data.itemId === id);
    const money = receipts.filter((event) => event.type === (buy ? "item.lost" : "item.received") && event.data.name === "marks");
    assert.equal(moved.length, 1); assert.equal(moved[0]!.data.quantity, quantity);
    assert.equal(moved[0]!.data.name, name);
    assert.equal(money.length, 1); assert.equal(money[0]!.data.quantity, quantity * price);
    const currentQuote = await tool<ShopView>("corealm_shop", { op: "list", shopId: "coldbrace_general" });
    assert.deepEqual(currentQuote.stock, quote.stock);
    trace.push({ buy, name, quantity, before: { currency: before.state.currency, inventory: before.state.inventory },
      after: { currency: after.state.currency, inventory: after.state.inventory }, receipts });
  };
  await transact(false, "Copper Ore", "grithe_ore", 5, 7);
  await transact(true, "Seared Minnow", "seared_minnow", 5, 22);
  await transact(false, "Seared Minnow", "seared_minnow", 5, 13);
  await transact(true, "Seared Minnow", "seared_minnow", 1, 22);
  await transact(false, "Seared Minnow", "seared_minnow", 1, 13);
  const final = await read();
  assert.equal(final.state.currency, 181);
  assert(final.state.inventory.slots.every((slot) => slot === null));
  await driver.screenshot(out, "02-world-shop-roundtrips");
  assert.deepEqual(await driver.callDebug("getErrors"), []);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) { report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
  if (driver.page && Date.now() - started < 53_000) {
    report.failureState = await driver.page.evaluate(() => ({ state: JSON.parse((window.__gameDebug as Debug).getSaveBlob()),
      events: (window.__gameDebug as Debug).getEvents(0) })).catch(() => null);
    await driver.screenshot(out, "failure").catch(() => undefined);
  }
} finally {
  report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors;
  await driver.close(); clearTimeout(timer); report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, elapsedMs: report.elapsedMs }));
}
