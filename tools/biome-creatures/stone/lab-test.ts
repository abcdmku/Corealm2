import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from '../../lib/driver.js';
import { startGameServer } from '../../lib/server.js';
import { installAssetCandidates } from '../../lib/assetCandidates.js';

const out = 'test-results/biome-creatures/stone';
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: any[] = [];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',') : null;
const servedCatalog = JSON.parse(await readFile(`${out}/catalog.json`, 'utf8'));
try {
  await driver.launch(); const page = driver.page!;
  await installAssetCandidates(page, `${out}/catalog.json`);
  await driver.open(60000, '/index.html?mode=combat&creatures=1&atmosphere=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  for (const id of ['cairn_treader', 'flint_mandible', 'vault_custodian', 'blind_cave_weaver', 'scree_watcher'].filter(id => !only || only.includes(id))) {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(id === 'vault_custodian' || id === 'blind_cave_weaver' ? 'gravelmaw' : 'karrowmoor');
    await page.evaluate(async id => {
      const gallery = (window as any).__creatureGallery;
      await gallery.show(`candidate:${id}`, 1);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = gallery.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i]));
      (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: -.42, pitch: .17, distance: Math.max(3.3, size * 1.85), detached: true });
    }, id);
    await page.waitForTimeout(1100);
    await page.evaluate(id => { const gallery = (window as any).__creatureGallery, b = gallery.getBounds(), distances: Record<string, number> = { cairn_treader: 4.8, flint_mandible: 5.5, vault_custodian: 4.8, blind_cave_weaver: 3.2, scree_watcher: 5.2 }; (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: -.40, pitch: .14, distance: distances[id], detached: true }); }, id);
    await page.waitForTimeout(450);
    for (const motion of ['idle', 'walk', 'run', 'attack', 'hit']) {
      await page.locator(`#creature-gallery-${motion}`).click();
      const samples = [];
      for (let i = 0; i < 7; i++) {
        await page.waitForTimeout(100);
        const sample = await page.evaluate(() => {
          const gallery = (window as any).__creatureGallery, debug = window.__gameDebug as any, state = gallery.getState();
          return { state, bounds: gallery.getBounds(), motion: debug.getEntityMotion(state.entityIds[0]), drawn: debug.getDrawnBounds(state.entityIds[0]), ground: debug.groundHeight(0, 70) };
        });
        assert(sample.state.ready && sample.bounds && sample.motion && sample.drawn, `${id} ${motion} missing actual rig`);
        const clearance = sample.bounds.min[1] - sample.ground;
        if (!(clearance > -.085 && clearance < .13)) evidence.push({ id, motion, rejectedSample: sample, clearance });
        assert(clearance > -.085 && clearance < .13, `${id} ${motion} floor ${clearance}`);
        assert(sample.drawn.height > .2 && sample.drawn.height < 5, `${id} exploded / collapsed rig`);
        samples.push({ ...sample, clearance });
        if (i === 2) await page.screenshot({ path: `${out}/${id}-${motion}.png` });
      }
      assert(new Set(samples.map(s => JSON.stringify(s.motion))).size > 1, `${id} ${motion} did not advance`);
      evidence.push({ id, motion, samples });
    }
    await page.locator('#creature-gallery-idle').click();
    await page.waitForTimeout(650);
    await page.evaluate(() => { const g = (window as any).__creatureGallery, b = g.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i])); (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: Math.PI / 2, pitch: .12, distance: Math.max(3.3, size * 1.8), detached: true }); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${id}-side.png` });
    await page.evaluate(async id => { const lab = window.__featureLab!; await lab.perform('reset-player'); lab.setFreeCameraEnabled(false); lab.setLevel('melee', 40); await lab.spawnTarget('creature', `candidate:${id}`, { distance: 3 }); }, id);
    await page.keyboard.press('l');
    const before = await page.evaluate(() => window.__featureLab!.getState());
    await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
    await page.waitForFunction(hp => (window.__featureLab!.getState().target?.health ?? hp) < hp, before.target!.health!, { timeout: 8000 });
    evidence.push({ id, combatBefore: before, combatAfter: await page.evaluate(() => window.__featureLab!.getState()) });
    await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
    console.log(`${id} gallery + combat passed`);
  }
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as any).getErrors()), []);
} finally {
  await writeFile(`${out}/${only ? 'lab-visual-recheck' : 'lab'}.json`, JSON.stringify({ candidateHashes: Object.fromEntries(servedCatalog.assets.map((a: any) => [a.id, a.sha256])), evidence, pageErrors: driver.pageErrors, consoleErrors: driver.consoleErrors }, null, 2));
  await driver.close(); await server.close();
}
