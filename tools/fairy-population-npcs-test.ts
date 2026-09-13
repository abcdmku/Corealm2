import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
import {
  FAIRY_NPC_CANDIDATES,
  FAIRY_NPC_SCALE,
  fairyNpcPresentation,
} from '../game/src/content/fairyNpcs.js';
import { dialogueNode } from '../game/src/content/dialogue.js';

const args = process.argv.slice(2);
const requestedRegion = argValue(args, '--region') ?? argValue(args, '--part') ?? 'gloamgarden';
const shard = Number(argValue(args, '--shard') ?? 0);
const explicitPresets = argValue(args, '--presets')?.split(',').map(id => id.trim()).filter(Boolean);
const out = path.resolve('test-results/fairy-population/npcs');
const reportName = argValue(args, '--report')
  ?? `${requestedRegion}${shard > 0 ? `-${shard}` : ''}`;

assert(
  requestedRegion === 'gloamgarden' || requestedRegion === 'faeholme' || requestedRegion === 'all',
  `Unknown fairy NPC region: ${requestedRegion}`,
);
assert(!shard || shard === 1 || shard === 2, '--shard must be 1 or 2');

const allFairies = [...FAIRY_NPC_CANDIDATES];
const selected = explicitPresets
  ? explicitPresets.map(id => allFairies.find(npc => npc.id === id) ?? assert.fail(`Unknown fairy NPC preset: ${id}`))
  : allFairies.filter(npc => requestedRegion === 'all' || npc.regionId === requestedRegion)
    .filter((_, index) => !shard || index % 2 === shard - 1);
assert(selected.length > 0, 'No fairy NPCs selected');

await mkdir(out, { recursive: true });

const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});

const evidence: Record<string, unknown> = {
  selected: selected.map(npc => npc.id),
  region: requestedRegion,
  shard: shard || null,
  scale: FAIRY_NPC_SCALE,
  skins: {},
  conversations: {},
};

