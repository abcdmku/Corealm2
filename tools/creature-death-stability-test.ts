import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { resolveEnemyDef } from "../game/src/systems/combat.js";
import { content } from "../game/src/content/index.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from "../game/src/featureLab/catalog.js";
import { createAuthoredWorld } from "../game/src/multiplayer/authoredWorld.js";
import { createInitialState } from "../game/src/state/store.js";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA } from "../game/src/app/config.js";

const profile = process.argv.includes("--profile");
const diagnostic = process.argv.includes("--diagnostic");
const authored = process.argv.includes("--authored");
const frog = process.argv.includes("--frog");
const out = `test-results/creature-death-stability${authored ? "-authored" : frog ? "-frog" : "-rat"}`;
await mkdir(out, { recursive: true });
const started = Date.now(), clearDeadline = installTestDeadline("creature death stability", authored ? 120_000 : 60_000);
const descriptor: WorldDescriptor = {
  providerId: "reference", worldId: "death-stability", name: "Creature death yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: authored ? "authored" : "lab",
  seed: 1337, capacity: 1000, population: 0, availability: "available",
};
const host = await startReferenceServer({ worlds: [descriptor], storage: new SqliteWorldStorage(":memory:"),
  authentication: { authenticate: async token => ({ playerId: token.replace("guest:", ""), name: token.replace("guest:", "") }) },
  build: async () => {
    if (authored) return createAuthoredWorld(1337);
    const ports = await createMultiplayerLabWorld();
    content.register({ enemies: ENEMIES });
    const index = ports.entities.findIndex(entity => entity.id === "multiplayer:frog");
    if (!frog) ports.entities[index] = createFeatureLabEntity(FEATURE_LAB_CATALOG.targets.creature.find(preset => preset.id === "species:granary_rat")!,
      { entityId: "multiplayer:frog", groundPosition: [12, 0, 0], baseY: 0 });
    const enemy = ports.entities[index]!;
    const def = resolveEnemyDef(enemy);
    enemy.meta = { ...enemy.meta, enemyId: "death_fixture" };
    ports.enemies = [{ ...def, id: "death_fixture", lootRolls: [{ id: "items", name: "Items", count: 1, drops: [{ itemId: "grithe_ore", chance: 1, quantity: [1, 1] }] }], gold: [0, 0] }];
    return ports;
  },
});
const game = await startGameServer();
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const errors: string[] = [], checks: Record<string, boolean> = {}, pages: Page[] = [];
const check = (name: string, value: boolean) => { checks[name] = value; if (!value && !diagnostic) throw new Error(name); };
type Frame = { at: number; gap: number; completed: number; completedAt: number; pendingMs: number; failed: boolean };
type Trace = { frames: Frame[]; tasks: { at: number; duration: number }[]; gl: { at: number; method: string; duration: number }[] };
const evidence: unknown[] = [];
try {
  await Promise.all(["killer", "observer"].map(async (name, index) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript("window.__name = value => value;");
    await context.addInitScript(({ world, profile, save }) => {
      window.__COREALM_MULTIPLAYER__ = world;
      window.__COREALM_DEVELOPMENT_GUESTS__ = true;
      if (save) localStorage.setItem("corealm.save.v1", JSON.stringify(save));
      localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: .7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 }));
      const trace: Trace = { frames: [], tasks: [], gl: [] };
      Reflect.set(window, "__deathTrace", trace);
      let previous = performance.now();
      const frame = (at: number) => {
        const debug = window.__gameDebug as unknown as { getPresentationState?: () => { completed: number; completedAt: number; pendingMs: number; failed: boolean } };
        const state = debug?.getPresentationState?.();
        if (state) trace.frames.push({ at, gap: at - previous, completed: state.completed, completedAt: state.completedAt, pendingMs: state.pendingMs, failed: state.failed });
        previous = at;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) trace.tasks.push({ at: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask" });
      if (profile) for (const method of ["getProgramParameter", "getShaderParameter", "getUniformLocation", "getAttribLocation", "getShaderInfoLog", "getProgramInfoLog", "bufferData", "texImage2D", "drawElements", "drawArrays", "drawElementsInstanced"]) {
        const proto = WebGL2RenderingContext.prototype, original = Reflect.get(proto, method) as (...args: unknown[]) => unknown;
        Reflect.set(proto, method, function (this: WebGL2RenderingContext, ...args: unknown[]) {
          const at = performance.now();
          try { return original.apply(this, args); }
          finally { const duration = performance.now() - at; if (duration > 3) trace.gl.push({ at, method, duration }); }
        });
      }
    }, { world: { ...descriptor, endpoint: `ws://127.0.0.1:${host.port}/` }, profile, save: authored ? createInitialState(1337, 0) : null });
    const page = await context.newPage(); pages[index] = page; page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${game.url}/index.html${authored ? "" : "?mode=combat&multiplayer=1"}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__multiplayerLab, null, { timeout: authored ? 60_000 : 25_000 });
    if (!await page.locator("#multiplayer-selector").isVisible()) await page.getByRole("button", { name: "Worlds", exact: true }).click();
    await page.getByRole("textbox", { name: "Development guest name" }).fill(name);
    await page.locator(".worlds__row--world input").first().check();
    await page.getByRole("button", { name: "Join world", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected");
    if (!authored) await page.getByRole("button", { name: "Close Feature lab", exact: true }).click();
  }));
  const [killer, observer] = pages as [Page, Page];
  const runtime = [...host.worlds.values()][0]!.runtime;
  const player = runtime.players.get("killer")!, other = runtime.players.get("observer")!;
  const distanceFromSpawn = (position: readonly number[]) => Math.hypot(position[0]! - runtime.ports.spawn[0], position[2]! - runtime.ports.spawn[2]);
  const enemy = authored ? runtime.entities.all().filter(entity => entity.name === "Granary Rat")
    .sort((a, b) => distanceFromSpawn(a.position) - distanceFromSpawn(b.position))[0]! : runtime.entities.get("multiplayer:frog")!;
  if (!enemy) throw new Error("No authored Granary Rat near spawn");
  const x = enemy.position[0], z = enemy.position[2];
  const at = (offset: number): [number, number, number] => [x + offset, runtime.ports.movement.heightAt?.(enemy.regionId, x + offset, z) ?? 0, z];
  player.store.get().player.position = at(-1.2);
  other.store.get().player.position = at(2);
  player.store.get().player.regionId = other.store.get().player.regionId = enemy.regionId;
  player.store.get().skills.melee.level = 99;
  player.store.get().equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
  player.random.get("combat").setState(0);
  player.random.get("loot").setState(0);
  player.combat.runtimeFor(player.store.get(), enemy).health = 1;
  // Let the deterministic setup arrive before measuring the actual attack.
  await killer.waitForFunction(x => Math.abs((window.__multiplayerLab!.observe() as { player: { position: number[] } }).player.position[0]! - x) < 1, x - 1.2);
  for (const page of pages) await page.waitForFunction(id => {
    const debug = window.__gameDebug as unknown as { getEntityMotion(id: string): { path: string } | null };
    return debug.getEntityMotion(id)?.path === "live-rig";
  }, enemy.id);
  if (authored) for (const page of pages) {
    // The nearest rat lives under a canopy. Use normal orbit and zoom input to see below it.
    await page.mouse.move(640, 400); await page.mouse.down({ button: "middle" });
    await page.mouse.move(900, 480, { steps: 8 }); await page.mouse.up({ button: "middle" });
    for (let step = 0; step < 25; step++) await page.mouse.wheel(0, -100);
  }
  await killer.waitForTimeout(1200);
  const profilers = profile ? await Promise.all(pages.map(async page => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); return cdp;
  })) : [];
  const before = await Promise.all(pages.map(page => page.evaluate(() => ({ at: performance.now(), state: window.__multiplayerLab!.observe() }))));
  const xpBefore = player.store.get().skills.melee.xp;
  if (authored) {
    // Project through the unmodified gameplay camera, then use the shipped context menu.
    const shot = await killer.evaluate(id => {
      const debug = window.__gameDebug as unknown as { getCamera(): { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }; getDrawnBounds(id: string): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } };
      return { camera: debug.getCamera(), bounds: debug.getDrawnBounds(id) };
    }, enemy.id);
    const camera = new PerspectiveCamera(CAMERA.fov, 1280 / 800, CAMERA.near, CAMERA.far);
    camera.position.set(shot.camera.position.x, shot.camera.position.y, shot.camera.position.z);
    camera.lookAt(shot.camera.target.x, shot.camera.target.y, shot.camera.target.z); camera.updateMatrixWorld(true);
    const { min, max } = shot.bounds;
    let found = false;
    for (const fy of [.35, .6, .2]) {
      for (const fx of [.5, .3, .7]) {
        for (const fz of [.5, .3, .7]) {
          const point = new Vector3(min.x + (max.x - min.x) * fx, min.y + (max.y - min.y) * fy, min.z + (max.z - min.z) * fz).project(camera);
          await killer.mouse.click((point.x + 1) * 640, (1 - point.y) * 400, { button: "right" });
          if (await killer.getByRole("menuitem", { name: /^Attack/ }).isVisible()) { found = true; break; }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (!found) throw new Error(`Rat context menu unavailable: ${JSON.stringify(shot)}`);
    await killer.getByRole("menuitem", { name: /^Attack/ }).click();
  } else await killer.getByRole("button", { name: "Attack fixture frog", exact: true }).click();
  for (const page of pages) await page.waitForFunction(id => {
    const state = window.__multiplayerLab!.observe() as { entities: { id: string; state: string }[] };
    return state.entities.some(entity => entity.id === id && entity.state === "dead");
  }, enemy.id);
  await observer.mouse.click(640, 600);
  await observer.keyboard.down("w");
  await observer.waitForTimeout(6000);
  await observer.keyboard.up("w");
  const after = await Promise.all(pages.map(page => page.evaluate(() => ({ at: performance.now(), state: window.__multiplayerLab!.observe(), trace: Reflect.get(window, "__deathTrace") as Trace }))));
  for (let i = 0; i < pages.length; i++) {
    if (profilers[i]) { const { profile: cpu } = await profilers[i]!.send("Profiler.stop"); await writeFile(`${out}/${i}.cpuprofile`, JSON.stringify(cpu)); }
    const result = after[i]!, start = before[i]!.at;
    const frames = result.trace.frames.filter(row => row.at >= start && row.at <= result.at);
    const completions = frames.filter((row, index) => index === 0 || row.completed !== frames[index - 1]!.completed);
    const maxRafMs = Math.max(0, ...frames.map(row => row.gap));
    const maxPendingMs = Math.max(0, ...frames.map(row => row.pendingMs));
    const maxCompletionMs = Math.max(0, ...completions.slice(1).map((row, index) => row.completedAt - completions[index]!.completedAt));
    evidence.push({ player: i, creature: { id: enemy.id, name: enemy.name, assetId: enemy.view?.assetId, distanceFromSpawn: distanceFromSpawn(enemy.position) }, before: before[i]!.state, after: result.state, maxRafMs, maxPendingMs, maxCompletionMs,
      frames, tasks: result.trace.tasks.filter(row => row.at >= start), gl: result.trace.gl.filter(row => row.at >= start) });
    check(`player${i}KeepsRendering`, frames.length > 30 && completions.length > 10 && !frames.some(row => row.failed));
    check(`player${i}NoFrameStall`, maxRafMs < 150 && maxPendingMs < 150 && maxCompletionMs < 150);
  }
  check("killAwardsXp", player.store.get().skills.melee.xp > xpBefore);
  check("lootCreated", Object.keys(runtime.shared.lootPiles).length === 1);
  const stateBefore = before[1]!.state as { player: { position: number[] }; tick: number };
  const stateAfter = after[1]!.state as typeof stateBefore;
  check("movementContinues", Math.hypot(...stateAfter.player.position.map((v, i) => v - stateBefore.player.position[i]!)) > 3);
  check("worldKeepsTicking", stateAfter.tick - stateBefore.tick > 30);
  check("noRuntimeErrors", errors.length === 0);
  for (let i = 0; i < pages.length; i++) await pages[i]!.screenshot({ path: `${out}/${i}.png`, timeout: 5000 });
  check("withinBudget", Date.now() - started < (authored ? 120_000 : 60_000));
} catch (error) {
  for (let i = 0; i < pages.length; i++) await pages[i]!.screenshot({ path: `${out}/failure-${i}.png`, timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  const report = { passed: Object.values(checks).every(Boolean) && checks.noRuntimeErrors === true, diagnostic, checks, errors, evidence, durationMs: Date.now() - started };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidence: evidence.map(row => {
    const { player, maxRafMs, maxPendingMs, maxCompletionMs, tasks, gl } = row as Record<string, unknown>;
    return { player, maxRafMs, maxPendingMs, maxCompletionMs, tasks, gl };
  }) }));
  await browser.close(); await game.close(); await host.close(); clearDeadline();
}
