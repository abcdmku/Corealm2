import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EquipSlot } from '../../game/src/contracts.js';
import { CAMERA } from '../../game/src/app/config.js';
import { DEFAULT_SETTINGS } from '../../game/src/ui/settings.js';
import { gearAppearanceParts } from '../../game/src/render/equipmentVisuals.js';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';

// Run only after visual shards. Root owns this serialized 60-second GPU job.
const args = process.argv.slice(2);
const started = Date.now();
const deadline = installTestDeadline('Retextured original equipment combat', 60_000);
const out = path.join(repoRoot, argValue(args, '--out') ?? 'test-results/equipment-retexture/combat');
const catalogue = path.join(repoRoot, 'art/equipment-retexture/candidates/catalog.json');
const external = argValue(args, '--url');
const server = external ? { url: external, close: async () => {} } : await startGameServer();
const driver = new GameDriver(server, {
  headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
  browserArgs: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])],
});
const equipment: Record<EquipSlot, string | null> = {
  head: 'corven_helm', body: 'corven_plate', legs: 'corven_greaves', feet: 'corven_boots',
  hands: 'corven_gauntlets', mainHand: 'corven_sword', offHand: null, accessory1: null, accessory2: null, ring2: null, earring2: null };
const report: any = { passed: false, captures: [], actions: [], equipment,
  setup: 'Production lab equipment and target controls. Normal mouse orbit at nearest gameplay zoom. Diagnostic .35 simulation speed during action capture, restored before damage receipt.' };
