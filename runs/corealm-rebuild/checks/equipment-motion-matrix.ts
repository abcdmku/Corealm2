/**
 * Slice 13 equipment-in-motion shard: one body, one outfit kit, public assets, production actions.
 *
 *   npx tsx runs/corealm-rebuild/checks/equipment-motion-matrix.ts --body female --kit mixed-a --url http://127.0.0.1:4187
 *
 * Kits: knight (all metal), ranger (all hide/cloth), mixed-a (metal head/legs/feet + hide body/hands,
 * lowest and highest tiers together), mixed-b (hide head/legs/feet + metal body/hands).
 * Phases: production save import restores the outfit, real keyboard run, real melee attack, real staff
 * and wand casts, real tree chop click, real cut-face ore click, hit/death previews through the
 * production rig. `--scene fishing` runs the separate Redsill basin with a real school click instead.
 * Captures are evidence for inspection; `passed` records semantic state and clean error lists only.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { PerspectiveCamera, Vector3 } from "three";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { CAMERA } from "../../../game/src/app/config.js";
import { EQUIPMENT_SETS } from "../../../game/src/content/equipmentSets.js";
import { verifyEquipmentHardware } from "./equipment-hardware.js";

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1]! : fallback;
};
const body = option("--body", "male");
const kit = option("--kit", "knight");
const scene = option("--scene", "forest");
const url = option("--url", process.env.EQUIPMENT_REVIEW_URL ?? "http://127.0.0.1:4175");
assert(["male", "female"].includes(body), "--body male|female");
assert(["knight", "ranger", "mixed-a", "mixed-b"].includes(kit), "--kit knight|ranger|mixed-a|mixed-b");
assert(["forest", "fishing"].includes(scene), "--scene forest|fishing");
const out = option("--out", `test-results/equipment-motion-matrix/${scene}-${body}-${kit}`);
await mkdir(out, { recursive: true });

const set = (id: string) => EQUIPMENT_SETS.find((row) => row.id === id)!.members;
const copper = set("copper"), titanium = set("titanium"), hide = set("hide"), heavyHide = set("heavy_hide");
const cobalt = set("cobalt");
const members = kit === "knight" ? cobalt
  : kit === "ranger" ? heavyHide
  : kit === "mixed-a" ? { head: titanium.head, body: hide.body, legs: copper.legs, hands: heavyHide.hands, feet: titanium.feet }
  : { head: heavyHide.head, body: copper.body, legs: hide.legs, hands: titanium.hands, feet: heavyHide.feet };
const sword = kit === "ranger" ? "grithe_sword" : kit === "knight" ? "kaldite_sword" : "emberite_sword";
const shield = kit === "ranger" ? "palewood_shield" : kit === "knight" ? "cairnpine_shield" : "cinderpine_shield";

const driver = new GameDriver({ url, close: async () => {} }, {
  headless: true, viewport: { width: 1440, height: 900 },
  browserArgs: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio"],
});
const deadline = installTestDeadline(`Equipment motion matrix ${scene} ${body} ${kit}`, scene === "fishing" ? 70_000 : 110_000);
const report: any = {
  passed: false, visualAccepted: false, body, kit, scene, members, sword, shield, shots: [], phases: [],
  limits: [
    "Hit/death previews use FeatureLabApi.previewPlayerReaction -> production CharacterRig.play; no health change.",
    "Save restoration uses production save import (debug.loadSaveBlob), not a browser reload.",
    "Lab equip grants, skill levels and the single tool in the cleared pack are fixture setup.",
  ],
};

type Motion = { pose: string; clip: string | null; time: number; duration: number; actionWeight: number;
  attachments?: Record<string, string>; attachmentLoading?: Record<string, string>; attachmentErrors?: Record<string, string>;
  layerSignature?: string | null; layerLoadPending?: boolean; layerMeshes?: string[]; layerAssets?: string[]; hairVisible?: boolean };
const motion = async () => await driver.callDebug("getPlayerMotion") as Motion;
const player = async () => await driver.callDebug("getPlayer") as any;
let expectedLayerSignature: string | null = null;
let expectedLayerAssets: string[] = [];

async function frame(yawOffset = 0.9, pitch = 0.14, distance = 3.7, lift = 1): Promise<void> {
  const p = await player();
  await driver.callDebug("inspectPose", [{ x: p.position.x, y: p.position.y + lift, z: p.position.z,
    yaw: p.facingRad + yawOffset, pitch, distance, detached: true }]);
}

/** Wait for a production pose at a clip fraction, capture, and prove the outfit did not change under it. */
const ONE_SHOT = new Set(["hit", "death", "attack_melee", "cast"]);
async function shot(name: string, pose: string, minimumFraction = 0, timeout = 8000, expectMainHand?: RegExp): Promise<Motion> {
  await driver.page!.waitForFunction(({ expected, fraction }) => {
    const m = (window as any).__gameDebug.getPlayerMotion();
    return m.pose === expected && m.clip && m.actionWeight > 0.5 && m.time > 0.04 && m.time / m.duration >= fraction
      && m.layerLoadPending === false && !Object.keys(m.attachmentLoading ?? {}).length;
  }, { expected: pose, fraction: minimumFraction }, { timeout });
  const before = await motion();
  assert.equal(before.layerLoadPending, false, `${name}: layers still loading`);
  assert.equal(before.layerSignature, expectedLayerSignature, `${name}: worn layer signature changed`);
  assert.deepEqual([...(before.layerAssets ?? [])].sort(), [...expectedLayerAssets].sort(), `${name}: worn layer assets changed`);
  assert.equal(before.hairVisible, false, `${name}: hair visible under headgear`);
  assert.deepEqual(before.attachmentErrors ?? {}, {}, `${name}: attachment errors`);
  if (expectMainHand) assert.match(before.attachments?.mainHand ?? "", expectMainHand, `${name}: main hand attachment`);
  const file = await driver.screenshot(out, name);
  const after = await motion();
  // A one-shot clip may finish between the capture and this read; the capture itself still came from the
  // asserted pose because the wait above and the screenshot are adjacent. Record the completion.
  const completed = ONE_SHOT.has(pose) && after.pose === "idle" && before.time / before.duration > 0.3;
  if (!completed) assert.equal(after.pose, pose, `${name}: capture crossed ${pose} into ${after.pose}`);
  assert.equal(after.layerSignature, before.layerSignature);
  report.shots.push({ name, file, before, after, completedDuringCapture: completed, player: await player() });
  return before;
}

