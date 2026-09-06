import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { assertPerformanceHardware } from "./performanceHardware.js";
import sharp from "sharp";
const directory = process.argv[3] ?? "test-results/performance/portal-settled";
await mkdir(directory, { recursive: true });
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), samples: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const timeout = setTimeout(() => { void browser.close(); }, 112_000);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => (report.errors as string[]).push(error.message));
  await page.goto(process.argv[2] ?? "http://127.0.0.1:4175/index.html", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction("window.__gameDebug?.getState().ready", undefined, { timeout: 50_000 });
  console.log("ready");
  report.hardware = await assertPerformanceHardware(page);
  report.boot = await page.evaluate("({state:window.__gameDebug.getState(),timings:window.__gameDebug.getPerformanceTimings()})");
  await page.evaluate(`(() => { const d=window.__gameDebug,p=d.getEntity('gravelmaw_mouth_portal'),s=p.interactionPosition,y=p.view.rotationY;
    d.teleport([s[0]+Math.sin(y)*7,s[1],s[2]+Math.cos(y)*7]); })()`);
  await page.evaluate("window.__gameDebug.setCaptureMode(true)");
  try {
    await page.waitForFunction("window.__gameDebug.getScatterResidency().complete && window.__gameDebug.getState().assets.queued===0 && window.__gameDebug.getState().assets.inflight===0", undefined, { timeout: 60_000, polling: 100 });
    report.assetsSettled = true;
  } catch { report.assetsSettled = false; }
  finally { await page.evaluate("window.__gameDebug.setCaptureMode(false)"); }
  console.log("asset settle", report.assetsSettled);
  if (process.argv.includes("--exact-probe")) {
    await page.evaluate("window.__gameDebug.setTransmissionProbeMode('exact-diagnostic')");
    report.probeMode = "exact-diagnostic";
  }
  const poses = process.argv.includes("--occlusion")
    ? [{ name: "wide-native", pitch: .48, distance: 32, occlusion: false },
      { name: "wide-candidate", pitch: .48, distance: 32, occlusion: true },
      { name: "steep", pitch: 1, distance: 14, occlusion: true }]
    : [{ name: "wide", pitch: .48, distance: 32, occlusion: false }, { name: "steep", pitch: 1, distance: 14, occlusion: false }];
  for (const pose of poses) {
    await page.evaluate(enabled => (window as any).__gameDebug.setTransmissionOcclusionEnabled(enabled), pose.occlusion);
    await page.evaluate(`(() => { const d=window.__gameDebug,p=d.getEntity('gravelmaw_mouth_portal'),s=p.interactionPosition;
      d.inspectPose({x:s[0],y:s[1]+4,z:s[2],yaw:p.view.rotationY,pitch:${pose.pitch},distance:${pose.distance},detached:true}); })()`);
    await page.waitForTimeout(2000);
    const frames = await page.evaluate(`new Promise(resolve=>{const rows=[];let last;const end=performance.now()+4000;
      function frame(now){if(last!==undefined)rows.push(now-last);last=now;if(now<end)requestAnimationFrame(frame);else resolve(rows)}requestAnimationFrame(frame)})`) as number[];
    const stats = await page.evaluate(`(() => {const d=window.__gameDebug;return {state:d.getState(),camera:d.getCamera(),timings:d.getPerformanceTimings(),visibility:d.getScatterVisibility(),metrics:d.getMetrics(),residency:d.getScatterResidency()}})()`);
    const sorted = frames.slice().sort((a,b)=>a-b);
    const profile: any = await page.evaluate("window.__gameDebug.getRenderProfile()");
    const hardware = await assertPerformanceHardware(page);
    const sample = { name: pose.name, hardware, frames: frames.length, medianMs: sorted[Math.floor(sorted.length/2)], p95Ms: sorted[Math.floor(sorted.length*.95)], stats, profile };
    (report.samples as unknown[]).push(sample);
    console.log(JSON.stringify(sample));
    await page.screenshot({ path: `${directory}/${pose.name}.png` });
    if ((pose.name === "wide" || pose.name === "wide-candidate") && process.argv.includes("--contribution")) {
      const contributions = [];
      for (const candidate of profile.transmissiveCandidates) {
        const pair: { withSurface: string; withoutSurface: string } = await page.evaluate(id => (window as any).__gameDebug.captureTransmissionContribution(id), candidate.objectId);
        const withBuffer = Buffer.from(pair.withSurface.split(",")[1]!, "base64");
        const withoutBuffer = Buffer.from(pair.withoutSurface.split(",")[1]!, "base64");
        await writeFile(`${directory}/${candidate.name}-with.png`, withBuffer);
        await writeFile(`${directory}/${candidate.name}-without.png`, withoutBuffer);
        const a = await sharp(withBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const b = await sharp(withoutBuffer).removeAlpha().raw().toBuffer();
        let changed = 0, maxDelta = 0, minX = a.info.width, minY = a.info.height, maxX = -1, maxY = -1;
        for (let pixel = 0; pixel < a.info.width * a.info.height; pixel++) {
          let delta = 0;
          for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(a.data[pixel * 3 + channel]! - b[pixel * 3 + channel]!));
          maxDelta = Math.max(maxDelta, delta);
          if (delta > 0) { changed++; const x = pixel % a.info.width, y = Math.floor(pixel / a.info.width);
            minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
        }
        contributions.push({ candidate, changedPixels: changed, maxChannelDelta: maxDelta,
          changedBounds: changed ? { minX, minY, maxX, maxY } : null });
      }
      report.contributions = contributions;
      console.log(JSON.stringify({ contributions }));
    }
  }
  report.profile = await page.evaluate("window.__gameDebug.getRenderProfile()");
} catch (error) {
  (report.errors as string[]).push(String(error));
} finally {
  clearTimeout(timeout);
  await browser.close();
  await writeFile(`${directory}/report.json`, JSON.stringify(report,null,2));
}
console.log(`${directory}/report.json`);
if ((report.errors as string[]).length) process.exitCode = 1;
