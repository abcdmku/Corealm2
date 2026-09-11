/** Root-scheduled, 120-second production cave population and grounded movement gate. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { CAMERA } from '../game/src/app/config.js';

const out = 'test-results/dense-cave-lab', started = Date.now(), evidence: any[] = [];
const timer = setTimeout(() => { console.error('Dense cave gate exceeded 120 seconds including cleanup'); process.exit(124); }, 120_000);
timer.unref();
await mkdir(out, { recursive: true });
const server = await startGameServer({ hmr: false });
const driver = new GameDriver(server, { viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });

try {
  await driver.launch(); const page = driver.page!;
  page.setDefaultTimeout(5000);
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
  await driver.open(55_000, '/index.html?mode=combat&denseCave=1');
  await page.getByRole('button', { name: 'Close Feature lab', exact: true }).click();
  await page.waitForFunction(() => (window as any).__denseCaveLab?.fixture.getState().ready
    && !!(window as any).__dungeonDoorLab, undefined, { timeout: 15_000 });

  const snapshot = () => page.evaluate(() => {
    const lab = (window as any).__denseCaveLab, debug = window.__gameDebug as any;
    const player = debug.getPlayer(), p = player.position;
    return { fixture: lab.fixture.getState(), chambers: lab.fixture.spec.chambers,
      clock: debug.getState().clock, labState: window.__featureLab!.getState(), gameErrors: debug.getErrors(),
      browserFocus: { focused: document.hasFocus(), visibility: document.visibilityState,
        activeTag: document.activeElement?.tagName, activeRole: document.activeElement?.getAttribute('role') },
      packs: lab.packs, player, camera: debug.getCamera(), probe: lab.fixture.probe(p.x, p.z),
      doors: (window as any).__dungeonDoorLab.getState(),
      actors: lab.packs.flatMap((pack: any) => pack.entityIds.map((id: string) => ({
        id, packId: pack.id, entity: debug.getEntity(id), drawn: debug.getDrawnBounds(id), motion: debug.getEntityMotion(id),
      }))) };
  });
  function checkGrounded(state: any, label: string) {
    assert.equal(state.clock.paused, false, `${label}: simulation must be running`);
    assert.equal(state.labState.walkingEnabled, true, `${label}: lab walking must be enabled`);
    assert.deepEqual(state.gameErrors, [], `${label}: game errors`);
    assert.equal(state.camera.freeMove, false, `${label}: detached focus`);
    assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance, `${label}: interactive zoom`);
    assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch, `${label}: interactive pitch`);
    assert.equal(state.player.regionId, 'gravelmaw', `${label}: underground semantic region`);
    assert.equal(state.player.dead, false, `${label}: live player`);
    assert(state.probe, `${label}: actual receiving-floor triangles`);
    assert(Math.abs(state.player.position.y - state.probe.floorY) < .25, `${label}: grounded player`);
    assert(state.camera.target.y < state.probe.ceilingY, `${label}: focus remains inside the room`);
  }
  async function capture(label: string) {
    await page.waitForTimeout(200);
    const state = await snapshot(); evidence.push({ label, state }); checkGrounded(state, label);
    await page.screenshot({ path: `${out}/${label}.png` });
    return state;
  }
  async function orbitTo(yaw: number) {
    const camera = await driver.callDebug('getCamera') as any;
    const delta = Math.atan2(Math.sin(yaw - camera.yaw), Math.cos(yaw - camera.yaw));
    await driver.drag(720, 520, 720 - delta / .006, 520, 'right');
    const after = await driver.callDebug('getCamera') as any;
    assert(Math.abs(Math.atan2(Math.sin(after.yaw - yaw), Math.cos(after.yaw - yaw))) < .04, 'right-button orbit reached the walking bearing');
  }
  async function walk(ms: number, label: string, stop?: (state: any) => boolean) {
    const before = await snapshot(), samples: any[] = [];
    const record: any = { label, before, samples }; evidence.push(record);
    await page.keyboard.down('w');
    try {
      for (let elapsed = 0; elapsed < ms; elapsed += 100) {
        await page.waitForTimeout(Math.min(100, ms - elapsed));
        const state = await snapshot(); samples.push(state); checkGrounded(state, label);
        if (stop?.(state)) break;
      }
    } finally { await page.keyboard.up('w'); }
    const after = await snapshot(); record.after = after;
    assert(after.clock.tick > before.clock.tick, `${label}: simulation ticks must advance under real input`);
    return { before, after, samples };
  }

  await page.evaluate(async () => {
    const lab = window.__featureLab!, debug = window.__gameDebug as any;
    await lab.perform('reset-player'); lab.setFreeCameraEnabled(false); lab.setLevel('melee', 50);
    // Camera setup occurs on the ordinary yard. The underground setup uses the real teleport
    // region resolver, then all acceptance movement and orbit come through gameplay input.
    debug.inspectPose({ x: 0, y: debug.groundHeight(0, 74), z: 74, yaw: 0, pitch: .4, distance: 8 });
    debug.teleport((window as any).__denseCaveLab.spawn);
  });
  await page.waitForTimeout(450);
  const entry = await capture('gallery-entry');
  assert.deepEqual(entry.chambers.map((chamber: any) => chamber.radius), [13, 12, 12, 12]);
  assert.equal(entry.actors.length, 42); assert.equal(new Set(entry.actors.map((actor: any) => actor.id)).size, 42);
  assert.equal(entry.packs.length, 6);
  assert(entry.packs.every((pack: any) => pack.entityIds.length === 7));
  for (const actor of entry.actors) {
    assert(actor.entity, `${actor.id}: actual semantic actor missing`);
    assert(actor.entity.combat.maxHealth > 0 && actor.entity.combat.bodyRadius > 0, `${actor.id}: real combat body`);
    assert.equal(actor.entity.regionId, 'gravelmaw');
  }
  const galleryWalk = await walk(800, 'walk-through-gallery');
  assert(Math.hypot(galleryWalk.after.player.position.x - galleryWalk.before.player.position.x,
    galleryWalk.after.player.position.z - galleryWalk.before.player.position.z) > 1, 'grounded WASD moves through the dense gallery');
  assert(galleryWalk.samples.some(sample => sample.player.moving), 'real movement state entered');
  await capture('gallery-pack-density');

  for (const [index, id] of ['gravelmaw_stone_door', 'ordrun_gate'].entries()) {
    const threshold = await page.evaluate(id => {
      const workbench = (window as any).__dungeonDoorLab;
      workbench.setState(id, 'closed');
      const entity = (window.__gameDebug as any).getEntity(id);
      return { position: entity.position, yaw: entity.view.rotationY };
    }, id);
    await page.evaluate(({ position, yaw }) => {
      const lab = (window as any).__denseCaveLab, x = position[0] + Math.sin(yaw) * 1.3, z = position[2] + Math.cos(yaw) * 1.3;
      const probe = lab.fixture.probe(x, z);
      if (!probe) throw new Error('Gate approach has no floor');
      (window.__gameDebug as any).teleport([x, probe.floorY, z]);
    }, threshold);
    await orbitTo(threshold.yaw);
    const closed = await walk(550, `${id}-closed-walk`);
    const side = (state: any) => (state.player.position.x - threshold.position[0]) * Math.sin(threshold.yaw)
      + (state.player.position.z - threshold.position[2]) * Math.cos(threshold.yaw);
    assert(side(closed.before) > 1, `${id}: actual near-side start`);
    const closestContact = Math.min(...closed.samples.map(side));
    // Frame clearance and live crowd separation can stop the capsule before the thin
    // metal leaf. The causal check is closed passage followed by crossing when open.
    assert(closed.samples.every(sample => side(sample) > .25) && closestContact < side(closed.before) - .08,
      `${id}: grounded approach stays on the closed side; closest ${closestContact.toFixed(3)}m`);
    assert(closed.after.doors.doors.find((door: any) => door.id === id)?.blocked, `${id}: production blocker active`);
    await capture(`${index + 1}-gate-closed`);
    const openedRoutes = await page.evaluate(id => (window as any).__dungeonDoorLab.setState(id, 'open'), id);
    assert(openedRoutes.routes[index + 1]?.reachable && openedRoutes.routes[index + 1]?.graphReachable,
      `${id}: opening restores the real cave path and route edge`);
    // Hostile packs keep their normal AI and body collision. Give the player time to
    // pass a crowded opening, and stop on the far side instead of overshooting the room.
    const opened = await walk(3000, `${id}-opened-walk`, state => side(state) < -.75);
    assert(side(opened.after) < -.75, `${id}: ordinary movement crosses the opened leaf`);
    await capture(`${index + 1}-gate-open`);
  }
  const final = await snapshot();
  assert(final.doors.doors.every((door: any) => door.state === 'open' && !door.blocked));
  assert(final.actors.every((actor: any) => actor.entity && actor.entity.combat.health > 0), 'all 42 residents remain live');
  const observations = evidence.flatMap(item => item.state ? [item.state] : item.samples ?? []);
  for (const pack of entry.packs) assert(observations.some(state => state.actors.some((actor: any) =>
    actor.packId === pack.id && actor.drawn && actor.motion)), `${pack.id}: at least one native actor was drawn and animated during the room walk`);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(await driver.callDebug('getErrors'), []);
} catch (error) {
  if (driver.page && !driver.page.isClosed()) await driver.page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/lab.json`, JSON.stringify({ elapsedMs: Date.now() - started, evidence,
    consoleErrors: driver.consoleErrors, pageErrors: driver.pageErrors }, null, 2));
  await driver.close(); await server.close(); clearTimeout(timer);
}