let stage = 'boot';
function remaining(limit = 5000): number {
  const available = 56_000 - (Date.now() - started);
  assert(available > 0, `Budget exhausted during ${stage}`);
  return Math.min(limit, available);
}
try {
  await mkdir(out, { recursive: true });
  await driver.launch();
  const page = driver.page!;
  page.setDefaultTimeout(3000);
  await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
  report.candidateIds = await installAssetCandidates(page, catalogue);
  report.assets = JSON.parse(await readFile(catalogue, 'utf8')).assets;
  await driver.open(remaining(20_000), '/index.html?mode=combat&equipmentTextures=1' + (args.includes('--armor-detail') ? '&armorDetail=1' : ''));
  const documentId = await page.evaluate(() => performance.timeOrigin);
  await page.evaluate(async equipment => {
    const lab = window.__featureLab!;
    lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true);
    lab.setLevel('melee', 99); lab.setLevel('magic', 99);
    await lab.equipPlayer('offHand', null); await lab.equipPlayer('mainHand', null);
    for (const [slot, id] of Object.entries(equipment)) await lab.equipPlayer(slot as EquipSlot, id);
  }, equipment);
  const read = () => page.evaluate(() => {
    const d = window.__gameDebug as any;
    return { lab: window.__featureLab!.getState(), motion: d.getPlayerMotion(), camera: d.getCamera(), player: d.getPlayerPosition() };
  });
  const skin = Object.values(equipment).flatMap(id => id ? gearAppearanceParts(id) : [])
    .filter(part => part.attach === 'skin').map(part => part.assetId);
  async function readyWeapon(id: string) {
    const asset = gearAppearanceParts(id).find(part => part.slot === 'mainHand')!.assetId;
    await page.waitForFunction(({ asset, skin, id }) => {
      const m = (window.__gameDebug as any).getPlayerMotion();
      return window.__featureLab!.getState().equipment.mainHand === id && !m.layerLoadPending
        && skin.every(part => m.layerAssets?.includes(part))
        && m.attachments?.mainHand === `equip-mainHand-${asset}`
        && !Object.keys(m.attachmentLoading ?? {}).length && !Object.keys(m.attachmentErrors ?? {}).length;
    }, { asset, skin, id }, { timeout: remaining(7000) });
    await page.evaluate(async () => {
      const url = '/src/render/equipmentSurfaceTextures.ts';
      const textures = await import(/* @vite-ignore */ url);
      await textures.preloadEquipmentSurfaceTextures();
      const armorUrl = '/src/render/equipmentArmorTextures.ts';
      const armor = await import(/* @vite-ignore */ armorUrl);
      await armor.equipmentArmorTexturesReady();
    });
  }
  await readyWeapon('corven_sword');
  const panel = page.locator('#panel-feature-lab');
  if (await panel.isVisible()) await panel.locator('.panel__close').click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  async function orbit(offset: number) {
    if (await page.locator('.ctx-menu').isVisible()) await page.keyboard.press('Escape');
    await page.mouse.move(720, 510);
    for (let i = 0; i < 25; i++) {
      if ((await read()).camera.requestedDistance <= CAMERA.minDistance + .001) break;
      await page.mouse.wheel(0, -100); await page.waitForTimeout(20);
    }
    for (let i = 0; i < 3; i++) {
      const state = await read();
      const delta = Math.atan2(Math.sin(state.motion.drawnRotationY + offset - state.camera.yaw), Math.cos(state.motion.drawnRotationY + offset - state.camera.yaw));
      const dx = Math.max(-280, Math.min(280, -delta / .006));
      const dy = Math.max(-160, Math.min(160, (DEFAULT_SETTINGS.invertCameraY ? 1 : -1) * (.4 - state.camera.pitch) / .004));
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
      await page.mouse.move(720, 510); await page.mouse.down({ button: 'right' });
      await page.mouse.move(720 + dx, 510 + dy, { steps: 6 }); await page.mouse.up({ button: 'right' });
    }
    await page.mouse.move(20, 600); await page.waitForTimeout(120);
  }
  async function capture(name: string) {
    const state = await read();
    assert(!state.camera.freeMove);
    assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.minDistance + .01);
    assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
    assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5);
    assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < 2.5);
    assert(skin.every(id => state.motion.layerAssets.includes(id)));
    assert(!(state.motion.layerMeshes ?? []).some((name: string) => /scarf/i.test(name)));
    assert.deepEqual(state.motion.attachmentErrors ?? {}, {});
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: remaining(5000) });
    report.captures.push({ name, file, beforeScreenshot: state, afterScreenshot: await read() });
    return state;
  }
  for (const action of ['attack', 'cast'] as const) {
    stage = action;
    const weapon = action === 'attack' ? 'corven_sword' : 'basic_wooden_staff';
    await page.evaluate(async weapon => {
      const lab = window.__featureLab!;
      await lab.perform('reset-player');
      await lab.equipPlayer('mainHand', weapon);
    }, weapon);
    await readyWeapon(weapon);
    const before = await page.evaluate(async action => {
      const lab = window.__featureLab!;
      if (action === 'cast') {
        (window.__gameDebug as any).giveItem('earth_essence', 20, 'inventory');
        lab.setSpell('stonebrand');
      }
      return lab.spawnTarget('creature', lab.getCatalog().targets.creature[0]!.id, { distance: action === 'attack' ? 2 : 5 });
    }, action);
    await orbit(action === 'attack' ? .25 : Math.PI / 2);
    await capture(`${action}-before`);
    await page.evaluate(() => (window.__gameDebug as any).setTimeScale(.35));
    let frame;
    try {
      await page.evaluate(action => window.__featureLab!.perform(action), action);
      await page.waitForFunction(action => {
        const m = (window.__gameDebug as any).getPlayerMotion();
        const pose = `${m.pose} ${m.clip}`;
        const phase = m.duration > 0 ? m.time / m.duration : 0;
        return (action === 'attack' ? /attack|melee/i.test(pose) : /cast|spell|magic/i.test(pose))
          && m.actionWeight >= .8 && phase >= .3 && phase <= .7;
      }, action, { timeout: remaining(6500), polling: 'raf' });
      frame = await capture(`${action}-active`);
      assert(frame.motion.actionWeight >= .8);
      assert(action === 'attack' ? /attack|melee/i.test(`${frame.motion.pose} ${frame.motion.clip}`) : /cast|spell|magic/i.test(`${frame.motion.pose} ${frame.motion.clip}`));
    } finally { await page.evaluate(() => (window.__gameDebug as any).setTimeScale(1)); }
    await page.waitForFunction(({ action, before }) => {
      const state = window.__featureLab!.getState();
      const event = action === 'attack' ? 'combatStarted' : 'spellLaunched';
      return state.counters[event] > before.counters[event] && typeof state.target?.health === 'number'
        && state.target.health < (before.target?.health ?? 0);
    }, { action, before }, { timeout: remaining(8000), polling: 50 });
    report.actions.push({ action, weapon, before, frame, after: await read() });
  }
  assert.equal(await page.evaluate(() => performance.timeOrigin), documentId);
  report.gameErrors = await driver.callDebug('getErrors');
  assert.deepEqual(report.gameErrors, []);
  assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []); assert.deepEqual(driver.requestErrors, []);
  report.passed = true;
} catch (error) {
  report.error = String(error); process.exitCode = 1;
  await driver.page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 2000 }).catch(() => {});
} finally {
  await driver.page?.evaluate(() => (window.__gameDebug as any)?.setTimeScale(1)).catch(() => {});
  report.stage = stage; report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requestErrors = driver.requestErrors;
  await driver.close(); await server.close();
  report.elapsedMs = Date.now() - started;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  deadline();
  console.log(JSON.stringify({ passed: report.passed, stage, elapsedMs: report.elapsedMs, error: report.error, out }));
}
