/** Public-byte smoke for the delivered source-creature slice. No candidate interception. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { assertPerformanceHardware } from '../../../tools/performanceHardware.js';

const out = 'test-results/source-creature-slice';
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const ids = ['beetle_golem', 'mossback_sentinel', 'shale_elemental', 'lava_golem'];
const report: any = { publicAssets: true, cases: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const deadline = setTimeout(() => void browser.close(), 100_000);
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => report.errors.push(e.message));
    const asset = manifest.assets.find((a: any) => a.id === `creature_${id}`);
    assert(asset);
    const publicUrl = `/assets/${asset.file}`;
    const receipt = page.waitForResponse(r => new URL(r.url()).pathname === publicUrl);
    await page.goto(`http://127.0.0.1:4175/index.html?mode=combat&creature=${id}`);
    await page.waitForFunction(id => (window as any).__featureLab?.getState().target?.presetId === `species:${id}`, id, { timeout: 25000 });
    const response = await receipt;
    assert(response.ok());
    const servedSha = createHash('sha256').update(await response.body()).digest('hex');
    assert.equal(servedSha, asset.sha256);
    const hardware = await assertPerformanceHardware(page);
    const state = await page.evaluate(() => {
      const lab = (window as any).__featureLab.getState(), d = (window as any).__gameDebug;
      const bounds = d.getDrawnBounds(lab.target.entityId);
      if (!bounds) throw new Error('Target has no rendered bounds');
      const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
      d.inspectPose({ x: (bounds.min.x + bounds.max.x)/2, y: (bounds.min.y + bounds.max.y)/2, z: (bounds.min.z + bounds.max.z)/2, yaw: .7, pitch: .2, distance: Math.max(5, size * 2.2), detached: true });
      return { target: lab.target, bounds, motion: d.getEntityMotion(lab.target.entityId) };
    });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${id}.png` });
    report.cases.push({ id, servedSha, hardware, state });
    await page.close();
  }
  assert.equal(report.errors.length, 0);
  report.passed = true;
} catch (error) {
  report.errors.push(String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ passed: report.passed ?? false, cases: report.cases.length, errors: report.errors }));
