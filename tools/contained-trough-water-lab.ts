import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertPerformanceHardware } from "./performanceHardware.js";

const directory = "test-results/performance/contained-trough-water-lab-v2";
await mkdir(directory, { recursive: true });
const report: { hardware?: unknown; sourcePins?: unknown; clock?: unknown; cases: any[]; errors: string[] } = { cases: [], errors: [] };
const manifestBytes = await readFile("game/public/assets/manifest.json");
const manifest = JSON.parse(manifestBytes.toString());
const source = manifest.assets.find((entry: any) => entry.id === "corealm_water_trough");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
report.sourcePins = { manifestSha256: hash(manifestBytes), assetId: source.id, file: source.file,
  modelSha256: hash(await readFile(`game/public/assets/${source.file}`)),
  rendererSha256: hash(await readFile("game/src/render/renderer.ts")),
  materialSha256: hash(await readFile("game/src/render/containedTroughWater.ts")),
  lighting: "Production static SUN_OFFSET and static sky environment; no time-of-day cycle. Simulation paused for every comparison." };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const watchdog = setTimeout(() => { void browser.close(); }, 112_000);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(`${process.argv[2] ?? "http://127.0.0.1:4175"}/index.html?mode=combat&environment=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__environmentLab?.getState().ready", undefined, { timeout: 50_000 });
  await page.evaluate("window.__gameDebug.setTransmissionOcclusionEnabled(false)");
  await page.evaluate("window.__environmentLab.showGallery('corealm_water_trough')");
  await page.waitForFunction("window.__environmentLab.getState().ready");
  await page.evaluate("window.__gameDebug.setPaused(true)");
  report.clock = await page.evaluate("window.__gameDebug.getState().clock");
  report.hardware = await assertPerformanceHardware(page);
  for (const pose of [{ name: "near", pitch: .95, distance: 4 }, { name: "normal", pitch: .55, distance: 8 }]) {
    await page.evaluate(pose => {
      const d = (window as any).__gameDebug;
      d.inspectPose({ x: 0, y: d.groundHeight(0, 25) + .5, z: 25, yaw: .65, pitch: pose.pitch, distance: pose.distance, detached: true });
    }, pose);
    const result: any = { pose };
    for (const enabled of [false, true]) {
      const material: any = await page.evaluate(enabled => (window as any).__gameDebug.setContainedTroughWater(enabled), enabled);
      if (material.meshes.length !== 1) throw new Error("Expected exactly one native trough-water material");
      await page.waitForTimeout(2000);
      const state: any = await page.evaluate("({profile:window.__gameDebug.getRenderProfile(),timings:window.__gameDebug.getPerformanceTimings(),camera:window.__gameDebug.getCamera()})");
      result[enabled ? "candidate" : "native"] = { material, ...state, hardware: await assertPerformanceHardware(page) };
      await page.screenshot({ path: `${directory}/${pose.name}-${enabled ? "candidate" : "native"}.png` });
    }
    const restored: any = await page.evaluate("window.__gameDebug.setContainedTroughWater(false)");
    if (restored.meshes[0].material.uuid !== result.native.material.meshes[0].material.uuid) throw new Error("Source material identity was not restored");
    if (result.native.material.meshes[0].geometry !== result.candidate.material.meshes[0].geometry) throw new Error("Water geometry changed");
    if (result.candidate.profile.passes["colour-offscreen"].calls !== 0) throw new Error("Contained candidate still triggers offscreen transmission pass");
    await page.waitForTimeout(2000);
    result.restored = { material: restored, ...await page.evaluate("({profile:window.__gameDebug.getRenderProfile(),timings:window.__gameDebug.getPerformanceTimings(),clock:window.__gameDebug.getState().clock})") as object };
    await page.screenshot({ path: `${directory}/${pose.name}-restored.png` });
    report.cases.push(result);
    console.log(JSON.stringify({ pose, native: result.native.timings.gpu, candidate: result.candidate.timings.gpu, restored: result.restored.timings.gpu }));
  }
  await page.evaluate("window.__gameDebug.inspectPose({x:0,y:window.__gameDebug.groundHeight(0,25)+.5,z:25,yaw:.65,pitch:.55,distance:8,detached:true})");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${directory}/restored-native.png` });
} catch (error) { report.errors.push(String(error)); }
finally { clearTimeout(watchdog); await browser.close(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2)); }
if (report.errors.length) process.exitCode = 1;
