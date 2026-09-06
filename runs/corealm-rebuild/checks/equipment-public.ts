/** Accepted public assets, normal equip/save paths and real gathering; no candidate interception. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";
const out = "test-results/equipment-public";
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline("Public equipment review", 80_000);
const report: any = { passed: false, visualAccepted: false, swords: [], gathering: [],
  setup: "Lab-granted skill and equip inventory; one explicit hatchet in cleared gather fixture. Public manifest/models, no route aliases. Production save import, not autosave." };
try {
  await driver.launch(); const page = driver.page!;
  for (const body of ["male", "female"]) {
    await driver.open(25_000, `/index.html?mode=combat&forest=1&body=${body}`);
    report.renderer = await verifyEquipmentHardware(page);
    await page.evaluate(async () => (window as any).__featureLab.equipPlayer("offHand", null));
    let saved = "";
    for (const [index, tier] of ["grithe", "corven", "kaldite", "emberite"].entries()) {
      const itemId = `${tier}_sword`, assetId = `corealm_sword_${index + 1}`;
      await page.evaluate(async id => (window as any).__featureLab.equipPlayer("mainHand", id), itemId);
      await page.waitForFunction(id => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === `equip-mainHand-${id}`, assetId, { timeout: 5000 });
      const before = await driver.callDebug("getPlayer") as any;
      const inventoryBefore = await driver.callDebug("callTool", ["corealm_inventory", {}]);
      saved = await driver.callDebug("getSaveBlob") as string;
      await driver.callDebug("loadSaveBlob", [saved]);
      await page.waitForFunction(id => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === `equip-mainHand-${id}`, assetId, { timeout: 5000 });
      const after = await driver.callDebug("getPlayer") as any;
      const restored = JSON.parse(await driver.callDebug("getSaveBlob") as string);
      const inventoryAfter = await driver.callDebug("callTool", ["corealm_inventory", {}]);
      assert.deepEqual(restored.equipment, JSON.parse(saved).equipment);
      assert.deepEqual(inventoryAfter, inventoryBefore); assert.equal(after.maxHealth, before.maxHealth);
      await driver.callDebug("inspectPose", [{ x: after.position.x, y: after.position.y + 1, z: after.position.z,
        yaw: after.facingRad + 0.35, pitch: 0.1, distance: 3.2, detached: true }]);
      await driver.wait(150); await driver.screenshot(out, `${body}-${tier}-sword`);
      report.swords.push({ body, itemId, assetId, before, after, inventoryBefore, inventoryAfter,
        motion: await driver.callDebug("getPlayerMotion") });
    }
    const fixture = JSON.parse(saved);
    fixture.inventory.slots = fixture.inventory.slots.map(() => null);
    fixture.inventory.slots[0] = { itemId: "grithe_hatchet", quantity: 1 };
    await driver.callDebug("loadSaveBlob", [JSON.stringify(fixture)]);
    await driver.callDebug("inspectPose", [{ x: 22, y: 0, z: 12, yaw: 0.5, pitch: 0.45, distance: 16 }]);
    await driver.wait(350); await driver.moveMouse(485, 528);
    await page.waitForFunction(() => (window as any).__gameDebug.getState().hoveredEntityId === "feature-lab:forest:oak:4", undefined, { timeout: 3000 });
    await driver.click(485, 528);
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayer().activityKind === "gathering"
      && (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === "equip-mainHand-corealm_axe_1", undefined, { timeout: 10_000 });
    const player = await driver.callDebug("getPlayer") as any;
    await driver.callDebug("inspectPose", [{ x: player.position.x, y: player.position.y + 1.05, z: player.position.z,
      yaw: player.facingRad + 1.2, pitch: 0.1, distance: 3.2, detached: true }]);
    await driver.wait(200); await driver.screenshot(out, `${body}-axe-gathering`);
    report.gathering.push({ body, fixtureInventory: fixture.inventory, player: await driver.callDebug("getPlayer"), motion: await driver.callDebug("getPlayerMotion") });
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []); report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  try { report.failureState = JSON.parse(await driver.callDebug("getSaveBlob") as string); report.failureMotion = await driver.callDebug("getPlayerMotion"); await driver.screenshot(out, "failure-state"); } catch {}
} finally {
  await driver.close(); deadline(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, swords: report.swords.length, gathering: report.gathering.length, out }));
}
