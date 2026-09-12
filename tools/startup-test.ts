/** Production startup acceptance. Keep the camera, graphics settings and scene at normal defaults. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startGameServer } from "./lib/server.js";
import type {} from "./lib/debug-api.js";

const args = process.argv.slice(2);
const route = args.includes("--lab") ? "/?mode=combat&performance=1" : "/";
const output = path.resolve("test-results/startup-acceptance", args.includes("--lab") ? "lab" : "world");
await mkdir(output, { recursive: true });
const server = await startGameServer({ hmr: false });
const browser = await chromium.launch({ headless: true, args: process.platform === "win32"
  ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"]
  : ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

async function observe() {
  return page.evaluate(() => {
    const debug = window.__gameDebug as any;
    return {
      player: debug.getPlayer(), metrics: debug.getMetrics(),
      views: debug.getEntityViewStats(), scatter: debug.getScatterResidency(),
      errors: debug.getErrors(), performance: debug.getPerformanceTimings(),
      boot: (window as any).__corealmBootTelemetry.snapshot(),
    };
  });
}

async function proveBoot(name: string) {
  // Poll the DOM while loading. getState enumerates the entire semantic world and must not
  // become a second per-frame simulation in a timing test.
  await page.goto(new URL(route, server.url).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("#boot-screen").waitFor({ state: "detached", timeout: 60_000 });
  assert.equal(await page.evaluate(() => window.__gameDebug!.getState().ready), true);
  const initial = await observe();
  const residency = (initial.views as any).residency;
  assert.equal(residency.pending, 0, "Selected visual assets must be resident at reveal");
  assert.equal(residency.failed, 0);
  assert.equal(residency.missing, 0);
  assert.deepEqual(initial.errors, []);
  await page.screenshot({ path: path.join(output, `${name}-ready.png`), timeout: 5_000 });
  await page.waitForTimeout(2_000);
  const settled = await observe();
  assert.deepEqual(settled.scatter, initial.scatter, "An idle start must not fill the view with later tiles");
  assert.deepEqual((settled.views as any).residency.pendingAssets, []);
  await page.screenshot({ path: path.join(output, `${name}-settled.png`), timeout: 5_000 });
  // The lab opens with a focused form control. A normal canvas click gives movement keys back.
  if (args.includes("--lab")) await page.locator("#viewport").click({ position: { x: 720, y: 450 } });
  const before = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  await page.keyboard.down("w");
  await page.waitForTimeout(650);
  await page.keyboard.up("w");
  const after = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  assert.notDeepEqual(after, before, "Real keyboard movement must work after reveal");
  const report = { initial, settled, before, after, errors };
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ name, playableMs: initial.boot.firstPlayableMs, pendingAssets: residency.pending,
    tiles: (initial.scatter as any)?.resident?.length, before, after }));
}

try {
  const cave = args.includes("--cave");
  await proveBoot(cave ? "cave-fresh" : "fresh");
  if (args.includes("--resume") || cave) {
    const saved = await page.evaluate(inCave => {
      const debug = window.__gameDebug as any;
      const caveFloor = inCave ? debug.getEntity("gravelmaw_exit_portal").position[1] : 0;
      const point = debug.getNavPoint(inCave ? [40, caveFloor, -40] : [140, 10, -90]);
      if (!point) throw new Error("Resume fixture needs reachable ground");
      const blob = JSON.parse(debug.getSaveBlob());
      blob.player.position = [point.x, inCave ? point.y : debug.groundHeight(point.x, point.z), point.z];
      blob.player.regionId = inCave ? "gravelmaw" : (debug.sampleWorld(point.x, point.z) as any).semanticRegion;
      blob.player.movement.path = [];
      return { position: blob.player.position, regionId: blob.player.regionId, blob: JSON.stringify(blob) };
    }, cave);
    // The outgoing page saves on pagehide. Install the fixture in the next document, after that
    // save and before boot reads storage, so this tests a real resume at the requested location.
    await page.addInitScript(blob => localStorage.setItem("corealm.save.v1", blob), saved.blob);
    await proveBoot(cave ? "resumed-cave" : "resumed");
    const report = await observe();
    assert.equal((report.player as any).regionId, saved.regionId);
    assert.ok(Math.abs((report.player as any).position.x - saved.position[0]) < 10);
    if (cave) assert.deepEqual((report.scatter as any).resident, [], "A cave resume must not generate outdoor tiles");
  }
} finally {
  await browser.close();
  await server.close();
}
