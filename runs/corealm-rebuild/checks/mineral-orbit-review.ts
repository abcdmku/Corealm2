/**
 * Orbit review for one inventory mineral specimen in the production environment gallery.
 *
 *   npx tsx runs/corealm-rebuild/checks/mineral-orbit-review.ts --url http://127.0.0.1:4187 \
 *     --out test-results/opal-r1 --views 24 corealm_item_fire_opal
 *
 * Twenty-four yaws at three pitches around the specimen, plus a top-down, using the same gallery,
 * lighting and materials the game uses. `--catalog` serves staged candidate GLBs in this browser
 * context only. Captures are for inspection; `passed` records clean error lists and gallery state.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { installAssetCandidates } from "../../../tools/lib/assetCandidates.js";

const args = process.argv.slice(2);
const selections: string[] = [];
let out = "test-results/mineral-orbit";
let url = process.env.COREALM_URL ?? `http://127.0.0.1:${process.env.PORT ?? "4175"}`;
let catalog: string | undefined;
let views = 24;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  const value = (): string => {
    const next = args[++index];
    if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`);
    return next;
  };
  if (arg === "--url") url = value();
  else if (arg === "--out") out = value();
  else if (arg === "--catalog") catalog = value();
  else if (arg === "--views") views = Number(value());
  else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
  else selections.push(arg);
}
assert(selections.length, "Pass at least one asset id");
assert(Number.isInteger(views) && views >= 4 && views <= 48, "--views 4..48");
await mkdir(out, { recursive: true });

const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 900, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline("Mineral orbit review", 60_000 + views * 4000 * selections.length);
const report: any = { passed: false, visualAccepted: false, out, selections, views, shots: [], limits: [
  "Gallery framing at a fixed radius. This is specimen review, not inventory icon acceptance.",
] };

try {
  await driver.launch();
  const page = driver.page!;
  if (catalog) report.candidates = await installAssetCandidates(page, catalog);
  await driver.open(25_000, "/index.html?mode=combat&environment=1");
  report.renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const info = gl.getExtension("WEBGL_debug_renderer_info")!;
    return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  });
  assert(!/swiftshader|llvmpipe|software/i.test(report.renderer), `Software renderer: ${report.renderer}`);
  for (const id of selections) {
    await page.evaluate(async (requested) => {
      await (window as any).__environmentLab.showGallery(requested, {});
    }, id);
    await page.waitForFunction((requested) => {
      const selection = document.querySelector<HTMLSelectElement>("#environment-lab-selection");
      return selection?.value === requested;
    }, id, { timeout: 20_000 });
    const bounds: any = await page.evaluate(() => (window as any).__environmentLab.getBounds());
    const state: any = await page.evaluate(() => (window as any).__environmentLab.getState());
    assert(bounds && state.ready && state.selection === id, `${id}: gallery not ready`);
    const centre = {
      x: (bounds.min[0] + bounds.max[0]) / 2,
      y: (bounds.min[1] + bounds.max[1]) / 2,
      z: (bounds.min[2] + bounds.max[2]) / 2,
    };
    const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
    const distance = Math.max(0.34, span * 2.1);
    await page.evaluate(() => {
      for (const selector of ["#panel-feature-lab", "#environment-lab-panel"]) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) element.style.visibility = "hidden";
      }
    });
    for (let view = 0; view < views; view += 1) {
      // Three pitch bands around the full turn, so the exposed face, the rind and the seam contour
      // are all sampled rather than one equatorial ring.
      const yaw = (view / views) * Math.PI * 2;
      const pitch = [0.16, 0.46, 0.78][view % 3]!;
      await driver.callDebug("inspectPose", [{ ...centre, yaw, pitch, distance, detached: true }]);
      await driver.wait(110);
      const name = `${id}-${String(view).padStart(2, "0")}-yaw${yaw.toFixed(2)}-pitch${pitch}`;
      const file = await driver.screenshot(out, name);
      report.shots.push({ name, file, id, yaw, pitch, distance });
    }
    await driver.callDebug("inspectPose", [{ ...centre, yaw: 0.6, pitch: 1.35, distance, detached: true }]);
    await driver.wait(110);
    report.shots.push({ name: `${id}-top`, file: await driver.screenshot(out, `${id}-top`), id, yaw: 0.6, pitch: 1.35, distance });
    report.specimens = [...(report.specimens ?? []), { id, bounds, distance, state }];
    await page.evaluate(() => {
      for (const selector of ["#panel-feature-lab", "#environment-lab-panel"]) {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) element.style.visibility = "";
      }
    });
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) {
  report.error = String((error as Error)?.stack ?? error); process.exitCode = 1;
  try { await driver.screenshot(out, "failure"); } catch {}
} finally {
  await driver.close(); deadline();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.split("\n")[0], shots: report.shots.length, out }));
}
