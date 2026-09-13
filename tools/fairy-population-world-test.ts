import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
import { FAIRY_TERRACE_ENCOUNTERS } from '../game/src/content/fairyTerraceEncounters.js';
import { FAIRY_NPC_CANDIDATES, FAIRY_NPC_STANDS, FAIRY_NPC_SCALE } from '../game/src/content/fairyNpcs.js';
import { FAIRY_MINIBOSS_POOLS } from '../game/src/content/fairyMinibossForms.js';
import { CAMERA } from '../game/src/app/config.js';

const args = process.argv.slice(2), region = argValue(args, '--region') ?? 'gloamgarden';
const part = argValue(args, '--part') ?? 'all';
assert(region === 'gloamgarden' || region === 'faeholme');
const out = argValue(args, '--out') ?? `test-results/fairy-population/world/${region}/${part}`;
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 }, browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: Record<string, any> = { region, startedAt: new Date().toISOString() };
const start = Date.now(), deadline = setTimeout(() => { void driver.close(); }, 120_000);
try {
  await driver.launch();
  await driver.open(90_000, '/index.html');
  console.log(`[fairy-world] ${region}: ready after ${Date.now() - start} ms`);
  const page = driver.page!;
  const entities = await page.evaluate(() => {
    const d = window.__gameDebug as any;
    return d.listEntities().filter((e: any) => ['gloamgarden', 'faeholme'].includes(e.regionId)
      && ['enemy', 'boss', 'npc'].includes(e.archetype));
  });
  for (const regionId of ['gloamgarden', 'faeholme'] as const) {
    const mobs = entities.filter((e: any) => e.regionId === regionId && e.archetype === 'enemy');
    assert.equal(mobs.length, 42, `${regionId}: preserve the total resident budget`);
    assert.equal(new Set(mobs.map((e: any) => e.view.assetId)).size, 12);
    assert(mobs.every((e: any) => e.view.assetId.startsWith('fairy_garden_')), 'Legacy ordinary fairy bodies must not spawn');
    const bosses = entities.filter((e: any) => e.regionId === regionId && e.id.startsWith('universal_miniboss_'));
    assert.equal(bosses.length, 2);
    assert(bosses.every((e: any) => FAIRY_MINIBOSS_POOLS[regionId].some(number => e.view.assetId === `fairy_guardian_${number}_${regionId}`)));
    const fairies = entities.filter((e: any) => e.regionId === regionId && e.id.startsWith('npc_fey_'));
    assert.equal(fairies.length, 6);
    assert(fairies.every((e: any) => e.view.scale === FAIRY_NPC_SCALE));
    evidence[`${regionId}:population`] = { mobs, bosses, fairies };
  }
  for (const { group, habitat } of FAIRY_TERRACE_ENCOUNTERS) {
    const residents = entities.filter((e: any) => e.meta?.groupId === group.id);
    assert.equal(residents.length, group.count, group.id);
    for (const resident of residents) assert(Math.hypot(resident.position[0] - habitat.centre[0], resident.position[2] - habitat.centre[1])
      + resident.combat.bodyRadius + 1.5 < habitat.radius, `${resident.id}: receiving floor`);
  }
  const pose = async (x: number, z: number, yaw = 0, distance = 7) => {
    assert.equal(await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch: .3, distance, detached: false }]), true);
    await driver.callDebug('waitForView');
    await page.waitForTimeout(200);
    const camera = await driver.callDebug('getCamera') as any;
    assert.equal(camera.freeMove, false);
    assert(camera.requestedDistance >= CAMERA.minDistance && camera.requestedDistance <= CAMERA.maxDistance);
  };
  const regionalNpcs = FAIRY_NPC_CANDIDATES.filter(n => n.regionId === region);
  const selectedNpcs = part === 'gardens' || part === 'guardian' ? [] : part === 'npcs-1' ? regionalNpcs.slice(0, 3)
    : part === 'npcs-2' ? regionalNpcs.slice(3) : regionalNpcs;
  for (const npc of selectedNpcs) {
    const stand = FAIRY_NPC_STANDS.find(s => s.id === npc.id)!;
    // Start in the authored square. The real dispatcher must find an approach from its public lanes.
    const square = region === 'gloamgarden' ? [2080, -105] : [2300, 140];
    await pose(square[0]!, square[1]!, Math.atan2(square[0]! - stand.position[0], square[1]! - stand.position[1]));
    const before = { player: await driver.callDebug('getPlayerPosition'), entity: await driver.callDebug('getEntity', [npc.id]) };
    const result = await driver.callDebug('callTool', ['corealm_interact', { entityId: npc.id, interaction: 'talk' }]);
    evidence[npc.id] = { before, result };
    const dialogue = page.getByRole('dialog', { name: /Conversation|Dialogue/ });
    await dialogue.waitFor({ timeout: 10_000 });
    const text = await dialogue.innerText();
    assert(text.toLowerCase().includes(npc.name.toLowerCase()), `Conversation must match ${npc.name}`);
    const bounds = await driver.callDebug('getDrawnBounds', [npc.id]) as any;
    assert(bounds && bounds.height >= .9 && bounds.height <= 1.2, `${npc.name}: enlarged fairy height ${JSON.stringify(bounds)}`);
    evidence[npc.id] = { before, result, text, bounds, after: await driver.callDebug('getPlayerPosition') };
    await driver.screenshot(out, `${npc.id}-talk`);
    await page.keyboard.press('Escape');
    console.log(`[fairy-world] talked to ${npc.name} (${Date.now() - start} ms)`);
  }
  // One near-village mixed clearing and one larger fantasy pair prove actual world wiring.
  const localSites = region === 'gloamgarden' ? ['moonpetal_table', 'lantern_crown'] : ['prism_table', 'starroot_crown'];
  await driver.callDebug('setHealth', [10000]);
  for (const site of part.startsWith('npcs-') || part === 'guardian' ? [] : localSites) {
    const residents = entities.filter((e: any) => e.meta?.groupId === `fairy_${site}_residents` || e.meta?.groupId === `fairy_${site}_companions`);
    assert.equal(residents.length, 7);
    const actor = residents[0];
    await pose(actor.position[0] - 2.5, actor.position[2] + 2.5, -.6, 8);
    evidence[site] = await page.evaluate((ids: string[]) => {
      const d = window.__gameDebug as any;
      return ids.map(id => ({ entity: d.getEntity(id), motion: d.getEntityMotion(id), bounds: d.getDrawnBounds(id) }));
    }, residents.map((e: any) => e.id));
    assert(evidence[site].some((e: any) => e.bounds), `${site}: drawn world residents`);
    await driver.screenshot(out, site);
    console.log(`[fairy-world] checked ${site} (${Date.now() - start} ms)`);
  }
  if (!part.startsWith('npcs-')) {
    const guardian = entities.find((e: any) => e.regionId === region && e.id.startsWith('universal_miniboss_'));
    assert(guardian);
    await pose(guardian.position[0] + 3, guardian.position[2] - 3, Math.PI - .7, 8);
    const bounds = await driver.callDebug('getDrawnBounds', [guardian.id]);
    assert(bounds, 'The regional guardian must render in its authored socket');
    evidence.guardian = { entity: await driver.callDebug('getEntity', [guardian.id]), bounds };
    await driver.screenshot(out, 'guardian');
  }
  await pose(region === 'gloamgarden' ? 2080 : 2300, region === 'gloamgarden' ? -108 : 146, 0, 8);
  const before = await driver.callDebug('getPlayerPosition');
  await page.locator('#viewport').focus();
  await driver.press('KeyD', 400);
  const after = await driver.callDebug('getPlayerPosition');
  assert.notDeepEqual(before, after, 'Real keyboard movement must work in the village');
  evidence.movement = { before, after };
  evidence.errors = { game: await driver.callDebug('getErrors'), page: driver.pageErrors, console: driver.consoleErrors };
  assert.deepEqual(evidence.errors, { game: [], page: [], console: [] });
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error); evidence.errors = { page: driver.pageErrors, console: driver.consoleErrors };
  await driver.screenshot(out, 'failure').catch(() => {});
  throw error;
} finally {
  clearTimeout(deadline); evidence.elapsedMs = Date.now() - start;
  await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2));
  await driver.close(); console.log(JSON.stringify({ out, passed: evidence.passed, failure: evidence.failure, elapsedMs: evidence.elapsedMs }));
}
