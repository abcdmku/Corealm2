/** Production attached-camera regression against the existing compact fairy cliff fixture. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { CAMERA } from '../game/src/app/config.js';
import { FAIRY_LANDFORM_PROBES } from '../game/src/world/fairyLandforms.js';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';

const args = process.argv.slice(2), out = argValue(args, '--out') ?? 'test-results/fairy-terraces-lab/camera-cliff';
const clearDeadline = installTestDeadline('Fairy camera lab', 60_000);
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const probe = FAIRY_LANDFORM_PROBES[0]!;
const foot = { x: probe.flankFoot[0] - probe.centre[0], z: probe.flankFoot[1] - probe.centre[1] - 55 };
const yaw = Math.atan2(-foot.x, -55 - foot.z);
const report: Record<string, any> = { passed: false, fixture: probe.id, foot, visualReviewRequired: true };
await mkdir(out, { recursive: true });
try {
  await driver.launch();
  const page = driver.page!;
  await page.addInitScript('window.__name = (value) => value;');
  await driver.open(30_000, '/index.html?mode=combat&terrain=cliff&startup-cache=0');
  await page.waitForFunction(() => (window as any).__gameDebug.getNavigationState().status === 'ready', null, { timeout: 10_000 });
  report.renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null;
  });
  assert(/D3D11|Direct3D11/i.test(report.renderer) && !/SwiftShader|llvmpipe|software/i.test(report.renderer));
  const snapshot = async () => {
    const state = await driver.snapshot() as any, camera = state.camera;
    const view = new THREE.PerspectiveCamera(CAMERA.fov, 1440 / 900, CAMERA.near, CAMERA.far);
    view.position.set(camera.position.x, camera.position.y, camera.position.z);
    view.lookAt(camera.target.x, camera.target.y, camera.target.z); view.updateMatrixWorld(true);
    const points = [{ kind: 'lens', ...camera.position }];
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const corner = new THREE.Vector3(x, y, -1).unproject(view);
      points.push({ kind: `near:${x},${y}`, x: corner.x, y: corner.y, z: corner.z });
    }
    const clearance = await page.evaluate(points => points.map(point => {
      const ground = (window as any).__gameDebug.groundHeight(point.x, point.z);
      return { ...point, ground, clearance: point.y - ground };
    }), points);
    return { ...state, clearance };
  };
  const checkAttached = (state: any) => {
    const c = state.camera, p = state.playerPosition;
    assert.equal(c.freeMove, false);
    assert.equal(c.requestedDistance, 11);
    assert(c.distance <= CAMERA.maxDistance);
    assert.equal(c.effectivePitch, .25);
    assert(Math.hypot(c.target.x - p.x, c.target.z - p.z) < .01);
    assert(Math.abs(c.target.y - p.y - 1.1) < .01, 'camera focus must remain at normal player head height');
    for (const point of state.clearance) assert(point.clearance > .05, `${point.kind} inside terrain: ${JSON.stringify(point)}`);
  };

  await driver.callDebug('callTool', ['corealm_stop', {}]);
  await driver.callDebug('inspectPose', [{ ...foot, y: 0, yaw, pitch: .25, distance: 11, detached: false }]);
  await driver.callDebug('waitForView');
  report.blocked = await snapshot();
  checkAttached(report.blocked);
  assert(report.blocked.camera.occluded && report.blocked.camera.distance < 9, 'bank must contract the normal 11m seat');
  assert(Math.abs(report.blocked.camera.effectiveYaw - yaw) < .001, 'collision must preserve chosen heading');
  const target = report.blocked.camera.target;
  const requested = { x: target.x + Math.sin(yaw) * Math.cos(.25) * 11,
    y: target.y + Math.sin(.25) * 11, z: target.z + Math.cos(yaw) * Math.cos(.25) * 11 };
  const requestedGround = await driver.callDebug('groundHeight', [requested.x, requested.z]) as number;
  report.unclampedSeat = { ...requested, ground: requestedGround, clearance: requested.y - requestedGround };
  assert(requested.y < requestedGround - .2, 'fixture must expose the original lens-inside-bank defect');
  assert((await driver.callDebug('groundHeight', [0, -55]) as number) > 5.5);
  await driver.screenshot(out, 'bank-clearance');

  // Normal right-button orbit: rotate the lens away from the bank without moving the player.
  await page.mouse.move(440, 440);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(964, 440, { steps: 20 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(() => {
    const camera = (window as any).__gameDebug.getCamera();
    return !camera.occluded && camera.distance >= 10.99;
  }, null, { timeout: 3000 });
  report.recovered = await snapshot();
  checkAttached(report.recovered);
  assert.equal(report.recovered.camera.distance, 11);
  assert.deepEqual(report.recovered.playerPosition, report.blocked.playerPosition);
  assert(Math.abs(report.recovered.camera.yaw - report.blocked.camera.yaw) > 3, 'real orbit input must turn away');
  await driver.screenshot(out, 'orbit-recovered');
  assert.deepEqual(await driver.callDebug('getErrors'), []);
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, contracted: report.blocked.camera.distance,
    recovered: report.recovered.camera.distance, out }));
} catch (error) {
  report.failure = String(error);
  report.state = await driver.snapshot().catch(() => null);
  report.errors = { page: driver.pageErrors, console: driver.consoleErrors };
  await driver.screenshot(out, 'failure').catch(() => {});
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await driver.close(); clearDeadline();
}
