/** Slow camera and wind sequences through the real foliage fixture, materials and renderer. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { Matrix4, Vector3 } from "three";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue } from "./lib/paths.js";

const clearDeadline = installTestDeadline("Foliage motion lab", 59_000);
const output = "test-results/foliage-motion-lab";
await mkdir(output, { recursive: true });
const driver = new GameDriver({ url: argValue(process.argv.slice(2), "--url") ?? "http://127.0.0.1:4188", close: async () => {} }, {
  viewport: { width: 1280, height: 800 },
  browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const sequences: Record<string, unknown>[] = [];
let passed = false;
try {
  await driver.launch();
  await driver.open(25_000, "/index.html?mode=combat&environment=1");
  const page = driver.page!;
  await page.evaluate("window.__name = (fn) => fn");
  for (const id of ["corealm_pine_1", "corealm_oak_1", "corealm_ash_1"]) {
    await page.evaluate(async id => (window as any).__environmentLab.showFoliage(id, { layout: "lane", count: 1, span: 1 }), id);
    for (const [distance, motion] of [[22, "camera"], [55, "camera"], [22, "wind"]] as const) {
      const name = `${id}-${distance}-${motion}`;
      const frames = await page.evaluate(({ distance, motion }) => {
        const w = window as any, debug = w.__gameDebug, environment = w.__environmentLab;
        const canvas = document.querySelector("canvas")!;
        const result = [];
        for (let i = 0; i < 13; i++) {
          // Follow mode uses the actual player and sun-follow path. The player stays outside
          // the tree's reveal footprint. Only the variable under test advances between frames.
          debug.inspectPose({ x: 0, y: 5, z: 8, yaw: Math.PI + (motion === "camera" ? (i - 6) * .002 : 0),
            pitch: .15, distance, detached: false });
          environment.sampleSurfaceTime(10 + (motion === "wind" ? i / 30 : 0));
          const profile = debug.getRenderProfile("lab-foliage-");
          result.push({ png: canvas.toDataURL(), camera: debug.getCamera(), state: environment.getState(),
            bounds: environment.getBounds(), shadow: profile.shadowMap,
            draws: profile.draws.filter((draw: any) => draw.pass === "colour"), postprocess: profile.passes.postprocess });
        }
        return result;
      }, { distance, motion });
      const baseline = frames[0]!;
      assert(baseline.draws.length > 0, "No tree colour submissions");
      const materials = baseline.draws.flatMap((draw: any) => draw.materials).filter((material: any) => material.name.includes("_cutout"));
      assert(materials.length > 0 && materials.every((material: any) => material.leafAssociatedColour && material.coverageSamples >= 2),
        "The production leaf colour and coverage path was not submitted");
      const images: Buffer[] = [];
      const shadowPixels: number[][] = [];
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]!;
        assert.deepEqual(frame.state, baseline.state, "Tree population changed during small movement");
        assert.deepEqual(frame.bounds, baseline.bounds, "Tree geometry changed during small movement");
        assert.deepEqual(frame.draws, baseline.draws, "Tree submissions changed during small movement");
        assert.deepEqual(frame.postprocess, { calls: 1, triangles: 1 });
        const point = new Vector3(0, 7, 25).applyMatrix4(new Matrix4().fromArray(frame.shadow.matrix));
        shadowPixels.push([point.x * frame.shadow.size[0], point.y * frame.shadow.size[1]]);
        const buffer = Buffer.from(frame.png.split(",")[1]!, "base64");
        await writeFile(`${output}/${name}-${i}.png`, buffer);
        images.push(await sharp(buffer).removeAlpha().raw().toBuffer());
      }
      // The light follows the camera by whole texels: a fixed world point retains its sample phase.
      const phaseDrift = Math.max(...shadowPixels.flatMap(point => point.map((value, axis) => {
        const delta = value - shadowPixels[0]![axis]!;
        return Math.abs(delta - Math.round(delta));
      })));
      assert(phaseDrift < 1e-7, `${name}: moving camera shifted shadow samples by a fractional texel`);
      if (motion === "camera") assert.notDeepEqual(frames[0]!.camera.position, frames[12]!.camera.position);
      else assert.deepEqual(frames[0]!.camera, frames[12]!.camera);
      // This is a motion sanity check, not a claim that total image change measures aliasing.
      const changedBytes = images[0]!.reduce((sum, value, i) => sum + Number(value !== images[12]![i]), 0);
      assert(changedBytes > 100, `${name}: the capture did not exercise motion`);
      sequences.push({ name, distance, motion, phaseDrift, changedBytes,
        materials, bounds: baseline.bounds, state: baseline.state, cameras: frames.map(frame => frame.camera) });
    }
  }
  assert.deepEqual([...driver.pageErrors, ...driver.consoleErrors], []);
  passed = true;
  console.log(JSON.stringify({ passed, sequences: sequences.length, maximumShadowPhaseDrift: Math.max(...sequences.map(s => s.phaseDrift as number)) }));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed, sequences, errors: [...driver.pageErrors, ...driver.consoleErrors],
    visualAcceptance: "Inspect the camera and wind sequences for colour flashes, retained crown detail and stable silhouettes. Stable draw counts alone are not visual proof." }, null, 2));
  // A replay uses captured production frames, with no interpolation or image processing.
  await writeFile(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><title>Foliage motion inspection</title>
<style>body{background:#202526;color:#eee;font:16px system-ui;margin:20px}img{display:block;max-width:100%;margin-top:16px}select,button{font:inherit;margin-right:12px}</style>
<label>Sequence <select id="sequence">${sequences.map(s => `<option>${s.name}</option>`).join("")}</select></label>
<button id="toggle">Pause</button><span id="frame"></span><img id="image" alt="Captured foliage motion frame">
<script>let n=0,d=1,playing=true;const select=document.getElementById('sequence'),image=document.getElementById('image');
function draw(){image.src=select.value+'-'+n+'.png';document.getElementById('frame').textContent='Frame '+n+' / 12'}
document.getElementById('toggle').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play'};
select.onchange=()=>{n=0;d=1;draw()};setInterval(()=>{if(playing){n+=d;if(n===12||n===0)d=-d;draw()}},100);draw();</script>`);
  await driver.close();
  clearDeadline();
}
