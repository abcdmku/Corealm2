/**
 * Close grip and presentation views for held gear, in the production forest lab.
 *
 *   npx tsx runs/corealm-rebuild/checks/equipment-grips.ts --url http://127.0.0.1:4187 --body male
 *
 * One tight camera per item at three angles around the holding hand plus a full-figure silhouette,
 * so blade thickness, guard, shaft joints, grip centre and material zones can be read directly.
 * Captures are evidence for inspection; `passed` records only clean error lists and semantic state.
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
const kitId = option("--kit", "cobalt");
const url = option("--url", process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175");
assert(["male", "female"].includes(body), "--body male|female");
const only = option("--only", "");
const out = option("--out", `test-results/equipment-grips/${body}-${kitId}`);
await mkdir(out, { recursive: true });

/** mainHand id, optional offHand id. `hand` picks which side the tight camera orbits. */
const HELD: readonly { name: string; mainHand: string | null; offHand?: string | null; hand: "r" | "l" }[] = [
  { name: "shield-cairnpine", mainHand: "kaldite_sword", offHand: "cairnpine_shield", hand: "l" },
  { name: "shield-palewood", mainHand: "grithe_sword", offHand: "palewood_shield", hand: "l" },
  { name: "dagger-1-grithe", mainHand: "grithe_dagger", offHand: null, hand: "r" },
  { name: "dagger-2-corven", mainHand: "corven_dagger", offHand: null, hand: "r" },
  { name: "dagger-3-kaldite", mainHand: "kaldite_dagger", offHand: null, hand: "r" },
  { name: "dagger-4-emberite", mainHand: "emberite_dagger", offHand: null, hand: "r" },
  { name: "sword-kaldite", mainHand: "kaldite_sword", offHand: null, hand: "r" },
  { name: "staff-cairnpine", mainHand: "cairnpine_staff", offHand: null, hand: "r" },
  { name: "staff-basic", mainHand: "basic_wooden_staff", offHand: null, hand: "r" },
  { name: "wand-cairnpine", mainHand: "cairnpine_wand", offHand: null, hand: "r" },
  { name: "wand-fire", mainHand: "fire_wand", offHand: null, hand: "r" },
  { name: "staff-fire", mainHand: "fire_staff", offHand: null, hand: "r" },
  { name: "staff-tideworn", mainHand: "tideworn_staff", offHand: null, hand: "r" },
  { name: "sword-tideworn", mainHand: "tideworn_sword", offHand: null, hand: "r" },
];

const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1200, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline(`Equipment grips ${body} ${kitId}`, 200_000);
const report: any = { passed: false, visualAccepted: false, body, kitId, shots: [], limits: [
  "Static idle framing only. Socket drift under motion is covered by equipment-motion-matrix.",
  "Lab equip grants are fixture setup; the rig, sockets and materials are production code.",
] };

async function clearPanels(): Promise<void> {
  const page = driver.page!;
  const panel = page.locator("#panel-feature-lab");
  if (await panel.isVisible()) await panel.locator(".panel__close").click();
  await page.evaluate(() => {
    const overlay = document.getElementById("environment-lab-panel"); if (overlay) overlay.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await driver.wait(120);
}

try {
  await driver.launch(); const page = driver.page!;
  await driver.open(25_000, `/index.html?mode=combat&forest=1&body=${body}`);
  report.renderer = await verifyEquipmentHardware(page);
  const members = EQUIPMENT_SETS.find((row) => row.id === kitId)!.members;
  await page.evaluate(async (parts) => {
    const lab = (window as any).__featureLab;
    for (const [slot, id] of Object.entries(parts)) await lab.equipPlayer(slot, id);
  }, members);
  await clearPanels();
  const ground = await driver.callDebug("groundHeight", [-10, 6]) as number;
  await driver.callDebug("teleport", [[-10, ground, 6]]);

  for (const item of HELD) {
    if (only && !item.name.includes(only)) continue;
    await page.evaluate(async (spec) => {
      const lab = (window as any).__featureLab;
      await lab.equipPlayer("offHand", spec.offHand ?? null);
      await lab.equipPlayer("mainHand", spec.mainHand);
    }, item);
    await page.waitForFunction((spec) => {
      const m = (window as any).__gameDebug.getPlayerMotion();
      if (m.layerLoadPending !== false) return false;
      if (Object.keys(m.attachmentLoading ?? {}).length) return false;
      if (!m.attachments?.mainHand) return false;
      return spec.offHand ? Boolean(m.attachments?.offHand) : !m.attachments?.offHand;
    }, item, { timeout: 12_000 });
    await driver.wait(200);
    const motion = await driver.callDebug("getPlayerMotion") as any;
    assert.deepEqual(motion.attachmentErrors ?? {}, {}, `${item.name}: attachment errors`);
    const p = await driver.callDebug("getPlayer") as any;
    // Hand height on a 1.81 m rig in idle; the tight cameras orbit that point.
    const handY = p.position.y + 1.05;
    const views: [string, number, number, number][] = item.hand === "r"
      ? [["a-outer", 0.55, 0.05, 1.15], ["b-front", -0.35, 0.10, 1.15], ["c-above", 0.55, 0.75, 1.15]]
      : [["a-outer", 2.75, 0.05, 1.30], ["b-front", -0.45, 0.05, 1.30], ["c-above", 2.75, 0.70, 1.30]];
    for (const [suffix, yaw, pitch, distance] of views) {
      await driver.callDebug("inspectPose", [{ x: p.position.x, y: handY, z: p.position.z,
        yaw: p.facingRad + yaw, pitch, distance, detached: true }]);
      await driver.wait(150);
      const file = await driver.screenshot(out, `${item.name}-${suffix}`);
      report.shots.push({ name: `${item.name}-${suffix}`, file, attachments: motion.attachments });
    }
    // One full figure for silhouette and proportion.
    await driver.callDebug("inspectPose", [{ x: p.position.x, y: p.position.y + 0.95, z: p.position.z,
      yaw: p.facingRad + 0.9, pitch: 0.08, distance: 3.4, detached: true }]);
    await driver.wait(150);
    const file = await driver.screenshot(out, `${item.name}-d-figure`);
    report.shots.push({ name: `${item.name}-d-figure`, file, attachments: motion.attachments });
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
