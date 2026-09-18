/** Slice production animation preparation while real touch input keeps moving in the lab. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const clear = installTestDeadline('Animation preparation lab', 60_000);
const raw = process.argv.includes('--raw');
const out = `test-results/animation-preparation${raw ? '-raw' : ''}`;
await mkdir(out, { recursive: true });
const server = await startGameServer();
const browser = await chromium.launch({ headless: true, args: [
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  if (!raw) await page.route('**/assets/**', async route => {
    const file = path.resolve('game/dist', new URL(route.request().url()).pathname.slice(1));
    if (!file.startsWith(path.resolve('game/dist') + path.sep)) throw Error('Asset path outside release');
    try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); }
    catch { await route.continue(); }
  });
  await page.addInitScript({ content: 'window.__name=v=>v;' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
  await page.goto(`${server.url}/?mode=combat&performance=1&sampledActors=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready, undefined, { timeout: 35000 });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
  type CattleRequest = { url: string; startedAtMs: number; finishedAtMs?: number; failed?: string };
  const cattleRequests: CattleRequest[] = [];
  const requestRows = new Map<object, CattleRequest>();
  const isCattleAsset = (url: string) => /\/animal_cattle\.glb(?:\.model)?(?:[?#]|$)/i.test(url);
  page.on('request', request => {
    if (!isCattleAsset(request.url())) return;
    const row: CattleRequest = { url: request.url(), startedAtMs: Date.now() };
    cattleRequests.push(row); requestRows.set(request, row);
  });
  page.on('requestfinished', request => {
    const row = requestRows.get(request);
    if (row) row.finishedAtMs = Date.now();
  });
  page.on('requestfailed', request => {
    const row = requestRows.get(request);
    if (row) row.failed = request.failure()?.errorText ?? 'request failed';
  });
  await page.evaluate(async () => {
    const w = window as any;
    w.__featureLab.setWalkingEnabled(true); w.__featureLab.setFreeCameraEnabled(false);
    // Observe the real implementation; no substituted preparation or simulation.
    const moduleUrl = '/src/render/animationLod.ts';
    const { AnimationLod } = await import(/* @vite-ignore */ moduleUrl);
    const original = AnimationLod.prototype.prepare;
    w.__slices = [];
    AnimationLod.prototype.prepare = function (budget: number) {
      const started = performance.now(), position = w.__gameDebug.getPlayerPosition();
      const ready = original.call(this, budget);
      w.__slices.push({ at: started, ms: performance.now() - started, budget, ready, position });
      return ready;
    };
  });
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  // This gate isolates a new asset entering an already playable scene. Finish the initial
  // scene's own queues first; the cattle must still be completely cold when sampling starts.
  const baselineStartedAt = Date.now();
  const baselineHandle = await page.waitForFunction(() => {
    const w = window as any, d = w.__gameDebug;
    const loading = w.__corealmPlayerAssets.snapshot(), views = d.getEntityViewStats();
    const shaders = w.__renderDistanceLab.shaders(), presentation = d.getPresentationState();
    return loading.assets.queued === 0 && loading.assets.inflight === 0
      && views.residency.pending === 0 && views.pendingAnimations === 0 && shaders.waiting === 0
      && presentation.completed > 0 && presentation.pendingMs < 50 && presentation.lastCompletionMs < 50
      ? { loading, views, shaders, presentation } : false;
  }, undefined, { polling: 'raf', timeout: 15000 });
  const baseline = { state: await baselineHandle.jsonValue(), settledMs: Date.now() - baselineStartedAt };
  await baselineHandle.dispose();
  const cattleBefore = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(entry => /\/animal_cattle\.glb(?:\.model)?(?:[?#]|$)/i.test(entry.name)).map(entry => entry.name));
  assert.deepEqual(cattleBefore, [], 'The target model must remain cold while the initial scene settles');
  const stick = await page.getByRole('slider', { name: 'Move', exact: true }).boundingBox(); assert.ok(stick);
  await page.evaluate(() => {
    const w = window as any, debug = w.__gameDebug, telemetry = w.__corealmBootTelemetry;
    const before = telemetry?.snapshot?.();
    const trace: any = {
      startedAt: performance.now(), frames: [], movement: [], presentation: [], gpuCompletions: [],
      parseBeforeIds: Array.isArray(before?.spans)
        ? before.spans.filter((span: any) => span.name === 'boot.entities.gltf.parse').map((span: any) => span.id)
        : [],
      presentationError: null, telemetryError: typeof telemetry?.snapshot === 'function' ? null : 'Missing __corealmBootTelemetry.snapshot()'
    };
    w.__animationPreparationTrace = trace;
    let previousAt = trace.startedAt, lastCompletedId = 0;
    const sample = (at: number) => {
      const frameMs = Math.max(0, at - previousAt);
      trace.frames.push({ at, ms: frameMs });
      try {
        if (typeof debug?.getPlayerPosition !== 'function') throw new Error('Missing __gameDebug.getPlayerPosition()');
        const position = debug.getPlayerPosition();
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
          throw new Error('Invalid player position sample');
        }
        trace.movement.push({ at, position: { x: position.x, y: position.y, z: position.z } });
      } catch (error) {
        trace.movementError ??= String(error);
      }
      try {
        if (typeof debug?.getPresentationState !== 'function') throw new Error('Missing __gameDebug.getPresentationState()');
        const presentation = debug.getPresentationState();
        if (!presentation || typeof presentation !== 'object'
          || typeof presentation.pendingMs !== 'number' || !Array.isArray(presentation.recent)) {
          throw new Error('Invalid presentation state: missing pendingMs or recent GPU completions');
        }
        trace.presentation.push({ at, pending: presentation.pending, pendingMs: presentation.pendingMs,
          submitted: presentation.submitted, completed: presentation.completed, skipped: presentation.skipped,
          lastCompletionMs: presentation.lastCompletionMs, maxCompletionMs: presentation.maxCompletionMs,
          failed: presentation.failed });
        for (const completed of presentation.recent) {
          if (typeof completed?.id !== 'number' || completed.id <= lastCompletedId) continue;
          lastCompletedId = completed.id;
          if (typeof completed.ms === 'number' && completed.at >= trace.startedAt) trace.gpuCompletions.push({ ...completed });
        }
      } catch (error) {
        trace.presentationError ??= String(error);
      }
      previousAt = at;
      trace.rafId = requestAnimationFrame(sample);
    };
    trace.rafId = requestAnimationFrame(sample);
  });
  const coldWindowStartedAt = Date.now();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2 + 30, y: stick.y + stick.height / 2, id: 1 }] });
  const target = await page.evaluate(async () => {
    const w = window as any;
    const trace = w.__animationPreparationTrace;
    trace.spawnStartedAt = performance.now();
    await w.__featureLab.spawnTarget('creature', 'source:redsill_cattle', { distance: 4 });
    trace.spawnResolvedAt = performance.now();
    return w.__featureLab.getState().target.entityId;
  });
  // spawnTarget stops gameplay and resets the player after its preparation await. Re-arm the real
  // joystick before the next RAF so the preparation slices observe live movement again.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2 + 30, y: stick.y + stick.height / 2, id: 1 }] });
  await page.waitForFunction(id => {
    const w = window as any, debug = w.__gameDebug, stats = debug.getEntityViewStats(), motion = debug.getEntityMotion(id);
    return w.__slices.some((s: any) => s.ready) && stats.pendingAnimations === 0
      && motion?.path === 'sampled-rig' && debug.getDrawnBounds(id) !== null;
  }, target, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const trace = (window as any).__animationPreparationTrace;
    trace.endedAt = performance.now();
    if (trace.rafId !== undefined) cancelAnimationFrame(trace.rafId);
  });
  const coldWindowEndedAt = Date.now();
  const result = await page.evaluate(id => {
    const w = window as any, d = w.__gameDebug;
    const trace = w.__animationPreparationTrace, telemetry = w.__corealmBootTelemetry?.snapshot?.();
    const parseSpans = Array.isArray(telemetry?.spans)
      ? telemetry.spans.filter((span: any) => span.name === 'boot.entities.gltf.parse'
        && span.detail?.assetId === 'animal_cattle' && !trace.parseBeforeIds.includes(span.id))
      : [];
    const resourceTimings = performance.getEntriesByType('resource')
      .map(entry => entry as PerformanceResourceTiming)
      .filter(entry => /\/animal_cattle\.glb(?:\.model)?(?:[?#]|$)/i.test(entry.name))
      .map(entry => ({ name: entry.name, startTime: entry.startTime, responseEnd: entry.responseEnd, duration: entry.duration }));
    return {
      slices: w.__slices, motion: d.getEntityMotion(id), bounds: d.getDrawnBounds(id), errors: d.getErrors(), trace,
      parseSpans, resourceTimings, loadElapsedMs: trace.spawnResolvedAt - trace.spawnStartedAt,
    };
  }, target);
  const percentile = (values: number[], p: number) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]! : null;
  };
  const frameValues = result.trace.frames.map((frame: any) => frame.ms).filter((value: any): value is number => typeof value === 'number');
  const completionValues = result.trace.gpuCompletions.map((frame: any) => frame.ms).filter((value: any): value is number => typeof value === 'number');
  const pendingValues = result.trace.presentation.map((sample: any) => sample.pendingMs).filter((value: any): value is number => typeof value === 'number');
  const coldMovementSamples = result.trace.movement.filter((sample: any) =>
    sample.at >= result.trace.spawnStartedAt && sample.at < result.trace.spawnResolvedAt);
  const postSpawnMovementSamples = result.trace.movement.filter((sample: any) => sample.at >= result.trace.spawnResolvedAt);
  const displacement = (samples: any[]) => {
    const start = samples[0]?.position, end = samples.at(-1)?.position;
    return start && end ? Math.hypot(end.x - start.x, end.z - start.z) : null;
  };
  const coldMovementDistance = displacement(coldMovementSamples);
  const postSpawnMovementDistance = displacement(postSpawnMovementSamples);
  const coldMovementWindowLongEnough = result.loadElapsedMs >= 100;
  const metrics = {
    raf: { samples: frameValues.length, p95Ms: percentile(frameValues, .95), maxMs: percentile(frameValues, 1) },
    gpu: { completions: completionValues.length, completionP95Ms: percentile(completionValues, .95),
      completionMaxMs: percentile(completionValues, 1), pendingSamples: pendingValues.length, pendingMaxMs: percentile(pendingValues, 1) },
    loadElapsedMs: result.loadElapsedMs,
    parseElapsedMs: result.parseSpans.map((span: any) => span.durationMs),
    requestElapsedMs: result.resourceTimings.map((resource: any) => resource.duration),
    movement: {
      coldLoad: { samples: coldMovementSamples.length, distance: coldMovementDistance, windowMs: result.loadElapsedMs,
        required: coldMovementWindowLongEnough },
      postSpawn: { samples: postSpawnMovementSamples.length, distance: postSpawnMovementDistance },
    },
  };
  const requestsDuringWindow = cattleRequests.filter(request => request.startedAtMs >= coldWindowStartedAt && request.startedAtMs <= coldWindowEndedAt);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ ...result, errors, raw, baseline, coldWindowStartedAt, coldWindowEndedAt,
    cattleRequests, requestsDuringWindow, metrics }, null, 2));
  assert.ok(result.slices.length > 3, 'Imported animation must span multiple preparation slices');
  assert.ok(result.slices.every((s: any) => s.budget === 2 && s.ms < 50), 'No full-library bake inside one input frame');
  const first = result.slices[0], last = result.slices.at(-1);
  assert.ok(Math.hypot(last.position.x - first.position.x, last.position.z - first.position.z) > .02,
    'Real movement progresses between preparation slices');
  assert.equal(result.trace.movementError, undefined, result.trace.movementError ?? 'Player movement sampler failed');
  if (coldMovementWindowLongEnough) {
    assert.ok(coldMovementSamples.length > 1 && coldMovementDistance !== null && coldMovementDistance > .02,
      'Real touch movement must progress during the cold request/parse window');
  }
  assert.equal(result.motion.path, 'sampled-rig'); assert.ok(result.bounds);
  assert.ok(requestsDuringWindow.length > 0, `Cold cattle GLB request was not observed during the measurement window: ${cattleRequests.map(request => request.url).join(', ') || 'none'}`);
  assert.ok(result.resourceTimings.length > 0, 'Performance timing for the cold cattle GLB request is missing');
  assert.ok(result.parseSpans.length > 0, 'GLTF parse telemetry for animal_cattle is missing');
  assert.equal(result.trace.telemetryError, null, result.trace.telemetryError ?? 'Boot telemetry unavailable');
  assert.equal(result.trace.presentationError, null, result.trace.presentationError ?? 'Presentation sampler failed');
  assert.ok(metrics.raf.samples > 0 && metrics.raf.maxMs !== null && metrics.raf.p95Ms !== null, 'RAF sampler produced no samples');
  assert.ok(metrics.gpu.completions > 0 && metrics.gpu.completionMaxMs !== null, 'GPU completion sampler produced no samples');
  assert.ok(metrics.gpu.pendingSamples > 0 && metrics.gpu.pendingMaxMs !== null, 'GPU pending sampler produced no samples');
  assert.ok(metrics.raf.maxMs < 150, `RAF max ${metrics.raf.maxMs}ms must stay below 150ms`);
  assert.ok(metrics.raf.p95Ms < 50, `RAF p95 ${metrics.raf.p95Ms}ms must stay below 50ms`);
  assert.ok(metrics.gpu.completionMaxMs <= 150, `GPU completion max ${metrics.gpu.completionMaxMs}ms must stay at or below 150ms`);
  assert.ok(metrics.gpu.pendingMaxMs <= 150, `GPU pending max ${metrics.gpu.pendingMaxMs}ms must stay at or below 150ms`);
  assert.deepEqual(errors, []); assert.deepEqual(result.errors, []);
  await page.screenshot({ path: path.join(out, 'prepared.png'), timeout: 5000 });
  console.log(JSON.stringify({ passed: true, raw, slices: result.slices.length, maxSliceMs: Math.max(...result.slices.map((s: any) => s.ms)),
    motion: result.motion.path, metrics }));
} finally { await browser.close(); await server.close(); clear(); }
