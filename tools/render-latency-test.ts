/** Exercise GPU backpressure through the real renderer and touch movement, including a
 * deliberately withheld completion signal. This is queue proof, not phone GPU emulation. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const out = 'test-results/render-latency-lab';
const clear = installTestDeadline('Render latency lab', 60_000);
await mkdir(out, { recursive: true });
const server = await startGameServer();
const browser = await chromium.launch({ headless: true, args: [
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/assets/**', async route => {
    const file = path.resolve('game/dist', new URL(route.request().url()).pathname.slice(1));
    if (!file.startsWith(path.resolve('game/dist') + path.sep)) throw Error('Asset path outside release');
    try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); }
    catch { await route.continue(); }
  });
  await page.addInitScript({ content: `window.__name=v=>v;` });
  await page.goto(`${server.url}/?mode=combat&performance=1&motion=legacy&motionActors=animal_cattle,animal_deer,animal_boar&sampledActors=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready, undefined, { timeout: 35000 });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
  await page.evaluate(() => {
    const w = window as any, d = w.__gameDebug;
    w.__featureLab.setWalkingEnabled(true); w.__featureLab.setFreeCameraEnabled(false);
    d.teleport([-58, d.groundHeight(-58, 26), 26]);
    const p = d.getPlayerPosition();
    d.inspectPose({ x: p.x, y: p.y, z: p.z, yaw: Math.PI, pitch: .45, distance: 11 });
  });
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.waitForFunction(() => (window as any).__renderDistanceLab.shaders().waiting === 0, undefined, { timeout: 10000 });
  const snapshot = () => page.evaluate(() => {
    const w = window as any, d = w.__gameDebug;
    return { at: performance.now(), player: d.getPlayerPosition(), drawn: w.__interactionFeedback.snapshot().playerDrawn,
      timings: d.getPerformanceTimings(), errors: d.getErrors() };
  });
  const before = await snapshot();
  assert.equal(before.timings.antialiasing.samples, 0, 'Mobile uses one final AA pass');
  assert.equal(before.timings.antialiasing.finalPass, 'FXAA');
  assert.ok(before.timings.drawingBuffer[0] <= 1055, 'High-DPI drawing buffer is bounded');
  await page.waitForTimeout(2000);
  const natural = await snapshot();
  assert.ok(1000 * (natural.timings.presentation.completed - before.timings.presentation.completed)
    / (natural.at - before.at) > 45, 'Backpressure must not halve smooth lab graphics to 30 FPS');
  const cdp = await context.newCDPSession(page);
  const stick = await page.getByRole('slider', { name: 'Move', exact: true }).boundingBox(); assert.ok(stick);
  // Delay notification for the outstanding production GPU frames. Input and CPU simulation
  // remain real and unthrottled; do not fake a good GPU time or mutate player state.
  await page.evaluate(() => {
    const w = window as any, prototype = WebGL2RenderingContext.prototype, original = prototype.clientWaitSync;
    w.__holdUntil = performance.now() + 500;
    prototype.clientWaitSync = function(sync, flags, timeout) {
      if (performance.now() < w.__holdUntil) return this.TIMEOUT_EXPIRED;
      return original.call(this, sync, flags, timeout);
    };
    w.__releaseGpu = () => { prototype.clientWaitSync = original; };
  });
  const heldStart = await snapshot();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2 + 30, y: stick.y + stick.height / 2, id: 1 }] });
  await page.waitForTimeout(180);
  const held = await snapshot();
  assert.ok(Math.hypot(held.player.x - heldStart.player.x, held.player.z - heldStart.player.z) > .1, 'Input/simulation stay responsive while GPU is busy');
  assert.ok(held.timings.presentation.submitted - heldStart.timings.presentation.submitted <= 2, 'No backlog of stale frames');
  assert.equal(held.timings.presentation.pending, 2);
  assert.ok(held.timings.presentation.skipped > heldStart.timings.presentation.skipped);
  await page.evaluate(() => (window as any).__releaseGpu());
  await page.waitForTimeout(1000);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const recovered = await snapshot();
  assert.ok(recovered.timings.presentation.completed > held.timings.presentation.completed);
  assert.ok(recovered.timings.presentation.resolutionScale < natural.timings.presentation.resolutionScale, 'Delayed GPU completion reduces pixel work');
  assert.ok(Math.hypot(recovered.player.x - recovered.drawn[0], recovered.player.z - recovered.drawn[2]) < .05, 'Renderer resumes with the latest player pose');
  assert.ok(recovered.timings.presentation.pendingMs < 100, 'No persistent presentation backlog after recovery');
  assert.equal(recovered.timings.presentation.limit, 2, 'Healthy graphics must recover normal pipelining');
  await page.screenshot({ path: path.join(out, 'recovered.png'), timeout: 5000 });
  assert.deepEqual(errors, []); assert.deepEqual(recovered.errors, []);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ before, natural, heldStart, held, recovered, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, normal: natural.timings.presentation, held: held.timings.presentation, recovered: recovered.timings.presentation }));
} finally { await browser.close(); await server.close(); clear(); }
