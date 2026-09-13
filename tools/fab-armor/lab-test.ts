/** Root-run 60-second equipment shard. Screenshots require human visual acceptance. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { EquipSlot } from '../../game/src/contracts.js';
import { BOSS_ARMOR_SETS } from '../../game/src/content/bossArmor.js';
import { CAMERA } from '../../game/src/app/config.js';
import { DEFAULT_SETTINGS } from '../../game/src/ui/settings.js';
import { GameDriver } from '../lib/driver.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';
import { startGameServer } from '../lib/server.js';

type Point = { x: number; y: number; z: number };
type Body = 'male' | 'female';
type Equipment = Record<EquipSlot, string | null>;
interface Motion {
  pose: string; clip: string | null; time: number; drawnRotationY: number;
  layerLoadPending?: boolean; layerAssets?: string[]; layerMeshes?: string[];
  layerMissingBones: string[];
  fishing?: { bones: string[] };
  attachmentErrors?: Record<string, string>;
}
interface Debug {
  getPlayerMotion(): Motion;
  getPlayerPosition(): Point;
  getCamera(): { yaw: number; pitch: number; requestedDistance: number; freeMove: boolean; target: Point };
  getRenderProfile(prefix?: string): { draws: { name: string; pass: string; triangles: number;
    materials: { name: string; mapUuid: string | null }[] }[] };
}
interface Scenario { id: string; equipment: Equipment; expected: string[] }
interface ShimmerRow {
  name: string; tier: number; role: string; phase: number; sampleTime: number;
  iridescence: number; detailChannel: number | null; lastRenderedMs: number;
}
const SLOTS = ['head', 'body', 'legs', 'hands', 'feet'] as const;
const CRAFT: Record<number, string> = { 1: 'marchhide', 5: 'bramblehide', 10: 'cairnpelt', 20: 'charhide', 50: 'dragonhide', 70: 'starhide' };
const empty = (): Equipment => ({ head: null, body: null, legs: null, hands: null, feet: null,
  mainHand: null, offHand: null, accessory1: null, accessory2: null , ring2: null, earring2: null });

function casesFor(kind: string, tier: number, body: Body, style?: 'melee' | 'magic'): Scenario[] {
  if (kind === 'craft') {
    assert(CRAFT[tier], 'Craft armor supports tiers 1, 5, 10, 20, 50 and 70');
    const equipment = empty();
    const suffixes = ['hood', 'robe', 'leggings', 'wraps', 'boots'];
    SLOTS.forEach((slot, index) => { equipment[slot] = `${CRAFT[tier]}_${suffixes[index]}`; });
    return [{ id: `craft-t${tier}`, equipment, expected: SLOTS.map(slot => `fab_${body}_mage_${slot}`) }];
  }
  assert(kind === 'rare' || kind === 'mixed', 'Use --set craft, rare or mixed');
  const sets = BOSS_ARMOR_SETS.filter(set => set.tier === tier);
  assert.equal(sets.length, 2, 'Rare and mixed shards support tiers 50, 70 and 90');
  if (kind === 'rare') return sets.filter(set => !style || set.style === style).map(set => ({ id: set.id,
    equipment: { ...empty(), ...set.members }, expected: SLOTS.filter(slot => set.members[slot]).map(slot => `fab_${body}_${set.id}_${slot}`) }));
  // Mixed slots catch body masking and seams between two independently authored silhouettes.
  const equipment = empty();
  const expected: string[] = [];
  SLOTS.forEach((slot, index) => {
    if (CRAFT[tier] && index % 2 === 0) {
      equipment[slot] = `${CRAFT[tier]}_${['hood', 'robe', 'leggings', 'wraps', 'boots'][index]}`;
      expected.push(`fab_${body}_mage_${slot}`);
      return;
    }
    const set = sets[index % 2]!;
    const itemId = set.members[slot];
    if (!itemId) return;
    equipment[slot] = itemId;
    expected.push(`fab_${body}_${set.id}_${slot}`);
  });
  return [{ id: `mixed-t${tier}`, equipment, expected }];
}

async function sourceJoints(catalogPath: string, expected: string[]): Promise<Record<string, string[]>> {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const result: Record<string, string[]> = {};
  for (const id of new Set(expected)) {
    const entry = catalog.assets.find((row: { id: string }) => row.id === id);
    assert(entry, `Candidate catalogue lacks ${id}`);
    const bytes = await readFile(path.resolve(path.dirname(catalogPath), catalog.files?.[id] ?? entry.file));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${id}: expected GLB`);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${id}: missing glTF JSON`);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8').trim());
    assert(gltf.skins?.length, `${id}: armor must have a skin`);
    const names = gltf.skins.flatMap((skin: { joints: number[] }) => skin.joints.map(index => gltf.nodes[index]?.name));
    assert(names.length && names.every((name: unknown) => typeof name === 'string' && name.length), `${id}: unnamed joint`);
    result[id] = [...new Set(names)] as string[];
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const kind = argValue(args, '--set') ?? 'craft';
  const tier = Number(argValue(args, '--tier') ?? '1');
  const body = argValue(args, '--body') ?? 'male';
  assert(body === 'male' || body === 'female', 'Use --body male or female');
  const style = argValue(args, '--style');
  assert(style === undefined || style === 'melee' || style === 'magic', 'Use --style melee or magic');
  assert(style === undefined || kind === 'rare', '--style applies only to --set rare');
  const catalog = argValue(args, '--catalog');
  assert(catalog, '--catalog is required for staged armor acceptance');
  const cases = casesFor(kind, tier, body, style);
  const started = Date.now();
  const deadline = installTestDeadline(`Fab armor ${kind}-${tier}-${body}`, 60_000);
  const out = path.resolve(repoRoot, argValue(args, '--out') ?? `test-results/fab-armor/${kind}${style ? `-${style}` : ''}-${tier}-${body}`);
  await mkdir(out, { recursive: true });
  const external = argValue(args, '--url');
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, { headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const route = `/index.html?mode=combat&fabArmor=1&body=${body}`;
  const report: Record<string, unknown> = { passed: false, kind, style, tier, body, route, cases: [],
    setup: 'Lab equipPlayer grants armor through production equipment. This is rendering proof, not loot or crafting acquisition proof.',
    visualAcceptance: 'Root must inspect front, back and walking captures for fit, material response and animation.' };
  let stage = 'boot';
  const remaining = (max = 5000) => {
    const left = 56_000 - (Date.now() - started);
    assert(left > 0, `Time budget exhausted during ${stage}`);
    return Math.max(1, Math.min(max, left));
  };
  try {
    const joints = await sourceJoints(path.resolve(repoRoot, catalog), cases.flatMap(row => row.expected));
    await driver.launch();
    const page = driver.page!;
    if (args.includes('--portraits')) {
      // Higher pixel density and a screenshot crop only; gameplay camera limits,
      // focus and field of view remain identical to the full-frame proof.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: 900, deviceScaleFactor: 2, mobile: false,
      });
    }
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    report.candidateIds = await installAssetCandidates(page, path.resolve(repoRoot, catalog));
    await driver.open(remaining(20_000), route);
    const documentId = await page.evaluate(() => performance.timeOrigin);
    const read = () => page.evaluate(() => {
      const debug = window.__gameDebug as unknown as Debug;
      return { lab: window.__featureLab!.getState(), motion: debug.getPlayerMotion(), camera: debug.getCamera(), player: debug.getPlayerPosition() };
    });
    const initial = await read();
    assert(initial.lab.ready && initial.lab.playerVisible, 'Production lab player must be ready');
    const hostBones = new Set(initial.motion.fishing?.bones ?? []);
    assert(hostBones.size > 0, 'Missing production host-bone diagnostic');
    for (const [id, names] of Object.entries(joints)) {
      assert.deepEqual(names.filter(name => !hostBones.has(name)), [], `${id}: joints missing from live host skeleton`);
    }
    report.boneProof = { source: 'Candidate skin joint names compared with live player hostBones exposed in motion.fishing.bones', hostBones: [...hostBones], joints };
    await page.evaluate(() => {
      const lab = window.__featureLab!;
      lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true);
      lab.setLevel('melee', 99); lab.setLevel('magic', 99);
    });
    const panel = page.locator('#panel-feature-lab');
    if (await panel.isVisible()) await panel.locator('.panel__close').click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(720, 510);
    for (let i = 0; i < 20 && (await read()).camera.requestedDistance > CAMERA.minDistance + .001; i++) {
      await page.mouse.wheel(0, -100); await page.waitForTimeout(30);
    }
    async function orbit(back = false, offset = 0): Promise<void> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { motion, camera } = await read();
        const yaw = motion.drawnRotationY + .25 + (back ? Math.PI : 0) + offset;
        const delta = Math.atan2(Math.sin(yaw - camera.yaw), Math.cos(yaw - camera.yaw));
        const dx = Math.max(-280, Math.min(280, -delta / .006));
        const dy = Math.max(-160, Math.min(160, (DEFAULT_SETTINGS.invertCameraY ? 1 : -1) * (.4 - camera.pitch) / .004));
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        await page.mouse.move(720, 510); await page.mouse.down({ button: 'right' });
        await page.mouse.move(720 + dx, 510 + dy, { steps: 6 }); await page.mouse.up({ button: 'right' });
      }
      await page.waitForTimeout(120);
      const { motion, camera } = await read();
      const wantedYaw = motion.drawnRotationY + .25 + (back ? Math.PI : 0) + offset;
      assert(Math.abs(Math.atan2(Math.sin(wantedYaw - camera.yaw), Math.cos(wantedYaw - camera.yaw))) < .03,
        `Normal orbit did not reach ${back ? 'back' : 'front'} view`);
      assert(Math.abs(camera.pitch - .4) < .015, 'Normal orbit did not reach readable pitch');
    }
    async function capture(name: string) {
      const state = await read();
      assert.equal(state.camera.freeMove, false);
      assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
      assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
      assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < 2.5);
      assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5, 'Camera focus height changed');
      const file = path.join(out, `${name}.png`);
      await page.screenshot({ path: file, timeout: remaining() });
      return { file, ...state };
    }
    for (const scenario of cases) {
      stage = scenario.id;
      // Explicit clear makes the before/after check meaningful even if boot wore this item.
      await page.evaluate(() => window.__featureLab!.equipPlayer('body', null));
      const before = await read();
      assert.equal(before.lab.equipment.body, null);
      await page.evaluate(async equipment => {
        const lab = window.__featureLab!;
        await lab.equipPlayer('offHand', null); await lab.equipPlayer('mainHand', null);
        for (const [slot, id] of Object.entries(equipment)) await lab.equipPlayer(slot as EquipSlot, id);
      }, scenario.equipment);
      await page.waitForFunction(({ equipment, expected }) => {
        const state = window.__featureLab!.getState();
        const motion = (window.__gameDebug as unknown as Debug).getPlayerMotion();
        return Object.entries(equipment).every(([slot, id]) => state.equipment[slot as EquipSlot] === id)
          && !motion.layerLoadPending && expected.every(id => motion.layerAssets?.includes(id))
          && Object.keys(motion.attachmentErrors ?? {}).length === 0;
      }, scenario, { timeout: remaining(7000), polling: 60 });
      await page.evaluate(async () => {
        // @ts-expect-error Browser import uses Vite's source URL.
        const armor = await import('/src/render/fabArmor.ts');
        await armor.awaitFabArmorTextures();
      });
      const equipped = await read();
      assert.deepEqual(equipped.lab.equipment, scenario.equipment);
      assert.deepEqual(equipped.motion.layerMissingBones, [], `${scenario.id}: missing joints during actual layer rebind`);
      assert.deepEqual(equipped.motion.layerAssets?.filter(id => id.startsWith('fab_')).sort(), [...scenario.expected].sort());
      await orbit();
      const profile = await page.evaluate(() => {
        const debug = window.__gameDebug as unknown as Debug;
        const names = debug.getPlayerMotion().layerMeshes ?? [];
        return debug.getRenderProfile(names[0]?.startsWith('merged-') ? 'merged-' : 'part-');
      });
      const draws = profile.draws.filter(row => row.pass.startsWith('colour') && row.triangles > 0 && equipped.motion.layerMeshes?.includes(row.name));
      assert(draws.length, `${scenario.id}: no armor color-pass draws`);
      assert(draws.some(draw => draw.materials.some(material => material.mapUuid)), `${scenario.id}: no texture on worn armor`);
      if (args.includes('--mystic')) {
        assert(draws.some(draw => draw.materials.some(material => material.name.includes('|mystic:'))),
          `${scenario.id}: staged cloth did not reach the production mystic material path`);
      }
      const front = await capture(`${scenario.id}-front`);
      if (args.includes('--portraits')) await page.screenshot({
        path: path.join(out, `${scenario.id}-portrait.png`),
        clip: { x: 630, y: 325, width: 200, height: 320 }, timeout: remaining(),
      });
      const hasMagic = kind === 'craft' || BOSS_ARMOR_SETS.some(set => set.style === 'magic'
        && Object.values(set.members).some(id => Object.values(scenario.equipment).includes(id)));
      const shimmer: { seconds: number; rows: ShimmerRow[]; capture: unknown }[] = [];
      if (hasMagic) {
        try {
          for (const [seconds, suffix] of [[4, 'a'], [12, 'b']] as const) {
            remaining(1);
            const sampled = await page.evaluate(async seconds => {
              // @ts-expect-error Browser import uses Vite's source URL.
              const surface = await import('/src/render/fabMagicSurface.ts');
              const startedMs = performance.now();
              surface.setFabMagicSampleTime(seconds);
              await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
              return { startedMs, rows: surface.getFabMagicSurfaceState() as ShimmerRow[] };
            }, seconds);
            const active = sampled.rows.filter(row => row.lastRenderedMs >= sampled.startedMs && row.sampleTime === seconds);
            assert(active.length > 0, `${scenario.id}: no rendered shimmer materials at ${seconds}s`);
            assert(active.every(row => Number.isFinite(row.phase) && row.iridescence > 0), 'Invalid active shimmer material state');
            shimmer.push({ seconds, rows: active, capture: await capture(`${scenario.id}-shimmer-${suffix}`) });
          }
          const earlier = shimmer[0]!.rows;
          const later = shimmer[1]!.rows;
          assert(later.some(row => earlier.some(previous => previous.name === row.name && previous.role === row.role
            && previous.tier === row.tier && Math.abs(previous.phase - row.phase) > .01)),
          `${scenario.id}: the same rendered material must change shimmer phase`);
        } finally {
          await page.evaluate(async () => {
            // @ts-expect-error Browser import uses Vite's source URL.
            const surface = await import('/src/render/fabMagicSurface.ts');
            surface.setFabMagicSampleTime(null);
          });
        }
      }
      await orbit(true);
      const back = await capture(`${scenario.id}-back`);
      const materialAngles: unknown[] = [];
      if (args.includes('--material-review')) {
        // Fixed material time isolates light/view response from hue animation.
        await page.evaluate(async () => {
          // @ts-expect-error Browser import uses Vite's source URL.
          (await import('/src/render/fabMagicSurface.ts')).setFabMagicSampleTime(4);
        });
        try {
          for (let angle = 0; angle < 8; angle++) {
            await orbit(false, angle * Math.PI / 4);
            materialAngles.push(await capture(`${scenario.id}-light-${angle}`));
          }
        } finally {
          await page.evaluate(async () => {
            // @ts-expect-error Browser import uses Vite's source URL.
            (await import('/src/render/fabMagicSurface.ts')).setFabMagicSampleTime(null);
          });
        }
        await orbit(true);
      }
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const walking: unknown[] = [];
      await page.keyboard.down('w');
      try {
        await page.waitForFunction(origin => {
          const point = (window.__gameDebug as unknown as Debug).getPlayerPosition();
          return Math.hypot(point.x - origin.x, point.z - origin.z) > .8;
        }, equipped.player, { timeout: remaining(2500), polling: 50 });
        const moving = await read();
        assert(/walk|jog|run/i.test(`${moving.motion.pose} ${moving.motion.clip}`), 'Real movement must advance locomotion');
        assert.deepEqual(moving.motion.layerAssets, equipped.motion.layerAssets, 'Walking replaced armor');
        assert.deepEqual(moving.motion.layerMissingBones, [], 'Walking introduced missing joints');
        walking.push(await capture(`${scenario.id}-walking-middle`));
        // A second live frame exposes shimmer or unstable material sampling during motion.
        await page.waitForFunction(origin => {
          const point = (window.__gameDebug as unknown as Debug).getPlayerPosition();
          return Math.hypot(point.x - origin.x, point.z - origin.z) > .8;
        }, moving.player, { timeout: remaining(2500), polling: 50 });
        const late = await read();
        assert(/walk|jog|run/i.test(`${late.motion.pose} ${late.motion.clip}`), 'Late walking frame lost locomotion');
        assert.deepEqual(late.motion.layerAssets, equipped.motion.layerAssets, 'Late walking frame replaced armor');
        assert.deepEqual(late.motion.layerMissingBones, [], 'Late walking frame introduced missing joints');
        walking.push(await capture(`${scenario.id}-walking-late`));
        if (args.includes('--motion-review')) {
          // Consecutive normal-gameplay views expose unstable texture sampling
          // that the two pose checkpoints alone cannot establish.
          for (let frame = 0; frame < 10; frame++) {
            await page.waitForTimeout(100);
            const sample = await read();
            assert.deepEqual(sample.motion.layerMissingBones, []);
            assert.deepEqual(sample.motion.layerAssets, equipped.motion.layerAssets);
            walking.push(await capture(`${scenario.id}-motion-${String(frame).padStart(2, '0')}`));
          }
        }
      } finally { await page.keyboard.up('w'); }
      await page.waitForFunction(() => window.__featureLab!.getState().movement.mode === 'idle', undefined, { timeout: remaining(1500), polling: 50 });
      (report.cases as unknown[]).push({ id: scenario.id, expected: scenario.expected, before: before.lab.equipment,
        after: equipped.lab.equipment, profile, front, shimmer, back, materialAngles, walking });
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentId, 'Page reloaded during proof');
    report.gameErrors = await driver.callDebug('getErrors');
    assert.deepEqual(report.gameErrors, []); assert.deepEqual(driver.consoleErrors, []); assert.deepEqual(driver.pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = String(error); process.exitCode = 1;
    await driver.page?.keyboard.up('w').catch(() => {});
    await driver.page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 3000 }).catch(() => {});
  } finally {
    report.stage = stage; report.consoleErrors = driver.consoleErrors; report.pageErrors = driver.pageErrors; report.requestErrors = driver.requestErrors;
    await driver.close(); await server.close(); deadline();
    report.elapsedMs = Date.now() - started;
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, kind, style, tier, body, out, error: report.error, elapsedMs: report.elapsedMs }));
  }
}
await main();
