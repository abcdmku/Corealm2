/**
 * Authored-world composition captures for every mine: approach, aisle and two rear obliques.
 * One Chromium session on hardware D3D11; the player is teleported near each mine (setup) so ore
 * entities are resident, then a detached inspection camera frames the site. World-only exception:
 * the behaviour under review is final terrain embedding of the cut face.
 *
 *   PORT=4190 npx tsx tools/mine-world-views.ts [--out test-results/slice11/views] [--site <id>]
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_SITES, worldSitePoint } from "../game/src/content/worldSites.js";
import { worldSiteHaulRamp } from "../game/src/world/siteTerrain.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";

const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]!, value = args[index + 1];
  assert(["--site", "--url", "--out"].includes(flag) && value, `Bad flag ${flag}`);
  options[flag] = value;
}
const mines = WORLD_SITES.filter((site) => site.kind === "mine" && (!options["--site"] || site.id === options["--site"]));
assert(mines.length, "No mine matched --site");
const out = options["--out"] ?? "test-results/slice11/views";
await mkdir(out, { recursive: true });
const deadline = installTestDeadline("Mine world views", 150_000);
const driver = new GameDriver({ url: options["--url"] ?? `http://127.0.0.1:${process.env.PORT ?? 4175}`, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const report: Record<string, unknown> = { passed: false, sites: {} };
try {
  await driver.launch();
  await driver.open(30_000, "/index.html");
  const page = driver.page!;
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")!.getContext("webgl2")!;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
  assert(/D3D11/i.test(renderer) && !/SwiftShader/i.test(renderer), `Hardware renderer required, got ${renderer}`);
  report.renderer = renderer;
  await page.evaluate(() => {
    for (const selector of ["#panel-feature-lab", "#environment-lab-panel"]) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.style.visibility = "hidden";
    }
  });
  for (const site of mines) {
    const ramp = worldSiteHaulRamp(site);
    const ids = site.resourceSlots.map((slot) => `${slot.clusterId}_${slot.index}`);
    const start = [ramp.worldEnd[0], await driver.callDebug("groundHeight", [...ramp.worldEnd]) as number, ramp.worldEnd[1]];
    await driver.callDebug("teleport", [start]);
    await page.waitForFunction((resourceIds) => resourceIds.every((id) => {
      const bounds = (window as any).__gameDebug.getDrawnBounds(id);
      return bounds && bounds.meshes > 0;
    }), ids, { timeout: 12_000 });
    await driver.wait(400);
    const centre = worldSitePoint(site, 0, -2);
    const centreY = await driver.callDebug("groundHeight", [...centre]) as number;
    const yawApproach = site.rotationY + site.terrain.approachAngle;
    const shots = [
      { name: "approach", yaw: yawApproach, pitch: 0.42, distance: 30, target: [centre[0], centreY + 1.5, centre[1]] },
      { name: "aisle", yaw: yawApproach, pitch: 0.25, distance: 14, target: [centre[0], centreY + 1.2, centre[1]] },
      { name: "rear-left", yaw: yawApproach + Math.PI - 0.75, pitch: 0.55, distance: 30, target: [centre[0], centreY + 2, centre[1]] },
      { name: "rear-right", yaw: yawApproach + Math.PI + 0.75, pitch: 0.55, distance: 30, target: [centre[0], centreY + 2, centre[1]] },
      { name: "side-high", yaw: yawApproach + Math.PI / 2, pitch: 0.7, distance: 32, target: [centre[0], centreY + 2, centre[1]] },
    ];
    const captured: unknown[] = [];
    for (const shot of shots) {
      const ok = await driver.callDebug("inspectPose", [{ x: shot.target[0], y: shot.target[1], z: shot.target[2],
        yaw: shot.yaw, pitch: shot.pitch, distance: shot.distance, detached: true }]);
      assert.equal(ok, true, `inspectPose ${site.id} ${shot.name}`);
      await driver.wait(350);
      const file = await driver.screenshot(out, `${site.id}-${shot.name}`);
      captured.push({ ...shot, file, camera: await driver.callDebug("getCamera") });
    }
    (report.sites as Record<string, unknown>)[site.id] = { start, shots: captured };
  }
  report.errors = await driver.callDebug("getErrors");
  report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
} finally {
  await driver.close(); deadline();
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, out, error: report.error }));
}
