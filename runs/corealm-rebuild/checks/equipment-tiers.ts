/**
 * One capture row per armour tier family, in the production forest lab.
 *
 *   npx tsx runs/corealm-rebuild/checks/equipment-tiers.ts --url http://127.0.0.1:4187 --body male
 *
 * Front, back and a close upper-body view for each of the eight sets in `content/equipmentSets.ts`.
 * This is the evidence for deciding where a tier is a genuine construction change and where it is
 * only a recolour. Captures are for inspection; `passed` records clean error lists only.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { EQUIPMENT_SETS } from "../../../game/src/content/equipmentSets.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};
const body = option("--body", "male");
const url = option("--url", process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175");
const only = option("--only", "");
assert(["male", "female"].includes(body), "--body male|female");
const out = option("--out", `test-results/equipment-tiers/${body}`);
await mkdir(out, { recursive: true });

const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1000, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline(`Equipment tiers ${body}`, 220_000);
const report: any = { passed: false, visualAccepted: false, body, shots: [], sets: [], limits: [
  "Static idle framing only, weapons deliberately empty so armour construction is unobstructed.",
  "Lab equip grants are fixture setup; layers, tints and materials are production code.",
] };

try {
  await driver.launch(); const page = driver.page!;
  await driver.open(25_000, `/index.html?mode=combat&forest=1&body=${body}`);
  report.renderer = await verifyEquipmentHardware(page);
  const panel = page.locator("#panel-feature-lab");
  await page.evaluate(async () => {
    const lab = (window as any).__featureLab;
    await lab.equipPlayer("mainHand", null); await lab.equipPlayer("offHand", null);
  });
  if (await panel.isVisible()) await panel.locator(".panel__close").click();
  await page.evaluate(() => { const o = document.getElementById("environment-lab-panel"); if (o) o.hidden = true; });
  const ground = await driver.callDebug("groundHeight", [-10, 6]) as number;
  await driver.callDebug("teleport", [[-10, ground, 6]]);

  for (const set of EQUIPMENT_SETS) {
    if (only && set.id !== only) continue;
    const state = await page.evaluate(async (members) => {
      const lab = (window as any).__featureLab;
      for (const [slot, id] of Object.entries(members)) await lab.equipPlayer(slot, id);
      return lab.getState();
    }, set.members);
    for (const [slot, id] of Object.entries(set.members)) assert.equal(state.equipment[slot], id, `${set.id}:${slot}`);
    await page.waitForFunction(() => {
      const m = (window as any).__gameDebug.getPlayerMotion();
      return m.layerLoadPending === false && !Object.keys(m.attachmentLoading ?? {}).length && m.hairVisible === false;
    }, undefined, { timeout: 12_000 });
    await driver.wait(250);
    const motion = await driver.callDebug("getPlayerMotion") as any;
    assert.deepEqual(motion.attachmentErrors ?? {}, {}, `${set.id}: attachment errors`);
    const p = await driver.callDebug("getPlayer") as any;
    const views: [string, number, number, number, number][] = [
      ["front", 0.15, 0.06, 3.1, 0.95],
      ["back", 3.30, 0.06, 3.1, 0.95],
      ["upper", 0.60, 0.16, 1.5, 1.35],
      ["lower", 0.60, -0.02, 1.6, 0.60],
    ];
    for (const [suffix, yaw, pitch, distance, lift] of views) {
      await driver.callDebug("inspectPose", [{ x: p.position.x, y: p.position.y + lift, z: p.position.z,
        yaw: p.facingRad + yaw, pitch, distance, detached: true }]);
      await driver.wait(140);
      const file = await driver.screenshot(out, `${set.tier.toString().padStart(2, "0")}-${set.id}-${suffix}`);
      report.shots.push({ name: `${set.id}-${suffix}`, file });
    }
    report.sets.push({ id: set.id, name: set.name, tier: set.tier, style: set.style,
      members: set.members, layerAssets: motion.layerAssets, layerSignature: motion.layerSignature });
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) {
  report.error = String((error as Error)?.stack ?? error); process.exitCode = 1;
  try { await driver.screenshot(out, "failure"); } catch {}
} finally {
  await driver.close(); deadline();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.split("\n")[0], shots: report.shots.length, out }));
}
