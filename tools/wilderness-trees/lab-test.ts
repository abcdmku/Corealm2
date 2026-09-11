/** Four staged models, production scatter/materials, near/far/return and mixed grove proof. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';

const hollowOnly = process.argv.includes('--hollow-only');
const out = hollowOnly ? 'test-results/wilderness-trees/lab-hollow' : 'test-results/wilderness-trees/lab';
await mkdir(out, { recursive: true });
const catalogFile = 'test-results/wilderness-trees/catalog.json';
const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
const selectedAssets = hollowOnly ? catalog.assets.filter((asset: any) => asset.id === 'corealm_deadwood_hollow') : catalog.assets;
const server = await startGameServer(), driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const samples: unknown[] = [];
const screenshots: string[] = [];
let passed = false;
try {
  await driver.launch(); const page = driver.page!;
  page.setDefaultTimeout(8000);
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await installAssetCandidates(page, catalogFile);
  await driver.open(45000, '/index.html?mode=combat&environment=1&atmosphere=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  const document = await page.evaluate(() => performance.timeOrigin);
  const capture = async (name: string) => { const file = `${out}/${name}.png`; await page.screenshot({ path: file }); screenshots.push(file); };
  const observe = async () => page.evaluate(() => {
    const debug = window.__gameDebug as any, env = (window as any).__environmentLab;
    return { state: env.getState(), bounds: env.getBounds(), camera: debug.getCamera(), profile: debug.getRenderProfile('lab-foliage-'), atmosphere: debug.getBiomeAtmosphere(), scene: debug.getSceneStats(), errors: debug.getErrors(), document: performance.timeOrigin };
  });
  for (const asset of selectedAssets) {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('fallowmarch');
    await page.evaluate(async id => { await (window as any).__environmentLab.showFoliage(id, { layout: 'lane', count: 1, span: 1 }); }, asset.id);
    const states: any[] = [];
    for (const shot of ['near', 'far', 'return'] as const) {
      await page.evaluate(({ id, shot }) => {
        const debug = window.__gameDebug as any;

        const low = id.endsWith('fallen');
        const pose = shot === 'far' ? { x: 0, z: -62, yaw: Math.PI, pitch: .18, distance: 11 }
          : { x: low ? 3 : 0, z: low ? 19 : 8, yaw: Math.PI - .28, pitch: low ? .45 : .18, distance: low ? 8 : 11 };
        debug.inspectPose({ ...pose, y: debug.groundHeight(pose.x, pose.z) });
      }, { id: asset.id, shot });
      await page.waitForTimeout(600);
      const state = await observe();
      assert.equal(state.document, document, 'Document reloaded during foliage proof');
      assert(state.state.ready && state.state.mode === 'foliage');
      assert.equal(state.state.foliage.count, 1);
      assert.deepEqual(state.state.assets, [asset.id]);
      const centre = state.bounds.min.map((v: number, i: number) => (v + state.bounds.max[i]) / 2), camera = state.camera.position;
      const distance = Math.hypot(camera.x - centre[0], camera.y - centre[1], camera.z - centre[2]);
      assert(shot === 'far' ? distance > 75 : distance < 45, `${asset.id} ${shot} actual camera distance ${distance}`);
      const draws = state.profile.draws.filter((d: any) => d.pass === 'colour' && d.name.startsWith('lab-foliage-'));
      assert.equal(draws.reduce((sum: number, d: any) => sum + d.triangles, 0), asset.triangles, `${asset.id} ${shot} actual detailed triangles`);
      const bark = draws.flatMap((d: any) => d.materials).find((m: any) => m.name.startsWith('Bark_Corealm'));
      assert(bark && bark.mapAnisotropy === 8, `${asset.id} ${shot} needs actual production bark texture sampling`);
      assert.deepEqual(state.errors, []);
      states.push(state); samples.push({ id: asset.id, shot, ...state });
      if (shot !== 'return') await capture(`${asset.id}-${shot}`);
    }
    assert.deepEqual(states[0].bounds, states[2].bounds, 'Returning changed native instance bounds');
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
    await page.waitForTimeout(1100); const night = await observe();
    assert(night.atmosphere.sky.night > .9, 'Night material proof requires the selected Wilderness light');
    samples.push({ id: asset.id, shot: 'night', ...night }); await capture(`${asset.id}-night`);
  }
  if (!hollowOnly) { await page.evaluate(async (ids) => {
    await (window as any).__environmentLab.showFoliage(ids[0], { variants: ids, layout: 'grid', count: 20, span: 48 });
    const d = window.__gameDebug as any; d.inspectPose({ x: 0, y: d.groundHeight(0, -12), z: -12, yaw: Math.PI, pitch: .3, distance: 11 });
  }, catalog.assets.map((a: any) => a.id));
  await page.waitForTimeout(650); const grove = await observe();
  assert.equal(grove.state.foliage.count, 20); assert.equal(grove.state.assets.length, 4); samples.push({ shot: 'mixed-night-grove', ...grove }); await capture('mixed-night-grove');
  }
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []);
  passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify({ passed, catalogFile, mode: hollowOnly ? 'hollow-contour-revision' : 'full-dead-forest', sourceAssets: selectedAssets.map((asset: any) => ({ id: asset.id, sha256: asset.sha256, bytes: asset.bytes, triangles: asset.triangles })), samples, screenshots, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors, visualAcceptance: 'Root must inspect named near, far, night and any mixed grove screenshots before promotion.' }, null, 2));
  await driver.close(); await server.close();
}
console.log(JSON.stringify({ passed, report: `${out}/report.json`, screenshots: screenshots.length }));
