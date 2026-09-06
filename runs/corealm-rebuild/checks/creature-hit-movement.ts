/** Root GPU lease required. Public production assets, one actor per bounded run. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { GAMEPLAY_HARDWARE_ARGS, assertGameplayHardware } from "./finish-gameplay-renderer.js";

const species = process.argv.find(v => v.startsWith("--species="))?.slice(10) ?? "beetle_golem";
assert(["beetle_golem", "mossback_sentinel", "forest_viper"].includes(species));
const preset = species === "forest_viper" ? "thornline_adders" : `species:${species}`;
const attempt = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.resolve(`test-results/moving-hit-overlay/${species}-${attempt}`);
await mkdir(out, { recursive: true });
const report: any = { species, status: "incomplete", commands: [], captures: [], errors: [], samples: [], visualAccepted: false,
  scope: "Public production lab; real spell damage adds upper-body Hit while base Run and pursuit continue. Setup equipment and levels only; no health, clip, time, or position overrides. Leg-track masking is a separate CPU contract." };
const browser = await chromium.launch({ headless: true, args: GAMEPLAY_HARDWARE_ARGS });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: path.join(out, "video") } });
const page = await context.newPage();
await page.addInitScript("window.__name = (value) => value;");
page.setDefaultTimeout(4_000);
page.on("pageerror", e => report.errors.push(e.message));
const deadline = setTimeout(() => { report.errors.push("60 second run budget exhausted"); void browser.close(); }, 60_000);
async function call(surface: string, method: string, args: any[] = []) {
  const result = await page.evaluate(async ({ surface, method, args }) => (window as any)[surface][method](...args), { surface, method, args });
  assert(!result?.error && result?.ok !== false && !result?.isError, JSON.stringify(result));
  report.commands.push({ surface, method, args, result });
  return result;
}
async function capture(name: string) {
  const before = await page.evaluate(() => (window as any).__hitProof.samples.at(-1));
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 4_000 });
  const after = await page.evaluate(() => (window as any).__hitProof.samples.at(-1));
  report.captures.push({ name, before, after });
}
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);
try {
  await page.goto(`${process.env.COREALM_URL ?? "http://127.0.0.1:4175"}/index.html?mode=combat`, { timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__featureLab?.getState()?.ready === true, null, { timeout: 20_000 });
  report.renderer = await assertGameplayHardware(page);
  await call("__featureLab", "setWalkingEnabled", [true]);
  await call("__featureLab", "setLevel", ["magic", 1]);
  await call("__featureLab", "equipPlayer", ["mainHand", "air_staff"]);
  await call("__featureLab", "setSpell", ["voltrend"]);
  await call("__featureLab", "spawnTarget", ["creature", preset, { distance: species === "forest_viper" ? 10 : 12 }]);
  const setup = await call("__featureLab", "getState");
  const entityId = setup.target.entityId;
  report.setup = setup;
  await page.evaluate(entityId => {
    const w = window as any;
    const proof: any = w.__hitProof = { samples: [], active: true };
    const sample = () => {
      if (!proof.active) return;
      const state = w.__featureLab.getState();
      const entity = w.__gameDebug.getEntity(entityId);
      proof.samples.push({ t: performance.now(), sim: w.__gameDebug.getState().clock, player: state.playerPosition, movement: state.movement,
        position: entity.position, health: entity.combat.health, ai: state.target.ai,
        motion: w.__gameDebug.getEntityMotion(entityId), playerMotion: w.__gameDebug.getPlayerMotion() });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, entityId);
  await capture("before-cast");
  await call("__featureLab", "perform", ["cast"]);
  // The normal spell command stays active while walking inside spell range. A live projectile
  // damages the pursuing target; no artificial hit or animation command is used.
  await page.waitForFunction(() => (window as any).__hitProof.samples.some((s: any) => s.ai?.state === "pursuing" || s.ai?.state === "chasing" || s.health < (window as any).__hitProof.samples[0].health), null, { timeout: 12_000 });
  const start = await call("__featureLab", "getState");
  const p = start.playerPosition, e = start.target.position;
  const dx = p[0] - e[0], dz = p[2] - e[2], norm = Math.hypot(dx, dz);
  await call("__gameDebug", "callTool", ["corealm_move_to", { position: [p[0] + dx / norm * 18, p[1], p[2] + dz / norm * 18] }]);
  await capture("opening-hit-and-retreat");
  await page.waitForFunction(() => {
    const s = (window as any).__hitProof.samples.at(-1);
    return s.motion.motion === "run" && s.ai?.state === "aggro";
  }, null, { timeout: 12_000 });
  await capture("pursuit-before-hit");
  await page.waitForFunction(() => {
    const s = (window as any).__hitProof.samples;
    return s.some((v: any, i: number) => i > 2 && v.motion?.hitOverlay?.active && v.health < s[i - 1].health
      && Math.hypot(s[i - 1].position[0] - s[Math.max(0, i - 8)].position[0], s[i - 1].position[2] - s[Math.max(0, i - 8)].position[2]) > .02);
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(250);
  await capture("hit-midphase");
  await call("__gameDebug", "callTool", ["corealm_stop", {}]);
  await call("__featureLab", "perform", ["flee"]);
  await page.waitForFunction(() => {
    const m = (window as any).__hitProof.samples.at(-1).motion;
    return m.motion === "run" && !m.hitOverlay?.active;
  }, null, { timeout: 5_000 });
  await page.waitForTimeout(600);
  await capture("recovered-run");
  await page.waitForTimeout(1_000);
  report.samples = await page.evaluate(() => { (window as any).__hitProof.active = false; return (window as any).__hitProof.samples; });
  report.events = await call("__gameDebug", "getEvents", [0]);
  const s = report.samples;
  const hitIndex = s.findIndex((v: any, i: number) => i > 8 && v.motion?.hitOverlay?.active && v.health < s[i - 1].health && distance(s[i - 1].position, s[i - 8].position) > .02);
  assert(hitIndex >= 0, "Real damage must add Hit while translating");
  const hit: any[] = [];
  for (let i = hitIndex; i < s.length && s[i].motion?.hitOverlay?.active; i++) hit.push(s[i]);
  assert(hit.length >= 3, "Hit requires multiple advancing frames");
  assert(hit.at(-1).motion.hitOverlay.time > hit[0].motion.hitOverlay.time, "Hit overlay must advance");
  assert(hit.some(v => v.motion.hitOverlay.weight > .05), "Hit overlay needs visible positive blend weight");
  assert(hit.every(v => v.motion.hitOverlay.maskStatus === "native-masked" && v.motion.hitOverlay.bones?.length > 0), "Production native upper-body mask must be nonempty");
  assert(hit.every(v => v.motion.motion === "run" && v.motion.clip === s[hitIndex - 1].motion.clip), "Base Run must remain active throughout Hit");
  const travelled = distance(hit[0].position, hit.at(-1).position);
  const overlaySimSeconds = (hit.at(-1).sim.elapsedMs - hit[0].sim.elapsedMs) / 1000;
  assert(overlaySimSeconds >= .3, "Overlay needs at least300ms of simulation movement evidence");
  const overlaySpeed = travelled / overlaySimSeconds;
  assert(Math.abs(overlaySpeed - 4.68) < .12, `Pursuit must continue at4.68 during Hit; observed ${overlaySpeed}`);
  let maxPhaseError = 0;
  for (let i = hitIndex; i < hitIndex + hit.length; i++) {
    const previous = s[i - 1], current = s[i];
    const dt = (current.t - previous.t) / 1000;
    const duration = current.motion.duration;
    const actual = (current.motion.time - previous.motion.time + duration) % duration;
    const expected = dt * current.motion.timeScale;
    const phaseError = Math.abs(actual - expected);
    maxPhaseError = Math.max(maxPhaseError, phaseError);
    assert(phaseError < .09, `Hit reset or froze Run phase: ${phaseError}`);
    const simDt = (current.sim.elapsedMs - previous.sim.elapsedMs) / 1000;
    if (simDt > 0) assert(Math.abs(distance(current.position, previous.position) / simDt - 4.68) < .15, "A Hit tick paused or changed pursuit speed");
    assert(distance(current.motion.drawnPosition, previous.motion.drawnPosition) < 4.68 * dt + .1, "Hit onset must not snap the drawn root");
  }
  assert(s.slice(hitIndex + hit.length).some((v: any) => !v.motion.hitOverlay?.active && v.motion.motion === "run" && distance(v.position, hit.at(-1).position) > .3), "Natural pursuit must continue after overlay ends");
  const rates = (actor: "player" | "position", target: number) => {
    const values: number[] = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i].sim.elapsedMs === s[i - 1].sim.elapsedMs) continue;
      const j = s.findIndex((v: any) => v.sim.elapsedMs >= s[i].sim.elapsedMs + 500);
      if (j <= i) continue;
      const interval = s.slice(i, j + 1);
      const dt = (s[j].sim.elapsedMs - s[i].sim.elapsedMs) / 1000;
      if (actor === "position" && interval.some((v: any) => v.ai?.state !== "aggro" || v.motion?.motion !== "run")) continue;
      if (actor === "player" && interval.some((v: any) => v.movement.mode !== "path")) continue;
      const speed = distance(s[j][actor], s[i][actor]) / dt;
      if (speed > .05) values.push(speed);
    }
    assert(values.length >= 10, `Need sustained observed ${actor} speed near ${target}`);
    values.sort((a, b) => a - b);
    assert(Math.abs(values[Math.floor(values.length / 2)] - target) < .12, `${actor} steady speed must equal ${target}; observed ${values[Math.floor(values.length / 2)]}`);
    return { median: values[Math.floor(values.length / 2)], samples: values.length, expected: target };
  };
  report.measurements = { travelled, overlaySimSeconds, overlaySpeed, maxPhaseError, hitFrames: hit.length, player: rates("player", 5.2), pursuit: rates("position", 4.68) };
  const recovery = s.slice(hitIndex + hit.length, hitIndex + hit.length + 15);
  for (let i = 1; i < recovery.length; i++) {
    const dt = (recovery[i].t - recovery[i - 1].t) / 1000;
    assert(distance(recovery[i].motion.drawnPosition, recovery[i - 1].motion.drawnPosition) <= 4.68 * dt + .08, "Recovery must not catch up with a large rendered jump");
  }
  assert(report.events.events.some((e: any) => e.type === "spell.launched" && e.entityId === entityId), "Real spell event required");
  const midphase = report.captures.find((c: any) => c.name === "hit-midphase");
  assert(midphase.before.motion.hitOverlay?.active && midphase.after.motion.hitOverlay?.active, "Midphase screenshot must be bracketed by live Hit overlay");
  assert(midphase.before.motion.motion === "run" && midphase.after.motion.motion === "run", "Midphase screenshot must also contain base Run");
  assert.equal(report.errors.length, 0);
  report.status = "semantic-passed-awaiting-visual-review";
} catch (error) {
  report.errors.push(String(error));
  try { report.samples = await page.evaluate(() => (window as any).__hitProof?.samples ?? []); } catch {}
  report.status = "failed";
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, out, errors: report.errors, measurements: report.measurements }));
}
