import path from "node:path";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { GameDriver } from "./lib/driver.js";
import { startGameServer } from "./lib/server.js";

const out = path.resolve("test-results/item-icon-docs");
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 1000 },
  browserArgs: ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--use-angle=d3d11"],
});
try {
  await driver.launch();
  const route = process.argv.includes("--world") ? "/" : "/index.html?mode=combat";
  await driver.open(120_000, route);
  const page = driver.page!;
  const iconArg = process.argv.indexOf("--icons");
  const stages = process.argv.flatMap((arg, index) => arg === "--stage" ? [path.resolve(process.argv[index + 1]!)] : []);
  if (stages.length) {
    await page.route("**/assets/icons/items/48/*.png", async route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      for (const stage of stages) {
        const file = path.join(stage, "48", filename);
        if (await access(file).then(() => true).catch(() => false)) {
          await route.fulfill({ path: file, contentType: "image/png" });
          return;
        }
      }
      await route.continue();
    });
  }
  const start = page.locator(".title__action.btn--primary");
  await start.waitFor({ state: "attached", timeout: 8000 });
  if (await start.isVisible()) await start.click();
  await page.locator('.dock__btn[data-panel="inventory"]').waitFor({ state: "visible", timeout: 8000 });
  const before = await driver.snapshot();
  await driver.press("w", 700);
  const after = await driver.snapshot();
  const state = after.state as { ready?: boolean };
  if (!state.ready) throw new Error("Game did not reach ready state");
  if (iconArg >= 0) {
    const selection = process.argv[iconArg + 1]!;
    const stagedIds = selection === "staged"
      ? new Set((await Promise.all(stages.map(stage => readdir(path.join(stage, "48"))))).flat().map(file => file.replace(/\.png$/, "")))
      : new Set(selection.split(","));
    const selected = selection === "all" ? ALL_ITEMS : ALL_ITEMS.filter(item => stagedIds.has(item.id));
    // Currency goes straight into the wallet and cannot occupy an inventory slot.
    const items = selected.filter(item => item.category !== "currency");
    if (items.length === 0) throw new Error("No icons selected for acceptance");
    const results: unknown[] = [];
    for (let offset = 0; offset < items.length; offset += 24) {
      const batch = items.slice(offset, offset + 24);
      const started = Date.now();
      await page.evaluate(ids => {
        const debug = window.__gameDebug as unknown as {
          clearInventory(): void;
          giveItem(id: string, quantity: number, destination: string): unknown;
        };
        debug.clearInventory();
        for (const id of ids) debug.giveItem(id, 1, "inventory");
      }, batch.map(item => item.id));
      if (!await page.locator("#panel-inventory").isVisible()) {
        if (process.argv.includes("--world")) await page.keyboard.press("i");
        else await page.locator('.dock__btn[data-panel="inventory"]').click({ timeout: 2000 });
      }
      await page.waitForFunction(ids => {
        const panel = document.querySelector<HTMLElement>("#panel-inventory");
        const images = [...document.querySelectorAll<HTMLImageElement>("#panel-inventory .item-icon__raster")];
        return panel && !panel.hidden && images.length === ids.length && images.every(image =>
          image.complete && image.naturalWidth === 48 && !image.hidden && ids.some(id => image.src.endsWith(`/${id}.png`)));
      }, batch.map(item => item.id), { timeout: 8000 }).catch(async error => {
        const diagnostic = await page.evaluate(() => ({
          hidden: document.querySelector<HTMLElement>("#panel-inventory")?.hidden,
          bodyText: document.body.innerText.slice(-3000),
          images: [...document.querySelectorAll<HTMLImageElement>("#panel-inventory .item-icon__raster")].map(img => ({ src: img.src, width: img.naturalWidth, hidden: img.hidden, complete: img.complete })),
        }));
        await writeFile(path.join(out, "failed-batch.json"), JSON.stringify({ ids: batch.map(item => item.id), diagnostic, errors: driver.pageErrors, requests: driver.requestErrors }, null, 2));
        throw error;
      });
      const first = page.locator('#panel-inventory [data-slot-index="0"]');
      await page.mouse.move(0, 0);
      const hiddenBefore = await page.locator("#ui-root > .tooltip").isHidden();
      await first.hover({ timeout: 2000 });
      const tooltip = page.locator("#ui-root > .tooltip");
      await tooltip.waitFor({ state: "visible", timeout: 2000 });
      const title = await tooltip.locator(".tooltip__title").innerText();
      if (!title.includes(batch[0]!.name)) throw new Error(`Wrong tooltip ${title}`);
      if (await page.locator("#panel-inventory .item-icon svg").count()) throw new Error("An item still displays a placeholder");
      results.push({ ids: batch.map(item => item.id), hiddenBefore, title, elapsedMs: Date.now() - started });
      if (offset === 0) {
        const panelBounds = await page.locator("#panel-inventory").boundingBox();
        const tipBounds = await tooltip.boundingBox();
        const clip = process.argv.includes("--world") && panelBounds && tipBounds ? {
          x: Math.min(panelBounds.x, tipBounds.x), y: Math.min(panelBounds.y, tipBounds.y),
          width: Math.max(panelBounds.x + panelBounds.width, tipBounds.x + tipBounds.width) - Math.min(panelBounds.x, tipBounds.x),
          height: Math.max(panelBounds.y + panelBounds.height, tipBounds.y + tipBounds.height) - Math.min(panelBounds.y, tipBounds.y),
        } : undefined;
        await page.screenshot({ path: path.join(out, process.argv.includes("--world") ? "world-icons.png" : "lab-icons.png"), ...(clip ? { clip } : {}), timeout: 5000 });
      }
    }
    await writeFile(path.join(out, process.argv.includes("--world") ? "world-icons.json" : "lab-icons.json"), JSON.stringify({ results, errors: driver.pageErrors, console: driver.consoleErrors }, null, 2));
    console.log(JSON.stringify({ checkedInventoryIcons: items.length, currencyOutsideInventory: selected.filter(item => item.category === "currency").map(item => item.id), cohorts: results.length }));
  }
  if (process.argv.includes("--world") && JSON.stringify(before.playerPosition) === JSON.stringify(after.playerPosition)) {
    throw new Error("Normal keyboard movement did not change player position");
  }
  await writeFile(path.join(out, process.argv.includes("--world") ? "world.json" : "lab.json"), JSON.stringify({
    before, after, errors: driver.pageErrors, console: driver.consoleErrors,
  }, null, 2));
  if (!process.argv.includes("--world") && iconArg < 0) await driver.screenshot(out, "lab-boot");
  if (driver.pageErrors.length || driver.consoleErrors.length) throw new Error("Browser errors during boot");
  console.log(JSON.stringify({ passed: true, route, before: before.playerPosition, after: after.playerPosition }));
} finally {
  await driver.close();
  await server.close();
}
