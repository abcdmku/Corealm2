import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";
import { installAssetCandidates } from "../lib/assetCandidates.js";
import { installTestDeadline } from "../lib/deadline.js";
import type { EnvironmentWorkbench } from "../../game/src/featureLab/environment.js";
import { CAMERA } from "../../game/src/app/config.js";

const args = process.argv.slice(2);
const roundIndex = args.indexOf("--round");
const round = roundIndex >= 0 ? args[roundIndex + 1] : undefined;
if (roundIndex >= 0 && (!round || !/^[a-z0-9-]+$/.test(round))) throw new Error("Invalid review round");
const names = args.filter((_, index) => index !== roundIndex && index !== roundIndex + 1 || roundIndex < 0);
if (!names.length) throw new Error("Supply candidate author names");
const out = path.resolve("test-results/item-models", round ?? names.join("-"));
await mkdir(out, { recursive: true });
const assets: any[] = [], files: Record<string, string> = {};
let pack: unknown;
for (const name of names) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid author name");
  const directory = path.resolve("art/item-models/candidates", name);
  const catalog = JSON.parse(await readFile(path.join(directory, "catalogue.json"), "utf8"));
  pack = catalog.pack;
  for (const entry of catalog.assets) { assets.push(entry); files[entry.id] = path.join(directory, entry.file); }
}
const catalogFile = path.join(out, "catalogue.json");
await writeFile(catalogFile, JSON.stringify({ pack, assets, files }, null, 2));
const deadline = installTestDeadline("Item model lab", 60000);
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 1000 }, browserArgs: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--mute-audio"] });
const report: any[] = [];
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, catalogFile);
  await driver.open(30000, "/index.html?mode=combat&environment=1");
  await page.waitForFunction(() => !!(window as any).__environmentLab, undefined, { timeout: 8000 });
  const featurePanel = page.locator("#panel-feature-lab");
  if (await featurePanel.isVisible()) await featurePanel.locator(".panel__close").click();
  await page.evaluate(() => {
    const debug = window.__gameDebug as any;
    debug.teleport([.65, 0, 26.8]);
  });
  await page.mouse.move(700, 500);
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -100);
  const before = await page.evaluate(() => (window.__gameDebug as any).getCamera());
  const dy = (.3 - before.pitch) / .004;
  await page.mouse.down({ button: "right" });
  await page.mouse.move(700, 500 + dy, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await page.mouse.move(20, 600);
  for (const entry of assets) {
    const span = entry.itemModel?.wearable && entry.tags.includes("arms") ? 4 : 1.4;
    const scale = Math.min(2 / entry.size.y, span / entry.size.x, 1.4 / entry.size.z);
    for (const [view, rotationY] of [["front", Math.PI + .35], ["side", Math.PI / 2], ["back", .35]] as const) {
      const started = Date.now();
      await page.evaluate(async ({ id, scale, rotationY }) => {
        const lab = (window as any).__environmentLab as EnvironmentWorkbench;
        await lab.showGallery(id, { scale, rotationY, verticalOffset: .35 });
      }, { id: entry.id, scale, rotationY });
      await page.waitForFunction(id => { const lab = (window as any).__environmentLab; return lab.getState().ready && lab.getState().assets.includes(id); }, entry.id, { timeout: 8000 });
      await page.waitForTimeout(600);
      const state = await page.evaluate(() => ({ lab: (window as any).__environmentLab.getState(), bounds: (window as any).__environmentLab.getBounds(), camera: (window.__gameDebug as any).getCamera(), player: (window.__gameDebug as any).getPlayerPosition() }));
      if (!state.bounds || state.camera.freeMove || Math.abs(state.camera.target.y - state.player.y - 1.1) > .5) throw new Error("Model view lost normal player camera focus");
      if (entry.itemModel?.wearable && Math.abs(state.bounds.max[1] - state.bounds.min[1] - entry.size.y * scale) > .015) throw new Error(`${entry.itemId}: standalone garment left its authored bind pose: ${JSON.stringify({ bounds: state.bounds, expectedHeight: entry.size.y * scale })}`);
      if (Math.abs(state.camera.pitch - .3) > .02 || state.camera.distance < CAMERA.minDistance - .01 || state.camera.distance > CAMERA.maxDistance + .01) throw new Error("Model view exceeded normal camera controls");
      const file = path.join(out, `${entry.itemId}-${view}.png`);
      await page.screenshot({ path: file, timeout: 5000 });
      report.push({ itemId: entry.itemId, view, scale, state, file, elapsedMs: Date.now() - started });
    }
  }
  if (driver.pageErrors.length || driver.consoleErrors.length) throw new Error("Browser reported model errors");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ passed: true, assets, evidence: "Production environment gallery and GLB loader; normal wheel/right-drag camera; gallery controls magnify small items for inspection. Visual acceptance is recorded separately by a fresh critic and root.", report, errors: driver.pageErrors }, null, 2));
  console.log(JSON.stringify({ passed: true, models: assets.length, views: report.length, out }));
} finally { await driver.close(); await server.close(); deadline(); }
