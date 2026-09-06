/** Root-scheduled final-world integration after portal lab acceptance. Screenshots need review.
 * npx tsx runs/corealm-rebuild/checks/finish-portal-world.ts [--mode manual|routed] [--url URL]
 * Each invocation has a hard 115-second deadline and uses normal simulation time.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { GameDriver } from '../../../tools/lib/driver.js';
import { installTestDeadline } from '../../../tools/lib/deadline.js';
import { CAMERA, PLAYER_RADIUS } from '../../../game/src/app/config.js';
import { portalEntrance } from '../../../game/src/world/portalEntrance.js';
const arg = (key: string, fallback: string) => process.argv[process.argv.indexOf(key) + 1] && process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback;
const mode = arg('--mode', 'manual'); assert(['manual', 'routed'].includes(mode));
const out = `test-results/finish-portal-world/${mode}`; await mkdir(out, { recursive: true });
const deadline = installTestDeadline(`Final-world portal ${mode}`, 115_000);
const driver = new GameDriver({ url: arg('--url', 'http://127.0.0.1:4175'), close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const report: any = { passed: false, mode, screenshots: [], clicks: [], scope: 'Final-world portal wiring following independent lab acceptance; debug relocation is setup only.' };
const gap = (a: any, b: number[]) => Math.hypot(a.x - b[0]!, a.z - b[2]!);
try {
  await driver.launch(); await driver.open(50_000, '/index.html'); const page = driver.page!;
  const entry: any = await driver.callDebug('getEntity', ['gravelmaw_mouth_portal']);
  const exit: any = await driver.callDebug('getEntity', ['gravelmaw_exit_portal']);
  assert(entry?.interactionPosition && exit?.interactionPosition, 'Both authored portals need front approach pads');
  report.portals = { entry, exit };
  const stance: number[] = entry.interactionPosition, yaw = entry.view.rotationY ?? 0;
  const forward = [Math.sin(yaw), 0, Math.cos(yaw)];
  const approach = [stance[0]! + forward[0]! * 7, stance[1]!, stance[2]! + forward[2]! * 7];
  await driver.callDebug('teleport', [approach]);
  async function frame(entity: any, distance = 14) {
    // Explicit detached framing must preserve gameplay state in both the lab and final world.
    const before: any = await driver.callDebug('getPlayer');
    const p = entity.interactionPosition;
    const interior = entity.regionId === 'gravelmaw';
    await driver.callDebug('inspectPose', [{ x: p[0], y: p[1] + (interior ? 1.2 : 4), z: p[2], yaw: entity.view.rotationY ?? 0, pitch: interior ? .25 : 1, distance: interior ? 7.5 : distance, detached: true }]);
    await page.waitForFunction(id => (window as any).__gameDebug.getDrawnBounds(id)?.meshes > 0,
      entity.id, { timeout: 10_000, polling: 'raf' });
    // Wait for loaded portal geometry to be rendered, without waiting for unrelated island background preloads.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const after: any = await driver.callDebug('getPlayer');
    assert.equal(after.regionId, before.regionId, 'Camera framing must preserve realm');
    if (!before.moving) assert(gap(after.position, [before.position.x, before.position.y, before.position.z]) < .05, 'Camera framing must not place player');
  }
  async function capture(label: string) {
    report.captureSetup ??= [];
    report.captureSetup.push({ label, state: await driver.callDebug('getState'), camera: await driver.callDebug('getCamera'), player: await driver.callDebug('getPlayer') });
    report.screenshots.push(await driver.screenshot(out, label));
  }
  async function clickArch(entity: any) {
    await frame(entity, entity === entry ? 14 : 12);
    const b: any = await driver.callDebug('getDrawnBounds', [entity.id]); assert(b, `${entity.id} must be resident`);
    const c: any = await driver.callDebug('getCamera');
    const attempt: any = {id: entity.id, bounds:b, camera:c, candidates:[]}; report.pointerAttempts ??= []; report.pointerAttempts.push(attempt);
    const camera = new PerspectiveCamera(CAMERA.fov, 1440 / 900, .1, 1500);
    camera.position.set(c.position.x, c.position.y, c.position.z); camera.lookAt(c.target.x, c.target.y, c.target.z); camera.updateMatrixWorld();
    const corners = [b.min.x,b.max.x].flatMap(x => [b.min.y,b.max.y].flatMap(y => [b.min.z,b.max.z].map(z => new Vector3(x,y,z).project(camera))));
    const rect = {left:Math.min(...corners.map(p => (p.x*.5+.5)*1440)),right:Math.max(...corners.map(p => (p.x*.5+.5)*1440)),top:Math.min(...corners.map(p => (-p.y*.5+.5)*900)),bottom:Math.max(...corners.map(p => (-p.y*.5+.5)*900))};
    attempt.screenBounds=rect;
    for (const fy of [.45, .7, .2, .9]) for (const fx of [.2, .8, .1, .9, .35, .65, .5]) {
      const x = rect.left+(rect.right-rect.left)*fx, y=rect.top+(rect.bottom-rect.top)*fy;
      if (x < 0 || x > 1440 || y < 0 || y > 900) continue;
      await page.mouse.move(x, y);
      try { await page.waitForFunction(id => (window as any).__gameDebug.getState().hoveredEntityId === id, entity.id, { timeout: 600 }); }
      catch { attempt.candidates.push({x,y,state:await driver.callDebug('getState')}); continue; }
      report.clicks.push({ id: entity.id, x, y }); await page.mouse.click(x, y); return;
    }
    throw new Error(`No unobstructed pointer target found on ${entity.id}`);
  }
  async function startTrace() {
    await page.evaluate(`(() => { window.__portalTrace=[]; window.__portalTraceActive=true;
      const sample=()=>{if(!window.__portalTraceActive)return;const d=window.__gameDebug,c=document.querySelector('.portal-transition');
      window.__portalTrace.push({at:performance.now(),player:d.getPlayer(),phase:c?.dataset.phase??null,opacity:c?Number(getComputedStyle(c).opacity):0});requestAnimationFrame(sample)};requestAnimationFrame(sample);})()`);
  }
  async function crossing(region: string, label: string) {
    await page.waitForFunction(id => (window as any).__gameDebug.getPlayer().regionId === id, region, { timeout: 18_000 });
    await page.waitForFunction(() => !document.querySelector('.portal-transition'), null, { timeout: 6000 });
    const trace: any[] = await page.evaluate(`(() => {window.__portalTraceActive=false;return window.__portalTrace})()`);
    report[label] = { trace, player: await driver.callDebug('getPlayer'), scene: await driver.callDebug('getSceneStats') };
    assert(trace.some(row => row.phase === 'closing' && row.player.regionId !== region), 'Closing must precede realm change');
    const commit = trace.find(row => row.player.regionId === region); assert(commit && commit.opacity >= .99, 'First destination sample must be behind full blackout');
    await frame(region === 'gravelmaw' ? exit : entry, region === 'gravelmaw' ? 12 : 14);
    await capture(label);
    return trace;
  }
  if (mode === 'manual') {
    await frame(entry); await capture('01-approach');
    // Real forward input must hit the recess. The canonical clearance probe independently verifies the solid exists.
    const solid = portalEntrance(entry, () => stance[1]!).solid;
    const probe: any = await driver.callDebug('probeWorldClearance', [{ x: solid.position[0], y: stance[1], z: solid.position[2], radius: PLAYER_RADIUS }]);
    assert(probe.staticShift > .1, 'Portal recess must contain a physical blocking solid');
    await page.keyboard.down('w'); await driver.wait(2400); await page.keyboard.up('w');
    const blocked: any = await driver.callDebug('getPlayer'); report.sealed = { probe, blocked };
    assert.equal(blocked.regionId, entry.regionId, 'Manual walking must not cross realms');
    const front = (blocked.position.x - entry.position[0]) * forward[0]! + (blocked.position.z - entry.position[2]) * forward[2]!;
    assert(front > 0, 'Player must remain in front of sealed recess');
    assert(gap(blocked.position, approach) > 1, 'Manual input must actually move toward entrance');
    await driver.callDebug('teleport', [approach]);
  }
  report.before = await driver.callDebug('getPlayer'); await startTrace(); await clickArch(entry);
  const entering = await crossing('gravelmaw', '02-inside');
  const closing = entering.find(row => row.phase === 'closing');
  assert(closing && gap(closing.player.position, stance) <= .5, 'Portal click must walk to its authored front pad');
  assert(gap(report.before.position, [closing.player.position.x, closing.player.position.y, closing.player.position.z]) > 5, 'Entry requires a real approach walk');
  assert.equal(await driver.callDebug('getDrawnBounds', [entry.id]), null, 'Surface portal must not be drawn inside the dungeon');
  assert(await driver.callDebug('getDrawnBounds', [exit.id]), 'Interior exit must be resident after arrival');
  if (mode === 'routed') {
    const events: any = await driver.callDebug('getEvents'); report.routeStartSeq = events.nextSeq;
    await page.keyboard.press('m');
    const destination = page.locator('[data-place="gravelmaw_entrance"]');
    await destination.waitFor({ state: 'visible', timeout: 4000 });
    await startTrace(); await destination.click({ timeout: 4000 });
    await page.keyboard.press('m');
  } else { await startTrace(); await clickArch(exit); }
  await crossing(entry.regionId, '03-returned');
  assert(gap(report['03-returned'].player.position, stance) < .5, 'Return must use the exterior approach pad');
  assert.equal(await driver.callDebug('getDrawnBounds', [exit.id]), null, 'Dungeon exit must not be drawn on surface');
  await page.waitForFunction(() => !(window as any).__gameDebug.getPlayer().inCombat, null, {timeout:3000});
  report.surfaceSettled = await driver.callDebug('getPlayer');
  assert.equal(report.surfaceSettled.regionId, entry.regionId);
  assert.equal(report.surfaceSettled.health, report.before.health, 'Dungeon pursuit must not damage the player after returning to surface');
  if (mode === 'routed') {
    await page.waitForFunction(seq => (window as any).__gameDebug.getEvents(seq).events.some((event: any) => event.type === 'navigation.completed'), report.routeStartSeq, { timeout: 6000 });
    const events: any = await driver.callDebug('getEvents', [report.routeStartSeq]); report.routeEvents = events.events;
    assert.equal(events.events.filter((e: any) => e.type === 'navigation.started').length, 1, 'Route must retain one journey across transition');
    assert.equal(events.events.filter((e: any) => e.type === 'navigation.completed').length, 1, 'Route must complete once');
    assert(!events.events.some((e: any) => e.type === 'navigation.failed'), 'Transition must not cancel the routed journey');
  }
  report.errors = await driver.callDebug('getErrors'); report.console = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  if (driver.page) {
    report.failureState = await driver.callDebug('getState').catch(() => null);
    report.failurePlayer = await driver.callDebug('getPlayer').catch(() => null);
    report.failureBounds = await driver.callDebug('getDrawnBounds', ['gravelmaw_mouth_portal']).catch(() => null);
    report.errors = await driver.callDebug('getErrors').catch(() => null);
  }
}
finally { await driver.close(); deadline(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, mode, error: report.error })); }
