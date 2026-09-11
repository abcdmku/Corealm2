import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { CAMERA } from '../game/src/app/config.js';
import { DEEP_WILDERNESS_LAVA_LAB_CHANNELS, isMoltenLavaAt } from '../game/src/content/wildernessLava.js';
import type { WildernessEffectsState } from '../game/src/render/wildernessEffects.js';

const urlIndex = process.argv.indexOf('--url');
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : undefined;
const out = 'test-results/deep-wilderness-lava-lab';
const budgetMs = 60_000;
const started = Date.now();
await mkdir(out, { recursive: true });
const server = url ? { url, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: unknown[] = [];
let passed = false, failure: string | undefined;
const watchdog = setTimeout(() => { void driver.close().catch(() => {}); }, budgetMs);
watchdog.unref();
type Position = { x: number; y: number; z: number };

try {
  await driver.launch();
  await driver.open(40_000, '/index.html?mode=combat&atmosphere=1&wildernessEffects=deep');
  const page = driver.page!;
  page.setDefaultTimeout(8000);
  await page.waitForFunction(() => (window as any).__wildernessEffects?.getState().pools === 2);
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.waitForFunction(() => (window.__gameDebug as any).getBiomeAtmosphere().sky.night > .98);
  await page.evaluate(() => window.__featureLab!.setWalkingEnabled(true));
  const pose = async (x: number, z: number, yaw = 0, pitch = .62): Promise<void> => {
    assert(pitch >= CAMERA.minPitch && pitch <= CAMERA.maxPitch);
    await page.evaluate(({ x, z, yaw, pitch, distance }) => {
      const debug = window.__gameDebug as any;
      debug.inspectPose({ x, y: debug.groundHeight(x, z), z, yaw, pitch, distance });
    }, { x, z, yaw, pitch, distance: CAMERA.maxDistance });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => {
      const shaders = (window as any).__renderDistanceLab?.shaders();
      return !shaders || !shaders.waiting && !shaders.queued && !shaders.compiling;
    });
  };
  const readState = async (): Promise<WildernessEffectsState> =>
    page.evaluate(() => (window as any).__wildernessEffects.getState());
  const capture = async (name: string): Promise<void> => {
    const camera = await driver.callDebug('getCamera') as { requestedDistance: number; freeMove: boolean };
    assert(camera.requestedDistance >= CAMERA.minDistance && camera.requestedDistance <= CAMERA.maxDistance);
    assert.equal(camera.freeMove, false, 'Acceptance keeps the normal player-follow camera');
    evidence.push({ name, effects: await readState(), player: await driver.callDebug('getPlayerPosition'),
      camera, render: await driver.callDebug('getRenderProfile', ['wilderness-lava-']) });
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 5000 });
  };

  await pose(-2, -3, 0, .68);
  const first = await readState();
  assert.equal(first.channels, 4);
  assert.equal(first.pools, 2);
  assert.deepEqual(first.paletteRange, [0, 1]);
  assert.equal(first.lightBudget, 6);
  assert(first.liveParticles > 20 && first.moltenTriangles > 500);
  assert(first.dryApronTriangles > 0, 'The dry cinder apron must close the bank and end-cap gaps');
  assert(first.texturedStoneMeshes >= 16);
  await capture('warm-fork');
  await page.waitForTimeout(650);
  const later = await readState();
  assert(later.seconds > first.seconds);
  assert(later.lights.some((light, i) => light.intensity !== first.lights[i]!.intensity));
  await capture('warm-fork-later');
  await pose(-7, -17, .12, .7);
  await capture('rounded-cinder-basin');
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('deep_wilderness');
  await page.waitForFunction(() => (window.__gameDebug as any).getBiomeAtmosphere().wildernessMagic === 1);
  await page.waitForTimeout(1000);
  await pose(23, -19, 0, .7);
  await capture('nightglass-pool-and-ward');

  await pose(36, 5);
  const beforeDry = await driver.callDebug('getPlayerPosition') as Position;
  await driver.press('w', 1700);
  const afterDry = await driver.callDebug('getPlayerPosition') as Position;
  const dryDistance = Math.hypot(afterDry.x - beforeDry.x, afterDry.z - beforeDry.z);
  assert(dryDistance > 4, 'Real movement must traverse the dry bank');

  await pose(1, -3);
  const beforeBlocked = await driver.callDebug('getPlayerPosition') as Position;
  await driver.press('w', 1700);
  const afterBlocked = await driver.callDebug('getPlayerPosition') as Position;
  const blockedDistance = Math.hypot(afterBlocked.x - beforeBlocked.x, afterBlocked.z - beforeBlocked.z);
  assert(blockedDistance < dryDistance - 1, 'The same held movement must stop at molten ground');
  assert(!isMoltenLavaAt(afterBlocked.x, afterBlocked.z, DEEP_WILDERNESS_LAVA_LAB_CHANNELS),
    'The player may walk on the dry bank but cannot enter the molten union');
  evidence.push({ beforeDry, afterDry, dryDistance, beforeBlocked, afterBlocked, blockedDistance });
  await capture('fork-collision-stop');

  assert.deepEqual(await driver.callDebug('getErrors'), []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert(Date.now() - started < budgetMs, 'Lava fixture exceeded its 60-second budget');
  passed = true;
  console.log(`Deep Wilderness lava lab passed in ${Date.now() - started}ms. Images require root acceptance.`);
} catch (cause) {
  failure = cause instanceof Error ? cause.stack : String(cause);
  throw cause;
} finally {
  clearTimeout(watchdog);
  await driver.close();
  await server.close();
  await writeFile(`${out}/report.json`, JSON.stringify({ passed, failure, elapsedMs: Date.now() - started,
    budgetMs, evidence, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors }, null, 2));
}
