/** Natural directional recoil evidence. Root owns the hardware browser slot.
 * npx tsx tools/creature-motion/rhino-directional-proof.ts --url http://127.0.0.1:4175 --out test-results/rhino-directional
 * --only=boss_rhino_earth,boss_rhino_water (default). No forced pose, health, damage or time.
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { argValue, repoRoot } from '../lib/paths.js';
import { installTestDeadline } from '../lib/deadline.js';
import { enemyStandoffMetres, meleeReachMetres } from '../../game/src/systems/combat.js';
import { recordCandidateResponses } from './record-candidate-responses.js';

const args = process.argv.slice(2), url = argValue(args, '--url');
if (!url) throw new Error('--url must name an existing production server');
const presets: Record<string, string> = { boss_rhino_air: 'tempest_roc', boss_rhino_earth: 'rootheart', boss_rhino_water: 'gravelmaw:ordrun' };
const selected = (argValue(args, '--only') ?? args.find(value => value.startsWith('--only='))?.slice(7) ?? 'boss_rhino_earth,boss_rhino_water').split(',');
if (selected.some(id => !presets[id])) throw new Error('Unknown --only rhino');
const out = path.resolve(repoRoot, argValue(args, '--out') ?? 'test-results/rhino-directional');
await mkdir(out, { recursive: true });
const report: any = { status: 'incomplete', visualAccepted: false, trials: [], errors: [], limits: [
  'Each setup uses normal lab spawn; player placement is actual production navigation. No entity pose, AI, health, damage or clock override.',
  'Territorial rhinos stay unprovoked during side positioning. A miss provokes too, so a missed opening swing can remove the side opportunity.',
  'Two attempts per side are allowed; absent actual clips remain coverage failures.',
  'Screenshots and video require visual review for planted feet and readable recoil; timestamps alone are not acceptance.',
  'Since the running-hit overlay (SLICE-03), a recoil is the masked additive overlay clip `<Hit|HitLeft|HitRight>_MaskedOverlay` over the unchanged base gait; the base motion never becomes "hit".' ] };
report.budgets = { hardMs: 120_000, closePageMs: 110_000, navigationPerAttemptMs: 5_000,
  contactPerAttemptMs: 3_000, recoveryPerAttemptMs: 800, maximumAttemptsPerSide: 2 };
const clearDeadline = installTestDeadline('rhino directional production proof', 120_000);
const browser = await chromium.launch({ headless: !args.includes('--headed'), args: process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  recordVideo: { dir: path.join(out, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(); page.setDefaultTimeout(4_000);
const finishResponseAudit = await recordCandidateResponses(page, path.join(repoRoot, 'art/rebuild/candidates/finish-motion/rhino-attack/catalog.json'), selected);
// tsx may emit this name-preservation helper inside serialized browser callbacks.
await page.addInitScript('globalThis.__name = (value) => value;');
page.on('pageerror', error => report.errors.push(error.message));
const timer = setTimeout(() => { report.errors.push('110 second evidence ceiling'); void page.close(); }, 110_000);
async function call(surface: 'lab' | 'debug', method: string, values: unknown[] = []): Promise<any> {
  return page.evaluate(async ({ surface, method, values }) => {
    const api = (window as any)[surface === 'lab' ? '__featureLab' : '__gameDebug'];
    if (typeof api?.[method] !== 'function') throw new Error(`Missing ${surface}.${method}`);
    const result = await api[method](...values);
    if (result?.ok === false || result?.isError === true || typeof result?.error === 'string') throw new Error(JSON.stringify(result));
    return result;
  }, { surface, method, values });
}
async function snap(entityId: string): Promise<any> {
  return page.evaluate(entityId => {
    const d = (window as any).__gameDebug, motion = d.getEntityMotion(entityId), player = d.getPlayer();
    const lateral = (player.position.x - motion.semanticPosition[0]) * Math.cos(motion.semanticRotationY)
      - (player.position.z - motion.semanticPosition[2]) * Math.sin(motion.semanticRotationY);
    return { wallMs: performance.now(), simMs: d.getState().clock.elapsedMs, entity: d.getEntity(entityId), motion, player, lateral,
      inferredImpactSide: Math.abs(lateral) < .1 ? 'front' : lateral < 0 ? 'left' : 'right' };
  }, entityId);
}
async function capture(name: string, entityId: string): Promise<any> {
  const before = await snap(entityId);
  const drawnBounds = await call('debug', 'getDrawnBounds', [entityId]);
  await page.screenshot({ path: path.join(out, `${name}.png`), timeout: 4_000 });
  return { file: `${name}.png`, before, drawnBounds, after: await snap(entityId) };
}
try {
  report.installed = await installAssetCandidates(page, path.join(repoRoot, 'art/rebuild/candidates/finish-motion/rhino-attack/catalog.json'));
  const target = new URL(url); target.searchParams.set('mode', 'combat'); target.searchParams.set('rhinoTiming', '1'); target.searchParams.delete('motion');
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__featureLab?.getState()?.ready, undefined, { timeout: 20_000 });
  report.hardware = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    if (!gl) throw new Error('No production WebGL2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'), renderer = String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) throw new Error(`Hardware required: ${renderer}`);
    return { renderer, noSwiftShader: true };
  });
  await call('lab', 'setWalkingEnabled', [true]);
  await call('lab', 'setLevel', ['melee', 50]);
  await call('lab', 'equipPlayer', ['mainHand', null]);
  await call('lab', 'setPlayerVisible', [true]);
  for (const id of selected) for (const side of ['front', 'left', 'right'] as const) {
    const expected = side === 'front' ? 'Hit' : side === 'left' ? 'HitLeft' : 'HitRight';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const trial: any = { id, side, expected, attempt, screenshots: [], samples: [], status: 'incomplete' };
      report.trials.push(trial);
      try {
        await call('lab', 'spawnTarget', ['creature', presets[id], { distance: 4 }]);
        const state = await call('lab', 'getState'), entityId = state.target.entityId;
        const initial = await snap(entityId); trial.setup = initial;
        const [x, y, z] = initial.entity.position, heading = initial.motion.semanticRotationY;
        const bodyRadius = initial.entity.combat?.bodyRadius;
        if (!Number.isFinite(bodyRadius) || bodyRadius <= 0) throw new Error('Rhino lacks measured production bodyRadius');
        const standoff = enemyStandoffMetres(bodyRadius);
        trial.spacing = { bodyRadius, standoff, meleeReach: meleeReachMetres(bodyRadius) };
        // Ordinary production navigation, in legs. The nav route ignores creature bodies, so a
        // straight walk to the far flank is blocked by the rhino itself; a side approach first
        // swings out to a wide point on the player's own side, then closes on the flank at the
        // production standoff. The impact side is decided by the lateral sign alone.
        const pointAt = (bearing: number, radius: number) => {
          const lateral = Math.sin(bearing) * radius, forward = Math.cos(bearing) * radius;
          return [x + lateral * Math.cos(heading) + forward * Math.sin(heading), y, z - lateral * Math.sin(heading) + forward * Math.cos(heading)];
        };
        const sign = side === 'left' ? -1 : 1;
        const legs = side === 'front' ? [pointAt(0, standoff)] : [pointAt(sign * 0.95, standoff * 1.6), pointAt(sign * (Math.PI / 2), standoff)];
        trial.navigation = { legs: [] as any[] };
        for (const intended of legs) {
          const snapped = await call('debug', 'getNavPoint', [intended]);
          if (!snapped || Math.hypot(snapped.x - intended[0]!, snapped.z - intended[2]!) > .35) throw new Error('Approach point is off the navmesh');
          const destination = [snapped.x, snapped.y, snapped.z];
          const from = await snap(entityId);
          const route = await call('debug', 'getNavPath', [[from.player.position.x, from.player.position.y, from.player.position.z], destination]);
          if (!Array.isArray(route) || route.length < 2) throw new Error('No production navigation route to the approach point');
          const leg: any = { intended, destination, route };
          trial.navigation.legs.push(leg);
          const cursor = (await call('debug', 'getEvents', [0])).nextSeq;
          await call('debug', 'callTool', ['corealm_move_to', { position: destination }]);
          const arrival = performance.now() + 5_000; let arrived = false;
          while (performance.now() < arrival) {
            const sample = await snap(entityId); trial.samples.push({ ...sample, stage: 'navigation' });
            const events = await call('debug', 'getEvents', [cursor]);
            const failed = events.events.find((event: any) => event.type === 'navigation.failed');
            if (failed) throw new Error(`Side navigation failed: ${JSON.stringify(failed.data ?? failed)}`);
            if (events.events.some((event: any) => event.type === 'navigation.completed')) { arrived = true; break; }
            await page.waitForTimeout(50);
          }
          const at = await snap(entityId);
          leg.arrived = arrived; leg.gapMetres = Math.hypot(at.player.position.x - destination[0]!, at.player.position.z - destination[2]!);
          if (!arrived || leg.gapMetres >= .6) throw new Error(`Side navigation did not arrive (${leg.gapMetres.toFixed(2)} m short)`);
        }
        trial.positioned = await snap(entityId);
        await call('debug', 'inspectPose', [{ x, y: y + .7, z, yaw: heading + 1.1, pitch: .2, distance: 5, detached: true }]);
        trial.screenshots.push(await capture(`${id}-${side}-${attempt}-before`, entityId));
        const healthBefore = trial.positioned.entity.combat.health;
        await call('debug', 'callTool', ['corealm_attack', { entityId }]);
        const untilHit = performance.now() + 3_000; let recorded = false;
        while (performance.now() < untilHit) {
          const sample = await snap(entityId); trial.samples.push({ ...sample, stage: 'attack' });
          if (sample.motion.hitOverlay && sample.entity.combat.health < healthBefore) {
            trial.hit = sample; recorded = true;
            trial.screenshots.push(await capture(`${id}-${side}-${attempt}-during`, entityId));
            break;
          }
          await page.waitForTimeout(16);
        }
        await call('debug', 'callTool', ['corealm_stop', {}]);
        const recover = performance.now() + 800;
        while (performance.now() < recover) { trial.samples.push({ ...await snap(entityId), stage: 'recovery' }); await page.waitForTimeout(40); }
        trial.screenshots.push(await capture(`${id}-${side}-${attempt}-recovery`, entityId));
        trial.observedOverlay = recorded ? trial.hit.motion.hitOverlay : null;
        trial.status = recorded && trial.hit.motion.hitOverlay.clip === `${expected}_MaskedOverlay` && trial.hit.motion.hitOverlay.maskStatus === 'native-masked'
          ? 'natural-clip-observed-awaiting-visual-review' : 'coverage-incomplete';
      } catch (error) { trial.status = 'failed'; trial.error = String(error); }
      await writeFile(path.join(out, `${id}-${side}-${attempt}.json`), JSON.stringify(trial, null, 2));
      console.log(`${id}/${side}/${attempt}: ${trial.status}`);
      if (trial.status === 'natural-clip-observed-awaiting-visual-review') break;
    }
  }
  report.coverage = selected.map(id => ({ id, clips: ['Hit', 'HitLeft', 'HitRight'].map(clip => ({ clip,
    observed: report.trials.some((trial: any) => trial.id === id && trial.hit?.motion?.hitOverlay?.clip === `${clip}_MaskedOverlay`) })) }));
  report.status = report.coverage.every((row: any) => row.clips.every((clip: any) => clip.observed)) && !report.errors.length
    ? 'natural-clips-observed-awaiting-visual-review' : 'incomplete';
} catch (error) { report.errors.push(String(error)); }
finally {
  clearTimeout(timer);
  report.servedByteEvidence = await finishResponseAudit();
  if (!report.servedByteEvidence.passed) { report.errors.push(...report.servedByteEvidence.errors); report.status = 'incomplete'; }
  await context.close(); await browser.close();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); clearDeadline();
}
if (report.status === 'incomplete') process.exitCode = 1;
