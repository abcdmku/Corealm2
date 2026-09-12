import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WILDERNESS_RUIN_IDS, WILDERNESS_RUINS } from '../game/src/render/compositions/wildernessRuins.js';
import { WILDERNESS_RUIN_SITES } from '../game/src/content/wildernessLandmarks.js';
import { GameDriver } from './lib/driver.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue, repoRoot } from './lib/paths.js';
import { startGameServer } from './lib/server.js';
import { CAMERA } from '../game/src/app/config.js';

/**
 * Root-owned acceptance helper. It uses the external Vite server at port 4179 by default.
 *
 * Optional --config JSON may override lab review poses and provide castle gateways once their
 * lateral offsets are measured:
 * { "castles": { "crownward_castle": {
 *   "pose": { "x": -8, "z": 44, "yaw": 0 },
 *   "gateway": { "from": [-4, 42], "to": [-4, 14], "holdMs": 5000 }
 * } }, "worldShots": [{ "name": "coast", "x": 680, "z": 80, "yaw": -1.57 }] }
 */

type XZ = readonly [number, number];
type Pose = { x: number; z: number; yaw: number; pitch?: number };
type Gateway = { from: XZ; to: XZ; holdMs?: number };
type LabCaseConfig = { pose?: Pose; gateway?: Gateway };
type WorldShot = Pose & {
  name: string;
  expectedRegion?: string;
  partPrefix?: string;
};
type RevisionConfig = {
  castles?: Record<string, LabCaseConfig>;
  wilderness?: Record<string, LabCaseConfig>;
  worldShots?: WorldShot[];
};

type Point = { x: number; y: number; z: number };
type DrawnBounds = { min: Point; max: Point; meshes?: number; fade?: number };

const CASTLE_IDS = ['crownward_castle', 'crownward_fortress'] as const;
const LAB_ORIGIN: XZ = [-8, 12];
const args = process.argv.slice(2);
const part = argValue(args, '--part') ?? 'castles';
assert(['castles', 'wilderness', 'world'].includes(part), '--part must be castles, wilderness, or world');

const out = path.join(repoRoot, 'test-results/crownward-revision', part);
await mkdir(out, { recursive: true });
const configPath = argValue(args, '--config');
const config: RevisionConfig = configPath
  ? JSON.parse(await readFile(path.resolve(configPath), 'utf8')) as RevisionConfig
  : {};
const server = args.includes('--own-server') ? await startGameServer({ hmr: false }) : {
  url: argValue(args, '--url') ?? 'http://127.0.0.1:4179',
  close: async () => {},
};
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});

const report: Record<string, unknown> = {
  part,
  configPath: configPath ? path.resolve(configPath) : null,
  passed: false,
  cases: [],
};

const distance = (a: Point, b: XZ): number => Math.hypot(a.x - b[0], a.z - b[1]);
const yawToward = (from: XZ, to: XZ): number => Math.atan2(from[0] - to[0], from[1] - to[1]);
const addOrigin = (point: XZ): XZ => [LAB_ORIGIN[0] + point[0], LAB_ORIGIN[1] + point[1]];

