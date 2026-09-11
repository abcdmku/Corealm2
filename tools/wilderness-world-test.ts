import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { WILDERNESS_GROUPS } from '../game/src/content/wilderness.js';
import { inStarterWildlifeArea, isStarterAnimalAsset } from '../game/src/content/fantasyEncounters.js';

const out = 'test-results/wilderness-world'; await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: unknown[] = [], started = Date.now();
try {
  await driver.launch(); await driver.open(60000); const page = driver.page!;
  const actors = await page.evaluate(() => { const d = window.__gameDebug as any; return d.getEntities().map((e: any) => d.getEntity(e.id)); });
  for (const actor of actors) if (actor.view && isStarterAnimalAsset(actor.view.assetId)) {
    assert(inStarterWildlifeArea(actor.regionId, [actor.position[0], actor.position[2]]), `${actor.id}: remote animal`);
  }
  evidence.push({ animalConfinement: true, actors: actors.length });
  for (const group of WILDERNESS_GROUPS) {
    const result = await page.evaluate(group => {
      const d = window.__gameDebug as any;
      const residents = d.getEntities().filter((e: any) => e.id === group.id || e.id.startsWith(`${group.id}_`)).map((e: any) => d.getEntity(e.id));
      return { residents, ground: residents.map((e: any) => d.sampleWorld(e.position[0], e.position[2])),
        paths: residents.slice(1).map((e: any) => d.getNavPath(residents[0].position, e.position)) };
    }, group);
    assert.equal(result.residents.length, group.count, group.id);
    for (const sample of result.ground) assert(sample.playable && !sample.waterBodyId, `${group.id}: dry placement`);
    for (const [i, path] of result.paths.entries()) {
      assert(path?.length, `${group.id}: resident path`);
      const target = result.residents[i + 1].position, end = path.at(-1);
      assert(Math.hypot(end.x - target[0], end.z - target[2]) < 1, `${group.id}: complete path`);
    }
    evidence.push({ groupId: group.id, ...result });
  }
  for (const shot of [
    { name: 'last-light', x: 0, z: 485, yaw: Math.PI, pitch: .14, distance: 25 },
    { name: 'castle-approach', x: 40, z: 578, yaw: Math.PI, pitch: .16, distance: 34 },
    { name: 'western-graves', x: -205, z: 570, yaw: 2.5, pitch: .2, distance: 25 },
    { name: 'petrified-grove', x: 255, z: 612, yaw: 2.4, pitch: .17, distance: 28 },
  ]) {
    await page.evaluate(shot => { const d = window.__gameDebug as any; d.inspectPose({ ...shot, y: d.groundHeight(shot.x, shot.z) }); }, shot);
    await page.waitForFunction(() => {
      const residency = (window.__gameDebug as any).getEntityViewStats().residency;
      return residency.pending === 0 && residency.failed === 0 && residency.missing === 0;
    }, undefined, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => { const d = window.__gameDebug as any; return { state: d.getState(), sky: d.getBiomeAtmosphere(), scatter: d.getScatterStats() }; });
    evidence.push({ shot: shot.name, ...state });
    if (shot.name !== 'last-light') assert(state.sky.sky.night > .9, `${shot.name}: night`);
    await page.screenshot({ path: `${out}/${shot.name}.png` });
  }
  const before = await page.evaluate(() => {
    const d = window.__gameDebug as any, y = d.groundHeight(40, 574);
    d.teleport([40, y, 574]); d.inspectPose({ x: 40, y, z: 581, yaw: Math.PI, pitch: .3, distance: 20, detached: true });
    return { state: d.getState(), path: d.getNavPath([40, y, 574], [40, d.groundHeight(40, 600), 600]) };
  });
  assert(before.path?.length, 'castle gate path');
  await page.keyboard.down('w'); await page.waitForTimeout(2800); await page.keyboard.up('w');
  const after = await page.evaluate(() => { const d = window.__gameDebug as any; return { ...d.getState(), playerPosition: d.getPlayerPosition() }; });
  evidence.push({ gateWalk: { before, after } });
  assert(after.playerPosition.z > 581, 'real player crossed the gate');
  await page.screenshot({ path: `${out}/castle-court.png` });
  await page.keyboard.press('m'); await page.getByLabel('Map region', { exact: true }).selectOption('wilderness');
  await page.waitForTimeout(350); await page.screenshot({ path: `${out}/map-north.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
  const bounds = await page.locator('#panel-map').boundingBox(); assert(bounds && bounds.width <= 390, 'mobile map fits');
  await page.screenshot({ path: `${out}/map-mobile.png` });
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as any).getErrors()), []);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []);
  assert(Date.now() - started < 120000, 'world smoke budget');
  console.log(`Wilderness world passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally { await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2)); await driver.close(); await server.close(); }
