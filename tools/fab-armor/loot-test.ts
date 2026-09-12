/** Root-run seeded rare loot proof. Keeps real drop probabilities and real kill/pickup/equip. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import type { GameEvent, ItemStack, SemanticEntity } from '../../game/src/contracts.js';
import type { GameState } from '../../game/src/state/store.js';
import type { EnemyDef } from '../../game/src/content/index.js';
import { BOSS_ARMOR_ITEMS, BOSS_ARMOR_SETS } from '../../game/src/content/bossArmor.js';
import { wildernessDrops } from '../../game/src/content/wildernessLoot.js';
import { RngStreams } from '../../game/src/core/rng.js';
import { CAMERA } from '../../game/src/app/config.js';
import { GameDriver } from '../lib/driver.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';
import { startGameServer } from '../lib/server.js';

type Point = { x: number; y: number; z: number };
interface Debug {
  getState(): { hoveredEntityId: string | null; clock: { timeScale: number } };
  getCamera(): { position: Point; target: Point; pitch: number; requestedDistance: number; freeMove: boolean };
  getPlayerPosition(): Point;
  getDrawnBounds(id: string): { min: Point; max: Point; meshes: number; fade: number } | null;
  getEntity(id: string): SemanticEntity | null;
  getPlayerMotion(): { layerLoadPending?: boolean; layerAssets?: string[]; layerMissingBones: string[] };
}
const count = (items: readonly (ItemStack | null)[], id: string) => items.reduce((sum, item) => sum + (item?.itemId === id ? item.quantity : 0), 0);

function chooseSeed(drops: EnemyDef['drops'], tier: 50 | 70) {
  // Prefer a melee torso, which works even when the mage source pack is still being imported.
  const preferred = BOSS_ARMOR_SETS.find(set => set.tier === tier && set.style === 'melee')!.members.body!;
  for (let seed = 0; seed < 100_000; seed++) {
    const rng = new RngStreams(seed).get('loot');
    const items: ItemStack[] = [];
    for (const drop of drops) {
      if (!rng.chance(drop.chance)) continue;
      const quantity = rng.int(...drop.quantity);
      if (quantity > 0) items.push({ itemId: drop.itemId, quantity });
    }
    if (items.some(item => item.itemId === preferred)) return { seed, expected: items, itemId: preferred };
  }
  throw new Error('No deterministic torso drop seed found');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tier = Number(argValue(args, '--tier') ?? '50');
  assert(tier === 50 || tier === 70, '--tier must be 50 or 70');
  const catalog = argValue(args, '--catalog'); assert(catalog, '--catalog is required');
  const keeperName = tier === 50 ? 'furnace_regent' : 'nightforge_marshal';
  const drops = wildernessDrops(keeperName, tier, keeperName);
  const prediction = chooseSeed(drops, tier);
  const item = BOSS_ARMOR_ITEMS.find(item => item.id === prediction.itemId)!;
  const set = BOSS_ARMOR_SETS.find(set => Object.values(set.members).includes(item.id))!;
  const expectedAsset = `fab_male_${set.id}_${item.equip!.slot}`;
  const started = Date.now();
  const deadline = installTestDeadline(`Fab rare loot T${tier}`, 60_000);
  const out = path.resolve(repoRoot, argValue(args, '--out') ?? `test-results/fab-armor/loot-t${tier}`);
  await mkdir(out, { recursive: true });
  const external = argValue(args, '--url');
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, { headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
  const route = `/index.html?mode=combat&fabArmor=1&creatureLoot=1&fabLootSeed=${prediction.seed}`;
  const report: Record<string, unknown> = { passed: false, tier, route, prediction, drops, screenshots: [],
    setup: 'Master RNG seed selects a reproducible production roll. Skills, sword and 1-HP keeper are setup. Rare armor is never granted; probabilities are unchanged. Real canvas attack, corpse loot UI and inventory equip prove acquisition. Save export/import checks serialization in the nonpersistent lab.' };
  let stage = 'boot';
  const remaining = (max = 4000) => {
    const left = 56_000 - (Date.now() - started); assert(left > 0, `Budget exhausted at ${stage}`);
    return Math.max(1, Math.min(max, left));
  };
  const save = async (): Promise<GameState> => JSON.parse(await driver.callDebug('getSaveBlob') as string);
  try {
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    report.candidates = await installAssetCandidates(page, path.resolve(repoRoot, catalog));
    assert((report.candidates as string[]).includes(expectedAsset), `Missing earned armor candidate ${expectedAsset}`);
    await driver.open(remaining(20_000), route);
    const origin = await page.evaluate(() => performance.timeOrigin);
    assert.equal((await save()).meta.seed, prediction.seed, 'Lab boot must apply fabLootSeed before constructing RNG streams');
    await page.evaluate(async () => {
      const lab = window.__featureLab!;
      lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true); lab.setLevel('melee', 99); lab.setLevel('magic', 99);
      await lab.equipPlayer('body', null); await lab.equipPlayer('offHand', null); await lab.equipPlayer('mainHand', 'chainbound_sword');
    });
    await driver.callDebug('clearInventory');
    const panel = page.locator('#panel-feature-lab');
    if (await panel.isVisible()) await panel.locator('.panel__close').click();
    async function capture(name: string) {
      const pose = await driver.callDebug('getCamera') as ReturnType<Debug['getCamera']>;
      const player = await driver.callDebug('getPlayerPosition') as Point;
      assert.equal(pose.freeMove, false);
      assert(pose.requestedDistance >= CAMERA.minDistance && pose.requestedDistance <= CAMERA.maxDistance);
      assert(pose.pitch >= CAMERA.minPitch && pose.pitch <= CAMERA.maxPitch);
      assert(Math.hypot(pose.target.x - player.x, pose.target.z - player.z) < .1);
      assert(Math.abs(pose.target.y - player.y - 1.1) < .1);
      const file = path.join(out, `${name}.png`);
      await page.screenshot({ path: file, timeout: remaining() });
      (report.screenshots as unknown[]).push({ file, pose, player });
    }
    async function clickEntity(id: string, action: string) {
      await page.waitForFunction(id => ((window.__gameDebug as unknown as Debug).getDrawnBounds(id)?.meshes ?? 0) > 0,
        id, { timeout: remaining(7000), polling: 60 });
      const projection = await page.evaluate(id => {
        const d = window.__gameDebug as unknown as Debug;
        const rect = document.querySelector('#viewport')!.getBoundingClientRect();
        return { camera: d.getCamera(), bounds: d.getDrawnBounds(id)!, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      }, id);
      const { bounds, rect } = projection;
      const camera = new PerspectiveCamera(CAMERA.fov, rect.width / rect.height, CAMERA.near, CAMERA.far);
      camera.position.set(projection.camera.position.x, projection.camera.position.y, projection.camera.position.z);
      camera.lookAt(projection.camera.target.x, projection.camera.target.y, projection.camera.target.z); camera.updateMatrixWorld(true);
      for (const y of [.45, .2, .7]) for (const x of [.5, .25, .75]) for (const z of [.5, .25, .75]) {
        remaining(1);
        const p = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * x,
          bounds.min.y + (bounds.max.y - bounds.min.y) * y, bounds.min.z + (bounds.max.z - bounds.min.z) * z).project(camera);
        const px = rect.x + (p.x + 1) * rect.width / 2, py = rect.y + (1 - p.y) * rect.height / 2;
        if (p.z < -1 || p.z > 1 || px < 0 || py < 0 || px >= 1440 || py >= 900) continue;
        await page.mouse.move(px, py); await page.waitForTimeout(65);
        const hit = await page.evaluate(({ px, py }) => ({ id: (window.__gameDebug as unknown as Debug).getState().hoveredEntityId,
          canvas: document.elementFromPoint(px, py)?.tagName === 'CANVAS' }), { px, py });
        if (hit.id !== id || !hit.canvas) continue;
        await page.mouse.click(px, py, { button: 'right' });
        await page.getByRole('menuitem', { name: action, exact: true }).click({ timeout: remaining() }); return;
      }
      throw new Error(`No canvas hover hit ${id}`);
    }
    stage = 'wounded keeper';
    const spawned = await page.evaluate(name => window.__featureLab!.spawnTarget('creature', `candidate:${name}`, { distance: 3 }), keeperName);
    assert(spawned.target);
    const keeperId = spawned.target.entityId;
    const before = await driver.callDebug('getEntity', [keeperId]) as SemanticEntity;
    const actualDrops = await page.evaluate(async id => {
      const modulePath = '/src/content/index.ts';
      const registry = await import(modulePath);
      return registry.content.enemy(id)?.drops;
    }, String(before.meta?.enemyDefId));
    assert.deepEqual(actualDrops, drops, 'Live keeper drop table differs from seed prediction');
    report.liveDrops = actualDrops;
    report.wound = await page.evaluate(id => (window as unknown as { __creatureLootFixture: {
      prepareWoundedTarget(id: string): unknown } }).__creatureLootFixture.prepareWoundedTarget(id), keeperId);
    const wounded = await driver.callDebug('getEntity', [keeperId]) as SemanticEntity;
    assert.equal(wounded.combat!.health, 1);
    assert.deepEqual({ ...wounded.combat, health: before.combat!.health }, before.combat);
    assert.equal(count((await save()).inventory.slots, item.id), 0);
    const cursor = (await driver.callDebug('getEvents', [0]) as { nextSeq: number }).nextSeq;
    stage = 'real attack';
    await clickEntity(keeperId, `Attack ${wounded.name}`);
    await page.waitForFunction(id => (window.__gameDebug as unknown as Debug).getEntity(id)?.state === 'dead', keeperId,
      { timeout: remaining(12_000), polling: 60 });
    const events = await driver.callDebug('getEvents', [cursor]) as { events: GameEvent[] };
    assert(events.events.some(event => event.type === 'combat.started' && event.data.initiator === 'player'));
    const loot = (await driver.callDebug('listEntities', [{ archetype: 'loot' }]) as SemanticEntity[]).filter(entity => entity.meta?.droppedBy === keeperId);
    assert.equal(loot.length, 1);
    const pile = loot[0]!;
    const afterKill = await save();
    const pileItems = afterKill.world.lootPiles[pile.id]!.items;
    assert.deepEqual(pileItems, prediction.expected, 'Production first kill must match unchanged seeded rolls');
    assert.equal(count(afterKill.inventory.slots, item.id), 0, 'Death should leave armor in the loot pile');
    report.kill = { keeperId, events, pileId: pile.id, items: pileItems };
    await page.waitForFunction(id => { const bounds = (window.__gameDebug as unknown as Debug).getDrawnBounds(id); return !bounds || bounds.fade >= .999; },
      keeperId, { timeout: remaining(7000), polling: 60 });
    stage = 'pickup';
    await clickEntity(pile.id, `Open ${pile.name}`);
    const reveal = page.locator(`.loot-reveal[data-source-id="${pile.id}"]`);
    await reveal.waitFor({ state: 'visible', timeout: remaining() });
    await capture('01-earned-drop');
    await reveal.locator(`.slot[data-item="${item.id}"]`).click();
    const picked = await save();
    assert.equal(count(picked.inventory.slots, item.id), 1);
    assert.equal(count(picked.world.lootPiles[pile.id]?.items ?? [], item.id), 0);
    await page.keyboard.press('Escape');
    stage = 'inventory equip';
    await page.locator('.dock__btn[data-panel="inventory"]').click();
    await page.locator(`#panel-inventory .slot[data-item="${item.id}"]`).click();
    await page.waitForFunction(({ id, asset }) => {
      const motion = (window.__gameDebug as unknown as Debug).getPlayerMotion();
      return window.__featureLab!.getState().equipment.body === id && !motion.layerLoadPending && motion.layerAssets?.includes(asset);
    }, { id: item.id, asset: expectedAsset }, { timeout: remaining(7000), polling: 60 });
    const equipped = await save();
    assert.equal(equipped.equipment.body?.itemId, item.id); assert.equal(count(equipped.inventory.slots, item.id), 0);
    assert.deepEqual((await driver.callDebug('getPlayerMotion') as ReturnType<Debug['getPlayerMotion']>).layerMissingBones, []);
    report.acquisition = { itemId: item.id, picked: picked.inventory.slots, equipped: equipped.equipment };
    await page.locator('.dock__btn[data-panel="inventory"]').click();
    await capture('02-equipped-reward');
    stage = 'save roundtrip';
    const blob = await driver.callDebug('getSaveBlob') as string;
    await driver.callDebug('loadSaveBlob', [blob]);
    await page.waitForFunction(id => window.__featureLab!.getState().equipment.body === id, item.id, { timeout: remaining() });
    const restored = await save();
    assert.deepEqual(restored.equipment.body, equipped.equipment.body);
    assert.equal(count(restored.inventory.slots, item.id), 0);
    report.save = { body: restored.equipment.body, serializedBytes: Buffer.byteLength(blob), scope: 'Production serialize/loadSerialized roundtrip; browser localStorage persistence is disabled in lab.' };
    assert.equal((await driver.callDebug('getState') as ReturnType<Debug['getState']>).clock.timeScale, 1);
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    assert.deepEqual(await driver.callDebug('getErrors'), []);
    assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors, ...driver.requestErrors], []);
    report.passed = true;
  } catch (error) {
    report.error = String(error); process.exitCode = 1;
    await driver.page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 3000 }).catch(() => {});
  } finally {
    report.stage = stage; report.elapsedMs = Date.now() - started;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await driver.close(); await server.close(); deadline();
    console.log(JSON.stringify({ passed: report.passed, tier, seed: prediction.seed, out, error: report.error, elapsedMs: report.elapsedMs }));
  }
}
await main();
