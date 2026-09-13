import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GameDriver } from './lib/driver.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue } from './lib/paths.js';
import { FAIRY_GARDEN_VARIANTS } from '../game/src/content/fairyGardenCreatures.js';
import { FAIRY_MINIBOSS_FORMS } from '../game/src/content/fairyMinibossForms.js';
import { CAMERA } from '../game/src/app/config.js';

const args = process.argv.slice(2);
const region = argValue(args, '--region') ?? 'gloamgarden';
assert(['gloamgarden', 'faeholme'].includes(region));
const forms = (argValue(args, '--forms') ?? 'spriggle,imp,wardling').split(',');
const combat = args.includes('--combat'), pursuit = args.includes('--pursuit'), bosses = args.includes('--bosses');
const motions = (argValue(args, '--motions') ?? 'idle,walk,attack').split(',');
const selected = bosses
  ? FAIRY_MINIBOSS_FORMS.filter(f => f.regionId === region).map(f => ({ id: `guardian_${f.number}_fallowmarch`, assetId: f.source }))
  : FAIRY_GARDEN_VARIANTS.filter(f => f.regionId === region && (forms.includes('all') || forms.includes(f.family.slice(7))));
assert(selected.length, 'Select at least one creature');
const out = path.resolve('test-results/fairy-population/lab', region, argValue(args, '--out-name') ?? (bosses ? 'bosses' : `${forms.join('-')}${combat ? '-combat' : pursuit ? '-pursuit' : ''}`));
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: Record<string, any> = { region, combat, pursuit, startedAt: new Date().toISOString(), actors: {} };
const started = Date.now();
const deadline = setTimeout(() => { void driver.close(); }, combat ? 120_000 : 60_000);
try {
  await driver.launch();
  const page = driver.page!;
  const catalogPath = argValue(args, '--catalog') ?? `test-results/fairy-population/assets/lab-${region}.json`;
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  evidence.assets = selected.map(form => {
    const asset = catalog.assets.find((a: any) => a.id === form.assetId);
    if (args.includes('--generated')) assert(asset?.sourceProvenance?.generatedTexture, `${form.assetId}: generated UV artwork required`);
    return { id: form.assetId, sha256: asset?.sha256, generatedTexture: asset?.sourceProvenance?.generatedTexture };
  });
  await installAssetCandidates(page, catalogPath);
  await driver.open(30_000, '/index.html?mode=combat&creatures=1&atmosphere=1&startup-cache=0');
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(region);
  const pose = async (x: number, z: number, yaw = 0) => {
    await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch: .3, distance: CAMERA.minDistance, detached: false }]);
    await page.waitForTimeout(150);
  };
  const snapshot = async (id: string) => page.evaluate(id => {
    const d = window.__gameDebug as any;
    return { entity: d.getEntity(id), motion: d.getEntityMotion(id), bounds: d.getDrawnBounds(id),
      player: d.getPlayerPosition(), camera: d.getCamera(), lab: window.__featureLab!.getState() };
  }, id);
  const capture = async (id: string, name: string) => {
    const s = await snapshot(id);
    assert(s.bounds && s.motion, `${name}: production body and motion must exist`);
    assert.equal(s.camera.freeMove, false);
    assert(s.camera.requestedDistance >= CAMERA.minDistance && s.camera.requestedDistance <= CAMERA.maxDistance);
    assert(s.camera.pitch >= CAMERA.minPitch && s.camera.pitch <= CAMERA.maxPitch);
    assert(Math.abs(s.camera.target.x - s.player.x) < .02 && Math.abs(s.camera.target.z - s.player.z) < .02);
    return { ...s, screenshot: await driver.screenshot(out, name) };
  };
  for (const form of selected) {
    const preset = `species:${form.id}`;
    const actor: any = evidence.actors[form.id] = {};
    if (!combat && !pursuit) {
      await page.evaluate(async preset => {
        const g = (window as any).__creatureGallery;
        await g.show(preset, 1); g.place(0, 74, Math.PI * .2);
      }, preset);
      await pose(-1.3, 74);
      const id = await page.evaluate(() => (window as any).__creatureGallery.getState().entityIds[0]);
      for (const motion of motions) {
        await page.evaluate(m => (window as any).__creatureGallery.play(m), motion);
        await page.waitForTimeout(130);
        const before = await capture(id, `${form.id}-${motion}-a`);
        await page.waitForTimeout(210);
        const after = await capture(id, `${form.id}-${motion}-b`);
        assert.notDeepEqual(before.motion, after.motion, `${preset} ${motion} must advance`);
        actor[motion] = { before, after };
      }
    } else {
      await pose(0, 0);
      await page.evaluate(async preset => {
        const lab = window.__featureLab!;
        lab.setLevel('melee', 99);
        await lab.equipPlayer('mainHand', 'emberite_sword');
        await lab.spawnTarget('creature', preset, { distance: 3 });
      }, preset);
      const id = await page.evaluate(() => window.__featureLab!.getState().target!.entityId);
      actor.before = await capture(id, `${form.id}-alive`);
      await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
      await page.waitForFunction(() => {
        const t = window.__featureLab!.getState().target;
        return !!t && t.health !== null && t.maxHealth !== null && t.health < t.maxHealth;
      }, undefined, { timeout: 10_000 });
      actor.damaged = await snapshot(id);
      if (pursuit) {
        await page.evaluate(() => { window.__featureLab!.setWalkingEnabled(true); (document.activeElement as HTMLElement)?.blur(); });
        actor.pursuit = [];
        await page.keyboard.down('KeyS');
        try {
          for (let sample = 0; sample < 18; sample++) {
            await page.waitForTimeout(150);
            actor.pursuit.push({ at: Date.now(), ...await snapshot(id) });
            if (sample === 7 || sample === 15) await driver.screenshot(out, `${form.id}-pursuit-${sample}`);
          }
        } finally { await page.keyboard.up('KeyS'); }
        const running = actor.pursuit.filter((s: any) => s.motion?.motion === 'run');
        assert(running.length >= 3, `${form.id}: real fleeing input must elicit pursuit`);
        for (const s of running) {
          const cadence = s.motion.timeScale / s.motion.duration;
          assert(cadence <= 3.001, `${form.id}: run cadence ${cadence}Hz exceeds 3Hz`);
          if (form.id.includes('_imp_')) assert.equal(s.motion.timeScale, 1, 'Hover wings keep their native playback');
        }
        assert.notDeepEqual(running[0].entity.position, running.at(-1).entity.position, 'Pursuit must move the production actor');
        if (!combat) continue;
        await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
      }
      await page.waitForFunction(() => window.__featureLab!.getState().target?.state === 'dead', undefined, { timeout: 45_000 });
      // Let the production death pose and workbench refresh reach a rendered frame.
      await page.waitForTimeout(450);
      actor.dead = await capture(id, `${form.id}-dead`);
      assert.equal(actor.dead.lab.target.health, 0);
      assert(actor.dead.lab.target.ai.respawnInMs > 29_000);
    }
  }
  await page.evaluate(() => { window.__featureLab!.setWalkingEnabled(true); (document.activeElement as HTMLElement)?.blur(); });
  const before = await driver.callDebug('getPlayerPosition');
  await driver.press('KeyD', 400);
  const after = await driver.callDebug('getPlayerPosition');
  assert.notDeepEqual(before, after, 'Real WASD movement');
  evidence.movement = { before, after };
  evidence.errors = { game: await driver.callDebug('getErrors'), page: driver.pageErrors, console: driver.consoleErrors };
  assert.deepEqual(evidence.errors, { game: [], page: [], console: [] });
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error);
  evidence.errors = { page: driver.pageErrors, console: driver.consoleErrors };
  await driver.screenshot(out, 'failure').catch(() => {});
  throw error;
} finally {
  clearTimeout(deadline);
  evidence.elapsedMs = Date.now() - started;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(evidence, null, 2));
  await driver.close();
  console.log(JSON.stringify({ out, passed: evidence.passed, elapsedMs: evidence.elapsedMs, failure: evidence.failure }));
}
