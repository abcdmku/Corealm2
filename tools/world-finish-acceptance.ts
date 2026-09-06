/** Root-scheduled authored-world views and dry fishery approaches. One region per 115s batch.
 * npx tsx tools/world-finish-acceptance.ts --region fallowmarch --url http://127.0.0.1:4175
 * No art acceptance is automated. Reuse settlement-walk-browser.ts for town service routes,
 * --fish-id redsill_spots_1 selects a separate 60s real-receipt subcase for that lake.
 * world-resource-check.ts covers Cairn only; it is not evidence for the other four lakes.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { REGIONS } from '../game/src/content/regions.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { CAMERA, PLAYER_RADIUS } from '../game/src/app/config.js';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';

const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback;
const fishId = arg('--fish-id', '');
const coastOnly = process.argv.includes('--coast-only');
assert(!coastOnly || !fishId, 'Coast and fishing receipt batches are separate');
const fishSite = fishId ? WORLD_SITES.find(s => s.kind === 'fishery' && s.resourceSlots.some(slot => `${slot.clusterId}_${slot.index}` === fishId)) : null;
assert(!fishId || fishSite, 'Unknown authored --fish-id');
const region = REGIONS.find(r => r.id === (fishSite?.regionId ?? arg('--region', 'fallowmarch')));
assert(region?.settlement, 'Select one of the four surface regions');
const sites = coastOnly ? [] : fishSite ? [fishSite] : WORLD_SITES.filter(s => s.regionId === region.id && ['grove', 'fishery'].includes(s.kind));
const out = path.resolve('test-results/world-finish-acceptance', fishId || `${region.id}${coastOnly ? '-coast' : ''}`);
await mkdir(out, { recursive: true });
const budgetMs = fishId || coastOnly ? 60_000 : 115_000;
const started = Date.now(), clearDeadline = installTestDeadline(`World views ${fishId || region.id}`, budgetMs);
const driver = new GameDriver({ url: arg('--url', 'http://127.0.0.1:4175'), close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const report: any = { passed: false, status: 'failed', region: region.id, fishId: fishId || null, budgetMs,
  exception: 'Authored full-world coast, lake banks, grove placement and settlement composition. Production reusable assets require their independent lab acceptance.',
  scope: 'One grove, every fishery in this region, town panorama and coast view. Fishery approaches use production corealm_move_to at timeScale 1; no gathering receipt is claimed.',
  setup: 'Debug relocation to a locally validated dry nav point before each approach. Detached overview cameras are presentation setup, not normal camera proof.',
  visualAcceptance: 'Pending human screenshot inspection. Camera distance and residency do not grade visual quality.',
  captures: [], approaches: [] };
const sourceFiles = ['app/boot.ts', 'app/worldSpec.ts', 'app/worldSurface.ts', 'render/scene.ts', 'render/camera.ts',
  'content/regions.ts', 'content/worldSites.ts', `content/settlements/${region.settlement.id}.ts`,
  'world/organicFields.ts', 'world/waterBodies.ts', 'world/siteTerrain.ts', 'world/scatter.ts'];
async function sourceStamp() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file,
    createHash('sha256').update(await readFile(path.resolve('game/src', file))).digest('hex')])));
}
try {
  report.sourceBefore = await sourceStamp();
  await driver.launch();
  await driver.page!.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  await driver.open(fishId ? 30_000 : 50_000, '/index.html');
  const page = driver.page!;
  const documentOrigin = await page.evaluate(() => performance.timeOrigin);
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  assert(!/swiftshader|llvmpipe|software/i.test(report.renderer), 'Software renderer cannot provide hardware visual evidence');
  assert(/NVIDIA.*RTX/i.test(report.renderer), `Expected the scheduled NVIDIA RTX hardware renderer, got ${report.renderer}`);
  if (fishId) {
    report.scope = 'One named lake: normal production approach, then a verified canvas click and natural fishing receipt. Five distinct invocations are required for all five lakes.';
    report.setup += ' Fishing level 99 and one real rod granted to fresh inventory are test setup.';
    await driver.callDebug('setSkillLevel', ['fishing', 99]);
    const grant: any = await driver.callDebug('giveItem', ['palewood_rod', 1, 'inventory']);
    assert(grant.ok && grant.value === 1, 'Fishing rod grant failed');
  }
  if (coastOnly) report.scope = 'One shoreline view selected from the production coast boundary. Physical player remains on dry playable navigation; visual sea probes must project inside the normal 34m camera view.';
  async function capture(label: string) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state: any = await driver.callDebug('getState');
    assert.equal(state.clock.timeScale, 1);
    report.captures.push({ label, file: await driver.screenshot(out, label), camera: await driver.callDebug('getCamera'), player: await driver.callDebug('getPlayer'), state });
  }
  async function overview(label: string, centre: readonly number[], yaw: number, distance: number, residentId?: string, relocate = true) {
    const y: any = await driver.callDebug('groundHeight', [centre[0], centre[1]]);
    if (relocate) await driver.callDebug('teleport', [[centre[0], y, centre[1]]]);
    await driver.callDebug('inspectPose', [{ x: centre[0], y: y + 2, z: centre[1], yaw, pitch: .68, distance, detached: true }]);
    // Local residency must settle after relocation, without forcing the entire island resident.
    await driver.wait(750);
    if (residentId) await page.waitForFunction(id => (window.__gameDebug as any).getDrawnBounds(id)?.meshes > 0,
      residentId, { timeout: 8000 });
    await capture(label);
  }
  for (const site of sites) {
    if (site.kind === 'grove') {
      const slot = site.resourceSlots[0]!;
      await overview(site.id, site.centre, site.rotationY, 34, `${slot.clusterId}_${slot.index}`); continue;
    }
    const slot = site.resourceSlots[0]!;
    const id = fishId || `${slot.clusterId}_${slot.index}`;
    const selected = await page.evaluate(({ id, radius }) => {
      const d: any = window.__gameDebug, entity = d.getEntity(id);
      if (!entity?.interactionPosition) throw new Error(`Missing dry stance ${id}`);
      const a = entity.interactionPosition;
      const water = d.getWaterBodies().find((b: any) => b.id === entity.meta.clusterId);
      if (!water?.closed) throw new Error(`Missing closed production basin ${id}`);
      const base = Math.atan2(a[0] - water.centre[0], a[2] - water.centre[1]);
      const rejected: any[] = [];
      for (const distance of [6, 8, 10]) for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * .75, -Math.PI * .75, Math.PI]) {
        const x = a[0] + Math.sin(base + turn) * distance, z = a[2] + Math.cos(base + turn) * distance;
        const s = d.sampleWorld(x, z), p = d.getNavPoint([x, s.height, z]);
        if (!s.playable || s.waterBodyId || !p || Math.hypot(p.x - x, p.z - z) > .2) { rejected.push({ x, z, reason: 'dry nav setup', surface: s, nav: p }); continue; }
        const route = d.getNavPath([p.x, p.y, p.z], a);
        if (!route?.length || Math.hypot(route.at(-1).x - a[0], route.at(-1).z - a[2]) > .4) { rejected.push({ x, z, reason: 'nav route endpoint', endpoint: route?.at(-1) }); continue; }
        if (d.probeWorldClearance({ ...p, radius }).staticShift > .05) { rejected.push({ x, z, reason: 'static overlap' }); continue; }
        return { entity, water, start: p, route, yaw: base + turn };
      }
      throw new Error(`No dry approach setup for ${id}: ${JSON.stringify(rejected)}`);
    }, { id, radius: PLAYER_RADIUS });
    const row: any = { id, setup: selected }; report.approaches.push(row);
    const p = selected.start;
    await driver.callDebug('inspectPose', [{ ...p, yaw: selected.yaw, pitch: .72, distance: 30 }]);
    await driver.callDebug('teleport', [[p.x, p.y, p.z]]);
    await driver.wait(400);
    await page.waitForFunction(id => (window.__gameDebug as any).getDrawnBounds(id)?.meshes > 0, id, { timeout: 8000 });
    row.before = await driver.callDebug('getPlayer');
    await capture(`${site.id}-approach`);
    const events: any = await driver.callDebug('getEvents');
    row.move = await driver.callDebug('callTool', ['corealm_move_to', { entityId: id }]);
    assert(!row.move.error, `Navigation rejected ${id}`);
    row.samples = [];
    const end = Date.now() + 12_000;
    while (Date.now() < end) {
      const sample: any = await page.evaluate(({ since, radius }) => {
        const d: any = window.__gameDebug, player = d.getPlayer(), p = player.position;
        const wet = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([x, z]) => {
          const s = d.sampleWorld(p.x + x!, p.z + z!); return !s.playable || s.waterBodyId !== null;
        });
        return { player, wet, events: d.getEvents(since) };
      }, { since: events.nextSeq, radius: PLAYER_RADIUS });
      row.samples.push(sample);
      assert(!sample.wet, `Observed player footprint entered water at ${id}`);
      assert(!sample.events.dropped, 'Movement event evidence dropped');
      assert(!sample.events.events.some((e: any) => e.type === 'navigation.failed'), `Route failed at ${id}`);
      if (!sample.player.moving && sample.events.events.some((e: any) => e.type === 'navigation.completed' && e.entityId === id)) { row.after = sample.player; break; }
      await driver.wait(100);
    }
    assert(row.after, `No completed fishery approach at ${id}`);
    assert(Math.hypot(row.after.position.x - row.before.position.x, row.after.position.z - row.before.position.z) > 4, 'Approach did not move at least four metres');
    row.sampleCoverage = 'Player footprint sampled approximately every 100ms; this does not certify unsampled frames';
    await capture(`${site.id}-arrival`);
    if (fishId) {
      const before: any = await driver.callDebug('getEntity', [id]);
      const saveBefore = JSON.parse(await driver.callDebug('getSaveBlob') as string);
      const cursor: any = await driver.callDebug('getEvents');
      const b: any = await driver.callDebug('getDrawnBounds', [id]);
      const c: any = await driver.callDebug('getCamera');
      assert(b?.meshes, 'Fish school must be drawn before click');
      const camera = new PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
      camera.position.set(c.position.x, c.position.y, c.position.z);
      camera.lookAt(c.target.x, c.target.y, c.target.z); camera.updateMatrixWorld();
      let clicked = false;
      for (const fx of [.5, .25, .75]) {
        for (const fz of [.5, .25, .75]) {
          const p = new Vector3(b.min.x + (b.max.x - b.min.x) * fx, (b.min.y + b.max.y) / 2,
            b.min.z + (b.max.z - b.min.z) * fz).project(camera);
          const x = (p.x + 1) * 720, y = (1 - p.y) * 450;
          if (p.z < -1 || p.z > 1 || x < 0 || x > 1440 || y < 0 || y > 900) continue;
          await page.mouse.move(x, y); await driver.wait(100);
          const hit = await page.evaluate(({ id, x, y }) => (window.__gameDebug as any).getState().hoveredEntityId === id && document.elementFromPoint(x, y)?.tagName === 'CANVAS', { id, x, y });
          if (hit) { await page.mouse.click(x, y); row.click = { x, y, id }; clicked = true; break; }
        }
        if (clicked) break;
      }
      assert(clicked, `No verified canvas target on ${id}`);
      await page.waitForFunction(({ id, since }) => (window.__gameDebug as any).getEvents(since).events.some((e: any) => e.type === 'item.received' && e.entityId === id && e.data.source === 'gather'),
        { id, since: cursor.nextSeq }, { timeout: 12000 });
      await driver.callDebug('callTool', ['corealm_stop', {}]);
      const after: any = await driver.callDebug('getEntity', [id]);
      const saveAfter = JSON.parse(await driver.callDebug('getSaveBlob') as string);
      const receiptEvents: any = await driver.callDebug('getEvents', [cursor.nextSeq]);
      assert(!receiptEvents.dropped, 'Receipt evidence dropped');
      const receipts = receiptEvents.events.filter((e: any) => e.type === 'item.received' && e.entityId === id && e.data.source === 'gather' && e.data.itemId === before.resource.itemId);
      const received = receipts.reduce((sum: number, e: any) => sum + Number(e.data.quantity), 0);
      const quantity = (save: any) => save.inventory.slots.reduce((sum: number, s: any) => sum + (s?.itemId === before.resource.itemId ? s.quantity : 0), 0);
      assert(received > 0, 'No actual fish receipt');
      assert.equal(quantity(saveAfter) - quantity(saveBefore), received, 'Fish receipts disagree with inventory');
      assert.equal(before.resource.remaining - after.resource.remaining, received, 'Fish receipts disagree with resource depletion');
      row.receipt = { before, after, received, events: receiptEvents, inventoryBefore: quantity(saveBefore), inventoryAfter: quantity(saveAfter) };
      await capture(`${site.id}-receipt`);
    } else await overview(`${site.id}-basin`, site.centre, site.rotationY + Math.PI, 34, id, false);
  }
  if (!fishId) {
  if (!coastOnly) await overview(`${region.settlement.id}-town`, region.settlement.centre, .5, 34, region.settlement.bank.id);
  const coastal = await page.evaluate(({ regionId, radius }) => {
    const d: any = window.__gameDebug;
    // Each scan stays on an edge actually owned by this semantic region. Earlier Vellenwood
    // coordinates at z455 were in Kilnhalt and are intentionally not reused.
    const edge: Record<string, { base: number[]; outward: number[]; min: number; max: number }> = {
      fallowmarch: { base: [-350, 0], outward: [-1, 0], min: -190, max: 190 },
      vellenwood: { base: [350, 0], outward: [1, 0], min: 20, max: 190 },
      karrowmoor: { base: [0, -200], outward: [0, -1], min: -10, max: 340 },
      kilnhalt: { base: [0, 460], outward: [0, 1], min: -340, max: 340 },
    };
    const e = edge[regionId]!, candidates: any[] = [];
    for (let along = e.min; along <= e.max; along += 4) {
      const bx = e.base[0]! + (e.outward[0] === 0 ? along : 0), bz = e.base[1]! + (e.outward[1] === 0 ? along : 0);
      const x = bx - e.outward[0]! * 2, z = bz - e.outward[1]! * 2;
      const s = d.sampleWorld(x, z), boundary = d.sampleWorld(bx + e.outward[0]! * .1, bz + e.outward[1]! * .1);
      if (!s.playable || s.waterBodyId || s.semanticRegion !== regionId || !boundary.coast) continue;
      const p = d.getNavPoint([x, s.height, z]);
      if (!p || Math.hypot(p.x - x, p.z - z) > .2 || d.probeWorldClearance({ ...p, radius }).staticShift > .05) continue;
      const width = boundary.coast.shorelineWidth;
      const sea = { x: bx + e.outward[0]! * (width + 4), y: boundary.coast.seaLevel, z: bz + e.outward[1]! * (width + 4) };
      const seaSample = d.sampleWorld(sea.x, sea.z);
      if (!seaSample.coast || seaSample.coast.outsideDistance <= seaSample.coast.shorelineWidth) continue;
      candidates.push({ player: p, sea, seaSample, shorelineWidth: width, yaw: Math.atan2(-e.outward[0]!, -e.outward[1]!), ground: s });
    }
    candidates.sort((a, b) => a.shorelineWidth - b.shorelineWidth);
    if (!candidates.length) throw new Error(`No dry playable coastal setup in ${regionId}`);
    return candidates[0];
  }, { regionId: region.id, radius: PLAYER_RADIUS });
  report.coastSetup = coastal;
  await driver.callDebug('teleport', [[coastal.player.x, coastal.player.y, coastal.player.z]]);
  await driver.callDebug('inspectPose', [{ ...coastal.player, yaw: coastal.yaw, pitch: .38, distance: 34 }]);
  await driver.callDebug('teleport', [[coastal.player.x, coastal.player.y, coastal.player.z]]);
  await driver.wait(1000);
  const c: any = await driver.callDebug('getCamera');
  const camera = new PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
  camera.position.set(c.position.x, c.position.y, c.position.z); camera.lookAt(c.target.x, c.target.y, c.target.z); camera.updateMatrixWorld();
  const projected = new Vector3(coastal.sea.x, coastal.sea.y, coastal.sea.z).project(camera);
  report.coastSeaProjection = projected.toArray();
  await capture(`${region.id}-coast`);
  assert(c.distance <= 34 && !c.freeMove, 'Coast must use the normal bounded player camera');
  assert(Math.abs(projected.x) < .9 && Math.abs(projected.y) < .9 && projected.z > -1 && projected.z < 1, 'Solved sea point is not inside the normal camera view; screenshot is diagnostic only');
  }
  report.sourceAfter = await sourceStamp();
  assert.deepEqual(report.sourceAfter, report.sourceBefore, 'Authored world sources changed during capture; rerun this batch on settled sources');
  assert.equal(await page.evaluate(() => performance.timeOrigin), documentOrigin, 'Document reloaded during world evidence capture');
  report.errors = await driver.callDebug('getErrors');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true; report.status = 'semantic-pass-awaiting-screenshot-review';
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  report.elapsedMs = Date.now() - started;
  report.pageErrors = driver.pageErrors; report.consoleErrors = driver.consoleErrors; report.requestErrors = driver.requestErrors;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await driver.close(); clearDeadline();
  process.stdout.write(JSON.stringify({ passed: report.passed, region: region.id, elapsedMs: report.elapsedMs, report: path.join(out, 'report.json'), failure: report.failure }) + '\n');
}