function screenCandidates(camera: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } },
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, rect: { x: number; y: number; width: number; height: number }) {
  const view = new PerspectiveCamera(CAMERA.fov, rect.width / rect.height, CAMERA.near, CAMERA.far);
  view.position.set(camera.position.x, camera.position.y, camera.position.z);
  view.lookAt(camera.target.x, camera.target.y, camera.target.z);
  view.updateMatrixWorld(true);
  const list: { x: number; y: number; depth: number }[] = [];
  for (const height of [0.5, 0.35, 0.65, 0.8]) for (const along of [0.5, 0.3, 0.7]) for (const depth of [0.5, 0.25, 0.75]) {
    const p = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * along, bounds.min.y + (bounds.max.y - bounds.min.y) * height,
      bounds.min.z + (bounds.max.z - bounds.min.z) * depth).project(view);
    list.push({ x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2, depth: p.z });
  }
  return list.filter((c) => c.depth > -1 && c.depth < 1 && c.x > 4 && c.y > 4 && c.x < rect.width - 4 && c.y < rect.height - 4);
}

/**
 * Spawn a small production creature within reach and open on it.
 *
 * A tier-20 sword kills the lab's smallest creatures in one real hit, and the lab keeps a single
 * `target` handle, so a second swing can be issued against a corpse ("Frog is already dead" ended
 * both male mixed shards on the pre-rebase run). Retry with a fresh spawn instead of forcing a
 * tougher creature, which would obstruct the close camera.
 */
