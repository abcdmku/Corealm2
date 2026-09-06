// Root-scheduled production lab capture. No public asset files are modified.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = process.cwd();
const stage = path.join(root, 'art/rebuild/candidates/finish-foliage');
const remaining = process.argv.includes('--remaining');
const publicModels = process.argv.includes('--public');
const out = path.join(root, remaining ? 'test-results/foliage-catalogue' : 'test-results/finish-foliage');
const catalog = JSON.parse(await readFile(path.join(stage, 'catalog.json'), 'utf8'));
await mkdir(out, { recursive: true });
const inventory = [];
for (const asset of catalog.assets.filter(a => !remaining || !/^corealm_(oak|pine)_/.test(a.id))) {
  const file = path.join(publicModels ? path.join(root, 'game/public/assets') : stage, asset.file);
  const bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, asset.sha256, `${asset.id} source differs from measured catalogue`);
  inventory.push({ id: asset.id, name: asset.id.replace('corealm_', '').split('_').map(s => s[0].toUpperCase()+s.slice(1)).join(' '), file, sha256, triangles: asset.triangles, size: asset.size, materials: asset.materials });
}
await writeFile(path.join(out, 'inventory.json'), JSON.stringify({ publicModels, assets: inventory }, null, 2));
if (process.argv.includes('--inventory-only')) { console.log(JSON.stringify(inventory)); process.exit(0); }
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const report = { visualAccepted: false, publicModels, inventory, shots: [], scatter: [], errors: [], stagedRequests: [] };
const deadline = setTimeout(() => { report.errors.push('55-second catalogue capture deadline exceeded'); void browser.close(); }, 55000);
page.setDefaultTimeout(5000);
page.on('pageerror', e => report.errors.push(String(e)));
if (!publicModels) await page.route('**/assets/models/corealm/nature/*.glb*', async route => {
  const filename = path.basename(new URL(route.request().url()).pathname);
  report.stagedRequests.push(filename);
  await route.fulfill({ body: await readFile(path.join(stage, 'models/corealm/nature', filename)), contentType: 'model/gltf-binary' });
});
try {
  await page.goto(`${process.env.FOLIAGE_URL ?? 'http://127.0.0.1:4175'}/index.html?mode=combat&environment=1`, { timeout: 60000 });
  await page.waitForFunction(() => window.__environmentLab?.getState().ready, { timeout: 60000 });
  const origin = await page.evaluate(() => performance.timeOrigin);
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  assert(!/swiftshader|software/i.test(report.renderer), report.renderer);
  for (const panel of await page.locator('.panel:not([hidden]) .panel__close').all()) if (await panel.isVisible()) await panel.click();
  const trees = catalog.assets.filter(a => /corealm_(oak|pine)_/.test(a.id));
  const assets = remaining ? catalog.assets.filter(a => !trees.includes(a)) : process.argv.includes('--all') ? catalog.assets : trees;
  for (const asset of assets) {
    await page.evaluate(async id => { await window.__environmentLab.showGallery(id); }, asset.id);
    await page.waitForFunction(id => document.querySelector('#environment-lab-selection')?.value === id && document.querySelector('#environment-lab-mode')?.value === 'gallery', asset.id);
    for (const view of remaining ? ['front', 'rear', 'detail', 'play'] : ['front', 'rear', 'detail', 'far']) {
      const evidence = await page.evaluate(({ id, view }) => {
        const lab = window.__environmentLab, b = lab.getBounds();
        const centre = b.min.map((v, i) => (v + b.max[i]) / 2);
        const h = b.max[1] - b.min[1], span = Math.max(h, b.max[0]-b.min[0], b.max[2]-b.min[2]);
        window.__gameDebug.inspectPose({ x: centre[0], y: view === 'detail' ? b.min[1] + h * .49 : centre[1], z: centre[2], yaw: view === 'rear' ? .4 + Math.PI : .4, pitch: view === 'detail' ? .35 : .48, distance: view === 'detail' ? Math.max(1.5, span * 1.2) : view === 'play' ? 16 : view === 'far' ? Math.max(40, h * 6) : Math.max(3, span * 2), detached: true });
      return { id, view, bounds: b, state: lab.getState(), origin: performance.timeOrigin, time: performance.now() };
      }, { id: asset.id, view });
      assert.equal(evidence.origin, origin);
      assert.equal(evidence.state.selection, asset.id);
      await page.waitForTimeout(180);
      evidence.drawn = await page.evaluate(id => ({ bounds: window.__gameDebug.getDrawnBounds(`lab:environment:gallery:${id}`), scatterObjects: Object.keys(window.__gameDebug.getSceneStats().counts).filter(n => n.startsWith('lab-foliage-')), panelId: document.querySelector('#environment-lab-selection')?.value, panelMode: document.querySelector('#environment-lab-mode')?.value }), asset.id);
      assert(evidence.drawn.bounds, `${asset.id} is not actually drawn`);
      assert.deepEqual(evidence.drawn.scatterObjects, [], 'Previous scatter fixture still exists');
      assert.equal(evidence.drawn.panelId, asset.id);
      assert.equal(evidence.drawn.panelMode, 'gallery');
      await page.screenshot({ path: path.join(out, `${asset.id}-${view}.png`) });
      report.shots.push({ ...evidence, sha256: asset.sha256, triangles: asset.triangles, file: `${asset.id}-${view}.png` });
      if (view === 'front' && !remaining) {
        await page.waitForTimeout(950);
        await page.screenshot({ path: path.join(out, `${asset.id}-motion.png`) });
        report.shots.push({ id: asset.id, view: 'motion', sha256: asset.sha256, file: `${asset.id}-motion.png`, ...await page.evaluate(() => ({ time: performance.now(), origin: performance.timeOrigin, state: window.__environmentLab.getState() })) });
      }
    }
    if (/corealm_(oak|pine)_/.test(asset.id)) {
      await page.evaluate(async id => window.__environmentLab.showFoliage(id, { layout: 'lane', count: 1, span: 1, scale: 1 }), asset.id);
      for (const phase of ['near', 'far', 'return']) {
        await page.evaluate(phase => {
          const x = 6, z = phase === 'far' ? -28 : 18;
          window.__gameDebug.inspectPose({ x, y: window.__gameDebug.groundHeight(x, z), z, yaw: Math.PI, pitch: phase === 'far' ? .18 : .35, distance: phase === 'far' ? 34 : 24 });
        }, phase);
        await page.waitForTimeout(450);
        const sample = await page.evaluate(() => ({ state: window.__environmentLab.getState(), bounds: window.__environmentLab.getBounds(), profile: window.__gameDebug.getRenderProfile('lab-foliage-'), camera: window.__gameDebug.getCamera(), origin: performance.timeOrigin }));
        assert.equal(sample.origin, origin);
        const centre = sample.bounds.min.map((v, i) => (v + sample.bounds.max[i]) / 2);
        const distance = Math.hypot(sample.camera.position.x - centre[0], sample.camera.position.y - centre[1], sample.camera.position.z - centre[2]);
        assert(phase === 'far' ? distance > 75 : distance < 65, `${asset.id} ${phase} actual camera distance ${distance}`);
        const triangles = sample.profile.draws.filter(d => d.pass === 'colour' && d.name.startsWith('lab-foliage-')).reduce((n, d) => n + d.triangles, 0);
        assert.equal(triangles, asset.triangles, `${asset.id} ${phase} detailed source submission`);
        report.scatter.push({ id: asset.id, phase, triangles, distance, ...sample });
        await page.screenshot({ path: path.join(out, `${asset.id}-scatter-${phase}.png`) });
      }
    }
    console.log(`Captured ${asset.id}`);
  }
  assert.equal(report.errors.length, 0);
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  clearTimeout(deadline);
}
