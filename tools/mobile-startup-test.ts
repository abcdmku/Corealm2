/** Empty-profile startup budget and real input proof. Build before running. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { gameRoot } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => args[args.indexOf(key) + 1] && args.includes(key) ? args[args.indexOf(key) + 1]! : fallback;
const desktop = args.includes('--desktop');
const label = value('--label', desktop ? 'desktop' : 'mobile');
const mbps = Number(value('--mbps', '20'));
const cpu = Number(value('--cpu', desktop ? '1' : '2'));
const diagnostic = args.includes('--diagnostic');
const out = path.resolve(`test-results/${desktop ? 'desktop' : 'mobile'}-startup`, label);
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline('Startup', 115_000);
const server = await preview({ root: gameRoot, preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('No preview address');
const browser = await chromium.launch({ headless: true, args: [
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio',
] });
const errors: string[] = [];
try {
  const context = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 844, height: 390 },
    deviceScaleFactor: desktop ? 1 : 2, isMobile: !desktop, hasTouch: !desktop, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: mbps ? 80 : 0,
    downloadThroughput: mbps ? mbps * 1e6 / 8 : -1, uploadThroughput: mbps ? 1e6 / 8 : -1 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (args.includes('--profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  if (args.includes('--shaders')) await page.addInitScript(() => {
    const logs: unknown[] = []; (window as any).__shaderDiagnostics = logs;
    const source = new WeakMap<WebGLShader,string>();
    const prototype = WebGL2RenderingContext.prototype;
    const shaderSource = prototype.shaderSource, info = prototype.getProgramInfoLog;
    prototype.shaderSource = function(shader,text) { source.set(shader,text); shaderSource.call(this,shader,text); };
    prototype.getProgramInfoLog = function(program) {
      const start = performance.now(), result = info.call(this,program);
      logs.push({at:start,ms:performance.now()-start, shaders:this.getAttachedShaders(program)?.map(shader=>
        source.get(shader)?.split('\n').filter(line=>line.startsWith('#define')).slice(0,18).join('\n'))});
      return result;
    };
  });
  await page.addInitScript({ content: `(() => {
    performance.setResourceTimingBufferSize(4000);
    window.__loadFeedback = []; window.__loadTasks = []; window.__loadFrames = [];
    const frame = at => { window.__loadFrames.push(at); if(window.__loadFrames.length > 3000)window.__loadFrames.shift(); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__loadTasks.push({at:e.startTime,ms:e.duration}); }).observe({type:'longtask',buffered:true});
    let last = '';
    setInterval(() => { const text = document.getElementById('boot-screen')?.innerText ?? ''; if (text !== last) { window.__loadFeedback.push({at:performance.now(),text}); last=text; } }, 200);
  })();` });
  const route = value('--route', '/');
  await page.goto(`http://127.0.0.1:${address.port}${route}`, { waitUntil: 'commit' });
  await page.locator('#boot-screen').waitFor({state:'visible',timeout:15_000});
  const capture = page.locator('.boot-status').waitFor({ timeout: 15_000 }).then(async () => {
    await page.screenshot({ path: path.join(out, 'loading.png'), timeout: 5000 });
  }).catch(() => {});
  let failure: string | undefined;
  try { await page.locator('#boot-screen').waitFor({ state: 'detached', timeout: diagnostic ? 95_000 : 20_000 }); }
  catch (error) { failure = String(error); }
  await capture;
  if(!failure) await page.waitForTimeout(args.includes('--settle') ? 1500 : 1100);
  if (args.includes('--profile')) await writeFile(path.join(out,'cpu.json'),JSON.stringify((await cdp.send('Profiler.stop')).profile));
  const report = await page.evaluate(() => {
    const w = window as any;
    const boot=w.__corealmBootTelemetry?.snapshot();
    const frameTimes=w.__loadFrames.filter((at:number)=>at>=boot?.firstPlayableMs && at<boot.firstPlayableMs+1000);
    const frameGaps=frameTimes.map((at:number,index:number)=>at-(index ? frameTimes[index-1] : boot.firstPlayableMs));
    return { ready: w.__gameDebug?.getState().ready, boot: w.__corealmBootTelemetry?.snapshot(),
      firstGameplayFrames:{samples:frameTimes.length,maxMs:Math.max(0,...frameGaps)},
      feedback: w.__loadFeedback, tasks: w.__loadTasks, shaders: w.__shaderDiagnostics,
      resources: performance.getEntriesByType('resource').filter(e=>!boot?.firstPlayableMs || e.startTime+e.duration<=boot.firstPlayableMs).map(e => ({name:e.name.replace(location.origin,''),
        bytes:(e as PerformanceResourceTiming).encodedBodySize, ms:e.duration, start:e.startTime})),
      cache: w.__corealmGenerationCache?.snapshot(), assets: w.__corealmPlayerAssets?.snapshot(),
      gameErrors: w.__gameDebug?.getErrors?.(), views: w.__gameDebug?.getEntityViewStats?.() };
  });
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ desktop, mbps, cpu, failure, errors, ...report }, null, 2));
  if (report.ready && !failure) {
    await page.screenshot({ path: path.join(out, 'playable.png'), timeout: 5000 });
    const before = await page.evaluate(() => (window as any).__gameDebug.getPlayerPosition());
    if (desktop) {
      await page.locator('#viewport').click({position:{x:720,y:400}});
      await page.keyboard.down('w');
      await page.waitForTimeout(500);
      await page.keyboard.up('w');
    } else {
      const stick = await page.getByRole('slider', {name:'Move',exact:true}).boundingBox();
      assert.ok(stick, 'Mobile movement control must be visible');
      const touch = {x:stick.x+stick.width/2,y:stick.y+stick.height/2-30,id:1};
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
      await page.waitForTimeout(500);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    const after = await page.evaluate(() => (window as any).__gameDebug.getPlayerPosition());
    assert.notDeepEqual(before, after, 'Real input must move the player');
    Object.assign(report, { before, after });
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ desktop, mbps, cpu, failure, errors, ...report }, null, 2));
  console.log(JSON.stringify({ label, desktop, mbps, cpu, ready: report.ready, playableMs: report.boot?.firstPlayableMs,
    totalMB: report.resources.reduce((n, r) => n + r.bytes, 0) / 1e6,
    slowSpans: report.boot?.spans.filter((s: any) => s.durationMs > 500 && !/gltf|cacheRead|cacheWrite/.test(s.name)).map((s: any) => ({name:s.name,ms:s.durationMs})),
    largest: [...report.resources].sort((a,b) => b.bytes-a.bytes).slice(0,15), errors, failure }, null, 2));
  if (!diagnostic) {
    assert.equal(failure, undefined); assert.equal(report.ready, true);
    assert.ok(report.boot.firstPlayableMs < 20_000, 'First playable must be under 20 seconds');
    assert.ok(report.firstGameplayFrames.samples>0 && report.firstGameplayFrames.maxMs<500,
      'Revealed gameplay must not freeze while the GPU finishes startup');
    assert.ok(report.feedback.length >= 4, 'Loading feedback must keep updating during startup');
    assert.ok(report.feedback.some((entry: any) => /MB received/.test(entry.text) && /s elapsed/.test(entry.text)),
      'Loading feedback must report actual downloaded bytes and elapsed time');
    assert.deepEqual(errors, []); assert.deepEqual(report.gameErrors, []);
    assert.deepEqual(report.cache.generated, [], 'No runtime world generation');
    assert.equal(report.views.residency.pending, 0); assert.equal(report.views.residency.failed, 0);
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  clearDeadline();
}
