import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { portalMantleSolid } from "../../../game/src/world/portalMantle.js";

const out = "test-results/finish-portal-mantle";
await mkdir(out, { recursive: true });
const clear = installTestDeadline("Production portal mantle", 55_000);
const driver = new GameDriver({ url: "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const report: any = { passed: false, visualAccepted: false, walks: [], shots: [] };
try {
  await driver.launch(); await driver.open(24_000, "/index.html?mode=combat&portal=1");
  const page = driver.page!;
  await page.locator("#panel-feature-lab .panel__close").click();
  const entity: any = await page.evaluate(() => (window as any).__portalLab.entities[0]);
  const solid = portalMantleSolid(entity); assert(solid?.kind === "box"); report.solid = solid;
  const [cx, base, cz] = solid.position, [sx, , sz] = solid.size;
  const sides = [
    { name: "front", x: cx, z: cz + sz / 2 + 4, yaw: 0, axis: "z", boundary: cz + sz / 2, sign: 1 },
    { name: "right", x: cx + sx / 2 + 3, z: cz, yaw: Math.PI / 2, axis: "x", boundary: cx + sx / 2, sign: 1 },
    { name: "rear", x: cx, z: cz - sz / 2 - 3, yaw: Math.PI, axis: "z", boundary: cz - sz / 2, sign: -1 },
  ];
  for (const side of sides) {
    const y: number = await driver.callDebug("groundHeight", [side.x, side.z]);
    await driver.callDebug("teleport", [[side.x, y, side.z]]);
    await driver.callDebug("inspectPose", [{ x: side.x, y: y + 1.2, z: side.z, yaw: side.yaw, pitch: 0.45, distance: 12, detached: true }]);
    await page.evaluate(() => (window as any).__featureLab.setFreeCameraEnabled(false));
    const before: any = await driver.callDebug("getPlayer");
    await driver.press("w", 1800);
    const after: any = await driver.callDebug("getPlayer");
    const moved = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
    assert(moved > 0.7, `${side.name} needs real player motion, got ${moved}`);
    assert((after.position[side.axis] - side.boundary) * side.sign >= -0.05, `${side.name} entered mantle volume`);
    assert.equal(after.regionId, entity.regionId);
    report.walks.push({ side, before, after, moved });
    await driver.callDebug("inspectPose", [{ x: cx, y: entity.position[1] + 3.1, z: cz,
      yaw: side.yaw + 0.2, pitch: 0.58, distance: 18, detached: true }]);
    await driver.wait(180);
    report.shots.push(await driver.screenshot(out, side.name));
  }
  report.probe = await driver.callDebug("probeWorldClearance", [{ x: cx, y: base + 0.5, z: cz, radius: 0.35 }]);
  assert(report.probe.staticShift > 0.1, "Mantle centre must be physical mass");
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors;
  report.requests = driver.requestErrors; report.pageErrors = driver.pageErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []);
  assert.deepEqual(report.requests, []); assert.deepEqual(report.pageErrors, []); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await driver.close(); clear(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error }));
}
