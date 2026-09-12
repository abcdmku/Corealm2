import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue, repoRoot } from './lib/paths.js';
import { startGameServer, type RunningGameServer } from './lib/server.js';

type XZ = readonly [number, number];
type Point = { x: number; y: number; z: number };
type WorldShot = {
  name: string;
  at: XZ;
  yaw: number;
  pitch?: number;
  expectedRegion?: string;
  entityIds?: string[];
};
type WorldConfig = {
  bridgeCrownY?: number;
  bridgeMinimumRise?: number;
  worldShots?: WorldShot[];
  worldBridge?: { from: XZ; to: XZ; holdMs?: number };
  worldBridges?: { from: XZ; to: XZ; holdMs?: number }[];
};

/**
 * Root-run acceptance helper.
 *
 * Examples:
 *   npx tsx tools/crownward-river-test.ts --part bridge --catalog tools/crownward-bridges/catalog.json --own-server
 *   npx tsx tools/crownward-river-test.ts --part dragons --url http://127.0.0.1:4179
 *   npx tsx tools/crownward-river-test.ts --part world --config runs/crownward-revision/river-world.json --own-server
 *
 * World config supplies the final integration coordinates:
 * { "worldShots": [{ "name": "river", "at": [555, 185], "yaw": 0 }],
 *   "worldBridge": { "from": [542, 195], "to": [568, 195], "holdMs": 9000 } }
 */

const args = process.argv.slice(2);
const part = argValue(args, '--part') ?? 'bridge';
assert(['bridge', 'dragons', 'world'].includes(part), '--part must be bridge, dragons, or world');
assert(!(args.includes('--own-server') && argValue(args, '--url')),
  '--own-server and --url select different server ownership modes; use one');

const out = path.join(repoRoot, 'test-results/crownward-river', part);
await mkdir(out, { recursive: true });
const configPath = argValue(args, '--config');
const config: WorldConfig = configPath
  ? JSON.parse(await readFile(path.resolve(configPath), 'utf8')) as WorldConfig
  : {};

let ownedServer: RunningGameServer | null = null;
const server: RunningGameServer = args.includes('--own-server')
  ? (ownedServer = await startGameServer({ hmr: false }))
  : { url: argValue(args, '--url') ?? 'http://127.0.0.1:4179', close: async () => {} };
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const report: Record<string, unknown> = {
  part,
  server: args.includes('--own-server') ? 'owned-hmr-disabled' : server.url,
  configPath: configPath ? path.resolve(configPath) : null,
  passed: false,
  acceptedCandidateIds: [],
};

const planarDistance = (point: Point, target: XZ): number =>
  Math.hypot(point.x - target[0], point.z - target[1]);
const pathLength = (points: Point[]): number => points.slice(1).reduce((sum, point, index) => {
  const previous = points[index]!;
  return sum + Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
}, 0);
const yawToward = (from: XZ, to: XZ): number => Math.atan2(from[0] - to[0], from[1] - to[1]);

