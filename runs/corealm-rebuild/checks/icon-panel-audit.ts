/**
 * The DOM half of `npm run icons:verify`, without its captures.
 *
 *   npx tsx runs/corealm-rebuild/checks/icon-panel-audit.ts
 *
 * `icons:verify` is the gate and stays the gate. It has a 5 s capture budget and a 270 s run
 * deadline, and on a machine shared with other browser sessions one full-game capture was measured
 * at 26.6 s, so on a busy box the gate reports contention rather than a real fault. This runs the
 * same four panel audits it runs -- inventory, bank, equipment, shop -- and the same icon-request
 * check, and takes no screenshots, so a regenerated icon set can still be checked in the game
 * while the gate waits for a quiet machine. It does not replace the gate.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { startGameServer } from "../../../tools/lib/server.js";
import { ITEM_ICON_GAME_SIZE } from "../../../tools/generate-item-icons.js";

const out = "test-results/icon-panel-audit";
await mkdir(out, { recursive: true });
const representative = [
  "grithe_ore", "palewood_log", "silt_minnow", "grithe_bar", "coarse_hide",
  "grithe_pickaxe", "grithe_sword", "grithe_helm", "grithe_ring",
  "basic_wooden_wand", "palewood_staff", "cairnpine_wand", "marchhide_robe",
  "air_orb", "earth_orb", "water_orb", "air_essence", "earth_essence", "water_essence",
];
const equipmentIds = [
  "air_wand", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves",
  "grithe_boots", "grithe_gloves", "grithe_ring", "grithe_pendant",
];

const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
const report: any = { passed: false, panels: {}, limits: [
  "Panel DOM audits and the icon request check only. No captures, so this is not visual acceptance.",
] };
try {
  await driver.launch();
  await driver.open(120_000);
  const page = driver.page!;
  const iconRequests = new Set<string>();
  page.on("request", (request) => {
    if (request.url().includes("/assets/icons/items/")) iconRequests.add(request.url());
  });

  const audit = async (selector: string) => page.evaluate((panelSelector) => {
    const panel = document.querySelector<HTMLElement>(panelSelector);
    if (!panel) throw new Error(`Missing icon panel ${panelSelector}`);
    const images = [...panel.querySelectorAll<HTMLImageElement>(".item-icon__raster")];
    return {
      rasterCount: images.length,
      loadedCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      naturalSizes: [...new Set(images.map((image) => image.naturalWidth))].sort((a, b) => a - b),
      largestCssPixels: images.reduce((largest, image) => Math.max(largest, image.getBoundingClientRect().width), 0),
      visibleFallbacks: [...panel.querySelectorAll<SVGElement>(".item-icon .icon")]
        .filter((svg) => getComputedStyle(svg).visibility !== "hidden").length,
    };
  }, selector);

  const expectPanel = (name: string, result: any, minimum: number): void => {
    assert(result.rasterCount >= minimum, `${name}: ${result.rasterCount} rasters, expected at least ${minimum}`);
    assert.equal(result.loadedCount, result.rasterCount, `${name}: not every raster loaded`);
    assert.deepEqual(result.naturalSizes, [ITEM_ICON_GAME_SIZE], `${name}: a raster is not ${ITEM_ICON_GAME_SIZE} px`);
    assert(result.largestCssPixels <= ITEM_ICON_GAME_SIZE + 0.01, `${name}: drawn larger than ${ITEM_ICON_GAME_SIZE} px`);
    assert.equal(result.visibleFallbacks, 0, `${name}: SVG fallbacks left visible`);
    report.panels[name] = result;
  };

  const loaded = (selector: string, minimum: number) => page.waitForFunction(
    ({ panelSelector, min, size }) => {
      const panel = document.querySelector<HTMLElement>(panelSelector);
      if (!panel || panel.hidden) return false;
      const images = [...panel.querySelectorAll<HTMLImageElement>(".item-icon__raster")];
      return images.length >= min && images.every((image) => image.complete && image.naturalWidth === size);
    }, { panelSelector: selector, min: minimum, size: ITEM_ICON_GAME_SIZE }, { timeout: 60_000 });

  await page.evaluate((itemIds) => {
    const api = (window as any).__gameDebug;
    api.clearInventory();
    for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true }));
  }, representative);
  await loaded("#panel-inventory", representative.length);
  expectPanel("inventory", await audit("#panel-inventory"), representative.length);

  const bank = await page.evaluate(async () => {
    const api = (window as any).__gameDebug;
    if (!api.focusCamera("bank")) return { error: "Could not focus the bank shot" };
    const deposited = await api.callTool("corealm_bank", { op: "depositAll" });
    if (deposited?.error) return { error: `Could not populate bank: ${JSON.stringify(deposited)}` };
    return api.openBank() ? {} : { error: "Could not open bank panel" };
  });
  assert(!bank?.error, String(bank?.error));
  await loaded("#panel-bank", representative.length);
  expectPanel("bank", await audit("#panel-bank"), representative.length);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("#panel-bank .panel__close")?.click());

  const equipped = await page.evaluate(async (itemIds) => {
    const api = (window as any).__gameDebug;
    api.clearInventory();
    for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
    for (const itemId of itemIds) {
      const result = await api.callTool("corealm_equip", { itemId });
      if (result?.error) return { error: `Could not equip ${itemId}: ${JSON.stringify(result)}` };
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", bubbles: true }));
    return {};
  }, equipmentIds);
  assert(!equipped?.error, String(equipped?.error));
  await loaded("#panel-equipment", equipmentIds.length);
  expectPanel("equipment", await audit("#panel-equipment"), equipmentIds.length);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("#panel-equipment .panel__close")?.click());

  const shop = await page.evaluate((itemIds) => {
    const api = (window as any).__gameDebug;
    api.clearInventory();
    for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
    const trade = api.listEntities({ archetype: "shop" }).find((entry: any) => entry.interactions?.includes("trade"));
    if (!trade) return { error: "No trade-capable shop entity exists" };
    return api.openShop(trade.id) ? {} : { error: `Could not open shop ${trade.id}` };
  }, representative);
  assert(!shop?.error, String(shop?.error));
  await loaded("#panel-shop", 1);
  expectPanel("shop", await audit("#panel-shop"), 1);

  const requested = [...iconRequests];
  assert(requested.length > 0, "No item icon requests were observed");
  const expectedPath = new RegExp(`/assets/icons/items/${ITEM_ICON_GAME_SIZE}/[^/]+\\.png(?:$|\\?)`);
  assert.deepEqual(requested.filter((url) => !expectedPath.test(url)), [], "Runtime requested a non-game icon asset");
  assert.deepEqual(driver.requestErrors.filter((entry) => entry.includes("/assets/icons/items/")), [],
    "Icon request failures");
  report.iconRequests = requested.length;
  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []);
  report.passed = true;
} catch (error) {
  report.error = String((error as Error)?.stack ?? error); process.exitCode = 1;
} finally {
  await driver.close(); await server.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.split("\n")[0],
    panels: report.panels, iconRequests: report.iconRequests }, null, 2));
}
