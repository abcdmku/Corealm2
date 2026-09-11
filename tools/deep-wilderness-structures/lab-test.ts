import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  DEEP_WILDERNESS_STRUCTURE_IDS, DEEP_WILDERNESS_STRUCTURES,
  buildDeepWildernessStructure, buildDeepWildernessStructureCollisionParts,
  type DeepWildernessStructureId,
} from '../../game/src/render/compositions/deepWildernessStructures.js';
import { CAMERA } from '../../game/src/app/config.js';
import { wildernessTorchPalette } from '../../game/src/render/wildernessEffects.js';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installTestDeadline } from '../lib/deadline.js';

// One fixture per invocation keeps the complete browser proof inside the local-feature budget.
const id = (process.argv.find(arg => arg.startsWith('--id='))?.slice(5) ?? 'cinder_chain_foundry') as DeepWildernessStructureId;
assert(DEEP_WILDERNESS_STRUCTURE_IDS.includes(id), `Unknown deep Wilderness structure: ${id}`);
const definition = DEEP_WILDERNESS_STRUCTURES[id];
const coloursOnly = process.argv.includes('--colours-only');
const out = `test-results/deep-wilderness-structures/${id}`;
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline(`deep Wilderness ${id}`, 60_000);
const started = performance.now();
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const evidence: Record<string, unknown> = { id, definition, coloursOnly };
try {
  await driver.launch();
  await driver.open(25_000, '/index.html?mode=building&atmosphere=1&wildernessTorches=1');
  const page = driver.page!;
  await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  const before = await page.evaluate(() => window.__featureLab!.getState().structure);
  const structure = await page.evaluate(async id => (await window.__featureLab!.setStructure({
    kind: 'composition', id, kit: 'stone',
  })).structure, id);
  assert.equal(structure.selection.id, id, 'Composition was not registered in the production lab');
  assert(structure.ready && structure.revision > before.revision);
  assert.equal(structure.partCount, buildDeepWildernessStructure(id).length);
  assert.equal(structure.collisionCount, buildDeepWildernessStructureCollisionParts(id).length);
  assert(structure.bounds && structure.bounds.max[1] - structure.bounds.min[1] > 10);
  evidence.before = before;
  evidence.structure = structure;
  const partIds = buildDeepWildernessStructure(id).map(part => `feature-lab:structure#${part.tag}`);
  const origin = [-8, 12] as const;
  const pose = async (x: number, z: number, yaw = 0, pitch = .3) => {
    await page.evaluate(({ x, z, yaw, pitch, distance }) => {
      window.__featureLab!.setWalkingEnabled(true);
      (window.__gameDebug as any).inspectPose({ x, y: 0, z, yaw, pitch, distance });
    }, { x: origin[0] + x, z: origin[1] + z, yaw, pitch, distance: CAMERA.maxDistance });
    await page.waitForTimeout(180);
  };
  await pose(0, definition.inspectionStops[0]![1]);
  await page.waitForFunction(ids => {
    const debug = window.__gameDebug as any;
    const residency = debug.getEntityViewStats().residency;
    const resident = new Set(residency.residentIds);
    const shaders = (window as any).__renderDistanceLab?.shaders();
    return ids.every(id => resident.has(id) && debug.getDrawnBounds(id))
      && (!shaders || (!shaders.waiting && !shaders.queued && !shaders.compiling));
  }, partIds, { timeout: 15_000 });
  const captures: unknown[] = [];
  for (const [index, stop] of definition.inspectionStops.entries()) {
    if (coloursOnly && (index === 3 || (index === 1 && id !== 'cinder_chain_foundry'))) continue;
    await pose(stop[0], stop[1], index === 1 ? -.4 : index === 2 ? .45 : 0, .3);
    const state = await page.evaluate(() => ({ camera: (window.__gameDebug as any).getCamera(),
      player: (window.__gameDebug as any).getPlayerPosition() }));
    assert.equal(state.camera.freeMove, false, 'Detached camera is prohibited');
    assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
    assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
    assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < .1,
      'Camera focus must remain on the grounded player');
    await page.screenshot({ path: `${out}/${coloursOnly ? 'colour-' : ''}${index}-${['approach', 'west-court', 'east-court', 'keeper-court'][index]}.png` });
    captures.push({ stop, ...state });
  }
  evidence.captures = captures;
  if (!coloursOnly) {
    const path = await page.evaluate(({ origin, from, to }) => (window.__gameDebug as any).getNavPath(
      [origin[0] + from[0], 0, origin[1] + from[1]], [origin[0] + to[0], 0, origin[1] + to[1]]),
    { origin, from: definition.clearThrough[0], to: definition.clearThrough[1] });
    assert(path?.length >= 2, 'Both structure approaches must share a navigation path');
    assert(path.every((point: { x: number }) => Math.abs(point.x - origin[0]) < 1.5), 'Navigation must use the central passage');
    evidence.path = path;
    const walks: unknown[] = [];
    for (const portal of ['front', 'rear'] as const) {
      const z = portal === 'front' ? definition.clearThrough[0][1] : definition.clearThrough[1][1] + 8;
      await pose(0, z, 0, .3);
      const beforeWalk = await page.evaluate(() => (window.__gameDebug as any).getPlayerPosition());
      await page.keyboard.down('w');
      await page.waitForTimeout(3000);
      await page.keyboard.up('w');
      const afterWalk = await page.evaluate(() => (window.__gameDebug as any).getPlayerPosition());
      assert(afterWalk.z < beforeWalk.z - 8 && Math.abs(afterWalk.x - origin[0]) < .75,
        `Real W input did not cross the ${portal} gate`);
      walks.push({ portal, beforeWalk, afterWalk });
    }
    evidence.walks = walks;
  }
  const effects = await page.evaluate(() => (window as any).__wildernessEffects?.getState());
  assert(effects?.ready && effects.enabled && effects.torches === definition.torches.length,
    'Mounted production torch effects must accompany the structure');
  assert(effects.liveParticles > 0, 'Mounted torches must animate');
  for (const [index, torch] of definition.torches.entries()) {
    const light = effects.lights.find((light: { id: string | null }) => light.id === `feature-lab:structure#mounted_torch_${index}`);
    assert(light, `Native torch ${index} has no assigned production light`);
    assert.equal(light.colour, wildernessTorchPalette(torch).light,
      `Native torch ${index} must emit its authored ${torch.theme} colour`);
  }
  evidence.effects = effects;
  evidence.errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error);
  throw error;
} finally {
  evidence.consoleErrors = driver.consoleErrors;
  evidence.pageErrors = driver.pageErrors;
  evidence.elapsedMs = Math.round(performance.now() - started);
  await writeFile(`${out}/${coloursOnly ? 'report-colour' : 'report'}.json`, JSON.stringify(evidence, null, 2));
  await driver.close();
  await server.close();
  clearDeadline();
}
