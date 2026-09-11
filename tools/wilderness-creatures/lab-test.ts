import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { WILDERNESS_CREATURE_SPECIES } from '../../game/src/content/wildernessCreatureSpecies.js';
import { WILDERNESS_RUNE_KEEPERS } from '../../game/src/content/wildernessDepth.js';
import { CREATURE_REDESIGNS } from '../../game/src/content/creatureRedesign.js';
import { RPG_BESTIARY_REVIEW_BY_ID } from '../../game/src/content/rpgBestiary.js';
import { CREATURE_SPECIES } from '../../game/src/content/creatureSpecies.js';

// Root runs one bounded batch at a time in the serialized browser lane.
const value = (flag: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
const batches: Record<string, string[]> = {
  shallow: ['cinderback_crag', 'furnace_grazer', 'basalt_maw'],
  deep: ['rift_carapace', 'voidstone_colossus', 'gloam_wraith'],
  shallow_keepers: ['ashseal_warden', 'furnace_regent'],
  deep_keepers: ['chainbound_archon', 'nightforge_marshal', 'hollow_star'],
};
const batch = value('--batch') ?? 'shallow';
const ids = value('--ids')?.split(',') ?? batches[batch];
assert(ids?.length && ids.length <= 3, 'Choose a batch of one to three actors');
const catalogPath = value('--catalog') ?? 'test-results/wilderness-creatures/catalog.json';
const allKeyPoses = process.argv.includes('--key-poses');
const keyPoseIds = new Set((value('--key-pose-ids') ?? '').split(',').filter(Boolean));
const output = `test-results/wilderness-creatures/lab-${batch}`;
await mkdir(output, { recursive: true });
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const external = value('--url');
const server = external ? { url: external, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1280, height: 800 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const started = performance.now(), evidence: any[] = [];
let passed = false;
let activeId = '';
let failure: any = null;
let latestProfile: any = null;
const deadline = setTimeout(() => { void driver.close(); }, 52_000);
function checkEffects(state: any, subject: string, palette: 'arcane' | 'ember', required = true): void {
  assert(state?.ready && state.enabled, 'Production Wilderness creature effects unavailable');
  assert(state.emitterBudget === 16 && state.particleBudget === 384, 'Unexpected production effect budget');
  assert(state.emitters.length <= state.emitterBudget && state.liveParticles <= state.particleBudget, 'Creature effect budget exceeded');
  assert(new Set(state.emitters.map((emitter: any) => emitter.id)).size === state.emitters.length, 'Duplicate creature emitters');
  for (const emitter of state.emitters) assert(emitter.particles >= 0 && emitter.particles <= (emitter.hero ? 24 : 18), `${emitter.id} exceeded its particle allowance`);
  const emitter = state.emitters.find((emitter: any) => emitter.id === subject);
  if (required) {
    assert(emitter && emitter.particles > 0, `${subject} missing visible body fragments`);
    assert.equal(emitter.palette, palette, `${subject} wrong fragment palette`);
  }
}
try {
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(5000);
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await installAssetCandidates(page, catalogPath);
  await driver.open(45_000, '/index.html?mode=combat&creatures=1&atmosphere=1&wildernessCreatures=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  for (const id of ids) {
    activeId = id;
    const keyPosesOnly = allKeyPoses || keyPoseIds.has(id);
    const asset = catalog.assets.find((row: any) => row.id === `creature_${id}`);
    assert(asset, `Missing staged ${id}`);
    const species = WILDERNESS_CREATURE_SPECIES.find(species => species.id === id)
      ?? CREATURE_REDESIGNS.find(species => species.id === id) ?? RPG_BESTIARY_REVIEW_BY_ID.get(id)
      ?? CREATURE_SPECIES.find(species => species.id === id);
    assert(species, `Unknown Wilderness species ${id}`);
    const hasBodyEffects = WILDERNESS_CREATURE_SPECIES.some(species => species.id === id);
    const deep = species.stats.tier >= 70;
    const palette = deep ? 'arcane' : 'ember';
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(deep ? 'deep_wilderness' : 'wilderness');
    await page.waitForFunction(deep => {
      const state = (window as any).__biomeAtmosphereLab.getState();
      return state.preview === 'wilderness' && state.sky.night > .98 && (deep ? state.sky.magic > .98 : state.sky.magic < .02);
    }, deep, { timeout: 15_000 });
    const viewDistance = Math.max(6, Math.min(11, 5 + asset.size.y * 1.5));
    await page.evaluate(async ({ id, distance }) => {
      await (window as any).__creatureGallery.show(`candidate:${id}`, 1);
      // Place the player beside the subject. Camera target is always the player's normal head.
      const debug = window.__gameDebug as any;
      debug.inspectPose({ x: -2.2, y: debug.groundHeight(-2.2, 73), z: 73, yaw: .15, pitch: .40, distance });
    }, { id, distance: viewDistance });
    await page.waitForTimeout(200);
    await page.waitForFunction(id => {
      const gallery = (window as any).__creatureGallery, debug = window.__gameDebug as any;
      const state = gallery.getState(), shaders = (window as any).__renderDistanceLab?.shaders?.();
      const drawn = debug.getDrawnBounds(state.entityIds[0]);
      const motion = debug.getEntityMotion(state.entityIds[0]);
      return state.ready && drawn && (motion?.liveRig || motion?.path === 'sampled-rig' && motion.clip) &&
        (!shaders || !shaders.waiting && !shaders.queued && !shaders.compiling);
    }, id, { timeout: 15_000 });
    await page.waitForFunction(() => {
      const select = document.querySelector<HTMLSelectElement>('#creature-gallery-preset');
      return select?.value === (window as any).__creatureGallery.getState().presetId && !!select?.selectedOptions[0]?.textContent;
    });
    const materialNames = new Set<string>(asset.materials);
    const isAssetMaterial = (name: string) => materialNames.has(name) || materialNames.has(name.split('@art:')[0]!);
    // Complete source bodies retain native node names. Query their actual mesh prefixes;
    // the unfiltered debug result intentionally returns only the largest 40 draws.
    const source = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.resolve(path.dirname(catalogPath), catalog.files[asset.id]));
    const prefixes = [...new Set([id, ...source.getRoot().listNodes().filter(node => node.getMesh())
      .map(node => node.getName().replace(/[\s.:[\]]/g, '_').split('_').slice(0, 3).join('_')).filter(Boolean)])];
    const profile = () => page.evaluate(prefixes => {
      const d=window.__gameDebug as any, overview=d.getRenderProfile();
      return {...overview,draws:[...overview.draws,...prefixes.flatMap(prefix=>d.getRenderProfile(prefix).draws)]};
    }, prefixes);
    const initialProfile = await profile();
    latestProfile = { prefixes, materialNames: [...materialNames], profile: initialProfile };
    assert(initialProfile.draws.some((draw: any) => draw.pass.startsWith('colour') && draw.materials.some((material: any) => isAssetMaterial(material.name))), `${id} missing actual colour submissions`);
    const baseline = await page.evaluate(() => {
      const gallery = (window as any).__creatureGallery, debug = window.__gameDebug as any;
      const state = gallery.getState();
      return { atmosphere: (window as any).__biomeAtmosphereLab.getState(), effects: (window as any).__wildernessCreatureEffects.getState(),
        entity: debug.getEntity(state.entityIds[0]), subjectId: state.entityIds[0] };
    });
    if (hasBodyEffects) checkEffects(baseline.effects, baseline.subjectId, palette);
    const keeper = WILDERNESS_RUNE_KEEPERS.some(keeper => keeper.id === id);
    assert.equal(baseline.entity.archetype === 'boss', keeper, `${id} wrong candidate rank`);
    if (hasBodyEffects) assert.equal(baseline.effects.emitters.find((emitter: any) => emitter.id === baseline.subjectId).hero, keeper, `${id} wrong production emitter rank`);
    const row: any = { id, sha256: asset.sha256, mode: keyPosesOnly ? 'material-key-poses' : 'full-cycles', tier: species.stats.tier, palette, baseline, initialProfile, motions: [] };
    evidence.push(row);
    for (const motion of keyPosesOnly ? ['idle', 'run', 'attack', 'hit'] : ['idle', 'walk', 'run', 'attack', 'hit']) {
      if (motion === 'hit') {
        // Observe production recovery before requesting a reaction; do not cancel Attack.
        await page.waitForFunction(() => {
          const state = (window as any).__creatureGallery.getState();
          return (window.__gameDebug as any).getEntityMotion(state.entityIds[0])?.clip !== 'Attack';
        }, undefined, { timeout: 5000 });
        await page.locator('#creature-gallery-idle').click();
        await page.waitForTimeout(100);
      }
      await page.locator(`#creature-gallery-${motion}`).click();
      const initialMotion = await page.evaluate(() => {
        const state = (window as any).__creatureGallery.getState();
        return (window.__gameDebug as any).getEntityMotion(state.entityIds[0]);
      });
      const fallback = motion === 'attack' ? asset.attackSeconds : motion === 'walk' ? asset.walkClipSeconds : motion === 'run' ? asset.runClipSeconds : .6;
      const seconds = motion === 'idle' ? .8 : motion === 'hit' && initialMotion.hitOverlay
        ? initialMotion.hitOverlay.duration : (initialMotion.duration ?? fallback) / Math.max(.1, initialMotion.timeScale ?? 1);
      // Locomotion is slowed by production stride matching. Sample its actual wall-clock
      // period plus a wrap, rather than clamping a long walk to a partial source cycle.
      const interval = Math.max(45, seconds * (keyPosesOnly && motion === 'run' ? 650 : 1120) / 7);
      const samples: any[] = [];
      for (let index = 0; index < 7; index++) {
        await page.waitForTimeout(interval);
        const sample = await page.evaluate(() => {
          const gallery = (window as any).__creatureGallery, debug = window.__gameDebug as any, state = gallery.getState();
          return { state, motion: debug.getEntityMotion(state.entityIds[0]), bounds: gallery.getBounds(),
            drawn: debug.getDrawnBounds(state.entityIds[0]), camera: debug.getCamera(), player: debug.getPlayerPosition(),
            effects: (window as any).__wildernessCreatureEffects.getState(), ground: debug.groundHeight(0, 70) };
        });
        assert(sample.state.ready && sample.drawn && sample.bounds && sample.motion, `${id}:${motion} unavailable`);
        assert(sample.camera.freeMove === false, `${id} detached camera`);
        assert(sample.camera.requestedDistance >= 6 && sample.camera.requestedDistance <= 11, `${id} noninteractive zoom`);
        assert(sample.camera.pitch >= .18 && sample.camera.pitch <= 1.32, `${id} noninteractive pitch`);
        assert(Math.abs(sample.camera.target.x - sample.player.x) < .1 && Math.abs(sample.camera.target.z - sample.player.z) < .1, `${id} camera lost player focus`);
        if (hasBodyEffects) checkEffects(sample.effects, sample.state.entityIds[0], palette);
        // Sampled rigs expose conservative all-pose bounds. Their evaluated vertex
        // contact is the actual current-pose floor measurement.
        const clearance = sample.motion.path === 'sampled-rig'
          ? sample.motion.terrainContact?.minVertexClearance : sample.bounds.min[1] - sample.ground;
        assert(Number.isFinite(clearance), `${id}:${motion} missing evaluated floor contact`);
        assert(clearance > -.10 && clearance < .55, `${id}:${motion} floor clearance ${clearance}`);
        assert(sample.drawn.height > .45 && sample.drawn.height < 9, `${id}:${motion} collapsed or exploded`);
        samples.push({ ...sample, clearance });
        if (index === 2 || ['walk', 'run', 'attack'].includes(motion) && [0, 5, 6].includes(index)) {
          await page.screenshot({ path: `${output}/${id}-${motion}-${index}.png` });
        }
      }
      assert(new Set(samples.map(sample => JSON.stringify(sample.motion))).size > 1, `${id}:${motion} did not advance`);
      let clipCycles: number | null = null;
      if (motion === 'walk' || motion === 'run') {
        const clip = motion === 'walk' ? 'Walk' : 'Run';
        const states = [initialMotion, ...samples.map(sample => sample.motion)];
        assert(states.every(state => state.clip === clip), `${id}:${motion} left its requested locomotion clip`);
        const elapsedClipTime = states.slice(1).reduce((total, state, index) => {
          const delta = state.time - states[index].time;
          return total + (delta < 0 ? delta + state.duration : delta);
        }, 0);
        clipCycles = elapsedClipTime / initialMotion.duration;
        if (!keyPosesOnly) assert(clipCycles >= .99, `${id}:${motion} covered only ${clipCycles} cycles`);
      }
      if (motion === 'attack') assert(samples.some(sample => sample.motion.clip !== 'Attack'), `${id} protected attack never recovered`);
      if (motion === 'hit') assert([initialMotion, ...samples.map(sample => sample.motion)].some(state => /^Hit/.test(state.clip ?? '') || /^Hit/.test(state.hitOverlay?.clip ?? '')), `${id} did not enter a real Hit reaction`);
      row.motions.push({ motion, initialMotion, samples, sampledSeconds: interval * 7 / 1000, clipCycles,
        attackRecovered: motion === 'attack' ? samples.some(sample => sample.motion.clip !== 'Attack') : undefined });
    }
    await page.locator('#creature-gallery-idle').click();
    // An actual orbit drag proves the second view uses interactive camera controls.
    const beforeCamera = await driver.callDebug('getCamera');
    await driver.drag(1010, 400, 885, 400, 'right');
    await driver.moveMouse(1180, 650);
    await page.waitForTimeout(250);
    row.beforeCamera = beforeCamera;
    row.afterCamera = await driver.callDebug('getCamera');
    assert.notEqual(row.afterCamera.yaw, row.beforeCamera.yaw, `${id} real orbit did not move`);
    row.profile = await profile();
    const materials = row.profile.draws.filter((draw: any) => draw.pass.startsWith('colour'))
      .flatMap((draw: any) => draw.materials).filter((material: any) => isAssetMaterial(material.name));
    assert(materials.some((material: any) => material.mapUuid), `${id} authored texture missing from actual colour submissions`);
    row.materials = materials;
    await page.screenshot({ path: `${output}/${id}-orbit.png` });
    // Move through the existing fixture API. Emitters must follow drawn production actors and
    // disappear beyond the real distance/frustum boundary; the driver never writes world state.
    if (hasBodyEffects) {
    const effectsBefore = await page.evaluate(() => (window as any).__wildernessCreatureEffects.getState());
    await page.evaluate(() => (window as any).__creatureGallery.place(2, 70));
    await page.waitForFunction(subject => {
      const emitter = (window as any).__wildernessCreatureEffects.getState().emitters.find((row: any) => row.id === subject);
      return emitter && Math.abs(emitter.position.x - 2) < .10;
    }, baseline.subjectId, { timeout: 5000 });
    const effectsMoved = await page.evaluate(() => (window as any).__wildernessCreatureEffects.getState());
    checkEffects(effectsMoved, baseline.subjectId, palette);
    const beforeEmitter = effectsBefore.emitters.find((emitter: any) => emitter.id === baseline.subjectId);
    const movedEmitter = effectsMoved.emitters.find((emitter: any) => emitter.id === baseline.subjectId);
    assert(beforeEmitter && Math.abs(movedEmitter.position.x - beforeEmitter.position.x) > 1, `${id} emitter did not follow fixture movement`);
    await page.evaluate(() => (window as any).__creatureGallery.place(95, 70));
    await page.waitForFunction(subject => !(window as any).__wildernessCreatureEffects.getState().emitters.some((row: any) => row.id === subject), baseline.subjectId, { timeout: 5000 });
    const effectsCulled = await page.evaluate(() => (window as any).__wildernessCreatureEffects.getState());
    checkEffects(effectsCulled, baseline.subjectId, palette, false);
    await page.evaluate(() => (window as any).__creatureGallery.place(0, 70));
    await page.waitForFunction(subject => (window as any).__wildernessCreatureEffects.getState().emitters.some((row: any) => row.id === subject && row.particles > 0), baseline.subjectId, { timeout: 5000 });
    const effectsReturned = await page.evaluate(() => (window as any).__wildernessCreatureEffects.getState());
    checkEffects(effectsReturned, baseline.subjectId, palette);
    row.effectsMovement = { before: effectsBefore, moved: effectsMoved, culled: effectsCulled, returned: effectsReturned };
    }
    process.stdout.write(`${id}: production material draws and ${keyPosesOnly ? 'material key poses' : 'five complete actions'} recorded\n`);
  }
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(await driver.callDebug('getErrors'), []);
  passed = true;
} catch (error) {
  failure = { id: activeId, error: String(error), latestProfile };
  if (driver.page && !driver.page.isClosed()) {
    failure.state = await driver.page.evaluate(id => {
      const debug = window.__gameDebug as any, gallery = (window as any).__creatureGallery;
      const state = gallery?.getState();
      return { gallery: state, shaders: (window as any).__renderDistanceLab?.shaders?.(),
        residency: debug.getEntityViewStats?.(), drawn: state?.entityIds.map((id: string) => debug.getDrawnBounds(id)),
        motions: state?.entityIds.map((id: string) => debug.getEntityMotion(id)), profile: debug.getRenderProfile(id),
        effects: (window as any).__wildernessCreatureEffects?.getState(), atmosphere: (window as any).__biomeAtmosphereLab?.getState() };
    }, activeId).catch(error => ({ unavailable: String(error) }));
    await driver.page.screenshot({ path: `${output}/failure-${activeId}.png` }).catch(() => {});
  }
  throw error;
} finally {
  clearTimeout(deadline);
  await writeFile(`${output}/report.json`, JSON.stringify({ passed, mode: allKeyPoses ? 'material-key-poses' : keyPoseIds.size ? 'mixed' : 'full-cycles', elapsedMs: performance.now() - started,
    evidence, failure, pageErrors: driver.pageErrors, consoleErrors: driver.consoleErrors }, null, 2));
  await driver.close();
  await server.close();
}