try {
  await driver.launch();
  const page = driver.page!;
  await driver.open(
    30_000,
    '/index.html?mode=combat&environment=1&atmosphere=1&architecture=gloamgarden&startup-cache=0',
  );

  const posePlayerCamera = async () => {
    // This is the ordinary follow camera: the target remains the player and detached is false.
    await driver.callDebug('inspectPose', [{ x: 0, y: 0, z: -2, yaw: -2.513, pitch: 0.3, distance: 6, detached: false }]);
    await page.waitForTimeout(250);
  };
  const labState = async () => page.evaluate(() => (window as any).__featureLab!.getState());
  const debugErrors = async () => driver.callDebug('getErrors');
  const skinEvidence = evidence.skins as Record<string, unknown>;
  const conversationEvidence = evidence.conversations as Record<string, unknown>;

  const talkToTarget = async () => {
    const state = await labState();
    const point = state.target?.screen;
    assert(point && point.length === 2, 'NPC must have a visible interaction point');
    await page.mouse.click(point[0], point[1], { button: 'right' });
    const talk = page.getByRole('menuitem', { name: /Talk to/ });
    await talk.waitFor({ state: 'visible', timeout: 5_000 });
    await talk.click();
    const dialog = page.getByRole('dialog', { name: /Conversation|Dialogue/ });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    // The dialogue system is deliberately deferred out of the initial boot graph. Waiting for the
    // current speaker line avoids treating its short "Loading conversation..." placeholder as the
    // authored root when a new browser session has a cold module cache.
    await dialog.locator('.dialogue__turn--npc.is-current .dialogue__said').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(() => {
      const text = document.querySelector('.dialogue__turn--npc.is-current .dialogue__said')?.textContent?.trim();
      return Boolean(text && text !== 'Loading conversation...');
    }, undefined, { timeout: 10_000 });
    return dialog;
  };

  const sampledHeightsBySkin = new Map<string, number[]>();
  for (const npc of selected) {
    await page.getByLabel('Biome atmosphere', { exact: true }).selectOption(npc.regionId);
    await posePlayerCamera();
    await page.evaluate(async id => {
      await (window as any).__featureLab!.spawnTarget('npc', id, { distance: 3 });
    }, npc.id);
    await page.waitForFunction(() => {
      const target = (window as any).__featureLab?.getState().target;
      return target?.motion?.liveRig === true && target?.screen;
    }, undefined, { timeout: 10_000 });
    await page.waitForTimeout(300);

    const stateBefore = await labState();
    const targetId = stateBefore.target?.entityId;
    assert(targetId, `${npc.id}: missing spawned entity id`);
    const entityBefore = await driver.callDebug('getEntity', [targetId]) as any;
    const motionBefore = await driver.callDebug('getEntityMotion', [targetId]) as any;
    const boundsBefore = await driver.callDebug('getDrawnBounds', [targetId]) as any;
    assert.equal(entityBefore?.archetype, 'npc', `${npc.id}: target must use NPC archetype`);
    assert.equal(entityBefore?.npc?.dialogueRootId, npc.dialogueRootId, `${npc.id}: root reference`);
    assert.equal(entityBefore?.view?.assetId, npc.assetId, `${npc.id}: source asset`);
    assert.equal(entityBefore?.view?.scale, FAIRY_NPC_SCALE, `${npc.id}: 20% presentation scale`);
    assert(boundsBefore?.height > 0.7, `${npc.id}: missing rendered height`);
    assert.equal(motionBefore?.liveRig, true, `${npc.id}: NPC must be on the live rig path`);
    assert.equal(motionBefore?.clip, 'Idle_Loop', `${npc.id}: native idle clip`);

    const skin = npc.assetId;
    const samples = sampledHeightsBySkin.get(skin) ?? [];
    for (let index = 0; index < 6; index += 1) {
      await page.waitForTimeout(120);
      const bounds = await driver.callDebug('getDrawnBounds', [targetId]) as any;
      assert(bounds?.height > 0.7, `${npc.id}: rendered bounds disappeared during sampling`);
      samples.push(Number(bounds.height));
    }
    sampledHeightsBySkin.set(skin, samples);
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const nativeEquivalent = median / FAIRY_NPC_SCALE;
    // The source idle reads about 0.88 m at native size; the 1.2x body should read about 1.05 m.
    assert(nativeEquivalent > 0.74 && nativeEquivalent < 1.02, `${npc.id}: native equivalent ${nativeEquivalent.toFixed(3)} m is implausible`);
    assert(median > 0.89 && median < 1.23, `${npc.id}: scaled rendered height ${median.toFixed(3)} m is implausible`);

    await page.waitForTimeout(450);
    const motionAfter = await driver.callDebug('getEntityMotion', [targetId]) as any;
    const boundsAfter = await driver.callDebug('getDrawnBounds', [targetId]) as any;
    assert.equal(motionAfter?.liveRig, true, `${npc.id}: motion must remain live`);
    assert.equal(motionAfter?.clip, 'Idle_Loop', `${npc.id}: idle clip changed unexpectedly`);
    assert.notEqual(motionBefore?.time, motionAfter?.time, `${npc.id}: idle motion time must advance`);
    assert(boundsAfter?.height > 0.7, `${npc.id}: post-motion bounds missing`);

    const camera = await driver.callDebug('getCamera') as any;
    const currentState = await labState();
    assert.equal(currentState.playerVisible, true, `${npc.id}: player must remain visible in attached view`);
    assert.equal(camera.freeMove, false, `${npc.id}: acceptance shot must use attached camera`);
    assert(camera.target && Math.hypot(camera.target.x - currentState.playerPosition[0], camera.target.z - currentState.playerPosition[2]) < 0.1,
      `${npc.id}: camera target must remain on player`);
    if (!(skin in skinEvidence)) {
      skinEvidence[skin] = {
        candidateId: npc.id,
        scale: entityBefore.view.scale,
        boundsBefore,
        boundsAfter,
        samples,
        medianHeight: median,
        nativeEquivalentHeight: nativeEquivalent,
        expectedNativeHeight: 0.88,
        expectedScaledHeight: 0.88 * FAIRY_NPC_SCALE,
        motionBefore,
        motionAfter,
        camera,
      };
      await driver.screenshot(out, `attached-${skin}`);
    }

    const root = dialogueNode(npc.dialogueRootId);
    assert(root, `${npc.id}: dialogue root missing`);
    const branch = root.options.find(option => option.next !== null);
    const farewell = root.options.find(option => option.next === null);
    assert(branch?.next, `${npc.id}: dialogue branch missing`);
    assert(farewell, `${npc.id}: farewell branch missing`);
    const detail = dialogueNode(branch.next);
    assert(detail, `${npc.id}: branch target missing`);

    const dialog = await talkToTarget();
    const rootText = await dialog.textContent() ?? '';
    assert(rootText.includes(root.text), `${npc.id}: browser root dialogue text missing`);
    const rootOptions = dialog.locator('button.dialogue__option');
    assert.equal(await rootOptions.count(), root.options.length, `${npc.id}: browser root option count`);
    await driver.screenshot(out, `${npc.id}-talk`);

    const branchIndex = root.options.indexOf(branch);
    await rootOptions.nth(branchIndex).click();
    await page.waitForTimeout(150);
    const detailText = await dialog.textContent() ?? '';
    assert(detailText.includes(detail.text), `${npc.id}: browser branch text missing`);
    const detailOptions = dialog.locator('button.dialogue__option');
    assert.equal(await detailOptions.count(), detail.options.length, `${npc.id}: browser detail option count`);
    await detailOptions.first().click();
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    const farewellDialog = await talkToTarget();
    const farewellOptions = farewellDialog.locator('button.dialogue__option');
    assert.equal(await farewellOptions.count(), root.options.length, `${npc.id}: farewell reopen option count`);
    await farewellOptions.nth(root.options.indexOf(farewell)).click();
    await farewellDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    conversationEvidence[npc.id] = {
      npc: npc.name,
      rootId: npc.dialogueRootId,
      rootText,
      branchOption: branch.text,
      detailId: detail.id,
      detailText,
      farewellOption: farewell.text,
      rightClickTalk: true,
      detailClosed: true,
      farewellClosed: true,
    };
  }

  const beforeWalk = await driver.callDebug('getPlayerPosition');
  await page.locator('#viewport').focus();
  await page.evaluate(() => (window as any).__featureLab!.setWalkingEnabled(true));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await driver.press('KeyD', 450);
  const afterWalk = await driver.callDebug('getPlayerPosition');
  assert.notDeepEqual(beforeWalk, afterWalk, 'Real keyboard input must move the player');
  evidence.movement = { before: beforeWalk, after: afterWalk };

  const errors = await debugErrors();
  evidence.errors = errors;
  evidence.browserErrors = { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors };
  assert.deepEqual(errors, []);
  assert.deepEqual(driver.consoleErrors, []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.requestErrors, []);
  console.log(JSON.stringify({
    region: requestedRegion,
    shard: shard || null,
    selected: selected.map(npc => npc.id),
    skins: Object.keys(skinEvidence),
    conversations: Object.keys(conversationEvidence),
    errors,
  }));
} catch (error) {
  evidence.failure = String(error);
  evidence.browserErrors = { console: driver.consoleErrors, page: driver.pageErrors, requests: driver.requestErrors };
  evidence.body = await driver.page?.locator('body').innerText().catch(() => '');
  await driver.screenshot(out, `${reportName}-failure`).catch(() => {});
  console.log(JSON.stringify({ failure: evidence.failure, browserErrors: evidence.browserErrors }));
  throw error;
} finally {
  await writeFile(path.join(out, `report-${reportName}.json`), JSON.stringify(evidence, null, 2));
  await driver.close();
}