try {
  await driver.launch();
  const catalog = argValue(args, '--catalog');
  if (catalog) report.catalogIds = await installAssetCandidates(driver.page!, catalog);
  await driver.open(part === 'world' ? 300_000 : 60_000, part === 'world'
    ? '/index.html?startup-cache=0'
    : '/index.html?mode=building&atmosphere=1&startup-cache=0');
  const page = driver.page!;
  page.setDefaultTimeout(10_000);

  const closeLabPanel = async () => {
    const closePanel = page.locator('#panel-feature-lab .panel__close');
    if (await closePanel.isVisible()) await closePanel.click();
  };

  const ground = async (at: XZ): Promise<number> => page.evaluate(([x, z]) =>
    (window.__gameDebug as any).groundHeight(x, z), at);

  const setFollowPose = async (pose: Pose): Promise<any> => {
    const y = await ground([pose.x, pose.z]);
    await page.evaluate(({ pose, y, distance }) => {
      const debug = window.__gameDebug as any;
      debug.teleport([pose.x, y, pose.z]);
      debug.inspectPose({ ...pose, y, pitch: pose.pitch ?? .35, distance, detached: false });
    }, { pose, y, distance: CAMERA.maxDistance });
    await page.waitForTimeout(250);
    const camera = await page.evaluate(() => (window.__gameDebug as any).getCamera());
    assert.equal(camera.freeMove, false, 'Acceptance screenshots must use the player-follow camera');
    assert(Math.abs(camera.pitch - (pose.pitch ?? .35)) < .001, `Unexpected camera pitch ${camera.pitch}`);
    assert(camera.requestedDistance <= CAMERA.maxDistance + .01,
      `Camera exceeded interactive zoom: ${camera.requestedDistance}`);
    return camera;
  };

  const structureParts = async (ownerId: string): Promise<{
    ids: string[];
    drawn: { id: string; bounds: DrawnBounds }[];
    actualBounds: { min: Point; max: Point };
  }> => {
    const ids = await page.evaluate(owner => {
      const base = owner.endsWith('#') ? owner.slice(0, -1) : owner;
      return (window.__gameDebug as any).getEntities()
      .map((entity: { id: string }) => entity.id)
      .filter((id: string) => (id === base || id.startsWith(`${base}#`)) &&
        !!(window.__gameDebug as any).getEntity(id)?.view);
    }, ownerId);
    assert(ids.length > 0, `${ownerId}: no semantic structure parts`);
    await page.waitForFunction(partIds => partIds.every((id: string) =>
      (window.__gameDebug as any).getDrawnBounds(id)?.meshes > 0), ids,
    { timeout: 35_000, polling: 200 });
    const drawn = await page.evaluate(partIds => partIds.map((id: string) => ({
      id, bounds: (window.__gameDebug as any).getDrawnBounds(id),
    })), ids) as { id: string; bounds: DrawnBounds }[];
    const actualBounds = drawn.reduce((total, row) => ({
      min: {
        x: Math.min(total.min.x, row.bounds.min.x),
        y: Math.min(total.min.y, row.bounds.min.y),
        z: Math.min(total.min.z, row.bounds.min.z),
      },
      max: {
        x: Math.max(total.max.x, row.bounds.max.x),
        y: Math.max(total.max.y, row.bounds.max.y),
        z: Math.max(total.max.z, row.bounds.max.z),
      },
    }), {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
    });
    return { ids, drawn, actualBounds };
  };

  const traverseGateway = async (gateway: Gateway) => {
    const fromY = await ground(gateway.from);
    const toY = await ground(gateway.to);
    const pathResult = await page.evaluate(({ gateway, fromY, toY }) => {
      const debug = window.__gameDebug as any;
      return debug.getNavPath(
        [gateway.from[0], fromY, gateway.from[1]],
        [gateway.to[0], toY, gateway.to[1]],
      );
    }, { gateway, fromY, toY });
    assert(pathResult && pathResult.length >= 2, 'Gateway has no production navigation path');
    await page.evaluate(({ gateway, fromY, yaw, distance }) => {
      window.__featureLab?.setWalkingEnabled(true);
      const debug = window.__gameDebug as any;
      debug.teleport([gateway.from[0], fromY, gateway.from[1]]);
      debug.inspectPose({ x: gateway.from[0], y: fromY, z: gateway.from[1], yaw,
        pitch: .35, distance, detached: false });
    }, { gateway, fromY, yaw: yawToward(gateway.from, gateway.to), distance: CAMERA.maxDistance });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => ({
      player: (window.__gameDebug as any).getPlayerPosition(),
      navigation: (window.__gameDebug as any).getNavigationState(),
    }));
    await page.locator('canvas#viewport').focus();
    const span = Math.hypot(gateway.to[0] - gateway.from[0], gateway.to[1] - gateway.from[1]);
    await page.keyboard.down('w');
    await page.waitForTimeout(gateway.holdMs ?? Math.ceil(span / 5.2 * 1000));
    await page.keyboard.up('w');
    const after = await page.evaluate(() => ({
      player: (window.__gameDebug as any).getPlayerPosition(),
      navigation: (window.__gameDebug as any).getNavigationState(),
    }));
    const progress = ((after.player.x - gateway.from[0]) * (gateway.to[0] - gateway.from[0])
      + (after.player.z - gateway.from[1]) * (gateway.to[1] - gateway.from[1])) / span;
    assert(progress > span / 2, `Keyboard movement did not cross the gateway midpoint: ${progress.toFixed(2)} / ${span.toFixed(2)} m`);
    assert(distance(after.player, gateway.to) < distance(before.player, gateway.to),
      `Keyboard movement did not approach the gateway destination: ${JSON.stringify({before:before.player,after:after.player,gateway,progress})}`);
    return { gateway, path: pathResult, before, after, progress };
  };

  const runLabCase = async (id: string, options: LabCaseConfig, castle: boolean) => {
    const beforeRevision = await page.evaluate(() => window.__featureLab!.getState().structure.revision);
    const structure = await page.evaluate(async structureId =>
      (await window.__featureLab!.setStructure({ kind: 'composition', id: structureId, kit: 'stone' })).structure, id);
    await closeLabPanel();
    assert(structure.ready && structure.revision > beforeRevision, `${id}: production structure did not rebuild`);
    assert(structure.partCount > 0 && structure.assetCount > 0, `${id}: structure has no parts or assets`);
    assert(structure.collisionCount > 0, `${id}: structure has no production collision`);
    assert(structure.bounds, `${id}: structure has no semantic bounds`);
    const width = Math.max(
      structure.bounds.max[0] - structure.bounds.min[0],
      structure.bounds.max[2] - structure.bounds.min[2],
    );
    if (castle) assert(width >= 48 && width <= 67, `${id}: expected a roughly 50-65 m castle footprint, got ${width.toFixed(2)} m`);
    const centreX = (structure.bounds.min[0] + structure.bounds.max[0]) / 2;
    const overview = options.pose ?? {
      x: centreX,
      z: structure.bounds.max[2] + 5,
      yaw: 0,
    };
    const camera = await setFollowPose(overview);
    const parts = await structureParts('feature-lab:structure');
    const assetIds = await page.evaluate(ids => ids.map(id =>
      (window.__gameDebug as any).getEntity(id).view.assetId), parts.ids);
    await driver.screenshot(out, id);
    const navigation = await page.evaluate(() => (window.__gameDebug as any).getNavigationState());
    assert.equal(navigation.status, 'ready', `${id}: navigation is not ready`);
    const gateway = options.gateway ? await traverseGateway(options.gateway) : null;
    if (gateway) await driver.screenshot(out, `${id}-gateway-crossed`);
    return { id, assetIds, structure, width, parts, overview, camera, navigation, gateway,
      gatewayStatus: gateway ? 'crossed-by-keyboard' : 'not-configured' };
  };

  if (part === 'castles') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('crownward');
    await closeLabPanel();
    for (const id of CASTLE_IDS) {
      (report.cases as unknown[]).push(await runLabCase(id, config.castles?.[id] ?? {}, true));
    }
  } else if (part === 'wilderness') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('wilderness');
    (report.cases as unknown[]).push(await runLabCase('black_knight_castle', {
      pose: { x: -8, z: 64, yaw: 0, pitch: .18 },
      gateway: { from: [-8, 39], to: [-8, 26] },
    }, false));
    await closeLabPanel();
    for (const id of WILDERNESS_RUIN_IDS) {
      const definition = WILDERNESS_RUINS[id];
      const defaults: LabCaseConfig = {
        gateway: { from: addOrigin(definition.clearThrough[0]), to: addOrigin(definition.clearThrough[1]) },
      };
      (report.cases as unknown[]).push(await runLabCase(id, {
        ...defaults,
        ...config.wilderness?.[id],
      }, false));
    }
  } else {
    await closeLabPanel();
    const siteById = new Map(WILDERNESS_RUIN_SITES.map(site => [site.id, site]));
    const defaultSiteShots = ['east_kingspan', 'far_cinder_smithy', 'starless_abbey'].map(id => {
      const site = siteById.get(id);
      assert(site, `Missing default Wilderness site ${id}`);
      return {
        name: id,
        x: site.position[0],
        z: site.position[1] + 10,
        yaw: 0,
        expectedRegion: 'wilderness',
        partPrefix: id,
      } satisfies WorldShot;
    });
    const shots: WorldShot[] = config.worldShots ?? [
      { name: 'crownward-coastline', x: 675, z: 100, yaw: -Math.PI / 2, expectedRegion: 'crownward' },
      { name: 'crownward-t40-width', x: 555, z: 140, yaw: 0, expectedRegion: 'crownward' },
      ...defaultSiteShots,
    ];
    for (const shot of shots) {
      const camera = await setFollowPose(shot);
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => ({
        game: (window.__gameDebug as any).getState(),
        player: (window.__gameDebug as any).getPlayer(),
        navigation: (window.__gameDebug as any).getNavigationState(),
        sample: (window.__gameDebug as any).sampleWorld(
          (window.__gameDebug as any).getPlayerPosition().x,
          (window.__gameDebug as any).getPlayerPosition().z,
        ),
      }));
      assert.equal(state.navigation.status, 'ready', `${shot.name}: navigation is not ready`);
      if (shot.expectedRegion) assert.equal(state.player.regionId, shot.expectedRegion,
        `${shot.name}: player is outside the expected region`);
      const parts = shot.partPrefix ? await structureParts(shot.partPrefix) : null;
      await page.waitForFunction(() => {
        const shaders = (window as any).__renderDistanceLab.shaders();
        return shaders.waiting === 0 && shaders.queued === 0 && !shaders.compiling;
      }, undefined, { timeout: 120_000 });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await driver.screenshot(out, shot.name);
      (report.cases as unknown[]).push({ shot, camera, state, parts });
    }
    report.citadelGate = await traverseGateway({ from: [560.2, 291.8], to: [560.2, 299.6] });
    await driver.screenshot(out, 'citadel-arch-crossed');
    const courtyardY = await ground([574.2, 320.6]);
    report.courtPath = await page.evaluate(({ y }) => (window.__gameDebug as any).getNavPath(
      [560.2, y, 299.6], [574.2, y, 320.6]), { y: courtyardY });
    assert((report.courtPath as unknown[]).length >= 2, 'Citadel boss court is disconnected');
    const end = (report.courtPath as Point[]).at(-1)!;
    assert(Math.hypot(end.x - 574.2, end.z - 320.6) < 1.5, 'Citadel path stops short of the court');
  }

  report.gameErrors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  if (part === 'castles') report.acceptedCandidateIds = [...new Set((report.cases as {assetIds:string[]}[]).flatMap(row => row.assetIds))];
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
  console.log(JSON.stringify({ part, passed: report.passed, error: report.error, out: path.relative(repoRoot, out) }));
  await driver.close();
  await server.close();
}
