/** Slice production animation preparation while real touch input keeps moving in the lab. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const clear = installTestDeadline('Animation preparation lab', 60_000);
const out = 'test-results/animation-preparation';
await mkdir(out, { recursive: true });
const server = await startGameServer();
const browser = await chromium.launch({ headless: true, args: [
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/assets/**', async route => {
    const file = path.resolve('game/dist', new URL(route.request().url()).pathname.slice(1));
    if (!file.startsWith(path.resolve('game/dist') + path.sep)) throw Error('Asset path outside release');
    try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); }
    catch { await route.continue(); }
  });
  await page.addInitScript({ content: 'window.__name=v=>v;' });
  await page.goto(`${server.url}/?mode=combat&performance=1&sampledActors=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready, undefined, { timeout: 35000 });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
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
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
  const stick = await page.getByRole('slider', { name: 'Move', exact: true }).boundingBox(); assert.ok(stick);
  const target = await page.evaluate(async () => {
    const w = window as any;
    await w.__featureLab.spawnTarget('creature', 'source:redsill_cattle', { distance: 4 });
    return w.__featureLab.getState().target.entityId;
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stick.x + stick.width / 2 + 30, y: stick.y + stick.height / 2, id: 1 }] });
  await page.waitForFunction(() => (window as any).__slices.some((s: any) => s.ready), undefined, { timeout: 15000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  const result = await page.evaluate(id => {
    const w = window as any, d = w.__gameDebug;
    return { slices: w.__slices, motion: d.getEntityMotion(id), bounds: d.getDrawnBounds(id), errors: d.getErrors() };
  }, target);
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.ok(result.slices.length > 3, 'Imported animation must span multiple preparation slices');
  assert.ok(result.slices.every((s: any) => s.budget === 2 && s.ms < 50), 'No full-library bake inside one input frame');
  const first = result.slices[0], last = result.slices.at(-1);
  assert.ok(Math.hypot(last.position.x - first.position.x, last.position.z - first.position.z) > .02, 'Real movement progresses between preparation slices');
  assert.equal(result.motion.path, 'sampled-rig'); assert.ok(result.bounds);
  assert.deepEqual(errors, []); assert.deepEqual(result.errors, []);
  await page.screenshot({ path: path.join(out, 'prepared.png'), timeout: 5000 });
  console.log(JSON.stringify({ passed: true, slices: result.slices.length, maxSliceMs: Math.max(...result.slices.map((s: any) => s.ms)), motion: result.motion.path }));
} finally { await browser.close(); await server.close(); clear(); }
