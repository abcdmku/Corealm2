import { FAIRY_UPPER_GARDEN_RAMPS } from '../game/src/world/fairyRegionalRelief.js';
import { FAIRY_AGILITY_LINKS } from '../game/src/content/fairyAgility.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
import { FAIRY_TERRACE_ENCOUNTERS } from '../game/src/content/fairyTerraceEncounters.js';
import { isReservedUniversalMinibossAsset } from '../game/src/content/universalMinibosses.js';
import { FAIRY_COMBAT_PLATEAUS, FAIRY_LANDFORM_PROBES } from '../game/src/world/fairyLandforms.js';

const args = process.argv.slice(2), out = argValue(args, '--out') ?? 'test-results/fairy-terraces-world';
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4397', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: Record<string, any> = {};
const shippedResponses: { path: string; status: number }[] = [];
try {
  await driver.launch();
  if (args.includes('--release')) driver.page!.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/generated/world/') || path.endsWith('/corealm-navmesh.bin'))
      shippedResponses.push({ path, status: response.status() });
  });
  await driver.open(90_000, '/index.html?startup-cache=0');
  const page = driver.page!;
  await driver.callDebug('setSkillLevel', ['melee', 99]);
  await driver.callDebug('setSkillLevel', ['magic', 99]);
  await page.waitForTimeout(150);
  await driver.callDebug('setHealth', [10000]);
  evidence.boot = await driver.snapshot();
  const all = await page.evaluate(() => {
    const d = window.__gameDebug as any;
    return d.getEntities().filter((e: any) => e.archetype === 'enemy' || e.archetype === 'boss' || e.archetype === 'npc')
      .map((e: any) => d.getEntity(e.id));
  }) as any[];
  const guardians = all.filter(e => e.id.startsWith('universal_miniboss_'));
  evidence.guardians = guardians;
  assert.equal(guardians.length, 18);
  for (const region of new Set(guardians.map(e => e.regionId)))
    assert.equal(guardians.filter(e => e.regionId === region).length, 2);
  assert(all.filter(e => e.archetype === 'enemy' || e.archetype === 'boss')
    .every(e => !isReservedUniversalMinibossAsset(e.view.assetId) || e.id.startsWith('universal_miniboss_')));
  evidence.terraces = FAIRY_TERRACE_ENCOUNTERS.map(({ group, habitat }) => {
    const members = all.filter(e => e.meta?.groupId === group.id);
    assert.equal(members.length, group.count, group.id);
    for (const member of members) assert(Math.hypot(member.position[0] - habitat.centre[0],
      member.position[2] - habitat.centre[1]) + member.combat.bodyRadius + 1.5 <= habitat.radius + .01, member.id);
    return { id: group.id, members: members.map(e => ({ id: e.id, position: e.position })) };
  });
  for (const [id, x, z, yaw, pitch] of ((args.includes('--traversal-only') || args.includes('--npcs-only') || args.includes('--gardens-only')) ? [] : [
    ['lantern-rest', 2080, -108, 0, .28],
    ['lantern-market', 2081, -106, Math.PI, .23],
    ['lantern-market-close', 2081, -102, Math.PI, .23],
    ['lantern-north-lane', 2087, -76, Math.PI, .25],
    ['moonpetal-ascent', 2170, 26, 0, .2],
    ['lantern-crown-ascent', 2319, -22, -Math.PI / 2, .22],
    ['prism-hollow', 2300, 145, Math.PI, .24],
    ['prism-ascent', 2349, 215, Math.PI / 2, .22],
    ['deep-valley', 2425, -83, Math.PI / 2, .25],
    ['t30-north-corridor', 2084, -49, Math.PI, .28],
    ['t30-south-corridor', 2230, -141, -Math.PI / 2, .28],
    ['t60-west-corridor', 2185.5, 275, Math.PI / 2, .28],
    ['t60-orchid-crown', 2532, 248, Math.PI / 2, .3],
  ] as const).filter(view => !argValue(args, '--views') || argValue(args, '--views')!.split(',').includes(view[0]))) {
    await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch, distance: id.startsWith('lantern-market') ? 8 : 11, detached: false }]);
    await driver.callDebug('waitForView');
    await page.waitForTimeout(1000);
    evidence[id] = await driver.snapshot();
    if (id === 'lantern-crown-ascent') assert(evidence[id].camera.distance >= 3.5,
      'Lantern Crown approach hides the route behind the avatar');
    evidence[`${id}:scatter`] = await driver.callDebug('getScatterStats');
    await driver.screenshot(out, id);
    if (id === 'lantern-market') evidence['fairy-npc-views'] = await page.evaluate(() => { const d = window.__gameDebug as any; return d.getEntities().filter((e: any) => e.id.startsWith('npc_fey')).map((e: any) => ({ entity: d.getEntity(e.id), bounds: d.getDrawnBounds(e.id) })); });
    if (id === 'lantern-market') evidence['bank-contacts'] = await driver.callDebug('getScatterInstances', ['fairy_rounded_bank', 2081, -88, 12]);
  }
  if (!args.includes('--views-only') && !args.includes('--npcs-only') && !args.includes('--gardens-only')) {
    const probes = FAIRY_LANDFORM_PROBES.flatMap(probe => {
      const plateau = FAIRY_COMBAT_PLATEAUS.find(plateau => plateau.id === probe.id)!;
      return plateau.ramps.map((ramp, index) => ({ ...probe, id: index ? `${probe.id}_second` : probe.id,
        approach: ramp.points[0]!.position, summit: ramp.points.at(-1)!.position }));
    });
    for (const probe of probes) {
      const ground = async (p: readonly [number, number]) => [p[0], await driver.callDebug('groundHeight', [...p]) as number, p[1]];
      const start = await ground(probe.approach), end = await ground(probe.summit);
      const ascentYaw = Math.atan2(start[0]! - end[0]!, start[2]! - end[2]!);
      await driver.callDebug('inspectPose', [{ x: start[0], z: start[2], y: start[1], yaw: ascentYaw, pitch: .3, distance: 11, detached: false }]);
      await driver.callDebug('waitForView');
      await driver.callDebug('setMovementDetourDiagnostics', [true]);
      const path = await driver.callDebug('getNavPath', [start, end]) as any[] | null;
      assert(path?.length, `${probe.id}: ramp must have a navigation path`);
      evidence[`${probe.id}:path`] = path;
      const movement = await driver.callDebug('callTool', ['corealm_move_to', { position: end }]);
      evidence[`${probe.id}:move`] = movement;
      await page.waitForFunction(([x, z]) => {
        const p = (window.__gameDebug as any).getPlayerPosition();
        return Math.hypot(p.x - x!, p.z - z!) < 1.5;
      }, [end[0]!, end[2]!], { timeout: 30000 });
      evidence[`${probe.id}:arrived`] = await driver.snapshot();
      await driver.screenshot(out, `${probe.id}-summit`);
      const foot = await ground(probe.flankFoot), top = await ground(probe.flankTop);
      const yaw = Math.atan2(foot[0]! - top[0]!, foot[2]! - top[2]!);
      await driver.callDebug('inspectPose', [{ x: foot[0], z: foot[2], y: foot[1], yaw, pitch: .2, distance: 11, detached: false }]);
      await driver.callDebug('waitForView');
      const before = await driver.callDebug('getPlayerPosition') as any;
      evidence[`${probe.id}:flank-start`] = { requested: foot, actual: before, top };
      assert(Math.hypot(before.x - foot[0]!, before.z - foot[2]!) < 1.5 && before.y < foot[1]! + 1,
        `${probe.id}: the low flank approach is obstructed`);
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await driver.press('KeyW', 4000);
      const after = await driver.callDebug('getPlayerPosition') as any;
      evidence[`${probe.id}:blocked-flank`] = { before, after, top };
      assert(after.y < top[1]! - 2.5, `${probe.id}: direct keyboard movement climbed the blocked flank`);
      assert(Math.hypot(after.x - top[0]!, after.z - top[2]!) > 3);
      evidence[`${probe.id}:blocked-flank`] = { before, after, top };
      await driver.screenshot(out, `${probe.id}-blocked-flank`);
    }
    for (const [id, x, z, yaw] of [
      ['lantern_rest_bank', 2089, -111, .6], ['prism_hollow_bank', 2304.5, 139, -Math.PI / 2],
    ] as const) {
      await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch: .35, distance: 8, detached: false }]);
      await driver.callDebug('waitForView');
      evidence[`${id}:before`] = await driver.snapshot();
      evidence[`${id}:interaction`] = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'bank' }]);
      await page.getByRole('dialog', { name: /Bank/ }).waitFor({ timeout: 20000 });
      evidence[`${id}:after`] = await driver.snapshot();
      await driver.screenshot(out, `${id}-open`);
      await page.keyboard.press('Escape');
    }
  }
  if (args.includes('--highlands') || args.includes('--all-checks') || args.includes('--gardens-only')) {
    for (const wallX of args.includes('--gardens-only') ? [] : [2076, 2092]) {
      const x = 2084, z = -49;
      await driver.callDebug('inspectPose', [{ x, z, yaw: wallX < x ? Math.PI / 2 : -Math.PI / 2,
        pitch: .3, distance: 11, detached: false }]);
      await driver.callDebug('waitForView');
      const before = await driver.callDebug('getPlayerPosition') as any;
      const top = await driver.callDebug('groundHeight', [wallX, z]) as number;
      assert(top - before.y > 4, 'Regional bank must enclose the valley');
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await driver.press('KeyW', 4000);
      const after = await driver.callDebug('getPlayerPosition') as any;
      assert(after.y < top - 2.5, 'Ordinary movement climbed an unmarked regional bank');
      evidence[`regional-bank-${wallX}`] = { before, after, top };
      await driver.screenshot(out, `regional-bank-${wallX}`);
    }
    for (const ramp of FAIRY_UPPER_GARDEN_RAMPS.filter(ramp => !argValue(args, '--gardens')
      || argValue(args, '--gardens')!.split(',').includes(ramp.id))) {
      const first = ramp.points[0]!.position, last = ramp.points.at(-1)!.position;
      const start = [first[0], await driver.callDebug('groundHeight', [...first]), first[1]];
      const end = [last[0], await driver.callDebug('groundHeight', [...last]), last[1]];
      await driver.callDebug('inspectPose', [{ x: first[0], z: first[1], yaw: Math.atan2(first[0] - last[0], first[1] - last[1]), pitch: .3, distance: 11, detached: false }]);
      await driver.callDebug('waitForView');
      evidence[`${ramp.id}:before`] = await driver.snapshot();
      evidence[`${ramp.id}:path`] = await driver.callDebug('getNavPath', [start, end]);
      evidence[`${ramp.id}:move`] = await driver.callDebug('callTool', ['corealm_move_to', { position: end }]);
      await page.waitForFunction(([x, z]) => {
        const p = (window.__gameDebug as any).getPlayerPosition();
        return Math.hypot(p.x - x!, p.z - z!) < 1.5;
      }, last, { timeout: 30000 });
      const after = await driver.callDebug('getPlayerPosition') as any;
      assert(after.y - Number(start[1]) > 3.5, `${ramp.id}: did not climb onto the upper garden`);
      evidence[`${ramp.id}:after`] = await driver.snapshot();
      await driver.screenshot(out, `${ramp.id}-top`);
      const previous = ramp.points.at(-2)!.position;
      const dx = last[0] - previous[0], dz = last[1] - previous[1], length = Math.hypot(dx, dz);
      const interior = [last[0] + dx / length * 9, last[1] + dz / length * 9] as const;
      const interiorY = await driver.callDebug('groundHeight', [...interior]) as number;
      evidence[`${ramp.id}:interior-move`] = await driver.callDebug('callTool', ['corealm_move_to', {
        position: [interior[0], interiorY, interior[1]],
      }]);
      await page.waitForFunction(([x, z]) => {
        const p = (window.__gameDebug as any).getPlayerPosition();
        return Math.hypot(p.x - x!, p.z - z!) < 1.5;
      }, interior, { timeout: 15000 });
      const onGarden = await driver.callDebug('getPlayerPosition') as any;
      assert(onGarden.y > after.y - 1, `${ramp.id}: dropped into a trench beyond the crest`);
      evidence[`${ramp.id}:interior`] = await driver.snapshot();
      await driver.screenshot(out, `${ramp.id}-interior`);
    }
    for (const link of args.includes('--gardens-only') ? [] : FAIRY_AGILITY_LINKS) {
      const id = link.obstacle.id, foot = link.obstacle.position, top = link.obstacle.exitPosition;
      await driver.callDebug('setSkillLevel', ['agility', 99]);
      await driver.callDebug('inspectPose', [{ x: foot[0], z: foot[1], yaw: Math.atan2(foot[0] - top[0], foot[1] - top[1]), pitch: .3, distance: 9, detached: false }]);
      await driver.callDebug('waitForView');
      const before = await driver.callDebug('getPlayerPosition') as any;
      evidence[`${id}:before`] = await driver.snapshot();
      evidence[`${id}:interaction`] = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'climb' }]);
      await page.waitForFunction(([x, z]) => {
        const p = (window.__gameDebug as any).getPlayerPosition();
        return Math.hypot(p.x - x!, p.z - z!) < 2;
      }, top, { timeout: 15000 });
      const after = await driver.callDebug('getPlayerPosition') as any;
      assert(after.y - before.y > 4.5, `${id}: missing rise`);
      evidence[`${id}:after`] = await driver.snapshot();
      await page.waitForTimeout(600);
      await driver.screenshot(out, `${id}-top`);
    }
  }
  if (args.includes('--npcs-only') || args.includes('--all-checks')) {
    for (const [id, x, z, yaw] of [
      ['npc_fey_lantern_keeper', 2083, -103, -Math.PI / 2],
      ['npc_fey_moss_tender', 2083, -94.2, .7],
      ['npc_fey_path_warden', 2299, 143, 0],
      ['npc_fey_jewel_keeper', 2301, 136, -Math.PI / 2],
    ] as const) {
      await driver.callDebug('inspectPose', [{ x, y: 0, z, yaw, pitch: .3, distance: 7, detached: false }]);
      await driver.callDebug('waitForView');
      const bounds = await driver.callDebug('getDrawnBounds', [id]) as any;
      evidence[`${id}:bounds`] = bounds;
      assert(bounds && bounds.height < 1.1 && bounds.width < 1.2, `${id}: small world-space native rig ${JSON.stringify(bounds)}`);
      evidence[`${id}:before`] = { state: await driver.snapshot(), bounds };
      evidence[`${id}:talk`] = await driver.callDebug('callTool', ['corealm_interact', { entityId: id, interaction: 'talk' }]);
      await page.getByRole('dialog', { name: /Conversation|Dialogue/ }).waitFor({ timeout: 20_000 });
      evidence[`${id}:after`] = { state: await driver.snapshot(), dialogue: await page.locator('.dialogue').textContent() };
      await driver.screenshot(out, `${id}-talk`);
      await page.keyboard.press('Escape');
    }
  }
  if (args.includes('--release')) {
    evidence.shippedWorld = shippedResponses;
    assert(shippedResponses.some(response => response.path.endsWith('/manifest.json') && response.status === 200));
    assert(shippedResponses.filter(response => response.path.endsWith('.world') && response.status === 200).length >= 3);
    assert(shippedResponses.some(response => response.path.endsWith('/corealm-navmesh.bin') && response.status === 200));
    assert(shippedResponses.every(response => response.status === 200), 'Released world artifacts failed to load');
  }
  assert.deepEqual(await driver.callDebug('getErrors'), []);
  assert.deepEqual(driver.pageErrors, []);
  assert.deepEqual(driver.consoleErrors, []);
  console.log(JSON.stringify({ passed: Object.keys(evidence), guardians: guardians.length }));
} catch (error) {
  evidence.failure = String(error);
  evidence.failureState = await driver.snapshot();
  evidence.detours = await driver.callDebug('getMovementDetourDiagnostics').catch(() => null);
  evidence.console = driver.consoleErrors; evidence.pageErrors = driver.pageErrors;
  evidence.body = await driver.page?.locator('body').innerText();
  await driver.screenshot(out, 'failure').catch(() => {});
  console.log(JSON.stringify({ failure: evidence.failure, errors: evidence.console, pageErrors: evidence.pageErrors, body: evidence.body }));
  throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(evidence, null, 2));
  await driver.close();
}
