/** Root-scheduled final-world wiring gate after the seven-kill lab proof.
 * npx tsx runs/corealm-rebuild/checks/finish-hunts-world.ts --url http://127.0.0.1:4175
 * Fresh initial progression offers, one natural pointer-started kill, real browser-storage reload.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { CAMERA, SPELL_RANGE } from "../../../game/src/app/config.js";
import type { GameState } from "../../../game/src/state/store.js";
import type { SemanticEntity, Vec3 } from "../../../game/src/contracts.js";
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
};
const url = arg("--url", "http://127.0.0.1:4175");
const out = arg("--out", "test-results/finish-hunts-world");
mkdirSync(out, { recursive: true });
const report: any = { passed: false,
  scope: "Final-world journal, real registered reachable target and browser localStorage reload. Full seven-kill/reward lifecycle already accepted in production lab.",
  setup: "Fresh browser context at normal initial skills. After proving offer eligibility and world path, debug raises melee/magic to50 and places player24m from one real target for a bounded natural pointer-started kill. No hunt or enemy health/event writes.",
  visualEvidence: "Reduced settings semantic captures, not final creature/terrain art acceptance.", trace: [] };
const started = Date.now();
const deadline = setTimeout(() => {
  report.error = "Final-world hunt gate exceeded115 seconds including cleanup";
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); process.exit(1);
}, 115_000);
const driver = new GameDriver({ url, close: async () => {} }, { headless: true,
  settings: FAST_TEST_SETTINGS, viewport: { width: 1280, height: 720 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
try {
  await driver.launch(); await driver.open(45_000, "/index.html");
  const page = driver.page!; page.setDefaultTimeout(5_000);
  const verifyHardware = async () => {
    const renderer = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && extension ? {
        renderer: String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)),
        vendor: String(gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)),
      } : null;
    });
    assert(renderer, "Actual unmasked WebGL renderer must be available");
    assert(/D3D11|Direct3D11/i.test(renderer.renderer)
      && !/swiftshader|llvmpipe|software|basic render/i.test(renderer.renderer),
    `Hardware D3D11 required; actual renderer: ${renderer.renderer}`);
    return renderer;
  };
  report.renderer = await verifyHardware();
  const read = async (): Promise<GameState> => JSON.parse(await driver.callDebug("getSaveBlob") as string);
  const fresh = await read();
  assert.equal(fresh.skills.melee.level, 1); assert.equal(fresh.skills.magic.level, 1);
  assert(fresh.huntContracts.offers.length > 0, "A new character needs at least one reachable starting hunt");
  assert(fresh.huntContracts.offers.every((offer) => offer.level <= 4 && offer.regionId === fresh.player.regionId));
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  const board = page.getByRole("region", { name: "Hunt contracts" });
  await board.getByRole("button", { name: "Accept hunt", exact: true }).first().click();
  const accepted = await read(); const offer = accepted.huntContracts.active!.offer;
  assert.equal(accepted.huntContracts.active!.kills, 0);
  const enemies = await driver.callDebug("listEntities", [{ archetype: "enemy", regionId: offer.regionId }]) as SemanticEntity[];
  const target = enemies.filter((entity) => entity.state !== "dead" && offer.enemyDefIds.includes(String(entity.meta?.enemyDefId)))
    .sort((a, b) => Math.hypot(a.position[0] - fresh.player.position[0], a.position[2] - fresh.player.position[2])
      - Math.hypot(b.position[0] - fresh.player.position[0], b.position[2] - fresh.player.position[2]))[0];
  assert(target, "Offer must bind a real registered enemy");
  const path = await driver.callDebug("getNavPath", [fresh.player.position, target.position]);
  assert(Array.isArray(path) && path.length > 0, "Initial player must have a nav path to the offered target");
  report.trace.push({ stage: "initial offer accepted", player: fresh.player, offer, targetId: target.id, path });
  await driver.screenshot(out, "01-world-offer");
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  await driver.callDebug("setSkillLevel", ["melee", 50]);
  await driver.callDebug("setSkillLevel", ["magic", 50]);
  // Production spells all use this shared15m reach; nine metres gives the approach a visible walk.
  const approachDistance = SPELL_RANGE + 9;
  report.combatSetup = { spellRange: SPELL_RANGE, approachMargin: 9, approachDistance };
  const approach: Vec3 = [target.position[0] + approachDistance, target.position[1], target.position[2]];
  assert(await driver.callDebug("teleport", [approach]));
  await driver.callDebug("inspectPose", [{ x: target.position[0], y: target.position[1] + .6,
    z: target.position[2], yaw: 0, pitch: .7, distance: 10, detached: true }]);
  await page.waitForFunction(id => (window as any).__gameDebug.getDrawnBounds(id)?.meshes > 0,
    target.id, { timeout: 10_000 });
  const b: any = await driver.callDebug("getDrawnBounds", [target.id]);
  const c: any = await driver.callDebug("getCamera");
  const camera = new PerspectiveCamera(CAMERA.fov, 1280 / 720, .1, 1500);
  camera.position.set(c.position.x, c.position.y, c.position.z); camera.lookAt(c.target.x, c.target.y, c.target.z); camera.updateMatrixWorld();
  const corners = [b.min.x, b.max.x].flatMap(x => [b.min.y, b.max.y].flatMap(y => [b.min.z, b.max.z].map(z => new Vector3(x, y, z).project(camera))));
  const rect = { left: Math.min(...corners.map(p => (p.x * .5 + .5) * 1280)), right: Math.max(...corners.map(p => (p.x * .5 + .5) * 1280)),
    top: Math.min(...corners.map(p => (-p.y * .5 + .5) * 720)), bottom: Math.max(...corners.map(p => (-p.y * .5 + .5) * 720)) };
  let clicked = false;
  for (const fy of [.5, .7, .3]) {
    for (const fx of [.5, .3, .7]) {
      const x = rect.left + (rect.right - rect.left) * fx, y = rect.top + (rect.bottom - rect.top) * fy;
      if (x < 0 || x > 1280 || y < 0 || y > 720) continue;
      await page.mouse.move(x, y);
      try { await page.waitForFunction(id => (window as any).__gameDebug.getState().hoveredEntityId === id,
        target.id, { timeout: 300 }); } catch { continue; }
      await page.mouse.click(x, y); clicked = true;
      report.trace.push({ stage: "production pointer attack", id: target.id, x, y }); break;
    }
    if (clicked) break;
  }
  assert(clicked, "The real target must be pointer reachable");
  await page.waitForFunction(() => JSON.parse((window as any).__gameDebug.getSaveBlob()).huntContracts.active?.kills === 1,
    undefined, { timeout: 10_000 });
  const progressed = await read();
  assert.equal(progressed.world.enemies[target.id]!.state, "dead");
  assert.equal(progressed.huntContracts.killSerial, 1);
  assert(Math.hypot(progressed.player.position[0] - approach[0], progressed.player.position[2] - approach[2]) > 1,
    "Pointer attack must walk from the twenty-four-metre approach before killing");
  assert.equal(progressed.huntContracts.active!.status, "active");
  assert.equal(progressed.huntContracts.completedCount, 0);
  await driver.callDebug("saveNow");
  const stored = await page.evaluate(() => localStorage.getItem("corealm.save.v1"));
  assert(stored, "Production saveNow must write browser localStorage");
  assert.deepEqual(JSON.parse(stored).huntContracts, progressed.huntContracts);
  report.trace.push({ stage: "real world kill stored", hunt: progressed.huntContracts, targetRuntime: progressed.world.enemies[target.id] });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 5_000 });
  await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined, { timeout: 45_000 });
  report.reloadedRenderer = await verifyHardware();
  const reloaded = await read();
  assert.deepEqual(reloaded.huntContracts, progressed.huntContracts);
  assert.equal(reloaded.skills.melee.xp, progressed.skills.melee.xp);
  await page.getByRole("button", { name: "Quests, key J", exact: true }).click();
  await board.getByText(`1 / ${offer.requiredKills} defeated`, { exact: true }).waitFor();
  assert.equal(await board.getByRole("button", { name: "Claim XP", exact: true }).count(), 0);
  await driver.screenshot(out, "02-world-reloaded-progress");
  report.trace.push({ stage: "browser reload restored progress without duplicate credit", hunt: reloaded.huntContracts });
  assert.deepEqual(await driver.callDebug("getErrors"), []);
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  report.expectedReloadAborts = driver.requestErrors.filter((error) => error.includes("net::ERR_ABORTED"));
  assert.deepEqual(driver.requestErrors.filter((error) => !error.includes("net::ERR_ABORTED")), []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  try { report.failureState = await driver.callDebug("getState"); report.failurePlayer = await driver.callDebug("getPlayer"); report.failureEvents = await driver.callDebug("getEvents"); } catch {}
  try { await driver.screenshot(out, "failure"); } catch {}
  process.exitCode = 1;
} finally {
  await driver.close(); clearTimeout(deadline); report.elapsedMs = Date.now() - started;
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}





