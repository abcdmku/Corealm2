import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { gameRoot } from './lib/paths.js';

const manifest = JSON.parse(await readFile(path.join(gameRoot, 'dist/generated/world/manifest.json'), 'utf8'));
const server = await preview({ root: gameRoot, preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Preview needs a port');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  for (const key of ['terrain/world', 'scatter/-2:-2', 'navigation']) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      let blocked = 0;
      page.on('pageerror', error => errors.push(String(error)));
      const file = key === 'navigation' ? 'corealm-navmesh.bin' : manifest.records[key].file;
      await page.route(`**/${file}`, route => { blocked++; return route.fulfill({ status: 503, body: 'Simulated unavailable world file' }); });
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded' });
      try { await page.locator('.boot-error').waitFor({ timeout: 30_000 }); }
      catch (error) {
        await mkdir('test-results/release-world-failure', { recursive: true });
        await writeFile('test-results/release-world-failure/timeout.json', JSON.stringify({ key, file, blocked, errors,
          state: await page.evaluate(() => ({ text: document.body.innerText,
            boot: (window as any).__corealmBootTelemetry?.snapshot() })) }, null, 2));
        throw error;
      }
      assert.equal(blocked, 1, 'The requested released world record must actually be blocked');
      assert.equal(await page.locator('#boot-screen').isVisible(), true);
      const state = await page.evaluate(() => ({
        cache: (window as any).__corealmGenerationCache.snapshot(),
        boot: (window as any).__corealmBootTelemetry.snapshot(),
      }));
      assert.deepEqual(state.cache.generated, []);
      assert.equal(state.boot.firstPlayableMs, null);
      assert.match(await page.locator('.boot-error').innerText(), key === 'navigation' ? /released navigation/ : /World file/);
      console.log(`Release remained covered without generation after unavailable ${key}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
