import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from '../../lib/driver.js';
import { startGameServer } from '../../lib/server.js';
import { installAssetCandidates } from '../../lib/assetCandidates.js';

const out = 'test-results/biome-creatures/forest';
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: any[] = [];
const selected = process.argv.includes('--ids') ? process.argv[process.argv.indexOf('--ids') + 1]!.split(',') : process.argv.includes('--id') ? [process.argv[process.argv.indexOf('--id') + 1]!] : ['briar_harrow', 'fen_crawler', 'reed_strider', 'thorn_maw', 'heath_jack'];
const candidateAssets = JSON.parse(await readFile(`${out}/catalog.json`, 'utf8')).assets.filter((asset: any) => selected.includes(asset.id.replace('creature_', ''))).map((asset: any) => ({ id: asset.id, sha256: asset.sha256, bytes: asset.bytes }));
try {
  await driver.launch(); const page = driver.page!;
  await installAssetCandidates(page, `${out}/catalog.json`);
  await driver.open(60000, '/index.html?mode=combat&creatures=1&atmosphere=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  for (const id of selected) {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(id === 'heath_jack' ? 'fallowmarch' : 'vellenwood');
    await page.evaluate(async id => {
      const gallery = (window as any).__creatureGallery;
      await gallery.show(`candidate:${id}`, 1);
      gallery.place(0, 70, .55);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      (window.__gameDebug as any).inspectPose({ x: 0, y: 1.2, z: 70, yaw: .95, pitch: .2, distance: 4, detached: true });
    }, id);
    await page.waitForFunction(() => { const g = (window as any).__creatureGallery; return (window.__gameDebug as any).getEntityMotion(g.getState().entityIds[0])?.liveRig; }, undefined, { timeout: 8000 });
    await page.evaluate(id => {
      const gallery = (window as any).__creatureGallery, b = gallery.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i]));
      (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: .95, pitch: id === 'fen_crawler' ? .68 : id === 'reed_strider' ? .30 : .18, distance: Math.max(2.5, size * 1.95), detached: true });
    }, id);
    await page.waitForTimeout(160);
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
        if (clearance <= -.085 || clearance >= .13) {
          await page.screenshot({ path: `${out}/${id}-floor-failure.png` });
          await writeFile(`${out}/${id}-floor-failure.json`, JSON.stringify(sample, null, 2));
        }
        assert(clearance > -.085 && clearance < .13, `${id} ${motion} floor ${clearance}`);
        assert(sample.drawn.height > .2 && sample.drawn.height < 5, `${id} exploded / collapsed rig`);
        samples.push({ ...sample, clearance });
        if (i === 2) await page.screenshot({ path: `${out}/${id}-${motion}.png` });
        if (i === 6 && ['walk', 'run', 'attack'].includes(motion)) await page.screenshot({ path: `${out}/${id}-${motion}-late.png` });
      }
      assert(new Set(samples.map(s => JSON.stringify(s.motion))).size > 1, `${id} ${motion} did not advance`);
      evidence.push({ id, motion, samples });
    }
    await page.locator('#creature-gallery-idle').click();
    await page.evaluate(() => { const g = (window as any).__creatureGallery, b = g.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i])); (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: 2.12, pitch: .14, distance: Math.max(2.5, size * 1.95), detached: true }); });
    await page.screenshot({ path: `${out}/${id}-side.png` });
    await page.evaluate(() => { const g = (window as any).__creatureGallery, b = g.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i])); (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: 3.69, pitch: .17, distance: Math.max(2.5, size * 1.95), detached: true }); });
    await page.screenshot({ path: `${out}/${id}-rear.png` });
    const profile = await page.evaluate(() => (window.__gameDebug as any).getRenderProfile());
    const bodyMaterials = profile.draws.flatMap((draw: any) => draw.materials).filter((material: any) => material.name.startsWith(`animal_rpg_${id}`));
    assert(bodyMaterials.length > 0, `${id} production body material did not submit`);
    assert(bodyMaterials.some((material: any) => material.mapUuid !== null), `${id} authored surface is not bound to a production texture`);
    evidence.push({ id, renderProfile: profile });
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
  await writeFile(`${out}/${selected.length === 5 ? 'lab' : `lab-${selected.join('-')}`}.json`, JSON.stringify({ candidateAssets, evidence, pageErrors: driver.pageErrors, consoleErrors: driver.consoleErrors }, null, 2));
  await driver.close(); await server.close();
}