try {
  await driver.launch();
  await driver.page!.addInitScript("globalThis.__name = (fn) => fn;");
  const catalog = argValue(args, '--catalog');
  if (catalog) {
    report.acceptedCandidateIds = await installAssetCandidates(driver.page!, catalog);
    report.acceptedCandidateHashes = Object.fromEntries(
      JSON.parse(await readFile(catalog, 'utf8')).assets.map((asset: { id: string; sha256: string }) => [asset.id, asset.sha256]));
  }
  const route = part === 'bridge'
    ? '/index.html?mode=building&river=1&startup-cache=0'
    : part === 'dragons'
      ? '/index.html?mode=combat&atmosphere=1&startup-cache=0'
      : '/index.html?startup-cache=0';
  await driver.open(part === 'world' ? 300_000 : 60_000, route);
  const page = driver.page!;
  page.setDefaultTimeout(10_000);

  const waitForShaders = async () => {
    await page.waitForFunction(() => {
      const shaders = (window as any).__renderDistanceLab?.shaders?.();
      return !shaders || shaders.waiting === 0 && shaders.queued === 0 && !shaders.compiling;
    }, undefined, { timeout: 120_000, polling: 200 });
    await page.evaluate(() => new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return page.evaluate(() => (window as any).__renderDistanceLab?.shaders?.() ?? null);
  };

  const closeLabPanel = async () => {
    const close = page.locator('#panel-feature-lab .panel__close');
    if (await close.isVisible()) await close.click();
  };

  const assertNormalCamera = async () => {
    const view = await page.evaluate(() => ({
      camera: (window.__gameDebug as any).getCamera(),
      player: (window.__gameDebug as any).getPlayerPosition(),
    }));
    assert.equal(view.camera.freeMove, false, 'Camera left player-follow mode');
    assert(Math.abs(view.camera.requestedDistance - 11) < .01,
      `Expected CAMERA.maxDistance 11, got ${view.camera.requestedDistance}`);
    assert(view.camera.pitch >= .18, `Camera pitch ${view.camera.pitch} is below the normal acceptance floor`);
    assert(Math.hypot(view.camera.target.x - view.player.x, view.camera.target.z - view.player.z) < .15,
      'Camera target left the player');
    return view;
  };

  const followPose = async (at: XZ, yaw: number, pitch = .25) => {
    await page.evaluate(({ at, yaw, pitch }) => {
      const debug = window.__gameDebug as any;
      const sample = debug.sampleWorld(at[0], at[1]);
      debug.teleport([at[0], sample.height, at[1]]);
      debug.inspectPose({ x: at[0], y: sample.height, z: at[1], yaw, pitch, distance: 11, detached: false });
    }, { at, yaw, pitch });
    await page.waitForTimeout(200);
    return assertNormalCamera();
  };

  const navigationPath = async (from: XZ, to: XZ) => page.evaluate(({ from, to }) => {
    const debug = window.__gameDebug as any;
    const a = debug.sampleWorld(from[0], from[1]);
    const b = debug.sampleWorld(to[0], to[1]);
    return {
      from: { x: from[0], y: a.height, z: from[1] },
      to: { x: to[0], y: b.height, z: to[1] },
      fromSample: a,
      toSample: b,
      path: debug.getNavPath([from[0], a.height, from[1]], [to[0], b.height, to[1]]) as Point[] | null,
    };
  }, { from, to });

  const assertCompletePath = (result: Awaited<ReturnType<typeof navigationPath>>, label: string) => {
    assert(result.path && result.path.length >= 2, `${label}: no production navigation path`);
    assert(planarDistance(result.path[0]!, [result.from.x, result.from.z]) < .8,
      `${label}: path starts away from the requested endpoint`);
    assert(planarDistance(result.path.at(-1)!, [result.to.x, result.to.z]) < .8,
      `${label}: path stops before the requested endpoint`);
    return result.path;
  };

  const keyboardTraverse = async (from: XZ, to: XZ, holdMs = 9_000, minimumRise = 0) => {
    const routeResult = await navigationPath(from, to);
    const navPath = assertCompletePath(routeResult, `${from} -> ${to}`);
    await followPose(from, yawToward(from, to));
    const before = await page.evaluate(() => ({
      player: (window.__gameDebug as any).getPlayerPosition(),
      navigation: (window.__gameDebug as any).getNavigationState(),
    }));
    await page.locator('canvas#viewport').focus();
    await page.evaluate(() => {
      const host = window as any;
      host.__crownwardTraversalSamples = [];
      host.__crownwardTraversalSampling = true;
      const sample = () => {
        if (!host.__crownwardTraversalSampling) return;
        host.__crownwardTraversalSamples.push({
          atMs: performance.now(),
          ...(window.__gameDebug as any).getPlayerPosition(),
        });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(({ to, radius }) => {
        const player = (window.__gameDebug as any).getPlayerPosition();
        return Math.hypot(player.x - to[0], player.z - to[1]) <= radius;
      }, { to, radius: 1.6 }, { timeout: holdMs, polling: 100 });
    } finally {
      await page.keyboard.up('w');
    }
    const samples = await page.evaluate(() => {
      const host = window as any;
      host.__crownwardTraversalSampling = false;
      return host.__crownwardTraversalSamples as (Point & { atMs: number })[];
    });
    const after = await page.evaluate(() => ({
      player: (window.__gameDebug as any).getPlayerPosition(),
      navigation: (window.__gameDebug as any).getNavigationState(),
    }));
    assert(planarDistance(after.player, to) < planarDistance(before.player, to),
      'Keyboard movement did not approach the opposite bank');
    assert(samples.length > 1, 'Keyboard traversal produced no frame-by-frame movement samples');
    const maxY = Math.max(...samples.map(sample => sample.y));
    const bankY = Math.max(routeResult.from.y, routeResult.to.y);
    const rise = maxY - bankY;
    if (minimumRise > 0) assert(rise > minimumRise,
      `Keyboard traversal rose only ${rise.toFixed(2)} m above its banks`);
    return { from, to, before, after, path: navPath, pathLength: pathLength(navPath),
      samples, maxY, bankY, rise };
  };

  if (part === 'bridge') {
    const structure = await page.evaluate(async () => {
      const lab = window.__featureLab!;
      const state = await lab.setStructure({ kind: 'composition', id: 'crownward_bridge', kit: 'stone' });
      lab.setWalkingEnabled(true);
      lab.setFreeCameraEnabled(false);
      return state.structure;
    });
    assert(structure.ready && structure.partCount > 0 && structure.assetCount > 0,
      'Crownward bridge did not assemble through the production structure path');
    // This composition deliberately publishes no box collision. Its exact deck and rails enter
    // production navigation as source meshes, proven below by the arched path and two-way walk.
    assert.equal(structure.collisionCount, 0, 'Bridge unexpectedly fell back to box collision');
    await closeLabPanel();

    const bridgeEntity = await page.evaluate(() => {
      const debug = window.__gameDebug as any;
      const entity = debug.getEntities().find((row: { id: string }) =>
        row.id === 'feature-lab:structure' || row.id.startsWith('feature-lab:structure#'));
      return entity ? { entity, bounds: debug.getDrawnBounds(entity.id) } : null;
    });
    assert(bridgeEntity?.bounds, 'Bridge semantic entity has no drawn production bounds');

    const waterBodies = await page.evaluate(() => (window.__gameDebug as any).getWaterBodies());
    const crossing = await navigationPath([-21, 12], [5, 12]);
    const expectedCrown = config.bridgeCrownY ?? 4;
    const minimumRise = config.bridgeMinimumRise ?? 2;
    const midpoint = await page.evaluate(crownY => {
      const debug = window.__gameDebug as any;
      const bank = debug.sampleWorld(-21, 12);
      const path = debug.getNavPath([-21, bank.height, 12], [-8, crownY, 12]) as Point[] | null;
      return { requested: { x: -8, y: crownY, z: 12 }, path, endpoint: path?.at(-1) ?? null };
    }, expectedCrown);
    report.crossing = { crossing, midpoint, waterBodies };
    assert(Array.isArray(waterBodies) && waterBodies.some((body: { id: string }) => body.id.includes('pearlwater')),
      'River fixture did not publish the Pearlwater body');
    const path = assertCompletePath(crossing, 'bridge crossing');
    assert(midpoint.path && midpoint.path.length >= 2 && midpoint.endpoint,
      'Bridge crown has no navigation path');
    assert(planarDistance(midpoint.endpoint, [-8, 12]) < .8,
      'Bridge crown navigation stops away from its requested midpoint');
    const bankY = Math.max(path[0]!.y, path.at(-1)!.y);
    const archRise = midpoint.endpoint.y - bankY;
    assert(Math.abs(midpoint.endpoint.y - expectedCrown) < .7,
      `Bridge navigation does not follow the source deck crown at ${expectedCrown} m`);
    assert(archRise > minimumRise, `Bridge navigation rises only ${archRise.toFixed(2)} m above its banks`);

    const wet = await page.evaluate(() => {
      const debug = window.__gameDebug as any;
      const sample = debug.sampleWorld(-8, 25);
      const from = debug.sampleWorld(-21, 12);
      const path = debug.getNavPath([-21, from.height, 12], [-8, sample.height, 25]) as Point[] | null;
      return { sample, path };
    });
    assert(wet.sample.waterBodyId, 'Expected [-8,25] to be semantic river water');
    assert(!wet.path || wet.path.length === 0 || planarDistance(wet.path.at(-1)!, [-8, 25]) > 1.5,
      'Underwater river point is reachable on the navigation mesh');

    const camera = await followPose([-26, 32], Math.atan2(-18, 20));
    const shaders = await waitForShaders();
    await driver.screenshot(out, 'bridge-approach');
    const forward = await keyboardTraverse([-21, 12], [5, 12], 9_000, minimumRise);
    const reverse = await keyboardTraverse([5, 12], [-21, 12], 9_000, minimumRise);
    await waitForShaders();
    await driver.screenshot(out, 'bridge-returned');
    report.bridge = { structure, bridgeEntity, waterBodies, crossing, midpoint, archRise, wet,
      camera, shaders, forward, reverse };
  } else if (part === 'dragons') {
    const ids = ['crownward_red_hatchling', 'crownward_black_hatchling', 'crownward_red_dragon'];
    const cases: unknown[] = [];
    await closeLabPanel();
    for (const id of ids) {
      const spawned = await page.evaluate(async speciesId => {
        const lab = window.__featureLab!;
        await lab.perform('reset-player');
        lab.setFreeCameraEnabled(false);
        lab.setLevel('melee', 99);
        await lab.spawnTarget('creature', `species:${speciesId}`, { distance: 5 });
        const state = lab.getState();
        const debug = window.__gameDebug as any;
        return { state, entity: debug.getEntity(state.target!.entityId),
          bounds: debug.getDrawnBounds(state.target!.entityId) };
      }, id);
      assert(spawned.state.target?.presetId === `species:${id}`, `${id}: wrong production creature spawned`);
      await page.waitForFunction(entityId => (window.__gameDebug as any).getDrawnBounds(entityId)?.meshes > 0,
        spawned.state.target.entityId, { timeout: 20_000 });
      const player = await page.evaluate(() => (window.__gameDebug as any).getPlayerPosition());
      const camera = await followPose([spawned.entity.position[0], spawned.entity.position[2] + (id === 'crownward_red_dragon' ? 25 : 15)], 0);
      const shaders = await waitForShaders();
      const before = await page.evaluate(() => {
        const state = window.__featureLab!.getState();
        return { lab: state, entity: (window.__gameDebug as any).getEntity(state.target!.entityId),
          motion: (window.__gameDebug as any).getEntityMotion(state.target!.entityId),
          bounds: (window.__gameDebug as any).getDrawnBounds(state.target!.entityId) };
      });
      assert(before.lab.target?.health !== null && before.lab.target?.health !== undefined,
        `${id}: missing combat health`);
      await driver.screenshot(out, id);
      await page.evaluate(async () => window.__featureLab!.perform('attack'));
      await page.waitForFunction(health => {
        const target = window.__featureLab!.getState().target;
        return target && target.health !== null && target.health < health;
      }, before.lab.target.health, { timeout: 15_000 });
      const after = await page.evaluate(() => {
        const state = window.__featureLab!.getState();
        return { lab: state, entity: (window.__gameDebug as any).getEntity(state.target!.entityId),
          motion: (window.__gameDebug as any).getEntityMotion(state.target!.entityId) };
      });
      const healthDelta = before.lab.target!.health! - after.lab.target!.health!;
      assert(healthDelta > 0, `${id}: real production attack caused no health loss`);
      cases.push({ id, spawned, before, after, healthDelta, camera, shaders });
    }
    report.dragons = cases;
  } else {
    const worldShots = config.worldShots;
    const worldBridge = config.worldBridge;
    assert(worldShots && worldShots.length >= 4,
      'World mode needs --config with river, lake, bridges, and east-lava worldShots');
    assert(worldBridge, 'World mode needs --config with worldBridge traversal endpoints');
    const shots: unknown[] = [];
    for (const shot of worldShots) {
      const camera = await followPose(shot.at, shot.yaw, shot.pitch ?? .25);
      const shaders = await waitForShaders();
      const state = await page.evaluate(entityIds => {
        const debug = window.__gameDebug as any;
        const player = debug.getPlayer();
        return { player, position: debug.getPlayerPosition(), navigation: debug.getNavigationState(),
          sample: debug.sampleWorld(debug.getPlayerPosition().x, debug.getPlayerPosition().z),
          waterBodies: debug.getWaterBodies(),
          entities: entityIds?.map((id: string) => ({ entity: debug.getEntity(id), bounds: debug.getDrawnBounds(id) })) ?? [] };
      }, shot.entityIds);
      assert.equal(state.navigation.status, 'ready', `${shot.name}: navigation is not ready`);
      if (shot.expectedRegion) assert.equal(state.player.regionId, shot.expectedRegion,
        `${shot.name}: wrong region`);
      await driver.screenshot(out, shot.name);
      shots.push({ shot, camera, shaders, state });
    }
    const bridgePath = await navigationPath(worldBridge.from, worldBridge.to);
    assertCompletePath(bridgePath, 'world bridge');
    const movement = await keyboardTraverse(worldBridge.from, worldBridge.to,
      worldBridge.holdMs ?? 9_000);
    const crossings = [];
    for (const bridge of config.worldBridges ?? []) crossings.push(await keyboardTraverse(bridge.from, bridge.to, bridge.holdMs ?? 9000, config.bridgeMinimumRise ?? 2));
    report.world = { shots, bridgePath, movement, crossings };
  }

  report.gameErrors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  assert.deepEqual(report.gameErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  report.passed = true;
} catch (cause) {
  report.error = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  process.exitCode = 1;
  if (driver.page) await driver.screenshot(out, 'failure').catch(() => undefined);
} finally {
  report.consoleErrors = driver.consoleErrors;
  report.pageErrors = driver.pageErrors;
  report.requestErrors = driver.requestErrors;
  await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ part, passed: report.passed, error: report.error,
    out: path.relative(repoRoot, out), acceptedCandidateIds: report.acceptedCandidateIds }));
  await driver.close();
  await ownedServer?.close();
}
