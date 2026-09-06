import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { GameDriver } from "../../../tools/lib/driver.js";
import { CAMERA } from "../../../game/src/app/config.js";
import type { Vec3 } from "../../../game/src/contracts.js";
import type { GameState } from "../../../game/src/state/store.js";

// Run separately after root grants the GPU slot. Screenshots still need human inspection.
// npx tsx runs/corealm-rebuild/checks/camera-respawn-browser.ts --mode lab
// npx tsx runs/corealm-rebuild/checks/camera-respawn-browser.ts --mode world --town highcairn
function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
const mode = argument("mode", "lab");
assert(mode === "lab" || mode === "world");
const towns = { highcairn: "highcairn_outpost", emberfast: "emberfast_town", rootfall: "rootfall_hamlet", coldbrace: "town_center" };
const town = argument("town", "highcairn") as keyof typeof towns;
assert(town in towns);
const url = process.env.COREALM_URL ?? "http://127.0.0.1:4175";
const startedAt = new Date().toISOString();
const out = `test-results/camera-respawn/${mode === "lab" ? mode : town}/${startedAt.replace(/[:.]/g, "-")}`;
mkdirSync(out, { recursive: true });
const start = Date.now();
const deadline = start + 59_000;
const trace: { label: string; elapsedMs: number; value: unknown }[] = [];
const report: Record<string, unknown> = {
  passed: false, mode, town, startedAt, out, budgetMs: 59_000, trace,
  visualAcceptance: "Pending inspection of every screenshot for actual avatar visibility and opaque geometry.",
  worldLabException: mode === "world" ? "Final integration checks the authored settlement spawn and its walkable surroundings after isolated lab death/camera proof." : null,
};
const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const hardLimit = setTimeout(() => {
  report.error = "Exceeded 59-second hard limit";
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  void driver.close().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 1000);
}, 58_000);
const record = (label: string, value: unknown) => trace.push({ label, elapsedMs: Date.now() - start, value });
async function bounded<T>(label: string, action: () => Promise<T>, max = 4000): Promise<T> {
  const available = Math.min(max, deadline - Date.now() - 2500);
  assert(available > 0, `No budget remains at ${label}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${available}ms`)), available);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function debug<T>(method: string, args: unknown[] = []): Promise<T> {
  return await bounded(method, () => driver.callDebug(method, args)) as T;
}
async function read() {
  return bounded("read state and live rig", () => driver.page!.evaluate(() => {
    const d = window.__gameDebug as unknown as {
      getSaveBlob(): string; getCamera(): {
        position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; freeMove: boolean;
      };
      getPlayerMotion(): { drawnPosition: Vec3; feet: { left: { ball: Vec3 }; right: { ball: Vec3 } } };
      getState(): { clock: { paused: boolean; timeScale: number; tick: number } };
      getEvents(since: number): { nextSeq: number; events: { type: string; seq: number; data: Record<string, unknown> }[] };
    };
    return { state: JSON.parse(d.getSaveBlob()) as GameState, camera: d.getCamera(),
      motion: d.getPlayerMotion(), clock: d.getState().clock, events: d.getEvents(0) };
  }));
}
async function waitFor(label: string, predicate: () => Promise<boolean>, max = 3000) {
  const until = Date.now() + max;
  while (Date.now() < until) {
    if (await predicate()) return;
    await bounded(label, () => driver.wait(50));
  }
  throw new Error(`${label} did not complete in ${max}ms`);
}
function framing(value: Awaited<ReturnType<typeof read>>) {
  assert.equal(value.clock.paused, false);
  assert.equal(value.clock.timeScale, 1);
  assert.equal(value.camera.freeMove, false, "Death must return to player follow");
  const player = value.state.player.position;
  assert(Math.hypot(...value.motion.drawnPosition.map((n, i) => n - player[i]!) as Vec3) < 0.3,
    "Rig is still drawn at the previous location");
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1.6, CAMERA.near, CAMERA.far);
  camera.position.set(value.camera.position.x, value.camera.position.y, value.camera.position.z);
  camera.lookAt(value.camera.target.x, value.camera.target.y, value.camera.target.z);
  camera.updateMatrixWorld(true);
  const points: Vec3[] = [value.motion.feet.left.ball, value.motion.feet.right.ball];
  // Debug exposes live feet, but no head bounds. This conservative envelope supplements the PNG.
  for (const x of [-0.5, 0.5]) for (const y of [0, 2.1]) for (const z of [-0.4, 0.4]) {
    points.push([player[0] + x, player[1] + y, player[2] + z]);
  }
  const projected = points.map(point => new THREE.Vector3(...point).project(camera).toArray());
  record("live feet and conservative body envelope projection", projected);
  for (const [x, y, z] of projected) {
    assert(Math.abs(x!) < 0.95 && Math.abs(y!) < 0.95 && z! > -1 && z! < 1,
      `Avatar framing leaves viewport: ${JSON.stringify([x, y, z])}`);
  }
}
async function capture(name: string) {
  record(name, await bounded(name, () => driver.screenshot(out, name)));
}
try {
  await bounded("launch", () => driver.launch());
  const page = driver.page!;
  page.setDefaultTimeout(4000);
  await bounded("open production game", () => driver.open(mode === "lab" ? 20000 : 30000,
    mode === "lab" ? "/index.html?mode=combat&portal=1" : "/index.html"), mode === "lab" ? 24000 : 34000);
  report.renderer = await bounded("hardware renderer", () => page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "";
  }));
  assert(/D3D11|Direct3D11/i.test(String(report.renderer)) && !/SwiftShader|llvmpipe/i.test(String(report.renderer)));
  const close = page.locator("#panel-feature-lab .panel__close");
  if (await bounded("workbench visible", () => close.isVisible())) await bounded("close workbench", () => close.click());
  const nodeId = mode === "lab" ? "lab:portal:outside" : towns[town];
  const nodes = await debug<{ id: string; position: Vec3 }[]>("listRouteNodes");
  const anchor = nodes.find(node => node.id === nodeId);
  assert(anchor, `Missing production anchor ${nodeId}`);
  if (mode === "lab") {
    const saved = JSON.parse(await debug<string>("getSaveBlob")) as GameState;
    saved.player.respawnPointId = nodeId;
    record("diagnostic lab saved-anchor setup", { nodeId, position: anchor.position });
    await debug("loadSaveBlob", [JSON.stringify(saved)]);
  } else {
    await debug("teleport", [{ locationId: nodeId }]);
    await waitFor("normal town anchor binding", async () => (await read()).state.player.respawnPointId === town);
  }
  const remote: Vec3 = mode === "lab" ? [-30, await debug<number>("groundHeight", [-30, 30]), 30]
    : [-160, await debug<number>("groundHeight", [-160, -118]), -118];
  await debug("teleport", [remote]);
  await debug("inspectPose", [{ x: remote[0], y: remote[1], z: remote[2], yaw: Math.PI * 0.15,
    pitch: CAMERA.defaultPitch, distance: CAMERA.defaultDistance, detached: true }]);
  const before = await read();
  record("remote diagnostic death prerequisites", before);
  await capture("01-before-death-remote-camera");
  await debug("setHealth", [0]);
  await waitFor("normal death restores player", async () => {
    const current = await read();
    return current.state.player.health > 0 && current.events.events.some(event => event.type === "player.died" && event.seq > before.events.nextSeq);
  });
  // Wait at most two real render frames for the normal loop to sync the rig, never reframe it.
  await bounded("two render frames", () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  const after = await read();
  record("real death result", after);
  await capture("02-first-respawn-dialog");
  await bounded("dismiss real death dialog", () => page.getByRole("button", { name: "Dismiss", exact: true }).click());
  await capture("02-first-respawn-frame");
  assert(Math.hypot(after.state.player.position[0] - anchor.position[0], after.state.player.position[2] - anchor.position[2]) < 0.7);
  framing(after);
  await bounded("ordinary backward walk", () => driver.press("s", 1000));
  await waitFor("normal keyup tick stops walking", async () => (await read()).state.player.movement.mode === "idle");
  await bounded("post-walk render frames", () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  const walked = await read();
  record("normal keyboard walk result", walked);
  await capture("03-after-normal-walk");
  const distance = Math.hypot(walked.state.player.position[0] - after.state.player.position[0], walked.state.player.position[2] - after.state.player.position[2]);
  record("walk clearance separate from camera framing", { distance,
    clearance: await debug("probeWorldClearance", [{ x: walked.state.player.position[0], z: walked.state.player.position[2], radius: 0.35 }]) });
  assert(distance > 1, "Normal input failed to leave spawn; investigate collision separately from camera");
  framing(walked);
  assert.deepEqual(await debug("getErrors"), []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  if (driver.page && Date.now() < deadline - 5000) await capture("failure").catch(() => {});
} finally {
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - start;
  report.consoleErrors = driver.consoleErrors;
  report.pageErrors = driver.pageErrors;
  report.requestErrors = driver.requestErrors;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await bounded("close Chromium", () => driver.close()).catch(() => {});
  clearTimeout(hardLimit);
}
