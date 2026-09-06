import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { EQUIPMENT_SETS } from "../../../game/src/content/equipmentSets.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
const out = "test-results/equipment-wardrobe";
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175", close: async () => {} }, { headless: true, viewport: { width: 1440, height: 900 }, browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const report: any = { passed: false, visualAccepted: false, shots: [], restores: [],
  setup: "Public assets, normal lab equip grants; production save import, not browser reload. All eight sets on both bodies." };
const deadline = installTestDeadline("Wardrobe public review", 100_000);
try {
  await driver.launch();
  for (const body of ["male", "female"]) {
    await driver.open(25_000, `/index.html?mode=combat&body=${body}`);
    report.renderer = await verifyEquipmentHardware(driver.page!);
    for (const set of EQUIPMENT_SETS) {
      const before = await driver.page!.evaluate(() => (window as any).__featureLab.getState());
      const state = await driver.page!.evaluate(async ({ members, style, tier }) => {
        const lab = (window as any).__featureLab;
        for (const [slot, itemId] of Object.entries(members)) await lab.equipPlayer(slot, itemId);
        const index = [1, 5, 10, 20].indexOf(tier);
        await lab.equipPlayer("offHand", null);
        await lab.equipPlayer("mainHand", style === "melee" ? ["grithe_sword", "corven_sword", "kaldite_sword", "emberite_sword"][index] : ["palewood_staff", "duskoak_staff", "cairnpine_staff", "cinderpine_staff"][index]);
        await lab.equipPlayer("offHand", style === "melee" ? ["palewood_shield", "duskoak_shield", "cairnpine_shield", "cinderpine_shield"][index] : null);
        return lab.getState();
      }, { members: set.members, style: set.style, tier: set.tier });
      for (const [slot, itemId] of Object.entries(set.members)) assert.equal(state.equipment[slot], itemId);
      await driver.page!.waitForFunction(() => {
        const motion = (window as any).__gameDebug.getPlayerMotion();
        return motion.layerLoadPending === false && motion.hairVisible === false && motion.layerMeshes?.length > 0;
      }, undefined, { timeout: 5000 });
      const saved = await driver.callDebug("getSaveBlob") as string;
      const equippedMotion = await driver.callDebug("getPlayerMotion") as any;
      assert.equal(equippedMotion.layerLoadPending, false);
      assert.equal(equippedMotion.hairVisible, false);
      assert(equippedMotion.layerSignature, "Committed rendered layers missing");
      assert(equippedMotion.layerMeshes.length > 0, "Visible layer meshes missing");
      await driver.callDebug("loadSaveBlob", [saved]);
      await driver.page!.waitForFunction(signature => {
        const motion = (window as any).__gameDebug.getPlayerMotion();
        return motion.layerLoadPending === false && motion.layerSignature === signature;
      }, equippedMotion.layerSignature, { timeout: 5000 });
      const restoredMotion = await driver.callDebug("getPlayerMotion") as any;
      const restored = JSON.parse(await driver.callDebug("getSaveBlob") as string);
      assert.deepEqual(restored.equipment, JSON.parse(saved).equipment);
      assert.deepEqual(restored.inventory, JSON.parse(saved).inventory);
      assert.equal(restoredMotion.hairVisible, false);
      assert.deepEqual(restoredMotion.layerMeshes, equippedMotion.layerMeshes);
      assert.deepEqual(restoredMotion.layerAssets, equippedMotion.layerAssets);
      report.restores.push({ body, set: set.id, equippedMotion, restoredMotion });
      for (const [view, yaw] of [["front", 0.35], ["back", 3.5]] as const) {
        await driver.callDebug("inspectPose", [{ x: 0, y: 1, z: 0, yaw, pitch: 0.1, distance: 3.2, detached: true }]);
        await driver.wait(100); await driver.screenshot(out, `${body}-${set.id}-${view}`);
        report.shots.push({ body, set: set.id, view, before, state, motion: await driver.callDebug("getPlayerMotion") });
      }
      {
        const bare = await driver.page!.evaluate(async () => { const lab = (window as any).__featureLab; await lab.equipPlayer("head", null); return lab.getState(); });
        assert.equal(bare.equipment.head, null);
        await driver.page!.waitForFunction(() => {
          const motion = (window as any).__gameDebug.getPlayerMotion();
          return motion.layerLoadPending === false && motion.hairVisible === true;
        }, undefined, { timeout: 5000 });
        await driver.callDebug("inspectPose", [{ x: 0, y: 1, z: 0, yaw: 0.35, pitch: 0.1, distance: 3.2, detached: true }]);
        await driver.screenshot(out, `${body}-${set.id}-head-removed`);
        report.shots.push({ body, set: set.id, view: "head-removed", state: bare, motion: await driver.callDebug("getPlayerMotion") });
      }
    }
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1;
  try { report.failureMotion = await driver.callDebug("getPlayerMotion"); await driver.screenshot(out, "failure"); } catch {} }
finally { await driver.close(); deadline(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, shots: report.shots.length, out })); }
