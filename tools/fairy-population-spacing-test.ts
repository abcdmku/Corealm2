import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GameDriver } from './lib/driver.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';
import { CAMERA } from '../game/src/app/config.js';

const args = process.argv.slice(2);
const url = argValue(args, '--url') ?? 'http://127.0.0.1:4397';
const catalog = path.resolve(argValue(args, '--catalog') ?? 'test-results/fairy-population/assets/candidates.json');
const out = path.resolve(argValue(args, '--out') ?? 'test-results/fairy-population/spacing');
await mkdir(out, { recursive: true });
await access(catalog);

const driver = new GameDriver({ url, close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const stopDeadline = installTestDeadline('Fairy population spacing lab', 60_000);
const evidence: Record<string, unknown> = { url, catalog, route: '/index.html?mode=combat&spawnSpacing=1&population=fairy' };
const groupPrefix = 'fairy_population_lab_';

type Actor = {
  id: string;
  groupId: string;
  enemyDefId?: string;
  assetId?: string;
  position: [number, number, number];
  bodyRadius: number;
  spawn: [number, number];
};

type Observation = {
  state: any;
  player: { x: number; y: number; z: number };
  camera: any;
  actors: Actor[];
  errors: string[];
};

const observe = async (): Promise<Observation> => driver.page!.evaluate(() => {
  const debug = window.__gameDebug as any;
  const actors = (debug.listEntities({ archetype: 'enemy' }) as any[])
    .filter((entity) => String(entity.meta?.groupId ?? '').startsWith('fairy_population_lab_'))
    .map((entity) => ({
      id: entity.id,
      groupId: entity.meta.groupId,
      enemyDefId: entity.meta.enemyDefId,
      assetId: entity.view?.assetId,
      position: [...entity.position] as [number, number, number],
      bodyRadius: entity.combat?.bodyRadius ?? 0,
      spawn: [entity.meta.spawnX, entity.meta.spawnZ] as [number, number],
    }));
  return {
    state: debug.getState(), player: debug.getPlayerPosition(), camera: debug.getCamera(),
    actors, errors: debug.getErrors(),
  };
});

function assertAttachedCamera(observation: Observation, label: string): void {
  const camera = observation.camera;
  assert.equal(camera.freeMove, false, `${label}: camera must remain player-attached`);
  assert(camera.requestedDistance >= CAMERA.minDistance && camera.requestedDistance <= CAMERA.maxDistance,
    `${label}: requested distance outside gameplay limits`);
  assert(camera.distance >= CAMERA.minDistance && camera.distance <= CAMERA.maxDistance + .01,
    `${label}: effective distance outside gameplay limits`);
  assert(camera.pitch >= CAMERA.minPitch && camera.pitch <= CAMERA.maxPitch,
    `${label}: pitch outside gameplay limits`);
  assert(Math.abs(camera.target.x - observation.player.x) < .25
    && Math.abs(camera.target.z - observation.player.z) < .25,
  `${label}: camera focus detached from player`);
}

function actorFingerprint(actors: readonly Actor[]): unknown[] {
  return [...actors].sort((a, b) => a.id.localeCompare(b.id)).map((actor) => ({
    id: actor.id, groupId: actor.groupId, enemyDefId: actor.enemyDefId,
    assetId: actor.assetId, spawn: actor.spawn, bodyRadius: actor.bodyRadius,
  }));
}

function assertSevenResidents(actors: readonly Actor[], label: string): void {
  assert.equal(actors.length, 7, `${label}: expected seven live residents`);
  const groups = new Map<string, Actor[]>();
  for (const actor of actors) {
    assert(actor.id.startsWith(groupPrefix), `${label}: unexpected actor ${actor.id}`);
    assert(actor.groupId === `${groupPrefix}residents` || actor.groupId === `${groupPrefix}companions`,
      `${label}: unexpected group ${actor.groupId}`);
    const expectedAsset = actor.groupId === `${groupPrefix}residents`
      ? 'fairy_garden_spriggle_gloamgarden' : 'fairy_garden_sporekin_gloamgarden';
    const expectedSpecies = actor.groupId === `${groupPrefix}residents`
      ? 'garden_spriggle_t30' : 'garden_sporekin_t30';
    assert.equal(actor.assetId, expectedAsset, `${label}: staged production asset for ${actor.id}`);
    assert.equal(actor.enemyDefId, expectedSpecies, `${label}: species stats binding for ${actor.id}`);
    assert(Number.isFinite(actor.bodyRadius) && actor.bodyRadius > 0, `${label}: missing body radius ${actor.id}`);
    assert(actor.position.every(Number.isFinite), `${label}: non-finite position ${actor.id}`);
    const members = groups.get(actor.groupId) ?? [];
    members.push(actor); groups.set(actor.groupId, members);
  }
  assert.equal(groups.get(`${groupPrefix}residents`)?.length, 4, `${label}: primary group count`);
  assert.equal(groups.get(`${groupPrefix}companions`)?.length, 3, `${label}: companion group count`);
  for (const [groupId, count] of [[`${groupPrefix}residents`, 4], [`${groupPrefix}companions`, 3]] as const)
    for (let index = 1; index <= count; index += 1)
      assert(actors.some((actor) => actor.groupId === groupId && actor.id === `${groupId}_${index}`),
        `${label}: missing stable actor ${groupId}_${index}`);
  for (let index = 0; index < actors.length; index += 1) for (const other of actors.slice(index + 1)) {
    const gap = Math.hypot(actors[index]!.position[0] - other.position[0], actors[index]!.position[2] - other.position[2])
      - actors[index]!.bodyRadius - other.bodyRadius;
    assert(gap >= 5 - 1e-3, `${label}: moving body gap ${actors[index]!.id}/${other.id} = ${gap}`);
  }
}

try {
  await driver.launch();
  const page = driver.page!;
  evidence.installed = await installAssetCandidates(page, catalog);
  await driver.open(45_000, '/index.html?mode=combat&spawnSpacing=1&population=fairy');

  const initial = await observe();
  assert.equal(initial.state.ready, true, 'production lab must be ready');
  assertSevenResidents(initial.actors, 'initial');
  assertAttachedCamera(initial, 'initial');
  evidence.initial = initial;
  evidence.initialScreenshot = await driver.screenshot(out, 'fairy-population-initial');

  // Put the attached follow camera on the receiving-floor edge through the normal pose helper so
  // a reviewer can see the staged residents. The camera remains at the ordinary 11 m / 0.52 rad
  // gameplay pose; this is only a deterministic setup for the visual capture.
  await driver.callDebug('inspectPose', [{ x: 0, y: 0, z: -24, yaw: 0,
    pitch: CAMERA.defaultPitch, distance: CAMERA.defaultDistance, detached: false }]);
  await driver.callDebug('waitForView');
  await driver.wait(250);
  const residentsView = await observe();
  assertAttachedCamera(residentsView, 'residents view');
  evidence.residentsView = residentsView;
  evidence.residentsScreenshot = await driver.screenshot(out, 'fairy-population-residents');

  // A short normal gameplay walk proves the fixture is live and leaves camera focus intact.
  await page.locator('#viewport').focus();
  await page.evaluate(() => {
    window.__featureLab?.setWalkingEnabled(true);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const beforeWalk = await driver.callDebug('getPlayerPosition') as { x: number; y: number; z: number };
  await driver.press('KeyD', 450);
  // Let the ordinary follow camera settle after the short walk before reading its target.
  await driver.wait(350);
  const afterWalk = await driver.callDebug('getPlayerPosition') as { x: number; y: number; z: number };
  assert.notDeepEqual(afterWalk, beforeWalk, 'real keyboard movement must change player position');
  const moved = await observe();
  assertSevenResidents(moved.actors, 'after keyboard movement');
  assertAttachedCamera(moved, 'after keyboard movement');
  evidence.movement = { before: beforeWalk, after: afterWalk };
  evidence.moved = moved;
  evidence.movementScreenshot = await driver.screenshot(out, 'fairy-population-after-walk');

  // Reset once and compare stable actor identity/spawn placement, which catches a rerolled layout.
  await driver.reset();
  const reset = await observe();
  assertSevenResidents(reset.actors, 'after reset');
  assertAttachedCamera(reset, 'after reset');
  assert.deepEqual(actorFingerprint(reset.actors), actorFingerprint(initial.actors),
    'reset must retain deterministic seven-member identity and spawn placement');
  evidence.reset = reset;
  evidence.resetScreenshot = await driver.screenshot(out, 'fairy-population-reset');

  const errors = { game: reset.errors, page: driver.pageErrors, console: driver.consoleErrors, requests: driver.requestErrors };
  assert.deepEqual(errors, { game: [], page: [], console: [], requests: [] });
  evidence.errors = errors;
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error);
  evidence.failureObservation = await observe().catch(() => null);
  evidence.errors = { page: driver.pageErrors, console: driver.consoleErrors, requests: driver.requestErrors };
  await driver.screenshot(out, 'failure').catch(() => {});
  throw error;
} finally {
  stopDeadline();
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await driver.close();
  console.log(JSON.stringify({ out, passed: evidence.passed === true, failure: evidence.failure ?? null }));
}
