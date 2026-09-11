import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { WILDERNESS_RUIN_SITES, WILDERNESS_ROAD_BRAZIERS } from '../game/src/content/wildernessLandmarks.js';
import { WILDERNESS_RUINS } from '../game/src/render/compositions/wildernessRuins.js';
import { WILDERNESS_LAVA_CHANNELS, lavaSections, sampleLavaChannel } from '../game/src/content/wildernessLava.js';
import type { WildernessEffectsState } from '../game/src/render/wildernessEffects.js';
import { SCATTER_STREAM_TILE_METRES } from '../game/src/world/scatter.js';

// Root runs this after the final navigation bake. The compact labs already own asset, animation
// and material acceptance; this one scene proves their authored terrain and population integration.
const ruinsOnly = process.argv.includes('--ruins-only');
const out = `test-results/wilderness-expansion-world${ruinsOnly ? '-ruins' : ''}`;
const budgetMs = 120_000;
await mkdir(out, { recursive: true });
const server = await startGameServer();
const driver = new GameDriver(server, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const started = Date.now();
const evidence: unknown[] = [];
let passed = false, failure: string | undefined, expired = false;
const watchdog = setTimeout(() => {
  expired = true;
  void driver.close().catch(() => {});
}, budgetMs);
watchdog.unref();

type Point = { x: number; y: number; z: number };
type XZ = readonly [number, number];
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z);
const rotate = (centre: XZ, yaw: number, local: XZ): XZ => [
  centre[0] + local[0] * Math.cos(yaw) + local[1] * Math.sin(yaw),
  centre[1] - local[0] * Math.sin(yaw) + local[1] * Math.cos(yaw),
];
const pathLength = (path: readonly Point[]) => path.slice(1)
  .reduce((sum, point, i) => sum + distance(path[i]!, point), 0);
const yawToward = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function completePath(path: Point[] | null, from: Point, to: Point, label: string): asserts path is Point[] {
  assert(path && path.length >= 2, `${label}: navigation returned no path`);
  assert(distance(path[0]!, from) <= .8, `${label}: path starts away from the requested ground point`);
  assert(distance(path.at(-1)!, to) <= .8, `${label}: path ends before its destination`);
}

