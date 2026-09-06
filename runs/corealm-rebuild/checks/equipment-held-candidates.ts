/** Native grip comparison with production equip/save import and a real tree click. GPU slot required. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installAssetCandidates } from "../../../tools/lib/assetCandidates.js";
const out = "test-results/equipment-held-candidates";
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175", close: async () => {} }, { headless: true, viewport: { width: 1440, height: 900 }, browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const report: any = { passed: false, visualAccepted: false, cases: [], setup: "Lab-granted skills/inventory and debug camera; save import verifies the production serialization path, not lab autosave." };
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, "art/rebuild/candidates/2026-09-06/equipment-held-r3/held-catalogue.json");
  for (const body of ["male", "female"]) {
    await driver.open(25_000, `/index.html?mode=combat&forest=1&body=${body}`);
    await page.evaluate(async () => { const lab = (window as any).__featureLab; await lab.equipPlayer("offHand", null); await lab.equipPlayer("mainHand", "grithe_sword"); });
    await driver.wait(400);
    const before = await driver.callDebug("getPlayer") as any;
    const equipmentBefore = await driver.callDebug("callTool", ["corealm_inventory", {}]);
    const saved = await driver.callDebug("getSaveBlob") as string;
    await driver.callDebug("loadSaveBlob", [saved]);
    await driver.wait(400);
    const restored = JSON.parse(await driver.callDebug("getSaveBlob") as string);
    assert.deepEqual(restored.equipment, JSON.parse(saved).equipment);
    const after = await driver.callDebug("getPlayer") as any;
    const equipmentAfter = await driver.callDebug("callTool", ["corealm_inventory", {}]);
    assert.equal(after.maxHealth, before.maxHealth);
    assert.deepEqual(equipmentAfter, equipmentBefore);
    await driver.callDebug("inspectPose", [{ x: after.position.x, y: after.position.y + 1,
      z: after.position.z, yaw: after.facingRad + 0.35, pitch: 0.1, distance: 3.2, detached: true }]);
    await driver.wait(150); await driver.screenshot(out, `${body}-sword-restored`);
    const fixture = JSON.parse(saved);
    // The shared combat lab may fill the pack before its forest tool grant; create this
    // explicitly declared tool fixture instead of assuming that a full-pack grant succeeded.
    fixture.inventory.slots = fixture.inventory.slots.map(() => null);
    fixture.inventory.slots[0] = { itemId: "grithe_hatchet", quantity: 1 };
    assert(fixture.inventory.slots.some((slot: any) => slot?.itemId === "grithe_hatchet"), "Fixture must carry the actual hatchet");
    await driver.callDebug("loadSaveBlob", [JSON.stringify(fixture)]);
    await driver.callDebug("inspectPose", [{ x: 22, y: 0, z: 12, yaw: 0.5, pitch: 0.45, distance: 16 }]);
    await driver.wait(350);
    await driver.moveMouse(485, 528);
    await page.waitForFunction(() => (window as any).__gameDebug.getState().hoveredEntityId === "feature-lab:forest:oak:4", undefined, { timeout: 3000 });
    const start = await driver.callDebug("getEvents", [0]) as any;
    await driver.click(485, 528);
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayer().activityKind === "gathering", undefined, { timeout: 10_000 });
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === "equip-mainHand-axe", undefined, { timeout: 5000 });
    const gatheringPlayer = await driver.callDebug("getPlayer") as any;
    await driver.callDebug("inspectPose", [{ x: gatheringPlayer.position.x, y: gatheringPlayer.position.y + 1.05,
      z: gatheringPlayer.position.z, yaw: gatheringPlayer.facingRad + 1.2,
      pitch: 0.1, distance: 3.2, detached: true }]);
    await driver.wait(200);
    await driver.screenshot(out, `${body}-axe-gathering`);
    const activity = await driver.callDebug("getPlayer"), motion = await driver.callDebug("getPlayerMotion");
    assert.equal((activity as any).activityKind, "gathering", "Close camera must preserve actual gathering");
    const events = await driver.callDebug("getEvents", [start.nextSeq]);
    report.cases.push({ body, before, after, equipmentBefore, equipmentAfter, equipment: restored.equipment, activity, motion, events });
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []); report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  try {
    report.failureState = JSON.parse(await driver.callDebug("getSaveBlob") as string);
    report.failureMotion = await driver.callDebug("getPlayerMotion");
    report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
    await driver.screenshot(out, "failure-state");
  } catch { /* Preserve the initial failure if the browser itself is unavailable. */ }
}
finally { await driver.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, cases: report.cases.length, out })); }
