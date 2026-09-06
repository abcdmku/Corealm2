import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { EQUIPMENT_SETS } from "../../../game/src/content/equipmentSets.js";
const out = "test-results/equipment-worn";
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175", close: async () => {} }, { headless: true, viewport: { width: 1440, height: 900 }, browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"] });
const report: any = { passed: false, visualAccepted: false, shots: [] };
try {
  await driver.launch();
  for (const body of ["male", "female"]) {
    await driver.open(25_000, `/index.html?mode=combat&body=${body}`);
    for (const set of EQUIPMENT_SETS.filter(set => !process.env.EQUIPMENT_REVIEW_QUICK || ["copper", "hide"].includes(set.id))) {
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
      await driver.wait(450);
      for (const [view, yaw] of [["front", 0.35], ["back", 3.5]] as const) {
        await driver.callDebug("inspectPose", [{ x: 0, y: 1, z: 0, yaw, pitch: 0.1, distance: 3.2, detached: true }]);
        await driver.wait(100); await driver.screenshot(out, `${body}-${set.id}-${view}`);
        report.shots.push({ body, set: set.id, view, before, state });
      }
      if (process.env.EQUIPMENT_REVIEW_QUICK) {
        const bare = await driver.page!.evaluate(async () => { const lab = (window as any).__featureLab; await lab.equipPlayer("head", null); return lab.getState(); });
        assert.equal(bare.equipment.head, null);
        await driver.wait(400);
        await driver.callDebug("inspectPose", [{ x: 0, y: 1, z: 0, yaw: 0.35, pitch: 0.1, distance: 3.2, detached: true }]);
        await driver.screenshot(out, `${body}-${set.id}-head-removed`);
        report.shots.push({ body, set: set.id, view: "head-removed", state: bare });
      }
    }
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { await driver.close(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, shots: report.shots.length, out })); }
