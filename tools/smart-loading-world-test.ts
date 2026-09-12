import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { gameRoot } from './lib/paths.js';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';

const deadline = installTestDeadline('Player asset world travel', 150_000);
const out = 'test-results/smart-loading-world';
await mkdir(out, { recursive: true });
const vite = await preview({ root: gameRoot, preview: { host: '127.0.0.1', port: 0 } });
const address = vite.httpServer.address();
if (!address || typeof address === 'string') throw new Error('No preview address');
const server = { url: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) =>
  vite.httpServer.close(error => error ? reject(error) : resolve())) };
const driver = new GameDriver(server, { headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const report: Record<string, any> = {};
try {
  await driver.launch(); const page = driver.page!;
  await driver.open(50_000);
  const snapshot = () => page.evaluate(() => {
    const d = window.__gameDebug as any;
    return { player: d.getPlayer(), assets: (window as any).__corealmPlayerAssets.snapshot(),
      views: d.getEntityViewStats().residency, camera: d.getCamera(), state: d.getState(),
      timings: d.getPerformanceTimings(), errors: d.getErrors() };
  });
  const settled = () => page.waitForFunction(() => {
    const d = window.__gameDebug as any, a = (window as any).__corealmPlayerAssets.snapshot();
    return a.sites.pending.length === 0 && a.assets.queued === 0 && a.assets.inflight === 0
      && d.getEntityViewStats().residency.pending === 0;
  }, undefined, { timeout: 30_000 });
  report.initial = await snapshot();
  const origin = report.initial.player.position;
  let moved = 0;
  for (const key of ['s', 'a', 'd', 'w']) {
    await page.keyboard.down(key); await page.waitForTimeout(3000); await page.keyboard.up(key);
    const current = (await snapshot()).player.position;
    moved = Math.hypot(current.x - origin.x, current.z - origin.z);
    if (moved >= 8.1) break;
  }
  assert.ok(moved >= 8.1, 'Normal keyboard travel must cross the residency update distance');
  await settled(); report.travel = await snapshot();
  assert.ok(report.travel.assets.sites.resident.length > report.initial.assets.sites.resident.length,
    'Travel must prepare the wider approaching area');
  assert.equal(report.travel.views.pending, 0);
  await page.screenshot({ path: `${out}/travel.png` });
  console.log('Movement and ahead-of-view loading passed');

  const tool = 'corealm_item_kaldite_pickaxe';
  assert.ok(!report.travel.assets.loadedIds.includes(tool));
  await driver.callDebug('giveItem', ['kaldite_pickaxe', 1, 'bank']);
  await page.waitForTimeout(350);
  assert.ok(!(await snapshot()).assets.loadedIds.includes(tool), 'Bank contents must not load carried models');
  await driver.callDebug('giveItem', ['kaldite_pickaxe', 1, 'inventory']);
  await page.waitForFunction(id => (window as any).__corealmPlayerAssets.snapshot().loadedIds.includes(id), tool);
  report.acquired = await snapshot();
  assert.ok(report.acquired.assets.items.includes('kaldite_pickaxe'));
  console.log('Inventory acquisition and bank exclusion passed');

  for (const id of ['gravelmaw_mouth_portal', 'gravelmaw_exit_portal']) {
    await page.evaluate(portalId => {
      const d = window.__gameDebug as any, portal = d.getEntity(portalId);
      d.teleport(portal.interactionPosition ?? portal.position);
    }, id);
    await settled();
    report[`${id}-approach`] = await snapshot();
    const beforeRegion = report[`${id}-approach`].player.regionId;
    const result = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'enter' }]);
    report[`${id}-action`] = result;
    await page.waitForFunction(region => (window.__gameDebug as any).getPlayer().regionId !== region
      && !document.querySelector('.portal-transition'), beforeRegion, { timeout: 35_000 });
    await settled();
    const next = await snapshot(); report[id] = next;
    assert.equal(next.views.pending, 0);
    assert.deepEqual(next.assets.sites.pending, []);
    assert.deepEqual(next.errors, []);
    assert.equal(next.camera.freeMove, false);
    assert.ok(next.camera.requestedDistance <= 11);
    if (id === 'gravelmaw_exit_portal') {
      // Walk out and turn using ordinary input; do not lift or detach the inspection camera.
      await page.mouse.move(720, 450); await page.mouse.down({ button: 'right' });
      await page.mouse.move(720 - Math.PI / .006, 450, { steps: 12 }); await page.mouse.up({ button: 'right' });
      await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
      await settled();
    }
    await page.screenshot({ path: `${out}/${id}.png` });
    console.log(`${id} destination complete before reveal`);
  }
  assert.deepEqual(driver.pageErrors, []);
  report.passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close(); await server.close(); deadline();
}
