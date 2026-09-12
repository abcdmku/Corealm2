import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';

// The lake material is accepted in the compact fixture first. --world checks
// authored banks and the confluence, which cannot be judged in the lab terrain.
const world = process.argv.includes('--world');
const routesOnly = process.argv.includes('--routes');
const out = `test-results/river-water/${routesOnly ? 'routes' : world ? 'world' : 'lab'}`;
await mkdir(out, { recursive: true });
const server = await startGameServer({ hmr: false });
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const report: Record<string, unknown> = { passed: false, world };
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript('globalThis.__name = (fn) => fn;');
  await driver.open(300_000, world ? '/index.html?startup-cache=0' : '/index.html?mode=building&river=1&startup-cache=0');
  if (!world) {
    await page.evaluate(() => {
      window.__featureLab!.setWalkingEnabled(true);
      window.__featureLab!.setFreeCameraEnabled(false);
    });
    const close = page.locator('#panel-feature-lab .panel__close');
    if (await close.isVisible()) await close.click();
  }
  const shots = routesOnly ? [] : world
    ? [{ name: 'lake', x: 470, z: 163, yaw: Math.PI },
      { name: 'lake-outlet', x: 535, z: 220, yaw: 1.3 },
      { name: 'river-bank', x: 600, z: 190, yaw: .2 },
      { name: 'southern-meadows', x: 445, z: -110, yaw: -1.1 },
      { name: 'royal-woodland', x: 625, z: 105, yaw: 2.2 },
      { name: 'northern-ridges', x: 490, z: 370, yaw: -.7 }]
    : [{ name: 'lake-outlet', x: 8, z: -4, yaw: 1.5 }];
  const observations = [];
  for (const shot of shots) {
    await page.evaluate(shot => {
      const debug = window.__gameDebug as any;
      const y = debug.sampleWorld(shot.x, shot.z).height;
      debug.teleport([shot.x, y, shot.z]);
      debug.inspectPose({ ...shot, y, pitch: .3, distance: 11, detached: false });
    }, shot);
    if (world) await page.waitForFunction(({ x, z }) => {
      const residency = (window.__gameDebug as any).getScatterResidency();
      const col = Math.floor(x / 96), row = Math.floor(z / 96);
      return residency && residency.pending.every((id: string) => {
        const [cx, cz] = id.split(':').map(Number);
        return Math.abs(cx! - col) > 1 || Math.abs(cz! - row) > 1;
      });
    }, shot, { timeout: 180_000 });
    await page.waitForFunction(() => {
      const shaders = (window as any).__renderDistanceLab?.shaders?.();
      return !shaders || shaders.waiting === 0 && shaders.queued === 0 && !shaders.compiling;
    }, undefined, { timeout: 120_000 });
    await page.waitForTimeout(500);
    const snapshot = () => page.evaluate(() => {
      const d = window.__gameDebug as any, player = d.getPlayerPosition();
      return { player, camera: d.getCamera(), navigation: d.getNavigationState(),
        sample: d.sampleWorld(player.x, player.z), scatter: d.getScatterResidency() };
    });
    const before = await snapshot();
    assert.equal(before.sample.waterBodyId, null, `${shot.name}: camera setup must stand on dry ground`);
    assert.equal(before.camera.freeMove, false);
    assert.equal(before.camera.requestedDistance, 11);
    assert(Math.hypot(before.camera.target.x - before.player.x, before.camera.target.z - before.player.z) < .15);
    for (let frame = 0; frame < 3; frame++) {
      await driver.screenshot(out, `${shot.name}-${frame}`);
      await page.waitForTimeout(1000);
    }
    await page.locator('canvas#viewport').focus();
    await driver.press('s', 700);
    const after = await snapshot();
    observations.push({ shot, before, after });
    report.observations = observations;
    assert(Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z) > .3,
      `${shot.name}: normal movement did not change player position`);
    assert.equal(after.navigation.status, 'ready');
  }
  report.observations = observations;
  if (routesOnly) {
    const routes = [];
    for (const leg of [
      { name: 'kingroad-bridge', from: [555, 180], to: [555, 210] },
      { name: 'coast-bridge', from: [690, 165], to: [690, 195] },
      { name: 'white-castle-approach', from: [554.2, -102], to: [554.2, -85.8] },
      { name: 'ivory-citadel-approach', from: [560.2, 278], to: [560.2, 291.8] },
    ]) {
      const before = await page.evaluate(leg => {
        const d = window.__gameDebug as any;
        const from = [leg.from[0], d.sampleWorld(...leg.from).height, leg.from[1]];
        const to = [leg.to[0], d.sampleWorld(...leg.to).height, leg.to[1]];
        const path = d.getNavPath(from, to);
        d.teleport(from);
        d.inspectPose({ x: from[0], y: from[1], z: from[2],
          yaw: Math.atan2(leg.from[0]! - leg.to[0]!, leg.from[1]! - leg.to[1]!),
          pitch: .3, distance: 11, detached: false });
        return { path, player: d.getPlayerPosition() };
      }, leg);
      assert(before.path?.length >= 2, `${leg.name}: no navigation path`);
      const end = before.path.at(-1);
      assert(Math.hypot(end.x - leg.to[0]!, end.z - leg.to[1]!) < 1, `${leg.name}: incomplete path`);
      await page.locator('canvas#viewport').focus();
      await page.keyboard.down('w');
      try {
        await page.waitForFunction(to => {
          const p = (window.__gameDebug as any).getPlayerPosition();
          return Math.hypot(p.x - to[0]!, p.z - to[1]!) < 1.7;
        }, leg.to, { timeout: 15_000 });
      } finally { await page.keyboard.up('w'); }
      const after = await page.evaluate(() => ({ player: (window.__gameDebug as any).getPlayerPosition(),
        camera: (window.__gameDebug as any).getCamera() }));
      assert.equal(after.camera.freeMove, false);
      await driver.screenshot(out, leg.name);
      routes.push({ leg, before, after });
      report.routes = routes;
    }
  }
  report.water = await page.evaluate(() => (window.__gameDebug as any).getWaterBodies());
  report.scatter = await page.evaluate(() => (window.__gameDebug as any).getScatterStats());
  report.errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, passed: report.passed, error: report.error }));
  await driver.close();
  await server.close();
}