/** Wait for a reset or teleport to land before a camera is framed on the actor. */
async function settle(): Promise<void> {
  await driver.page!.waitForFunction(() => {
    const p = (window as any).__gameDebug.getPlayer();
    return p.moving === false && p.activityKind === null || p.moving === false;
  }, undefined, { timeout: 6000 });
  await driver.wait(250);
}

async function spawnLiveTarget(distance = 2.2): Promise<void> {
  const page = driver.page!;
  await page.evaluate(async (reach) => {
    const lab = (window as any).__featureLab;
    const catalog = lab.getCatalog().targets.creature;
    const preset = catalog.find((p: any) => /frog|rat|coney|rabbit/i.test(p.label)) ?? catalog[0];
    await lab.spawnTarget("creature", preset.id, { distance: reach });
  }, distance);
  await page.waitForFunction(() => (window as any).__gameDebug.getEntities()
    .some((e: any) => String(e.id).startsWith("feature-lab:creature:") && e.health > 0), undefined, { timeout: 6000 });
}

/** Open on the live target, replacing a corpse with a fresh spawn and reframing if the first try lost it. */
async function attackLiveTarget(frameCamera: () => Promise<void>): Promise<void> {
  const page = driver.page!;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(async () => (window as any).__featureLab.perform("attack"));
      // The actor may walk the last step into reach, so frame once the swing itself has started.
      await page.waitForFunction(() => {
        const m = (window as any).__gameDebug.getPlayerMotion();
        return m.pose === "attack_melee" || m.pose === "idle";
      }, undefined, { timeout: 8000 });
      await frameCamera();
      report.phases.push({ attack: "opened", attempt });
      return;
    } catch (error) {
      lastError = error;
      report.phases.push({ attack: "retry", attempt, error: String(error).slice(0, 160) });
      await spawnLiveTarget();
    }
  }
  throw lastError;
}

