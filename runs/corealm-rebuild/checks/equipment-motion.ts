/** One body/kit shard, public equipment and production actions. No asset aliases or forced clips. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { EQUIPMENT_SETS } from "../../../game/src/content/equipmentSets.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";
const [body = "male", kit = "knight"] = process.argv.slice(2);
assert(["male", "female"].includes(body));
assert(["knight", "ranger", "mixed"].includes(kit));
const out = `test-results/equipment-motion/${body}-${kit}`;
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: process.env.COREALM_URL ?? process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175", close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline("Equipment motion shard", 60_000);
const report: any = { passed: false, visualAccepted: false, body, kit, shots: [],
  limits: ["Hit/death preview captures test production rig clipping only, not damage or gameplay death.",
    "Walk is sampled from real acceleration/deceleration; Shift walking is not implemented."],
  setup: "Lab equip/skill grants and saved hatchet inventory are declared fixture setup; actions use production code. Public assets only." };
async function motion() { return await driver.callDebug("getPlayerMotion") as any; }
async function frame() {
  const p = await driver.callDebug("getPlayer") as any;
  await driver.callDebug("inspectPose", [{ x: p.position.x, y: p.position.y + 1, z: p.position.z,
    yaw: p.facingRad + 0.9, pitch: 0.14, distance: 3.7, detached: true }]);
}
async function shot(name: string, pose: string, timeout = 7000, minimumFraction = 0) {
  await driver.page!.waitForFunction(({ expected, fraction }) => {
    const m = (window as any).__gameDebug.getPlayerMotion();
    return m.pose === expected && m.clip && m.actionWeight > 0.5 && m.time > 0.06 && m.time / m.duration >= fraction;
  }, { expected: pose, fraction: minimumFraction }, { timeout });
  const before = await motion();
  assert.equal(before.layerLoadPending, false); assert(before.layerAssets.length >= 4);
  assert.equal(before.hairVisible, false);
  await driver.screenshot(out, name);
  const after = await motion();
  assert.equal(after.pose, pose, `Capture crossed ${pose} into ${after.pose}`);
  assert.deepEqual(after.layerSignature, before.layerSignature);
  report.shots.push({ name, before, after, state: await driver.callDebug("getPlayer") });
}
try {
  await driver.launch(); const page = driver.page!;
  await driver.open(20_000, `/index.html?mode=combat&forest=1&body=${body}`);
  report.renderer = await verifyEquipmentHardware(page);
  const knight = EQUIPMENT_SETS.find(s => s.id === "cobalt")!.members;
  const ranger = EQUIPMENT_SETS.find(s => s.id === "heavy_hide")!.members;
  const members = kit === "knight" ? knight : kit === "ranger" ? ranger
    : { head: knight.head, body: ranger.body, legs: knight.legs, hands: ranger.hands, feet: knight.feet };
  report.members = members;
  await page.evaluate(async parts => {
    const lab = (window as any).__featureLab;
    for (const [slot, id] of Object.entries(parts)) await lab.equipPlayer(slot, id);
    await lab.equipPlayer("mainHand", "kaldite_sword"); await lab.equipPlayer("offHand", "cairnpine_shield");
  }, members);
  await frame();
  await page.evaluate(() => { (window as any).__equipmentMotionTrace = [];
    const sample = () => { const m = (window as any).__gameDebug.getPlayerMotion();
      (window as any).__equipmentMotionTrace.push({ pose: m.pose, clip: m.clip, time: m.time, position: m.drawnPosition });
      if (!(window as any).__equipmentMotionTraceStop) requestAnimationFrame(sample); };
    requestAnimationFrame(sample); });
  await page.keyboard.down("w"); await shot("01-run", "run"); await page.keyboard.up("w");
  report.locomotion = await page.evaluate(() => (window as any).__equipmentMotionTrace);
  assert(report.locomotion.some((x: any) => x.pose === "walk"), "Natural locomotion did not expose Walk");
  await driver.callDebug("inspectPose", [{ x: 0, y: 0, z: 0, yaw: 0.3, pitch: 0.2, distance: 4 }]);
  await page.evaluate(async () => {
    const lab = (window as any).__featureLab;
    const target = lab.getCatalog().targets.creature.find((p: any) => /troll|ogre|bear/i.test(p.label));
    if (!target) throw new Error("No durable melee target in current catalogue");
    await lab.spawnTarget("creature", target.id, { distance: 2 });
    lab.setLevel("melee", 10); lab.setLevel("magic", 20);
  });
  await frame();
  await page.evaluate(async () => (window as any).__featureLab.perform("attack"));
  await shot("02-melee", "attack_melee");
  await page.evaluate(async () => {
    const lab = (window as any).__featureLab; await lab.perform("reset-player");
    await lab.equipPlayer("mainHand", "cairnpine_staff"); await lab.equipPlayer("offHand", null);
    await lab.setSpell(lab.getCatalog().spells[0].id); await lab.perform("cast");
  });
  await frame(); await shot("04-cast-staff", "cast");
  await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));
  const saved = JSON.parse(await driver.callDebug("getSaveBlob") as string);
  saved.inventory.slots = saved.inventory.slots.map(() => null);
  saved.inventory.slots[0] = { itemId: "grithe_hatchet", quantity: 1 };
  await driver.callDebug("loadSaveBlob", [JSON.stringify(saved)]);
  await driver.callDebug("inspectPose", [{ x: 22, y: 0, z: 12, yaw: 0.5, pitch: 0.45, distance: 16 }]);
  await driver.wait(350); await driver.moveMouse(485, 528);
  await page.waitForFunction(() => (window as any).__gameDebug.getState().hoveredEntityId === "feature-lab:forest:oak:4", undefined, { timeout: 3000 });
  await driver.click(485, 528);
  await page.waitForFunction(() => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === "equip-mainHand-corealm_axe_1", undefined, { timeout: 8000 });
  await frame(); await shot("05-gather-axe", "chop");
  await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));
  await frame();
  for (const pose of ["hit", "death"] as const) {
    for (const [phase, fraction] of [["peak", 0.45], ["late", 0.8]] as const) {
      const before = await driver.callDebug("getPlayer");
      const preview = await page.evaluate(p => (window as any).__featureLab.previewPlayerReaction(p), pose);
      await shot(`06-${pose}-${phase}`, pose, 5000, fraction);
      report.shots.at(-1).isolatedReaction = { before, preview, source: "FeatureLabApi.previewPlayerReaction -> production CharacterRig.play; no health mutation" };
    }
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1;
  try { report.failureMotion = await motion(); await driver.screenshot(out, "failure"); } catch {} }
finally { try { await driver.page?.keyboard.up("w"); } catch {} await driver.close(); deadline();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, error: report.error, out })); }
