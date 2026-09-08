/**
 * Health bars in a real fight on the production combat lab.
 *
 * Spawns a creature, attacks it with a melee weapon at melee level 1 so the fight lasts, and checks
 * the DOM the renderer writes: one bar over the creature, one over the player, both inside the
 * viewport, the creature's fill matching its health, the creature's bar anchored just above its
 * drawn bounds through the camera the game reports, and every bar gone once the fight is reset
 * and the linger ends. Captures a screenshot mid-fight for inspection; a DOM count is not a picture.
 *
 *   npx tsx tools/health-bars-lab-test.ts [--url http://127.0.0.1:4174] [--headed]
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { CAMERA } from "../game/src/app/config.js";
import type { FeatureLabApi, FeatureLabState } from "../game/src/contracts.js";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import { argValue, repoRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

declare global {
  interface Window { __featureLab?: FeatureLabApi }
}

type Point = { x: number; y: number; z: number };

interface BarReading {
  entityId: string;
  display: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fillPercent: number;
  ghostPercent: number;
  target: boolean;
  dead: boolean;
  valueNow: number | null;
  valueMax: number | null;
  onScreen: boolean;
}

/** Everything read in ONE evaluate, so the camera cannot move between the bars and the bounds. */
interface FrameReading {
  bars: BarReading[];
  camera: { position: Point; target: Point };
  bounds: { min: Point; max: Point } | null;
  canvas: { x: number; y: number; width: number; height: number };
  state: FeatureLabState;
}