try {
  await driver.launch();
  await driver.open(60_000);
  const page = driver.page!;
  page.setDefaultTimeout(8000);
  const settle = async (scenery = false, partIds: string[] = []) => {
    // Teleports can outrun normal travel prefetch. Wait for actual entity records and every
    // scatter tile in the photographed neighbourhood, not an arbitrary screenshot delay.
    await page.waitForTimeout(150);
    await page.waitForFunction(({ scenery, tileSize, partIds }) => {
      const debug = window.__gameDebug as any;
      const entities = debug.getEntityViewStats().residency;
      if (entities.pending || entities.failed || entities.missing) return false;
      const residentIds = new Set(entities.residentIds);
      if (partIds.some(id => !residentIds.has(id) || !debug.getDrawnBounds(id))) return false;
      const shaders = (window as any).__renderDistanceLab.shaders();
      if (shaders && (shaders.waiting || shaders.queued || shaders.compiling)) return false;
      if (!scenery) return true;
      const p = debug.getPlayerPosition();
      return debug.getScatterResidency().pending.every((id: string) => {
        const [col, row] = id.split(':').map(Number);
        const dx = Math.max(col! * tileSize - p.x, 0, p.x - (col! + 1) * tileSize);
        const dz = Math.max(row! * tileSize - p.z, 0, p.z - (row! + 1) * tileSize);
        return dx * dx + dz * dz > 120 * 120;
      });
    }, { scenery, tileSize: SCATTER_STREAM_TILE_METRES, partIds }, { timeout: 35_000, polling: 250 }).catch(async error => {
      const state = await page.evaluate(() => {
        const debug = window.__gameDebug as any;
        return { player: debug.getPlayerPosition(), entities: debug.getEntityViewStats().residency,
          scatter: debug.getScatterResidency(), errors: debug.getErrors() };
      });
      await writeFile(`${out}/residency-failure.json`, JSON.stringify(state, null, 2));
      throw error;
    });
    await page.waitForTimeout(300);
  };
  await page.waitForFunction(() => (window as any).__wildernessEffects?.getState().ready, null, { timeout: 8000 });
  const initialEffects: WildernessEffectsState = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  const expectedTorches = WILDERNESS_ROAD_BRAZIERS.length + WILDERNESS_RUIN_SITES.reduce((sum, site) =>
    sum + WILDERNESS_RUINS[site.composition].torches.length, 0);
  assert(initialEffects.enabled && initialEffects.lightingEnabled, 'Normal world boot must enable Wilderness effects');
  assert(initialEffects.torches >= expectedTorches, 'Normal boot omitted authored ruin or road torches');
  assert.equal(initialEffects.channels, WILDERNESS_LAVA_CHANNELS.length);
  assert(initialEffects.moltenTriangles > 0 && initialEffects.bankRocks > 0);
  evidence.push({ initialEffects, expectedTorches });

  // Capture population before visiting a haunt can wake its patrol or provoke combat.
  const hauntIds = WILDERNESS_RUIN_SITES.map(site => `${site.id}_haunt`);
  const haunts = await page.evaluate(ids => {
    const debug = window.__gameDebug as any;
    return ids.map(groupId => ({
      groupId,
      residents: debug.getEntities().filter((entity: any) =>
        entity.id === groupId || entity.id.startsWith(`${groupId}_`)).map((entity: any) => {
        const actor = debug.getEntity(entity.id);
        return { actor, ground: debug.sampleWorld(actor.position[0], actor.position[2]) };
      }),
    }));
  }, hauntIds);
  for (const haunt of haunts) {
    assert.equal(haunt.residents.length, 2, `${haunt.groupId}: expected two residents`);
    for (const { actor, ground } of haunt.residents) {
      assert.equal(actor.regionId, 'wilderness', `${actor.id}: wrong region`);
      assert(ground.playable && !ground.waterBodyId, `${actor.id}: resident is not on dry playable ground`);
      for (const channel of WILDERNESS_LAVA_CHANNELS) {
        const sample = sampleLavaChannel(channel, actor.position[0], actor.position[2]);
        assert(sample.halfWidth < .05 || sample.signedDistance > .35, `${actor.id}: resident overlaps molten ground`);
      }
    }
  }
  assert.equal(haunts.reduce((sum, haunt) => sum + haunt.residents.length, 0), 16);
  evidence.push({ haunts });

  const photographed = new Set<string>();
  for (const site of WILDERNESS_RUIN_SITES) {
    const ruin = WILDERNESS_RUINS[site.composition];
    const from = rotate(site.position, site.rotationY, ruin.clearThrough[0]);
    const to = rotate(site.position, site.rotationY, ruin.clearThrough[1]);
    const foundation = [-1, 0, 1].flatMap(x => [-1, 0, 1].map(z =>
      rotate(site.position, site.rotationY, [x * (ruin.footprint[0] / 2 - .6), z * (ruin.footprint[1] / 2 - .6)])));
    const standing = rotate(site.position, site.rotationY, [0, ruin.footprint[1] / 2 + 9]);
    const result = await page.evaluate(({ site, from, to, foundation, standing }) => {
      const debug = window.__gameDebug as any;
      const a = { x: from[0], y: debug.groundHeight(...from), z: from[1] };
      const b = { x: to[0], y: debug.groundHeight(...to), z: to[1] };
      const foundationHeights = foundation.map(point => ({ point, height: debug.groundHeight(...point) }));
      debug.teleport([standing[0], debug.groundHeight(...standing), standing[1]]);
      debug.inspectPose({ x: site.position[0], y: debug.groundHeight(...site.position) + 2.8,
        z: site.position[1], yaw: site.rotationY + .55, pitch: .22, distance: 34, detached: true });
      return { from: a, to: b, path: debug.getNavPath([a.x, a.y, a.z], [b.x, b.y, b.z]),
        partIds: debug.getEntities().filter((entity: any) => entity.id.startsWith(`${site.id}#`)).map((entity: any) => entity.id),
        centreHeight: debug.groundHeight(...site.position), foundationHeights,
        endpoints: [debug.sampleWorld(...from), debug.sampleWorld(...to)] };
    }, { site, from, to, foundation, standing });
    completePath(result.path, result.from, result.to, site.id);
    assert(result.endpoints.every((sample: any) => sample.playable && !sample.waterBodyId), `${site.id}: wet ruin entrance`);
    for (const point of result.path as Point[]) {
      const localX = (point.x - site.position[0]) * Math.cos(site.rotationY)
        - (point.z - site.position[1]) * Math.sin(site.rotationY);
      assert(Math.abs(localX) < 1.6, `${site.id}: navigation detours outside the authored open passage`);
    }
    // A failure here usually means a location pad or road stamp is regrading the ruin foundation.
    // Fix that world overlap; do not hide visibly unsupported masonry by widening this tolerance.
    for (const sample of result.foundationHeights) {
      assert(Math.abs(sample.height - result.centreHeight) <= .18, `${site.id}: foundation is not level at ${sample.point}`);
    }
    assert(result.partIds.length > 20, `${site.id}: the composition did not emit its structure parts`);
    await settle(false, result.partIds);
    const state = await page.evaluate(partIds => {
      const debug = window.__gameDebug as any;
      return { state: debug.getState(), player: debug.getPlayerPosition(), atmosphere: debug.getBiomeAtmosphere(),
        effects: (window as any).__wildernessEffects.getState(), residency: debug.getEntityViewStats().residency,
        shaders: (window as any).__renderDistanceLab.shaders(),
        drawnParts: partIds.map((id: string) => ({ id, bounds: debug.getDrawnBounds(id) })) };
    }, result.partIds);
    assert(state.state.ready && Math.hypot(state.player.x - standing[0], state.player.z - standing[1]) < 2,
      `${site.id}: player left the inspection approach before residency settled`);
    evidence.push({ site, ...result, ...state });
    if (!photographed.has(site.composition)) {
      photographed.add(site.composition);
      await page.screenshot({ path: `${out}/${site.composition}-world.png`, timeout: 5000 });
    }
    console.log(`${site.id}: level foundation, complete passage, two dry residents`);
  }
  assert.equal(photographed.size, 4);

  if (!ruinsOnly) {
  const ecotone: { z: number; night: number; state: unknown }[] = [];
  for (const z of [430, 460, 490, 520, 550]) {
    await page.evaluate(z => {
      const debug = window.__gameDebug as any;
      debug.inspectPose({ x: 0, y: debug.groundHeight(0, z), z, yaw: Math.PI + (z === 550 ? .55 : 0), pitch: .22, distance: 26 });
    }, z);
    await settle(true);
    const state = await page.evaluate(() => {
      const debug = window.__gameDebug as any;
      return { world: debug.sampleWorld(0, debug.getPlayerPosition().z), atmosphere: debug.getBiomeAtmosphere(),
        player: debug.getPlayerPosition(), state: debug.getState(), scatter: debug.getScatterStats(),
        residency: debug.getScatterResidency() };
    });
    assert(Math.hypot(state.player.x, state.player.z - z) < 1, `Ecotone ${z}: player left the sampled latitude`);
    ecotone.push({ z, night: state.atmosphere.sky.night, state });
    await page.screenshot({ path: `${out}/ecotone-${z}.png`, timeout: 5000 });
  }
  evidence.push({ ecotone });
  // These are broad transition requirements, not exact climate weights. If the authored transect
  // changes, inspect the captures before changing sample coordinates or expectations.
  assert(ecotone.filter(row => row.night > .05 && row.night < .95).length >= 2, 'The north transition lacks intermediate sky states');
  assert(ecotone.at(-1)!.night > ecotone[0]!.night + .4, 'The transect does not progress toward night');
  for (let i = 1; i < ecotone.length; i++) {
    assert(Math.abs(ecotone[i]!.night - ecotone[i - 1]!.night) < .75, 'The sky changes abruptly between neighbouring views');
  }

  const worldShots: { name: string; x: number; z: number; yaw: number; pitch: number; distance: number; focus?: XZ }[] = [
    { name: 'northern-grove', x: 255, z: 633, yaw: Math.PI, pitch: .18, distance: 34 },
    { name: 'torch-trail', x: 18, z: 507, yaw: Math.PI, pitch: .13, distance: 27 },
    { name: 'widows-furnace', x: 178, z: 638, yaw: Math.PI, pitch: .35, distance: 34, focus: [188, 665] },
  ];
  for (const shot of worldShots) {
    await page.evaluate(shot => {
      const debug = window.__gameDebug as any;
      if (shot.focus) {
        debug.teleport([shot.x, debug.groundHeight(shot.x, shot.z), shot.z]);
        debug.inspectPose({ x: shot.focus[0], y: debug.groundHeight(...shot.focus) + .6, z: shot.focus[1],
          yaw: shot.yaw, pitch: shot.pitch, distance: shot.distance, detached: true });
      } else debug.inspectPose({ ...shot, y: debug.groundHeight(shot.x, shot.z) });
    }, shot);
    await settle(true);
    const state = await page.evaluate(() => {
      const debug = window.__gameDebug as any;
      return { state: debug.getState(), atmosphere: debug.getBiomeAtmosphere(), scatter: debug.getScatterStats(),
        effects: (window as any).__wildernessEffects.getState(), residency: debug.getScatterResidency() };
    });
    evidence.push({ shot, ...state });
    await page.screenshot({ path: `${out}/${shot.name}.png`, timeout: 5000 });
  }
  const fireBefore: WildernessEffectsState = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  await page.waitForTimeout(450);
  const fireAfter: WildernessEffectsState = await page.evaluate(() => (window as any).__wildernessEffects.getState());
  assert(fireAfter.seconds > fireBefore.seconds + .2, 'The live lava/fire clock stopped');
  assert(fireAfter.liveParticles > 0 && fireAfter.texturedStoneMeshes > 0);
  assert(fireAfter.lights.some(light => light.kind === 'lava' && light.intensity > 0), 'Lava bank lighting is inactive');
  assert(fireAfter.lights.some(light => light.kind === 'torch' && light.intensity > 0), 'Nearby road torch lighting is inactive');
  assert(fireAfter.lights.some((light, i) => light.intensity !== fireBefore.lights[i]?.intensity), 'Fire lighting does not animate');
  evidence.push({ fireBefore, fireAfter });

  // Pick the middle of the long, gently bending 177,667 -> 200,665 segment. Both banks are
  // comfortably inside the authored northern ground, away from ruins, haunts and channel caps.
  // Root may move this measured progress if the final channel is reauthored; use lavaSections()
  // and sampleLavaChannel(), never a hand-drawn exclusion rectangle or visual-only river guess.
  const channel = WILDERNESS_LAVA_CHANNELS[0]!;
  const section = lavaSections(channel).reduce((best, row) =>
    Math.abs(row.progress - .59) < Math.abs(best.progress - .59) ? row : best);
  const normal: XZ = [-section.tz, section.tx];
  const bankOffset = section.halfWidth + channel.bankWidth + 3.5;
  const southBank: XZ = [section.x - normal[0] * bankOffset, section.z - normal[1] * bankOffset];
  const northBank: XZ = [section.x + normal[0] * bankOffset, section.z + normal[1] * bankOffset];
  const navigation = await page.evaluate(({ from, to }) => {
    const debug = window.__gameDebug as any;
    const a = { x: from[0], y: debug.groundHeight(...from), z: from[1] };
    const b = { x: to[0], y: debug.groundHeight(...to), z: to[1] };
    return { from: a, to: b, path: debug.getNavPath([a.x, a.y, a.z], [b.x, b.y, b.z]),
      samples: [debug.sampleWorld(...from), debug.sampleWorld(...to)] };
  }, { from: southBank, to: northBank });
  completePath(navigation.path, navigation.from, navigation.to, 'Lava bank detour');
  assert(navigation.samples.every((sample: any) => sample.playable && !sample.waterBodyId), 'Lava test bank is not dry and playable');
  const detourLength = pathLength(navigation.path);
  assert(detourLength > distance(navigation.from, navigation.to) * 1.8, 'Navigation crosses the lava instead of detouring');
  let minimumPathClearance = Infinity;
  for (let i = 1; i < navigation.path.length; i++) {
    const a = navigation.path[i - 1]!, b = navigation.path[i]!;
    const steps = Math.max(1, Math.ceil(distance(a, b) / .6));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const sample = sampleLavaChannel(channel, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (sample.halfWidth < .05) continue;
      minimumPathClearance = Math.min(minimumPathClearance, sample.signedDistance);
      assert(sample.signedDistance > .1, 'A navigation segment enters the molten footprint');
    }
  }
  evidence.push({ lavaSection: section, normal, navigation, detourLength, minimumPathClearance });

  const setWalkPose = async (point: XZ, yaw: number) => page.evaluate(({ point, yaw }) => {
    const debug = window.__gameDebug as any;
    const y = debug.groundHeight(...point);
    debug.teleport([point[0], y, point[1]]);
    debug.inspectPose({ x: point[0], y, z: point[1], yaw, pitch: .24, distance: 13, detached: true });
    return debug.getPlayerPosition() as Point;
  }, { point, yaw });
  const walkBefore = await setWalkPose(southBank, yawToward(-normal[0], -normal[1]));
  await page.keyboard.down('w');
  try { await page.waitForTimeout(1600); } finally { await page.keyboard.up('w'); }
  const walkAfter: Point = await page.evaluate(() => (window.__gameDebug as any).getPlayerPosition());
  const walkClearanceBefore = sampleLavaChannel(channel, walkBefore.x, walkBefore.z);
  const walkClearanceAfter = sampleLavaChannel(channel, walkAfter.x, walkAfter.z);
  assert(distance(walkBefore, walkAfter) > 4, 'Real W input did not move the player along the dry bank');
  assert(walkClearanceAfter.signedDistance > walkClearanceBefore.signedDistance + 3, 'The dry-bank walk did not move away from lava');
  evidence.push({ dryBankWalk: { before: walkBefore, after: walkAfter, walkClearanceBefore, walkClearanceAfter } });
  await page.screenshot({ path: `${out}/lava-dry-bank-walk.png`, timeout: 5000 });

  const crossingOffset = section.halfWidth + 1.4;
  const crossingStart: XZ = [section.x - normal[0] * crossingOffset, section.z - normal[1] * crossingOffset];
  const crossingBefore = await setWalkPose(crossingStart, yawToward(normal[0], normal[1]));
  const crossingSamples: { position: Point; clearance: number }[] = [];
  const initialClearance = sampleLavaChannel(channel, crossingBefore.x, crossingBefore.z).signedDistance;
  assert(initialClearance > .8, 'Attempted crossing starts inside the lava barrier');
  await page.keyboard.down('w');
  try {
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(150);
      const position: Point = await page.evaluate(() => (window.__gameDebug as any).getPlayerPosition());
      const sample = sampleLavaChannel(channel, position.x, position.z);
      crossingSamples.push({ position, clearance: sample.signedDistance });
      assert(sample.signedDistance > .05, 'Keyboard movement entered the molten channel');
    }
  } finally { await page.keyboard.up('w'); }
  assert(Math.min(...crossingSamples.map(sample => sample.clearance)) < initialClearance - .15,
    'Crossing input never approached the barrier, so it did not exercise collision');
  const crossingAfter = crossingSamples.at(-1)!.position;
  const advance = (crossingAfter.x - crossingBefore.x) * normal[0] + (crossingAfter.z - crossingBefore.z) * normal[1];
  assert(advance < crossingOffset - .1, 'The player crossed the channel centreline');
  evidence.push({ blockedCrossing: { before: crossingBefore, initialClearance, samples: crossingSamples, advance } });
  await page.screenshot({ path: `${out}/lava-crossing-blocked.png`, timeout: 5000 });
  }

  const errors = await page.evaluate(() => (window.__gameDebug as any).getErrors());
  evidence.push({ errors, consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors, requestErrors: driver.requestErrors });
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  assert(!expired && Date.now() - started < budgetMs, 'Wilderness expansion exceeded its 120-second world budget');
  passed = true;
  console.log(`Wilderness expansion world proof passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  clearTimeout(watchdog);
  await writeFile(`${out}/report.json`, JSON.stringify({ passed, expired, failure,
    elapsedMs: Date.now() - started, budgetMs, evidence }, null, 2));
  await driver.close();
  await server.close();
}
