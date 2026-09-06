import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Uses an existing dev server. Run serially for baseline and candidate at identical URLs/fixtures.
// Example: npx tsx tools/matched-performance.ts --url http://127.0.0.1:4175/?mode=combat --label candidate --out test-results/performance/candidate.json --compare test-results/performance/baseline.json
const args = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const url = arg("--url");
if (!url) throw new Error("--url must point to the existing production game or deterministic lab fixture");
const out = path.resolve(arg("--out") ?? "test-results/performance/current.json");
const seconds = Number(arg("--seconds") ?? 4);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 10) throw new Error("--seconds must be 1..10");
const shots = (arg("--shots") ?? "default").split(",");
if (shots.length > 5) throw new Error("Use at most five shots per bounded measurement run");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--mute-audio"] });
const errors: string[] = [];
const report: Record<string, unknown> = {
  label: arg("--label") ?? "current", url, startedAt: new Date().toISOString(),
  simulation: "paused for repeatable rendering; does not benchmark AI",
  limitation: "RAF intervals include scheduling and CPU/render work. CPU phase and GPU timings are latest samples, not distributions; GPU time is unavailable when the extension is absent or samples disjoint.",
  shots: [] as unknown[], errors,
};
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction("window.__gameDebug?.getState().ready === true", undefined, { timeout: 60_000 });
  await page.evaluate("window.__gameDebug.setPaused(true)");
  await page.waitForFunction("!window.__gameDebug.getScatterResidency?.() || window.__gameDebug.getScatterResidency().complete === true", undefined, { timeout: 30_000 });
  report.hardware = await page.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      drawingBuffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
      gpuTimerSupported: !!gl?.getExtension('EXT_disjoint_timer_query_webgl2') };
  })()`);
  for (const shot of shots) {
    if (shot !== "default") {
      const focused = await page.evaluate(`window.__gameDebug.focusCamera(${JSON.stringify(shot)})`);
      if (!focused) throw new Error(`Unknown shot ${shot}`);
    }
    await page.waitForTimeout(1200);
    const snapshot = await page.evaluate(`(() => {
      const a = window.__gameDebug;
      return { camera: a.getCamera(), entities: a.getEntities(), residency: a.getScatterResidency?.() ?? null };
    })()`) as { camera: unknown; entities: unknown; residency: unknown };
    const populationHash = createHash("sha256").update(JSON.stringify(snapshot.entities)).digest("hex");
    // No screenshots or profiling renders inside this interval.
    const intervals = await page.evaluate(`new Promise(resolve => {
      const values = []; let last; const end = performance.now() + ${seconds * 1000};
      function frame(now) { if(last !== undefined) values.push(now-last); last=now;
        if(now < end) requestAnimationFrame(frame); else resolve(values); }
      requestAnimationFrame(frame);
    })`) as number[];
    const metrics = await page.evaluate("window.__gameDebug.getMetrics()");
    const timings = await page.evaluate("window.__gameDebug.getPerformanceTimings?.() ?? null");
    const visibility = await page.evaluate("window.__gameDebug.getScatterVisibility?.() ?? null");
    const sorted = intervals.slice().sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    (report.shots as unknown[]).push({ shot, camera: snapshot.camera, populationHash,
      residency: snapshot.residency, frames: sorted.length, medianFrameMs: percentile(0.5), p95FrameMs: percentile(0.95), metrics, timings, visibility });
    await mkdir(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out.replace(/\.json$/, "") + `-${shot.replace(/[^a-z0-9_-]/gi, "_")}.png` });
  }
  const compare = arg("--compare");
  if (compare) {
    const baseline = JSON.parse(await readFile(compare, "utf8"));
    const current = report.shots as { shot: string; camera: unknown; populationHash: string; medianFrameMs: number }[];
    report.comparison = current.map(row => {
      const prior = baseline.shots.find((p: typeof row) => p.shot === row.shot);
      const matched = !!prior && JSON.stringify(prior.camera) === JSON.stringify(row.camera)
        && prior.populationHash === row.populationHash
        && JSON.stringify(baseline.hardware) === JSON.stringify(report.hardware);
      return { shot: row.shot, matched, medianDeltaMs: matched ? row.medianFrameMs - prior.medianFrameMs : null };
    });
  }
} catch (error) {
  errors.push(String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
}
console.log(out);
