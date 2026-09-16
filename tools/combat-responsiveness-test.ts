import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA } from "../game/src/app/config.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const world = process.argv.includes("--world");
const clearDeadline = installTestDeadline("combat responsiveness", world ? 120_000 : 60_000);
const server = await startGameServer();
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
try {
  await page.addInitScript(() => { (window as any).__name = (fn: unknown) => fn; });
  await page.addInitScript(() => localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: 0.7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 })));
  await page.goto(`${server.url}/index.html${world ? "" : "?mode=combat&performance=1"}`);
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready, undefined, { timeout: 80_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const setup = await page.evaluate(async (world) => {
    const w = window as any;
    if (!world) {
      await w.__featureLab.equipPlayer("mainHand", "worn_sword");
      const preset = w.__featureLab.getCatalog().targets.creature.find((entry: any) => /goat/i.test(entry.label));
      if (!preset) throw new Error("No goat streaming fixture");
      w.__streamProbe = { frames: 0, peakTextures: 0, peakWaiting: 0 };
      const sample = () => {
        const shaders = w.__renderDistanceLab.shaders();
        w.__streamProbe.peakTextures = Math.max(w.__streamProbe.peakTextures, shaders?.textures ?? 0);
        w.__streamProbe.peakWaiting = Math.max(w.__streamProbe.peakWaiting, shaders?.waiting ?? 0);
        if (++w.__streamProbe.frames < 180) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      await w.__featureLab.spawnTarget("creature", preset.id, { distance: 3 });
      const state = w.__featureLab.getState();
      return { id: state.target.entityId, position: state.target.position, screen: state.target.screen };
    }
    const entities = w.__gameDebug.getEntities();
    const enemy = entities.find((e: any) => e.archetype === "enemy" && e.health > 0);
    if (!enemy) throw new Error("No live world creature");
    return { id: enemy.id, position: [enemy.position.x, enemy.position.y, enemy.position.z] };
  }, world);
  console.log("setup", JSON.stringify(setup));
  // Setup only positions the player. Attack and retreat use real pointer and keyboard input.
  await page.evaluate(({ position }) => (window as any).__gameDebug.teleport([position[0] - 1.3, position[1], position[2]]), setup);
  await page.waitForTimeout(700);
  let screen = await page.evaluate(({ id, position }) => {
    const w = window as any;
    if (w.__featureLab) return w.__featureLab.getState().target.screen;
    return w.__gameDebug.projectToScreen?.([position[0], position[1] + 0.6, position[2]]);
  }, setup);
  if (world) {
    const pose = await page.evaluate(() => (window as any).__gameDebug.getCamera());
    const camera = new PerspectiveCamera(CAMERA.fov, 1280 / 800, 0.1, 1000);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z); camera.updateMatrixWorld();
    const point = new Vector3(setup.position[0], setup.position[1] + 0.6, setup.position[2]).project(camera);
    screen = [(point.x + 1) * 640, (1 - point.y) * 400];
  }
  console.log("screen", JSON.stringify(screen));
  if (!screen) throw new Error("No target screen position");
  const x = Array.isArray(screen) ? screen[0] : screen.x;
  const y = Array.isArray(screen) ? screen[1] : screen.y;
  const started = Date.now();
  await page.mouse.click(x, y);
  await page.waitForFunction(id => (window as any).__gameDebug.getState().combatTargetId === id, setup.id);
  const selectionMs = Date.now() - started;
  await mkdir("test-results/combat-responsiveness", { recursive: true });
  await page.screenshot({ path: `test-results/combat-responsiveness/${world ? "world" : "lab"}-ring.png` });
  await page.keyboard.down("s");
  const retreatAt = Date.now();
  await page.waitForFunction(() => (window as any).__gameDebug.getState().combatTargetId === null);
  const cancelMs = Date.now() - retreatAt;
  await page.waitForTimeout(700);
  await page.keyboard.up("s");
  const retreatPosition = await page.evaluate(() => (window as any).__gameDebug.getPlayerPosition());
  assert(Math.hypot(retreatPosition.x - (setup.position[0] - 1.3), retreatPosition.z - setup.position[2]) > 0.5, "Retreat did not move the player");
  // Re-engage through the pointer, then click clear ground to cancel while pursuing.
  const targetPoint = await page.evaluate(() => (window as any).__featureLab?.getState().target.screen);
  let groundCancelMs: number | null = null;
  if (targetPoint) {
    await page.mouse.click(targetPoint[0], targetPoint[1]);
    await page.waitForFunction(id => (window as any).__gameDebug.getState().combatTargetId === id, setup.id);
    const groundAt = Date.now();
    await page.mouse.click(350, 560);
    await page.waitForFunction(() => (window as any).__gameDebug.getState().combatTargetId === null);
    groundCancelMs = Date.now() - groundAt;
    assert(groundCancelMs < 250);
  }
  if (!world) await page.waitForFunction(() => {
    const shaders = (window as any).__renderDistanceLab.shaders();
    return shaders.waiting === 0 && shaders.textures === 0;
  });
  const streaming = await page.evaluate(() => (window as any).__streamProbe ?? null);
  if (streaming) assert(streaming.peakTextures > 0, "Streaming texture preparation was not exercised");
  const after = await page.evaluate(() => (window as any).__gameDebug.getState());

  const gpu = await page.evaluate(() => {
    const gl = (document.querySelector("#viewport") as HTMLCanvasElement).getContext("webgl2")!;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  const frames = await page.evaluate(() => new Promise<number[]>(resolve => {
    const times: number[] = []; let previous = performance.now();
    function frame(now: number) { times.push(now - previous); previous = now; if (times.length === 90) resolve(times); else requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }));
  const { profile } = await cdp.send("Profiler.stop");
  const nodes = new Map(profile.nodes.map((node: any) => [node.id, node]));
  const costs = new Map<number, number>();
  profile.samples?.forEach((id: number, index: number) => costs.set(id, (costs.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0)));
  console.log("cpu", JSON.stringify([...costs].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, us]) => ({ ms: us / 1000, fn: nodes.get(id)?.callFrame.functionName, url: nodes.get(id)?.callFrame.url }))));
  const sorted = frames.slice(1).sort((a, b) => a - b);
  await mkdir("test-results/combat-responsiveness", { recursive: true });
  await page.screenshot({ path: `test-results/combat-responsiveness/${world ? "world" : "lab"}.png` });
  assert.deepEqual(errors, []);
  const report = { world, gpu, streaming, selectionMs, cancelMs, groundCancelMs, frameP50: sorted[Math.floor(sorted.length * .5)], frameP95: sorted[Math.floor(sorted.length * .95)], after, errors };
  await writeFile(`test-results/combat-responsiveness/${world ? "world" : "lab"}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert(cancelMs < 250, `Retreat cancellation took ${cancelMs} ms`);
} catch (error) { console.error(await page.locator("body").innerText()); throw error; } finally { await browser.close(); await server.close(); clearDeadline(); }
