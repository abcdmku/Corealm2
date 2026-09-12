import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const deadline = installTestDeadline('Player asset lab', 59_000);
const out = 'test-results/smart-loading-lab';
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, { headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  await driver.launch();
  const page = driver.page!;
  await driver.open(45_000, '/?mode=combat&smartLoading=1');
  const before = await page.evaluate(() => (window as any).__smartLoadingLab.snapshot());
  assert.deepEqual(before.sites.resident, ['near']);
  assert.ok(!before.loaded.includes('barrel_apples'));
  assert.ok(!before.loaded.includes('barrel_rack'));
  assert.ok(!before.loaded.includes('roof_wood_plank'));
  assert.equal(before.cameraRoots.length, 1);
  assert.equal(before.views.pending, 0);
  const inventory = await page.evaluate(async () => {
    const state = JSON.parse((window.__gameDebug as any).getSaveBlob());
    state.inventory.slots = [{ itemId: 'worn_hatchet', quantity: 1 }];
    state.equipment = {};
    state.bank.slots = [{ itemId: 'kaldite_pickaxe', quantity: 1 }];
    return (window as any).__smartLoadingLab.prepareInventory(state.inventory, state.equipment);
  });
  assert.deepEqual(inventory.items, ['worn_hatchet']);
  assert.deepEqual(inventory.itemAssets, ['corealm_item_worn_hatchet']);
  assert.ok(!inventory.loaded.includes('corealm_item_kaldite_pickaxe'));
  await page.evaluate(() => (window.__gameDebug as any).inspectPose({ x: 4, y: 0, z: 9, yaw: 0, pitch: .5, distance: 11 }));
  await page.screenshot({ path: `${out}/near.png` });
  const ahead = await page.evaluate(() => (window as any).__smartLoadingLab.prepare(100, true));
  assert.deepEqual(ahead.sites.resident, ['far', 'near']);
  assert.deepEqual(ahead.area.position, [0, 0, 0]);
  assert.ok(ahead.loaded.includes('roof_wood_plank'));
  assert.equal(ahead.cameraRoots.length, 2);
  const next = await page.evaluate(() => (window as any).__smartLoadingLab.prepare(100));
  assert.equal(next.views.pending, 0);
  assert.deepEqual(next.sites.pending, []);
  assert.ok(!next.loaded.includes('barrel_rack'));
  await page.evaluate(() => (window.__gameDebug as any).inspectPose({ x: 100, y: 0, z: 8, yaw: 0, pitch: .5, distance: 11 }));
  await page.screenshot({ path: `${out}/destination.png` });
  await page.locator('#viewport').click({ position: { x: 720, y: 450 } });
  const position = await page.evaluate(() => window.__gameDebug!.getPlayerPosition());
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  assert.notDeepEqual(await page.evaluate(() => window.__gameDebug!.getPlayerPosition()), position);
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as any).getErrors()), []);
  assert.deepEqual(driver.pageErrors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ passed: true, before, inventory, ahead, next }, null, 2));
  console.log('Player asset lab passed: near/far/cave selection, carried tools, camera sources, prefetch and movement.');
} finally { await driver.close(); await server.close(); deadline(); }
