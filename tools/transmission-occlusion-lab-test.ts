import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { assertPerformanceHardware } from "./performanceHardware.js";

const exactProbe = process.argv.includes("--exact-probe");
const withShell = process.argv.includes("--with-shell");
const mixedShell = process.argv.includes("--mixed-shell");
const directory = `test-results/performance/transmission-occlusion-lab${exactProbe ? "-exact" : ""}${withShell ? "-shell" : ""}${mixedShell ? "-mixed" : ""}`;
await mkdir(directory, { recursive: true });
const report: { hardware?: unknown; cases: any[]; errors: string[] } = { cases: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const watchdog = setTimeout(() => { void browser.close(); }, 112_000);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(`${process.argv[2] ?? "http://127.0.0.1:4175"}/index.html?mode=combat&environment=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__environmentLab?.getState().ready", undefined, { timeout: 50_000 });
  report.hardware = await assertPerformanceHardware(page);
  if (exactProbe) await page.evaluate("window.__gameDebug.setTransmissionProbeMode('exact-diagnostic')");
  const cases = [{ name: "visible", verticalOffset: 0 },
    ...(withShell ? [{ name: "shell-hidden", verticalOffset: 0 }] : []),
    { name: "hidden", verticalOffset: -3 }, { name: "return", verticalOffset: 0 }];
  for (const test of cases) {
    const hiddenCase = test.name === "hidden" || test.name === "shell-hidden";
    await page.evaluate(async ({ test, mixedShell }) => {
      const w = window as any;
      w.__gameDebug.setTransmissionOcclusionEnabled(false);
      await w.__environmentLab.showGallery("corealm_water_trough", { verticalOffset: test.verticalOffset,
        companionAssetId: mixedShell ? "corealm_feed_trough" : undefined });
      const low = test.name === "shell-hidden";
      w.__gameDebug.inspectPose({ x: 0, y: w.__gameDebug.groundHeight(0, 25) + (low ? .05 : .5), z: 25,
        yaw: .65, pitch: low ? .02 : .55, distance: 8, detached: true });
    }, { test, mixedShell });
    await page.waitForFunction("window.__environmentLab.getState().ready");
    await page.waitForTimeout(1200);
    const baseline: any = await page.evaluate("({profile:window.__gameDebug.getRenderProfile(),timings:window.__gameDebug.getPerformanceTimings(),camera:window.__gameDebug.getCamera()})");
    await page.screenshot({ path: `${directory}/${test.name}-native.png` });
    await page.evaluate("window.__gameDebug.setTransmissionOcclusionEnabled(true)");
    await page.waitForTimeout(1800);
    const candidate: any = await page.evaluate("({profile:window.__gameDebug.getRenderProfile(),timings:window.__gameDebug.getPerformanceTimings(),camera:window.__gameDebug.getCamera()})");
    await page.screenshot({ path: `${directory}/${test.name}-candidate.png` });
    const hidden = candidate.timings.transmissionOcclusion.hiddenMeshes.length;
    report.cases.push({ ...test, baseline, candidate, pendingValidation: true });
    if (exactProbe) {
      const probes = candidate.timings.transmissionOcclusion.probes;
      if (withShell && !candidate.timings.transmissionOcclusion.lastProbeState?.opaqueSources?.length) {
        throw new Error("Native opaque trough shell was not included in the depth diagnostic");
      }
      const visibility = candidate.timings.transmissionOcclusion.lastProbeState?.opaqueVisibility ?? [];
      if (mixedShell && (!visibility.some((row: any) => row.before > row.allowed)
        || visibility.some((row: any) => row.before !== row.after || row.during !== row.allowed))) throw new Error("Mixed native shell subset was not excluded/restored");
      if (hidden !== 0 || probes.length !== 1 || probes[0].hidden !== hiddenCase) {
        throw new Error(`Unexpected exact diagnostic result for ${test.name}: ${JSON.stringify(probes)}`);
      }
    } else if (hiddenCase !== (hidden > 0)) throw new Error(`Unexpected occlusion result for ${test.name}: ${hidden}`);
    const source = baseline.profile.transmissiveCandidates[0];
    if (!source) throw new Error(`Native water never submitted in ${test.name}`);
    const pair: any = await page.evaluate(id => (window as any).__gameDebug.captureTransmissionContribution(id), source.objectId);
    const before = Buffer.from(pair.withSurface.split(",")[1], "base64");
    const after = Buffer.from(pair.withoutSurface.split(",")[1], "base64");
    await writeFile(`${directory}/${test.name}-with.png`, before);
    await writeFile(`${directory}/${test.name}-without.png`, after);
    const a = await sharp(before).removeAlpha().raw().toBuffer();
    const b = await sharp(after).removeAlpha().raw().toBuffer();
    let changedChannels = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changedChannels++;
    if (hiddenCase && changedChannels !== 0) throw new Error("Occlusion rejected a contributing water surface");
    if (!hiddenCase && changedChannels === 0) throw new Error("Visible native water fixture contributed no pixels");
    const result = { ...test, baseline, candidate, changedChannels, hardware: await assertPerformanceHardware(page) };
    report.cases[report.cases.length - 1] = result; console.log(JSON.stringify(result));
  }
} catch (error) { report.errors.push(String(error)); }
finally { clearTimeout(watchdog); await browser.close(); await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2)); }
if (report.errors.length) process.exitCode = 1;
