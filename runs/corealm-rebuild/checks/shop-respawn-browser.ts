/** Root runs each command separately on the existing production Vite server:
 * npx tsx test-results/shop-respawn-browser.ts --scenario shop
 * npx tsx test-results/shop-respawn-browser.ts --scenario respawn
 * Each process includes Chromium shutdown in its 59-second hard deadline.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Request } from "playwright";
import { GameDriver } from "../../../tools/lib/driver.js";
import type { GameEvent, RegionId, ShopView, Vec3 } from "../../../game/src/contracts.js";
import type { GameState } from "../../../game/src/state/store.js";
import type { ShopFixture } from "../../../game/src/featureLab/shop.js";

type ClockView = { tick: number; elapsedMs: number; paused: boolean; timeScale: number };
type ReceiptBatch = { events: GameEvent[]; nextSeq: number; dropped?: boolean };
type Debug = NonNullable<Window["__gameDebug"]> & {
  getSaveBlob(): string;
  getEvents(since: number): ReceiptBatch;
  saveNow(): void;
  clearInventory(): void;
  setCurrency(value: number): void;
  setHealth(value: number): void;
  giveItem(itemId: string, quantity: number, to: string): unknown;
  teleport(to: Vec3 | { locationId: string }): boolean;
  groundHeight(x: number, z: number): number;
  listRouteNodes(): { id: string; regionId: RegionId; position: Vec3 }[];
};
type LabWindow = Window & { __shopLab?: ShopFixture };
const scenario = process.argv[process.argv.indexOf("--scenario") + 1];
assert(process.argv.includes("--scenario") && (scenario === "shop" || scenario === "respawn"),
  "Use --scenario shop or --scenario respawn");
const out = `test-results/shop-respawn-browser/${scenario}`;
const started = Date.now();
const budgetMs = 59_000;
const deadline = started + budgetMs;
const actionDeadline = deadline - 2_500;
const trace: { label: string; elapsedMs: number; value: unknown }[] = [];
const report: Record<string, unknown> = { passed: false, scenario, stage: "boot", budgetMs, trace };
let baselineSeq = 0;
const pendingRequests = new Set<Request>();
let requestsAtReload = new Set<Request>();
const intentionalReloadAborts: string[] = [];
const unexpectedRequestErrors: string[] = [];
mkdirSync(out, { recursive: true });
const driver = new GameDriver({ url: process.env.COREALM_URL ?? "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const hardLimit = setTimeout(() => {
  report.passed = false;
  report.error = `${scenario} exceeded its 59-second hard limit`;
  report.elapsedMs = Date.now() - started;
  try { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); }
  finally { process.exit(1); }
}, Math.max(1, deadline - Date.now()));

function record(label: string, value: unknown): void {
  trace.push({ label, elapsedMs: Date.now() - started, value });
}

async function bounded<T>(label: string, action: () => Promise<T>, until = actionDeadline): Promise<T> {
  const remaining = Math.min(4_000, until - Date.now());
  assert(remaining > 0, `Overall budget expired at ${label}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${remaining} ms`)), remaining);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitUntil(label: string, predicate: () => Promise<boolean>, budget = 2_000): Promise<void> {
  const until = Math.min(actionDeadline, Date.now() + budget);
  while (Date.now() < until) {
    if (await bounded(label, predicate, until)) return;
    await bounded(`${label}: poll`, () => driver.wait(Math.min(100, Math.max(1, until - Date.now()))), until);
  }
  throw new Error(`${label} did not finish within ${budget} ms`);
}

async function read() {
  return bounded("read canonical state", () => driver.page!.evaluate((since) => {
    const debug = window.__gameDebug as Debug;
    const state = JSON.parse(debug.getSaveBlob()) as GameState;
    return {
      player: state.player, inventory: state.inventory, currency: state.currency,
      equipment: state.equipment, bank: state.bank, skills: state.skills,
      recoveryCache: state.world.recoveryCache,
      activity: state.activity, clock: debug.getState().clock as ClockView,
      events: debug.getEvents(since),
    };
  }, baselineSeq));
}

async function snapshot(label: string) {
  const state = await read();
  assert.equal(state.clock.paused, false, "Acceptance uses the normal running clock");
  assert.equal(state.clock.timeScale, 1, "Acceptance never accelerates simulation time");
  assert.equal(state.events.dropped, false, "Acceptance receipts must not overflow");
  record(label, state);
  return state;
}

async function capture(name: string): Promise<void> {
  record("screenshot", await bounded(`capture ${name}`, () => driver.screenshot(out, name)));
}

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await bounded(name, () => driver.callDebug("callTool", [name, args]));
  record(name, { args, result });
  assert(!(result && typeof result === "object" && "error" in result), `${name}: ${JSON.stringify(result)}`);
  return result as T;
}

function items(state: Awaited<ReturnType<typeof read>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const slot of state.inventory.slots) {
    if (slot) totals[slot.itemId] = (totals[slot.itemId] ?? 0) + slot.quantity;
  }
  return totals;
}

function near(actual: Vec3, expected: Vec3, label: string, tolerance = 0.7): void {
  assert(Math.hypot(actual[0] - expected[0], actual[2] - expected[2]) <= tolerance,
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  assert(Math.abs(actual[1] - expected[1]) <= 0.7, `${label}: incorrect height`);
}

function receipt(events: GameEvent[], since: number, type: GameEvent["type"], itemId: string, quantity: number): void {
  const matches = events.filter((event) => event.seq > since && event.type === type
    && (itemId === "marks" ? event.data.name === "marks" : event.data.itemId === itemId));
  assert.equal(matches.length, 1, `Expected exactly one ${type} receipt for ${itemId}`);
  assert.equal(matches[0]!.data.quantity, quantity);
}

async function shopScenario(): Promise<void> {
  const page = driver.page!;
  const fixture = await bounded("read shop fixture", () => page.evaluate(() => {
    const fixture = (window as LabWindow).__shopLab;
    if (!fixture) throw new Error("Missing production shop fixture");
    return { shopId: fixture.shopId, interactionPosition: fixture.interactionPosition };
  }));
  assert.equal(fixture.shopId, "coldbrace_general");
  report.stage = "prepare-shop";
  // Setup grants are silent. Every transaction below uses the visible production panel.
  await bounded("prepare carried ore", () => page.evaluate((position) => {
    const debug = window.__gameDebug as Debug;
    debug.clearInventory();
    debug.setCurrency(0);
    debug.giveItem("grithe_ore", 5, "inventory");
    if (!debug.teleport(position)) throw new Error("Could not reach the shop approach");
  }, fixture.interactionPosition));
  const prepared = await snapshot("diagnostic shop prerequisites");
  baselineSeq = prepared.events.nextSeq;
  assert.deepEqual(items(prepared), { grithe_ore: 5 });
  assert.equal(prepared.currency, 0);
  near(prepared.player.position, fixture.interactionPosition, "Shop approach");
  const initial = await tool<ShopView>("corealm_shop", { op: "list", shopId: fixture.shopId });
  assert.equal(initial.stock.length, 7);
  assert(!initial.stock.some((row) => row.itemId === "grithe_ore"), "Ore is a nonstock sale case");
  assert.equal(initial.sellPrices.grithe_ore, 7, "12 marks times 0.6 rounds to 7, once per unit");
  const minnow = initial.stock.find((row) => row.itemId === "seared_minnow");
  assert(minnow);
  assert.deepEqual({ buy: minnow.buyPrice, sell: minnow.sellPrice, stock: minnow.quantity },
    { buy: 22, sell: 13, stock: 30 });
  await tool("corealm_interact", { entityId: fixture.shopId, interaction: "trade" });
  const panel = page.locator("#panel-shop");
  await waitUntil("real Trade opens shop", () => panel.isVisible());
  await waitUntil("Trade emits its receipt", async () => (await read()).events.events.some((event) =>
    event.type === "activity.started" && event.entityId === fixture.shopId && event.data.kind === "shop"
    && event.data.interaction === "trade"));
  const amount = panel.getByRole("radiogroup", { name: "Amount" });
  const row = (column: number, name: string) => panel.locator(".shop-column").nth(column)
    .getByRole("listitem").filter({ has: page.locator(".shop-row__name", { hasText: name }) });
  assert.equal((await bounded("ore displayed price", () => row(1, "Grithe Ore").locator(".shop-row__price").innerText())).trim(), "7 ◈");
  assert.equal((await bounded("minnow displayed price", () => row(0, "Seared Minnow").locator(".shop-row__price").innerText())).trim(), "22 ◈");
  await capture("01-shop-quotes-before-trading");

  const transact = async (label: string, column: number, name: string, quantity: "1" | "5",
    currency: number, expectedItems: Record<string, number>, movedItemId: string, movedQuantity: number,
    marks: number) => {
    report.stage = label;
    const before = await snapshot(`${label}: before`);
    await bounded(`${label}: amount`, () => amount.getByRole("radio", { name: quantity, exact: true }).click());
    await bounded(`${label}: click`, () => row(column, name).getByRole("button", { name: column === 0 ? "Buy" : "Sell", exact: true }).click());
    await waitUntil(`${label}: wallet and receipts`, async () => {
      const current = await read();
      return current.currency === currency && current.events.events.some((event) => event.seq > before.events.nextSeq
        && event.type === (column === 0 ? "item.lost" : "item.received") && event.data.name === "marks"
        && event.data.quantity === marks);
    });
    const after = await snapshot(`${label}: after`);
    assert.equal(after.currency, currency);
    assert.deepEqual(items(after), expectedItems);
    assert.equal(after.currency - before.currency, column === 0 ? -marks : marks);
    receipt(after.events.events, before.events.nextSeq, column === 0 ? "item.received" : "item.lost", movedItemId, movedQuantity);
    receipt(after.events.events, before.events.nextSeq, column === 0 ? "item.lost" : "item.received", "marks", marks);
    assert.deepEqual(after.equipment, prepared.equipment);
    assert.deepEqual(after.bank, prepared.bank);
    const quote = await tool<ShopView>("corealm_shop", { op: "list", shopId: fixture.shopId });
    assert.deepEqual(quote.stock, initial.stock, "Production stock is fixed after purchases and sales");
    assert.equal(quote.currency, currency);
    assert(!quote.stock.some((entry) => entry.itemId === "grithe_ore"), "Selling ore does not add a shelf line");
    await waitUntil(`${label}: visible wallet`, async () => (await panel.locator(".shop__marks").innerText()).trim() === `${currency} marks`);
    return quote;
  };

  await transact("sell-five-nonstock-ore", 1, "Grithe Ore", "5", 35, {}, "grithe_ore", 5, 35);
  const bought = await transact("buy-one-minnow", 0, "Seared Minnow", "1", 13, { seared_minnow: 1 }, "seared_minnow", 1, 22);
  assert.equal(bought.sellPrices.seared_minnow, 13);
  assert.equal((await bounded("carried minnow quote", () => row(1, "Seared Minnow").locator(".shop-row__price").innerText())).trim(), "13 ◈");
  await capture("02-minnow-purchase-and-resale-quote");
  const sold = await transact("resell-one-minnow", 1, "Seared Minnow", "1", 26, {}, "seared_minnow", 1, 13);
  assert.deepEqual(sold.sellPrices, {});
  await capture("03-shop-roundtrip-final-wallet");
}

// Independent authored expectations. Y is measured from the live route graph, not synthesized.
const towns = [
  { id: "rootfall", regionId: "vellenwood", nodeId: "rootfall_hamlet", xz: [60, 120] },
  { id: "highcairn", regionId: "karrowmoor", nodeId: "highcairn_outpost", xz: [144, -66] },
  { id: "emberfast", regionId: "kilnhalt", nodeId: "emberfast_town", xz: [2, 325] },
  { id: "coldbrace", regionId: "fallowmarch", nodeId: "town_center", xz: [-160, -80] },
] as const;

async function respawnScenario(): Promise<void> {
  const page = driver.page!;
  report.worldLabException = "The four authored town locations and their persistent full-world spawn mapping are the behavior under test. Setup teleport only places the player; the normal visited tick must bind every anchor.";
  const nodes = await bounded("read authored route nodes", () => page.evaluate(() => (window.__gameDebug as Debug).listRouteNodes()));
  const anchors = towns.map((town) => {
    const node = nodes.find((candidate) => candidate.id === town.nodeId);
    assert(node, `Missing authored node ${town.nodeId}`);
    assert.equal(node.regionId, town.regionId);
    assert.deepEqual([node.position[0], node.position[2]], town.xz);
    return { ...town, position: node.position };
  });
  record("independent four-town anchors", anchors);
  baselineSeq = (await read()).events.nextSeq;

  const save = async (expectedId: string) => {
    const persisted = await bounded("save checkpoint to production storage", () => page.evaluate(() => {
      const debug = window.__gameDebug as Debug;
      debug.saveNow();
      const json = localStorage.getItem("corealm.save.v1");
      if (!json) throw new Error("Production save was not written");
      const saved = JSON.parse(json) as GameState;
      return { player: saved.player, inventory: saved.inventory, currency: saved.currency };
    }));
    assert.equal(persisted.player.respawnPointId, expectedId);
    record(`persisted ${expectedId}`, persisted);
    return persisted;
  };

  const visit = async (anchor: typeof anchors[number], screenshot?: string) => {
    report.stage = `visit-${anchor.id}`;
    const placed = await bounded(`place at ${anchor.nodeId}`, () => page.evaluate((nodeId) => {
      const debug = window.__gameDebug as Debug;
      const before = JSON.parse(debug.getSaveBlob()) as GameState;
      const tick = (debug.getState().clock as ClockView).tick;
      const moved = debug.teleport({ locationId: nodeId });
      const immediate = JSON.parse(debug.getSaveBlob()) as GameState;
      return { moved, tick, previous: before.player.respawnPointId, immediate: immediate.player.respawnPointId,
        position: immediate.player.position, regionId: immediate.player.regionId };
    }, anchor.nodeId));
    assert.equal(placed.moved, true);
    assert.notEqual(placed.previous, anchor.id, "Every visit must change the prior checkpoint");
    assert.equal(placed.immediate, placed.previous, "Diagnostic placement must not bind the checkpoint itself");
    assert.equal(placed.regionId, anchor.regionId);
    assert(Math.hypot(placed.position[0] - anchor.position[0], placed.position[2] - anchor.position[2]) <= 12);
    assert(Math.abs(placed.position[1] - anchor.position[1]) <= 4);
    record(`${anchor.id}: before normal visit tick`, placed);
    await waitUntil(`${anchor.id}: normal visit tick`, async () => {
      const current = await read();
      return current.clock.tick > placed.tick && current.player.respawnPointId === anchor.id;
    });
    const visited = await snapshot(`${anchor.id}: bound after normal tick`);
    assert.equal(visited.player.regionId, anchor.regionId);
    assert.equal(visited.player.respawnPointId, anchor.id);
    await save(anchor.id);
    if (screenshot) await capture(screenshot);
  };
  for (const [index, anchor] of anchors.entries()) await visit(anchor, `0${index + 1}-${anchor.id}-visited`);

  const representative = anchors[1]!;
  await visit(representative);
  report.stage = "save-highcairn-away-from-town";
  await bounded("prepare remote death and persistence inputs", () => page.evaluate(() => {
    const debug = window.__gameDebug as Debug;
    debug.clearInventory();
    debug.setCurrency(137);
    debug.giveItem("grithe_ore", 3, "inventory");
    const outside: Vec3 = [-160, debug.groundHeight(-160, -118), -118];
    if (!debug.teleport(outside)) throw new Error("Could not place the remote death scenario");
  }));
  const placedOutside = await snapshot("outside all town courtyards");
  assert.equal(placedOutside.player.regionId, "fallowmarch");
  assert.equal(placedOutside.player.respawnPointId, "highcairn");
  for (const anchor of anchors) {
    assert(Math.hypot(placedOutside.player.position[0] - anchor.position[0], placedOutside.player.position[2] - anchor.position[2]) > 12,
      `The reload position must be outside ${anchor.id}'s binding radius`);
  }
  await waitUntil("region change without town visit preserves checkpoint", async () => (await read()).clock.tick > placedOutside.clock.tick);
  const beforeReload = await snapshot("nondefault checkpoint before reload");
  assert.equal(beforeReload.player.respawnPointId, "highcairn");
  assert.deepEqual(items(beforeReload), { grithe_ore: 3 });
  assert.equal(beforeReload.currency, 137);
  await save("highcairn");
  // Actual document reload proves persistence. The saved position cannot rebind Highcairn.
  report.stage = "reload-production-save";
  // The ready game may still fetch deferred assets. Only requests already pending at this
  // deliberate document replacement may produce an expected Chromium cancellation.
  requestsAtReload = new Set(pendingRequests);
  await bounded("reload full game", () => page.reload({ waitUntil: "domcontentloaded", timeout: 4_000 }));
  await waitUntil("full game loads saved state", () => page.evaluate(() => window.__gameDebug?.getState().ready === true), 25_000);
  baselineSeq = 0;
  const restored = await snapshot("nondefault checkpoint survives actual reload");
  assert.equal(restored.player.respawnPointId, "highcairn");
  assert.equal(restored.player.regionId, "fallowmarch");
  near(restored.player.position, beforeReload.player.position, "Saved remote position");
  assert.deepEqual(restored.inventory, beforeReload.inventory);
  assert.equal(restored.currency, 137);
  assert.deepEqual(restored.skills, beforeReload.skills);
  assert.deepEqual(restored.equipment, beforeReload.equipment);
  assert.deepEqual(restored.bank, beforeReload.bank);
  await capture("05-remote-save-restored");

  report.stage = "death-respawns-at-saved-highcairn";
  const beforeDeath = await snapshot("before lethal diagnostic input");
  await bounded("set health to zero", () => driver.callDebug("setHealth", [0]));
  await waitUntil("normal DeathSystem restores player", async () => {
    const current = await read();
    return current.player.health > 0 && current.events.events.some((event) => event.seq > beforeDeath.events.nextSeq && event.type === "player.died");
  });
  const after = await snapshot("real death and respawn result");
  const deaths = after.events.events.filter((event) => event.seq > beforeDeath.events.nextSeq && event.type === "player.died");
  assert.equal(deaths.length, 1);
  assert.equal(after.player.respawnPointId, "highcairn");
  assert.equal(after.player.regionId, "karrowmoor");
  near(after.player.position, representative.position, "Death resolves the saved Highcairn route anchor");
  assert.equal(after.player.health, after.player.maxHealth);
  assert.equal(after.player.movement.mode, "idle");
  assert.equal(after.activity, null);
  assert.deepEqual(items(after), {});
  assert.equal(after.currency, 137);
  assert.deepEqual(after.skills, beforeDeath.skills);
  assert.deepEqual(after.equipment, beforeDeath.equipment);
  assert.deepEqual(after.bank, beforeDeath.bank);
  assert(after.recoveryCache);
  assert.equal(after.recoveryCache.id, "recovery_cache");
  assert.equal(after.recoveryCache.regionId, "fallowmarch");
  // Grithe Ore occupies one slot per item. Death preserves those three stacks in the cache.
  assert.deepEqual(after.recoveryCache.items, [
    { itemId: "grithe_ore", quantity: 1 },
    { itemId: "grithe_ore", quantity: 1 },
    { itemId: "grithe_ore", quantity: 1 },
  ]);
  near(after.recoveryCache.position, beforeDeath.player.position, "Cache remains at the remote death site");
  assert.equal(deaths[0]!.data.respawnPointId, "highcairn");
  assert.deepEqual(deaths[0]!.data.respawnPosition, representative.position);
  assert.deepEqual(deaths[0]!.data.position, beforeDeath.player.position);
  assert.equal(deaths[0]!.data.cacheId, "recovery_cache");
  assert.equal(deaths[0]!.data.itemsLost, 3);
  await capture("06-highcairn-respawn-with-recovery-cache");
  await save("highcairn");
}

try {
  await bounded("launch Chromium", () => driver.launch());
  const page = driver.page!;
  page.on("request", (request) => pendingRequests.add(request));
  page.on("requestfinished", (request) => pendingRequests.delete(request));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "failed";
    const detail = `${request.method()} ${request.url()}: ${error}`;
    if (requestsAtReload.has(request) && error === "net::ERR_ABORTED") intentionalReloadAborts.push(detail);
    else unexpectedRequestErrors.push(detail);
    pendingRequests.delete(request);
    requestsAtReload.delete(request);
  });
  page.setDefaultTimeout(4_000);
  page.setDefaultNavigationTimeout(4_000);
  const route = scenario === "shop" ? "/index.html?mode=combat&shop=1" : "/index.html";
  await bounded("open game", () => page.goto(`${process.env.COREALM_URL ?? "http://127.0.0.1:4175"}${route}`, { waitUntil: "domcontentloaded", timeout: 4_000 }));
  await waitUntil("game ready", () => page.evaluate(() => window.__gameDebug?.getState().ready === true), scenario === "shop" ? 20_000 : 30_000);
  report.renderer = await bounded("hardware renderer", () => page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return extension && gl ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  }));
  assert(typeof report.renderer === "string" && /D3D11|Direct3D11/i.test(report.renderer)
    && !/SwiftShader|llvmpipe/i.test(report.renderer), "Hardware D3D11 is required");
  const close = page.locator("#panel-feature-lab .panel__close");
  if (await bounded("workbench visibility", () => close.isVisible())) await bounded("close workbench", () => close.click());
  if (scenario === "shop") await shopScenario();
  else await respawnScenario();
  report.stage = "complete";
  await snapshot("final normal-clock state");
  report.gameErrors = await bounded("read game errors", () => driver.callDebug("getErrors"));
  assert.deepEqual(report.gameErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(unexpectedRequestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  if (driver.page && Date.now() < actionDeadline) {
    await snapshot("failure state").catch(() => undefined);
    await capture("failure").catch(() => undefined);
  }
} finally {
  report.consoleErrors = [...driver.consoleErrors];
  report.pageErrors = [...driver.pageErrors];
  report.requestErrors = [...driver.requestErrors];
  report.intentionalReloadAborts = intentionalReloadAborts;
  report.unexpectedRequestErrors = unexpectedRequestErrors;
  let browserClosed = false;
  try {
    await bounded("close Chromium", () => driver.close(), deadline);
    browserClosed = true;
  } catch (error) {
    report.cleanupError = String(error);
    report.passed = false;
    process.exitCode = 1;
  }
  report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, scenario, stage: report.stage, elapsedMs: report.elapsedMs, error: report.error }));
  // A timed-out Promise cannot close a stalled browser. Keep the hard timer armed in that case.
  if (browserClosed) clearTimeout(hardLimit);
}
