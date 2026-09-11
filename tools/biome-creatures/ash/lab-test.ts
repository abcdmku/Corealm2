import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from '../../lib/driver.js';
import { startGameServer } from '../../lib/server.js';
import { installAssetCandidates } from '../../lib/assetCandidates.js';

const out = 'test-results/biome-creatures/ash';
await mkdir(out, { recursive: true });
const catalog = JSON.parse(await readFile(`${out}/catalog.json`, 'utf8'));
const args=process.argv.slice(2);
const subset=args.includes('--ids')?args[args.indexOf('--ids')+1]!.split(','):null;
const ids = subset ?? ['kiln_marrow', 'slag_crawler', 'cinder_penitent', 'grave_lantern', 'veil_reaper'];
const reportName=subset?'lab-final-surfaces':'lab';
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: any[] = [];
const started = performance.now();
let passed = false;
try {
  await driver.launch(); const page = driver.page!;
  await installAssetCandidates(page, `${out}/catalog.json`);
  await driver.open(60000, '/index.html?mode=combat&creatures=1&atmosphere=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  for (const id of ids) {
    const asset = catalog.assets.find((row: any) => row.id === `creature_${id}`);
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(['grave_lantern', 'veil_reaper'].includes(id) ? 'wilderness' : 'kilnhalt');
    await page.evaluate(async id => {
      const gallery = (window as any).__creatureGallery;
      await gallery.show(`candidate:${id}`, 1);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = gallery.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i]));
      (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw: -.35, pitch: .16, distance: Math.max(2.8, size * 1.80), detached: true });
    }, id);
    await page.waitForTimeout(650);
    await page.evaluate(() => { const g=(window as any).__creatureGallery,b=g.getBounds(),size=Math.max(...b.max.map((v:number,i:number)=>v-b.min[i])); (window.__gameDebug as any).inspectPose({x:0,y:(b.min[1]+b.max[1])/2,z:70,yaw:-.35,pitch:.14,distance:Math.max(2.8,size*1.6),detached:true}); });
    const profiles = await page.evaluate(id => {
      const debug = window.__gameDebug as any;
      return [id, 'wraith_', 'lava_', 'Cube', 'ghoul_'].map(prefix => debug.getRenderProfile(prefix));
    }, id);
    const draws = profiles.flatMap((p: any) => p.draws).filter((row: any) => row.pass.startsWith('colour'));
    const materials = draws.flatMap((row: any) => row.materials);
    assert(materials.some((material: any) => material.name.includes(id)), `${id} missing authored production material submissions`);
    const anatomyBindings = materials.filter((material: any) => material.name.includes(id) && /weathered_bone|layered_slag|oxidized_iron|ash_linen/.test(material.name));
    assert(anatomyBindings.length > 0 && anatomyBindings.every((material: any) => material.mapUuid), id + ' missing authored anatomy texture bindings');
    evidence.push({ id, hash: asset.sha256, materials, profiles });
    for (const motion of ['idle', 'walk', 'run', 'attack', 'hit']) {
      if(motion==='hit'){await page.locator('#creature-gallery-idle').click();await page.waitForTimeout(350);}
      await page.locator(`#creature-gallery-${motion}`).click();
      const duration = motion === 'attack' ? asset.attackSeconds : motion === 'walk' ? asset.walkClipSeconds : motion === 'run' ? asset.runClipSeconds : .7;
      const interval = Math.min(230, Math.max(90, duration * 1000 / 9));
      const samples: any[] = [];
      evidence.push({id,motion,samples});
      for (let i = 0; i < 9; i++) {
        await page.waitForTimeout(interval);
        const sample = await page.evaluate(() => {
          const gallery = (window as any).__creatureGallery, debug = window.__gameDebug as any, state = gallery.getState();
          return { state, bounds: gallery.getBounds(), motion: debug.getEntityMotion(state.entityIds[0]), drawn: debug.getDrawnBounds(state.entityIds[0]), ground: debug.groundHeight(0, 70) };
        });
        assert(sample.state.ready && sample.bounds && sample.motion && sample.drawn, `${id} ${motion} missing production rig`);
        const clearance = sample.bounds.min[1] - sample.ground;
        // Native run takes contain aerial phases. Penetration is checked separately from suspension.
        assert(clearance > -.085 && clearance < (motion === 'run' ? .48 : .25), `${id} ${motion} floor ${clearance}`);
        assert(sample.drawn.height > .2 && sample.drawn.height < 5, `${id} ${motion} collapsed or exploded rig`);
        samples.push({ ...sample, clearance });
        if (i === 2 || motion === 'attack' && i === 5) await page.screenshot({ path: `${out}/${id}-${motion}${i === 5 ? '-contact' : ''}.png` });
      }
      assert(new Set(samples.map(row => JSON.stringify(row.motion))).size > 1, `${id} ${motion} did not advance`);
      
    }
    await page.locator('#creature-gallery-idle').click();
    for (const [label, yaw] of [['front', 0], ['side', Math.PI / 2]] as const) {
      await page.evaluate(yaw => { const g = (window as any).__creatureGallery, b = g.getBounds(), size = Math.max(...b.max.map((v: number, i: number) => v - b.min[i])); (window.__gameDebug as any).inspectPose({ x: 0, y: (b.min[1] + b.max[1]) / 2, z: 70, yaw, pitch: .11, distance: Math.max(2.8, size * 1.8), detached: true }); }, yaw);
      await page.screenshot({ path: `${out}/${id}-${label}.png` });
    }
    await page.evaluate(async id => { const lab = window.__featureLab!; await lab.perform('reset-player'); lab.setFreeCameraEnabled(false); lab.setLevel('melee', 40); await lab.spawnTarget('creature', `candidate:${id}`, { distance: 3 }); }, id);
    await page.keyboard.press('l');
    const before = await page.evaluate(() => window.__featureLab!.getState());
    await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
    await page.waitForFunction(hp => (window.__featureLab!.getState().target?.health ?? hp) < hp, before.target!.health!, { timeout: 8000 });
    evidence.push({ id, combatBefore: before, combatAfter: await page.evaluate(() => window.__featureLab!.getState()) });
    await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
    console.log(`${id} production gallery, material submissions and real combat passed`);
  }
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(await page.evaluate(() => (window.__gameDebug as any).getErrors()), []);
  passed = true;
} finally {
  await writeFile(`${out}/${reportName}.json`, JSON.stringify({ passed, elapsedMs: performance.now() - started, evidence, pageErrors: driver.pageErrors, consoleErrors: driver.consoleErrors }, null, 2));
  await driver.close(); await server.close();
}


