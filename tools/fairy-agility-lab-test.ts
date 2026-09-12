/** Root-owned browser gate. Uses the existing production agility fixture and an attached camera. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { FAIRY_AGILITY_LINKS } from '../game/src/content/fairyAgility.js';
import { agilityXp } from '../game/src/content/index.js';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';

const args = process.argv.slice(2);
const out = argValue(args, '--out') ?? 'test-results/fairy-agility-lab';
const selected = args.includes('--all') ? FAIRY_AGILITY_LINKS
  : [FAIRY_AGILITY_LINKS[0]!, FAIRY_AGILITY_LINKS.find(link => link.tier === 60)!];
const clearDeadline = installTestDeadline('Fairy agility lab', 60_000);
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4174', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const report: Record<string, any> = { passed: false, tested: [], visualReviewRequired: true };
await mkdir(out, { recursive: true });
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript('window.__name = (value) => value;');
  await driver.open(30_000, '/index.html?mode=combat&agility=1&startup-cache=0');
  await page.waitForFunction(() => (window as any).__agilityLab
    && (window as any).__gameDebug.getNavigationState().status === 'ready', null, { timeout: 10_000 });
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  assert(/D3D11|Direct3D11/i.test(report.renderer) && !/SwiftShader|llvmpipe|software/i.test(report.renderer));
  const state = () => page.evaluate(() => (window as any).__agilityLab.getState());
  const initial = await state();
  report.initialLanes = initial.lanes;
  for (const link of FAIRY_AGILITY_LINKS) {
    const lane = initial.lanes.find((candidate: any) => candidate.id === link.obstacle.id);
    assert(lane, `Missing staged ${link.obstacle.id}`);
    const entry = lane.groundEntry, exit = lane.groundExit;
    assert(Math.abs(exit[0] - entry[0] - link.obstacle.exitPosition[0] + link.obstacle.position[0]) < .001);
    assert(Math.abs(exit[2] - entry[2] - link.obstacle.exitPosition[1] + link.obstacle.position[1]) < .001);
    const rise = exit[1] - entry[1];
    assert(rise >= 5.8 && rise <= 8.2, `${link.obstacle.id}: terrain rise ${rise}m`);
    for (const [ground, navigable] of [[entry, lane.entry], [exit, lane.exit]]) {
      const error = Math.hypot(...ground.map((value: number, index: number) => value - navigable[index]));
      assert(error < .75, `${link.obstacle.id}: navigation differs from terrain by ${error}m`);
    }
  }
  for (const link of selected) {
    const id = link.obstacle.id;
    await driver.callDebug('callTool', ['corealm_stop', {}]);
    const lane = await page.evaluate(({ id, level }) => {
      const w = window as any;
      w.__agilityLab.prepare(); w.__agilityLab.setLevel(level);
      return w.__agilityLab.getState().lanes.find((candidate: any) => candidate.id === id);
    }, { id, level: link.obstacle.reqLevel - 1 });
    const dx = lane.exit[0] - lane.entry[0], dz = lane.exit[2] - lane.entry[2];
    const length = Math.hypot(dx, dz);
    const requested = [lane.entry[0] - dx / length * 1.8, lane.entry[1], lane.entry[2] - dz / length * 1.8];
    const stance = await driver.callDebug('getNavPoint', [requested]) as { x: number; y: number; z: number } | null;
    assert(stance && Math.hypot(stance.x - requested[0]!, stance.z - requested[2]!) < .5, `${id}: unsafe approach stance`);
    await driver.callDebug('inspectPose', [{ ...stance, yaw: Math.atan2(-dx, -dz), pitch: .3, distance: 10, detached: false }]);
    await driver.callDebug('waitForView');
    const beforeRejected = await state();
    const rejected = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'climb' }]) as any;
    assert.equal(rejected.error, 'REQUIREMENTS_NOT_MET', JSON.stringify(rejected));
    const afterRejected = await state();
    assert.deepEqual(afterRejected.playerPosition, beforeRejected.playerPosition);
    assert.equal(afterRejected.agility.xp, beforeRejected.agility.xp);
    assert.equal(afterRejected.uses[id], beforeRejected.uses[id]);
    assert.equal(afterRejected.activity, null);
    await driver.screenshot(out, `${id}-foot`);
    await page.evaluate(level => (window as any).__agilityLab.setLevel(level), link.obstacle.reqLevel + 20);
    const before = await state();
    await page.evaluate(() => {
      const w = window as any;
      w.__fairyAgilityProof = { active: true, rows: [] };
      const sample = () => {
        if (!w.__fairyAgilityProof.active) return;
        const p = w.__gameDebug.getPlayerPosition(), curtain = document.querySelector('.traversal-transition');
        w.__fairyAgilityProof.rows.push({ at: performance.now(), simMs: w.__gameDebug.getState().clock.elapsedMs,
          position: [p.x, p.y, p.z], opacity: curtain ? Number(getComputedStyle(curtain).opacity) : 0 });
        requestAnimationFrame(sample);
      };
      sample();
    });
    const started = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'climb' }]) as any;
    assert(!started.error && !/walking/.test(started.started ?? ''), JSON.stringify(started));
    await page.waitForFunction(() => {
      const curtain = document.querySelector('.traversal-transition');
      return curtain && Number(getComputedStyle(curtain).opacity) >= .999;
    }, null, { timeout: 2500 });
    const covered = await state();
    assert.deepEqual(covered.playerPosition, before.playerPosition);
    assert.equal(covered.uses[id], before.uses[id]);
    await page.waitForFunction(id => {
      const state = (window as any).__agilityLab.getState();
      return !state.activity && state.uses[id] > 0;
    }, id, { timeout: 6000 });
    const after = await state();
    const rows = await page.evaluate(() => {
      const proof = (window as any).__fairyAgilityProof;
      proof.active = false; return proof.rows;
    }) as { position: number[]; opacity: number; simMs: number }[];
    assert(Math.hypot(...after.playerPosition.map((value: number, index: number) => value - lane.exit[index])) < .35);
    assert.equal(after.uses[id], before.uses[id] + 1);
    assert.equal(after.agility.xp - before.agility.xp, agilityXp(link.tier));
    const commit = rows.find((row, index) => index > 0
      && Math.hypot(...row.position.map((value, axis) => value - rows[index - 1]!.position[axis]!)) > 3);
    assert(commit && commit.opacity >= .999, `${id}: placement lacked opaque coverage`);
    assert(commit.simMs - rows[0]!.simMs >= link.obstacle.durationMs - 100, `${id}: early placement`);
    await page.waitForFunction(() => {
      const curtain = document.querySelector('.traversal-transition');
      return !curtain || Number(getComputedStyle(curtain).opacity) <= .001;
    }, null, { timeout: 3000 });
    const snapshot = await driver.snapshot() as any;
    assert(snapshot.camera.freeMove === false && snapshot.camera.distance <= 11, `${id}: detached acceptance camera`);
    await driver.screenshot(out, `${id}-top`);
    report.tested.push({ id, lane, beforeRejected, rejected, afterRejected, before, started, covered, after, rows, snapshot });
  }
  assert.deepEqual(await driver.callDebug('getErrors'), []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: report.tested.map((entry: any) => entry.id), staged: FAIRY_AGILITY_LINKS.length, out }));
} catch (error) {
  report.failure = String(error);
  report.errors = { page: driver.pageErrors, console: driver.consoleErrors };
  await driver.screenshot(out, 'failure').catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close(); clearDeadline();
}
