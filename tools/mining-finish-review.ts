/** Production-path site composition views. Extraction proof lives in mine-access-browser.ts. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { GameDriver } from "./lib/driver.js";
import { installAssetCandidates } from "./lib/assetCandidates.js";
import { installTestDeadline } from "./lib/deadline.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("tsx tools/mining-finish-review.ts --site <mine-id> [--url http://127.0.0.1:4175] [--catalog art/rebuild/candidates/finish-mining/ground-ores.json] [--out test-results/finish-mining/views/<mine-id>]");
  process.exit(0);
}
const options: Record<string, string> = {};
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]!, value = args[index + 1];
  assert(["--site", "--url", "--catalog", "--out"].includes(flag), `Unknown flag ${flag}`);
  assert(value && !value.startsWith("--") && !(flag in options), `One value required for ${flag}`);
  options[flag] = value;
}
const site = WORLD_SITES.find(entry => entry.kind === "mine" && entry.id === options["--site"]);
assert(site, "--site requires one exact mine ID");
const out = options["--out"] ?? `test-results/finish-mining/views/${site.id}`;
await mkdir(out, { recursive: true });
const deadline = installTestDeadline("Mine composition review", 59_500);
const driver = new GameDriver({ url: options["--url"] ?? `http://127.0.0.1:${process.env.PORT ?? 4175}`, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const report: Record<string, unknown> = { passed: false, visualAccepted: false, site: site.id,
  scope: "Compact production showSite composition, front and both oblique sides. Detached review camera does not establish gameplay camera clearance or extraction.", shots: [] };
try {
  await driver.launch();
  report.candidates = await installAssetCandidates(driver.page!, options["--catalog"] ?? "art/rebuild/candidates/finish-mining/ground-ores.json");
  await driver.open(20_000, "/index.html?mode=combat&environment=1");
  const page = driver.page!;
  await page.evaluate(async id => { await (window as any).__environmentLab.showSite(id); }, site.id);
  const fixture = await page.evaluate(() => ({ state: (window as any).__environmentLab.getState(), bounds: (window as any).__environmentLab.getBounds() }));
  assert(fixture.state.ready && fixture.state.selection === site.id);
  assert(fixture.bounds && fixture.state.entityIds.length === site.resourceSlots.length);
  report.fixture = fixture;
  const { min, max } = fixture.bounds;
  const width = Math.max(max[0] - min[0], max[2] - min[2]);
  await page.evaluate(() => {
    for (const selector of ["#panel-feature-lab", "#environment-lab-panel"]) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) element.style.visibility = "hidden";
    }
  });
  const shots: unknown[] = [];
  for (const [name, yaw] of [["front", 0], ["left", -0.95], ["right", 0.95]] as const) {
    const pose = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2,
      z: (min[2] + max[2]) / 2, yaw, pitch: 0.45, distance: Math.max(18, width * 1.3), detached: true };
    await driver.callDebug("inspectPose", [pose]);
    await driver.wait(150);
    await driver.screenshot(out, name);
    shots.push({ name, pose, camera: await driver.callDebug("getCamera"), metrics: await driver.callDebug("getMetrics") });
  }
  report.shots = shots;
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
