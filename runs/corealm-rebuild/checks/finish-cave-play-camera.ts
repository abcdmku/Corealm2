/** Ordinary-play readability of the scanned cave interior.
 *
 * The other cave checks all use the detached inspection camera. This one keeps the production follow
 * camera, teleports the player into each authored chamber and orbits with the same right-drag input a
 * player uses, so the roof cutaway, the depth-query silhouette pass and camera obstruction recovery all
 * run exactly as they do in play. PORT / CAVE_LAB_URL select the server; --version selects the candidate. */
import { assertPerformanceHardware } from '../../../tools/performanceHardware.js';
import { installAssetCandidates } from '../../../tools/lib/assetCandidates.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from '../../../tools/lib/driver.js';
import { installTestDeadline } from '../../../tools/lib/deadline.js';

/** `--plain` renders the authored cave without the scanned facing, to separate cave-art defects
 * from whole-cave camera behaviour. */
const plain = process.argv.includes('--plain');
/** `--served` uses the promoted asset from game/public/assets instead of the staged candidate. */
const served = process.argv.includes('--served');
const version = process.argv[process.argv.indexOf('--version') + 1] || '7';
const out = `test-results/finish-cave-play-camera-${plain ? 'plain' : served ? 'served' : `v${version}`}`;
await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline('Cave play camera', 90000);
const driver = new GameDriver({ url: process.env.CAVE_LAB_URL ?? `http://127.0.0.1:${process.env.PORT ?? '4175'}`, close: async () => {} },
  { headless: true, viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const report: any = { passed: false, version, createdAt: new Date().toISOString(), shots: [] };
try {
  await driver.launch();
  if (!plain && !served) await installAssetCandidates(driver.page!, `art/rebuild/candidates/finish-cave-source/v${version}/catalog.json`);
  await driver.open(25000, `/index.html?mode=combat&cave=1${plain ? '' : '&caveSource=1'}`);
  const page = driver.page!;
  await page.locator('#panel-feature-lab .panel__close').click();
  const state: any = await page.evaluate(() => (window as any).__caveLab.getState());
  assert(state.ready); assert(plain ? !state.sourceFacing : state.sourceFacing?.domainWarp);
  report.fixture = { origin: state.origin, triangles: state.triangles, sourceFacing: state.sourceFacing };
  report.hardware = await assertPerformanceHardware(page);
  await page.evaluate(() => (window as any).__featureLab.setFreeCameraEnabled(false));
  const spots = [
    { id: 'upper', at: state.origin },
    { id: 'join', at: [state.origin[0] + 4.5, state.origin[1] - 0.9, state.origin[2] - 1] },
    { id: 'lower', at: [state.origin[0] + 9, state.origin[1] - 1.7, state.origin[2] - 2] },
  ];
  for (const spot of spots) {
    await driver.callDebug('teleport', [spot.at]);
    await driver.wait(320);
    // Four right-drag orbits of about a quarter turn each, the way a player looks around a chamber.
    for (const step of [0, 1, 2, 3]) {
      if (step > 0) { await driver.drag(720, 450, 720 - 260, 450, 'right'); await driver.wait(260); }
      const camera: any = await driver.callDebug('getCamera');
      const player: any = await driver.callDebug('getPlayer');
      const roof = await driver.callDebug('getRoofVisibility');
      const silhouette = await driver.callDebug('getPlayerSilhouette');
      const file = await driver.screenshot(out, `${spot.id}-${step}`);
      report.shots.push({ spot: spot.id, step, camera, player, roof, silhouette, file });
    }
  }
  report.errors = await driver.callDebug('getErrors');
  report.console = driver.consoleErrors;
  report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  // The follow camera must stay inside the shell: a camera pushed through rock would report no
  // obstruction while framing the outside of the cave.
  for (const shot of report.shots) assert(shot.camera.distance > 0.4, `${shot.spot}-${shot.step} camera collapsed onto the player`);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await driver.close(); clearDeadline();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error,
    shots: report.shots.map((s: any) => [`${s.spot}-${s.step}`, s.camera.occluded, s.camera.distance, s.roof, s.silhouette]) }));
}
