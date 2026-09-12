/** Root-run final-world integration. 90s cold-world budget; isolated art is proved in the lab. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ItemStack, Result } from '../../game/src/contracts.js';
import type { GameState } from '../../game/src/state/store.js';
import { BOSS_ARMOR_SETS } from '../../game/src/content/bossArmor.js';
import { CAMERA } from '../../game/src/app/config.js';
import { DEFAULT_SETTINGS } from '../../game/src/ui/settings.js';
import { GameDriver } from '../lib/driver.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';

type Point = { x: number; y: number; z: number };
interface Motion {
  pose: string; clip: string | null; drawnRotationY: number; layerAssets?: string[];
  layerMissingBones: string[]; layerLoadPending?: boolean; layerMeshes?: string[];
}
interface Debug {
  getPlayerPosition(): Point;
  getPlayerMotion(): Motion;
  getCamera(): { yaw: number; pitch: number; requestedDistance: number; freeMove: boolean; target: Point };
  getSaveBlob(): string;
  getRenderProfile(prefix?: string): { draws: { name: string; pass: string; triangles: number }[] };
}
const SLOTS = ['head', 'body', 'legs', 'hands', 'feet'] as const;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mageTier = Number(argValue(args, '--mage-tier') ?? '50');
  assert(mageTier === 50 || mageTier === 70 || mageTier === 90, '--mage-tier must be 50, 70 or 90');
  const mage = BOSS_ARMOR_SETS.find(set => set.style === 'magic' && set.tier === mageTier)!;
  const melee = BOSS_ARMOR_SETS.find(set => set.style === 'melee' && set.tier === 90)!;
  const cases = [
    { id: 'craft-mage-t70', family: 'mage', members: { head: 'starhide_hood', body: 'starhide_robe', legs: 'starhide_leggings', hands: 'starhide_wraps', feet: 'starhide_boots' } },
    ...[mage, melee].map(set => ({ id: set.id, family: set.id, members: set.members })),
  ].filter(scenario => !args.includes('--mage-only') || scenario.id === mage.id);
  const started = Date.now();
  const deadline = installTestDeadline('Fab armor full-world integration', 90_000);
  const out = path.resolve(repoRoot, argValue(args, '--out') ?? `test-results/fab-armor/world-mage-${mageTier}`);
  await mkdir(out, { recursive: true });
  const server = { url: argValue(args, '--url') ?? 'http://127.0.0.1:57375', close: async () => {} };
  const driver = new GameDriver(server, { headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const report: Record<string, unknown> = { passed: false, route: '/', url: server.url, cases: [],
    setup: 'Isolated browser context, normal full-world route and shipped assets. Skill levels and armor items are granted for wiring checks. Actual inventory clicks equip each piece. Camera uses mouse wheel and orbit; movement uses keyboard. No candidate overlay or lab query.',
    budget: '90 seconds total, at most 60 seconds for cold full-world boot. --mage-only limits integration to the changed outfit; lab owns exhaustive visuals.' };
  let stage = 'cold boot';
  const remaining = (max = 5000) => {
    const left = 86_000 - (Date.now() - started); assert(left > 0, `World budget exhausted at ${stage}`);
    return Math.max(1, Math.min(max, left));
  };
  try {
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    const bootDeadline = Date.now() + 60_000;
    await page.goto(new URL('/', server.url).href, { waitUntil: 'load', timeout: remaining(60_000) });
    await page.waitForFunction(() => window.__gameDebug?.getState().ready === true, undefined,
      { timeout: Math.max(1, Math.min(remaining(60_000), bootDeadline - Date.now())) });
    assert.equal(new URL(page.url()).search, '', 'World acceptance must have no staging query');
    assert.equal(await page.evaluate(() => Boolean(window.__featureLab)), false, 'Expected normal full world');
    const origin = await page.evaluate(() => performance.timeOrigin);
    report.bootMs = Date.now() - started;
    const read = () => page.evaluate(() => {
      const d = window.__gameDebug as unknown as Debug;
      return { player: d.getPlayerPosition(), camera: d.getCamera(), motion: d.getPlayerMotion(), save: JSON.parse(d.getSaveBlob()) as GameState };
    });
    await driver.callDebug('setSkillLevel', ['melee', 99]);
    await driver.callDebug('setSkillLevel', ['magic', 99]);
    await driver.callDebug('clearInventory');
    const returnToGame = page.getByRole('button', { name: 'Return to game', exact: true });
    if (await returnToGame.isVisible()) await returnToGame.click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(720, 510);
    for (let i = 0; i < 20 && (await read()).camera.requestedDistance > CAMERA.minDistance + .001; i++) {
      await page.mouse.wheel(0, -100); await page.waitForTimeout(30);
    }
    async function front(): Promise<void> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { motion, camera } = await read();
        const desired = motion.drawnRotationY + .25;
        const delta = Math.atan2(Math.sin(desired - camera.yaw), Math.cos(desired - camera.yaw));
        const dx = Math.max(-280, Math.min(280, -delta / .006));
        const dy = Math.max(-160, Math.min(160, (DEFAULT_SETTINGS.invertCameraY ? 1 : -1) * (.4 - camera.pitch) / .004));
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        await page.mouse.move(720, 510); await page.mouse.down({ button: 'right' });
        await page.mouse.move(720 + dx, 510 + dy, { steps: 6 }); await page.mouse.up({ button: 'right' });
      }
      await page.waitForTimeout(150);
      const { motion, camera } = await read();
      const delta = motion.drawnRotationY + .25 - camera.yaw;
      assert(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < .03, 'Normal orbit did not reach front');
    }
    async function capture(name: string) {
      const state = await read();
      assert.equal(state.camera.freeMove, false);
      assert(state.camera.requestedDistance >= CAMERA.minDistance && state.camera.requestedDistance <= CAMERA.maxDistance);
      assert(state.camera.pitch >= CAMERA.minPitch && state.camera.pitch <= CAMERA.maxPitch);
      assert(Math.hypot(state.camera.target.x - state.player.x, state.camera.target.z - state.player.z) < 2.5);
      assert(Math.abs(state.camera.target.y - state.player.y - 1.1) < .5, 'Player-follow focus height changed');
      const file = path.join(out, `${name}.png`);
      await page.screenshot({ path: file, timeout: remaining() });
      return { file, camera: state.camera, player: state.player, motion: state.motion };
    }
    for (const scenario of cases) {
      stage = scenario.id;
      const before = await read();
      const uncovered = SLOTS.filter(slot => !scenario.members[slot] && before.save.equipment[slot]);
      if (uncovered.length) {
        await page.locator('.dock__btn[data-panel="equipment"]').click();
        for (const slot of uncovered) await page.locator(`#panel-equipment [data-equip-slot="${slot}"]`).click();
        await page.locator('.dock__btn[data-panel="equipment"]').click();
      }
      for (const id of Object.values(scenario.members)) {
        assert((await driver.callDebug('giveItem', [id, 1, 'inventory']) as Result<number>).ok, `Cannot grant setup ${id}`);
      }
      const inventory = page.locator('#panel-inventory');
      if (!await inventory.isVisible()) await page.locator('.dock__btn[data-panel="inventory"]').click();
      for (const id of Object.values(scenario.members)) await inventory.locator(`.slot[data-item="${id}"]`).click();
      await page.locator('.dock__btn[data-panel="inventory"]').click();
      const expected = SLOTS.filter(slot => scenario.members[slot]).map(slot => `fab_male_${scenario.family}_${slot}`);
      await page.waitForFunction(({ members, expected }) => {
        const d = window.__gameDebug as unknown as Debug;
        const save = JSON.parse(d.getSaveBlob()) as GameState;
        const motion = d.getPlayerMotion();
        return Object.entries(members).every(([slot, id]) => save.equipment[slot as keyof GameState['equipment']]?.itemId === id)
          && ['head', 'body', 'legs', 'hands', 'feet'].every(slot => members[slot as keyof typeof members] || !save.equipment[slot as keyof GameState['equipment']])
          && !motion.layerLoadPending && expected.every(id => motion.layerAssets?.includes(id));
      }, { members: scenario.members, expected }, { timeout: remaining(8000), polling: 60 });
      await page.evaluate(async () => {
        // @ts-expect-error Browser import uses Vite's source URL.
        await (await import('/src/render/fabArmor.ts')).awaitFabArmorTextures();
      });
      const equipped = await read();
      assert.deepEqual(equipped.motion.layerMissingBones, []);
      assert.deepEqual(equipped.motion.layerAssets?.filter(id => id.startsWith('fab_')).sort(), [...expected].sort());
      for (const [slot, id] of Object.entries(scenario.members)) {
        assert.equal(equipped.save.equipment[slot as keyof GameState['equipment']]?.itemId, id);
        assert.equal(equipped.save.inventory.slots.some((item: ItemStack | null) => item?.itemId === id), false);
      }
      assert.notDeepEqual(before.save.equipment, equipped.save.equipment);
      await front();
      await page.waitForFunction(() => {
        const debug = window.__gameDebug as unknown as Debug;
        const names = debug.getPlayerMotion().layerMeshes ?? [];
        const draws = debug.getRenderProfile(names[0]?.startsWith('merged-') ? 'merged-' : 'part-').draws;
        return draws.some(row => names.includes(row.name) && row.pass.startsWith('colour') && row.triangles > 0);
      }, undefined, { timeout: remaining(4000), polling: 60 });
      const screenshot = await capture(`${scenario.id}-front`);
      (report.cases as unknown[]).push({ id: scenario.id, before: before.save.equipment,
        after: equipped.save.equipment, expectedAssets: expected, screenshot });
    }
    stage = 'real world walking';
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const beforeWalk = await read();
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(start => {
        const p = (window.__gameDebug as unknown as Debug).getPlayerPosition();
        return Math.hypot(p.x - start.x, p.z - start.z) > .8;
      }, beforeWalk.player, { timeout: remaining(3500), polling: 50 });
      const moving = await read();
      assert(/walk|jog|run/i.test(`${moving.motion.pose} ${moving.motion.clip}`));
      assert.deepEqual(moving.motion.layerAssets, beforeWalk.motion.layerAssets);
      assert.deepEqual(moving.motion.layerMissingBones, []);
      report.walking = { from: beforeWalk.player, to: moving.player, capture: await capture('final-world-walking') };
    } finally { await page.keyboard.up('w'); }
    stage = 'save';
    await driver.callDebug('saveNow');
    const exported = await driver.callDebug('getSaveBlob') as string;
    const state = JSON.parse(exported) as GameState;
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('corealm.save.v1') ?? 'null') as GameState | null);
    assert(persisted, 'Normal world must persist the accepted equipment');
    assert.deepEqual(persisted.equipment, state.equipment);
    assert.deepEqual(persisted.inventory.slots, state.inventory.slots);
    report.save = { equipment: state.equipment, serializedBytes: Buffer.byteLength(exported), storageKey: 'corealm.save.v1' };
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    assert.deepEqual(await driver.callDebug('getErrors'), []);
    assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors, ...driver.requestErrors], []);
    report.passed = true;
  } catch (error) {
    report.error = String(error); process.exitCode = 1;
    await driver.page?.keyboard.up('w').catch(() => {});
    await driver.page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 3000 }).catch(() => {});
  } finally {
    report.stage = stage; report.elapsedMs = Date.now() - started;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await driver.close(); deadline();
    console.log(JSON.stringify({ passed: report.passed, out, stage, error: report.error, elapsedMs: report.elapsedMs }));
  }
}
await main();
