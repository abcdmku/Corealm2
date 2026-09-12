/** Disposable browser evidence for startup CPU / driver stalls in the built game. */
import { chromium, type Browser } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gameRoot } from './lib/paths.js';

const out = path.resolve('test-results/startup-profile');
await mkdir(out, { recursive: true });
const server = await preview({ root: gameRoot, preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('No preview address');
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true, args: [
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.start');
  await page.addInitScript(() => {
    const profile = { calls: [] as any[], programs: [] as any[], tasks: [] as any[] };
    (window as any).__startupProfile = profile;
    const ids = new Map<WebGLProgram, any>(), shaders = new Map<WebGLShader, string>();
    new PerformanceObserver(list => { for (const entry of list.getEntries()) profile.tasks.push({ at: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
    const proto = WebGL2RenderingContext.prototype as any;
    for (const name of ['createProgram', 'shaderSource', 'attachShader', 'compileShader', 'linkProgram', 'getProgramParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getActiveUniform', 'getUniformLocation', 'getAttribLocation', 'getActiveAttrib', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'bufferData', 'texImage2D', 'texSubImage2D', 'getError', 'checkFramebufferStatus', 'copyTexSubImage2D', 'blitFramebuffer', 'useProgram']) {
      const original = proto[name];
      proto[name] = function(...args: any[]) {
        const at = performance.now(), result = original.apply(this, args), duration = performance.now() - at;
        if (name === 'createProgram') { const p = { id: ids.size, at, sources: [] as string[], calls: {} as any }; ids.set(result, p); profile.programs.push(p); }
        if (name === 'shaderSource') shaders.set(args[0], args[1]);
        if (name === 'attachShader') ids.get(args[0])?.sources.push(shaders.get(args[1]) ?? '');
        const program = ids.get(args[0]);
        if (name === 'linkProgram' && program) program.linkAt = at;
        if (program) { const call = program.calls[name] ??= { count: 0, ms: 0, max: 0, first: at }; call.count++; call.ms += duration; call.max = Math.max(call.max, duration); }
        if (duration > 2) profile.calls.push({ name, at, duration, program: program?.id });
        return result;
      };
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#boot-screen').waitFor({ state: 'detached', timeout: 60_000 });
  await page.waitForTimeout(1000);
  const cpu = await session.send('Profiler.stop');
  await writeFile(path.join(out, 'cpu.json'), JSON.stringify(cpu.profile));
  const result = await page.evaluate(() => ({ ...(window as any).__startupProfile, boot: (window as any).__corealmBootTelemetry.snapshot() }));
  await writeFile(path.join(out, 'profile.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ playableMs: result.boot.firstPlayableMs, programs: result.programs.length,
    slowCalls: result.calls.sort((a: any, b: any) => b.duration - a.duration).slice(0, 25), tasks: result.tasks.filter((t: any) => t.duration > 200) }, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
