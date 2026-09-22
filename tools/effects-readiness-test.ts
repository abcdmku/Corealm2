import "./lib/repoContent.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { preview } from "vite";
import { gameRoot, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

/**
 * Spell pools must be ready before play, including the first cast after joining a saved local world.
 *
 *   tsx tools/effects-readiness-test.ts            the dev server
 *   tsx tools/effects-readiness-test.ts --dist     the production build in game/dist
 *   tsx tools/effects-readiness-test.ts --url http://127.0.0.1:4180 --channel chrome
 *
 * The first visit sets a character up beside a creature and stores it. The second visit uses a new page in the same
 * profile, with the GPU shader disk cache disabled, and casts as soon as the world is joined. Effects must already be
 * ready, `boot.effects.ready` must have ended before first playable, and both casts must draw real particles.
 * The first cast retains the 250 ms frame-gap budget. --url reuses an existing server without starting or closing one;
 * otherwise ports are 4350 and 4351, or `COREALM_TEST_PORT`.
 */
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
};
const dist = args.includes("--dist"), suppliedUrl = option("--url"), channel = option("--channel");
const out = path.join(repoRoot, "test-results/effects-readiness"); await mkdir(out, { recursive: true });
const clearDeadline = installTestDeadline("effects readiness", 420_000);
const PORT = Number(process.env.COREALM_TEST_PORT) || (dist ? 4351 : 4350);
const server = suppliedUrl ? { url: suppliedUrl, close: async () => {} } : dist
  ? await preview({ root: gameRoot, logLevel: "error", preview: { host: "127.0.0.1", port: PORT, strictPort: true } }).then(running => ({ url: `http://127.0.0.1:${PORT}`, close: () => running.close() }))
  : await startGameServer({ port: PORT, strictPort: true });
