import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';
import { waitForDebug } from "./lib/wait-for-debug.js";

const selected = process.argv[2] ?? 'cairn';
assert(['cairn', 'far', 'castle'].includes(selected));
const out = `test-results/failure-repair-world/${selected}`;
await mkdir(out, { recursive: true });
const deadline = installTestDeadline('Failure repair world proof', 120_000);
const driver = new GameDriver({ url: 'http://127.0.0.1:4316', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const report: any = { passed: false, selected };
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript('globalThis.__name = (fn) => fn;');
  await driver.open(75_000, '/index.html?startup-cache=0');
  if (selected === 'cairn') {
    const fish = await page.evaluate(async () => {
      const d = window.__gameDebug as any;
      const row = (await d.getEntities()).find((entity: any) => entity.id.startsWith('cairn_tarn_spots_'));
      return d.getEntity(row.id);
    });
    assert(fish.interactionPosition);
    report.fishBefore = fish;
    await page.evaluate(async (fish: any) => {
      const d = window.__gameDebug as any;
      await d.setSkillLevel('fishing', 99); await d.giveItem('willow_rod', 1, 'inventory');
      const [x, y, z] = fish.interactionPosition;
      await d.teleport([x, y, z]);
      await d.inspectPose({ x, y, z, yaw: Math.atan2(x - fish.position[0], z - fish.position[2]), pitch: .42, distance: 11, detached: false });
    }, fish);
    report.started = await driver.callDebug('callTool', ['corealm_interact', { entityId: fish.id, interaction: 'fish' }]);
    await waitForDebug(page, async ({ id, remaining }) => (await (window.__gameDebug as any).getEntity(id)).resource.remaining < remaining,
      { id: fish.id, remaining: fish.resource.remaining }, { timeout: 25_000 });
    report.fishAfter = await driver.callDebug('getEntity', [fish.id]);
    assert(report.fishAfter.resource.remaining < fish.resource.remaining);
  } else {
    const points = selected === 'far' ? [[269.7997, -83.8045], [268.1532, -102.7745]] : [[512.5559, -107.9468], [534.2856, -109.6403]];
    report.route = await page.evaluate(async (points: number[][]) => {
      const d = window.__gameDebug as any;
      const route = points.map(([x, z]) => [x, d.sampleWorld(x, z).height, z]);
      const [x, y, z] = route[0]!; await d.teleport(route[0]);
      await d.inspectPose({ x, y, z, yaw: Math.atan2(x - route[1]![0], z - route[1]![2]), pitch: .42, distance: 11, detached: false });
      return route;
    }, points);
    report.before = await driver.callDebug('getPlayerPosition');
    report.navigation = await driver.callDebug('callTool', ['corealm_navigate', { position: report.route[1], timeoutMs: 20_000 }]);
    report.after = await driver.callDebug('getPlayerPosition');
    assert(Math.hypot(report.after.x - report.route[1][0], report.after.z - report.route[1][2]) < 2, 'Did not reach repaired route endpoint');
    assert(Math.hypot(report.after.x - report.before.x, report.after.z - report.before.z) > 5, 'No real traversal');
  }
  await page.waitForTimeout(1500);
  report.state = await page.evaluate(() => {
    const d = window.__gameDebug as any, player = d.getPlayerPosition();
    return { player, camera: d.getCamera(), surface: d.sampleWorld(player.x, player.z), activity: d.getCurrentActivity() };
  });
  assert.equal(report.state.camera.freeMove, false);
  assert.equal(report.state.camera.requestedDistance, 11);
  assert.equal(report.state.surface.waterBodyId, null);
  assert(Math.abs(report.state.camera.target.y - report.state.player.y - 1.1) < .4);
  await driver.screenshot(out, selected);
  await driver.press('s', 100);
  if (selected === 'cairn') {
    await page.evaluate(async () => {
      const d = window.__gameDebug as any, x = 225, z = -63, y = d.sampleWorld(x, z).height;
      await d.teleport([x, y, z]);
      await d.inspectPose({ x, y, z, yaw: .65, pitch: .42, distance: 11, detached: false });
    });
    await page.waitForTimeout(1500);
    await driver.screenshot(out, 'cairn-bank');
  }
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close(); deadline();
}
console.log(JSON.stringify({ passed: true, selected, out }));
