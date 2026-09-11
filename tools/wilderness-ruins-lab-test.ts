import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WILDERNESS_RUIN_IDS, WILDERNESS_RUINS } from '../game/src/render/compositions/wildernessRuins.js';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';

const out = 'test-results/wilderness-ruins-lab';
const archesOnly = process.argv.includes('--arches-only');
const selected = archesOnly ? WILDERNESS_RUIN_IDS.filter(id =>
  id === 'wilderness_roofless_abbey' || id === 'wilderness_shattered_aqueduct') : WILDERNESS_RUIN_IDS;
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: unknown[] = [];
try {
  await driver.launch();
  await driver.open(60_000, '/index.html?mode=building&atmosphere=1&wildernessTorches=1');
  const page = driver.page!;
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.waitForFunction(() => (window.__gameDebug as any).getBiomeAtmosphere().sky.night > .98,
    null, { timeout: 8000 });

  for (const id of selected) {
    const before = await page.evaluate(() => window.__featureLab!.getState().structure);
    const structure = await page.evaluate(async id =>
      (await window.__featureLab!.setStructure({ kind: 'composition', id, kit: 'stone' })).structure, id);
    assert(structure.ready && structure.revision > before.revision);
    assert(structure.partCount > 80 && structure.collisionCount >= 5, `${id}: absent masonry/collision`);
    assert(structure.collisionCount < 70, `${id}: masonry was not merged into columns`);
    assert(structure.bounds && structure.bounds.max[1] - structure.bounds.min[1] > 3);

    const def = WILDERNESS_RUINS[id];
    const path = await page.evaluate(({ from, to }) =>
      (window.__gameDebug as any).getNavPath([-8 + from[0], 0, 12 + from[1]], [-8 + to[0], 0, 12 + to[1]]),
    { from: def.clearThrough[0], to: def.clearThrough[1] });
    assert(path && path.length >= 2, `${id}: passage has no navigation path`);
    assert(path.every((point: { x: number }) => Math.abs(point.x + 8) < 1.5),
      `${id}: navigation detours around the ruin instead of using its passage`);

    const bounds = structure.bounds;
    const centre = { x: (bounds.min[0] + bounds.max[0]) / 2,
      y: bounds.min[1] + Math.min(4, (bounds.max[1] - bounds.min[1]) * .36),
      z: (bounds.min[2] + bounds.max[2]) / 2 };
    for (const shot of [{ name: 'approach', yaw: .56, pitch: .28, distance: 34 },
      { name: 'reverse', yaw: 3.6, pitch: .32, distance: 31 }]) {
      await page.evaluate(pose => (window.__gameDebug as any).inspectPose({ ...pose, detached: true }),
        { ...centre, ...shot });
      await page.waitForTimeout(180);
      await page.screenshot({ path: `${out}/${id}-${shot.name}.png` });
    }
    if (id === 'wilderness_broken_watchtower' || id === 'wilderness_ruined_smithy') {
      const pose = id === 'wilderness_broken_watchtower'
        ? { x: -11.2, y: 5.1, z: 10.6, yaw: 1.1, pitch: .08, distance: 13 }
        : { x: -17, y: 1.1, z: 9, yaw: .25, pitch: .24, distance: 11 };
      await page.evaluate(pose => (window.__gameDebug as any).inspectPose({ ...pose, detached: true }), pose);
      await page.waitForTimeout(180);
      await page.screenshot({ path: `${out}/${id}-interior.png` });
    }

    await page.evaluate(() => {
      window.__featureLab!.setWalkingEnabled(true);
      (window.__gameDebug as any).inspectPose({ x: -8, y: 0, z: 19, yaw: 0, pitch: .25, distance: 12 });
    });
    const walkBefore = await page.evaluate(() => window.__featureLab!.getState().playerPosition);
    await page.keyboard.down('w');
    await page.waitForTimeout(3300);
    await page.keyboard.up('w');
    const walkAfter = await page.evaluate(() => window.__featureLab!.getState().playerPosition);
    assert(walkAfter[2] < 8 && Math.abs(walkAfter[0] + 8) < 1, `${id}: player did not cross the ruin`);
    await page.screenshot({ path: `${out}/${id}-walked-through.png` });
    const fire = await page.evaluate(() => (window as any).__wildernessEffects.getState());
    assert(fire.ready && fire.enabled && fire.torches === def.torches.length, `${id}: torch fixture is missing`);
    assert(fire.channels === 0 && fire.liveParticles > 0, `${id}: torch flames are inactive`);
    assert(fire.lights.filter((light: { kind: string; intensity: number }) =>
      light.kind === 'torch' && light.intensity > 0).length === def.torches.length, `${id}: mounted lights are inactive`);
    evidence.push({ id, before, structure, path, walkBefore, walkAfter, fire });
    console.log(`${id}: ${structure.partCount} parts, ${structure.collisionCount} solids, passage crossed`);
  }
  const errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  evidence.push({ errors, pageErrors: driver.pageErrors, consoleErrors: driver.consoleErrors });
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  console.log(`${selected.length} Wilderness ruins passed production lab state, navigation and walking checks.`);
} finally {
  await writeFile(`${out}/${archesOnly ? 'report-arches' : 'report'}.json`, JSON.stringify(evidence, null, 2));
  await driver.close();
  await server.close();
}
