import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import type { WildernessEffectsState } from '../game/src/render/wildernessEffects.js';

const urlIndex = process.argv.indexOf('--url');
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
const out = 'test-results/wilderness-effects-lab';
await mkdir(out, { recursive: true });
const server = url ? { url, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: unknown[] = [];
try {
  await driver.launch();
  await driver.open(60000, '/index.html?mode=combat&atmosphere=1&wildernessEffects=1');
  const page = driver.page!;
  await page.waitForFunction(() => (window as any).__wildernessEffects?.getState().ready, null, { timeout: 8000 });
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.waitForFunction(() => (window.__gameDebug as any).getBiomeAtmosphere().sky.night > .98,
    null, { timeout: 8000 });
  await page.evaluate(() => {
    const debug = window.__gameDebug as any;
    debug.inspectPose({ x: -2, y: 1, z: -5, yaw: .4, pitch: .48, distance: 31, detached: true });
  });
  await page.waitForTimeout(250);
  const first: WildernessEffectsState = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  assert.equal(first.channels, 1);
  assert.equal(first.torches, 8);
  assert.equal(first.lightBudget, 6);
  assert(first.liveParticles > 20 && first.crustPlates > 6 && first.bankRocks > 20);
  assert(first.texturedStoneMeshes >= 3, 'The banks, plates and basalt must use production stone PBR maps');
  assert(first.lights.some(light => light.kind === 'torch' && light.intensity > 0));
  assert(first.lights.some(light => light.kind === 'lava' && light.intensity > 0));
  await page.screenshot({ path: `${out}/lava-and-torches.png` });
  await page.waitForTimeout(700);
  const after: WildernessEffectsState = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  assert(after.seconds > first.seconds);
  assert(after.lights.some((light, i) => light.intensity !== first.lights[i]!.intensity));
  evidence.push({ first, after });
  await page.screenshot({ path: `${out}/lava-flow-later.png` });
  await page.evaluate(() => (window.__gameDebug as any).inspectPose({
    x: -12, y: 1.5, z: 2, yaw: .62, pitch: .23, distance: 7.5, detached: true,
  }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/brazier-light.png` });
  await page.evaluate(() => (window as any).__wildernessEffects.setLightingEnabled(false));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/brazier-lights-only-disabled.png` });
  const unlit = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  assert.equal(unlit.enabled, true);
  assert.equal(unlit.lightingEnabled, false);
  assert(unlit.liveParticles > 0 && unlit.lights.every((light: { intensity: number }) => light.intensity === 0));
  evidence.push({ unlit });
  await page.evaluate(() => (window as any).__wildernessEffects.setLightingEnabled(true));
  await page.evaluate(() => {
    window.__featureLab!.setWalkingEnabled(true);
    (window.__gameDebug as any).inspectPose({ x: 28, y: 0, z: 16, yaw: 0, pitch: .3, distance: 12 });
  });
  const beforeWalk = await page.evaluate(() => window.__featureLab!.getState().playerPosition);
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.keyboard.up('w');
  const afterWalk = await page.evaluate(() => window.__featureLab!.getState().playerPosition);
  assert(Math.hypot(afterWalk[0] - beforeWalk[0], afterWalk[2] - beforeWalk[2]) > 4,
    'The player must walk on the dry side of the channel');
  evidence.push({ beforeWalk, afterWalk, walkingLights: await page.evaluate(() => (window as any).__wildernessEffects.getState()) });
  await page.screenshot({ path: `${out}/dry-bank-walk.png` });
  await page.evaluate(() => (window as any).__wildernessEffects.setEnabled(false));
  const disabled = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  assert.equal(disabled.enabled, false);
  assert(disabled.lights.every((light: { intensity: number }) => light.intensity === 0));
  evidence.push({ disabled });
  await page.evaluate(() => (window as any).__wildernessEffects.setEnabled(true));
  const errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  console.log('Wilderness lava, torch animation, capped lighting and dry-bank walking passed.');
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2));
  await driver.close();
  await server.close();
}
