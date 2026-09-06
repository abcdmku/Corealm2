/** Same-frame MSAA/FXAA comparisons through the production foliage fixture and renderer. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA } from "../game/src/app/config.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const clearDeadline = installTestDeadline("Foliage antialiasing lab", 59_000);
const output = "test-results/foliage-antialiasing-lab";
await mkdir(output, { recursive: true });
const driver = new GameDriver({ url: argValue(process.argv.slice(2), "--url") ?? "http://127.0.0.1:4188", close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const comparisons: Record<string, unknown>[] = [];
const timings: Record<string, unknown>[] = [];
let movement: unknown;
let passed = false;
try {
  await driver.launch();
  await driver.open(25_000, "/index.html?mode=combat&environment=1");
  const page = driver.page!;
  await page.evaluate("window.__name = (fn) => fn");
  assert.equal(((await driver.callDebug("getPerformanceTimings")) as any).antialiasing.finalPass, "FXAA");

  async function compare(name: string): Promise<void> {
    // Both renders occur in one task. Wind, camera, transforms and simulation cannot advance
    // between the raw MSAA frame and the final smoothed frame.
    const pair = await page.evaluate(() => {
      const w = window as any;
      const debug = w.__gameDebug;
      const canvas = document.querySelector("canvas")!;
      const draw = () => {
        const profile = debug.getRenderProfile("lab-foliage-");
        return { png: canvas.toDataURL("image/png"), calls: profile.calls, triangles: profile.triangles, passes: profile.passes };
      };
      let before;
      try { debug.setScreenAntialiasingEnabled(false); before = draw(); }
      finally { debug.setScreenAntialiasingEnabled(true); }
      return { before, after: draw(), width: canvas.width, height: canvas.height,
        camera: debug.getCamera(), bounds: w.__environmentLab.getBounds(), state: w.__environmentLab.getState() };
    });
    assert.deepEqual(pair.after.passes.postprocess, { calls: 1, triangles: 1 });
    // Main's visibility queries submit only when the previous GPU result is available.
    // Their depth-only draws may differ across a synchronous pair; neither changes colour.
    assert.equal(pair.after.calls - pair.after.passes["depth-only"].calls,
      pair.before.calls - pair.before.passes["depth-only"].calls + 1);
    assert.equal(pair.after.triangles - pair.after.passes["depth-only"].triangles,
      pair.before.triangles - pair.before.passes["depth-only"].triangles + 1);
    assert.deepEqual(pair.after.passes.colour, pair.before.passes.colour);
    const buffers = [pair.before.png, pair.after.png].map(png => Buffer.from(png.split(",")[1]!, "base64"));
    await writeFile(`${output}/${name}-msaa.png`, buffers[0]!);
    await writeFile(`${output}/${name}-fxaa.png`, buffers[1]!);
    const images = await Promise.all(buffers.map(buffer => sharp(buffer).removeAlpha().raw().toBuffer()));
    const camera = new PerspectiveCamera(CAMERA.fov, pair.width / pair.height, CAMERA.near, CAMERA.far);
    camera.position.copy(pair.camera.position);
    camera.lookAt(new Vector3().copy(pair.camera.target));
    camera.updateMatrixWorld();
    const projected = [];
    for (const x of [pair.bounds.min[0], pair.bounds.max[0]]) for (const y of [pair.bounds.min[1], pair.bounds.max[1]]) for (const z of [pair.bounds.min[2], pair.bounds.max[2]]) {
      const p = new Vector3(x, y, z).project(camera);
      projected.push([(p.x + 1) * pair.width / 2, (1 - p.y) * pair.height / 2]);
    }
    const left = Math.max(1, Math.floor(Math.min(...projected.map(p => p[0]!))));
    const right = Math.min(pair.width - 2, Math.ceil(Math.max(...projected.map(p => p[0]!))));
    const top = Math.max(1, Math.floor(Math.min(...projected.map(p => p[1]!))));
    const bottom = Math.min(pair.height - 2, Math.ceil(Math.max(...projected.map(p => p[1]!))));
    const luminance = (image: Buffer, x: number, y: number) => {
      const i = (y * pair.width + x) * 3;
      return image[i]! * .3 + image[i + 1]! * .59 + image[i + 2]! * .11;
    };
    const roughness = images.map(image => {
      let gradient = 0;
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const l = luminance(image, x, y);
        gradient += Math.abs(l - luminance(image, x + 1, y)) + Math.abs(l - luminance(image, x, y + 1));
      }
      return gradient;
    });
    assert(roughness[1]! < roughness[0]!, `${name}: the final pass did not soften canopy pixel contrast`);
    // Sky is flat within each row. A second colour conversion would alter these pixels.
    let skyDifference = 0;
    for (let y = 80; y < 100; y++) for (let x = 500; x < 520; x++) {
      skyDifference += Math.abs(luminance(images[0]!, x, y) - luminance(images[1]!, x, y));
    }
    assert(skyDifference / 400 < .5, `${name}: the pass changed flat sky colour`);
    comparisons.push({ name, size: [pair.width, pair.height], state: pair.state, camera: pair.camera,
      bounds: pair.bounds, canopyPixels: { left, right, top, bottom }, roughness,
      reduction: 1 - roughness[1]! / roughness[0]!, meanSkyDifference: skyDifference / 400,
      passes: pair.after.passes });
  }

  for (const id of ["corealm_pine_1", "corealm_oak_1", "corealm_willow_1"]) {
    await page.evaluate(async id => (window as any).__environmentLab.showFoliage(id, { layout: "lane", count: 1, span: 1, scale: 1 }), id);
    for (const z of [4, -28]) {
      await driver.callDebug("inspectPose", [{ x: 9, y: 0, z, yaw: Math.PI, pitch: .18, distance: 34 }]);
      await driver.wait(150);
      await compare(`${id}-${z === 4 ? "middle" : "far"}`);
    }
  }
  await page.setViewportSize({ width: 960, height: 600 });
  await driver.wait(150);
  await compare("resized");
  await page.setViewportSize({ width: 1440, height: 900 });
  await driver.wait(150);
  await compare("resize-return");

  await page.evaluate(async () => (window as any).__environmentLab.showFoliage("corealm_pine_1", {
    layout: "grid", count: 64, span: 70, variants: ["corealm_pine_1", "corealm_pine_2", "corealm_oak_1", "corealm_ash_1"],
  }));
  await driver.callDebug("inspectPose", [{ x: 0, y: 0, z: -40, yaw: Math.PI, pitch: .4, distance: 38 }]);
  await driver.wait(400);
  for (const enabled of [false, true, true, false]) {
    await driver.callDebug("setScreenAntialiasingEnabled", [enabled]);
    await driver.wait(400);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await driver.wait(100);
      samples.push(await driver.callDebug("getPerformanceTimings"));
    }
    timings.push({ enabled, samples });
  }
  await driver.callDebug("setScreenAntialiasingEnabled", [true]);
  await page.evaluate(() => { (window as any).__featureLab.setWalkingEnabled(true); (document.activeElement as HTMLElement)?.blur(); });
  const beforeMove = await driver.callDebug("getPlayerPosition") as { x: number; z: number };
  await driver.press("w", 600);
  const afterMove = await driver.callDebug("getPlayerPosition") as { x: number; z: number };
  assert(Math.hypot(afterMove.x - beforeMove.x, afterMove.z - beforeMove.z) > .5, "The real player must move in the grove");
  await driver.screenshot(output, "mixed-grove-moving");
  await driver.press("s", 600);
  movement = { before: beforeMove, after: afterMove, returned: await driver.callDebug("getPlayerPosition") };
  assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors], []);
  passed = true;
  console.log(JSON.stringify({ comparisons: comparisons.length, reductions: comparisons.map(c => c.reduction), errors: [] }));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed, comparisons, timings, movement, errors: [...driver.consoleErrors, ...driver.pageErrors] }, null, 2));
  await driver.close();
  clearDeadline();
}
