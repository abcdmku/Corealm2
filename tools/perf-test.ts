/**
 * Real-GPU performance measurement.
 *
 * The smoke and play harness deliberately runs SwiftShader (`--enable-unsafe-swiftshader`) so
 * gameplay results are deterministic and machine-independent. That is correct for state assertions
 * and useless for frame rate: SwiftShader reports ~4 FPS on a scene that runs at 480 FPS on the
 * same machine's actual GPU.
 *
 * The Phase 1 gate asks for "smooth 60 FPS on a modern gaming desktop, measured in a real browser".
 * This tool measures that: a real GPU through ANGLE/D3D11, per named camera pose, reporting the
 * frame-time distribution rather than a vsync-capped average.
 *
 * Usage: npx tsx tools/perf-test.ts --run runs/corealm [--shots spawn,town_center] [--seconds 6]
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { startGameServer } from "./lib/server.js";
import { argValue, prepareRun } from "./lib/paths.js";
import { installTestDeadline } from "./lib/deadline.js";
import type {} from "./lib/debug-api.js";

const GPU_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];

export interface ShotPerf {
  shot: string;
  frames: number;
  medianFrameMs: number;
  p95FrameMs: number;
  worstFrameMs: number;
  impliedFps: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  heapMB: number;
  meetsBudget: boolean;
}

export interface PerfReport {
  startedAt: string;
  renderer: string;
  usedRealGpu: boolean;
  viewport: { width: number; height: number };
  targetFps: number;
  maxDrawCalls: number;
  scatterResidency: { resident: number; total: number; complete: boolean } | null;
  shots: ShotPerf[];
  passed: boolean;
  errors: string[];
}

const TARGET_FPS = 60;
const BUDGET_MS = 1000 / TARGET_FPS;
const MIN_SAMPLE_SECONDS = 1;
const MAX_SAMPLE_SECONDS = 30;
const MAX_TOTAL_SAMPLE_SECONDS = 180;

/**
 * Draw-call ceiling from runs/corealm/architecture.md correction R6.
 *
 * This is checked per pose, not once. The first version of this tool measured only the default
 * spawn view — the emptiest frame in the game — and passed itself while the Karrowmoor pose was
 * running 559 draw calls, 40% over budget. A budget that only ever samples the cheap pose is worse
 * than no budget, because it reports green.
 */
const MAX_DRAW_CALLS = 400;

/**
 * Frame sampler, built as page source text with the duration baked in.
 *
 * Two reasons it is a string rather than an inline callback:
 *  - tsx/esbuild rewrites named arrow functions with a `__name` helper that does not exist inside
 *    the page, so a serialised inline callback throws "__name is not defined";
 *  - `page.evaluate(string, arg)` does not reliably invoke the string as a function, so the
 *    argument is interpolated instead and the expression evaluates to a Promise directly.
 */
function sampleFramesSource(durationMs: number): string {
  return `new Promise((resolve) => {
    const frameTimes = [];
    let previous = performance.now();
    const deadline = previous + ${Math.round(durationMs)};
    function step(now) {
      frameTimes.push(now - previous);
      previous = now;
      if (now < deadline) requestAnimationFrame(step);
      else resolve(frameTimes);
    }
    requestAnimationFrame(step);
  })`;
}