/** Close the lab panel through its own button and hide the authoring overlay so the actor stays unobstructed. */
async function clearPanels(): Promise<void> {
  const page = driver.page!;
  const panel = page.locator("#panel-feature-lab");
  if (await panel.isVisible()) await panel.locator(".panel__close").click();
  await page.evaluate(() => {
    const overlay = document.getElementById("environment-lab-panel"); if (overlay) overlay.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await driver.wait(150);
}

/** One real hover-verified canvas click on a production entity. */
async function clickEntity(entityId: string): Promise<{ x: number; y: number }> {
  const page = driver.page!;
  await clearPanels();
  await driver.wait(100);
  const screen = await page.evaluate((id) => {
    const d = (window as any).__gameDebug, r = document.querySelector("canvas")!.getBoundingClientRect();
    return { camera: d.getCamera(), bounds: d.getDrawnBounds(id), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  }, entityId);
  assert(screen.bounds, `${entityId} has no drawn bounds`);
  const attempts: unknown[] = [];
  for (const candidate of screenCandidates(screen.camera, screen.bounds, screen.rect)) {
    await driver.moveMouse(candidate.x, candidate.y);
    let stable = true;
    for (let sample = 0; sample < 2; sample++) {
      await driver.wait(90);
      const hover = await page.evaluate((c) => ({ id: (window as any).__gameDebug.getState().hoveredEntityId,
        canvas: document.elementFromPoint(c.x, c.y)?.tagName === "CANVAS" }), candidate);
      attempts.push({ candidate, ...hover });
      if (!hover.canvas || hover.id !== entityId) { stable = false; break; }
    }
    if (stable) { await driver.click(candidate.x, candidate.y); report.phases.push({ click: entityId, candidate, attempts: attempts.length }); return candidate; }
  }
  throw new Error(`No stable hover for ${entityId}: ${JSON.stringify(attempts.slice(-3))}`);
}

async function equipOutfit(): Promise<void> {
  const page = driver.page!;
  const state = await page.evaluate(async ({ parts, sword, shield }) => {
    const lab = (window as any).__featureLab;
    for (const [slot, id] of Object.entries(parts)) await lab.equipPlayer(slot, id);
    await lab.equipPlayer("mainHand", sword); await lab.equipPlayer("offHand", shield);
    return lab.getState();
  }, { parts: members, sword, shield });
  for (const [slot, id] of Object.entries(members)) assert.equal(state.equipment[slot], id);
  assert.equal(state.equipment.mainHand, sword); assert.equal(state.equipment.offHand, shield);
  await page.waitForFunction(() => {
    const m = (window as any).__gameDebug.getPlayerMotion();
    return m.layerLoadPending === false && m.hairVisible === false && m.layerMeshes?.length > 0
      && m.attachments?.mainHand && m.attachments?.offHand && !Object.keys(m.attachmentLoading ?? {}).length;
  }, undefined, { timeout: 12_000 });
  const equipped = await motion();
  expectedLayerSignature = equipped.layerSignature ?? null;
  expectedLayerAssets = [...(equipped.layerAssets ?? [])];
  assert(expectedLayerSignature, "Committed layer signature missing");
  assert(expectedLayerAssets.length >= 5, `Expected five worn armor assets plus hair-free base, got ${expectedLayerAssets.join(",")}`);
  report.equipped = { state: state.equipment, motion: equipped };
}

/** Production save import must restore the exact worn layers and held attachments. */
async function restoreThroughSave(): Promise<string> {
  const before = await motion(); const playerBefore = await player();
  const inventoryBefore = await driver.callDebug("callTool", ["corealm_inventory", {}]);
  const saved = await driver.callDebug("getSaveBlob") as string;
  await driver.callDebug("loadSaveBlob", [saved]);
  await driver.page!.waitForFunction((signature) => {
    const m = (window as any).__gameDebug.getPlayerMotion();
    return m.layerLoadPending === false && m.layerSignature === signature && m.attachments?.mainHand && m.attachments?.offHand
      && !Object.keys(m.attachmentLoading ?? {}).length;
  }, before.layerSignature, { timeout: 8000 });
  const after = await motion(); const playerAfter = await player();
  const restored = JSON.parse(await driver.callDebug("getSaveBlob") as string);
  assert.deepEqual(restored.equipment, JSON.parse(saved).equipment);
  assert.deepEqual(await driver.callDebug("callTool", ["corealm_inventory", {}]), inventoryBefore);
  assert.equal(playerAfter.maxHealth, playerBefore.maxHealth);
  assert.deepEqual(after.attachments, before.attachments);
  assert.deepEqual(after.layerMeshes, before.layerMeshes);
  assert.deepEqual(after.layerAssets, before.layerAssets);
  assert.equal(after.hairVisible, false);
  report.restore = { before, after, equipment: restored.equipment };
  return saved;
}

try {
  await driver.launch(); const page = driver.page!;
  if (scene === "fishing") {
    await driver.open(25_000, `/index.html?mode=combat&fishing=1&body=${body}`);
    report.renderer = await verifyEquipmentHardware(page);
    await page.waitForFunction(() => Boolean((window as any).__fishingLab), undefined, { timeout: 5000 });
    await equipOutfit();
    const saved = await restoreThroughSave();
    await clearPanels();
    const fixture = await page.evaluate(() => (window as any).__fishingLab.getState());
    const schoolId = fixture.entityIds[0];
    const school = await driver.callDebug("getEntity", [schoolId]) as any;
    assert(school?.interactionPosition, "School has no bank anchor");
    const clear = JSON.parse(saved);
    clear.inventory.slots = clear.inventory.slots.map(() => null);
    clear.inventory.slots[0] = { itemId: "cairnpine_rod", quantity: 1 };
    await driver.callDebug("loadSaveBlob", [JSON.stringify(clear)]);
    await driver.callDebug("setSkillLevel", ["fishing", 99]);
    const anchor = school.interactionPosition;
    const centre = fixture.bodies[0].centre;
    const ox = anchor[0] - centre[0], oz = anchor[2] - centre[1], len = Math.hypot(ox, oz);
    const sx = anchor[0] + ox / len * 6, sz = anchor[2] + oz / len * 6;
    const sy = await driver.callDebug("groundHeight", [sx, sz]) as number;
    await driver.callDebug("inspectPose", [{ x: sx, y: sy, z: sz, yaw: Math.atan2(ox, oz), pitch: 0.62, distance: 26 }]);
    await driver.wait(600);
    await clickEntity(schoolId);
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayer().activityKind === "gathering"
      && /equip-mainHand-proc_rod_/.test((window as any).__gameDebug.getPlayerMotion().attachments?.mainHand ?? ""), undefined, { timeout: 15_000 });
    await frame(1.1, 0.12, 3.4);
    await shot("07-fish-side", "fish", 0.1, 8000, /^equip-mainHand-proc_rod_cairnpine$/);
    await frame(-0.6, 0.2, 3.4);
    await shot("07-fish-front", "fish", 0.0, 8000, /^equip-mainHand-proc_rod_cairnpine$/);
    // A strapped shield covers the rod hand from most angles, so take one close view without it.
    // The worn layers are untouched, so the layer assertions in `shot` still hold.
    await page.evaluate(async () => (window as any).__featureLab.equipPlayer("offHand", null));
    await page.waitForFunction(() => !(window as any).__gameDebug.getPlayerMotion().attachments?.offHand,
      undefined, { timeout: 6000 });
    await frame(1.35, 0.05, 1.6, 1.1);
    await shot("07-fish-grip", "fish", 0.0, 8000, /^equip-mainHand-proc_rod_cairnpine$/);
    report.fishing = { schoolId, player: await player(), motion: await motion() };
  } else {
    await driver.open(25_000, `/index.html?mode=combat&forest=1&environment=1&body=${body}`);
    report.renderer = await verifyEquipmentHardware(page);
    await equipOutfit();
    const saved = await restoreThroughSave();
    await clearPanels();
    // Step clear of the bank fixture so the low cameras stay unobstructed.
    await driver.callDebug("teleport", [[-10, await driver.callDebug("groundHeight", [-10, 6]), 6]]);
    await frame(0.35, 0.1, 3.2); await shot("00-restored-front", "idle");
    await frame(3.4, 0.1, 3.2); await shot("00-restored-back", "idle");
    await frame(0.9, 0.05, 2.1, 0.75); await shot("00-restored-grips", "idle");
    // Close seam views for mixed construction: neck/shoulder/cuff line, then waist/knee/ankle line.
    await frame(0.6, 0.3, 1.7, 1.35); await shot("00-restored-seams-upper", "idle");
    await frame(-2.6, 0.3, 1.7, 1.35); await shot("00-restored-seams-upper-back", "idle");
    await frame(0.6, -0.05, 1.9, 0.55); await shot("00-restored-seams-lower", "idle");

    // Real keyboard locomotion. Movement keys are camera-relative, so W runs away from the detached
    // camera, S toward it and A/D across it. Re-framing stops input, so each view is framed first and
    // captured within the first strides of the jog loop.
    await clearPanels();
    // Across-camera strides leave a close frame fastest, so they are captured early in the loop.
    for (const [name, key, fraction] of [["01-run-back", "w", 0.2], ["01-run-front", "s", 0.5], ["01-run-sword-side", "d", 0.25], ["01-run-shield-side", "a", 0.25]] as const) {
      await frame(0.2, 0.12, 5.2);
      await page.keyboard.down(key);
      try { await shot(name, "run", fraction, 8000); } finally { await page.keyboard.up(key); }
      await page.waitForFunction(() => (window as any).__gameDebug.getPlayerMotion().pose === "idle", undefined, { timeout: 5000 });
      await driver.callDebug("teleport", [[-10, await driver.callDebug("groundHeight", [-10, 6]), 6]]);
    }
    await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));
    await driver.callDebug("teleport", [[-10, await driver.callDebug("groundHeight", [-10, 6]), 6]]);

    // Real melee against a production creature.
    await page.evaluate(() => { const lab = (window as any).__featureLab; lab.setLevel("melee", 10); lab.setLevel("magic", 20); });
    // Spawn inside reach FIRST, then frame, so the actor is not mid-walk when the camera is set.
    await settle();
    await spawnLiveTarget();
    await attackLiveTarget(() => frame(0.9, 0.14, 3.7));
    await shot("02-melee-windup", "attack_melee", 0.12, 8000, /corealm_sword_/);
    await shot("02-melee-impact", "attack_melee", 0.42, 4000, /corealm_sword_/);
    // Return to spawn so the second swing starts without a walk that would leave the framed camera.
    await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));
    await settle();
    await spawnLiveTarget();
    await attackLiveTarget(() => frame(-0.7, 0.2, 3.7));
    await shot("02-melee-front", "attack_melee", 0.3, 8000, /corealm_sword_/);

    // Real casts with a two-hand staff and a wand.
    for (const [weapon, expected, held] of [
      ["cairnpine_staff", /^equip-mainHand-corealm_staff_[1-4]$/, "corealm_staff_3"],
      ["cairnpine_wand", /^equip-mainHand-corealm_wand_[1-4]$/, "corealm_wand_3"],
    ] as const) {
      await page.evaluate(async (id) => {
        const lab = (window as any).__featureLab; await lab.perform("reset-player");
        // The melee target may be dead; each cast gets a fresh small production creature.
        const target = lab.getCatalog().targets.creature.find((p: any) => /frog|rat|coney|rabbit/i.test(p.label)) ?? lab.getCatalog().targets.creature[0];
        await lab.spawnTarget("creature", target.id, { distance: 5 });
        await lab.equipPlayer("offHand", null); await lab.equipPlayer("mainHand", id);
        await lab.setSpell(lab.getCatalog().spells[0].id);
      }, weapon);
      await driver.page!.waitForFunction(() => (window as any).__gameDebug.getEntities()
        .some((e: any) => String(e.id).startsWith("feature-lab:creature:") && e.health > 0), undefined, { timeout: 6000 });
      await page.waitForFunction((id) => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === `equip-mainHand-${id}`, held, { timeout: 6000 });
      await frame(0.9, 0.14, 3.7);
      await shot(`03-${weapon}-idle`, "idle", 0, 6000, expected);
      await page.evaluate(async () => (window as any).__featureLab.perform("cast"));
      await shot(`03-${weapon}-cast`, "cast", 0.35, 8000, expected);
    }
    await page.evaluate(async (ids) => { const lab = (window as any).__featureLab; await lab.perform("reset-player");
      await lab.equipPlayer("mainHand", ids.sword); await lab.equipPlayer("offHand", ids.shield); }, { sword, shield });

    // Real tree chop: one hatchet in a cleared production pack, real hover-verified click.
    const fixture = JSON.parse(saved);
    fixture.inventory.slots = fixture.inventory.slots.map(() => null);
    fixture.inventory.slots[0] = { itemId: "kaldite_hatchet", quantity: 1 };
    fixture.inventory.slots[1] = { itemId: "kaldite_pickaxe", quantity: 1 };
    await driver.callDebug("loadSaveBlob", [JSON.stringify(fixture)]);
    await driver.callDebug("setSkillLevel", ["woodcutting", 99]); await driver.callDebug("setSkillLevel", ["mining", 99]);
    await driver.callDebug("inspectPose", [{ x: 22, y: 0, z: 12, yaw: 0.5, pitch: 0.45, distance: 16 }]);
    await driver.wait(400);
    await clickEntity("feature-lab:forest:oak:4");
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayer().activityKind === "gathering"
      && (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === "equip-mainHand-corealm_axe_1", undefined, { timeout: 15_000 });
    await frame(1.2, 0.1, 3.4, 1.05);
    await shot("04-chop-raise", "chop", 0.05, 8000, /^equip-mainHand-corealm_axe_1$/);
    await shot("04-chop-strike", "chop", 0.5, 4000, /^equip-mainHand-corealm_axe_1$/);
    await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));

    // Real ore mining on the two-seam cut face.
    await page.evaluate(() => (window as any).__environmentLab.showCutFace());
    await page.waitForFunction(() => { const s = (window as any).__environmentLab.getState(); return s.ready && s.selection === "two-seam-slope"; }, undefined, { timeout: 15_000 });
    const cut = await page.evaluate(() => (window as any).__environmentLab.getState());
    const oreId = cut.entityIds[0];
    const ore = await driver.callDebug("getEntity", [oreId]) as any;
    assert(ore?.interactionPosition, "Cut-face ore has no stance");
    const stance = ore.interactionPosition;
    const start = { x: stance[0] - 5, z: stance[2] + 5 };
    const startY = await driver.callDebug("groundHeight", [start.x, start.z]) as number;
    await driver.callDebug("teleport", [[start.x, startY, start.z]]);
    await driver.callDebug("inspectPose", [{ x: stance[0], y: stance[1], z: stance[2], yaw: 0.6, pitch: 0.5, distance: 14 }]);
    await driver.wait(500);
    await clickEntity(oreId);
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayer().activityKind === "gathering"
      && (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === "equip-mainHand-pickaxe", undefined, { timeout: 15_000 });
    await frame(1.05, 0.2, 3.4, 1.05);
    await shot("05-mine-raise", "mine", 0.05, 8000, /^equip-mainHand-pickaxe$/);
    await shot("05-mine-strike", "mine", 0.5, 4000, /^equip-mainHand-pickaxe$/);
    await page.evaluate(async () => (window as any).__featureLab.perform("reset-player"));
    await page.waitForFunction((id) => (window as any).__gameDebug.getPlayerMotion().attachments?.mainHand === `equip-mainHand-${id}`,
      report.equipped.motion.attachments.mainHand.replace("equip-mainHand-", ""), { timeout: 6000 });

    // Hit flinch and death through the production rig; the corpse view is a low camera.
    await driver.callDebug("teleport", [[-10, await driver.callDebug("groundHeight", [-10, 6]), 6]]);
    await frame(0.9, 0.14, 3.7);
    await page.evaluate((p) => (window as any).__featureLab.previewPlayerReaction(p), "hit");
    await shot("06-hit-peak", "hit", 0.22, 5000);
    await page.evaluate((p) => (window as any).__featureLab.previewPlayerReaction(p), "death");
    await shot("06-death-fall", "death", 0.4, 5000);
    // The one-shot returns to idle when it ends, so frame the low corpse camera before a second preview.
    await page.waitForFunction(() => (window as any).__gameDebug.getPlayerMotion().pose === "idle", undefined, { timeout: 6000 });
    await frame(0.4, 0.5, 3.4, 0.5);
    await page.evaluate((p) => (window as any).__featureLab.previewPlayerReaction(p), "death");
    await shot("06-death-corpse", "death", 0.78, 6000);
  }
  report.errors = await driver.callDebug("getErrors"); report.console = driver.consoleErrors; report.requests = driver.requestErrors;
  assert.deepEqual(report.errors, []); assert.deepEqual(report.console, []); assert.deepEqual(report.requests, []);
  report.passed = true;
} catch (error) {
  report.error = String((error as Error)?.stack ?? error); process.exitCode = 1;
  try { report.failureMotion = await motion(); report.failurePlayer = await player(); await driver.screenshot(out, "failure"); } catch {}
} finally {
  try { await driver.page?.keyboard.up("w"); } catch {}
  await driver.close(); deadline();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.split("\n")[0], shots: report.shots.length, out }));
}
