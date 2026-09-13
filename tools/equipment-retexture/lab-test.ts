/** Original Knight armour and every held item through the production renderer.
 * Root runs one lab shard per 60-second serialized GPU job. --list enumerates shards.
 * A representative --world --case smoke uses the documented 120-second full-world budget.
 * --world checks promoted file hashes and uses real inventory/equip tools in the authored world.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { ALL_ITEMS } from '../../game/src/content/items.js';
import type { EquipSlot } from '../../game/src/contracts.js';
import { CAMERA } from '../../game/src/app/config.js';
import { DEFAULT_SETTINGS } from '../../game/src/ui/settings.js';
import { gearAppearanceParts } from '../../game/src/render/equipmentVisuals.js';
import { equipmentArmorTexturesEnabled } from '../../game/src/render/equipmentArmorTextures.js';
import { GameDriver } from '../lib/driver.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';
import { startGameServer } from '../lib/server.js';

type Point = { x: number; y: number; z: number };
interface CameraState {
  yaw: number; pitch: number; requestedDistance: number; freeMove: boolean; target: Point;
}
interface PlayerMotion {
  pose: string; clip: string | null; time: number; drawnRotationY: number;
  layerLoadPending?: boolean; layerAssets?: string[]; layerMeshes?: string[];
  attachments?: Record<string, string>; attachmentLoading?: Record<string, string>; attachmentErrors?: Record<string, string>;
}
interface RenderProfile {
  draws: { name: string; pass: string; calls: number; triangles: number; objects: number[];
    materials: { name: string; mapUuid: string | null }[] }[];
}
interface EquipmentDebug {
  getPlayerPosition(): Point;
  getPlayerMotion(): PlayerMotion;
  getCamera(): CameraState;
  getRenderProfile(prefix?: string): RenderProfile;
  getErrors(): unknown[];
}
interface Case {
  id: string;
  equipment: Record<EquipSlot, string | null>;
}

function kit(metal: string): Record<EquipSlot, string | null> {
  return { head: `${metal}_helm`, body: `${metal}_${metal === 'grithe' ? 'cuirass' : 'plate'}`,
    legs: `${metal}_greaves`, feet: `${metal}_boots`, hands: `${metal}_${metal === 'grithe' ? 'gloves' : 'gauntlets'}`,
    mainHand: `${metal}_sword`, offHand: null, accessory1: null, accessory2: null , ring2: null, earring2: null };
}
const armour = ['grithe', 'corven', 'kaldite', 'emberite', 'cindersteel', 'nightglass']
  .map(metal => ({ id: metal, equipment: kit(metal) }));
const heldItems = ALL_ITEMS.filter(item => gearAppearanceParts(item.id)
  .some(part => part.attach === 'bone' && ['mainHand', 'offHand'].includes(part.slot)));
const CASES: Record<string, Case[]> = {
  'melee-low': armour.slice(0, 3),
  'melee-high': [...armour.slice(3), { id: 'nightmarshal-plate', equipment: { ...kit('nightglass'), body: 'nightmarshal_plate' } }],
};
for (let i = 0; i < heldItems.length; i += 6) {
  CASES[`weapons-${String.fromCharCode(97 + i / 6)}`] = heldItems.slice(i, i + 6).map(item => {
    const slot = gearAppearanceParts(item.id).find(part => ['mainHand', 'offHand'].includes(part.slot))!.slot;
    return { id: item.id, equipment: { ...kit('grithe'), [slot]: item.id } };
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shard = argValue(args, '--set') ?? 'melee-low';
  const selectedCase = argValue(args, '--case');
  const cases = selectedCase ? CASES[shard]?.filter(row => row.id === selectedCase) : CASES[shard];
  if (args.includes('--list')) { console.log(JSON.stringify(Object.fromEntries(Object.entries(CASES).map(([id, rows]) => [id, rows.map(row => row.id)])), null, 2)); return; }
  assert(cases?.length, `Use --set ${Object.keys(CASES).join(', ')} and a valid --case`);
  const started = Date.now();
  const world = args.includes('--world');
  const ornateArmor = args.includes('--armor-detail') || equipmentArmorTexturesEnabled();
  const body = args.includes('--female') ? 'female' : 'male';
  assert(!world || body === 'male', 'Female body selection is currently a lab fixture only');
  const budgetMs = world ? 120_000 : 60_000;
  const deadline = installTestDeadline(`Existing equipment textures ${shard}`, budgetMs);
  const cataloguePath = path.join(repoRoot, 'art/equipment-retexture/candidates/catalog.json');
  const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
  const assetHashes = await Promise.all(catalogue.assets.map(async (entry: { id: string; file: string; sha256: string; bytes: number }) => {
    const file = world ? path.join(repoRoot, 'game/public/assets', entry.file) : path.resolve(path.dirname(cataloguePath), catalogue.files?.[entry.id] ?? entry.file);
    const bytes = await readFile(file);
    const actual = createHash('sha256').update(bytes).digest('hex');
    assert.equal(actual, entry.sha256, `Stale ${entry.id}`);
    assert.equal(bytes.length, entry.bytes);
    return { id: entry.id, file, sha256: actual, bytes: bytes.length };
  }));
  const external = argValue(args, '--url');
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
      '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  const out = path.join(repoRoot, argValue(args, '--out') ?? `test-results/equipment-retexture/${shard}`);
  const report: Record<string, unknown> = {
    passed: false, shard, body, assetHashes, route: world ? '/index.html' : `/index.html?mode=combat&equipmentTextures=1&body=${body}${ornateArmor ? '&armorDetail=1' : ''}`, cases: [] as unknown[],
    bodyEvidence: `These captures prove the production ${body} rig.`,
    setup: 'Production equipPlayer controls grant the selected gear in transient lab state. Walking and camera orbit use keyboard and mouse input. No detached focus or camera target lift.',
    visualAcceptance: 'Root must inspect full-size front, back, side and walking images. Weapon shards prove loaded materials and attachments; combat damage is outside this visual gate.',
  };
  let stage = 'boot';
  const remaining = (limit = 5000): number => {
    const available = budgetMs - 4000 - (Date.now() - started);
    assert(available > 0, `Equipment operation budget exhausted during ${stage}`);
    return Math.max(1, Math.min(limit, available));
  };
  try {
    await mkdir(out, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    if (!world) report.candidateIds = await installAssetCandidates(page, cataloguePath);
    await driver.open(remaining(world ? 60_000 : 20_000), report.route as string);
    if (world) {
      await page.evaluate(async () => {
        const d = window.__gameDebug as any;
        const equipment = async () => {
          const inventory = await d.callTool('corealm_inventory', {});
          if (inventory.error) throw new Error(JSON.stringify(inventory));
          return Object.fromEntries(Object.entries(inventory.equipment.slots).map(([slot, stack]) => [slot, (stack as { itemId: string } | null)?.itemId ?? null]));
        };
        let worn = await equipment();
        d.setSkillLevel('melee', 99); d.setSkillLevel('magic', 99);
        window.__featureLab = {
          getState: () => ({ ready: true, playerVisible: true, equipment: worn, movement: { mode: /walk|jog|run/i.test(d.getPlayerMotion().pose) ? 'moving' : 'idle' } }),
          setFreeCameraEnabled: () => {}, setWalkingEnabled: () => {}, setLevel: () => {},
          equipPlayer: async (slot: string, id: string | null) => {
            if (id) {
              d.giveItem(id, 1, 'inventory');
              const result = await d.callTool('corealm_equip', { itemId: id });
              if (result.error) throw new Error(JSON.stringify(result));
            } else if (worn[slot]) {
              const result = await d.callTool('corealm_equip', { unequipSlot: slot });
              if (result.error) throw new Error(JSON.stringify(result));
            }
            worn = await equipment();
          },
        } as any;
      });
    }
    const documentId = await page.evaluate(() => performance.timeOrigin);
    const initial = await page.evaluate(() => window.__featureLab!.getState());
    assert(initial.ready && initial.playerVisible, 'Production player rig must be ready and visible');
    await page.evaluate(() => {
      const lab = window.__featureLab!;
      lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true);
      lab.setLevel('melee', 99); lab.setLevel('magic', 99);
    });
    const panel = page.locator('#panel-feature-lab');
    if (await panel.isVisible()) await panel.locator('.panel__close').click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const read = () => page.evaluate(() => {
      const debug = window.__gameDebug as unknown as EquipmentDebug;
      return { lab: window.__featureLab!.getState(), motion: debug.getPlayerMotion(),
        camera: debug.getCamera(), player: debug.getPlayerPosition() };
    });
    // Use the actual wheel control to reach the nearest legal gameplay view.
    await page.mouse.move(720, 510);
    for (let i = 0; i < 20; i++) {
      const { camera } = await read();
      if (camera.requestedDistance <= CAMERA.minDistance + .001) break;
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(30);
    }
    async function facePlayer(offset = .25): Promise<void> {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { motion, camera } = await read();
        const yaw = motion.drawnRotationY + offset;
        const delta = Math.atan2(Math.sin(yaw - camera.yaw), Math.cos(yaw - camera.yaw));
        const dx = Math.max(-280, Math.min(280, -delta / .006));
        const pitchSign = DEFAULT_SETTINGS.invertCameraY ? 1 : -1;
        const dy = Math.max(-160, Math.min(160, pitchSign * (.4 - camera.pitch) / .004));
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        await page.mouse.move(720, 510); await page.mouse.down({ button: 'right' });
        await page.mouse.move(720 + dx, 510 + dy, { steps: 6 });
        await page.mouse.up({ button: 'right' });
      }
      await page.waitForTimeout(120);
      assert(Math.abs((await read()).camera.pitch - .4) < .015, 'Normal orbit input must reach the requested readable pitch');
    }
    async function capture(name: string): Promise<unknown> {
      remaining(1);
      const state = await read();
      assert.equal(state.camera.freeMove, false);
      assert(!(state.motion.layerMeshes ?? []).some(name => /scarf/i.test(name)), 'Scarf mesh is still loaded');
      assert(!(state.motion.layerAssets ?? []).some(name => /scarf/i.test(name)), 'Scarf asset is still loaded');
      assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
      assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
      assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < 2.5);
      assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5, 'Camera must retain normal player focus height');
      const file = path.join(out, `${name}.png`);
      await page.screenshot({ path: file, timeout: remaining(5000) });
      return { file, camera: state.camera, player: state.player, motion: state.motion };
    }

    for (const scenario of cases) {
      stage = scenario.id;
      const before = await read();
      const appearances = Object.values(scenario.equipment).flatMap(id => id ? gearAppearanceParts(id, body) : []);
      const skin = appearances.filter(part => part.attach === 'skin').map(part => part.assetId);
      const attachments = Object.fromEntries(appearances.filter(part => part.attach === 'bone')
        .map(part => [part.slot, `equip-${part.slot}-${part.assetId}`]));
      assert(skin.length >= 6 && skin.every(id => id.startsWith(`outfit_${body}_knight_`)) && attachments.mainHand, 'Scenario must include complete visible armour and a held weapon');
      await page.evaluate(async equipment => {
        const lab = window.__featureLab!;
        await lab.equipPlayer('offHand', null);
        await lab.equipPlayer('mainHand', null);
        for (const [slot, id] of Object.entries(equipment)) {
          if (slot !== 'mainHand') await lab.equipPlayer(slot as EquipSlot, id);
        }
        await lab.equipPlayer('mainHand', equipment.mainHand);
      }, scenario.equipment);
      await page.waitForFunction(({ equipment, skin, attachments }) => {
        const d = window.__gameDebug as unknown as EquipmentDebug;
        const worn = window.__featureLab!.getState().equipment;
        const motion = d.getPlayerMotion();
        return Object.entries(equipment).every(([slot, id]) => worn[slot as EquipSlot] === id)
          && !motion.layerLoadPending && skin.every(id => motion.layerAssets?.includes(id))
          && Object.entries(attachments).every(([slot, id]) => motion.attachments?.[slot] === id)
          && Object.keys(motion.attachmentLoading ?? {}).length === 0
          && Object.keys(motion.attachmentErrors ?? {}).length === 0;
      }, { equipment: scenario.equipment, skin, attachments }, { timeout: remaining(7000), polling: 60 });
      await page.evaluate(async () => {
        const url = '/src/render/equipmentSurfaceTextures.ts';
        const textures = await import(/* @vite-ignore */ url);
        if (textures.equipmentSurfaceTexturesReady) await textures.equipmentSurfaceTexturesReady();
        const armorUrl = '/src/render/equipmentArmorTextures.ts';
        const armor = await import(/* @vite-ignore */ armorUrl);
        await armor.equipmentArmorTexturesReady();
      });
      await page.waitForLoadState('networkidle', { timeout: remaining(5000) });
      await facePlayer();
      const equipped = await read();
      assert.deepEqual(equipped.lab.equipment, scenario.equipment);
      const profiles = await page.evaluate((heldPrefix) => {
        const d = window.__gameDebug as unknown as EquipmentDebug;
        const names = d.getPlayerMotion().layerMeshes ?? [];
        const prefix = names[0]?.startsWith('merged-') ? 'merged-' : 'part-';
        // The unfiltered profile returns only the 40 largest draws. In the full
        // world those are terrain and foliage, so request equipment explicitly.
        const armourProfile = d.getRenderProfile(prefix);
        // File-backed Corealm weapons, runtime daggers, and the original imported
        // boss node names all remain distinct from the worn armour draws.
        const heldNames = /^(?:corealm-weapon-|equipment-dagger-|STAFF_02_V2(?:_|$)|SW15(?:_|$))/;
        const heldProfile = d.getRenderProfile(heldPrefix);
        return { armour: armourProfile,
          held: { ...heldProfile, draws: heldProfile.draws.filter(row => heldNames.test(row.name)) } };
      }, attachments.mainHand.includes('dagger') ? 'equipment-dagger-'
        : attachments.mainHand.includes('miniboss_staff') ? 'STAFF_02_V2'
        : attachments.mainHand.includes('miniboss_sword') ? 'SW15' : 'corealm-weapon-');
      const layers = profiles.armour.draws.filter(row => row.pass.startsWith('colour')
        && (equipped.motion.layerMeshes ?? []).includes(row.name) && row.triangles > 0);
      assert(layers.length, `${scenario.id}: armour never reached the colour pass`);
      const held = profiles.held.draws.filter(row => row.pass.startsWith('colour') && row.triangles > 0);
      assert(held.length, `${scenario.id}: held equipment never reached the colour pass`);
      for (const slot of ['mainHand', 'offHand'] as const) {
        const id = scenario.equipment[slot];
        if (!id) continue;
        const appearance = gearAppearanceParts(id)[0]!;
        const treatment = `|gear:${appearance.tint ?? 'native'}:${appearance.accent ?? 'none'}`;
        assert(held.some(row => row.materials.some(material => material.name.includes(treatment))),
          `${scenario.id}: ${slot} did not render its selected reward or tier material`);
      }
      const bodyTint = gearAppearanceParts(scenario.equipment.body!)[0]!.tint!;
      const bodyTier = scenario.equipment.body!.split('_')[0];
      const armorIdentity = ornateArmor ? `|armor:${bodyTier === 'nightmarshal' ? 'nightglass' : bodyTier}` : `|gear:${bodyTint}:`;
      assert(layers.some(row => row.materials.some(material => material.name.includes(armorIdentity))),
        `${scenario.id}: rendered armour material does not carry the selected tier colour`);
      assert(layers.some(row => row.materials.some(material => material.mapUuid)),
        `${scenario.id}: the worn armour lost its authored surface texture`);
      const front = await capture(`${scenario.id}-front`);
      await facePlayer(shard.startsWith('melee') ? Math.PI + .25 : Math.PI / 2);
      const reverse = await capture(`${scenario.id}-${shard.startsWith('melee') ? 'back' : 'side'}`);
      if (!shard.startsWith('melee')) {
        (report.cases as unknown[]).push({ id: scenario.id, before: before.lab.equipment, after: equipped.lab.equipment, expectedAppearances: appearances, profiles, front, side: reverse });
        continue;
      }
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let moving: Awaited<ReturnType<typeof read>>;
      let walking: unknown;
      await page.keyboard.down('w');
      try {
        await page.waitForFunction(origin => {
          const d = window.__gameDebug as unknown as EquipmentDebug;
          const p = d.getPlayerPosition();
          return Math.hypot(p.x - origin.x, p.z - origin.z) > .8;
        }, equipped.player, { timeout: remaining(2500), polling: 50 });
        moving = await read();
        assert(/walk|jog|run/i.test(`${moving.motion.pose} ${moving.motion.clip}`), 'W must run a real locomotion clip');
        assert.deepEqual(moving.motion.attachments, equipped.motion.attachments, 'Walking lost or replaced a held attachment');
        walking = await capture(`${scenario.id}-walking`);
      } finally {
        await page.keyboard.up('w');
      }
      // A normal orbit can leave the lab target selected. Cancel any queued pursuit
      // through the production stop action after the keyboard locomotion proof.
      const released = await read();
      await page.evaluate(async () => {
        const result = await (window.__gameDebug as any).callTool('corealm_stop', {});
        if (result.error) throw new Error(JSON.stringify(result));
      });
      await page.waitForFunction(() => window.__featureLab!.getState().movement.mode === 'idle', undefined,
        { timeout: remaining(3000), polling: 50 });
      (report.cases as unknown[]).push({ id: scenario.id, before: before.lab.equipment,
        after: equipped.lab.equipment, expectedAppearances: appearances,
        visibleLayers: equipped.motion.layerAssets, attachments: equipped.motion.attachments,
        profiles, movement: { from: equipped.player, to: moving!.player, clip: moving!.motion.clip, afterKeyRelease: released.lab.movement }, front, back: reverse, walking });
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentId, 'Document reloaded during acceptance');
    report.gameErrors = await driver.callDebug('getErrors');
    assert.deepEqual(report.gameErrors, []);
    assert.deepEqual(driver.consoleErrors, []);
    assert.deepEqual(driver.pageErrors, []);
    assert.deepEqual(driver.requestErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = String(error);
    process.exitCode = 1;
    await driver.page?.keyboard.up('w').catch(() => {});
    await driver.page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 3000 }).catch(() => {});
  } finally {
    report.stage = stage;
    report.consoleErrors = driver.consoleErrors;
    report.pageErrors = driver.pageErrors;
    report.requestErrors = driver.requestErrors;
    await driver.close(); await server.close();
    report.elapsedMs = Date.now() - started;
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    deadline();
    console.log(JSON.stringify({ passed: report.passed, shard, elapsedMs: report.elapsedMs,
      cases: (report.cases as unknown[]).length, error: report.error, out }));
  }
}
await main();
