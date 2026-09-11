/** Root-scheduled production checks. Each invocation is a separate <=60 second GPU lane. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameDriver } from '../lib/driver.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { startGameServer } from '../lib/server.js';
import { installTestDeadline } from '../lib/deadline.js';
import { CAMERA } from '../../game/src/app/config.js';

const mode = process.argv.includes('--mines') ? 'mines' : process.argv.includes('--groves') ? 'groves' : 'trees';
const tierIndex = process.argv.indexOf('--tier'), tier = tierIndex < 0 ? undefined : Number(process.argv[tierIndex + 1]);
if (tier !== undefined) assert([50, 70].includes(tier), '--tier must be 50 or 70');
const output = `test-results/wilderness-resources/lab-${mode}${tier ? `-t${tier}` : ''}`;
const catalogPath = 'test-results/wilderness-resources/catalog.json';
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
await mkdir(output, { recursive: true });
const deadline = installTestDeadline(`Wilderness resource ${mode} lab`, 59_000), start = Date.now();
const server = await startGameServer(), driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const samples: unknown[] = [], screenshots: string[] = [];
let passed = false;
const remaining = (cap: number) => Math.max(1, Math.min(cap, 56_000 - (Date.now() - start)));
try {
  await driver.launch(); const page = driver.page!;
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await installAssetCandidates(page, catalogPath);
  await driver.open(remaining(22000), '/index.html?mode=combat&environment=1&atmosphere=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  const document = await page.evaluate(() => performance.timeOrigin);
  async function observe() {
    return page.evaluate(() => { const d = window.__gameDebug as any, e = (window as any).__environmentLab;
      return { state: e.getState(), bounds: e.getBounds(), profile: d.getRenderProfile('lab-foliage-'), atmosphere: d.getBiomeAtmosphere(), camera: d.getCamera(), player: d.getPlayerPosition(), clock: d.getState().clock, errors: d.getErrors(), document: performance.timeOrigin };
    });
  }
  async function pose(x: number, z: number, yaw: number, pitch: number, distance: number) {
    assert(pitch >= CAMERA.minPitch && pitch <= CAMERA.maxPitch && distance >= CAMERA.minDistance && distance <= CAMERA.maxDistance);
    await page.evaluate(p => { const d = window.__gameDebug as any; const y = d.groundHeight(p.x, p.z); d.inspectPose({ ...p, y }); }, { x, z, yaw, pitch, distance });
    await page.waitForTimeout(400);
    const o = await observe(); assert.equal(o.document, document); assert.deepEqual(o.errors, []);
    assert(Math.abs(o.player.x - x) < .5 && Math.abs(o.player.z - z) < .5, 'Camera setup must move the actual player');
    assert(Math.abs(o.camera.target.y - o.player.y) < 2.2, 'Normal player follow target only');
    return o;
  }
  async function capture(name: string) { const file = `${output}/${name}.png`; await page.screenshot({ path: file, timeout: remaining(5000) }); screenshots.push(file); }
  async function ready() {
    await page.waitForFunction(() => (window as any).__environmentLab.getState().ready, undefined, { timeout: remaining(7000) });
    await page.waitForTimeout(250);
  }
  async function atmosphere(value: 'fallowmarch' | 'wilderness' | 'deep_wilderness') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(value);
    await page.waitForFunction(value => { const sky = (window.__gameDebug as any).getBiomeAtmosphere().sky;
      return value === 'fallowmarch' ? sky.night < .02 && sky.magic < .02 : sky.night > .98 && (value !== 'deep_wilderness' || sky.magic > .98);
    }, value, { timeout: remaining(12000) });
  }
  if (mode === 'trees') {
    for (const asset of catalog.assets.filter((a: any) => a.species && (!tier || a.tier === tier))) {
      await atmosphere('fallowmarch');
      await page.evaluate(id => (window as any).__environmentLab.showFoliage(id, { layout: 'lane', count: 1, span: 1 }), asset.id); await ready();
      const near = await pose(0, -2, Math.PI - .08, .18, 11);
      const triangles = (o: any) => o.profile.draws.filter((r: any) => r.pass === 'colour' && r.name.startsWith('lab-foliage-')).reduce((sum: number, r: any) => sum + r.triangles, 0);
      assert.equal(triangles(near), asset.triangles, `${asset.id}: detailed source must actually draw`); await capture(`${asset.id}-canopy`);
      await page.evaluate(() => (window as any).__environmentLab.setFoliageWoodOnly(true)); await page.waitForTimeout(150);
      const wood = await observe(); assert.equal(wood.state.foliage.woodOnly, true); assert(triangles(wood) > 0 && triangles(wood) < asset.triangles);
      await capture(`${asset.id}-wood`); await page.evaluate(() => (window as any).__environmentLab.setFoliageWoodOnly(false));
      const dayDetail = await pose(3, 18, Math.PI - .3, .18, 6); await capture(`${asset.id}-trunk-roots-day`);
      const far = await pose(0, -56, Math.PI, .18, 11); assert.equal(triangles(far), asset.triangles); await capture(`${asset.id}-far`);
      await atmosphere(asset.tier === 70 ? 'deep_wilderness' : 'wilderness');
      const night = await pose(0, -2, Math.PI - .08, .18, 11); assert.equal(triangles(night), asset.triangles); await capture(`${asset.id}-night`);
      const close = await pose(3, 18, Math.PI - .3, .18, 6); await capture(`${asset.id}-trunk-roots`);
      assert.deepEqual(near.bounds, night.bounds); samples.push({ asset: asset.id, sha256: asset.sha256, near, wood, dayDetail, far, night, close });
    }
  } else {
    const fixtureSave = JSON.parse(await driver.callDebug('getSaveBlob') as string);
    fixtureSave.inventory.slots = fixtureSave.inventory.slots.map((slot: any) => slot && ['grithe_hatchet', 'grithe_pickaxe'].includes(slot.itemId) ? slot : null);
    await driver.callDebug('loadSaveBlob', [JSON.stringify(fixtureSave)]);
    const sites = mode === 'mines' ? ['cindervein_workings', 'nightglass_excavation'] : ['lastroot_teak', 'starwood_hollow'];
    for (const site of sites.filter(id => !tier || (id === 'cindervein_workings' || id === 'lastroot_teak' ? 50 : 70) === tier)) {
      await atmosphere('fallowmarch');
      await page.evaluate(id => (window as any).__environmentLab.showSite(id), site); await ready();
      const siteState = (await observe()).state, id = siteState.entityIds[mode === 'mines' ? 3 : 4];
      const entity: any = await driver.callDebug('getEntity', [id]); assert(entity?.resource);
      assert.equal((await observe()).clock.timeScale, 1, 'Gathering must use natural simulation time');
      await pose(entity.position[0], entity.position[2] + (mode === 'mines' ? 6 : 10), 0, .50, 11);
      await capture(`${site}-available`);
      if (mode === 'mines') {
        await atmosphere(entity.tier === 70 ? 'deep_wilderness' : 'wilderness');
        await capture(`${site}-night-available`);
      }
      const before = JSON.parse(await driver.callDebug('getSaveBlob') as string), cursor = (await driver.callDebug('getEvents', [0]) as any).nextSeq;
      const view: any = await driver.callDebug('getCamera');
      const projection = new PerspectiveCamera(CAMERA.fov, 1440 / 900, .1, 2000);
      projection.position.set(view.position.x, view.position.y, view.position.z); projection.lookAt(view.target.x, view.target.y, view.target.z); projection.updateMatrixWorld();
      const projected = new Vector3(entity.position[0], entity.position[1] + (mode === 'mines' ? .5 : 1.0), entity.position[2]).project(projection);
      const centre = { x: (projected.x + 1) * 720, y: (1 - projected.y) * 450 }; let hit: { x: number; y: number } | undefined;
      for (const [dx, dy] of [[0, 0], [0, 8], [-8, 0], [8, 0], [0, -8], [-16, 8], [16, 8]]) {
        const x = centre.x + dx!, y = centre.y + dy!; await page.mouse.move(x, y); await page.waitForTimeout(35);
        if ((await driver.callDebug('getState') as any).hoveredEntityId === id) { hit = { x, y }; break; }
      }
      assert(hit, `${site}: production pointer did not hit the chosen resource`); await page.mouse.click(hit.x, hit.y);
      await page.waitForFunction(target => (window.__gameDebug as any).getEntity(target)?.state === 'depleted', id, { timeout: remaining(20000) });
      await page.waitForTimeout(300);
      const after = JSON.parse(await driver.callDebug('getSaveBlob') as string), depleted: any = await driver.callDebug('getEntity', [id]);
      const events: any = await driver.callDebug('getEvents', [cursor]);
      const quantity = (save: any) => save.inventory.slots.reduce((n: number, slot: any) => n + (slot?.itemId === entity.resource.itemId ? slot.quantity : 0), 0);
      assert.equal(quantity(after) - quantity(before), entity.resource.remaining); assert.equal(depleted.resource.remaining, 0);
      assert.deepEqual(depleted.position, entity.position); assert(events.events.some((e: any) => e.type === 'item.received' && e.entityId === id && e.data.source === 'gather'));
      const drawn: any = await driver.callDebug('getDrawnBounds', [id]); assert(drawn?.meshes > 0);
      if (mode === 'groves') {
        const player: any = await driver.callDebug('getPlayerPosition');
        // Orbit around the normal player focus so the character does not hide the fitted stump.
        await pose(player.x, player.z, 1.05, .65, 8);
      }
      await capture(`${site}-naturally-depleted`);
      samples.push({ site, id, hit, before: entity, after: depleted, drawn, events, received: quantity(after) - quantity(before), state: await observe() });
    }
  }
  assert.deepEqual(await driver.callDebug('getErrors'), []); assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); passed = true;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ passed, mode, tier, elapsedMs: Date.now() - start, sourceAssets: catalog.assets.map((a: any) => ({ id: a.id, sha256: a.sha256, bytes: a.bytes })), cameraPolicy: 'Actual grounded player follow; pitch 0.18 to 0.65; distance 6 to 11m; no detached camera or raised target.', samples, screenshots, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors, acceptance: 'Root must inspect the images before promotion.' }, null, 2));
  await driver.close(); await server.close(); deadline();
}
console.log(JSON.stringify({ passed, mode, elapsedMs: Date.now() - start, report: `${output}/report.json`, screenshots: screenshots.length }));
