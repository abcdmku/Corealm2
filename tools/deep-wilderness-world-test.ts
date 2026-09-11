/** Root-only final-world acceptance. Run one band per invocation after the final navigation bake. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameDriver } from './lib/driver.js';
import { startGameServer, type RunningGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';
import { CAMERA } from '../game/src/app/config.js';
import type { SemanticEntity, GameEvent, DocHit } from '../game/src/contracts.js';
import { REGIONS } from '../game/src/content/regions.js';
import { ENEMIES, enemyBlockFor } from '../game/src/content/enemies.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import { REGIONAL_BOSS_BODIES, REGIONAL_BOSS_SPECIES } from '../game/src/content/regionalBossBodies.js';
import { REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { isStarterAnimalAsset } from '../game/src/content/fantasyEncounters.js';
import { encounterPopulationCount } from '../game/src/content/encounterPopulation.js';
import { Rng } from '../game/src/core/rng.js';
import { variantSeed } from '../game/src/render/buildings.js';
import type { GameState } from '../game/src/state/store.js';
import { activatedRegionalPackIds } from '../game/src/content/regionalPackActivation.js';
import { WILDERNESS_DEPTH, WILDERNESS_EXPANSION_SITES, wildernessMagicAt, wildernessTierAt } from '../game/src/content/wildernessDepth.js';
import { DEEP_WILDERNESS_PACKS, DEEP_WILDERNESS_KEEPERS } from '../game/src/content/deepWildernessEncounters.js';
import { WILDERNESS_LOOT_ITEMS, WILDERNESS_LOOT_RECIPES, wildernessDrops } from '../game/src/content/wildernessLoot.js';
import { WILDERNESS_RESOURCE_CLUSTERS, WILDERNESS_RESOURCE_SITES } from '../game/src/content/wildernessResources.js';
import { WILDERNESS_LAVA_EXPANSION_CHANNELS, lavaSections, sampleLavaChannel, type LavaChannel } from '../game/src/content/wildernessLava.js';
import { DEEP_WILDERNESS_STRUCTURES, buildDeepWildernessStructure, buildDeepWildernessStructureCollisionParts } from '../game/src/render/compositions/deepWildernessStructures.js';
import type { WildernessEffectsState } from '../game/src/render/wildernessEffects.js';
import { SCATTER_STREAM_TILE_METRES } from '../game/src/world/scatter.js';

type Point = { x: number; y: number; z: number };
type XZ = readonly [number, number];
type CameraState = { position: Point; target: Point; freeMove: boolean; distance: number; requestedDistance: number; pitch: number; effectivePitch: number };
type Bounds = { min: Point; max: Point; meshes: number; fade: number };
const bands = ['shallow', 'deep', 'structures', 'resources', 'mobile', 'coast', 'regions'] as const;
type Band = typeof bands[number];
const args = process.argv.slice(2);
const option = (name: string) => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  ?? (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (args.includes('--help')) {
  console.log('npx tsx tools/deep-wilderness-world-test.ts --band shallow|deep|structures|resources|mobile|coast|regions [--headed]');
  process.exit(0);
}
const band = option('--band') as Band;
assert(bands.includes(band), 'Supply exactly one --band shallow|deep|structures|resources|mobile|coast|regions');
const started = Date.now();
const budgetMs = 120_000, operationMs = 112_000;
const clearDeadline = installTestDeadline(`Deep Wilderness world ${band}`, budgetMs);
const out = `test-results/deep-wilderness-world/${band}`;
const viewport = band === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
let server: RunningGameServer | undefined, driver: GameDriver | undefined;
let stage = 'startup';
const evidence: unknown[] = [];
const report = { band, passed: false, budgetMs, operationMs, viewport, route: '/index.html',
  visualReview: 'pending root inspection',
  setup: 'Grounded inspectPose uses the player-follow camera, normal pitch and 6–11 m zoom. The player starts with Melee/Magic 99, normal Nightglass defensive gear and full derived health so short visits are possible. Resource setup grants Mining 99 and a pickaxe. Coast resets call the existing reset({seed, keepSave:false}) and observe the fresh player before further input. The cave visit loads the existing production cave and teleports onto its observed nav floor with the follow camera. No simulation speed change, capture mode, detached focus, asset replacement or enemy health edit.',
  lootScope: 'Drops are checked against Node canonical ENEMIES, mapped to live entity meta.enemyDefId, HP and combat level. This does not reread the browser registry drop table or prove a world kill. The accepted production loot lab owns death, pickup and rune spending.',
  evidence, failure: undefined as string | undefined, elapsedMs: 0 };
const remaining = (limit = 5000) => {
  const time = operationMs - (Date.now() - started);
  assert(time > 0, `Operation deadline reached at ${stage}; split coverage, do not extend the 120-second budget`);
  return Math.max(1, Math.min(limit, time));
};
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z);
const rotate = (centre: XZ, yaw: number, local: XZ): XZ => [centre[0] + local[0] * Math.cos(yaw) + local[1] * Math.sin(yaw),
  centre[1] - local[0] * Math.sin(yaw) + local[1] * Math.cos(yaw)];
const local = (centre: XZ, yaw: number, point: Point): XZ => [(point.x - centre[0]) * Math.cos(yaw) - (point.z - centre[1]) * Math.sin(yaw),
  (point.x - centre[0]) * Math.sin(yaw) + (point.z - centre[1]) * Math.cos(yaw)];
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);
function completePath(path: Point[] | null, from: Point, to: Point, label: string): asserts path is Point[] {
  assert(path && path.length >= 2, `${label}: no navigation path`);
  assert(distance(path[0]!, from) <= .8, `${label}: snapped start misses the requested endpoint`);
  assert(distance(path.at(-1)!, to) <= .8, `${label}: partial path stops before the requested endpoint`);
}

try {
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  server = await startGameServer({ hmr: false });
  driver = new GameDriver(server, { viewport, headless: !args.includes('--headed'),
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(5000);
  // tsx may preserve names in evaluate callbacks. This helper changes no game state.
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await driver.open(remaining(60_000), report.route);
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  const debug = async <T = any>(method: string, values: unknown[] = []): Promise<T> => {
    remaining(1);
    return await driver!.callDebug(method, values) as T;
  };
  const record = async (value: unknown) => {
    evidence.push(value);
    report.elapsedMs = Date.now() - started;
    await writeFile(`${out}/report.json`, JSON.stringify({ ...report, stage }, null, 2));
  };
  await debug('setSkillLevel', ['melee', 99]);
  await debug('setSkillLevel', ['magic', 99]);
  const defensiveGear = ['nightglass_helm', 'nightmarshal_plate', 'nightglass_greaves', 'nightglass_boots', 'nightglass_gauntlets'];
  for (const itemId of defensiveGear) {
    assert((await debug('giveItem', [itemId, 1, 'inventory'])).ok, `${itemId}: setup gear is absent from the running item registry`);
    const equipped = await debug('callTool', ['corealm_equip', { itemId }]);
    assert(!equipped?.error, `${itemId}: normal equipment setup failed`);
  }
  await page.waitForFunction(() => (window.__gameDebug as any).getPlayer().maxHealth > 300, undefined, { timeout: remaining(2000) });
  await debug('setHealth', [(await debug('getPlayer')).maxHealth]);
  await record({ playerSetup: { melee: 99, magic: 99, defensiveGear, player: await debug('getPlayer') } });
  async function observe() {
    return await page.evaluate(() => {
      const d = window.__gameDebug as any;
      const p = d.getPlayerPosition();
      const actor = d.getPlayer();
      const navFloor = actor.regionId === 'gravelmaw' ? d.getNavPoint([p.x, p.y, p.z]) : null;
      return { player: p as Point, actor: d.getPlayer(), camera: d.getCamera() as CameraState,
        state: d.getState(), ground: actor.regionId === 'gravelmaw' ? navFloor?.y : d.groundHeight(p.x, p.z),
        groundSource: actor.regionId === 'gravelmaw' ? 'observed cave navigation floor' : 'production terrain', world: d.sampleWorld(p.x, p.z),
        atmosphere: d.getBiomeAtmosphere(), navigation: d.getNavigationState(),
        effects: (window as any).__wildernessEffects?.getState() as WildernessEffectsState | undefined,
        origin: performance.timeOrigin };
    });
  }
  async function normalCamera() {
    const state = await observe(), c = state.camera;
    assert.equal(state.origin, documentOrigin, 'The acceptance document reloaded');
    assert.equal(state.state.ready, true);
    assert.equal(state.state.clock.timeScale, 1, 'Acceptance must use natural simulation time');
    assert.equal(state.actor.dead, false, 'The player died during the scene');
    assert.equal(c.freeMove, false, 'Detached camera is prohibited');
    assert(c.requestedDistance >= 6 && c.requestedDistance <= 11, 'Requested camera zoom is outside gameplay limits');
    assert(c.distance >= 6 && c.distance <= 11.01, 'Choose an ordinary standing view with 6–11 m effective camera distance');
    assert(c.pitch >= CAMERA.minPitch && c.pitch <= CAMERA.maxPitch);
    assert(c.effectivePitch >= CAMERA.minPitch - .001 && c.effectivePitch <= CAMERA.maxPitch + .001);
    assert(Math.hypot(c.target.x - state.player.x, c.target.z - state.player.z) < .15, 'Camera focus left the player');
    assert(Math.abs(c.target.y - state.player.y - 1.1) < .15, 'Camera target was raised above normal player follow');
    assert(Math.abs(state.player.y - state.ground) < .18, 'Player is not grounded');
    return state;
  }
  async function settle(ids: string[] = [], scenery = true) {
    await page.waitForFunction(({ ids, scenery, tileSize }) => {
      const d = window.__gameDebug as any;
      const residency = d.getEntityViewStats().residency;
      if (residency.failed || residency.missing || residency.pending) return false;
      const residents = new Set(residency.residentIds);
      if (!ids.every(id => residents.has(id) && d.getDrawnBounds(id)?.meshes > 0)) return false;
      const shaders = (window as any).__renderDistanceLab?.shaders();
      if (shaders && (shaders.waiting || shaders.queued || shaders.compiling)) return false;
      if (!scenery) return true;
      const p = d.getPlayerPosition();
      return d.getScatterResidency().pending.every((id: string) => {
        const [col, row] = id.split(':').map(Number);
        const dx = Math.max(col! * tileSize - p.x, 0, p.x - (col! + 1) * tileSize);
        const dz = Math.max(row! * tileSize - p.z, 0, p.z - (row! + 1) * tileSize);
        return dx * dx + dz * dz > 65 * 65;
      });
    }, { ids, scenery, tileSize: SCATTER_STREAM_TILE_METRES }, { timeout: remaining(14_000), polling: 120 });
    await page.waitForTimeout(remaining(220));
  }
  async function frame(point: XZ, yaw = 0, pitch = .34, ids: string[] = []) {
    const y = await debug<number>('groundHeight', [...point]);
    assert.equal(await debug('inspectPose', [{ x: point[0], y, z: point[1], yaw, pitch, distance: 11, detached: false }]), true);
    await settle(ids);
    return await normalCamera();
  }
  async function capture(name: string, detail?: unknown) {
    const state = await normalCamera();
    await page.screenshot({ path: `${out}/${name}.png`, timeout: remaining(5000) });
    await record({ capture: `${name}.png`, stage, ...state, detail });
  }
  async function walk(key: string, holdMs: number, label: string, minimum = .8) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = await observe();
    await page.keyboard.down(key);
    try { await page.waitForTimeout(remaining(holdMs)); }
    finally { await page.keyboard.up(key); }
    await page.waitForTimeout(remaining(450));
    const after = await normalCamera();
    assert(distance(before.player, after.player) >= minimum, `${label}: real ${key.toUpperCase()} input did not move the player`);
    await record({ input: { key, holdMs, label }, before, after });
    return { before, after };
  }
  async function navPath(from: XZ, to: XZ, label: string) {
    const result = await page.evaluate(({ from, to }) => {
      const d = window.__gameDebug as any;
      const a = { x: from[0], y: d.groundHeight(...from), z: from[1] };
      const b = { x: to[0], y: d.groundHeight(...to), z: to[1] };
      return { from: a, to: b, path: d.getNavPath([a.x, a.y, a.z], [b.x, b.y, b.z]) as Point[] | null,
        samples: [d.sampleWorld(...from), d.sampleWorld(...to)] };
    }, { from, to });
    completePath(result.path, result.from, result.to, label);
    assert(result.samples.every(sample => sample.playable && !sample.waterBodyId), `${label}: endpoint is not dry playable ground`);
    return { ...result, path: result.path };
  }
  async function pointerEntity(id: string) {
    const bounds = await debug<Bounds>('getDrawnBounds', [id]); assert(bounds && bounds.meshes > 0);
    const camera = (await normalCamera()).camera;
    const rect = await page.locator('#viewport').boundingBox(); assert(rect);
    const projection = new PerspectiveCamera(CAMERA.fov, rect.width / rect.height, CAMERA.near, CAMERA.far);
    projection.position.set(camera.position.x, camera.position.y, camera.position.z);
    projection.lookAt(camera.target.x, camera.target.y, camera.target.z); projection.updateMatrixWorld(true);
    for (const y of [.45, .25, .7]) for (const x of [.5, .3, .7]) {
      const projected = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * x,
        bounds.min.y + (bounds.max.y - bounds.min.y) * y, (bounds.min.z + bounds.max.z) / 2).project(projection);
      const px = rect.x + (projected.x + 1) * rect.width / 2, py = rect.y + (1 - projected.y) * rect.height / 2;
      if (projected.z < -1 || projected.z > 1 || px < 0 || py < 0 || px >= viewport.width || py >= viewport.height) continue;
      await page.mouse.move(px, py); await page.waitForTimeout(remaining(80));
      const hit = await page.evaluate(({ px, py }) => ({ hovered: (window.__gameDebug as any).getState().hoveredEntityId,
        canvas: document.elementFromPoint(px, py)?.tagName === 'CANVAS' }), { px, py });
      if (hit.hovered !== id || !hit.canvas) continue;
      await page.mouse.click(px, py); return { x: px, y: py, ...hit };
    }
    throw new Error(`No real canvas hover on ${id}; inspect the grounded approach`);
  }

  // Read initial populations before a visit can provoke an actor or change its state.
  stage = 'world population wiring';
  const actors = await page.evaluate(() => {
    const d = window.__gameDebug as any;
    return d.getEntities().filter((row: any) => row.archetype === 'enemy' || row.archetype === 'boss')
      .map((row: any) => d.getEntity(row.id)) as SemanticEntity[];
  });
  const groups = new Map<string, SemanticEntity[]>();
  for (const actor of actors) {
    const id = actor.meta?.groupId;
    assert.equal(typeof id, 'string', `${actor.id}: no stable groupId`);
    const key = id as string;
    groups.set(key, [...(groups.get(key) ?? []), actor]);
  }
  for (const [id, rows] of groups) {
    const boss = rows.some(row => row.meta?.rank === 'boss' || row.meta?.rank === 'miniboss');
    assert(boss ? rows.length === 1 : rows.length >= 7 && rows.length <= 15,
      `${id}: ${rows.length} simultaneous residents violates ${boss ? 'singleton boss' : 'ordinary 7–15 pack'} rule`);
    assert(rows.every(row => row.state === 'alive'), `${id}: a fresh world began with a missing/dead resident`);
  }
  const authoredGroups = REGIONS.flatMap(region => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
  for (const group of authoredGroups) assert(groups.has(group.id), `${group.id}: authored surface/cave group absent from world`);
  const activePacks = activatedRegionalPackIds();
  for (const id of activePacks) assert(groups.has(id), `${id}: active RPG pack absent from world`);
  assert(actors.some(actor => actor.regionId === 'gravelmaw'), 'Cave population was not constructed');
  assert([...groups.keys()].some(id => id.startsWith('coastal_')), 'Coastal population was not constructed');
  const wilderness = REGIONS.find(region => region.id === 'wilderness')!;
  assert.deepEqual([wilderness.bounds.min[1], wilderness.bounds.max[1]], [460, 940], 'Wilderness semantic extent is not z460..940');
  const newIds = new Set(DEEP_WILDERNESS_PACKS.map(pack => pack.id));
  const oldPacks = wilderness.enemyGroups.filter(group => !group.boss && !group.miniBoss && !newIds.has(group.id));
  assert.equal(oldPacks.length, 33, 'The previous 33 Wilderness packs must remain registered');
  for (const group of wilderness.enemyGroups.filter(row => !row.boss && !row.miniBoss)) {
    for (const actor of groups.get(group.id) ?? []) assert.equal(actor.tier, wildernessTierAt(group.centre[1]), `${actor.id}: wrong shallow/deep tier`);
  }
  assert(actors.filter(actor => actor.regionId === 'wilderness' && !actor.meta?.rank)
    .every(actor => actor.tier === 50 || actor.tier === 70), 'An ordinary Wilderness or coastal actor retained an obsolete tier');
  assert.equal(DEEP_WILDERNESS_PACKS.length, 24);
  assert.equal(DEEP_WILDERNESS_PACKS.reduce((sum, pack) => sum + pack.count, 0), 225);
  const canonicalDrops: unknown[] = [];
  for (const pack of DEEP_WILDERNESS_PACKS) {
    const rows = groups.get(pack.id) ?? [];
    assert.equal(rows.length, pack.count, `${pack.id}: wrong simultaneous resident count`);
    for (const actor of rows) {
      assert.equal(actor.regionId, 'wilderness');
      assert.equal(actor.tier, wildernessTierAt(pack.centre[1]), `${actor.id}: wrong progression band`);
      assert.equal(actor.view?.assetId, `creature_${pack.speciesId}`, `${actor.id}: wrong production creature body`);
      const block = ENEMIES.find(row => row.id === actor.meta?.enemyDefId);
      assert(block, `${actor.id}: live enemyDefId does not resolve in canonical ENEMIES`);
      assert.equal(actor.combat?.maxHealth, block.maxHealth);
      assert.equal(actor.combat?.level, enemyCombatLevel(block));
      const expected = wildernessDrops(pack.speciesId, actor.tier, undefined, pack.siteId as Parameters<typeof wildernessDrops>[3]);
      assert.deepEqual(block.drops, expected, `${actor.id}: canonical drops differ from Wilderness contract`);
    }
    canonicalDrops.push({ groupId: pack.id, enemyDefIds: [...new Set(rows.map(row => row.meta?.enemyDefId))], scope: 'Node canonical drops plus live actor mapping' });
  }
  const keeperLevels = [150, 200, 210, 280, 350];
  for (const [index, keeper] of DEEP_WILDERNESS_KEEPERS.entries()) {
    const rows = groups.get(keeper.id) ?? [];
    assert.equal(rows.length, 1, `${keeper.id}: keeper must be a singleton`);
    const actor = rows[0]!;
    assert.equal(actor.combat?.level, keeperLevels[index], `${keeper.id}: wrong effective level`);
    assert.equal(actor.tier, keeper.tier);
    assert.equal(actor.view?.assetId, `creature_${keeper.id}`, `${keeper.id}: wrong production keeper body`);
    const block = ENEMIES.find(row => row.id === actor.meta?.enemyDefId);
    assert(block, `${keeper.id}: missing canonical enemy definition`);
    assert.equal(actor.combat?.maxHealth, block.maxHealth);
    assert.deepEqual(block.drops, wildernessDrops(keeper.id, keeper.tier, keeper.id));
  }
  await record({ census: [...groups].map(([id, rows]) => ({ id, count: rows.length, region: rows[0]!.regionId,
    tier: rows[0]!.tier, ranks: [...new Set(rows.map(row => row.meta?.rank ?? 'ordinary'))] })),
    newPackCount: 24, newResidents: 225, oldPacks: oldPacks.length, activePacks, keeperLevels, canonicalDrops });

  async function actorScene(groupId: string, label: string) {
    stage = label;
    const outer = [...groups.get(groupId)!].sort((a, b) => b.position[2] - a.position[2])[0]!;
    const actor = await debug<SemanticEntity>('getEntity', [outer.id]);
    const offset = Math.max((actor.combat?.bodyRadius ?? 2) + 5, (actor.combat?.aggroRadius ?? 0) + 2);
    await frame([actor.position[0], actor.position[2] + offset], 0, .34, [actor.id]);
    const before = { actor: await debug('getEntity', [actor.id]), motion: await debug('getEntityMotion', [actor.id]) };
    await capture(`${label}-before`, before);
    const movement = await walk('s', 450, label, .6);
    await capture(`${label}-after`, { before, movement, actor: await debug('getEntity', [actor.id]), motion: await debug('getEntityMotion', [actor.id]) });
  }
  async function lavaScene(channel: LavaChannel, label: string) {
    stage = label;
    const section = lavaSections(channel).reduce((best, row) => Math.abs(row.progress - .5) < Math.abs(best.progress - .5) ? row : best);
    const normal: XZ = [-section.tz, section.tx];
    const offset = section.halfWidth + channel.bankWidth + 2.5;
    const bank: XZ = [section.x - normal[0] * offset, section.z - normal[1] * offset];
    await frame(bank, yawToward(normal[0], normal[1]), .32);
    const before = await observe();
    assert(before.effects?.enabled && before.effects.lightingEnabled && before.effects.moltenTriangles > 0);
    assert.equal(before.effects.channels, WILDERNESS_LAVA_EXPANSION_CHANNELS.length);
    assert.equal(before.effects.pools, WILDERNESS_LAVA_EXPANSION_CHANNELS.filter(row => row.kind === 'pool').length);
    const movement = await walk('s', 800, `${label} dry bank`, 1.1);
    assert(sampleLavaChannel(channel, movement.after.player.x, movement.after.player.z).signedDistance
      > sampleLavaChannel(channel, movement.before.player.x, movement.before.player.z).signedDistance + .5);
    const after = await observe();
    assert(after.effects && after.effects.seconds > before.effects.seconds && after.effects.liveParticles > 0, 'Lava clock or particles stopped');
    await capture(`${label}-safe-bank`, { channelId: channel.id, section, before, after });
    const crossingOffset = section.halfWidth + 1.6;
    await frame([section.x - normal[0] * crossingOffset, section.z - normal[1] * crossingOffset], yawToward(normal[0], normal[1]), .32);
    const crossingBefore = await observe();
    const samples: { player: Point; clearance: number }[] = [];
    await page.keyboard.down('w');
    try {
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(remaining(160));
        const player = await debug<Point>('getPlayerPosition');
        const clearance = sampleLavaChannel(channel, player.x, player.z).signedDistance;
        samples.push({ player, clearance });
        assert(clearance > .05, 'Real keyboard movement entered molten lava');
      }
    } finally { await page.keyboard.up('w'); }
    const initialClearance = sampleLavaChannel(channel, crossingBefore.player.x, crossingBefore.player.z).signedDistance;
    assert(Math.min(...samples.map(row => row.clearance)) < initialClearance - .15, 'Crossing input did not reach the lava barrier');
    await page.waitForTimeout(remaining(450));
    await capture(`${label}-blocked`, { channelId: channel.id, crossingBefore, initialClearance, samples });
  }

  if (band === 'coast') {
    // Read reset results in the same browser turn, before a new AI tick can move a resident.
    const coastalSnapshot = async (resetSeed?: number) => await page.evaluate(resetSeed => {
      const d = window.__gameDebug as any;
      const previousErrors = d.getErrors();
      if (resetSeed !== undefined) d.reset({ seed: resetSeed, keepSave: false });
      const state = d.getState(), save = JSON.parse(d.getSaveBlob()) as GameState;
      const rows = d.getEntities().filter((row: any) => row.id.startsWith('coastal_') && row.archetype === 'enemy')
        .map((row: any) => d.getEntity(row.id)) as SemanticEntity[];
      return { seed: state.seed as number, rows, player: save.player, combat: save.combat, activity: save.activity,
        runtimes: Object.fromEntries(Object.entries(save.world.enemies).filter(([id]) => id.startsWith('coastal_'))),
        previousErrors, errors: d.getErrors(), state, origin: performance.timeOrigin };
    }, resetSeed);
    type CoastalSnapshot = Awaited<ReturnType<typeof coastalSnapshot>>;
    const signature = (snapshot: CoastalSnapshot) => snapshot.rows.map(row => ({ id: row.id,
      groupId: row.meta?.groupId, spawn: [row.meta?.spawnX, snapshot.runtimes[row.id]?.spawnPos[1] ?? row.position[1], row.meta?.spawnZ], tier: row.tier,
      family: row.meta?.family, enemyDefId: row.meta?.enemyDefId, assetId: row.view?.assetId,
      scale: row.view?.scale, maxHealth: row.combat?.maxHealth, level: row.combat?.level }))
      .sort((a, b) => a.id.localeCompare(b.id));
    async function validateCoast(snapshot: CoastalSnapshot, fresh: boolean) {
      assert.equal(snapshot.origin, documentOrigin);
      assert(snapshot.rows.length >= 7, 'The rebuilt world has no complete coastal pack');
      assert.deepEqual(snapshot.previousErrors, [], 'A reset would erase errors from the preceding coast visit');
      assert.deepEqual(snapshot.errors, []);
      const byGroup = new Map<string, SemanticEntity[]>();
      for (const row of snapshot.rows) {
        assert.equal(typeof row.meta?.groupId, 'string', `${row.id}: coastal group metadata missing`);
        const id = row.meta!.groupId as string;
        byGroup.set(id, [...(byGroup.get(id) ?? []), row]);
      }
      // These are generated cell IDs observed on actual entities. Use the production RNG and
      // current terrain sample to check each source selection; do not import browser modules.
      const sites = [...byGroup.keys()].map(id => {
        const cell = /^coastal_(-?\d+)_(-?\d+)$/.exec(id);
        assert(cell, `${id}: cannot resolve an observed coastal generation cell`);
        const x = Number(cell[1]), z = Number(cell[2]);
        const rng = new Rng(snapshot.seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663));
        return { id, x: x + rng.float(6, 30), z: z + rng.float(6, 30) };
      });
      const samples = await page.evaluate(sites => sites.map(site => ({ ...site,
        sample: (window.__gameDebug as any).sampleWorld(site.x, site.z) })), sites);
      for (const site of samples) {
        const rows = byGroup.get(site.id)!;
        assert(rows.length >= 7 && rows.length <= 15, `${site.id}: reset left a partial or oversized coastal pack`);
        assert(site.sample.playable && site.sample.coast && !site.sample.waterBodyId, `${site.id}: regenerated source is not dry coast`);
        const region = REGIONS.find(row => row.id === (site.sample.semanticRegion === 'wilderness' ? 'wilderness' : site.sample.visualBiome));
        const tier = site.sample.semanticRegion === 'wilderness' ? wildernessTierAt(site.z) : region?.tier ?? 1;
        const sources = region?.enemyGroups.filter(group => !group.boss && !group.miniBoss
          && !isStarterAnimalAsset(group.assetId) && (site.sample.semanticRegion !== 'wilderness' || group.tier === tier)) ?? [];
        const source = new Rng(snapshot.seed ^ variantSeed(site.id)).pick(sources);
        assert(source, `${site.id}: current seed has no eligible production species`);
        assert.equal(rows.length, source.count >= 7 && source.count <= 15 ? source.count
          : encounterPopulationCount({ id: site.id, count: 1 }), `${site.id}: resident count differs from the regenerated source`);
        const native = enemyBlockFor(site.id, source.family, tier);
        assert(native, `${site.id}: missing native family/T${tier} block`);
        for (const row of rows) {
          assert.equal(row.meta?.family, source.family, `${row.id}: species was retained from an earlier seed`);
          assert.equal(row.view?.assetId, source.assetId, `${row.id}: body differs from the regenerated source`);
          assert.equal(row.meta?.enemyDefId, native.id, `${row.id}: coastal actor uses an encounter alias instead of its native block`);
          assert.equal(row.tier, tier); assert.equal(row.regionId, site.sample.semanticRegion);
          assert.equal(row.combat?.maxHealth, native.maxHealth); assert.equal(row.combat?.level, enemyCombatLevel(native));
          assert(Number.isFinite(row.meta?.spawnX) && Number.isFinite(row.meta?.spawnZ));
          assert(Math.hypot(Number(row.meta?.spawnX) - site.x, Number(row.meta?.spawnZ) - site.z) <= 32.01,
            `${row.id}: spawn no longer belongs to the current generated site`);
          if (fresh) {
            assert.equal(row.state, 'alive'); assert.equal(row.combat?.health, native.maxHealth);
            assert(Math.hypot(row.position[0] - Number(row.meta?.spawnX), row.position[2] - Number(row.meta?.spawnZ)) < .025,
              `${row.id}: reset retained its previous pursuit position`);
            const runtime = snapshot.runtimes[row.id];
            // Reset clears the saved enemy map. The next natural AI scan creates new rows;
            // absence in this same-turn read is valid and must not be mistaken for stale AI.
            if (runtime) {
              assert.equal(runtime.health, native.maxHealth); assert.equal(runtime.state, 'idle');
              assert.equal(runtime.respawnAtMs, null);
              assert(Math.hypot(runtime.spawnPos[0] - row.position[0], runtime.spawnPos[2] - row.position[2]) < .025,
                `${row.id}: runtime retained the previous seed's spawn`);
            }
          }
        }
      }
      const currentIds = new Set(snapshot.rows.map(row => row.id));
      assert(Object.keys(snapshot.runtimes).every(id => currentIds.has(id)), 'Stale coastal runtime IDs survived the rebuild');
      if (fresh) {
        assert.equal(snapshot.player.health, 23); assert.equal(snapshot.player.maxHealth, 23);
        assert.equal(snapshot.player.movement.mode, 'idle'); assert.equal(snapshot.player.movement.path, null);
        assert.equal(snapshot.player.movement.destination, null); assert.equal(snapshot.activity, null);
        assert.equal(snapshot.combat.targetId, null); assert.deepEqual(snapshot.combat.engagedBy, []);
        assert.equal(snapshot.combat.nextAttackAtMs, 0); assert.equal(snapshot.combat.inCombatUntilMs, 0);
        assert.equal(snapshot.combat.activeSpellId, null);
      }
      await record({ coastalSeed: snapshot.seed, fresh, snapshot, generatedSites: samples,
        limit: 'Spawn metadata and same-seed replay check visible regeneration. Private habitat/AI maps, static reservations and the full hidden tree corridor map are not inspected.' });
      return byGroup;
    }
    async function visitCoast(snapshot: CoastalSnapshot, name: string) {
      stage = name;
      const byGroup = new Map<string, SemanticEntity[]>();
      for (const row of snapshot.rows) {
        const id = row.meta!.groupId as string;
        byGroup.set(id, [...(byGroup.get(id) ?? []), row]);
      }
      // Bound candidate search before streaming a view. Prefer a low-tier aggressive source so
      // the first visit can also create real pursuit state for the reset regression.
      const candidates = [...byGroup].filter(([, rows]) => rows[0]!.meta?.behaviour === 'aggressive')
        .sort((a, b) => a[1][0]!.tier - b[1][0]!.tier).slice(0, 32);
      const approach = await page.evaluate(candidates => {
        const d = window.__gameDebug as any;
        const all = d.getEntities().filter((row: any) => row.archetype === 'enemy' || row.archetype === 'boss')
          .map((row: any) => d.getEntity(row.id)) as SemanticEntity[];
        for (const [groupId, initial] of candidates) {
          const rows = initial.map(row => d.getEntity(row.id)) as SemanticEntity[];
          const centre = rows.reduce((sum, row) => [sum[0]! + row.position[0] / rows.length, sum[1]! + row.position[2] / rows.length], [0, 0]);
          const radius = Math.max(...rows.map(row => Math.hypot(row.position[0] - centre[0]!, row.position[2] - centre[1]!)
            + Math.max(row.combat?.aggroRadius ?? 0, row.combat?.bodyRadius ?? 0))) + 3;
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const direction = [Math.sin(angle), Math.cos(angle)];
            const point = { x: centre[0]! + direction[0]! * radius, z: centre[1]! + direction[1]! * radius };
            const end = { x: point.x + direction[0]! * 3, z: point.z + direction[1]! * 3 };
            if ([point, end].some(p => { const s = d.sampleWorld(p.x, p.z); return !s.playable || s.waterBodyId || s.slope === null || s.slope > .6; })) continue;
            if (all.some(row => Math.hypot(row.position[0] - point.x, row.position[2] - point.z)
              < Math.max(row.combat?.aggroRadius ?? 0, row.combat?.bodyRadius ?? 0) + 1.5)) continue;
            const from = { ...point, y: d.groundHeight(point.x, point.z) }, to = { ...end, y: d.groundHeight(end.x, end.z) };
            const path = d.getNavPath([from.x, from.y, from.z], [to.x, to.y, to.z]) as Point[] | null;
            if (!path || path.length < 2 || Math.hypot(path[0]!.x - from.x, path[0]!.z - from.z) > .6
              || Math.hypot(path.at(-1)!.x - to.x, path.at(-1)!.z - to.z) > .6) continue;
            const nearest = [...rows].sort((a, b) => Math.hypot(a.position[0] - point.x, a.position[2] - point.z)
              - Math.hypot(b.position[0] - point.x, b.position[2] - point.z))[0]!;
            return { groupId, ids: rows.map(row => row.id), from, to, path, direction, targetId: nearest.id };
          }
        }
        return null;
      }, candidates);
      assert(approach, 'No bounded coastal approach has a complete dry walking path and safe ordinary follow view');
      completePath(approach.path, approach.from, approach.to, `${name} coastal walk`);
      await frame([approach.from.x, approach.from.z], yawToward(-approach.direction[0]!, -approach.direction[1]!), .34, approach.ids);
      const before = await page.evaluate(ids => ids.map(id => (window.__gameDebug as any).getEntity(id)) as SemanticEntity[], approach.ids);
      assert(before.every(row => row.state === 'alive'), 'Coastal patrol observation began during pursuit');
      const movement = await walk('s', 650, `${name} grounded coast walk`, .8);
      await page.waitForFunction(before => before.some(row => {
        const current = (window.__gameDebug as any).getEntity(row.id);
        return current?.state === 'alive' && Math.hypot(current.position[0] - row.position[0], current.position[2] - row.position[2]) > .18;
      }), before, { timeout: remaining(6500), polling: 120 });
      const after = await page.evaluate(ids => ids.map(id => (window.__gameDebug as any).getEntity(id)) as SemanticEntity[], approach.ids);
      assert(after.every(row => row.state === 'alive'), 'A pursuit was mistaken for coastal patrol movement');
      const save = JSON.parse(await debug<string>('getSaveBlob')) as GameState;
      const runtimes = Object.fromEntries(after.map(row => [row.id, save.world.enemies[row.id]]));
      for (const row of after) {
        const runtime = runtimes[row.id]; assert(runtime, `${row.id}: natural AI scan did not register a current coastal resident`);
        assert.equal(runtime.state, 'idle'); assert.equal(runtime.health, row.combat!.maxHealth);
        assert(Math.hypot(runtime.spawnPos[0] - Number(row.meta?.spawnX), runtime.spawnPos[2] - Number(row.meta?.spawnZ)) < .025,
          `${row.id}: active patrol runtime uses an old spawn`);
      }
      const postScan = await coastalSnapshot();
      assert(postScan.rows.every(row => row.state === 'alive' && row.combat?.health === row.combat?.maxHealth),
        'A coastal health or pursuit artifact appeared after the natural AI scan');
      assert(Object.values(postScan.runtimes).every(runtime => runtime.state === 'idle'),
        'A coastal runtime resumed old pursuit state after reset');
      assert(!postScan.combat.targetId?.startsWith('coastal_') && !postScan.combat.engagedBy.some(id => id.startsWith('coastal_')),
        'The player retained a coastal combat target or pursuer');
      await capture(name, { seed: snapshot.seed, approach, before, after, movement, runtimes,
        proof: 'Actual idle residents changed world position while the player stayed outside aggro range; no animation or time override.' });
      return approach;
    }
    stage = 'initial coast';
    const initial = await coastalSnapshot();
    await validateCoast(initial, false);
    const approach = await visitCoast(initial, 'coast-initial');
    stage = 'coast pre-reset pursuit';
    // Use real W to enter the nearest actor's aggro radius, then a verified canvas attack.
    // The first health change can be a wound or death. Both must disappear on reset.
    const target = await debug<SemanticEntity>('getEntity', [approach.targetId]);
    const direction = approach.direction;
    const gap = Math.max((target.combat?.aggroRadius ?? 0) + .6, (target.combat?.bodyRadius ?? 0) + 2.5);
    const near: XZ = [target.position[0] + direction[0]! * gap, target.position[2] + direction[1]! * gap];
    const towards: XZ = [near[0] - direction[0]! * 2.4, near[1] - direction[1]! * 2.4];
    await navPath(near, towards, 'coast pursuit approach');
    await frame(near, yawToward(-direction[0]!, -direction[1]!), .34, [target.id]);
    const pursuitBefore = await debug<SemanticEntity>('getEntity', [target.id]);
    await walk('w', 500, 'coast enter aggro range', .5);
    await page.waitForFunction(id => (window.__gameDebug as any).getEntity(id)?.state === 'aggro', target.id,
      { timeout: remaining(3500), polling: 80 });
    const pursuit = await debug<SemanticEntity>('getEntity', [target.id]);
    const click = await pointerEntity(target.id);
    await page.waitForFunction(({ id, health }) => (window.__gameDebug as any).getEntity(id)?.combat?.health < health,
      { id: target.id, health: pursuit.combat!.health }, { timeout: remaining(6500), polling: 100 });
    const dirty = await coastalSnapshot();
    assert(dirty.runtimes[target.id]?.state !== 'idle', 'The pre-reset action did not leave a changed enemy runtime');
    await record({ preResetPursuit: { pursuitBefore, pursuit, click, dirty } });
    const firstSeed = (initial.seed + 1) >>> 0, secondSeed = (initial.seed + 2) >>> 0;
    stage = 'first coastal reset';
    const first = await coastalSnapshot(firstSeed); assert.equal(first.seed, firstSeed);
    await validateCoast(first, true);
    assert.notDeepEqual(signature(first), signature(initial), 'Changing the seed reused the old coastal population');
    await visitCoast(first, 'coast-seed-plus-one');
    stage = 'second coastal reset';
    const second = await coastalSnapshot(secondSeed); assert.equal(second.seed, secondSeed);
    await validateCoast(second, true);
    assert.notDeepEqual(signature(second), signature(first), 'A second seed retained the previous coastal population');
    await visitCoast(second, 'coast-seed-plus-two');
    stage = 'coastal deterministic replay';
    const replay = await coastalSnapshot(firstSeed);
    await validateCoast(replay, true);
    assert.deepEqual(signature(replay), signature(first), 'Replaying the same seed changed coastal spawn positions, bodies, native stat IDs or resident counts');
    await record({ coastalReplay: { seed: firstSeed, equalsFirstReset: true, descriptors: signature(replay) } });
  }

  if (band === 'regions') {
    const bosses = Object.entries(REGIONAL_BOSS_LEVELS);
    assert.equal(bosses.length, 7);
    // Ordrun's deferred cave is visited last so the six surface views share one world residency.
    bosses.sort(([a], [b]) => Number(a === 'ordrun') - Number(b === 'ordrun'));
    for (const [id, balance] of bosses) {
      stage = `regional boss ${id}`;
      assert(balance.multiplier >= 3 && balance.multiplier <= 5);
      const rows = groups.get(id) ?? []; assert.equal(rows.length, 1, `${id}: original boss must remain a singleton`);
      const actor = await debug<SemanticEntity>('getEntity', [rows[0]!.id]);
      const species = REGIONAL_BOSS_SPECIES.find(row => row.id === `boss_${id}`)!;
      const body = REGIONAL_BOSS_BODIES[id as keyof typeof REGIONAL_BOSS_BODIES];
      const block = ENEMIES.find(row => row.id === actor.meta?.enemyDefId);
      assert(species && body && block, `${id}: original regional boss definition is absent`);
      assert.equal(actor.regionId, species.regionId); assert.equal(actor.tier, balance.tier);
      assert.equal(actor.combat?.level, balance.tier * balance.multiplier, `${id}: expected ${balance.multiplier}× regional tier`);
      assert.equal(actor.combat?.level, enemyCombatLevel(block)); assert.equal(actor.combat?.maxHealth, block.maxHealth);
      assert.equal(actor.view?.assetId, body.assetId, `${id}: replacement body was not wired into normal world boot`);
      assert(actor.meta?.rank === 'boss' || actor.meta?.rank === 'miniboss', `${id}: boss rank metadata missing`);
      if (actor.regionId !== 'gravelmaw') {
        const offset = (actor.combat?.bodyRadius ?? 2) + 5;
        await frame([actor.position[0], actor.position[2] + offset], 0, .34, [actor.id]);
        await walk('s', 400, `${id} ordinary follow movement`, .5);
      } else {
        // The surface groundHeight/inspectPose pair cannot place a player on the cave floor.
        // Prepare the observed production cave, retain a normal surface-set follow pose, and
        // teleport to the actual cave nav floor. No camera target receives the cave height.
        await page.evaluate(async timeout => {
          const renderer = (window as any).__renderDistanceLab;
          if (typeof renderer?.loadCave !== 'function') throw new Error('Existing production cave loader is unavailable');
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([renderer.loadCave(), new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Production cave preparation exceeded the remaining region-band budget')), timeout);
            })]);
          } finally { if (timer) clearTimeout(timer); }
        }, remaining(20_000));
        const floor = await page.evaluate(({ position, radius }) => {
          const d = window.__gameDebug as any;
          const from = [position[0], position[1], position[2] + radius];
          const to = [position[0], position[1], position[2] + radius + 2];
          const a = d.getNavPoint(from), b = d.getNavPoint(to);
          if (!a || !b || Math.hypot(a.x - from[0]!, a.z - from[2]!) > .5
            || Math.hypot(b.x - to[0]!, b.z - to[2]!) > .5) return null;
          return { from: a as Point, to: b as Point, path: d.getNavPath([a.x, a.y, a.z], [b.x, b.y, b.z]) as Point[] | null };
        }, { position: actor.position, radius: (actor.combat?.bodyRadius ?? 2) + 4 });
        assert(floor, 'Ordrun has no observed floor for the bounded normal-camera approach');
        completePath(floor.path, floor.from, floor.to, 'Ordrun cave floor walk');
        await debug('teleport', [[floor.from.x, floor.from.y, floor.from.z]]);
        await settle([actor.id], false);
        assert.equal((await normalCamera()).actor.regionId, 'gravelmaw', 'Cave setup remained on the surface');
        await walk('s', 400, 'Ordrun actual cave-floor movement', .5);
      }
      const live = await debug<SemanticEntity>('getEntity', [actor.id]);
      const drawn = await debug<Bounds>('getDrawnBounds', [actor.id]);
      assert(drawn?.meshes > 0 && drawn.max.y > drawn.min.y, `${id}: native boss body is not drawn`);
      await capture(`regional-${id}`, { balance, expectedLevel: balance.tier * balance.multiplier,
        canonical: { id: block.id, level: enemyCombatLevel(block), health: block.maxHealth }, before: actor,
        after: live, drawn, motion: await debug('getEntityMotion', [actor.id]) });
    }
  }

  if (band === 'shallow') {
    await actorScene('wilderness_cinderback_scree', 'shallow-ordinary');
    await actorScene('ashseal_warden', 'shallow-keeper');
    await lavaScene(WILDERNESS_LAVA_EXPANSION_CHANNELS.find(row => row.id === 'widows-furnace')!, 'shallow-lava-flow');
  }
  if (band === 'deep') {
    stage = 'continuous purple sky';
    const transect: { z: number; expected: number; amount: number; skyMagic: number; horizon: number }[] = [];
    for (const z of [650, 690, 700, 710, 750, 810]) {
      await frame([45, z], Math.PI, .24);
      const expected = wildernessMagicAt(45, z);
      await page.waitForFunction(() => {
        const d = window.__gameDebug as any, a = d.getBiomeAtmosphere();
        return Math.abs(a.sky.magic - a.wildernessMagic * (a.weights.wilderness ?? 0)) < .04;
      }, undefined, { timeout: remaining(3500) });
      const state = await observe();
      assert(Math.abs(state.atmosphere.wildernessMagic - expected) < .015, `z${z}: live atmosphere misses continuous depth field`);
      transect.push({ z, expected, amount: state.atmosphere.wildernessMagic, skyMagic: state.atmosphere.sky.magic, horizon: state.atmosphere.sky.horizon });
      if ([650, 700, 810].includes(z)) await capture(`sky-z${z}`);
    }
    assert(transect[0]!.skyMagic < .12 && transect.at(-1)!.skyMagic > .75, 'Sky does not reach shallow and deep endpoints');
    assert(transect.filter(row => row.skyMagic > .05 && row.skyMagic < .95).length >= 3, 'Missing intermediate sky states');
    for (let i = 1; i < transect.length; i++) assert(transect[i]!.amount >= transect[i - 1]!.amount, 'Sky depth field reversed along the transect');
    assert(Math.abs(transect[3]!.skyMagic - transect[1]!.skyMagic) < .3, 'Sky jumps at the z700 gameplay tier boundary');
    await record({ transect, depthContract: WILDERNESS_DEPTH });
    await actorScene('wilderness_sanctum_west_colossi', 'deep-ordinary');
    await actorScene('hollow_star', 'deep-keeper');
    await lavaScene(WILDERNESS_LAVA_EXPANSION_CHANNELS.find(row => row.id === 'nightforge-overflow')!, 'deep-lava-pool');
  }

  if (band === 'structures') for (const site of WILDERNESS_EXPANSION_SITES) {
    stage = site.id;
    const definition = DEEP_WILDERNESS_STRUCTURES[site.id];
    const from = rotate(site.position, site.rotationY, definition.clearThrough[0]);
    const to = rotate(site.position, site.rotationY, definition.clearThrough[1]);
    const passage = await navPath(from, to, `${site.id} complete passage`);
    assert(passage.path.every(point => Math.abs(local(site.position, site.rotationY, point)[0]) < definition.clearWidth / 2), 'Navigation detours outside the gate passage');
    const courts = [];
    for (const court of definition.courts) courts.push({ id: court.id,
      navigation: await navPath(from, rotate(site.position, site.rotationY, court.centre), `${site.id}/${court.id}`) });
    const parts = buildDeepWildernessStructure(site.id);
    const ids = parts.map(part => `${site.id}#${part.tag}`);
    const liveParts = await page.evaluate(prefix => (window.__gameDebug as any).getEntities().filter((row: any) => row.id.startsWith(prefix)).map((row: any) => row.id), `${site.id}#`) as string[];
    assert(ids.every(id => liveParts.includes(id)), `${site.id}: production composition parts missing`);
    await frame(rotate(site.position, site.rotationY, definition.inspectionStops[0]!), site.rotationY, .34, ids);
    await capture(`${site.id}-approach`, { passage, courts, parts: liveParts.length });
    // A short real gate crossing complements the full endpoint path and court route checks.
    const gateWalk = await walk('w', 2900, `${site.id} entrance`, 7.5);
    assert(Math.abs(local(site.position, site.rotationY, gateWalk.after.player)[0]) < 1, 'Real gate walk left the open passage');
    await capture(`${site.id}-gate-court`, gateWalk);
    // Derive a mid-wall probe from the production collision recipe, not a guessed world box.
    const wall = buildDeepWildernessStructureCollisionParts(site.id).find(part =>
      (part.tag.startsWith('west_boundary_5_') || part.tag.startsWith('west_curtain_5_') || part.tag.startsWith('ambulatory_-1_5_')));
    assert(wall?.scaleAxes, `${site.id}: no west wall collision part for the bounded probe`);
    const wallX = wall.dx + Math.sin(wall.rotationY ?? 0) * wall.scaleAxes[2] * .7 / 2;
    const wallZ = wall.dz + Math.cos(wall.rotationY ?? 0) * wall.scaleAxes[2] * .7 / 2;
    const wallInside = rotate(site.position, site.rotationY, [wallX + 4, wallZ]);
    await frame(wallInside, site.rotationY + Math.PI / 2, .34);
    const wallBefore = await observe();
    const wallSamples: Point[] = [];
    await page.keyboard.down('w');
    try {
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(remaining(180));
        const p = await debug<Point>('getPlayerPosition'); wallSamples.push(p);
        assert(local(site.position, site.rotationY, p)[0] > wallX, `${site.id}: real W input crossed a solid wall`);
      }
    } finally { await page.keyboard.up('w'); }
    assert(distance(wallBefore.player, wallSamples.at(-1)!) > .5, 'Wall test did not approach the collision');
    assert(local(site.position, site.rotationY, wallSamples.at(-1)!)[0] < wallX + 2.2, 'Wall test stopped before reaching the wall');
    await page.waitForTimeout(remaining(450));
    await capture(`${site.id}-wall-blocked`, { wall, wallX, wallZ, wallBefore, wallSamples });
  }

  if (band === 'resources') {
    stage = 'resource and recipe wiring';
    const resourceRows = await page.evaluate(() => {
      const d = window.__gameDebug as any;
      return d.getEntities().filter((row: any) => row.archetype === 'ore' || row.archetype === 'tree' || row.archetype === 'station')
        .map((row: any) => d.getEntity(row.id)) as SemanticEntity[];
    });
    for (const cluster of WILDERNESS_RESOURCE_CLUSTERS) {
      const rows = resourceRows.filter(row => row.id.startsWith(`${cluster.id}_`));
      assert.equal(rows.length, cluster.count, `${cluster.id}: resource sites were not registered`);
      assert(rows.every(row => row.resource && row.state === 'available' && row.regionId === 'wilderness'));
    }
    const registeredRecipes = new Set(resourceRows.flatMap(row => row.station?.recipeIds ?? []));
    const queries = [...WILDERNESS_LOOT_RECIPES.map(row => ({ query: row.id, id: `recipe-${row.id}` })),
      ...WILDERNESS_LOOT_ITEMS.map(row => ({ query: row.id, id: `item-${row.id}` }))];
    const docs = await page.evaluate(async queries => {
      const d = window.__gameDebug as any, found: { expected: string; ids: string[] }[] = [];
      for (const query of queries) {
        const hits = await d.callTool('corealm_search_docs', { query: query.query, limit: 25 }) as DocHit[];
        if (!Array.isArray(hits)) throw new Error(`Public docs query failed: ${query.query}`);
        found.push({ expected: query.id, ids: hits.map(row => row.docId) });
      }
      return found;
    }, queries);
    for (const row of docs) assert(row.ids.includes(row.expected), `${row.expected}: absent from the running world's public content index`);
    for (const recipe of WILDERNESS_LOOT_RECIPES) assert(registeredRecipes.has(recipe.id), `${recipe.id}: no production station offers this recipe`);
    await record({ resources: resourceRows.filter(row => WILDERNESS_RESOURCE_CLUSTERS.some(cluster => row.id.startsWith(`${cluster.id}_`))), docs });
    await debug('setSkillLevel', ['mining', 99]);
    await debug('clearInventory');
    const tool = await debug('giveItem', ['nightglass_pickaxe', 1, 'inventory']);
    assert(tool.ok, 'The running item registry did not grant the setup pickaxe');
    for (const site of WILDERNESS_RESOURCE_SITES.filter(row => row.kind === 'mine')) {
      stage = `real mining ${site.id}`;
      const id = `${site.id}_resources_4`;
      const entity = await debug<SemanticEntity>('getEntity', [id]); assert(entity?.resource);
      const stance = rotate(site.centre, site.rotationY, [0, 1]);
      await frame(stance, site.rotationY, .48, [id]);
      const before = { entity: await debug<SemanticEntity>('getEntity', [id]), save: JSON.parse(await debug<string>('getSaveBlob')),
        player: await debug<Point>('getPlayerPosition') };
      const cursor = (await debug('getEvents', [0])).nextSeq;
      const click = await pointerEntity(id);
      await page.waitForFunction(({ id, cursor }) => (window.__gameDebug as any).getEvents(cursor).events.some((event: GameEvent) =>
        event.type === 'item.received' && event.entityId === id && event.data.source === 'gather'), { id, cursor }, { timeout: remaining(9000), polling: 100 });
      const after = { entity: await debug<SemanticEntity>('getEntity', [id]), save: JSON.parse(await debug<string>('getSaveBlob')),
        player: await debug<Point>('getPlayerPosition'), events: await debug('getEvents', [cursor]) };
      const count = (save: any) => save.inventory.slots.reduce((sum: number, slot: any) => sum + (slot?.itemId === entity.resource!.itemId ? slot.quantity : 0), 0);
      assert(after.entity.resource!.remaining < before.entity.resource!.remaining, 'Real mining did not consume a node yield');
      assert(count(after.save) > count(before.save), 'Real mining did not add the ore to inventory');
      assert(distance(before.player, after.player) > .3, 'Mining click did not exercise the approach');
      assert(!after.events.dropped && !after.events.events.some((event: GameEvent) => event.type === 'navigation.failed'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(remaining(450));
      await capture(`${site.id}-gathered`, { click, before, after });
    }
    for (const id of ['lastroot_teak', 'starwood_hollow']) {
      const site = WILDERNESS_RESOURCE_SITES.find(row => row.id === id)!;
      stage = id;
      await frame(rotate(site.centre, site.rotationY, [0, 10]), site.rotationY, .34);
      await walk('w', 450, `${id} clear aisle`, .6);
      await capture(`${id}-grove`);
    }
  }
  if (band === 'mobile') {
    const site = WILDERNESS_EXPANSION_SITES[1]!;
    stage = '390px world layout';
    await frame(rotate(site.position, site.rotationY, DEEP_WILDERNESS_STRUCTURES[site.id].inspectionStops[0]!), site.rotationY, .34);
    await walk('w', 650, 'mobile gate approach', 1);
    await capture('mobile-world');
    const bindings = await debug<{ id: string; keys: string[] }[]>('getKeyBindings');
    const inventoryBinding = bindings.find(row => /inventory/.test(row.id));
    assert(inventoryBinding?.keys[0], 'No inventory keybinding exists');
    await page.keyboard.press(inventoryBinding.keys[0]);
    await page.locator('#panel-inventory').waitFor({ state: 'visible', timeout: remaining(3000) });
    const layout = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      panels: [...document.querySelectorAll<HTMLElement>('.panel')].filter(panel => !panel.hidden).map(panel => {
        const rect = panel.getBoundingClientRect(); return { id: panel.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }) }));
    assert.equal(layout.width, 390); assert(layout.documentWidth <= 391, 'Mobile document overflows horizontally');
    for (const panel of layout.panels) assert(panel.x >= -1 && panel.y >= -1 && panel.x + panel.width <= 391
      && panel.y + panel.height <= viewport.height + 1, `${panel.id}: visible mobile panel exceeds the viewport`);
    await capture('mobile-inventory', layout);
  }
  stage = 'final errors';
  const errors = await debug('getErrors');
  await record({ errors, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors, requestErrors: driver.requestErrors });
  assert.deepEqual(errors, []); assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.requestErrors, []);
  remaining(1);
  report.passed = true;
  console.log(`Deep Wilderness ${band} semantic checks passed; inspect ${out} captures before acceptance.`);
} catch (error) {
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  if (driver?.page && !driver.page.isClosed()) {
    await driver.page.screenshot({ path: `${out}/failure.png`, timeout: Math.min(3000, Math.max(1, budgetMs - (Date.now() - started) - 3000)) }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try { await driver?.close(); } finally { await server?.close(); }
  report.elapsedMs = Date.now() - started;
  if (report.elapsedMs >= budgetMs) { report.passed = false; report.failure ??= 'End-to-end deadline exceeded'; process.exitCode = 1; }
  await writeFile(`${out}/report.json`, JSON.stringify({ ...report, stage }, null, 2));
  clearDeadline();
  if (report.failure) console.error(report.failure);
}
