/** Measure the first real play window after boot-screen removal on the mobile profile. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const args = process.argv.slice(2);
const raw = args.includes("--raw") || !args.includes("--release");
const output = path.resolve(`test-results/startup-presentation${raw ? "-raw" : "-release"}`);
const POST_READY_WINDOW_MS = 2_000;
const clear = installTestDeadline("Startup presentation", 60_000);
await mkdir(output, { recursive: true });

const server = await startGameServer();
const browser = await chromium.launch({
  headless: true,
  args: [
    ...(process.platform === "win32" ? ["--use-angle=d3d11"] : []),
    "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio",
  ],
});

try {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

  if (!raw) {
    await page.route("**/assets/**", async route => {
      const file = path.resolve("game/dist", new URL(route.request().url()).pathname.slice(1));
      if (!file.startsWith(path.resolve("game/dist") + path.sep)) throw Error("Asset path outside release");
      try {
        await route.fulfill({
          body: await readFile(file),
          contentType: file.endsWith(".json") ? "application/json" : "application/octet-stream",
        });
      } catch {
        await route.continue();
      }
    });
  }

  // This runs before the game module and before the first boot frame. It deliberately does not
  // poll getState(), which serialises the whole semantic world and would perturb this timing test.
  await page.addInitScript(() => {
    (window as any).__name = (value: unknown) => value;
    const trace: any = {
      version: 1,
      startedAt: performance.now(),
      bootScreenSeenAt: null,
      readyAt: null,
      bootScreenRemovedAt: null,
      postReadyStartedAt: null,
      stoppedAt: null,
      events: [],
      frames: [],
      presentations: [],
      gpuCompletions: [],
      longtasks: [],
      snapshots: [],
      errors: [],
      longtaskObserverInstalled: false,
      movementError: null,
      presentationError: null,
      snapshotError: null,
    };
    const w = window as any;
    w.__startupPresentationTrace = trace;
    try { performance.setResourceTimingBufferSize(4000); } catch { /* Browser default is enough. */ }

    const mark = (name: string, detail?: unknown, at = performance.now()) => {
      const previous = trace.events.at(-1);
      if (previous?.name === name && JSON.stringify(previous.detail) === JSON.stringify(detail)) return;
      trace.events.push({ name, at, ...(detail === undefined ? {} : { detail }) });
    };
    trace.mark = mark;

    window.addEventListener("error", event => {
      trace.errors.push({ at: performance.now(), source: "window", message: event.message });
    });
    window.addEventListener("unhandledrejection", event => {
      trace.errors.push({ at: performance.now(), source: "unhandledrejection", message: String(event.reason) });
    });

    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          trace.longtasks.push({ at: entry.startTime, ms: entry.duration, name: entry.name });
        }
      }).observe({ type: "longtask", buffered: true });
      trace.longtaskObserverInstalled = true;
    } catch (error) {
      trace.errors.push({ at: performance.now(), source: "longtask-observer", message: String(error) });
    }

    const compactSnapshot = (label: string, at: number) => {
      try {
        const debug = w.__gameDebug;
        const presentation = debug?.getPresentationState?.();
        const loading = w.__corealmPlayerAssets?.snapshot?.();
        const views = debug?.getEntityViewStats?.();
        const residency = views?.residency;
        const shaders = w.__renderDistanceLab?.shaders?.();
        trace.snapshots.push({
          label,
          at,
          assets: loading?.assets ? {
            total: loading.assets.total, requested: loading.assets.requested, loaded: loading.assets.loaded,
            failed: loading.assets.failed, queued: loading.assets.queued, inflight: loading.assets.inflight,
          } : null,
          views: views ? {
            pendingAnimations: views.pendingAnimations,
            residency: residency ? {
              tracked: residency.tracked, selected: residency.selected, resident: residency.resident,
              pending: residency.pending, missing: residency.missing, failed: residency.failed,
              pendingAssets: Array.isArray(residency.pendingAssets) ? residency.pendingAssets.length : null,
            } : null,
          } : null,
          shaders: shaders ? {
            waiting: shaders.waiting, queued: shaders.queued, compiling: shaders.compiling, textures: shaders.textures,
          } : null,
          presentation: presentation ? {
            submitted: presentation.submitted, completed: presentation.completed, skipped: presentation.skipped,
            pending: presentation.pending, pendingMs: presentation.pendingMs, lastCompletionMs: presentation.lastCompletionMs,
            maxCompletionMs: presentation.maxCompletionMs, limit: presentation.limit,
          } : null,
        });
      } catch (error) {
        trace.snapshotError ??= String(error);
      }
    };
    trace.captureSnapshot = compactSnapshot;

    let previousAt = trace.startedAt;
    let postReadyPreviousAt: number | null = null;
    let lastCompletedId = 0;
    const sample = (at: number) => {
      const bootScreen = document.getElementById("boot-screen");
      if (bootScreen && trace.bootScreenSeenAt === null) {
        trace.bootScreenSeenAt = at;
        mark("boot-screen-seen", undefined, at);
      }
      const debug = w.__gameDebug;
      let ready = false;
      try { ready = typeof debug?.ready === "function" && Boolean(debug.ready()); }
      catch (error) { trace.movementError ??= String(error); }
      if (ready && trace.readyAt === null) {
        trace.readyAt = at;
        mark("ready", undefined, at);
        compactSnapshot("ready", at);
      }
      if (!bootScreen && trace.bootScreenSeenAt !== null && trace.bootScreenRemovedAt === null) {
        trace.bootScreenRemovedAt = at;
        trace.postReadyStartedAt = at;
        postReadyPreviousAt = at;
        mark("boot-screen-removed", undefined, at);
        compactSnapshot("boot-screen-removed", at);
      }

      const postReadyStart = trace.postReadyStartedAt;
      if (postReadyStart !== null && at >= postReadyStart) {
        const frameMs = postReadyPreviousAt === null ? 0 : Math.max(0, at - postReadyPreviousAt);
        postReadyPreviousAt = at;
        trace.frames.push({ at, ms: frameMs });
        if (trace.frames.length > 1_000) trace.frames.shift();
        try {
          const presentation = debug?.getPresentationState?.();
          if (!presentation || typeof presentation.pendingMs !== "number" || !Array.isArray(presentation.recent)) {
            throw new Error("Missing presentation state");
          }
          trace.presentations.push({
            at, pending: presentation.pending, pendingMs: presentation.pendingMs,
            submitted: presentation.submitted, completed: presentation.completed, skipped: presentation.skipped,
            lastCompletionMs: presentation.lastCompletionMs, maxCompletionMs: presentation.maxCompletionMs,
            limit: presentation.limit, failed: presentation.failed,
          });
          if (trace.presentations.length > 1_000) trace.presentations.shift();
          for (const completed of presentation.recent) {
            if (typeof completed?.id !== "number" || completed.id <= lastCompletedId) continue;
            lastCompletedId = completed.id;
            if (typeof completed.ms === "number" && completed.at >= postReadyStart) {
              trace.gpuCompletions.push({ ...completed });
            }
          }
          if (trace.gpuCompletions.length > 1_000) trace.gpuCompletions.shift();
        } catch (error) {
          trace.presentationError ??= String(error);
        }
      }

      previousAt = at;
      trace.rafId = requestAnimationFrame(sample);
    };
    trace.rafId = requestAnimationFrame(sample);
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 2 });
  await page.goto(`${server.url}/?mode=combat&performance=1&sampledActors=1`, { waitUntil: "commit" });
  await page.locator("#boot-screen").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__startupPresentationTrace?.bootScreenSeenAt !== null,
    undefined, { timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__gameDebug?.ready?.(), undefined, { timeout: 35_000 });
  await page.locator("#boot-screen").waitFor({ state: "detached", timeout: 35_000 });
  await page.waitForFunction(() => {
    const trace = (window as any).__startupPresentationTrace;
    return trace?.readyAt !== null && trace?.bootScreenRemovedAt !== null;
  }, undefined, { timeout: 5_000 });

  const closeLab = page.getByRole("button", { name: "Close Feature lab", exact: true });
  if (await closeLab.count()) await closeLab.click();
  await page.evaluate(() => {
    const w = window as any;
    w.__featureLab?.setWalkingEnabled(true);
    w.__featureLab?.setFreeCameraEnabled(false);
    const trace = w.__startupPresentationTrace;
    trace.mark("input-ready");
    trace.captureSnapshot("input-ready", performance.now());
  });

  const before = await page.evaluate(() => {
    const w = window as any, debug = w.__gameDebug;
    const trace = w.__startupPresentationTrace;
    trace.mark("input-start");
    trace.captureSnapshot("input-start", performance.now());
    return { player: debug.getPlayerPosition(), camera: debug.getCamera() };
  });
  const stick = await page.getByRole("slider", { name: "Move", exact: true }).boundingBox();
  assert.ok(stick, "Mobile movement control must be visible immediately after boot");
  const viewport = await page.locator("#viewport").boundingBox();
  assert.ok(viewport, "Gameplay viewport must be available immediately after boot");

  const movePoint = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 30, id: 1 };
  await page.evaluate(() => (window as any).__startupPresentationTrace.mark("movement-touch-start"));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [movePoint] });
  await page.waitForTimeout(500);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.evaluate(() => (window as any).__startupPresentationTrace.mark("movement-touch-end"));

  const orbitStart = { x: viewport.x + viewport.width * .68, y: viewport.y + viewport.height * .38, id: 2 };
  await page.evaluate(() => (window as any).__startupPresentationTrace.mark("orbit-touch-start"));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [orbitStart] });
  for (let step = 1; step <= 10; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: orbitStart.x + step * 18, y: orbitStart.y + step * 3, id: orbitStart.id }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.evaluate(() => (window as any).__startupPresentationTrace.mark("orbit-touch-end"));

  await page.waitForFunction(duration => {
    const trace = (window as any).__startupPresentationTrace;
    return typeof trace?.postReadyStartedAt === "number" && performance.now() >= trace.postReadyStartedAt + duration;
  }, POST_READY_WINDOW_MS, { polling: "raf", timeout: 10_000 });

  const after = await page.evaluate(() => {
    const w = window as any, debug = w.__gameDebug, trace = w.__startupPresentationTrace;
    trace.mark("window-end");
    trace.captureSnapshot("window-end", performance.now());
    trace.stoppedAt = performance.now();
    if (trace.rafId !== undefined) cancelAnimationFrame(trace.rafId);
    return { player: debug.getPlayerPosition(), camera: debug.getCamera() };
  });

  const result = await page.evaluate(() => {
    const w = window as any;
    const trace = w.__startupPresentationTrace;
    const values = (items: unknown[], key: string) => items
      .map(item => Number((item as any)?.[key])).filter(Number.isFinite);
    const percentile = (items: number[], p: number) => {
      const sorted = [...items].sort((a, b) => a - b);
      return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]! : null;
    };
    const postReadyStart = trace.postReadyStartedAt;
    const stoppedAt = trace.stoppedAt ?? performance.now();
    const frames = trace.frames.filter((frame: any) => frame.at >= postReadyStart && frame.at <= stoppedAt);
    const presentations = trace.presentations.filter((sample: any) => sample.at >= postReadyStart && sample.at <= stoppedAt);
    const completions = trace.gpuCompletions.filter((completion: any) => completion.at >= postReadyStart && completion.at <= stoppedAt);
    const longtasks = trace.longtasks.filter((entry: any) => entry.startTime >= postReadyStart && entry.startTime <= stoppedAt);
    const frameMs = values(frames, "ms");
    const completionMs = values(completions, "ms");
    const pendingMs = values(presentations, "pendingMs");
    const longtaskMs = values(longtasks, "ms");
    const compactTrace = {
      version: trace.version, startedAt: trace.startedAt, bootScreenSeenAt: trace.bootScreenSeenAt,
      readyAt: trace.readyAt, bootScreenRemovedAt: trace.bootScreenRemovedAt,
      postReadyStartedAt: trace.postReadyStartedAt, stoppedAt, events: trace.events,
      frames, presentations, gpuCompletions: completions, longtasks, snapshots: trace.snapshots,
      errors: trace.errors, longtaskObserverInstalled: trace.longtaskObserverInstalled,
      movementError: trace.movementError, presentationError: trace.presentationError, snapshotError: trace.snapshotError,
    };
    return {
      trace: compactTrace,
      metrics: {
        raf: { samples: frameMs.length, p95Ms: percentile(frameMs, .95), maxMs: percentile(frameMs, 1) },
        gpu: { completions: completionMs.length, p95Ms: percentile(completionMs, .95), maxMs: percentile(completionMs, 1) },
        pending: { samples: pendingMs.length, maxMs: percentile(pendingMs, 1) },
        longtasks: { samples: longtaskMs.length, maxMs: percentile(longtaskMs, 1) },
      },
      gameErrors: w.__gameDebug?.getErrors?.() ?? null,
    };
  });

  const angleDelta = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const positionDelta = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
  const cameraDelta = Math.max(
    angleDelta(after.camera.yaw, before.camera.yaw),
    angleDelta(after.camera.effectiveYaw, before.camera.effectiveYaw),
  );
  const report = { passed: false, raw, cpuThrottle: 2, viewport: { width: 844, height: 390, deviceScaleFactor: 2 }, before, after,
    positionDelta, cameraDelta, errors, ...result };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));

  assert.equal(result.trace.readyAt !== null, true, "Ready boundary must be sampled before input");
  assert.equal(result.trace.bootScreenRemovedAt !== null, true, "Boot-screen removal must be sampled");
  assert.ok(result.trace.frames.length > 0, "Post-ready RAF samples must be nonempty");
  assert.ok(result.trace.presentations.length > 0, "Post-ready presentation samples must be nonempty");
  assert.ok(result.trace.gpuCompletions.length > 0, "Post-ready GPU completion samples must be nonempty");
  assert.equal(result.trace.longtaskObserverInstalled, true, "Long-task observer must be installed before boot");
  assert.equal(result.trace.movementError, null, result.trace.movementError ?? "Movement sampler failed");
  assert.equal(result.trace.presentationError, null, result.trace.presentationError ?? "Presentation sampler failed");
  assert.equal(result.trace.snapshotError, null, result.trace.snapshotError ?? "Queue snapshot failed");
  assert.ok(positionDelta > .02, `Real touch movement must change position (${positionDelta}m)`);
  assert.ok(cameraDelta > .02, `Real touch orbit must change camera yaw (${cameraDelta}rad)`);
  assert.ok(result.metrics.raf.maxMs !== null && result.metrics.raf.maxMs < 150,
    `Post-ready RAF max ${result.metrics.raf.maxMs}ms must stay below 150ms`);
  assert.ok(result.metrics.gpu.maxMs !== null && result.metrics.gpu.maxMs <= 150,
    `Post-ready GPU completion max ${result.metrics.gpu.maxMs}ms must stay at or below 150ms`);
  assert.ok(result.metrics.pending.maxMs !== null && result.metrics.pending.maxMs <= 150,
    `Post-ready GPU pending max ${result.metrics.pending.maxMs}ms must stay at or below 150ms`);
  assert.deepEqual(errors, []);
  assert.deepEqual(result.trace.errors, []);
  if (Array.isArray(result.gameErrors)) assert.deepEqual(result.gameErrors, []);

  // Capture only after the timing window and assertions, so screenshot work cannot contaminate the gate.
  await page.screenshot({ path: path.join(output, "post-ready.png"), timeout: 5_000 });
  report.passed = true;
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, raw, positionDelta, cameraDelta, metrics: result.metrics }, null, 2));
} finally {
  await browser.close();
  await server.close();
  clear();
}
