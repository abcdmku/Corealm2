import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import type { FeatureLabApi } from "../../../game/src/contracts.js";
import { assertGameplayHardware } from "./finish-gameplay-renderer.js";

// Root GPU lease required. Run each fixture separately, with the production camera query wiring.
const fixture = process.argv.includes("--porch") ? "porch" : "townhouse";
const out = `test-results/camera-obstruction-lab/${fixture}/${new Date().toISOString().replace(/[:.]/g, "-")}`;
await mkdir(out, { recursive: true });
const clear = installTestDeadline(`camera ${fixture} lab`, 59000);
const driver = new GameDriver({ url: "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const startedAt = new Date().toISOString();
const paths = ["game/src/render/camera.ts", "game/src/systems/staticCameraQueries.ts",
  "game/src/render/structureCameraSources.ts", "game/src/app/boot.ts", "game/src/render/buildings.ts",
  "game/src/featureLab/structures.ts"];
const sources = await Promise.all(paths.map(async path => ({ path,
  sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
})));
const report: Record<string, unknown> = { passed: false, visualAccepted: false, fixture, startedAt, out, sources };
try {
  await driver.launch();
  await driver.open(20000, "/index.html?mode=combat");
  const page = driver.page!;
  report.renderer = await assertGameplayHardware(page);
  page.setDefaultTimeout(4000);
  report.fixture = await page.evaluate(async id => (window.__featureLab as FeatureLabApi).setStructure({
    kind: "prefab", id, kit: "timber", width: id === "porch" ? 4 : 6, depth: id === "porch" ? 3 : 4, seed: 1,
  }), fixture);
  const close = page.locator("#panel-feature-lab .panel__close");
  if (await close.isVisible()) await close.click();
  // The persistent workbench places production prefabs at [-8, 12]. Only the initial approach is setup.
  const x = fixture === "porch" ? -8 : -15;
  const z = fixture === "porch" ? 15.5 : 12;
  const yaw = fixture === "porch" ? Math.PI : Math.PI / 2;
  const y = await driver.callDebug("groundHeight", [x, z]) as number;
  await driver.callDebug("teleport", [[x, y, z]]);
  await driver.callDebug("inspectPose", [{ x, y, z, yaw, pitch: 0.45, distance: 10, detached: false }]);
  const sample = async () => ({
    player: await driver.callDebug("getPlayer"),
    camera: await driver.callDebug("getCamera"), motion: await driver.callDebug("getPlayerMotion"),
  });
  report.before = await sample();
  report.beforeShot = await driver.screenshot(out, "01-before-normal-approach");
  await driver.press("s", fixture === "porch" ? 800 : 900);
  await page.waitForFunction(() => !(window.__gameDebug!.getPlayer() as { moving: boolean }).moving, undefined, { timeout: 2000 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  report.after = await sample();
  report.afterShot = await driver.screenshot(out, "02-after-normal-approach");
  const playerBefore = (report.before as { player: { position: { x: number; z: number } } }).player.position;
  const playerAfter = (report.after as { player: { position: { x: number; z: number } } }).player.position;
  const walked = Math.hypot(playerAfter.x - playerBefore.x, playerAfter.z - playerBefore.z);
  report.walkedMetres = walked;
  assert(walked > 1, "Real keyboard approach must move the player at least one metre");
  const after = report.after as { camera: { yaw: number; effectiveYaw: number; distance: number; freeMove: boolean } };
  assert(Math.abs(after.camera.yaw - yaw) < 0.001, "Camera recovery must preserve input heading");
  assert.equal(after.camera.freeMove, false);
  assert(after.camera.distance >= 4, "Near-wall recovery must leave room to frame the whole avatar");
  report.errors = await driver.callDebug("getErrors");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  for (const source of sources) assert.equal(createHash("sha256").update(await readFile(source.path)).digest("hex"), source.sha256,
    `Camera source changed during acceptance: ${source.path}`);
  report.passed = true;
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
  if (driver.page) report.failureShot = await driver.screenshot(out, "failure").catch(() => null);
} finally {
  await driver.close();
  clear();
  report.finishedAt = new Date().toISOString();
  report.consoleErrors = driver.consoleErrors;
  report.pageErrors = driver.pageErrors;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, out }));
}
