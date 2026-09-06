import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import type { FeatureLabApi } from "../game/src/contracts.js";
const world = process.argv.includes("--world");
const out = `test-results/roof-visibility/${world ? "world" : "lab"}`;
await mkdir(out, { recursive: true });
const clear = installTestDeadline("occupied roof", world ? 119000 : 59000);
const driver = new GameDriver({ url: "http://127.0.0.1:4174", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
type RoofState = { roofCount: number; hiddenBuildingIds: string[]; hiddenEntityIds: string[] };
const report: Record<string, unknown> = { passed: false };
try {
  await driver.launch();
  await driver.open(world ? 60000 : 20000, world ? "/index.html" : "/index.html?mode=combat");
  const page = driver.page!;
  if (!world) await page.evaluate(async () => (window.__featureLab as FeatureLabApi).setStructure({
    kind: "prefab", id: "forge", kit: "timber", width: 6, depth: 4, seed: 1,
  }));
  const close = page.locator("#panel-feature-lab .panel__close");
  if (await close.isVisible()) await close.click();
  const x = world ? 70.5 : -8, z = world ? 132.5 : 19, yaw = world ? Math.PI : 0;
  const y = await driver.callDebug("groundHeight", [x, z]) as number;
  await driver.callDebug("teleport", [[x, y, z]]);
  await driver.callDebug("inspectPose", [{ x, y, z, yaw, pitch: 0.9, distance: 14, detached: false }]);
  const overview = async (name: string): Promise<string | null> => {
    if (!world) return null;
    const player = await driver.callDebug("getPlayer") as { position: { x: number; y: number; z: number } };
    await driver.callDebug("inspectPose", [{ x: 70.5, y: y + 1.2, z: 135,
      yaw: 0.5, pitch: 1.05, distance: 28, detached: true }]);
    const shot = await driver.screenshot(out, name);
    await driver.callDebug("inspectPose", [{ ...player.position, yaw, pitch: 0.9, distance: 14, detached: false }]);
    return shot;
  };
  const state = async () => await driver.callDebug("getRoofVisibility") as RoofState;
  report.before = await state();
  assert.deepEqual((report.before as RoofState).hiddenEntityIds, []);
  report.beforePlayer = await driver.callDebug("getPlayer");
  report.beforeShot = await driver.screenshot(out, "01-outside-roof-visible");
  await page.keyboard.down("w");
  try {
    await page.waitForFunction(() => {
      const debug = window.__gameDebug as unknown as {getRoofVisibility(): RoofState};
      return debug.getRoofVisibility().hiddenEntityIds.length > 0;
    }, undefined, { timeout: 4000 });
  } finally { await page.keyboard.up("w"); }
  report.inside = await state();
  const inside = report.inside as RoofState;
  assert.equal(inside.hiddenBuildingIds.length, 1, "Only the occupied building may lose its roof");
  if (world) assert.deepEqual(inside.hiddenBuildingIds, ["rootfall_forge"]);
  report.insidePlayer = await driver.callDebug("getPlayer");
  report.insideShot = await driver.screenshot(out, "02-inside-roof-hidden");
  report.insideOverview = await overview("02-town-roof-inspection");
  await page.keyboard.down("s");
  try {
    await page.waitForFunction(() => {
      const debug = window.__gameDebug as unknown as {getRoofVisibility(): RoofState};
      return debug.getRoofVisibility().hiddenEntityIds.length === 0;
    }, undefined, { timeout: 4000 });
  } finally { await page.keyboard.up("s"); }
  report.after = await state();
  report.afterPlayer = await driver.callDebug("getPlayer");
  report.afterShot = await driver.screenshot(out, "03-exit-roof-restored");
  report.afterOverview = await overview("03-town-roof-restored");
  report.errors = await driver.callDebug("getErrors");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  if (driver.page) report.failureShot = await driver.screenshot(out, "failure").catch(() => null);
} finally {
  await driver.close(); clear();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, out }));
}