async function main(): Promise<void> {
  const clearDeadline = installTestDeadline("Health bars lab gate", 90_000);
  const args = process.argv.slice(2);
  const externalUrl = argValue(args, "--url");
  const server = externalUrl ? { url: externalUrl, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes("--headed"), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === "win32" ? ["--use-angle=d3d11"] : []), "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const output = path.join(repoRoot, "test-results", "health-bars-lab");
  await mkdir(output, { recursive: true });
  const route = "/index.html?mode=combat";
  const report: Record<string, unknown> = { status: "failed", passed: false, url: server.url, route };

  try {
    await driver.launch();
    await driver.open(30_000, route);
    const page = driver.page!;

    // Page-side code stays free of inner named functions: tsx wraps those in a `__name` helper
    // that does not exist once the callback is serialised into the browser.
    const readFrame = (entityId: string | null): Promise<FrameReading> => page.evaluate((id) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const debug = window.__gameDebug as unknown as {
        getCamera(): { position: Point; target: Point };
        getDrawnBounds(entityId: string): { min: Point; max: Point } | null;
      };
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      const bars = [...document.querySelectorAll<HTMLElement>(".hp-bar")].map((element) => {
        const rect = element.getBoundingClientRect();
        const fill = element.querySelector<HTMLElement>(".hp-bar__fill");
        const ghost = element.querySelector<HTMLElement>(".hp-bar__ghost");
        const now = element.getAttribute("aria-valuenow");
        const max = element.getAttribute("aria-valuemax");
        return {
          entityId: element.dataset["entityId"] ?? "",
          display: getComputedStyle(element).display,
          left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          fillPercent: Number.parseFloat(fill?.style.width ?? "0"),
          ghostPercent: Number.parseFloat(ghost?.style.width ?? "0"),
          target: element.classList.contains("is-target"),
          dead: element.classList.contains("is-dead"),
          valueNow: now === null ? null : Number(now), valueMax: max === null ? null : Number(max),
          onScreen: rect.width > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= w && rect.bottom <= h,
        };
      });
      return {
        bars,
        camera: debug.getCamera(),
        bounds: id === null ? null : debug.getDrawnBounds(id),
        canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
        state: window.__featureLab!.getState(),
      };
    }, entityId);

    // Out of combat: nothing drawn.
    const idle = (await readFrame(null)).bars;
    assert.equal(idle.length, 0, `expected no bars before the fight, saw ${JSON.stringify(idle)}`);

    const catalog = await page.evaluate(() => window.__featureLab!.getCatalog());
    const weapon = catalog.equipment.find((group) => group.slot === "mainHand")
      ?.items.find((item) => /sword|blade|axe|mace/i.test(item.label))?.id;
    assert.ok(weapon, "feature lab has no melee weapon");
    // Something with enough health to survive a few swings from a level-1 melee player: the fight
    // has to be observable mid-way, not over in one hit like a hen.
    const preset = catalog.targets.creature.find((candidate) => /brown bear|wild boar|\bcow\b/i.test(candidate.label))
      ?? catalog.targets.creature[0];
    assert.ok(preset, "feature lab has no creature presets");
    report["preset"] = preset.id;
    report["weapon"] = weapon;

    await page.evaluate(async (itemId) => { await window.__featureLab!.equipPlayer("mainHand", itemId); }, weapon);
    await page.evaluate(() => { window.__featureLab!.setLevel("melee", 1); });
    await page.evaluate(async () => { await window.__featureLab!.perform("reset-player"); });
    const spawned: FeatureLabState = await page.evaluate(async (id) => window.__featureLab!.spawnTarget("creature", id, { distance: 6 }), preset.id);
    assert.ok(spawned.target, "spawn produced no target");
    const targetId = spawned.target.entityId;
    const startHealth = spawned.target.health ?? 0;

    await page.evaluate(async () => { await window.__featureLab!.perform("attack"); });

    // Wait for the fight to be visibly under way: both bars present, the creature hurt but alive.
    let frame: FrameReading | null = null;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      frame = await readFrame(targetId);
      const creatureBar = frame.bars.find((bar) => bar.entityId === targetId);
      const playerBar = frame.bars.find((bar) => bar.entityId === "player");
      const health = frame.state.target?.health;
      const hurt = typeof health === "number" && health < startHealth && health > 0;
      if (creatureBar && playerBar && hurt && creatureBar.display !== "none" && creatureBar.fillPercent < 100) break;
      await page.waitForTimeout(120);
    }
    assert.ok(frame, "no frame was read");
    const shot = await driver.screenshot(output, "fight");
    const fight = frame.bars;
    const state = frame.state;
    report["fight"] = { bars: fight, target: state.target, camera: frame.camera, bounds: frame.bounds, screenshot: path.relative(repoRoot, shot) };

    const creatureBar = fight.find((bar) => bar.entityId === targetId);
    const playerBar = fight.find((bar) => bar.entityId === "player");
    assert.ok(creatureBar, `no bar for the creature ${targetId}; bars: ${JSON.stringify(fight)}`);
    assert.ok(playerBar, `no bar for the player; bars: ${JSON.stringify(fight)}`);
    assert.equal(fight.length, 2, `expected exactly two bars, saw ${fight.length}`);
    assert.ok(creatureBar.onScreen, `creature bar off screen: ${JSON.stringify(creatureBar)}`);
    assert.ok(playerBar.onScreen, `player bar off screen: ${JSON.stringify(playerBar)}`);
    const health = state.target?.health;
    const maxHealth = state.target?.maxHealth;
    assert.ok(typeof health === "number" && typeof maxHealth === "number" && health < startHealth, "creature health did not fall");
    assert.ok(health > 0, `the creature died before a mid-fight frame could be read: ${JSON.stringify(state.target)}`);
    assert.ok(creatureBar.target, "creature bar is not marked as the target");
    assert.ok(!creatureBar.dead, "a living creature's bar is marked dead");
    assert.ok(creatureBar.fillPercent < 100, `creature fill never fell: ${JSON.stringify(creatureBar)}`);
    assert.ok(creatureBar.ghostPercent >= creatureBar.fillPercent, "ghost trail sits below the fill");
    assert.equal(creatureBar.valueNow, Math.round(health), "bar value does not match the creature's health");
    assert.equal(creatureBar.valueMax, Math.round(maxHealth), "bar max does not match the creature's max health");
    assert.equal(creatureBar.fillPercent, Number(((health / maxHealth) * 100).toFixed(1)), "fill width is not the health ratio");
    assert.equal(playerBar.valueMax, Math.round(state.player.maxHealth), "player bar max does not match the HUD");
    assert.ok(playerBar.width >= 70, `player bar width ${playerBar.width}`);

    // Placement: project the creature's drawn bounds through the camera the game reports, and
    // require the bar's anchor to sit just above the top of that box, horizontally over it.
    assert.ok(frame.bounds, "the creature has no drawn bounds");
    const camera = new PerspectiveCamera(CAMERA.fov, frame.canvas.width / frame.canvas.height, CAMERA.near, CAMERA.far);
    camera.position.set(frame.camera.position.x, frame.camera.position.y, frame.camera.position.z);
    camera.lookAt(frame.camera.target.x, frame.camera.target.y, frame.camera.target.z);
    camera.updateMatrixWorld(true);
    const canvas = frame.canvas;
    const project = (x: number, y: number, z: number): { x: number; y: number } => {
      const point = new Vector3(x, y, z).project(camera);
      return { x: canvas.x + (point.x + 1) * canvas.width / 2, y: canvas.y + (1 - point.y) * canvas.height / 2 };
    };
    const b = frame.bounds;
    const centreX = (b.min.x + b.max.x) / 2;
    const centreZ = (b.min.z + b.max.z) / 2;
    const crown = project(centreX, b.max.y, centreZ);
    const feet = project(centreX, b.min.y, centreZ);
    const anchorX = creatureBar.left + creatureBar.width / 2;
    const anchorY = creatureBar.top + creatureBar.height;
    report["placement"] = { crown, feet, anchorX, anchorY };
    // The camera snapshot is rounded to millimetres and the creature is moving, so allow a little.
    assert.ok(anchorY < crown.y + 6, `bar anchor ${anchorY} is not above the creature's crown ${crown.y}`);
    assert.ok(anchorY > crown.y - Math.max(40, (feet.y - crown.y) * 0.6), `bar anchor ${anchorY} floats too far above the crown ${crown.y}`);
    assert.ok(Math.abs(anchorX - crown.x) < Math.max(40, creatureBar.width), `bar anchor x ${anchorX} is not over the creature ${crown.x}`);

    // End the fight. The bars linger for a beat, then every one of them goes.
    await page.evaluate(async () => { await window.__featureLab!.perform("reset-player"); });
    const lingering = (await readFrame(null)).bars;
    report["lingering"] = lingering;
    await page.waitForTimeout(2200);
    const after = (await readFrame(null)).bars;
    report["after"] = after;
    assert.equal(after.length, 0, `bars remained after the fight ended: ${JSON.stringify(after)}`);

    const errors = [...driver.pageErrors, ...driver.consoleErrors];
    report["errors"] = errors;
    assert.equal(errors.length, 0, `browser errors: ${errors.join("\n")}`);

    report["status"] = "passed";
    report["passed"] = true;
  } catch (error) {
    report["error"] = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    await driver.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    clearDeadline();
    console.log(JSON.stringify({ status: report["status"], preset: report["preset"], report: path.join("test-results", "health-bars-lab", "report.json") }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
