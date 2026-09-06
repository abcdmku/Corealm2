import path from "node:path";
import { mkdir } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { ITEM_ICON_GAME_SIZE } from "./generate-item-icons.js";
import { installTestDeadline } from "./lib/deadline.js";

interface IconDomAudit {
  rasterCount: number;
  loadedCount: number;
  naturalSizes: number[];
  largestCssPixels: number;
  visibleFallbacks: number;
}

async function main(): Promise<void> {
  // Verification output is disposable. Tracked evidence is promoted separately and explicitly.
  const screenshotDir = path.join(repoRoot, "test-results", "item-icons");
  await mkdir(screenshotDir, { recursive: true });

  const server = await startGameServer();
  const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 } });
  try {
    await driver.launch();
    await driver.open(60_000);
    process.stdout.write("icon verify: game ready\n");
    const page = driver.page;
    if (!page) throw new Error("GameDriver did not expose its Playwright page");
    const iconRequests = new Set<string>();
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/assets/icons/items/")) iconRequests.add(url);
    });

    const representative = [
      "grithe_ore", "palewood_log", "silt_minnow", "grithe_bar", "coarse_hide",
      "grithe_pickaxe", "grithe_sword", "grithe_helm", "grithe_ring",
      "basic_wooden_wand", "palewood_staff", "cairnpine_wand", "marchhide_robe",
      "air_orb", "earth_orb", "water_orb",
      "air_essence", "earth_essence", "water_essence",
    ];
    await page.evaluate((itemIds) => {
      const api = window.__gameDebug as unknown as {
        clearInventory(): void;
        giveItem(itemId: string, quantity: number, to: "inventory"): unknown;
      };
      // These are the same bubbling events used by the project's gate checks. Sending them in the
      // setup evaluation avoids Playwright actionability waits against the continuously redrawn
      // WebGL canvas behind the title and panels.
      document.querySelector<HTMLButtonElement>(".title__action.btn--primary")?.click();
      api.clearInventory();
      for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true }));
    }, representative);
    process.stdout.write("icon verify: inventory setup dispatched\n");
    // A continuously painted WebGL canvas can keep Playwright's actionability loop waiting even
    // after it reports that this DOM panel is visible. The panel's own `hidden` state is the actual
    // contract here and is the same readiness check used for bank, equipment, and shop below.
    await page.waitForFunction(() => {
      const panel = document.querySelector<HTMLElement>("#panel-inventory");
      return panel !== null && !panel.hidden;
    }, undefined, { timeout: 60_000 });
    await page.waitForFunction(({ minimum, size }) => {
      const images = [...document.querySelectorAll<HTMLImageElement>("#panel-inventory .item-icon__raster")];
      return images.length >= minimum && images.every((image) => image.complete && image.naturalWidth === size);
    }, { minimum: representative.length, size: ITEM_ICON_GAME_SIZE }, { timeout: 15_000 });
    await driver.wait(200);
    process.stdout.write("icon verify: inventory loaded\n");

    const auditPanel = async (selector: string): Promise<IconDomAudit> => page.evaluate((panelSelector) => {
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

    const inventory = await auditPanel("#panel-inventory");
    if (inventory.rasterCount < representative.length || inventory.loadedCount !== inventory.rasterCount) {
      throw new Error(`Inventory raster audit failed: ${JSON.stringify(inventory)}`);
    }
    if (inventory.naturalSizes.some((size) => size !== ITEM_ICON_GAME_SIZE) || inventory.largestCssPixels > ITEM_ICON_GAME_SIZE + 0.01) {
      throw new Error(`Inventory loaded an icon outside the ${ITEM_ICON_GAME_SIZE}px limit: ${JSON.stringify(inventory)}`);
    }
    if (inventory.visibleFallbacks !== 0) throw new Error(`Inventory left ${inventory.visibleFallbacks} SVG fallbacks visible`);
    await driver.screenshot(screenshotDir, "inventory-item-icons");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", code: "KeyI", bubbles: true })));

    const bankSetup = await page.evaluate(async () => {
      const api = window.__gameDebug as unknown as {
        focusCamera(shotId: string): boolean;
        callTool(name: string, args: unknown): Promise<unknown>;
        openBank(bankId?: string): boolean;
      };
      if (!api.focusCamera("bank")) return { error: "Could not focus the bank acceptance shot" };
      const deposited = await api.callTool("corealm_bank", { op: "depositAll" }) as { error?: string };
      if (deposited?.error) return { error: `Could not populate bank: ${JSON.stringify(deposited)}` };
      return api.openBank() ? {} : { error: "Could not open bank panel" };
    });
    if (bankSetup?.error) throw new Error(bankSetup.error);
    await page.waitForFunction(({ minimum, size }) => {
      const panel = document.querySelector<HTMLElement>("#panel-bank");
      if (!panel || panel.hidden) return false;
      const images = [...panel.querySelectorAll<HTMLImageElement>(".bank-grid .item-icon__raster")];
      return images.length >= minimum && images.every((image) => image.complete && image.naturalWidth === size);
    }, { minimum: representative.length, size: ITEM_ICON_GAME_SIZE }, { timeout: 60_000 });
    const bank = await auditPanel("#panel-bank");
    if (bank.rasterCount < representative.length || bank.loadedCount !== bank.rasterCount) {
      throw new Error(`Bank raster audit failed: ${JSON.stringify(bank)}`);
    }
    if (bank.naturalSizes.some((size) => size !== ITEM_ICON_GAME_SIZE) || bank.largestCssPixels > ITEM_ICON_GAME_SIZE + 0.01) {
      throw new Error(`Bank loaded an icon outside the ${ITEM_ICON_GAME_SIZE}px limit: ${JSON.stringify(bank)}`);
    }
    if (bank.visibleFallbacks !== 0) throw new Error(`Bank left ${bank.visibleFallbacks} SVG fallbacks visible`);
    await driver.screenshot(screenshotDir, "bank-item-icons");
    await page.evaluate(() => document.querySelector<HTMLButtonElement>("#panel-bank .panel__close")?.click());

    const equipmentIds = [
      "air_wand", "palewood_shield", "grithe_helm", "grithe_cuirass", "grithe_greaves",
      "grithe_boots", "grithe_gloves", "grithe_ring", "grithe_pendant",
    ];
    const equipmentSetup = await page.evaluate(async (itemIds) => {
      const api = window.__gameDebug as unknown as {
        clearInventory(): void;
        giveItem(itemId: string, quantity: number, to: "inventory"): unknown;
        callTool(name: string, args: unknown): Promise<unknown>;
      };
      api.clearInventory();
      for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
      for (const itemId of itemIds) {
        const result = await api.callTool("corealm_equip", { itemId }) as { error?: string };
        if (result?.error) return { error: `Could not equip ${itemId}: ${JSON.stringify(result)}` };
      }
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", code: "KeyE", bubbles: true }));
      return {};
    }, equipmentIds);
    if (equipmentSetup?.error) throw new Error(equipmentSetup.error);
    await page.waitForFunction(({ minimum, size }) => {
      const panel = document.querySelector<HTMLElement>("#panel-equipment");
      if (!panel || panel.hidden) return false;
      const images = [...panel.querySelectorAll<HTMLImageElement>(".item-icon__raster")];
      return images.length >= minimum && images.every((image) => image.complete && image.naturalWidth === size);
    }, { minimum: equipmentIds.length, size: ITEM_ICON_GAME_SIZE }, { timeout: 60_000 });
    const equipment = await auditPanel("#panel-equipment");
    if (equipment.rasterCount !== equipmentIds.length || equipment.loadedCount !== equipment.rasterCount) {
      throw new Error(`Equipment raster audit failed: ${JSON.stringify(equipment)}`);
    }
    if (equipment.naturalSizes.some((size) => size !== ITEM_ICON_GAME_SIZE) || equipment.largestCssPixels > ITEM_ICON_GAME_SIZE + 0.01) {
      throw new Error(`Equipment loaded an icon outside the ${ITEM_ICON_GAME_SIZE}px limit: ${JSON.stringify(equipment)}`);
    }
    if (equipment.visibleFallbacks !== 0) throw new Error(`Equipment left ${equipment.visibleFallbacks} SVG fallbacks visible`);
    await driver.screenshot(screenshotDir, "equipment-item-icons");
    await page.evaluate(() => document.querySelector<HTMLButtonElement>("#panel-equipment .panel__close")?.click());

    const opened = await page.evaluate((itemIds) => {
      const api = window.__gameDebug as unknown as {
        listEntities(filter: { archetype: string }): Array<{ id: string; interactions?: string[] }>;
        clearInventory(): void;
        giveItem(itemId: string, quantity: number, to: "inventory"): unknown;
        openShop(shopId?: string): boolean;
      };
      api.clearInventory();
      for (const itemId of itemIds) api.giveItem(itemId, 1, "inventory");
      const shop = api.listEntities({ archetype: "shop" }).find((entry) => entry.interactions?.includes("trade"));
      if (!shop) return { error: "No trade-capable shop entity exists" };
      return api.openShop(shop.id) ? {} : { error: `Could not open shop ${shop.id}` };
    }, representative);
    if (opened?.error) throw new Error(`Shop interaction failed: ${JSON.stringify(opened)}`);
    await page.waitForFunction((size) => {
      const panel = document.querySelector<HTMLElement>("#panel-shop");
      if (!panel || panel.hidden) return false;
      const images = [...document.querySelectorAll<HTMLImageElement>("#panel-shop .item-icon__raster")];
      return images.length > 0 && images.every((image) => image.complete && image.naturalWidth === size);
    }, ITEM_ICON_GAME_SIZE, { timeout: 60_000 });
    await driver.wait(200);
    process.stdout.write("icon verify: shop loaded\n");
    const shopAudit = await auditPanel("#panel-shop");
    if (shopAudit.loadedCount !== shopAudit.rasterCount || shopAudit.rasterCount === 0) {
      throw new Error(`Shop raster audit failed: ${JSON.stringify(shopAudit)}`);
    }
    if (shopAudit.naturalSizes.some((size) => size !== ITEM_ICON_GAME_SIZE) || shopAudit.largestCssPixels > ITEM_ICON_GAME_SIZE + 0.01) {
      throw new Error(`Shop loaded an icon outside the ${ITEM_ICON_GAME_SIZE}px limit: ${JSON.stringify(shopAudit)}`);
    }
    if (shopAudit.visibleFallbacks !== 0) throw new Error(`Shop left ${shopAudit.visibleFallbacks} SVG fallbacks visible`);
    await driver.screenshot(screenshotDir, "shop-item-icons");

    const requestedUrls = [...iconRequests];
    if (requestedUrls.length === 0) throw new Error("No item icon requests were observed");
    const expectedPath = new RegExp(`/assets/icons/items/${ITEM_ICON_GAME_SIZE}/[^/]+\\.png(?:$|\\?)`);
    const wrongRequests = requestedUrls.filter((name) => !expectedPath.test(name));
    if (wrongRequests.length > 0) throw new Error(`Runtime requested non-game icon assets: ${wrongRequests.join(", ")}`);
    const requestFailures = driver.requestErrors.filter((entry) => entry.includes("/assets/icons/items/"));
    if (requestFailures.length > 0) throw new Error(`Icon request failures: ${requestFailures.join("\n")}`);

    process.stdout.write(`${JSON.stringify({ inventory, bank, equipment, shop: shopAudit, iconRequests: requestedUrls.length }, null, 2)}\n`);
  } finally {
    await driver.close();
    await server.close();
  }
}

// Every icon is captured from the real game, so the run is minutes long by construction and its
// length tracks how loaded the machine is, not whether the icons are right. The default still
// holds; COREALM_ICON_VERIFY_DEADLINE_MS lets a release run finish on a busy box.
const deadlineMs = Number(process.env.COREALM_ICON_VERIFY_DEADLINE_MS ?? 0);
const clearDeadline = Number.isFinite(deadlineMs) && deadlineMs > 0
  ? installTestDeadline("item icon verification", deadlineMs)
  : installTestDeadline("item icon verification");
try {
  await main();
} finally {
  clearDeadline();
}
