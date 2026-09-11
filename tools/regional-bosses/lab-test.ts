/** Root-scheduled hardware lane. Candidate gallery plus a real production melee action. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { CAMERA } from '../../game/src/app/config.js';

const all = ['tempest_roc', 'galeskin', 'rootheart', 'mossbound', 'tideworn', 'ordrun', 'cinderwake'];
const orbitOnly = process.argv.includes('--orbit-only');
const hitOnly = process.argv.includes('--hit-only');
const selected = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.split(',') : all.slice(0, 2);
assert(orbitOnly || hitOnly || selected.length <= 2, 'Full production gait cycles require batches of at most two bosses inside 60 seconds.');
const name = selected.join('-'), out = `test-results/regional-bosses/lab-${name}${orbitOnly ? '-orbit' : hitOnly ? '-hit' : ''}`;
const started = Date.now(), evidence: any[] = [];
const timer = setTimeout(() => { console.error('Regional boss lab exceeded 60 seconds including cleanup.'); process.exit(124); }, 60_000);
timer.unref();
await mkdir(out, { recursive: true });
const catalog = JSON.parse(await readFile('test-results/regional-bosses/catalog.json', 'utf8'));
const server = await startGameServer({ hmr: false });
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  await driver.launch(); const page = driver.page!;
  page.setDefaultTimeout(5000);
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await installAssetCandidates(page, 'test-results/regional-bosses/catalog.json');
  await driver.open(30_000, '/index.html?mode=combat&creatures=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  for (const id of selected) {
    assert(all.includes(id), `Unknown hero ${id}`);
    await page.evaluate(async id => {
      const gallery = (window as any).__creatureGallery;
      await gallery.show(`candidate:boss_${id}`, 1);
      gallery.place(0, 70, .18);
      const d = window.__gameDebug as any;
      d.inspectPose({ x: 0, y: d.groundHeight(0, 74), z: 74, yaw: .38, pitch: .40, distance: 8 });
    }, id);
    await page.waitForTimeout(200);
    await page.waitForFunction(() => {
      const d = window.__gameDebug as any, gallery = (window as any).__creatureGallery;
      const state = gallery.getState(), shaders = (window as any).__renderDistanceLab?.shaders();
      return state.ready && d.getDrawnBounds(state.entityIds[0]) && (!shaders || (!shaders.waiting && !shaders.queued && !shaders.compiling));
    }, undefined, { timeout: 15_000 });
    const reactions = hitOnly && (id === 'tempest_roc' || id === 'tideworn') ? ['hit', 'hit-right'] : ['hit'];
    for (const label of (orbitOnly ? [] : hitOnly ? reactions : ['idle', 'walk', 'run', 'attack', 'hit'])) {
      const motion = label === 'hit-right' ? 'hit' : label;
      const impactSide = label === 'hit-right' ? 'right' : 'front';
      const entry = catalog.assets.find((a: any) => a.id === `creature_boss_${id}`);
      const clip = entry.metadata.redesign.measurement.clips.find((clip: any) => clip.name.toLowerCase() === (label === 'hit-right' ? 'hitright' : motion));
      const duration = clip.duration as number;
      // Full-cycle Attack sampling already reaches its end. Allow the production action
      // state to settle before checking Hit, rather than recording its protected Attack.
      if (motion === 'hit' && !hitOnly) await page.waitForTimeout(150);
      if (impactSide === 'right') await page.evaluate(() => (window as any).__creatureGallery.play('hit', 'right'));
      else await page.locator(`#creature-gallery-${motion}`).click();
      await page.waitForTimeout(35);
      const initialMotion = await page.evaluate(() => {
        const g = (window as any).__creatureGallery;
        return (window.__gameDebug as any).getEntityMotion(g.getState().entityIds[0]);
      });
      const playbackSeconds = motion === 'hit' ? (initialMotion.hitOverlay?.duration ?? duration)
        : duration / initialMotion.timeScale;
      assert(Number.isFinite(playbackSeconds) && playbackSeconds > 0 && playbackSeconds < 8, `${id} ${motion} invalid live playback duration`);
      const samples: any[] = [];
      const record = { id, motion, impactSide, cycleSeconds: duration, playbackSeconds, observedMs: 0, samples };
      evidence.push(record);
      const cycleStarted = Date.now();
      for (let i = 0; i <= 8; i++) {
        if (i > 0) await page.waitForTimeout(Math.max(0, cycleStarted + playbackSeconds * 1000 * i / 8 - Date.now()));
        const sample = await page.evaluate(() => {
          const d = window.__gameDebug as any, g = (window as any).__creatureGallery, s = g.getState();
          return { capturedAtMs: performance.now(), state: s, camera: d.getCamera(), player: d.getPlayerPosition(), bounds: g.getBounds(), motion: d.getEntityMotion(s.entityIds[0]), drawn: d.getDrawnBounds(s.entityIds[0]), entity: d.getEntity(s.entityIds[0]), ground: d.groundHeight(0, 70) };
        });
        assert(sample.state.ready && sample.motion && sample.bounds && sample.drawn, `${id} ${motion} actual rig missing`);
        assert(sample.camera.distance >= CAMERA.minDistance && sample.camera.distance <= CAMERA.maxDistance, `${id} gameplay zoom`);
        assert(sample.camera.pitch >= CAMERA.minPitch && sample.camera.pitch <= CAMERA.maxPitch, `${id} gameplay pitch`);
        assert.equal(sample.camera.freeMove, false, `${id} detached camera`);
        assert(Math.abs(sample.camera.target.x - sample.player.x) < .1 && Math.abs(sample.camera.target.z - sample.player.z) < .1, `${id} player-follow focus`);
        const clearance = sample.bounds.min[1] - sample.ground;
        samples.push({ ...sample, clearance });
        if (!(clearance > -.10 && clearance < .15)) await page.screenshot({ path: `${out}/${id}-${label}-failure.png` });
        assert(clearance > -.10 && clearance < .15, `${id} ${motion} floor clearance ${clearance}`);
        assert(sample.drawn.height > 1 && sample.drawn.height < 7, `${id} ${motion} collapsed/exploded rig`);
        if (i === 1 || (motion === 'attack' && (i === 3 || i === 6))) await page.screenshot({ path: `${out}/${id}-${label}-${i}.png` });
      }
      assert(new Set(samples.map(s => JSON.stringify(s.motion))).size > 1, `${id} ${motion} frozen`);
      const observedMs = samples.at(-1)!.capturedAtMs - samples[0].capturedAtMs;
      record.observedMs = observedMs;
      assert(observedMs >= playbackSeconds * 1000 - 25, `${id} ${motion} did not span the full clip duration`);
      if (['walk', 'run', 'attack'].includes(motion)) {
        const active = samples.filter(s => (s.motion.clip ?? '').toLowerCase() === motion);
        assert(active.some(s => s.motion.time >= duration * .78), `${id} ${motion} final action phase missing`);
      }
      if (motion === 'hit') {
        const overlays = samples.map(s => s.motion.hitOverlay).filter(Boolean);
        assert(overlays.length >= 3, `${id} did not enter a sustained hit reaction`);
        assert(overlays.every(o => o.active && /^Hit/.test(o.clip) && o.bones.length > 0 && o.maskStatus === 'native-masked'), `${id} native hit bones missing`);
        if (impactSide === 'right') assert(overlays.every(o => o.clip.startsWith('HitRight')), `${id} right-side reaction not selected`);
        assert(overlays.some(o => o.weight > .5) && overlays.some(o => o.time > o.duration * .6), `${id} hit progression missing`);
        assert.equal(samples.at(-1)!.motion.hitOverlay, null, `${id} hit reaction did not finish`);
      }
    }
    if (hitOnly) continue;
    await page.locator('#creature-gallery-idle').click();
    // A second view comes from the real right-button orbit control; focus stays on the player.
    await page.mouse.move(1100, 500); await page.mouse.down({ button: 'right' });
    await page.mouse.move(960, 490, { steps: 10 }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${id}-orbit.png` });
    const orbit = await driver.callDebug('getCamera') as any;
    assert.equal(orbit.freeMove, false, `${id} orbit kept player focus`);
    assert(orbit.requestedDistance >= CAMERA.minDistance && orbit.requestedDistance <= CAMERA.maxDistance, `${id} orbit gameplay zoom`);
    evidence.push({ id, orbit });
    console.log(`${id}: ${orbitOnly ? 'normal orbit' : 'idle, walk, run, attack, hit and normal orbit'} recorded`);
  }
  if (!orbitOnly && !hitOnly) {
  const combatId = selected.at(-1)!;
  await page.evaluate(async id => {
    const lab = window.__featureLab!;
    await lab.perform('reset-player'); lab.setFreeCameraEnabled(false); lab.setLevel('melee', 50);
    await lab.spawnTarget('creature', `candidate:boss_${id}`, { distance: 3 });
  }, combatId);
  await page.keyboard.press('l');
  const before = await page.evaluate(() => window.__featureLab!.getState());
  await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
  await page.waitForFunction(hp => (window.__featureLab!.getState().target?.health ?? hp) < hp, before.target!.health!, { timeout: 8000 });
  evidence.push({ id: combatId, combatBefore: before, combatAfter: await page.evaluate(() => window.__featureLab!.getState()) });
  }
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); assert.deepEqual(await driver.callDebug('getErrors'), []);
} finally {
  await writeFile(`${out}/lab.json`, JSON.stringify({ elapsedMs: Date.now() - started, candidateHashes: Object.fromEntries(catalog.assets.map((a: any) => [a.id, a.sha256])), evidence, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors }, null, 2));
  await driver.close(); await server.close(); clearTimeout(timer);
}