export async function runPerfTest(
  runCandidate: string,
  shots: string[],
  seconds: number,
): Promise<PerfReport> {
  if (!Number.isFinite(seconds) || seconds < MIN_SAMPLE_SECONDS || seconds > MAX_SAMPLE_SECONDS) {
    throw new Error(`Sample duration must be between ${MIN_SAMPLE_SECONDS} and ${MAX_SAMPLE_SECONDS} seconds`);
  }
  const runDir = await prepareRun(runCandidate);
  const server = await startGameServer();

  const report: PerfReport = {
    startedAt: new Date().toISOString(),
    renderer: "unknown",
    usedRealGpu: false,
    viewport: { width: 1920, height: 1080 },
    targetFps: TARGET_FPS,
    maxDrawCalls: MAX_DRAW_CALLS,
    scatterResidency: null,
    shots: [],
    passed: false,
    errors: [],
  };

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: GPU_ARGS });
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => report.errors.push(String(error).slice(0, 500)));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(message.text().slice(0, 500));
    });

    await page.goto(server.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 90_000 });

    // First playable only guarantees the spawn ring. Waiting for all generation tiles prevents
    // a fast camera sweep from passing the budget while grass, stones and shrubs are still absent.
    // Pause rendering during this setup phase: an uncapped render loop can starve background
    // streaming. Capture mode restores the user's render scale and shadows before measurement.
    await page.evaluate(() => {
      (window.__gameDebug as unknown as { setCaptureMode(enabled: boolean): void }).setCaptureMode(true);
    });
    try {
      await page.waitForFunction(() => {
        const api = window.__gameDebug as unknown as {
          getScatterResidency?: () => { complete: boolean } | null;
        };
        return api.getScatterResidency?.()?.complete === true;
      }, undefined, { timeout: 60_000, polling: 100 });
    } catch (error) {
      const loading = await page.evaluate(() => {
        const api = window.__gameDebug as unknown as {
          getScatterResidency(): unknown;
          getErrors(): unknown;
        };
        return { residency: api.getScatterResidency(), errors: api.getErrors() };
      });
      report.errors.push(`Scatter did not finish loading: ${JSON.stringify(loading)}`);
      throw error;
    } finally {
      await page.evaluate(() => {
        (window.__gameDebug as unknown as { setCaptureMode(enabled: boolean): void }).setCaptureMode(false);
      });
    }
    report.scatterResidency = await page.evaluate(() => {
      const api = window.__gameDebug as unknown as {
        getScatterResidency(): { resident: string[]; total: number; complete: boolean };
      };
      const state = api.getScatterResidency();
      return { resident: state.resident.length, total: state.total, complete: state.complete };
    });

    report.renderer = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    report.usedRealGpu = !/swiftshader|software|llvmpipe/i.test(report.renderer);
    if (!report.usedRealGpu) {
      report.errors.push(`No hardware GPU available; measured on ${report.renderer}. FPS numbers are not meaningful.`);
    }

    const available = (await page.evaluate(() => {
      const api = window.__gameDebug as unknown as { listShots?: () => string[] } | undefined;
      return typeof api?.listShots === "function" ? api.listShots() : [];
    })) as string[];
    const requested = shots.length > 0 ? shots : available.length > 0 ? available : ["default"];
    const unknown = requested.filter((shot) => shot !== "default" && !available.includes(shot));
    if (unknown.length > 0) {
      throw new Error(`Unknown performance shot(s): ${unknown.join(", ")}`);
    }
    if (requested.length * seconds > MAX_TOTAL_SAMPLE_SECONDS) {
      throw new Error(
        `Requested ${requested.length * seconds} sample-seconds; split the run into shards of at most `
          + `${MAX_TOTAL_SAMPLE_SECONDS} sample-seconds`,
      );
    }
    if (requested.length === 1 && requested[0] === "default") {
      report.errors.push(
        "Only the default pose was measured. The game exposes no __gameDebug.listShots(), so this "
        + "run cannot prove the budget holds at the dense poses. Add named camera poses.",
      );
    }

    for (const shot of requested) {
      if (shot !== "default" && available.includes(shot)) {
        await page.evaluate((id) => {
          const api = window.__gameDebug as unknown as { focusCamera?: (shotId: string) => boolean } | undefined;
          api?.focusCamera?.(id);
        }, shot);
      }
      await page.waitForTimeout(700);

      // Sample real frame boundaries rather than trusting an in-game average.
      const samples = ((await page.evaluate(sampleFramesSource(seconds * 1000))) ?? []) as number[];

      const metrics = (await page.evaluate(() => {
        const api = window.__gameDebug as unknown as { getMetrics?: () => Record<string, number> } | undefined;
        return typeof api?.getMetrics === "function" ? api.getMetrics() : {};
      })) as Record<string, number>;

      // Drop the first few frames: they include the camera move and shader warm-up.
      const usable = samples.slice(3).sort((a, b) => a - b);
      const at = (fraction: number): number =>
        usable.length === 0 ? 0 : Math.round(usable[Math.min(usable.length - 1, Math.floor(usable.length * fraction))]! * 100) / 100;

      const median = at(0.5);
      const entry: ShotPerf = {
        shot,
        frames: usable.length,
        medianFrameMs: median,
        p95FrameMs: at(0.95),
        worstFrameMs: usable.length ? Math.round(usable[usable.length - 1]! * 100) / 100 : 0,
        impliedFps: median > 0 ? Math.round(1000 / median) : 0,
        drawCalls: metrics.drawCalls ?? 0,
        triangles: metrics.triangles ?? 0,
        programs: metrics.programs ?? 0,
        heapMB: metrics.heapMB ?? 0,
        meetsBudget: median > 0 && median <= BUDGET_MS && (metrics.drawCalls ?? 0) <= MAX_DRAW_CALLS,
      };
      if ((metrics.drawCalls ?? 0) > MAX_DRAW_CALLS) {
        report.errors.push(`${shot}: ${metrics.drawCalls} draw calls exceeds the ${MAX_DRAW_CALLS} budget`);
      }
      report.shots.push(entry);
    }

    const runtimeErrors = await page.evaluate(() => {
      const api = window.__gameDebug as unknown as { getErrors(): unknown[] };
      return api.getErrors();
    });
    for (const error of runtimeErrors) report.errors.push(`Game runtime: ${JSON.stringify(error)}`);
    report.passed =
      report.usedRealGpu &&
      report.shots.length > 0 &&
      report.shots.every((shot) => shot.meetsBudget) &&
      report.errors.length === 0;
  } catch (error) {
    report.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }

  await writeFile(path.join(runDir, "test-results", "perf.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runCandidate = argValue(args, "--run");
  if (!runCandidate) throw new Error("Usage: npx tsx tools/perf-test.ts --run runs/<id> [--shots a,b] [--seconds 6]");
  const shots = (argValue(args, "--shots") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  // 5 rather than 6: the Kilnhalt poses take the registry to 32 shots, and 32 x 6 = 192
  // sample-seconds trips the tool's own 180 s shard cap. 32 x 5 = 160 keeps the plain
  // `npm run perf -- --run runs/corealm` invocation measuring the complete pose set.
  const seconds = Number(argValue(args, "--seconds") ?? 5);

  const report = await runPerfTest(runCandidate, shots, seconds);
  console.log(JSON.stringify({
    renderer: report.renderer,
    usedRealGpu: report.usedRealGpu,
    scatterResidency: report.scatterResidency,
    passed: report.passed,
    shots: report.shots,
    errors: report.errors,
  }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const clearDeadline = installTestDeadline("performance test");
  try {
    await main();
  } finally {
    clearDeadline();
  }
}
