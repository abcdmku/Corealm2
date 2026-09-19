/** Real-Chromium acceptance for explicit, world-anchored loot selection. */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { repoRoot } from "./lib/paths.js";
import { startGameServer, type RunningGameServer } from "./lib/server.js";

interface LootStack { itemId: string; quantity: number }

interface BrowserDebug {
  clearInventory(): void;
  focusEntity(entityId: string): boolean;
  getState(): { ready?: boolean };
  getEntities(): { id: string; archetype: string; name: string }[];
  getEvents(sinceSeq: number): { events: { data?: Record<string, unknown> }[] };
  callTool(name: string, args: unknown): Promise<unknown>;
}

interface LabState { ready?: boolean }

interface BrowserLab {
  getState(): LabState;
  equipPlayer(slot: string, itemId: string): Promise<unknown>;
  spawnTarget(kind: string, presetId: string, options: { distance: number }): Promise<LabState>;
  perform(action: string): Promise<unknown>;
}

const outputDir = path.join(repoRoot, "test-results", "loot-reveal");
const screenshotPath = path.join(outputDir, "loot-opened.png");
let server: RunningGameServer | null = null;
let browser: Browser | null = null;

try {
  await mkdir(outputDir, { recursive: true });
  server = await startGameServer({ logLevel: "error" });
  browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    localStorage.setItem("corealm.settings.v1", JSON.stringify({
      renderScale: 0.7,
      shadowQuality: "low",
      drawDistance: "near",
      damageNumbers: false,
      invertCameraY: false,
      uiScale: "normal",
      music: 0,
      ambient: 0,
      sfx: 0,
    }));
  });

  await page.goto(`${server.url}/index.html?mode=combat`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (
    (Reflect.get(window, "__gameDebug") as BrowserDebug | undefined)?.getState().ready === true
    && (Reflect.get(window, "__featureLab") as BrowserLab | undefined)?.getState().ready === true
  ), null, { timeout: 20_000 });
  console.log("[loot-reveal] lab ready");

  await page.evaluate(async () => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    const lab = Reflect.get(window, "__featureLab") as BrowserLab | undefined;
    if (!debug || !lab) throw new Error("The production lab controls are unavailable");
    debug.clearInventory();
    await lab.equipPlayer("mainHand", "kaldite_sword");
    await lab.spawnTarget("creature", "tempest_roc", { distance: 2 });
    await lab.perform("attack");
  });

  await page.waitForFunction(() => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    return (debug?.getEntities() ?? []).some((entity) => entity.archetype === "loot");
  }, null, { timeout: 15_000 });
  console.log("[loot-reveal] guaranteed-drop box spawned");

  const dropped = await page.evaluate(async () => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    if (!debug) throw new Error("Production controls are unavailable");
    const box = debug.getEntities().find((entity) => entity.archetype === "loot");
    if (!box) throw new Error("The defeated target did not leave a loot box");
    const spawned = debug.getEvents(0).events.find((event) => event.data?.["pileId"] === box.id);
    const expected = Array.isArray(spawned?.data?.["items"])
      ? spawned.data["items"] as LootStack[]
      : [];
    if (expected.length < 2) throw new Error(`Expected at least two guaranteed stacks, got ${expected.length}`);
    const inventory = await debug.callTool("corealm_inventory", {}) as {
      slots?: Array<{ itemId: string; quantity: number } | null>;
    };
    const beforeOpen: Record<string, number> = {};
    for (const slot of inventory.slots ?? []) {
      if (slot) beforeOpen[slot.itemId] = (beforeOpen[slot.itemId] ?? 0) + slot.quantity;
    }
    return {
      sourceId: box.id,
      sourceName: box.name,
      expected,
      beforeOpen,
    };
  });

  await page.waitForTimeout(3_000);
  await page.evaluate((entityId) => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    if (!debug?.focusEntity(entityId)) throw new Error(`Could not focus ${entityId}`);
  }, dropped.sourceId);
  await page.locator("#panel-feature-lab .panel__close").click();
  await page.waitForTimeout(150);

  const hover = await findLootBox(page);
  if (!hover.label.startsWith("Open ")) {
    throw new Error(`Loot box hover said ${JSON.stringify(hover.label)} instead of Open`);
  }
  await page.mouse.click(hover.x, hover.y);
  const reveal = page.locator(".loot-reveal:not([hidden])");
  await reveal.waitFor({ state: "visible", timeout: 4_000 });
  console.log("[loot-reveal] box opened without transfer");

  const opened = await page.evaluate(async (sourceId) => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    const panel = document.querySelector<HTMLElement>(".loot-reveal:not([hidden])");
    if (!debug || !panel) throw new Error("The opened loot grid is unavailable");
    const inventoryView = await debug.callTool("corealm_inventory", {}) as {
      slots?: Array<{ itemId: string; quantity: number } | null>;
    };
    const inventory: Record<string, number> = {};
    for (const slot of inventoryView.slots ?? []) {
      if (slot) inventory[slot.itemId] = (inventory[slot.itemId] ?? 0) + slot.quantity;
    }
    const rect = panel.getBoundingClientRect();
    const anchorX = Number(panel.dataset["anchorX"]);
    const anchorY = Number(panel.dataset["anchorY"]);
    const gapX = anchorX < rect.left ? rect.left - anchorX : anchorX > rect.right ? anchorX - rect.right : 0;
    const gapY = anchorY < rect.top ? rect.top - anchorY : anchorY > rect.bottom ? anchorY - rect.bottom : 0;
    return {
      inventory,
      gridCells: panel.querySelectorAll(".loot-reveal__slot").length,
      ariaLabel: panel.getAttribute("aria-label") ?? "",
      hasLootedHeading: /looted/i.test(panel.textContent ?? "")
        || panel.querySelector(".loot-reveal__heading") !== null,
      childCount: panel.children.length,
      remains: debug.getEntities().some((entity) => entity.id === sourceId),
      anchorGap: Math.hypot(gapX, gapY),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      anchor: { x: anchorX, y: anchorY },
    };
  }, dropped.sourceId);

  if (JSON.stringify(opened.inventory) !== JSON.stringify(dropped.beforeOpen)) {
    throw new Error("Opening the loot box changed the inventory");
  }
  if (!opened.remains) throw new Error("Opening removed the loot box before an item was chosen");
  if (opened.gridCells !== dropped.expected.length) {
    throw new Error(`Grid rendered ${opened.gridCells} cells for ${dropped.expected.length} stacks`);
  }
  if (opened.hasLootedHeading || opened.childCount !== 1) {
    throw new Error("The contents view is not the requested grid-only display");
  }
  if (opened.ariaLabel !== `${dropped.sourceName} contents`) {
    throw new Error(`Grid label was ${JSON.stringify(opened.ariaLabel)}`);
  }
  if (!Number.isFinite(opened.anchorGap) || opened.anchorGap > 18) {
    throw new Error(`Grid is ${opened.anchorGap}px from its crate anchor`);
  }

  await page.mouse.move(320, 200);
  await page.waitForTimeout(100);
  await page.screenshot({ path: screenshotPath, animations: "allow" });

  // Turning the camera is not walking away: a drag leaves the grid up.
  await page.mouse.move(320, 240);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(400, 260, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(250);
  if (await reveal.count() !== 1) throw new Error("Orbiting the camera closed the loot grid");
  console.log("[loot-reveal] a camera drag left the grid open");

  // A press anywhere else closes the grid, and reopening the same pile brings it back. Escape is
  // not a key a phone has, so this is the dismissal a thumb actually uses.
  const dockInventory = page.locator(".dock__btn[data-panel='inventory']");
  await dockInventory.click();
  await reveal.waitFor({ state: "hidden", timeout: 3_000 });
  await dockInventory.click();
  await page.waitForTimeout(200);
  console.log("[loot-reveal] a press elsewhere closed the grid");
  const reopen = await findLootBox(page);
  await page.mouse.click(reopen.x, reopen.y);
  await reveal.waitFor({ state: "visible", timeout: 8_000 });
  if (await page.locator(".loot-reveal:not([hidden]) .loot-reveal__slot").count() !== dropped.expected.length) {
    throw new Error("Reopening the pile did not restore every stack");
  }

  await page.locator(".loot-reveal__slot").first().click();
  await page.waitForFunction((count) => (
    document.querySelectorAll(".loot-reveal:not([hidden]) .loot-reveal__slot").length === count - 1
  ), dropped.expected.length);
  const afterOne = await page.evaluate(async (sourceId) => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    const inventoryView = await debug?.callTool("corealm_inventory", {}) as {
      slots?: Array<{ itemId: string; quantity: number } | null>;
    } | undefined;
    const inventory: Record<string, number> = {};
    for (const slot of inventoryView?.slots ?? []) {
      if (slot) inventory[slot.itemId] = (inventory[slot.itemId] ?? 0) + slot.quantity;
    }
    return {
      inventory,
      remains: debug?.getEntities().some((entity) => entity.id === sourceId) ?? false,
    };
  }, dropped.sourceId);
  const first = dropped.expected[0];
  if (!first) throw new Error("The deterministic drop unexpectedly had no first stack");
  const firstGain = (afterOne.inventory[first.itemId] ?? 0) - (dropped.beforeOpen[first.itemId] ?? 0);
  if (firstGain !== first.quantity || !afterOne.remains) {
    throw new Error("Clicking one cell did not take exactly that stack and preserve the box");
  }

  for (let remaining = dropped.expected.length - 1; remaining > 0; remaining -= 1) {
    await page.locator(".loot-reveal__slot").first().click();
  }
  await page.waitForFunction((sourceId) => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    const panel = document.querySelector<HTMLElement>(".loot-reveal");
    return panel?.hidden === true && !debug?.getEntities().some((entity) => entity.id === sourceId);
  }, dropped.sourceId);

  const afterAll = await page.evaluate(async () => {
    const debug = Reflect.get(window, "__gameDebug") as BrowserDebug | undefined;
    const inventoryView = await debug?.callTool("corealm_inventory", {}) as {
      slots?: Array<{ itemId: string; quantity: number } | null>;
    } | undefined;
    const inventory: Record<string, number> = {};
    for (const slot of inventoryView?.slots ?? []) {
      if (slot) inventory[slot.itemId] = (inventory[slot.itemId] ?? 0) + slot.quantity;
    }
    return inventory;
  });
  for (const stack of dropped.expected) {
    const gained = (afterAll[stack.itemId] ?? 0) - (dropped.beforeOpen[stack.itemId] ?? 0);
    if (gained !== stack.quantity) {
      throw new Error(`${stack.itemId} gained ${gained}, expected ${stack.quantity}`);
    }
  }

  console.log(JSON.stringify({
    sourceId: dropped.sourceId,
    sourceName: dropped.sourceName,
    expected: dropped.expected,
    beforeOpen: dropped.beforeOpen,
    afterOpen: opened.inventory,
    afterAll,
    gridCells: opened.gridCells,
    hoverLabel: hover.label,
    anchorGap: opened.anchorGap,
    rect: opened.rect,
    anchor: opened.anchor,
    screenshot: path.relative(repoRoot, screenshotPath).replaceAll("\\", "/"),
  }, null, 2));
} finally {
  await browser?.close();
  await server?.close();
}

async function findLootBox(page: Page): Promise<{ x: number; y: number; label: string }> {
  const canvas = await page.locator("#viewport").boundingBox();
  if (!canvas) throw new Error("The game canvas has no bounds");
  const centreX = canvas.x + canvas.width / 2;
  const centreY = canvas.y + canvas.height / 2;

  for (let radius = 0; radius <= 160; radius += 16) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 16) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 16) {
        if (radius > 0 && Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        const x = centreX + offsetX;
        const y = centreY + offsetY;
        await page.mouse.move(x, y);
        await page.waitForTimeout(24);
        const label = await page.evaluate(() => document.querySelector(".hover-label")?.textContent ?? "");
        if (label.startsWith("Open ")) return { x, y, label };
      }
    }
  }
  throw new Error("Could not find the loot box through the production canvas picker");
}
