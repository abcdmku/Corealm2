import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GameDriver } from './lib/driver.js';
import { installAssetCandidates } from './lib/assetCandidates.js';
import { argValue } from './lib/paths.js';
import { variantSeed } from '../game/src/render/buildings.js';

const args = process.argv.slice(2), part = argValue(args, '--part') ?? 'village';
const out = path.resolve('test-results/fairy-terraces-lab', argValue(args, '--out-name') ?? part);
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: Record<string, unknown> = {};
try {
  await driver.launch();
  const page = driver.page!;
  const catalog = argValue(args, '--catalog');
  if (catalog) await installAssetCandidates(page, catalog);
  const groundDirectory = argValue(args, '--ground-directory');
  const stoneDirectory = argValue(args, '--stone-directory');
  if (stoneDirectory) for (const file of ['corealm-surfaces.json', 'corealm-stone.png', 'corealm-stone-normal.png', 'corealm-stone-roughness.png']) {
    const bytes = await readFile(path.resolve(stoneDirectory, file));
    await page.route(`**/assets/textures/corealm/${file}*`, route => route.fulfill({ status: 200,
      contentType: file.endsWith('.json') ? 'application/json' : 'image/png', body: bytes }));
  }
  if (groundDirectory) for (const file of ['grass-albedo.webp', 'grass-normal.webp', 'grass-surface.json']) {
    const bytes = await readFile(path.resolve(groundDirectory, file));
    await page.route(`**/assets/textures/fairy-ground/${file}*`, route => route.fulfill({ status: 200,
      contentType: file.endsWith('.json') ? 'application/json' : 'image/webp', body: bytes }));
  }
  await driver.open(30_000, `/index.html?mode=${part === 'village' ? 'building' : 'combat'}&environment=1&atmosphere=1&architecture=gloamgarden&startup-cache=0${groundDirectory || stoneDirectory ? '&fairy-ground=1' : ''}${part === 'cliff' ? '&terrain=cliff' : ''}${part === 'motion' ? '&creatures=1' : ''}`);
  const pose = async (x: number, z: number, yaw: number, pitch = .35, distance = 11) => {
    await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch, distance, detached: false }]);
    await page.waitForTimeout(300);
  };
  const snap = async () => page.evaluate(() => {
    const d = window.__gameDebug as any;
    const lab = window.__featureLab!.getState();
    return { lab, player: d.getPlayer(), camera: d.getCamera(), errors: d.getErrors(),
      target: lab.target ? d.getEntity(lab.target.entityId) : null,
      motion: lab.target ? d.getEntityMotion(lab.target.entityId) : null,
      bounds: lab.target ? d.getDrawnBounds(lab.target.entityId) : null };
  });
  if (part === 'ground') {
    for (const region of ['gloamgarden', 'faeholme']) {
      await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(region);
      await pose(0, 31, 0, .45, 8);
      evidence[region] = await snap();
      await driver.screenshot(out, region);
    }
  } else if (part === 'rocks') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('gloamgarden');
    for (const id of (argValue(args, '--presets') ?? 'corealm_cliff_strata_1,corealm_cliff_strata_2,corealm_rock_strata_1').split(',')) {
      await page.evaluate(async ({ id, scale }) => {
        await (window as any).__environmentLab.showGallery(id, { scale, verticalOffset: scale < 1 ? -.55 : 0 });
      }, { id, scale: Number(argValue(args, '--scale') ?? 1) });
      const bounds = await page.evaluate(() => (window as any).__environmentLab.getBounds());
      assert(bounds);
      await pose((bounds.min[0] + bounds.max[0]) / 2, bounds.max[2] + 5, 0, .28);
      evidence[id] = { bounds, state: await snap() };
      await driver.screenshot(out, id);
    }
  } else if (part === 'cliff') {
    for (const region of ['gloamgarden', 'faeholme']) {
      await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(region);
      await pose(18, -3, 0, .16);
      evidence[region] = await snap();
      await driver.screenshot(out, `rock-face-${region}`);
    }
    assert((await driver.callDebug('groundHeight', [0, -55]) as number) > 5.5);
    assert((await driver.callDebug('groundHeight', [18, -3]) as number) < 1);
  } else if (part === 'village-candidates') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('gloamgarden');
    for (const [name, id, width, depth, seed] of [
      ['market', 'market_row', 12, 3, 4107510004],
      ['lantern-bank', 'forge', 6, 4, 584037776],
      ['prism-bank', 'forge', 6, 4, 4261359314],
    ] as const) {
      await page.evaluate(async selection => { await window.__featureLab!.setStructure(selection); },
        { kind: 'prefab' as const, id, kit: 'timber' as const, width, depth, seed });
      await pose(-8, 21, 0, .3);
      evidence[name] = await snap();
      await driver.screenshot(out, name);
    }
  } else if (part === 'village') {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('gloamgarden');
    for (const [id, width, depth, seedId] of [
      ['cottage', 6, 4, 'lantern_rest_willow_cottage'],
      ['forge', 6, 4, 'lantern_rest_forge'],
      ['arcade', 8, 3, 'lantern_rest_shelter'],
    ] as const) {
      await page.evaluate(async selection => { await window.__featureLab!.setStructure(selection); },
        { kind: 'prefab' as const, id, kit: 'timber' as const, width, depth, seed: variantSeed(seedId) });
      await pose(-8, id === 'cottage' ? 4 : 21, id === 'cottage' ? Math.PI : 0, .35);
      const state = await snap();
      assert(state.lab.structure?.partCount! > 0);
      evidence[id] = state;
      await driver.screenshot(out, id);
    }
  } else if (part === 'motion') {
    for (const number of ['07', '08', '09']) {
      const preset = `species:guardian_${number}_fallowmarch`;
      await page.evaluate(async preset => {
        const gallery = (window as any).__creatureGallery;
        await gallery.show(preset, 1); gallery.place(0, 70, Math.PI);
      }, preset);
      await pose(0, 76, 0, .3, 8);
      const id = await page.evaluate(() => (window as any).__creatureGallery.getState().entityIds[0]);
      for (const motion of ['walk', 'run', 'attack']) {
        await page.evaluate(motion => (window as any).__creatureGallery.play(motion), motion);
        await page.waitForTimeout(180);
        const before = await driver.callDebug('getEntityMotion', [id]);
        await page.waitForTimeout(250);
        const after = await driver.callDebug('getEntityMotion', [id]);
        assert.notDeepEqual(before, after, `${preset} ${motion} must animate`);
        evidence[`${number}:${motion}`] = { before, after, bounds: await driver.callDebug('getDrawnBounds', [id]) };
        await driver.screenshot(out, `${number}-${motion}`);
      }
    }
  } else if (part === 'foliage') {
    for (const [asset, biome] of (argValue(args, '--presets') ? argValue(args, '--presets')!.split(',').map(id => [id, id.includes('_fae_') ? 'faeholme' : 'gloamgarden']) : [['corealm_willow_gloam_1', 'gloamgarden'], ['corealm_yew_fae_1', 'faeholme']])) {
      await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(biome!);
      await page.evaluate(async asset => { const mat = /^fairy_(groundcover|finegrass)_/.test(asset!); await (window as any).__environmentLab.showFoliage(asset, { layout: 'grid', count: mat ? 128 : 6, span: mat ? 8 : 24 }); }, asset);
      await pose(0, /^fairy_(groundcover|finegrass)_/.test(asset!) ? 31 : 40, 0, /^fairy_(groundcover|finegrass)_/.test(asset!) ? .5 : .28, /^fairy_(groundcover|finegrass)_/.test(asset!) ? 6 : 11);
      evidence[asset!] = await snap();
      await driver.screenshot(out, asset!);
    }
  } else {
    const presets = (argValue(args, '--presets') ?? '').split(',').filter(Boolean);
    assert(presets.length, 'Supply --presets');
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption('gloamgarden');
    for (const preset of presets) {
      await pose(0, 0, 0, .3, part === 'npcs' ? 5 : 9);
      await page.evaluate(async ({ kind, preset, distance }) => {
        await window.__featureLab!.spawnTarget(kind, preset, { distance });
      }, { kind: part === 'npcs' ? 'npc' as const : 'creature' as const, preset, distance: part === 'npcs' ? 3 : 5 });
      await pose(0, -2, -.8 * Math.PI, .3, part === 'npcs' ? 5 : 9);
      await page.waitForTimeout(500);
      const before = await snap();
      assert(before.bounds && before.motion, `${preset}: missing rendered body or animation`);
      await driver.screenshot(out, preset.replace(/:/g, '-'));
      await page.waitForTimeout(350);
      const after = await snap();
      evidence[preset] = { before, after };
      if (part === 'npcs') {
        const point = after.lab.target?.screen;
        assert(point, 'NPC must have a visible interaction point');
        await page.mouse.click(point[0], point[1], { button: 'right' });
        await page.getByRole('menuitem', { name: /Talk to/ }).click();
        await page.getByRole('dialog', { name: /Conversation|Dialogue/ }).waitFor({ timeout: 10_000 });
        evidence[`${preset}:dialogue`] = await page.locator('.dialogue').textContent();
        await driver.screenshot(out, `${preset}-talk`);
        await page.keyboard.press('Escape');
      }
    }
    if (part === 'lifecycle') {
      const miniboss = presets.at(-1)!.includes('guardian_');
      const respawnMs = miniboss ? 1800_000 : 30_000;
      await page.evaluate(async () => {
        window.__featureLab!.setLevel('melee', 85);
        await window.__featureLab!.equipPlayer('mainHand', 'emberite_sword');
      });
      await page.getByRole('button', { name: 'Attack spawned creature', exact: true }).click();
      await page.waitForFunction(() => window.__featureLab!.getState().target?.state === 'dead', undefined, { timeout: 35_000 });
      const dead = await snap();
      evidence.death = dead;
      assert(dead.lab.target!.ai!.respawnInMs! > respawnMs - 1000);
      assert(dead.lab.target!.ai!.respawnInMs! <= respawnMs);
      const state = JSON.parse(await driver.callDebug('getSaveBlob') as string);
      evidence.loot = state.world.lootPiles;
      if (miniboss) assert(Object.values(state.world.lootPiles).some((pile: any) => pile.items.some((item: any) => item.itemId.startsWith('warden_jewellery_'))));
      const runtime = state.world.enemies[dead.lab.target!.entityId];
      if (miniboss) assert(runtime.respawnAtWallMs - Date.now() > 1790_000);
      if (miniboss) {
        evidence.collected = await driver.callDebug('callTool', ['corealm_loot_nearby', { radius: 20, timeoutMs: 15000 }]);
        const looted = JSON.parse(await driver.callDebug('getSaveBlob') as string);
        const jewellery = looted.inventory.slots.find((slot: any) => slot?.itemId?.startsWith('warden_jewellery_'));
        assert(jewellery, 'Guardian jewellery must reach inventory through the real loot flow');
        evidence.equipped = await driver.callDebug('callTool', ['corealm_equip', { itemId: jewellery.itemId }]);
        const equipped = JSON.parse(await driver.callDebug('getSaveBlob') as string);
        assert(Object.values(equipped.equipment).some((slot: any) => slot?.itemId === jewellery.itemId));
        await page.keyboard.press('KeyE');
        await driver.screenshot(out, 'jewellery-equipped');
        await page.keyboard.press('Escape');
      }
      await driver.screenshot(out, 'miniboss-death');
      await driver.callDebug('advanceGameTime', [respawnMs / 1000 - 5]);
      assert.equal((await snap()).lab.target!.state, 'dead');
      await driver.callDebug('advanceGameTime', [6]);
      await page.waitForFunction(() => window.__featureLab!.getState().target?.state === 'alive');
      evidence.respawn = await snap();
    }
  }
  const beforeWalk = await driver.callDebug('getPlayerPosition');
  await page.locator('#viewport').focus();
  await page.evaluate(() => window.__featureLab!.setWalkingEnabled(true));
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await driver.press('KeyD', 450);
  const afterWalk = await driver.callDebug('getPlayerPosition');
  evidence.movement = { before: beforeWalk, after: afterWalk };
  assert.notDeepEqual(beforeWalk, afterWalk, 'Real keyboard input must move the player');
  evidence.errors = await driver.callDebug('getErrors');
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  console.log(JSON.stringify({ part, passed: Object.keys(evidence), errors: driver.consoleErrors }));
} catch (error) {
  evidence.failure = String(error); evidence.consoleErrors = driver.consoleErrors; evidence.pageErrors = driver.pageErrors;
  evidence.body = await driver.page?.locator('body').innerText();
  await driver.screenshot(out, 'failure').catch(() => {});
  console.log(JSON.stringify({ failure: evidence.failure, console: evidence.consoleErrors, pageErrors: evidence.pageErrors, body: evidence.body }));
  throw error;
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(evidence, null, 2));
  await driver.close();
}
