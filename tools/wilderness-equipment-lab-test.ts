/**
 * Production worn/held equipment, real walking and normal player-follow camera.
 * Each shard has one 60-second deadline including startup, captures and cleanup.
 *
 * npx tsx tools/wilderness-equipment-lab-test.ts --set melee --url http://127.0.0.1:4174
 * Repeat --set magic and --set keepers as separate serialized GPU jobs.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { EquipSlot } from '../game/src/contracts.js';
import { CAMERA } from '../game/src/app/config.js';
import { DEFAULT_SETTINGS } from '../game/src/ui/settings.js';
import { WILDERNESS_CRAFTING_TIERS } from '../game/src/content/wildernessLoot.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';
import { argValue, repoRoot } from './lib/paths.js';
import { startGameServer } from './lib/server.js';

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

function kit(tier: 50 | 70, kind: 'melee' | 'magic', weapon: 'wand' | 'staff' = 'staff'): Record<EquipSlot, string | null> {
  const row = WILDERNESS_CRAFTING_TIERS.find(row => row.tier === tier)!;
  return kind === 'melee' ? {
    head: `${row.metal}_helm`, body: `${row.metal}_plate`, legs: `${row.metal}_greaves`,
    feet: `${row.metal}_boots`, hands: `${row.metal}_gauntlets`, mainHand: `${row.metal}_sword`,
    offHand: `${row.wood}_shield`, accessory1: `${row.metal}_ring`, accessory2: `${row.metal}_pendant`, ring2: null, earring2: null } : {
    head: `${row.hide}_hood`, body: `${row.hide}_robe`, legs: `${row.hide}_leggings`,
    feet: `${row.hide}_boots`, hands: `${row.hide}_wraps`, mainHand: `${row.wood}_${weapon}`,
    offHand: null, accessory1: `${row.jewellery}_ring`, accessory2: `${row.jewellery}_charm`, ring2: null, earring2: null };
}

const CASES: Readonly<Record<string, readonly Case[]>> = {
  melee: [50, 70].map(tier => ({ id: `melee-t${tier}`, equipment: kit(tier as 50 | 70, 'melee') })),
  magic: [50, 70].flatMap(tier => (['staff', 'wand'] as const).map(weapon => ({
    id: `magic-t${tier}-${weapon}`, equipment: kit(tier as 50 | 70, 'magic', weapon),
  }))),
  keepers: [
    { id: 'ashseal-guard', equipment: { ...kit(50, 'melee'), offHand: 'ashseal_guard' } },
    { id: 'regent-staff', equipment: { ...kit(50, 'magic'), mainHand: 'regent_staff' } },
    { id: 'chainbound-sword', equipment: { ...kit(70, 'melee'), mainHand: 'chainbound_sword' } },
    { id: 'nightmarshal-plate', equipment: { ...kit(70, 'melee'), body: 'nightmarshal_plate' } },
    { id: 'hollowstar-staff', equipment: { ...kit(70, 'magic'), mainHand: 'hollowstar_staff' } },
  ],
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shard = argValue(args, '--set') ?? 'melee';
  const cases = CASES[shard];
  assert(cases, 'Use --set melee, magic or keepers; each is a separate 60-second job');
  const started = Date.now();
  const deadline = installTestDeadline(`Wilderness equipment ${shard}`, 60_000);
  const external = argValue(args, '--url');
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
      '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  const out = path.join(repoRoot, argValue(args, '--out') ?? `test-results/wilderness-equipment-lab/${shard}`);
  const report: Record<string, unknown> = {
    passed: false, shard, body: 'male', route: '/index.html?mode=combat', cases: [] as unknown[],
    femaleEvidence: 'Both female appearance mappings pass the unit asset/slot check. This lab has no body selector, so these captures prove the production male rig only.',
    setup: 'Production equipPlayer controls grant the selected gear in transient lab state. Walking and camera orbit use keyboard and mouse input. No detached focus or camera target lift.',
    visualAcceptance: 'Root must inspect the full-size front and walking images, especially the five keeper rewards.',
  };
  let stage = 'boot';
  const remaining = (limit = 5000): number => {
    const available = 56_000 - (Date.now() - started);
    assert(available > 0, `Equipment operation budget exhausted during ${stage}`);
    return Math.max(1, Math.min(limit, available));
  };
  try {
    await mkdir(out, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    await driver.open(remaining(20_000), report.route as string);
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
    async function facePlayer(): Promise<void> {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { motion, camera } = await read();
        const yaw = motion.drawnRotationY + .25;
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
      const appearances = Object.values(scenario.equipment).flatMap(id => id ? gearAppearanceParts(id) : []);
      const skin = appearances.filter(part => part.attach === 'skin').map(part => part.assetId);
      const attachments = Object.fromEntries(appearances.filter(part => part.attach === 'bone')
        .map(part => [part.slot, `equip-${part.slot}-${part.assetId}`]));
      assert(skin.length >= 6 && attachments.mainHand, 'Scenario must include complete visible armour and a held weapon');
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
      await facePlayer();
      const equipped = await read();
      assert.deepEqual(equipped.lab.equipment, scenario.equipment);
      const profiles = await page.evaluate(() => {
        const d = window.__gameDebug as unknown as EquipmentDebug;
        const names = d.getPlayerMotion().layerMeshes ?? [];
        const prefix = names[0]?.startsWith('merged-') ? 'merged-' : 'part-';
        return { armour: d.getRenderProfile(prefix), held: d.getRenderProfile('corealm-weapon-') };
      });
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
      assert(layers.some(row => row.materials.some(material => material.name.includes(`|gear:${bodyTint}:`))),
        `${scenario.id}: rendered armour material does not carry the selected tier colour`);
      assert(layers.some(row => row.materials.some(material => material.mapUuid)),
        `${scenario.id}: the worn armour lost its authored surface texture`);
      const front = await capture(`${scenario.id}-front`);
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
      await page.waitForFunction(() => window.__featureLab!.getState().movement.mode === 'idle', undefined,
        { timeout: remaining(1500), polling: 50 });
      (report.cases as unknown[]).push({ id: scenario.id, before: before.lab.equipment,
        after: equipped.lab.equipment, expectedAppearances: appearances,
        visibleLayers: equipped.motion.layerAssets, attachments: equipped.motion.attachments,
        profiles, movement: { from: equipped.player, to: moving!.player, clip: moving!.motion.clip }, front, walking });
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentId, 'Document reloaded during acceptance');
    report.gameErrors = await driver.callDebug('getErrors');
    assert.deepEqual(report.gameErrors, []);
    assert.deepEqual(driver.consoleErrors, []);
    assert.deepEqual(driver.pageErrors, []);
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
    deadline();
    report.elapsedMs = Date.now() - started;
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, shard, elapsedMs: report.elapsedMs,
      cases: (report.cases as unknown[]).length, error: report.error, out }));
  }
}
await main();
