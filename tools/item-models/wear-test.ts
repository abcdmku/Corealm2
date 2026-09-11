import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_ITEMS } from "../../game/src/content/items.js";
import type { EquipSlot } from "../../game/src/contracts.js";
import { CAMERA } from "../../game/src/app/config.js";
import { GameDriver } from "../lib/driver.js";
import { startGameServer } from "../lib/server.js";
import { installAssetCandidates } from "../lib/assetCandidates.js";
import { installTestDeadline } from "../lib/deadline.js";

const value = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const authors = value("--authors")?.split(","), ids = value("--items")?.split(",");
const label = value("--out");
const armorMotion = process.argv.includes("--armor-motion");
const motionWeapon = process.argv.includes("--motion-weapon") ? value("--motion-weapon") : undefined;
if (!process.argv.includes("--authors") || !process.argv.includes("--items") || !authors?.length || !ids?.length
  || !label || !/^[a-z0-9-]+$/.test(label)) throw new Error("Use --authors a,b --items id,id --out label");
const out = path.resolve("test-results/item-models", label);
await mkdir(out, { recursive: true });
const assets: any[] = [], files: Record<string, string> = {};
let pack: unknown;
for (const author of authors) {
  if (!/^[a-z0-9-]+$/.test(author)) throw new Error("Invalid author");
  const directory = path.resolve("art/item-models/candidates", author);
  const catalog = JSON.parse(await readFile(path.join(directory, "catalogue.json"), "utf8"));
  pack = catalog.pack;
  for (const entry of catalog.assets) { assets.push(entry); files[entry.id] = path.join(directory, entry.file); }
}
const equipment: Partial<Record<EquipSlot, string>> = {};
for (const id of ids) {
  const item = ALL_ITEMS.find(item => item.id === id);
  if (!item?.equip || !assets.some(entry => entry.itemModel?.itemId === id)) throw new Error(`No authored wearable equipment for ${id}`);
  if (equipment[item.equip.slot]) throw new Error(`Duplicate slot ${item.equip.slot}`);
  equipment[item.equip.slot] = id;
}
if (motionWeapon) {
  const item = ALL_ITEMS.find(item => item.id === motionWeapon);
  if (!armorMotion || item?.equip?.slot !== "mainHand" || !/sword|dagger/.test(motionWeapon)
    || !assets.some(entry => entry.itemModel?.itemId === motionWeapon)) throw new Error("--motion-weapon requires --armor-motion and an authored sword or dagger");
  equipment.mainHand = motionWeapon;
}
if (armorMotion && !/sword|dagger/.test(equipment.mainHand ?? "")) throw new Error("--armor-motion requires a sword or dagger in --items or --motion-weapon");
const catalogFile = path.join(out, "catalogue.json");
await writeFile(catalogFile, JSON.stringify({ pack, assets, files }, null, 2));
const deadline = installTestDeadline("Authored item worn gate", 60000);
const server = await startGameServer();
const driver = new GameDriver(server, { viewport: { width: 1440, height: 1000 }, browserArgs: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--mute-audio"] });
const report: any = { passed: false, equipment, assets, captures: [] };
try {
  await driver.launch();
  const page = driver.page!;
  await installAssetCandidates(page, catalogFile);
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', {value:name, configurable:true});");
  await driver.open(25000, "/index.html?mode=combat");
  await page.evaluate(async equipment => {
    const lab = window.__featureLab!;
    lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true);
    lab.setLevel("melee", 99); lab.setLevel("magic", 99);
    for (const slot of ["head", "body", "legs", "feet", "hands", "mainHand", "offHand"] as const) await lab.equipPlayer(slot, null);
    for (const [slot, id] of Object.entries(equipment)) await lab.equipPlayer(slot as EquipSlot, id!);
  }, equipment);
  const read = () => page.evaluate(() => {
    const debug = window.__gameDebug as any;
    return { equipment: window.__featureLab!.getState().equipment, motion: debug.getPlayerMotion(),
      player: debug.getPlayerPosition(), camera: debug.getCamera() };
  });
  await page.waitForFunction(equipment => {
    const motion = (window.__gameDebug as any).getPlayerMotion();
    return !motion.layerLoadPending && !Object.keys(motion.attachmentLoading ?? {}).length
      && Object.entries(equipment).every(([slot, id]) => {
        const asset = `corealm_item_${id}`;
        return window.__featureLab!.getState().equipment[slot as EquipSlot] === id
          && (["mainHand", "offHand"].includes(slot) ? motion.attachments?.[slot] === `equip-${slot}-${asset}` : motion.layerAssets?.includes(asset));
      });
  }, equipment, { timeout: 10000 });
  const panel = page.locator("#panel-feature-lab");
  if (await panel.isVisible()) await panel.locator(".panel__close").click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(720, 500);
  for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);
  async function orbit(offset: number) {
    if (await page.locator(".ctx-menu").isVisible()) await page.keyboard.press("Escape");
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await read();
      const delta = Math.atan2(Math.sin(state.motion.drawnRotationY + offset - state.camera.yaw), Math.cos(state.motion.drawnRotationY + offset - state.camera.yaw));
      const dx = Math.max(-280, Math.min(280, -delta / .006));
      const dy = Math.max(-160, Math.min(160, (.4 - state.camera.pitch) / .004));
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
      await page.mouse.move(720, 500); await page.mouse.down({ button: "right" });
      await page.mouse.move(720 + dx, 500 + dy, { steps: 6 }); await page.mouse.up({ button: "right" });
    }
    await page.mouse.move(20, 600); await page.waitForTimeout(160);
    const state = await read();
    const error = Math.atan2(Math.sin(state.motion.drawnRotationY + offset - state.camera.yaw), Math.cos(state.motion.drawnRotationY + offset - state.camera.yaw));
    assert(Math.abs(error) < .025 && Math.abs(state.camera.pitch - .4) < .02, "Normal input failed to reach inspection bearing");
  }
  async function capture(name: string) {
    if (await page.locator(".ctx-menu").isVisible()) await page.keyboard.press("Escape");
    const state = await read();
    assert(!state.camera.freeMove && state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
    assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
    assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5);
    assert.deepEqual(state.motion.attachmentErrors ?? {}, {});
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 5000 });
    report.captures.push({ name, file, state, ...(armorMotion ? { afterScreenshot: await read(), capturedAtMs: Date.now(),
      phase: state.motion.duration > 0 ? state.motion.time / state.motion.duration : null,
      bearing: Math.atan2(Math.sin(state.camera.yaw - state.motion.drawnRotationY), Math.cos(state.camera.yaw - state.motion.drawnRotationY)) } : {}) });
    return state;
  }
  for (const [name, angle] of [["front", .25], ["side", Math.PI / 2], ["back", Math.PI + .25]] as const) { await orbit(angle); await capture(name); }
  await orbit(.25);
  const before = await read();
  await page.keyboard.down("w");
  try {
    await page.waitForFunction(origin => {
      const p = (window.__gameDebug as any).getPlayerPosition();
      const motion = (window.__gameDebug as any).getPlayerMotion();
      return Math.hypot(p.x - origin.x, p.z - origin.z) > 2 && motion.actionWeight > .98;
    }, before.player, { timeout: 2500 });
    const moving = await read();
    assert(/walk|run|jog/i.test(`${moving.motion.pose} ${moving.motion.clip}`));
    assert.deepEqual(moving.motion.attachments, before.motion.attachments);
    await capture("walking");
    report.movement = { from: before.player, to: moving.player, clip: moving.motion.clip };
  } finally { await page.keyboard.up("w"); }
  if (armorMotion) {
    report.armorMotion = { walking: [], attacks: [], walkingTimeScale: 1, attackTimeScale: .35,
      setup: "Lab equipment and target setup; keyboard locomotion, mouse camera orbit, production lab attack action" };
    for (const [view, key] of [["front", "s"], ["side", "d"], ["rear", "w"]] as const) {
      const origin = await read();
      const expectedBearing = view === "front" ? 0 : view === "side" ? -Math.PI / 2 : Math.PI;
      await page.keyboard.down(key);
      try {
        await page.waitForFunction(({ origin, expectedBearing }) => {
          const debug = window.__gameDebug as any, motion = debug.getPlayerMotion(), p = debug.getPlayerPosition();
          const error = debug.getCamera().yaw - motion.drawnRotationY - expectedBearing;
          return /walk|run|jog/i.test(`${motion.pose} ${motion.clip}`) && motion.actionWeight >= .98
            && Math.abs(Math.atan2(Math.sin(error), Math.cos(error))) < .08
            && Math.hypot(p.x - origin.x, p.z - origin.z) > 1;
        }, { origin: origin.player, expectedBearing }, { timeout: 2500 });
        const frames = [];
        for (const phase of [.2, .5, .8]) {
          await page.waitForFunction(phase => {
            const motion = (window.__gameDebug as any).getPlayerMotion();
            return /walk|run|jog/i.test(`${motion.pose} ${motion.clip}`) && motion.actionWeight >= .98
              && Math.abs(motion.time / motion.duration - phase) < .07;
          }, phase, { timeout: 2000, polling: "raf" });
          const state = await capture(`armor-walk-${view}-${Math.round(phase * 100)}`);
          assert(state.motion.actionWeight >= .98 && /walk|run|jog/i.test(`${state.motion.pose} ${state.motion.clip}`));
          const bearingError = state.camera.yaw - state.motion.drawnRotationY - expectedBearing;
          assert(Math.abs(Math.atan2(Math.sin(bearingError), Math.cos(bearingError))) < .15, `Walking ${view} bearing did not settle`);
          assert.deepEqual(state.motion.layerAssets, before.motion.layerAssets);
          frames.push(state);
        }
        assert(Math.hypot(frames.at(-1)!.player.x - origin.player.x, frames.at(-1)!.player.z - origin.player.z) > 1);
        report.armorMotion.walking.push({ view, key, before: origin, frames });
      } finally { await page.keyboard.up(key); }
    }
    await page.evaluate(() => (window.__gameDebug as any).setTimeScale(.35));
    try {
      for (const [view, angle] of [["front", .25], ["side", Math.PI / 2], ["rear", Math.PI + .25]] as const) {
        const combatBefore = await page.evaluate(async () => {
          const lab = window.__featureLab!;
          await lab.perform("reset-player");
          return lab.spawnTarget("creature", lab.getCatalog().targets.creature[0]!.id, { distance: 2 });
        });
        await page.mouse.move(720, 500);
        for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);
        await orbit(angle);
        await page.evaluate(() => window.__featureLab!.perform("attack"));
        const frames = [];
        for (const phase of [.4, .65]) {
          await page.waitForFunction(phase => {
            const motion = (window.__gameDebug as any).getPlayerMotion();
            return /attack|melee/i.test(`${motion.pose} ${motion.clip}`) && motion.actionWeight >= .8
              && Math.abs(motion.time / motion.duration - phase) < .06;
          }, phase, { timeout: 5000, polling: "raf" });
          const state = await capture(`armor-attack-${view}-${Math.round(phase * 100)}`);
          assert(state.motion.actionWeight >= .8 && /attack|melee/i.test(`${state.motion.pose} ${state.motion.clip}`));
          assert.deepEqual(state.motion.layerAssets, before.motion.layerAssets);
          frames.push(state);
        }
        await page.waitForFunction(before => {
          const state = window.__featureLab!.getState();
          return state.counters.combatStarted > before.counters.combatStarted
            && typeof state.target?.health === "number" && state.target.health < (before.target?.health ?? 0);
        }, combatBefore, { timeout: 5000 });
        report.armorMotion.attacks.push({ view, before: combatBefore, frames, after: await page.evaluate(() => window.__featureLab!.getState()) });
      }
    } finally { await page.evaluate(() => (window.__gameDebug as any).setTimeScale(1)); }
  }
  if (!armorMotion && (equipment.mainHand?.includes("sword") || equipment.mainHand?.includes("dagger"))) {
    const combatBefore = await page.evaluate(async () => {
      const lab = window.__featureLab!;
      await lab.perform("reset-player");
      const preset = lab.getCatalog().targets.creature[0]!;
      return lab.spawnTarget("creature", preset.id, { distance: 2 });
    });
    await page.mouse.move(720, 500);
    for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);
    await orbit(.7);
    await page.evaluate(() => window.__featureLab!.perform("attack"));
    await page.waitForFunction(() => {
      const motion = (window.__gameDebug as any).getPlayerMotion();
      return /attack|melee/i.test(`${motion.pose} ${motion.clip}`);
    }, undefined, { timeout: 5000 });
    await capture("attack");
    await page.waitForFunction(before => {
      const state = window.__featureLab!.getState();
      return state.counters.combatStarted > before.counters.combatStarted
        && typeof state.target?.health === "number" && state.target.health < (before.target?.health ?? 0);
    }, combatBefore, { timeout: 5000 });
    report.combat = { before: combatBefore, after: await page.evaluate(() => window.__featureLab!.getState()) };
  }
  if (process.argv.includes("--cast")) {
    const castBefore = await page.evaluate(async () => {
      const lab = window.__featureLab!;
      await lab.perform("reset-player");
      (window.__gameDebug as any).giveItem("earth_essence", 20, "inventory");
      lab.setSpell("stonebrand");
      return lab.spawnTarget("creature", lab.getCatalog().targets.creature[0]!.id, { distance: 5 });
    });
    await page.mouse.move(720, 500);
    for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);
    await orbit(.7);
    await page.evaluate(() => window.__featureLab!.perform("cast"));
    await page.waitForFunction(() => /cast|magic/i.test(`${(window.__gameDebug as any).getPlayerMotion().pose} ${(window.__gameDebug as any).getPlayerMotion().clip}`), undefined, { timeout: 5000 });
    await capture("casting");
    await page.waitForFunction(before => {
      const state = window.__featureLab!.getState();
      return state.counters.spellLaunched > before.counters.spellLaunched && typeof state.target?.health === "number" && state.target.health < (before.target?.health ?? 0);
    }, castBefore, { timeout: 8000 });
    report.casting = { before: castBefore, after: await page.evaluate(() => window.__featureLab!.getState()) };
  }
  if (process.argv.includes("--sweep")) {
    await page.evaluate(() => window.__featureLab!.perform("reset-player"));
    await page.mouse.move(720, 500);
    for (let index = 0; index < 25; index++) await page.mouse.wheel(0, -100);
    report.heldItems = [];
    for (const entry of assets) {
      const item = ALL_ITEMS.find(item => item.id === entry.itemModel?.itemId);
      const slot = item?.equip?.slot;
      if (!item || (slot !== "mainHand" && slot !== "offHand")) continue;
      await page.evaluate(async ({ slot, id }) => { await window.__featureLab!.equipPlayer(slot, id); }, { slot, id: item.id });
      await page.waitForFunction(({ slot, asset }) => {
        const motion = (window.__gameDebug as any).getPlayerMotion();
        return motion.attachments?.[slot] === `equip-${slot}-${asset}` && !Object.keys(motion.attachmentLoading ?? {}).length;
      }, { slot, asset: entry.id }, { timeout: 5000 });
      for (const [name, angle] of [["front", .7], ["back", Math.PI + .45]] as const) {
        await orbit(angle); await capture(`${item.id}-${name}`);
      }
      report.heldItems.push({ itemId: item.id, slot, sha256: entry.sha256 });
    }
  }
  assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.consoleErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  await driver.page?.screenshot({ path: path.join(out, "failure.png"), timeout: 3000 }).catch(() => {});
} finally {
  await driver.close(); await server.close(); deadline();
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, out }));
}
