/** Production environment lab review, no final-world registration. Run only with root's GPU slot. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installAssetCandidates } from "../../../tools/lib/assetCandidates.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";

const url = process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175";
const out = process.env.EQUIPMENT_REVIEW_OUT ?? "test-results/equipment-candidates";
const selections = process.argv.slice(2);
if (!selections.length) selections.push(...["sword", "dagger", "axe", "shield", "staff", "wand"].map(form => `corealm_${form}_1`));
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url, close: async () => {} }, { headless: true, viewport: { width: 1440, height: 900 }, browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const deadline = installTestDeadline("Equipment candidate review", 90_000);
const report: Record<string, unknown> = { visualAccepted: false, selections, shots: [] };
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, process.env.EQUIPMENT_REVIEW_CATALOG ?? "art/rebuild/candidates/2026-09-05/equipment-v1/catalogue.json");
  await driver.open(25_000, "/index.html?mode=combat&environment=1");
  report.renderer = await verifyEquipmentHardware(page);
  for (const id of selections) {
    const before = await page.evaluate(() => (window as any).__environmentLab.getState());
    await page.evaluate(async id => { await (window as any).__environmentLab.showGallery(id); }, id);
    await page.waitForFunction(id => document.querySelector<HTMLSelectElement>("#environment-lab-selection")?.value === id, id);
    const after = await page.evaluate(() => (window as any).__environmentLab.getState());
    assert(after.ready); assert.equal(after.selection, id);
    const bounds = await page.evaluate(() => (window as any).__environmentLab.getBounds());
    assert(bounds);
    const views: readonly (readonly [string, number])[] = id.startsWith("corealm_item_") ? [["front", 0.3], ["back", 3.5], ["side", 1.7]] : [["front", 0.3], ["back", 3.5]];
    for (const [view, yaw] of views) {
      await driver.callDebug("inspectPose", [{ x: (bounds.min[0] + bounds.max[0]) / 2, y: (bounds.min[1] + bounds.max[1]) / 2,
        z: (bounds.min[2] + bounds.max[2]) / 2, yaw, pitch: 0.18,
        distance: Math.max(id.startsWith("corealm_item_") ? 0.5 : 0.8, (bounds.max[1] - bounds.min[1]) * 1.75), detached: true }]);
      await driver.wait(150);
      await driver.screenshot(out, `${id}-${view}`);
      (report.shots as unknown[]).push({ id, view, before, after, bounds });
    }
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; }
finally { await driver.close(); deadline(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, out })); }
