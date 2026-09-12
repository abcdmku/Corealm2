import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver, FAST_TEST_SETTINGS } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const world = process.argv.includes('--world');
const done = installTestDeadline('mob spawn spacing', world ? 120_000 : 60_000);
const server = await startGameServer({ hmr: false });
const driver = new GameDriver(server, { settings: FAST_TEST_SETTINGS, viewport: { width: 1280, height: 800 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const out = `test-results/mob-spawn-spacing/${world ? 'world' : 'lab'}`;
await mkdir(out, { recursive: true });
try {
  await driver.launch();
  await driver.page!.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await Promise.race([
    driver.open(world ? 80_000 : 40_000, world ? '/' : '/?mode=combat&spawnSpacing=1'),
    new Promise<never>((_, reject) => driver.page!.on('console', message => {
      if (message.type() === 'error' && message.text().includes('Corealm failed to boot')) reject(new Error(message.text()));
    })),
  ]);
  const page = driver.page!;
  const before = await driver.snapshot();
  const actors = await page.evaluate(() => (window.__gameDebug!.getEntities() as any[])
    .filter(e => e.archetype === 'enemy' || e.archetype === 'boss')
    .map(e => (window.__gameDebug as any).getEntity(e.id)));
  assert(actors.length >= 21, 'production mob fixture loaded');
  const violations: string[] = [];
  for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
    const a = actors[i], b = actors[j];
    if ((a.regionId === 'gravelmaw') !== (b.regionId === 'gravelmaw')) continue;
    if (a.archetype === 'boss' && b.archetype === 'boss') continue;
    const distance = Math.hypot(a.meta.spawnX - b.meta.spawnX, a.meta.spawnZ - b.meta.spawnZ);
    const cave = a.regionId === 'gravelmaw';
    const minimum = Math.max(cave ? 5 : 10, (a.combat?.bodyRadius ?? .5) + (b.combat?.bodyRadius ?? .5) + (cave ? 3.5 : 6));
    if (!Number.isFinite(distance) || distance < minimum - 1e-5) violations.push(`${a.id}/${b.id}: ${distance} < ${minimum}`);
  }
  assert.deepEqual(violations, []);
  if (!world) await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.locator('#viewport').click({ position: { x: 640, y: 500 } });
  await page.keyboard.down('w'); await page.waitForTimeout(750); await page.keyboard.up('w');
  const after = await driver.snapshot();
  assert.notDeepEqual(after.playerPosition, before.playerPosition, 'real movement changes semantic position');
  let passage: unknown = null;
  if (!world) {
    const cows = actors.filter(e => e.meta?.groupId === 'spawn-spacing:redsill_cattle');
    const a = cows[0], b = cows[1];
    assert(a && b);
    const dx = b.position[0] - a.position[0], dz = b.position[2] - a.position[2];
    const length = Math.hypot(dx, dz), nx = -dz / length, nz = dx / length;
    const mx = (a.position[0] + b.position[0]) / 2, mz = (a.position[2] + b.position[2]) / 2;
    await page.evaluate(() => window.__featureLab!.setWalkingEnabled(true));
    await driver.callDebug('inspectPose', [{ x: mx - nx * 3, y: 0, z: mz - nz * 3,
      yaw: Math.atan2(-nx, -nz), pitch: .52, distance: 11 }]);
    await page.waitForTimeout(250);
    const start = await driver.callDebug('getPlayerPosition') as { x: number; z: number };
    await page.keyboard.down('w');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/running-between.png` });
    await page.waitForTimeout(800);
    await page.keyboard.up('w');
    const end = await driver.callDebug('getPlayerPosition') as { x: number; z: number };
    assert((start.x - mx) * nx + (start.z - mz) * nz < -2, 'starts before the gap');
    assert((end.x - mx) * nx + (end.z - mz) * nz > .5, 'W runs through the gap between residents');
    passage = { actors: [a.id, b.id], start, end, midpoint: [mx, mz] };
  }
  if (world) {
    const cow = actors.find(e => e.meta?.groupId === 'redsill_cattle');
    assert(cow);
    await driver.callDebug('teleport', [[cow.position[0], cow.position[1], cow.position[2] + 8]]);
    await page.waitForTimeout(500);
  }
  {
    await page.mouse.move(300, 350); await page.mouse.down({ button: 'right' });
    await page.mouse.move(1000, 350, { steps: 24 }); await page.mouse.up({ button: 'right' });
    await page.mouse.wheel(0, 900); await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${out}/spacing.png` });
  if (world) {
    await driver.callDebug('reset');
    await page.waitForTimeout(750);
    const reset = await page.evaluate(() => (window.__gameDebug as any).listEntities({ archetype: 'enemy' }));
    const original = new Map(actors.map(e => [e.id, e]));
    for (const entity of reset) {
      const source = original.get(entity.id)!;
      assert.equal(entity.meta.spawnX, source.meta.spawnX, `stable reset X: ${entity.id}`);
      assert.equal(entity.meta.spawnZ, source.meta.spawnZ, `stable reset Z: ${entity.id}`);
    }
    assert.equal(reset.length, actors.filter(e => e.archetype === 'enemy').length);
  }
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ passed: true, actors, before, after, passage }, null, 2));
  console.log(JSON.stringify({ passed: true, world, actors: actors.length }));
} catch (error) {
  await driver.page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.error(driver.pageErrors, driver.consoleErrors);
  throw error;
} finally { await driver.close(); await server.close(); done(); }
