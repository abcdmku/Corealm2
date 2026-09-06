/** CPU preflight / hardware production contact shard, at most two promoted actors.
 * npx tsx tools/creature-motion/attack-contact-proof.ts --only=animal_bear,animal_coyote --validate-only
 * npx tsx tools/creature-motion/attack-contact-proof.ts --url http://127.0.0.1:4175 --only=animal_bear,animal_coyote --out test-results/attack-heavy
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { GROUND_MOTION_ACTORS, LEGACY_GROUND_MOTION_ACTORS } from '../../game/src/featureLab/groundMotion.js';
import { CREATURE_MOTION_TIMING } from '../../game/src/content/creatureMotionTiming.js';
import { recordCandidateResponses } from './record-candidate-responses.js';
import { installTestDeadline } from '../lib/deadline.js';
import { argValue, repoRoot } from '../lib/paths.js';

const args = process.argv.slice(2), url = argValue(args, '--url');
const selected = (argValue(args, '--only') ?? args.find(value => value.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);
const roster = [...LEGACY_GROUND_MOTION_ACTORS, ...GROUND_MOTION_ACTORS];
if (!selected.length || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(id => !roster.some(actor => actor.assetId === id))) {
  throw new Error('--only requires one or two distinct promoted legacy/ground asset IDs');
}
const out = path.resolve(repoRoot, argValue(args, '--out') ?? `test-results/attack-contact-${selected.join('-')}`);
const manifestFile = path.join(repoRoot, 'game/public/assets/manifest.json');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const assets = selected.map(id => manifest.assets.find((asset: any) => asset.id === id));
for (const asset of assets) {
  if (!asset || !CREATURE_MOTION_TIMING[asset.id]) throw new Error('Manifest or timing row missing');
  const bytes = await readFile(path.join(repoRoot, 'game/public/assets', asset.file));
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256.toLowerCase() || bytes.length !== asset.bytes) throw new Error(`Public bytes do not match manifest: ${asset.id}`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  if (!gltf.animations.some((clip: any) => clip.name === 'Attack')) throw new Error(`Missing production Attack: ${asset.id}`);
}
if (args.includes('--validate-only')) { console.log(JSON.stringify({ status: 'public-byte-preflight-passed', selected, gpuStarted: false })); process.exit(0); }
if (!url) throw new Error('--url must name an existing production lab server');
await mkdir(out, { recursive: true });
// Immutable expected bytes for this session, independent of later manifest edits by integration.
const bindingFile = path.join(out, 'public-binding.json');
await writeFile(bindingFile, JSON.stringify({ assets }, null, 2));
const report: any = { status: 'incomplete', publicAssets: selected, visualAccepted: false, actors: [], errors: [],
  budgets: { hardMs: 120_000, closePageMs: 110_000, provokeMs: 8_000, observeMs: 18_000 },
  limits: ['Only ordinary lab setup, player attack/stop and live AI are used; no pose, damage, health, AI or time overrides.',
    'Health-change frames bracket observed impact, not exact private scheduled combat timestamps. Public events do not expose the private damage-source hit log. Misses do not lower health.',
    'An Attack marker or visible animation is not physical target-contact acceptance. Inspect the actual target relation and planted support in video.',
    'This shard does not establish directional recoil, death or live/sampled residency continuity.'] };
const clearDeadline = installTestDeadline('production attack contact shard', 120_000);
const browser = await chromium.launch({ headless: !args.includes('--headed'), args: process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: path.join(out, 'video'), size: { width: 1440, height: 900 } } });
const page = await context.newPage();
await page.addInitScript('globalThis.__name = (value) => value;');
const finishResponses = await recordCandidateResponses(page, bindingFile, selected);
page.setDefaultTimeout(4_000); page.on('pageerror', error => report.errors.push(error.message));
const timer = setTimeout(() => { report.errors.push('110 second ceiling exhausted'); void page.close(); }, 110_000);
async function call(surface: 'lab' | 'debug', method: string, values: unknown[] = []): Promise<any> {
  return page.evaluate(async ({ surface, method, values }) => {
    const api = (window as any)[surface === 'lab' ? '__featureLab' : '__gameDebug'];
    if (typeof api?.[method] !== 'function') throw new Error(`Missing ${surface}.${method}`);
    const result = await api[method](...values);
    if (result?.ok === false || result?.isError === true || typeof result?.error === 'string') throw new Error(JSON.stringify(result));
    return result;
  }, { surface, method, values });
}
async function frame(entityId: string): Promise<any> {
  return page.evaluate(entityId => {
    const d = (window as any).__gameDebug, state = (window as any).__featureLab.getState();
    return { wallMs: performance.now(), simMs: d.getState().clock.elapsedMs, player: d.getPlayer(), entity: d.getEntity(entityId),
      motion: d.getEntityMotion(entityId), bounds: d.getDrawnBounds(entityId), ai: state.target?.ai ?? null };
  }, entityId);
}
try {
  const target = new URL(url); target.searchParams.set('mode', 'combat'); target.searchParams.delete('motion'); target.searchParams.delete('rhinoTiming');
  await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__featureLab?.getState()?.ready, undefined, { timeout: 20_000 });
  report.hardware = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2'); if (!gl) throw new Error('No production WebGL2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'), renderer = String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
    if (/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer)) throw new Error(`Hardware required: ${renderer}`);
    return { renderer, noSwiftShader: true };
  });
  await call('lab', 'setLevel', ['melee', 1]);
  const catalog = await call('lab', 'getCatalog');
  for (const row of catalog.equipment) await call('lab', 'equipPlayer', [row.slot, null]);
  await call('lab', 'setPlayerVisible', [true]);
  for (const id of selected) {
    const actor = roster.find(actor => actor.assetId === id)!;
    const evidence: any = { id, presetId: actor.presetId, timing: CREATURE_MOTION_TIMING[id], screenshots: [], visualAccepted: false };
    report.actors.push(evidence);
    try {
      await call('lab', 'spawnTarget', ['creature', actor.presetId, { distance: 4 }]);
      const entityId = (await call('lab', 'getState')).target.entityId;
      evidence.before = await frame(entityId);
      if (evidence.before.entity.view.assetId !== id) throw new Error('Preset asset changed');
      const cursor = (await call('debug', 'getEvents', [0])).nextSeq;
      await call('lab', 'perform', ['attack']);
      const provokeUntil = performance.now() + 8_000;
      while (performance.now() < provokeUntil) {
        const f = await frame(entityId);
        if (f.ai?.state === 'aggro') break;
        if (f.entity.state === 'dead') throw new Error('Actor died during natural provocation; no contact proof');
        await page.waitForTimeout(40);
      }
      await call('debug', 'callTool', ['corealm_stop', {}]);
      const pose = await frame(entityId), [x, y, z] = pose.entity.position, p = pose.player.position;
      const heading = Math.atan2(p.x - x, p.z - z);
      await call('debug', 'inspectPose', [{ x: (x + p.x) / 2, y: y + .55, z: (z + p.z) / 2,
        yaw: heading + Math.PI / 2, pitch: .18, distance: Math.max(4, (pose.bounds?.width ?? 1) * 2.3), detached: true }]);
      await page.evaluate(entityId => {
        const w = window as any, d = w.__gameDebug, trace = w.__attackContactTrace = { running: true, samples: [] as any[], ordinal: 0, previous: null as any };
        function observe() {
          if (!trace.running) return;
          const motion = d.getEntityMotion(entityId), prior = trace.previous;
          if (motion?.motion === 'attack' && (prior?.motion?.motion !== 'attack' || motion.time < prior.motion.time - .05)) trace.ordinal++;
          const sample = { wallMs: performance.now(), simMs: d.getState().clock.elapsedMs, ordinal: trace.ordinal,
            motion, player: d.getPlayer(), entity: structuredClone(d.getEntity(entityId)) };
          trace.samples.push(sample); trace.previous = sample; requestAnimationFrame(observe);
        }
        requestAnimationFrame(observe);
      }, entityId);
      const captures = new Set<string>(), until = performance.now() + 18_000; let lastHealth = pose.player.health;
      while (performance.now() < until) {
        const f = await page.evaluate(() => (window as any).__attackContactTrace.samples.at(-1));
        if (f) {
          let name: string | null = null;
          if (f.player.health < lastHealth && !captures.has('health-contact')) name = 'health-contact';
          else if (f.motion?.motion === 'attack') {
            const phase = f.motion.time / f.motion.duration;
            if (phase < evidence.timing.contactNormalized && !captures.has('before')) name = 'before';
            else if (phase > evidence.timing.contactNormalized + .12 && !captures.has('recovery')) name = 'recovery';
          }
          lastHealth = f.player.health;
          if (name) {
            captures.add(name); const file = `${id}-${name}.png`, before = await frame(entityId);
            await page.screenshot({ path: path.join(out, file), timeout: 4_000 });
            evidence.screenshots.push({ file, observed: f, before, after: await frame(entityId) });
          }
          if (f.player.dead) break;
        }
        await page.waitForTimeout(20);
      }
      evidence.samples = await page.evaluate(() => { const trace = (window as any).__attackContactTrace; trace.running = false; return trace.samples; });
      evidence.after = await frame(entityId); evidence.events = await call('debug', 'getEvents', [cursor]);
      evidence.impacts = []; evidence.unattributedHealthDeltas = [];
      for (let i = 1; i < evidence.samples.length; i++) {
        const a = evidence.samples[i - 1], b = evidence.samples[i];
        if (!(b.player.health < a.player.health)) continue;
        const livingTarget = [a, b].every(sample => sample.entity?.id === entityId
          && sample.entity.state !== 'dead' && sample.entity.combat?.health > 0);
        const attackBracket = [a, b].every(sample => sample.motion?.entityId === entityId
          && sample.motion.motion === 'attack' && sample.motion.clip === 'Attack'
          && Number.isFinite(sample.motion.time) && sample.motion.time >= 0
          && Number.isFinite(sample.motion.duration) && sample.motion.duration > 0
          && sample.motion.time <= sample.motion.duration);
        const sameObservedAttack = a.ordinal > 0 && b.ordinal === a.ordinal && b.motion?.time >= a.motion?.time;
        const delta = { damage: a.player.health - b.player.health, ordinal: b.ordinal, before: a, after: b,
          phaseBracket: [a.motion?.time / a.motion?.duration, b.motion?.time / b.motion?.duration],
          livingTarget, attackBracket, sameObservedAttack };
        if (livingTarget && attackBracket && sameObservedAttack) evidence.impacts.push(delta);
        else evidence.unattributedHealthDeltas.push(delta);
      }
      evidence.status = evidence.impacts.length ? 'impact-observed-awaiting-visual-review' : 'coverage-incomplete-no-attack-impact';
    } catch (error) { evidence.status = 'failed'; evidence.error = String(error); }
    await writeFile(path.join(out, `${id}.json`), JSON.stringify(evidence, null, 2)); console.log(`${id}: ${evidence.status}`);
  }
} catch (error) { report.errors.push(String(error)); }
finally {
  clearTimeout(timer); report.servedByteEvidence = await finishResponses();
  report.status = report.actors.length === selected.length && report.actors.every((actor: any) => actor.status === 'impact-observed-awaiting-visual-review')
    && report.servedByteEvidence.passed && !report.errors.length ? 'impact-observed-awaiting-visual-review' : 'incomplete';
  await context.close(); await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); clearDeadline();
}
if (report.status === 'incomplete') process.exitCode = 1;
