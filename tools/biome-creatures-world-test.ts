/** Final-world wiring after the three creature cohorts passed their production lab gates.
 * Root-scheduled hardware run: npx tsx tools/biome-creatures-world-test.ts
 * Owns its Vite server and browser. Art acceptance still requires screenshot inspection.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameDriver } from './lib/driver.js';
import { startGameServer, type RunningGameServer } from './lib/server.js';
import { CAMERA, PLAYER_RADIUS } from '../game/src/app/config.js';
import { REGIONS } from '../game/src/content/regions.js';
import { BIOME_POPULATION, BIOME_POPULATION_LEGACY_REPLACEMENTS } from '../game/src/content/biomePopulation.js';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import { inStarterWildlifeArea, isStarterAnimalAsset } from '../game/src/content/fantasyEncounters.js';

const out = 'test-results/biome-creatures-world';
const started = Date.now(), budgetMs = 120_000;
const shots = [
  { groupId: 'population_blackwater_south_crawlers', name: 'vellenwood-fen-crawlers', yaw: .95 },
  { groupId: 'population_far_tarn_mandibles', name: 'karrowmoor-flint-mandibles', yaw: .95 },
  { groupId: 'population_emberfast_east_penitents', name: 'kilnhalt-cinder-penitents', yaw: .95 },
] as const;
const combatGroupId = 'regional_gloam_fox';
const authored = REGIONS.flatMap(region => [
  ...region.enemyGroups.map(group => ({ ...group, regionId: region.id })),
  ...(region.dungeon?.enemyGroups.map(group => ({ ...group, regionId: region.dungeon!.id })) ?? []),
]);
const byGroup = new Map(authored.map(group => [group.id, group]));
const speciesById = new Map(CREATURE_SPECIES.map(species => [species.id, species]));
const redesigned = [...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS];
const report: any = {
  passed: false, budgetMs, startedAt: new Date(started).toISOString(),
  scope: 'Live roster for 56 added packs, original remapped groups, animal confinement, three regional pack views, mouse combat and 390px mobile world/map.',
  exception: 'Final-world placement and wiring follow already accepted isolated creature lab proof.',
  setup: 'Fresh save; photos use melee 1, magic 99 for survival health, empty main hand and setup healing. Packs preload from dry ground beyond nearby aggro ranges before the close normal camera. Melee 99 and the starter sword are enabled only for the separate mouse-combat case. Production player-follow camera, settings and timeScale 1.',
  visualAcceptance: 'Pending root screenshot inspection. Residency and projected bounds do not prove an unobstructed or attractive view.',
  captures: [], packs: [], legacy: [], errors: {},
};
let server: RunningGameServer | undefined, driver: GameDriver | undefined;
let softTimer: ReturnType<typeof setTimeout> | undefined;
// The work deadline reserves ten seconds for finally to close both owned resources and save evidence.
const hardTimer = setTimeout(() => { console.error('Creature world cleanup exceeded 120 seconds'); process.exit(124); }, budgetMs);
hardTimer.unref();
function timeLeft(max: number): number {
  const left = 110_000 - (Date.now() - started);
  assert(left > 0, 'Creature world work exceeded 110 seconds; cleanup reserved');
  return Math.min(max, left);
}

async function run(): Promise<void> {
  assert.equal(BIOME_POPULATION.length, 56, 'Authored added pack count');
  assert.equal(BIOME_POPULATION.reduce((count, pack) => count + pack.count, 0), 154, 'Authored added residents');
  assert.equal(new Set(redesigned.map(species => species.id)).size, 15, 'Accepted redesigned species count');
  server = await startGameServer({ hmr: false });
  driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
    browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(5000);
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  await driver.open(timeLeft(55_000), '/index.html');
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  assert(!/swiftshader|llvmpipe|software|unavailable/i.test(report.renderer), 'Hardware rendering required for visual evidence');

  const roster: any[] = await page.evaluate(() => {
    const d: any = window.__gameDebug;
    return d.listEntities().filter((e: any) => e.combat || e.view?.assetId?.startsWith('animal_')
      || /^creature_(redbrush_fox|marchwild_horse|reedbank_goose|marchfield_turkey|field_wasp|heath_wasp|reed_wasp)$/.test(e.view?.assetId ?? '')).map((e: any) => ({
      id: e.id, groupId: e.meta?.groupId, archetype: e.archetype, family: e.meta?.family,
      regionId: e.regionId, tier: e.tier, state: e.state, position: e.position,
      assetId: e.view?.assetId, scale: e.view?.scale, materialTier: e.view?.materialTier,
      health: e.combat?.health, maxHealth: e.combat?.maxHealth,
      surface: e.regionId === 'gravelmaw' ? null : d.sampleWorld(e.position[0], e.position[2]),
    }));
  });
  const rowsFor = (id: string) => roster.filter(actor => actor.groupId === id);
  function verifyGroup(groupId: string, expectedSpeciesId: string, population: boolean): void {
    const group = byGroup.get(groupId), species = speciesById.get(expectedSpeciesId);
    assert(group && species, `Missing authored group/species ${groupId}/${expectedSpeciesId}`);
    const actors = rowsFor(groupId);
    const row = { groupId, speciesId: expectedSpeciesId, expected: group, actors };
    (population ? report.packs : report.legacy).push(row);
    assert.equal(actors.length, group.count, `${groupId}: resident count`);
    assert.equal(group.assetId, species.assetId, `${groupId}: accepted authored body`);
    for (const actor of actors) {
      assert.equal(actor.assetId, species.assetId, `${actor.id}: live model`);
      assert.equal(actor.family, species.stats.family, `${actor.id}: live family`);
      assert.equal(actor.regionId, group.regionId, `${actor.id}: live region`);
      assert.equal(actor.tier, group.tier, `${actor.id}: preserved/authored tier`);
      assert.equal(actor.materialTier, group.tier, `${actor.id}: material tier`);
      assert(actor.health > 0 && actor.maxHealth > 0, `${actor.id}: alive on fresh boot`);
      if (population) {
        assert.equal(actor.scale, species.scale, `${actor.id}: body scale`);
        assert(actor.surface?.playable && !actor.surface.waterBodyId, `${actor.id}: dry playable spawn`);
      }
    }
  }
  for (const pack of BIOME_POPULATION) {
    const group = byGroup.get(pack.id);
    assert(group, `Population ${pack.id} is absent from REGIONS`);
    assert.equal(group.count, pack.count, `${pack.id}: population count survives projection`);
    assert.equal(group.regionId, pack.regionId, `${pack.id}: population region survives projection`);
    verifyGroup(pack.id, pack.speciesId, true);
  }
  assert.equal(report.packs.reduce((count: number, pack: any) => count + pack.actors.length, 0), 154, 'Actual added residents');
  for (const [groupId, speciesId] of Object.entries(BIOME_POPULATION_LEGACY_REPLACEMENTS)) verifyGroup(groupId, speciesId, false);
  report.speciesCoverage = redesigned.map(species => ({ id: species.id, assetId: species.assetId,
    residents: roster.filter(actor => actor.assetId === species.assetId).length }));
  for (const species of report.speciesCoverage) assert(species.residents > 0, `${species.id}: promoted body has live residents`);
  report.animals = roster.filter(actor => isStarterAnimalAsset(actor.assetId ?? ''));
  for (const animal of report.animals) assert(inStarterWildlifeArea(animal.regionId, [animal.position[0], animal.position[2]]), `${animal.id}: animal leaked outside starter area`);
  report.roster = { combatActors: roster.filter(actor => actor.health !== undefined).length,
    addedGroups: report.packs.length, addedResidents: 154, remappedGroups: report.legacy.length, starterAnimals: report.animals.length };
  console.log('Live creature roster passed', JSON.stringify(report.roster));

  await driver.callDebug('setSkillLevel', ['melee', 1]);
  await driver.callDebug('setSkillLevel', ['magic', 99]);
  const emptyHand: any = await driver.callDebug('callTool', ['corealm_equip', { unequipSlot: 'mainHand' }]);
  assert(!emptyHand.error, 'Photo setup removes the starter wand');
  await page.waitForFunction(() => (window.__gameDebug as any).getPlayer().maxHealth >= 170, undefined, { timeout: timeLeft(5000) });
  await driver.callDebug('setHealth', [1_000_000]);

  async function residentsReady(ids: string[], label = 'capture'): Promise<void> {
    const began = Date.now(), deadline = began + timeLeft(20_000);
    const check: any = { label, ids, samples: [], ready: false };
    report.readiness ??= []; report.readiness.push(check);
    await driver!.wait(150);
    let lastSignature = '', lastSavedAt = 0;
    try {
      while (Date.now() < deadline) {
        const diagnostic = await page.evaluate(ids => {
          const d: any = window.__gameDebug, residency = d.getEntityViewStats().residency;
          const residentIds = new Set(residency.residentIds), player = d.getPlayer();
          // This is photo/setup survival, never a mutation of creature health or combat state.
          if (!player.dead && player.health < player.maxHealth) d.setHealth(player.maxHealth);
          return { player, state: d.getState(), shaders: (window as any).__renderDistanceLab?.shaders(),
            residency: { resident: residency.resident, pending: residency.pending, failed: residency.failed, missing: residency.missing,
              pendingAssets: residency.pendingAssets, failedAssets: residency.failedAssets, missingAssets: residency.missingAssets },
            actors: ids.map(id => { const entity = d.getEntity(id), bounds = d.getDrawnBounds(id), motion = d.getEntityMotion(id);
              return { id, resident: residentIds.has(id), state: entity?.state, health: entity?.combat?.health, position: entity?.position,
                bounds, motion: motion ? { path: motion.path, liveRig: motion.liveRig, motion: motion.motion, clip: motion.clip,
                  time: motion.time, duration: motion.duration, semanticPosition: motion.semanticPosition, drawnPosition: motion.drawnPosition } : null }; }) };
        }, ids);
        check.last = diagnostic;
        const signature = JSON.stringify({ shaders: diagnostic.shaders, actors: diagnostic.actors.map((a: any) => [a.id, a.resident, a.state, a.health, a.bounds?.meshes, a.motion?.path, a.motion?.clip]) });
        if (signature !== lastSignature || Date.now() - lastSavedAt >= 1000) {
          check.samples.push({ elapsedMs: Date.now() - began, ...diagnostic });
          lastSignature = signature; lastSavedAt = Date.now();
        }
        assert(!diagnostic.player.dead, `${label}: player died before residency; see report.readiness`);
        assert(diagnostic.actors.every((a: any) => a.health > 0 && a.state !== 'dead'), `${label}: photo subject died before capture; see report.readiness`);
        const shaders = diagnostic.shaders;
        if (shaders && shaders.waiting === 0 && shaders.queued === 0 && !shaders.compiling
          && diagnostic.actors.every((a: any) => a.resident && a.bounds?.meshes > 0
            && (a.motion?.liveRig || a.motion?.clip || a.motion?.motion))) {
          check.ready = true;
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          return;
        }
        await driver!.wait(250);
      }
      throw new Error(`${label}: target residency/motion/shaders did not settle in 20s; shaders=${JSON.stringify(check.last?.shaders)}; actors=${JSON.stringify(check.last?.actors.map((a: any) => ({ id: a.id, state: a.state, health: a.health, resident: a.resident, meshes: a.bounds?.meshes, motion: a.motion })))}. Full diagnostics are in report.readiness.`);
    } finally { check.elapsedMs = Date.now() - began; }
  }

  async function stageGroup(groupId: string, yaw: number, combat = false): Promise<string[]> {
    const group = byGroup.get(groupId); assert(group, `Unknown shot group ${groupId}`);
    const ids = rowsFor(groupId).map(actor => actor.id);
    const relocate = async (preload: boolean) => page.evaluate(({ group, ids, yaw, combat, preload, radius, distance, pitch }) => {
      const d: any = window.__gameDebug;
      const focus = combat ? d.getEntity(ids[0]).position : [group.centre[0], 0, group.centre[1]];
      const rejected: any[] = [];
      const threats = preload ? d.listEntities({ regionId: group.regionId }).filter((e: any) => e.combat?.health > 0
        && (e.meta?.behaviour === 'aggressive' || e.meta?.behaviour === 'territorial')) : [];
      for (const offset of preload ? [28, 34, 40] : combat ? [3, 4, 5] : [2.5, 4, 1]) {
        for (const turn of preload ? [0, .6, -.6, 1.2, -1.2, Math.PI] : [0, .6, -.6, Math.PI]) {
          const angle = yaw + turn, x = focus[0] + Math.sin(angle) * offset, z = focus[2] + Math.cos(angle) * offset;
          const surface = d.sampleWorld(x, z), nav = d.getNavPoint([x, surface.height, z]);
          if (!surface.playable || surface.waterBodyId || !nav || Math.hypot(nav.x - x, nav.z - z) > .2) continue;
          const aggroClearance = threats.length ? Math.min(...threats.map((e: any) => Math.hypot(nav.x - e.position[0], nav.z - e.position[2])
            - (e.combat.aggroRadius ?? 12) - (e.combat.bodyRadius ?? 0))) : null;
          if (aggroClearance !== null && aggroClearance < 3) { rejected.push({ nav, aggroClearance }); continue; }
          const clearance = d.probeWorldClearance({ ...nav, radius });
          const target = d.getEntity(ids[0]).position, path = d.getNavPath([nav.x, nav.y, nav.z], target), end = path?.at(-1);
          if (clearance.staticShift > .05 || !end || Math.hypot(end.x - target[0], end.z - target[2]) > .6) {
            rejected.push({ nav, clearance, endpoint: end }); continue;
          }
          d.setHealth(1_000_000);
          d.inspectPose({ ...nav, yaw: angle, pitch, distance });
          return { phase: preload ? 'preload-outside-aggro' : 'normal-camera', playerSetup: nav, cameraYaw: angle, clearance, aggroClearance, route: path, rejected };
        }
      }
      throw new Error(`No dry normal-camera setup for ${group.id}: ${JSON.stringify(rejected)}`);
    }, { group, ids, yaw, combat, preload, radius: PLAYER_RADIUS, distance: CAMERA.defaultDistance, pitch: CAMERA.defaultPitch });
    report.setups ??= [];
    if (!combat) {
      const preload = await relocate(true);
      report.setups.push({ groupId, ...preload });
      await residentsReady(ids, `${groupId}: preload beyond aggro`);
    }
    const setup = await relocate(false);
    report.setups.push({ groupId, ...setup });
    await residentsReady(ids, `${groupId}: normal camera`);
    return ids;
  }

  async function capture(name: string, ids: string[]): Promise<void> {
    await residentsReady(ids, name);
    const observation = await page.evaluate(ids => {
      const d: any = window.__gameDebug, canvas = document.querySelector('canvas')!.getBoundingClientRect();
      return { state: d.getState(), player: d.getPlayer(), camera: d.getCamera(), sky: d.getBiomeAtmosphere(),
        viewport: { width: innerWidth, height: innerHeight }, canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
        residency: d.getEntityViewStats().residency, shaders: (window as any).__renderDistanceLab.shaders(),
        actors: ids.map(id => ({ entity: d.getEntity(id), bounds: d.getDrawnBounds(id), motion: d.getEntityMotion(id) })) };
    }, ids);
    assert.equal(observation.state.clock.timeScale, 1, `${name}: production clock`);
    assert.equal(observation.camera.freeMove, false, `${name}: player-follow camera`);
    assert(observation.camera.requestedDistance <= CAMERA.maxDistance, `${name}: ordinary player zoom`);
    assert(!observation.player.dead, `${name}: living player`);
    const cam = new PerspectiveCamera(CAMERA.fov, observation.canvas.width / observation.canvas.height, CAMERA.near, CAMERA.far);
    cam.position.set(observation.camera.position.x, observation.camera.position.y, observation.camera.position.z);
    cam.lookAt(observation.camera.target.x, observation.camera.target.y, observation.camera.target.z); cam.updateMatrixWorld();
    const projected = observation.actors.map((actor: any) => {
      const b = actor.bounds, points: Vector3[] = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) points.push(new Vector3(x, y, z).project(cam));
      const xs = points.map(p => (p.x + 1) * observation.canvas.width / 2), ys = points.map(p => (1 - p.y) * observation.canvas.height / 2);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      return { id: actor.entity.id, left, right, top, bottom, heightPx: bottom - top,
        intersectsViewport: right > 0 && left < observation.canvas.width && bottom > 0 && top < observation.canvas.height && points.some(p => p.z >= -1 && p.z <= 1) };
    });
    assert(projected.some((actor: any) => actor.intersectsViewport && actor.heightPx >= (observation.viewport.width < 500 ? 40 : 80)), `${name}: visible readable representative body bounds`);
    const file = await driver!.screenshot(out, name);
    report.captures.push({ name, file, ...observation, projected });
    console.log('World creature capture', name);
  }

  for (const shot of shots) {
    const ids = await stageGroup(shot.groupId, shot.yaw);
    await capture(shot.name, ids);
  }
  const mobileIds = rowsFor(shots[2].groupId).map(actor => actor.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('mobile-390-kilnhalt-creatures', mobileIds);
  await page.keyboard.press('m');
  await page.getByLabel('Map region', { exact: true }).selectOption('kilnhalt');
  const mapBounds = await page.locator('#panel-map').boundingBox();
  assert(mapBounds && mapBounds.x >= -.5 && mapBounds.x + mapBounds.width <= 390.5, '390px map fits horizontally');
  report.mobileMap = { bounds: mapBounds, file: await driver.screenshot(out, 'mobile-390-map'), state: await driver.callDebug('getState') };
  await page.getByRole('button', { name: 'Close Map', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });

  await driver.callDebug('callTool', ['corealm_stop', {}]);
  await driver.callDebug('setSkillLevel', ['melee', 99]);
  await page.waitForFunction(() => (window.__gameDebug as any).getPlayer().maxHealth >= 317, undefined, { timeout: timeLeft(5000) });
  await driver.callDebug('setHealth', [1_000_000]);
  const equip: any = await driver.callDebug('callTool', ['corealm_equip', { itemId: 'worn_sword' }]);
  assert(!equip.error, 'Starter sword equip succeeds');
  const combatIds = await stageGroup(combatGroupId, .95, true), targetId = combatIds[0]!;
  const before: any = await driver.callDebug('getEntity', [targetId]);
  const cursor: any = await driver.callDebug('getEvents');
  report.combat = { groupId: combatGroupId, speciesId: BIOME_POPULATION_LEGACY_REPLACEMENTS[combatGroupId], targetId, before, equip };
  await capture('original-remapped-heath-jack-before-click', combatIds);
  let clicked = false;
  for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
    const sample: any = await page.evaluate(id => { const d: any = window.__gameDebug, c = document.querySelector('canvas')!.getBoundingClientRect();
      return { bounds: d.getDrawnBounds(id), camera: d.getCamera(), rect: { x: c.x, y: c.y, width: c.width, height: c.height } }; }, targetId);
    const b = sample.bounds, c = sample.camera, rect = sample.rect;
    assert(b?.meshes > 0, 'Mouse target has resident drawn geometry');
    const camera = new PerspectiveCamera(CAMERA.fov, rect.width / rect.height, CAMERA.near, CAMERA.far);
    camera.position.set(c.position.x, c.position.y, c.position.z); camera.lookAt(c.target.x, c.target.y, c.target.z); camera.updateMatrixWorld();
    for (const fy of [.5, .35, .65]) {
      for (const fx of [.5, .3, .7]) {
        const p = new Vector3(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, (b.min.z + b.max.z) / 2).project(camera);
        const x = rect.x + (p.x + 1) * rect.width / 2, y = rect.y + (1 - p.y) * rect.height / 2;
        if (p.z < -1 || p.z > 1 || x < 0 || x >= rect.width || y < 0 || y >= rect.height) continue;
        await page.mouse.move(x, y); await driver.wait(70);
        const verified = await page.evaluate(({ id, x, y }) => (window.__gameDebug as any).getState().hoveredEntityId === id && document.elementFromPoint(x, y)?.tagName === 'CANVAS', { id: targetId, x, y });
        if (!verified) continue;
        report.combat.beforeClick = await driver.callDebug('getEntity', [targetId]);
        const clickCursor: any = await driver.callDebug('getEvents');
        report.combat.click = { x, y, verifiedHover: targetId, eventCursor: clickCursor.nextSeq };
        await page.mouse.click(x, y); clicked = true; break;
      }
      if (clicked) break;
    }
  }
  assert(clicked, `Could not acquire real canvas hover for ${targetId}`);
  const healthAtClick = report.combat.beforeClick.combat.health;
  assert(healthAtClick > 0, 'Original remapped target was alive at the verified click');
  await page.waitForFunction(({ id, health }) => { const e = (window.__gameDebug as any).getEntity(id); return e?.combat?.health < health || e?.state === 'dead'; },
    { id: targetId, health: healthAtClick }, { timeout: timeLeft(12_000) });
  report.combat.after = await driver.callDebug('getEntity', [targetId]);
  report.combat.events = await driver.callDebug('getEvents', [report.combat.click.eventCursor]);
  report.combat.playerAfter = await driver.callDebug('getPlayer');
  assert(!report.combat.events.dropped, 'Combat event history retained');
  assert(report.combat.events.events.some((event: any) => event.type === 'combat.started' && event.entityId === targetId && event.data.initiator === 'player'), 'Verified mouse click initiates production player combat');
  assert(report.combat.after.combat.health < healthAtClick || report.combat.after.state === 'dead', 'Real mouse attack changes target health/death');
  report.combat.afterFile = await driver.screenshot(out, 'original-remapped-heath-jack-after-damage');
  await driver.callDebug('callTool', ['corealm_stop', {}]);
  assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, 'One stable game document');
  report.finalState = await driver.callDebug('getState');
  report.errors = { game: await driver.callDebug('getErrors'), page: driver.pageErrors, console: driver.consoleErrors, requests: driver.requestErrors };
  for (const [kind, errors] of Object.entries(report.errors)) assert.deepEqual(errors, [], `No ${kind} errors`);
  report.passed = true;
}

await mkdir(out, { recursive: true });
try {
  await Promise.race([run(), new Promise<never>((_, reject) => {
    softTimer = setTimeout(() => reject(new Error('World creature work deadline reached; closing owned browser/server')), 110_000 - (Date.now() - started));
  })]);
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  report.errors = { ...report.errors, page: driver?.pageErrors ?? [], console: driver?.consoleErrors ?? [], requests: driver?.requestErrors ?? [] };
  console.error(report.failure); process.exitCode = 1;
} finally {
  if (softTimer) clearTimeout(softTimer);
  // A failure snapshot is best effort; closing the owned resources always runs afterwards.
  try {
    if (!report.passed && driver?.page && !driver.page.isClosed()) {
      report.failureState = await Promise.race([driver.snapshot('lean'), new Promise(resolve => setTimeout(() => resolve('snapshot deadline'), 1000))]);
    }
  } catch { /* Browser may already have failed. */ }
  try { await driver?.close(); }
  finally {
    try { await server?.close(); }
    finally {
      report.elapsedMs = Date.now() - started;
      await writeFile(`${out}/world.json`, JSON.stringify(report, null, 2));
      clearTimeout(hardTimer);
    }
  }
}
if (report.passed) console.log(`Creature world integration passed in ${report.elapsedMs}ms; inspect ${out}/world.json and PNGs`);
