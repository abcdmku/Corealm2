import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../game/src/app/config.js';
import { CROWNWARD_FISH } from '../game/src/content/crownwardFishing.js';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';

const world = process.argv.includes('--world');
const out = `test-results/crownward-fishing/${world ? 'world' : 'lab'}`;
await mkdir(out, { recursive: true });
const server = await startGameServer({ hmr: false });
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const report: Record<string, any> = { passed: false, world, cases: [] };
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript('globalThis.__name = (fn) => fn;');
  await driver.open(300_000, world ? '/index.html?startup-cache=0' : '/index.html?mode=combat&fishing=crownward&startup-cache=0');
  if (!world) await page.evaluate(() => window.__featureLab!.setFreeCameraEnabled(false));
  const close = page.locator('#panel-feature-lab .panel__close');
  if (await close.isVisible()) await close.click();
  const schools = await page.evaluate(() => (window.__gameDebug as any).getEntities()
    .filter((e: any) => e.archetype === 'fishing_spot' && /^(crownmere_|pearlwater_salmon_)/.test(e.id))
    .map((e: any) => (window.__gameDebug as any).getEntity(e.id)));
  assert.equal(schools.length, 15);
  report.schools = schools;
  report.placement = await page.evaluate(schools => schools.map((e: any) => {
    const d = window.__gameDebug as any, bank = e.interactionPosition;
    return { id: e.id, bank: d.sampleWorld(bank[0], bank[2]),
      school: d.sampleWorld(e.position[0], e.position[2]), level: e.position[1] };
  }), schools);
  for (const placement of report.placement) {
    assert.equal(placement.bank.waterBodyId, null, `${placement.id}: wet casting bank`);
    assert(placement.level - placement.school.height >= .54, `${placement.id}: school is too shallow`);
  }
  for (const fish of CROWNWARD_FISH) {
    const entity = schools.find((e: any) => e.resource?.itemId === fish.id);
    assert.equal(entity.tier, fish.tier);
    assert.equal(entity.requirements.fishing, fish.tier);
    const bank = entity.interactionPosition;
    assert(bank);
    const dx = bank[0] - entity.position[0], dz = bank[2] - entity.position[2];
    const distance = Math.hypot(dx, dz);
    const setup = await page.evaluate(({ bank, dx, dz, distance, tier }) => {
      const d = window.__gameDebug as any;
      d.setSkillLevel('fishing', 99);
      const x = bank[0] + dx / distance * 3, z = bank[2] + dz / distance * 3;
      const y = d.sampleWorld(x, z).height;
      d.teleport([x, y, z]);
      d.inspectPose({ x, y, z, yaw: Math.atan2(dx, dz), pitch: .42, distance: 11, detached: false });
      return { player: d.getPlayerPosition(), bank: d.sampleWorld(bank[0], bank[2]), required: tier };
    }, { bank, dx, dz, distance, tier: fish.tier });
    assert.equal(setup.bank.waterBodyId, null);
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => JSON.parse((window.__gameDebug as any).getSaveBlob()));
    const quantity = (save: any) => save.inventory.slots.reduce((n: number, slot: any) => n + (slot?.itemId === fish.id ? slot.quantity : 0), 0);
    const cameraInfo = await page.evaluate(() => (window.__gameDebug as any).getCamera());
    const camera = new PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
    camera.position.set(cameraInfo.position.x, cameraInfo.position.y, cameraInfo.position.z);
    camera.lookAt(cameraInfo.target.x, cameraInfo.target.y, cameraInfo.target.z);
    camera.updateMatrixWorld(true);
    let clicked = false;
    for (const lift of [0, -.2, .2, -.4]) {
      const p = new Vector3(entity.position[0], entity.position[1] + lift, entity.position[2]).project(camera);
      for (const offset of [[0,0], [-5,0], [5,0], [0,5], [0,-5]]) {
        const x = (p.x + 1) * 720 + offset[0]!, y = (1 - p.y) * 450 + offset[1]!;
        await page.mouse.move(x, y);
        await page.waitForTimeout(60);
        const hovered = await page.evaluate(() => (window.__gameDebug as any).getState().hoveredEntityId);
        if (hovered !== entity.id) continue;
        await page.mouse.click(x, y); clicked = true; break;
      }
      if (clicked) break;
    }
    assert(clicked, `${fish.name}: no real canvas hover on its fishing spot`);
    await page.waitForFunction(({ itemId, previous }) => {
      const save = JSON.parse((window.__gameDebug as any).getSaveBlob());
      return save.inventory.slots.reduce((n: number, slot: any) => n + (slot?.itemId === itemId ? slot.quantity : 0), 0) > previous;
    }, { itemId: fish.id, previous: quantity(before) }, { timeout: 45_000 });
    const after = await page.evaluate(id => {
      const d = window.__gameDebug as any, player = d.getPlayerPosition();
      return { save: JSON.parse(d.getSaveBlob()), entity: d.getEntity(id), player,
        surface: d.sampleWorld(player.x, player.z), camera: d.getCamera() };
    }, entity.id);
    assert.equal(after.surface.waterBodyId, null);
    assert.equal(after.camera.freeMove, false);
    assert.equal(after.camera.requestedDistance, 11);
    assert(quantity(after.save) > quantity(before));
    assert(after.entity.resource.remaining < entity.resource.remaining);
    await driver.screenshot(out, fish.id);
    report.cases.push({ fish, setup, beforeQuantity: quantity(before), afterQuantity: quantity(after.save), after });
    await driver.press('s', 100);
  }
  if (world) {
    await page.evaluate(() => {
      const d = window.__gameDebug as any, x = 535, z = 220, y = d.sampleWorld(x, z).height;
      d.teleport([x, y, z]);
      d.inspectPose({ x, y, z, yaw: 1.3, pitch: .18, distance: 11, detached: false });
    });
    await page.waitForTimeout(2000);
    await driver.screenshot(out, 'shoreline-low');
  }
  report.errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  if (driver.page) await driver.screenshot(out, 'failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, out, error: report.error }));
  await driver.close(); await server.close();
}