const localUrl = new URL(server.url); localUrl.searchParams.set("play", "local");
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}), args: ["--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--disable-gpu-shader-disk-cache",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] });
const errors: string[] = [], checks: Record<string, boolean> = {}, notes: Record<string, unknown> = {};
const watch = (page: Page): void => {
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error" && !/favicon|AudioContext/.test(message.text())) errors.push(message.text()); });
};
const joined = (page: Page): Promise<unknown> => page.waitForFunction(() => window.__gameDebug?.getState().ready === true
  && (window.__corealmLocalWorker?.observe() as { tick: number | null } | undefined)?.tick != null, null, { timeout: 180_000, polling: 50 });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  // ---- 1. A caster standing beside something to cast at, stored by the local world.
  const setup = await context.newPage(); watch(setup);
  await setup.goto(localUrl.href); await joined(setup);
  const target = await setup.evaluate(async () => {
    const debug = window.__gameDebug as any;
    await debug.seedMagic(70, 500);
    const enemies = (await debug.findEntities({ archetype: "enemy" }) as { id: string; state: string; position: any }[])
      .map(e => ({ id: e.id, state: e.state, position: (Array.isArray(e.position) ? e.position : [e.position.x, e.position.y, e.position.z]) as [number, number, number] }));
    const player = debug.getPlayerPosition();
    const alive = enemies.filter(e => e.state === "alive").sort((a, b) => Math.hypot(a.position[0] - player.x, a.position[2] - player.z) - Math.hypot(b.position[0] - player.x, b.position[2] - player.z))[0]!;
    const [x, y, z] = alive.position;
    await debug.teleport([x + 5, y, z + 5]);
    await debug.setHealth(9999); await debug.saveNow();
    return alive.id;
  });
  notes.target = target;
  await setup.close();

  // ---- 2. A fresh page: cast as soon as the world is joined, and watch every frame around it.
  const page = await context.newPage(); watch(page);
  // A string, because tsx wraps named functions in a helper the page does not have.
  await page.addInitScript(`(() => { const frames = []; let last = performance.now();
    requestAnimationFrame(function step(now) { frames.push(now - last); last = now; requestAnimationFrame(step); });
    window.__frameGaps = { frames, reset() { frames.length = 0; last = performance.now(); } }; })()`);
  await page.goto(localUrl.href); await joined(page);
  const cast = await page.evaluate(async (entityId) => {
    const debug = window.__gameDebug as any, lab = (window as any).__renderDistanceLab, gaps = (window as any).__frameGaps;
    const readyAtCast = lab.shaders()?.effectsReady as boolean;
    const playableMs = (window as any).__corealmBootTelemetry.snapshot().marks.find((m: any) => m.name === "boot.playable").atMs as number;
    gaps.reset();
    const started = performance.now();
    const result = await debug.callTool("corealm_attack", { entityId, spellId: "skirlbolt" });
    let firstParticlesMs: number | null = null, peakParticles = 0;
    while (performance.now() - started < 12_000) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      peakParticles = Math.max(peakParticles, debug.getMetrics().spellParticles);
      if (firstParticlesMs === null && peakParticles > 0) firstParticlesMs = performance.now() - started;
      if (firstParticlesMs !== null && performance.now() - started > 3000) break;
    }
    const maxGapMs = Math.max(...gaps.frames);
    const span = (window as any).__corealmBootTelemetry.snapshot().spans.find((s: any) => s.name === "boot.effects.ready");
    return { readyAtCast, playableMs, castAtMs: started, result, firstParticlesMs, peakParticles, maxGapMs, frames: gaps.frames.length,
      effectsReadySpan: span ? { endMs: span.endMs, outcome: span.outcome, detail: span.detail } : null };
  }, target);
  notes.cast = cast;
  checks.castAccepted = !(cast.result as { error?: string })?.error;
  checks.effectsReadyAtFirstCast = cast.readyAtCast === true;
  checks.noFrameStall = cast.frames > 0 && cast.maxGapMs <= 250;
  checks.effectsReadyBeforePlayable = cast.effectsReadySpan?.outcome === "ok" && cast.effectsReadySpan.endMs <= cast.playableMs;
  checks.firstCastDrawsParticles = cast.firstParticlesMs !== null && cast.peakParticles > 0;
  // ---- 3. A later cast must still draw the real effect.
  const later = await page.evaluate(async () => {
    const debug = window.__gameDebug as any;
    await debug.callTool("corealm_stop", {});
    // The first target may be dead by now. Any living creature nearby will do.
    const player = debug.getPlayerPosition();
    const enemies = (await debug.findEntities({ archetype: "enemy" }) as { id: string; state: string; position: any }[]).filter(e => e.state === "alive")
      .map(e => ({ id: e.id, position: (Array.isArray(e.position) ? e.position : [e.position.x, e.position.y, e.position.z]) as [number, number, number] }))
      .sort((a, b) => Math.hypot(a.position[0] - player.x, a.position[2] - player.z) - Math.hypot(b.position[0] - player.x, b.position[2] - player.z));
    const next = enemies[0]!;
    await debug.teleport([next.position[0] + 4, next.position[1], next.position[2] + 4]); await debug.setHealth(9999);
    const result = await debug.callTool("corealm_attack", { entityId: next.id, spellId: "skirlbolt" });
    const started = performance.now(); let particles = 0;
    while (performance.now() - started < 15_000 && particles === 0) { await new Promise(resolve => requestAnimationFrame(resolve)); particles = debug.getMetrics().spellParticles; }
    await debug.callTool("corealm_stop", {});
    return { target: next.id, result, particles, afterMs: Math.round(performance.now() - started) };
  });
  notes.later = later;
  checks.laterCastAccepted = !(later.result as { error?: string })?.error;
  checks.laterCastDrawsParticles = later.particles > 0;
  await page.screenshot({ path: path.join(out, dist ? "cast-dist.png" : "cast.png"), timeout: 10_000 }).catch(() => {});
  await context.close();
} catch (error) {
  errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error));
} finally {
  await browser.close(); await server.close(); clearDeadline();
}
const passed = errors.length === 0 && Object.keys(checks).length === 7 && Object.values(checks).every(Boolean);
const report = { passed, mode: suppliedUrl ? "existing-server" : dist ? "dist" : "dev", url: server.url,
  channel: channel ?? "chromium", checks, notes, errors };
await writeFile(path.join(out, dist ? "report-dist.json" : "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(passed ? 0 : 1);
