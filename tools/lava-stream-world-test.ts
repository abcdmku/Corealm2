/** World-only placement proof after the production deep lava lab has passed. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { WILDERNESS_LAVA_CHANNELS, lavaSections, isMoltenLavaAt } from '../game/src/content/wildernessLava.js';
import { CAMERA } from '../game/src/app/config.js';

const out = 'test-results/lava-stream-world';
await mkdir(out, { recursive: true });
const started = Date.now();
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: unknown[] = [];
const watchdog = setTimeout(() => { void driver.close(); }, 120_000);
let passed = false;
try {
  await driver.launch();
  await driver.open(60_000, '/index.html');
  const page = driver.page!;
  await driver.callDebug('setSkillLevel', ['melee', 99]);
  await driver.callDebug('setSkillLevel', ['magic', 99]);
  for (const itemId of ['nightglass_helm', 'nightmarshal_plate', 'nightglass_greaves', 'nightglass_boots', 'nightglass_gauntlets']) {
    await driver.callDebug('giveItem', [itemId, 1, 'inventory']);
    await driver.callDebug('callTool', ['corealm_equip', { itemId }]);
  }
  await driver.callDebug('setHealth', [317]);
  for (const id of ['widows-furnace', 'veilburn-river', 'hollow-star-rift']) {
    const channel = WILDERNESS_LAVA_CHANNELS.find(row => row.id === id)!;
    const section = lavaSections(channel).reduce((best, row) =>
      Math.abs(row.progress - .5) < Math.abs(best.progress - .5) ? row : best);
    const offset = section.halfWidth + channel.bankWidth * .7;
    const x = section.x + section.tz * offset, z = section.z - section.tx * offset;
    const y = await driver.callDebug('groundHeight', [x, z]);
    const yaw = Math.atan2(section.tz, -section.tx);
    await driver.callDebug('inspectPose', [{ x, y, z, yaw, pitch: .65, distance: CAMERA.maxDistance, detached: false }]);
    await page.waitForFunction(({ x, z }) => (window as any).__wildernessEffects.getState().bankLighting.slots
      .some((slot: { intensity: number; position: number[] }) => slot.intensity > 10
        && Math.hypot(slot.position[0]! - x, slot.position[2]! - z) < 40), { x, z }, { timeout: 6000 });
    await page.waitForFunction(() => {
      const shaders = (window as any).__renderDistanceLab?.shaders();
      return !shaders || !shaders.waiting && !shaders.queued && !shaders.compiling;
    }, null, { timeout: 20_000 });
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => ({
      effects: (window as any).__wildernessEffects.getState(),
      player: (window.__gameDebug as any).getPlayerPosition(),
      camera: (window.__gameDebug as any).getCamera(),
    }));
    assert.equal(before.effects.crustPlates, 0);
    assert(before.effects.lights.every((light: { kind: string | null }) => light.kind !== 'lava'));
    assert(before.effects.bankLighting.active > 0);
    assert.equal(before.effects.channels, WILDERNESS_LAVA_CHANNELS.length);
    assert.equal(before.camera.freeMove, false);
    assert(before.camera.requestedDistance <= CAMERA.maxDistance);
    await page.screenshot({ path: `${out}/${id}.png`, timeout: 5000 });
    await driver.press('s', 650);
    const after = await page.evaluate(() => ({
      effects: (window as any).__wildernessEffects.getState(),
      player: (window.__gameDebug as any).getPlayerPosition(),
    }));
    assert(after.effects.seconds > before.effects.seconds);
    assert(Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z) > .5);
    assert(!isMoltenLavaAt(after.player.x, after.player.z, WILDERNESS_LAVA_CHANNELS));
    evidence.push({ id, section, before, after });
  }
  assert.deepEqual(await driver.callDebug('getErrors'), []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert(Date.now() - started < 120_000);
  passed = true;
  console.log(`Lava world placement and bank movement passed in ${Date.now() - started}ms.`);
} catch (error) {
  if (driver.page) {
    const diagnostics = await driver.page.evaluate(() => ({
      effects: (window as any).__wildernessEffects?.getState(),
      shaders: (window as any).__renderDistanceLab?.shaders(),
      performance: (window.__gameDebug as any)?.getPerformanceTimings(),
      camera: (window.__gameDebug as any)?.getCamera(),
    })).catch(() => null);
    evidence.push({ failure: String(error), diagnostics });
    console.log(JSON.stringify(diagnostics));
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await writeFile(`${out}/report.json`, JSON.stringify({ passed, elapsedMs: Date.now() - started, evidence,
    errors: driver.pageErrors, consoleErrors: driver.consoleErrors }, null, 2));
  await driver.close();
  await server.close();
}
