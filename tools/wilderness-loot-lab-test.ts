/** Production crafting, worn gear and keeper rune supply in one compact, bounded lab scene. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../game/src/app/config.js';
import type { GameEvent, ItemStack, Result, SemanticEntity } from '../game/src/contracts.js';
import { WILDERNESS_LOOT_RECIPES } from '../game/src/content/wildernessLoot.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import type { GameState } from '../game/src/state/store.js';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue, repoRoot } from './lib/paths.js';
import { startGameServer } from './lib/server.js';

type Point = { x: number; y: number; z: number };
interface CameraState {
  position: Point; target: Point; pitch: number; requestedDistance: number; freeMove: boolean;
}
interface MotionState {
  layerAssets?: string[]; layerMeshes?: string[]; layerLoadPending?: boolean;
  attachments?: Record<string, string>; attachmentLoading?: Record<string, string>; attachmentErrors?: Record<string, string>;
}
interface LabDebug {
  getState(): { hoveredEntityId: string | null; clock: { timeScale: number } };
  getCamera(): CameraState;
  getPlayerPosition(): Point;
  getEntity(id: string): SemanticEntity | null;
  getDrawnBounds(id: string): { min: Point; max: Point; meshes: number; fade: number } | null;
  getEvents(since: number): { events: GameEvent[]; nextSeq: number; dropped?: boolean };
  getPlayerMotion(): MotionState;
  getRenderProfile(prefix?: string): { calls: number; draws: { name: string; pass: string; calls: number; triangles: number; objects: number[] }[] };
  getElementalArtState(): { element: string; fire: { variant: string; mainShapes: number; composition: string } } | null;
  getSaveBlob(): string;
}
interface LootFixture {
  prepare(): Promise<{ ready: boolean; stationId: string; position: readonly number[] | null }>;
  prepareWoundedTarget(entityId: string): {
    woundedTarget: { entityId: string; before: number; maxHealth: number; setupHealth: number } | null;
  };
}

const count = (slots: readonly (ItemStack | null)[], id: string): number =>
  slots.reduce((total, item) => total + (item?.itemId === id ? item.quantity : 0), 0);

async function main(): Promise<void> {
  const started = Date.now();
  const clear = installTestDeadline('Wilderness loot lab', 60_000);
  const args = process.argv.slice(2);
  const external = argValue(args, '--url');
  const server = external ? { url: external, close: async () => {} } : await startGameServer();
  const driver = new GameDriver(server, {
    headless: !args.includes('--headed'), viewport: { width: 1440, height: 900 },
    browserArgs: [...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  const out = path.join(repoRoot, argValue(args, '--out') ?? 'test-results/wilderness-loot-lab');
  const report: Record<string, unknown> = {
    passed: false, route: '/index.html?mode=combat&creatureLoot=1', url: server.url,
    setup: 'Skills, crafting inputs and Fire Essence are granted; the lab equipment control supplies a Chainbound Sword and Magic Staff for combat setup. The Furnace Regent starts wounded at 1 current HP through an explicit lab setup control, while its maximum health, stats and drop table remain production values. The two tested crafted outputs, rune stacks, death and loot are never granted. This checks the loot and production path, not full boss difficulty. Simulation remains at timeScale 1.',
    screenshots: [] as string[], crafts: [] as unknown[],
  };
  let stage = 'boot';
  const remaining = (limit = 3000): number => {
    const budget = 56_000 - (Date.now() - started);
    assert(budget > 0, `Wilderness loot operation budget exhausted during ${stage}`);
    return Math.max(1, Math.min(limit, budget));
  };
  const save = async (): Promise<GameState> => JSON.parse(await driver.callDebug('getSaveBlob') as string) as GameState;
  try {
    await mkdir(out, { recursive: true });
    await driver.launch();
    const page = driver.page!;
    page.setDefaultTimeout(3000);
    await page.addInitScript("globalThis.__name = (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true });");
    const catalog = argValue(args, '--catalog');
    if (catalog) report.candidates = await installAssetCandidates(page, catalog);
    await driver.open(remaining(20_000), report.route as string);
    const origin = await page.evaluate(() => performance.timeOrigin);
    report.browserTimeOrigin = origin;
    const castTimings: { name: string; startEpochMs: number; endEpochMs: number; startBrowserMs: number; endBrowserMs: number }[] = [];
    report.castTimings = castTimings;
    async function timedCastStep<T>(name: string, operation: () => Promise<T>): Promise<T> {
      const startEpochMs = Date.now();
      try { return await operation(); }
      finally {
        const endEpochMs = Date.now();
        castTimings.push({ name, startEpochMs, endEpochMs, startBrowserMs: startEpochMs - origin, endBrowserMs: endEpochMs - origin });
      }
    }
    await page.evaluate(async () => {
      const lab = window.__featureLab!;
      lab.setFreeCameraEnabled(false); lab.setWalkingEnabled(true); lab.setPlayerVisible(true);
      lab.setLevel('crafting', 70); lab.setLevel('magic', 99); lab.setLevel('melee', 99);
      await lab.equipPlayer('offHand', null);
      await lab.equipPlayer('mainHand', 'chainbound_sword');
    });
    await driver.callDebug('clearInventory');
    const labPanel = page.locator('#panel-feature-lab');
    if (await labPanel.isVisible()) await labPanel.locator('.panel__close').click();

    async function frame(x: number, z: number, yaw = 0, distance = 8): Promise<void> {
      const y = await driver.callDebug('groundHeight', [x, z]) as number;
      assert.equal(await driver.callDebug('inspectPose', [{ x, y, z, yaw, pitch: .48, distance, detached: false }]), true);
      await page.waitForTimeout(180);
    }
    async function normalCamera(): Promise<CameraState> {
      const pose = await driver.callDebug('getCamera') as CameraState;
      const player = await driver.callDebug('getPlayerPosition') as Point;
      assert.equal(pose.freeMove, false);
      assert(pose.requestedDistance >= CAMERA.minDistance && pose.requestedDistance <= CAMERA.maxDistance);
      assert(pose.pitch >= CAMERA.minPitch && pose.pitch <= CAMERA.maxPitch);
      assert(Math.hypot(pose.target.x - player.x, pose.target.z - player.z) < .08, 'Camera focus must remain on the player');
      assert(Math.abs(pose.target.y - player.y - 1.1) < .08, 'Acceptance may not raise the normal camera target');
      return pose;
    }
    async function capture(name: string): Promise<void> {
      await normalCamera();
      remaining(1);
      (report.screenshots as string[]).push(await driver.screenshot(out, name));
    }
    async function clickEntity(id: string, menuAction?: string): Promise<void> {
      await page.waitForFunction((entityId) => {
        const bounds = (window.__gameDebug as unknown as LabDebug).getDrawnBounds(entityId);
        return bounds !== null && bounds.meshes > 0;
      }, id, { timeout: remaining(7000), polling: 60 });
      const projection = await page.evaluate((entityId) => {
        const debug = window.__gameDebug as unknown as LabDebug;
        const rect = document.querySelector('#viewport')!.getBoundingClientRect();
        return { camera: debug.getCamera(), bounds: debug.getDrawnBounds(entityId)!, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      }, id);
      const camera = new PerspectiveCamera(CAMERA.fov, projection.rect.width / projection.rect.height, CAMERA.near, CAMERA.far);
      camera.position.set(projection.camera.position.x, projection.camera.position.y, projection.camera.position.z);
      camera.lookAt(projection.camera.target.x, projection.camera.target.y, projection.camera.target.z);
      camera.updateMatrixWorld(true);
      const { bounds, rect } = projection;
      for (const y of [.45, .2, .7]) for (const x of [.5, .25, .75]) for (const z of [.5, .25, .75]) {
        remaining(1);
        const p = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * x,
          bounds.min.y + (bounds.max.y - bounds.min.y) * y,
          bounds.min.z + (bounds.max.z - bounds.min.z) * z).project(camera);
        const px = rect.x + (p.x + 1) * rect.width / 2, py = rect.y + (1 - p.y) * rect.height / 2;
        if (p.z < -1 || p.z > 1 || px < 0 || py < 0 || px >= 1440 || py >= 900) continue;
        await page.mouse.move(px, py);
        await page.waitForTimeout(65);
        const hit = await page.evaluate(({ px, py }) => ({
          id: (window.__gameDebug as unknown as LabDebug).getState().hoveredEntityId,
          canvas: document.elementFromPoint(px, py)?.tagName === 'CANVAS',
        }), { px, py });
        if (!hit.canvas || hit.id !== id) continue;
        await page.mouse.click(px, py, { button: menuAction ? 'right' : 'left' });
        if (menuAction) {
          const action = page.getByRole('menuitem', { name: menuAction, exact: true });
          await action.click({ timeout: remaining() });
        }
        return;
      }
      throw new Error(`No real canvas hover hit ${id}`);
    }

    stage = 'crafting fixture';
    const fixture = await page.evaluate(() => (window as unknown as { __creatureLootFixture: LootFixture }).__creatureLootFixture.prepare());
    assert(fixture.ready, 'The production crafting fixture did not prepare');
    const station = await driver.callDebug('getEntity', [fixture.stationId]) as SemanticEntity;
    assert(station.station, 'Fixture lacks its production station');
    const stand = station.interactionPosition ?? station.position;
    await frame(stand[0], stand[2], .8, 8);
    await clickEntity(station.id, `Use ${station.name}`);
    const panel = page.locator('#panel-production');
    await panel.waitFor({ state: 'visible', timeout: remaining(4000) });
    for (const [index, recipeId] of ['craft_dragonhide_hood', 'craft_starhide_robe'].entries()) {
      stage = recipeId;
      const recipe = WILDERNESS_LOOT_RECIPES.find((row) => row.id === recipeId)!;
      assert(recipe && station.station.recipeIds.includes(recipeId), `Lab station must publish ${recipeId}`);
      const row = panel.locator('.production-row').filter({ has: page.getByText(recipe.name, { exact: true }) });
      await row.scrollIntoViewIfNeeded({ timeout: remaining() });
      const make = row.getByRole('button', { name: 'Make', exact: true });
      if (index === 0) {
        for (const [ingredientIndex, input] of recipe.inputs.entries()) {
          const quantity = input.quantity - (ingredientIndex === recipe.inputs.length - 1 ? 1 : 0);
          if (quantity) assert((await driver.callDebug('giveItem', [input.itemId, quantity, 'inventory']) as Result<number>).ok);
        }
        await page.waitForTimeout(100);
        assert(await make.isDisabled(), 'Missing thread must disable Make');
        const before = await save();
        const box = await make.boundingBox(); assert(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(100);
        const after = await save();
        assert.deepEqual(after.inventory.slots, before.inventory.slots, 'Disabled Make changed the inventory');
        assert.equal(after.activity, null);
        assert.equal(count(after.inventory.slots, recipe.output.itemId), 0);
        report.ingredientGate = { recipeId, missing: recipe.inputs.at(-1)!.itemId, before: before.inventory.slots, after: after.inventory.slots };
        await capture('01-missing-thread');
        assert((await driver.callDebug('giveItem', [recipe.inputs.at(-1)!.itemId, 1, 'inventory']) as Result<number>).ok);
      } else {
        for (const input of recipe.inputs) assert((await driver.callDebug('giveItem', [input.itemId, input.quantity, 'inventory']) as Result<number>).ok);
      }
      await page.waitForFunction((name) => [...document.querySelectorAll('.production-row')].some((article) =>
        article.querySelector('.production-row__name')?.textContent === name
        && !(article.querySelector('.production-row__action') as HTMLButtonElement)?.disabled), recipe.name, { timeout: remaining() });
      const before = await save();
      const cursor = (await driver.callDebug('getEvents', [0]) as { nextSeq: number }).nextSeq;
      await make.click();
      await page.waitForFunction(({ recipeId, since }) => (window.__gameDebug as unknown as LabDebug).getEvents(since).events
        .some((event) => event.type === 'production.completed' && event.data.recipeId === recipeId), { recipeId, since: cursor }, { timeout: remaining(5000), polling: 50 });
      const after = await save();
      assert.equal(count(after.inventory.slots, recipe.output.itemId) - count(before.inventory.slots, recipe.output.itemId), 1);
      for (const input of recipe.inputs) assert.equal(count(before.inventory.slots, input.itemId) - count(after.inventory.slots, input.itemId), input.quantity);
      assert.equal(after.skills.crafting.xp - before.skills.crafting.xp, recipe.xp);
      (report.crafts as unknown[]).push({ recipeId, inputDelta: recipe.inputs, output: recipe.output, xp: recipe.xp });
    }
    await panel.getByRole('button', { name: 'Close Production', exact: true }).click();

    stage = 'wear crafted equipment';
    await page.locator('.dock__btn[data-panel="inventory"]').click();
    for (const id of ['dragonhide_hood', 'starhide_robe']) {
      const item = page.locator(`#panel-inventory .slot[data-item="${id}"]`);
      await item.waitFor({ state: 'visible', timeout: remaining() });
      await item.click();
    }
    await page.waitForFunction(() => {
      const state = window.__featureLab!.getState();
      return state.equipment.head === 'dragonhide_hood' && state.equipment.body === 'starhide_robe';
    }, undefined, { timeout: remaining() });
    const appearances = ['dragonhide_hood', 'starhide_robe'].flatMap((id) => gearAppearanceParts(id));
    assert(appearances.length >= 2, 'Crafted gear has no production appearance mappings');
    const expectedSkin = appearances.filter((part) => part.attach === 'skin').map((part) => part.assetId);
    await page.waitForFunction((expected) => {
      const motion = (window.__gameDebug as unknown as LabDebug).getPlayerMotion();
      return !motion.layerLoadPending && expected.every((id) => motion.layerAssets?.includes(id))
        && Object.keys(motion.attachmentLoading ?? {}).length === 0 && Object.keys(motion.attachmentErrors ?? {}).length === 0;
    }, expectedSkin, { timeout: remaining(6000) });
    await page.locator('.dock__btn[data-panel="inventory"]').click();
    await frame(stand[0], stand[2], 0, 6);
    // Two actual right-drags turn the gameplay camera around the avatar without moving its focus.
    for (let i = 0; i < 2; i++) {
      await page.mouse.move(610, 450); await page.mouse.down({ button: 'right' });
      await page.mouse.move(348, 450, { steps: 8 }); await page.mouse.up({ button: 'right' });
    }
    await page.waitForTimeout(150);
    const motion = await driver.callDebug('getPlayerMotion') as MotionState;
    const layerPrefix = motion.layerMeshes?.[0]?.startsWith('merged-') ? 'merged-' : 'part-';
    const profile = await driver.callDebug('getRenderProfile', [layerPrefix]) as ReturnType<LabDebug['getRenderProfile']>;
    assert(profile.draws.some((row) => row.pass.startsWith('colour') && row.triangles > 0
      && (motion.layerMeshes ?? []).includes(row.name)), 'Equipped layer meshes made no colour pass submission');
    report.gear = { expected: appearances, motion, profile, semantic: (await page.evaluate(() => window.__featureLab!.getState())).equipment };
    await capture('02-crafted-armour');

    stage = 'wounded keeper setup';
    await frame(0, 0, 0, 11);
    const keeper = await page.evaluate(() => window.__featureLab!.spawnTarget('creature', 'candidate:furnace_regent', { distance: 3 }));
    assert(keeper.target && keeper.target.health && keeper.target.maxHealth);
    const keeperId = keeper.target.entityId;
    const beforeWound = await driver.callDebug('getEntity', [keeperId]) as SemanticEntity;
    const wounded = (await page.evaluate((id) => (window as unknown as { __creatureLootFixture: LootFixture })
      .__creatureLootFixture.prepareWoundedTarget(id), keeperId)).woundedTarget;
    assert(wounded);
    const afterWound = await driver.callDebug('getEntity', [keeperId]) as SemanticEntity;
    assert.equal(wounded.entityId, keeperId); assert.equal(wounded.setupHealth, 1);
    assert.equal(wounded.maxHealth, beforeWound.combat!.maxHealth);
    assert.equal(afterWound.combat!.health, 1);
    assert.deepEqual({ ...afterWound.combat, health: beforeWound.combat!.health }, beforeWound.combat, 'Wounded fixture changed combat stats');
    assert.equal(count((await save()).inventory.slots, 'chaos_rune'), 0);
    assert.equal(count((await save()).inventory.slots, 'cosmic_rune'), 0);
    report.keeperSetup = wounded;
    stage = 'real keeper kill';
    const killCursor = (await driver.callDebug('getEvents', [0]) as { nextSeq: number }).nextSeq;
    await clickEntity(keeperId, `Attack ${afterWound.name}`);
    await page.waitForFunction((id) => (window.__gameDebug as unknown as LabDebug).getEntity(id)?.state === 'dead', keeperId,
      { timeout: remaining(12000), polling: 60 });
    const events = await driver.callDebug('getEvents', [killCursor]) as ReturnType<LabDebug['getEvents']>;
    assert(events.events.some((event) => event.type === 'combat.started' && event.data.initiator === 'player'),
      'Canvas attack did not start production combat');
    const loots = await driver.callDebug('listEntities', [{ archetype: 'loot' }]) as SemanticEntity[];
    assert.equal(loots.length, 1, 'One keeper kill must create one loot container');
    const loot = loots[0]!;
    stage = 'collect earned invocation runes';
    // Its production death clip finishes before the overlapping corpse dissolves. Wait for that
    // real lifecycle, rather than hiding the corpse or invoking loot through a debug action.
    await page.waitForFunction((id) => {
      const bounds = (window.__gameDebug as unknown as LabDebug).getDrawnBounds(id);
      return !bounds || bounds.fade >= .999;
    }, keeperId, { timeout: remaining(7000), polling: 60 });
    report.lootBeforePickup = { loot, corpse: await driver.callDebug('getDrawnBounds', [keeperId]),
      lootBounds: await driver.callDebug('getDrawnBounds', [loot.id]), state: await driver.callDebug('getState') };
    await clickEntity(loot.id, `Open ${loot.name}`);
    const reveal = page.locator(`.loot-reveal[data-source-id="${loot.id}"]`);
    await reveal.waitFor({ state: 'visible', timeout: remaining(5000) });
    await reveal.locator('.slot[data-item="chaos_rune"]').click();
    await reveal.locator('.slot[data-item="cosmic_rune"]').click();
    const earned = await save();
    const chaos = count(earned.inventory.slots, 'chaos_rune'), cosmic = count(earned.inventory.slots, 'cosmic_rune');
    assert(chaos >= 24 && chaos <= 40); assert(cosmic >= 24 && cosmic <= 40);
    report.keeperLoot = { keeperId, loot, events, chaos, cosmic };
    await capture('03-earned-runes');
    await page.keyboard.press('Escape');

    stage = 'cast from earned runes';
    await page.evaluate(() => window.__featureLab!.equipPlayer('mainHand', 'magic_staff'));
    assert((await driver.callDebug('giveItem', ['fire_essence', 3, 'inventory']) as Result<number>).ok);
    await page.locator('.dock__btn[data-panel="spellbook"]').click();
    await page.getByRole('button', { name: 'All spells', exact: true }).click();
    const spell = page.locator('#panel-spellbook .spellbook__cell[data-spell="furnace-whip"]');
    await spell.waitFor({ state: 'visible', timeout: remaining() });
    const beforeCast = await save();
    const spellCount = (await page.evaluate(() => window.__featureLab!.getState())).counters.spellLaunched;
    const castCursor = (await driver.callDebug('getEvents', [0]) as { nextSeq: number }).nextSeq;
    await spell.click();
    await page.waitForFunction(() => document.body.classList.contains('is-aiming'), undefined, { timeout: remaining() });
    // The aiming session captures pointer input at window level. The next click must be on
    // the ground, since a dock click would also be interpreted as a spell placement.
    const box = await page.locator('#viewport').boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .64);
    await page.waitForTimeout(100);
    assert.equal((await page.evaluate(() => window.__featureLab!.getState())).counters.spellLaunched, spellCount);
    stage = 'launch earned-rune invocation';
    await timedCastStep('ground-click', () => page.mouse.click(box.x + box.width * .5, box.y + box.height * .64));
    await timedCastStep('launch-wait', () => page.waitForFunction((previous) => window.__featureLab!.getState().counters.spellLaunched > previous,
      spellCount, { timeout: remaining(4500), polling: 40 }));
    const paidState = await timedCastStep('paid-state', save);
    assert.equal(count(beforeCast.inventory.slots, 'chaos_rune') - count(paidState.inventory.slots, 'chaos_rune'), 1);
    assert.equal(count(beforeCast.inventory.slots, 'cosmic_rune') - count(paidState.inventory.slots, 'cosmic_rune'), 1);
    assert.equal(count(beforeCast.inventory.slots, 'fire_essence') - count(paidState.inventory.slots, 'fire_essence'), 1);
    report.castLaunch = { events: await timedCastStep('launch-events', () => driver.callDebug('getEvents', [castCursor])),
      errors: await timedCastStep('launch-errors', () => driver.callDebug('getErrors')),
      art: await timedCastStep('launch-art', () => driver.callDebug('getElementalArtState')),
      visual: await timedCastStep('launch-visual', () => driver.callDebug('getBasicSpellState')),
      spent: { chaos: count(beforeCast.inventory.slots, 'chaos_rune') - count(paidState.inventory.slots, 'chaos_rune'),
        cosmic: count(beforeCast.inventory.slots, 'cosmic_rune') - count(paidState.inventory.slots, 'cosmic_rune'),
        essence: count(beforeCast.inventory.slots, 'fire_essence') - count(paidState.inventory.slots, 'fire_essence') } };
    stage = 'draw advanced invocation';
    await timedCastStep('visible-art-wait', () => page.waitForFunction(() => {
      const art = (window.__gameDebug as unknown as LabDebug).getElementalArtState();
      return art?.fire.variant === 'furnace-whip' && art.fire.mainShapes > 0;
    }, undefined, { timeout: remaining(3000), polling: 40 }));
    const art = await driver.callDebug('getElementalArtState') as ReturnType<LabDebug['getElementalArtState']>;
    const spellProfile = await driver.callDebug('getRenderProfile', ['elemental-furnace-lash']) as ReturnType<LabDebug['getRenderProfile']>;
    assert(spellProfile.draws.some((draw) => draw.pass.startsWith('colour') && draw.triangles > 0), 'Furnace Whip made no colour pass submission');
    await capture('04-earned-rune-cast');
    const afterCast = await save();
    assert.equal(count(beforeCast.inventory.slots, 'chaos_rune') - count(afterCast.inventory.slots, 'chaos_rune'), 1);
    assert.equal(count(beforeCast.inventory.slots, 'cosmic_rune') - count(afterCast.inventory.slots, 'cosmic_rune'), 1);
    assert.equal(count(beforeCast.inventory.slots, 'fire_essence') - count(afterCast.inventory.slots, 'fire_essence'), 1);
    report.cast = { spellId: 'furnace-whip', before: { chaos, cosmic, essence: 3 },
      after: { chaos: count(afterCast.inventory.slots, 'chaos_rune'), cosmic: count(afterCast.inventory.slots, 'cosmic_rune'), essence: count(afterCast.inventory.slots, 'fire_essence') },
      art, profile: spellProfile };
    assert.equal((await driver.callDebug('getState') as { clock: { timeScale: number } }).clock.timeScale, 1);
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    assert.deepEqual(await driver.callDebug('getErrors'), []);
    assert.deepEqual([...driver.consoleErrors, ...driver.pageErrors, ...driver.requestErrors], []);
    report.passed = true;
  } catch (error) {
    report.stage = stage; report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    if (driver.page) try {
      report.failureDebug = { errors: await driver.callDebug('getErrors'), art: await driver.callDebug('getElementalArtState'),
        spells: await driver.callDebug('getBasicSpellState') };
    } catch { /* Preserve the original error if the page did not boot. */ }
    if (driver.page && Date.now() - started < 51_000) {
      try { (report.screenshots as string[]).push(await driver.screenshot(out, 'failure')); } catch { /* Preserve the original error. */ }
    }
  } finally {
    report.elapsedMs = Date.now() - started;
    report.errors = { console: driver.consoleErrors, page: driver.pageErrors, request: driver.requestErrors };
    try {
      await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ passed: report.passed, elapsedMs: report.elapsedMs, stage: report.stage, error: report.error, report: path.join(out, 'report.json') }));
    } finally { await driver.close(); await server.close(); clear(); }
  }
}

await main();
