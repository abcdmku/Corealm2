/** Root-scheduled hardware browser proof. Public bytes only; no actor, health, pose or clock overrides.
 * npx tsx tools/creature-motion/combat-residency-proof.ts --url http://127.0.0.1:4175 --only=animal_coyote
 * --stage all|residency|combat; --validate-only never launches Chromium. At most two actors, 120 seconds.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { argValue, repoRoot } from '../lib/paths.js';
import { installTestDeadline } from '../lib/deadline.js';
import { installAssetCandidates } from '../lib/assetCandidates.js';
import { recordCandidateResponses } from './record-candidate-responses.js';
import { enemyStandoffMetres } from '../../game/src/systems/combat.js';

const args = process.argv.slice(2);
const option = (key: string) => argValue(args, key) ?? args.find(a => a.startsWith(`${key}=`))?.slice(key.length + 1);
const selected = (option('--only') ?? 'animal_coyote').split(',');
const roster = ['animal_coyote','animal_bear','animal_cattle','animal_aurochs','animal_goat','animal_ibex','animal_deer','animal_boar','animal_hog','animal_rat','animal_rabbit','animal_rabbit_dark'];
if (!selected.length || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(id => !roster.includes(id))) throw new Error('Select one or two distinct legacy mammals');
const stage = option('--stage') ?? 'all';
if (!['all','residency','combat'].includes(stage)) throw new Error('Unknown stage');
const url = option('--url'), validateOnly = args.includes('--validate-only');
if (!url && !validateOnly) throw new Error('--url must name the existing lab server');
const output = path.resolve(repoRoot, option('--out') ?? `test-results/combat-residency-${selected.join('-')}`);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
await mkdir(output, { recursive: true });
const manifestBytes = await readFile(path.join(repoRoot, 'game/public/assets/manifest.json'));
const manifest = JSON.parse(manifestBytes.toString());
const catalog: any = { assets: [], files: {} };
for (const id of selected) {
  const entry = manifest.assets.find((a: any) => a.id === id);
  if (!entry) throw new Error(`Missing public asset ${id}`);
  const bytes = await readFile(path.join(repoRoot, 'game/public/assets', entry.file));
  if (sha(bytes) !== entry.sha256.toLowerCase() || bytes.length !== entry.bytes) throw new Error(`Stale public manifest ${id}`);
  const frozen = path.join(output, `${id}-served.glb`);
  await writeFile(frozen, bytes);
  catalog.assets.push(entry); catalog.files[id] = frozen;
}
const catalogFile = path.join(output, 'served-catalog.json');
await writeFile(catalogFile, JSON.stringify(catalog, null, 2));
if (validateOnly) { console.log(JSON.stringify({ status: 'preflight-passed', selected, stage, catalogFile, gpuStarted: false })); process.exit(0); }
const clearDeadline = installTestDeadline('combat residency proof', 120_000);
const started = performance.now();
const report: any = { status: 'incomplete', selected, stage, publicManifestSha256: sha(manifestBytes), visualAccepted: false,
  limits: ['Only an exact observed HitLeft/HitRight masked overlay counts as directional; generic Hit is fallback evidence only. Since SLICE-03 the recoil is an additive overlay over the unchanged base gait, so the base motion never reads "hit".', 'Corpse dwell is 350 ms before fade; a missed capture is a failure.', 'Screenshots require human review. No world acceptance is claimed.'], commands: [], assets: [], errors: [] };
const browser = await chromium.launch({ headless: !args.includes('--headed'), args: process.platform === 'win32' ? ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio'] : ['--enable-gpu','--ignore-gpu-blocklist','--mute-audio'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: path.join(output, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(); page.setDefaultTimeout(3000);
await installAssetCandidates(page, catalogFile);
const finishResponses = await recordCandidateResponses(page, catalogFile, selected);
page.on('pageerror', e => report.errors.push(e.message));
const timer = setTimeout(() => { report.errors.push('110 second evidence budget exhausted'); void page.close(); }, 110_000);
async function call(surface: 'lab'|'debug', method: string, values: any[] = []): Promise<any> {
  const result = await page.evaluate(async ({surface,method,values}) => {
    const api = (window as any)[surface === 'lab' ? '__featureLab' : '__gameDebug'];
    if (typeof api?.[method] !== 'function') throw new Error(`Missing ${surface}.${method}`);
    return await api[method](...values);
  }, {surface,method,values});
  if (method === 'callTool' || surface === 'lab' || method === 'inspectPose') report.commands.push({ elapsedMs: performance.now()-started, surface, method, values, result });
  if (result?.ok === false || result?.isError || typeof result?.error === 'string') throw new Error(JSON.stringify(result));
  return result;
}
async function sample(row: any, label: string): Promise<any> {
  const result = await page.evaluate(({id,label}) => { const d = (window as any).__gameDebug; return { atMs: performance.now(), label,
    entity: d.getEntity(id), motion: d.getEntityMotion(id), bounds: d.getDrawnBounds(id), state: (window as any).__featureLab.getState() }; }, {id:row.entityId,label});
  row.samples.push(result); return result;
}
async function camera(row: any, far = false) {
  const s = await sample(row, far ? 'camera-far-before' : 'camera-near-before'), b = s.bounds;
  if (!b) throw new Error('Missing drawn bounds');
  await call('debug','inspectPose',[{x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2,yaw:1.2,pitch:.3,distance:far ? 95 : Math.max(3,(b.max.x-b.min.x)*2,(b.max.y-b.min.y)*2.5),detached:true}]);
  return s;
}
async function poll(row: any, label: string, ms: number, predicate: (s:any)=>boolean) {
  const until = performance.now()+ms;
  do { const s = await sample(row,label); if (predicate(s)) return s; await page.waitForTimeout(40); } while(performance.now()<until);
  throw new Error(`${label} not observed within ${ms} ms`);
}
async function capture(row: any, label: string, predicate: (s:any)=>boolean) {
  const before = await sample(row, `${label}-screen-before`), file = path.join(output,`${row.id}-${label}.png`);
  const valid = (s:any) => s.entity?.view?.assetId === row.id && s.bounds?.meshes > 0 && predicate(s);
  if (!valid(before)) throw new Error(`Capture precondition failed: ${label}`);
  await page.screenshot({path:file});
  const after = await sample(row, `${label}-screen-after`);
  const evidence = {file,before,after,accepted:valid(after)}; row.frames.push(evidence);
  if (!evidence.accepted) throw new Error(`Capture changed during screenshot: ${label}`);
}
async function residency(row: any) {
  row.residency = [];
  for (const [index,far] of [false,true,false].entries()) {
    let previous = await camera(row,far); const expected = far ? 'sampled-rig' : 'live-rig';
    let crossing:any = null;
    const before = await poll(row,expected,3500,s=> {
      if(s.motion?.path===expected && s.entity?.combat?.health>0) {
        if(index>0) {
          const a=previous.motion,b=s.motion,dt=(s.atMs-previous.atMs)/1000;
          const comparable=a?.clip===b?.clip && Number.isFinite(a?.duration) && a.duration>0 && a.duration===b.duration
            && Number.isFinite(a.time) && Number.isFinite(b.time) && a.time>=0 && a.time<=a.duration && b.time>=0 && b.time<=b.duration
            && Number.isFinite(a.timeScale) && a.timeScale>0 && a.timeScale===b.timeScale && previous.motion.path!==expected;
          const expectedTime=comparable ? (a.time+dt*a.timeScale)%a.duration : null;
          const error=expectedTime!==null ? Math.min(Math.abs(b.time-expectedTime),a.duration-Math.abs(b.time-expectedTime)) : null;
          crossing={before:previous,after:s,expectedTime,phaseErrorSeconds:error,toleranceSeconds:.06,
            status:comparable && dt>=0 && dt<=.25 && error!==null && error>=0 && error<=.06 ? 'preserved' : 'inconclusive-or-discontinuous'};
        }
        return true;
      }
      previous=s;return false;
    });
    const after = await poll(row,`${expected}-clock`,1800,s=>s.motion?.path===expected && s.motion.clip===before.motion.clip && Math.abs(s.motion.time-before.motion.time)>.02);
    row.residency.push({expected,before,after,crossing});
    if(index>0 && crossing?.status!=='preserved') throw new Error('Residency boundary phase preservation was not established');
  }
  await capture(row,'residency-return',s=>s.motion?.path==='live-rig' && s.entity?.combat?.health>0);
}
async function preposition(row: any) {
  await call('debug','callTool',['corealm_stop',{}]);
  const s=await sample(row,'setup'), p=s.state.playerPosition, e=s.entity.position;
  const radius=enemyStandoffMetres(s.entity.combat.bodyRadius ?? 0), yaw=s.motion.semanticRotationY;
  const point=[e[0]+Math.cos(yaw)*radius,p[1],e[2]-Math.sin(yaw)*radius];
  const nav=await call('debug','getNavPoint',[point]);
  if (!nav || Math.hypot(nav.x-point[0],nav.z-point[2])>.1008) throw new Error('Side standoff is not on navigable ground');
  const destination=[nav.x,nav.y,nav.z], route=await call('debug','getNavPath',[p,destination]);
  if (!Array.isArray(route) || route.length<2) throw new Error('No normal navigation route to side standoff');
  const cursor=(await call('debug','getEvents',[0])).nextSeq;
  row.setup={point,destination,route,cursor,budgetMs:20000};
  await call('debug','callTool',['corealm_move_to',{position:destination}]);
  const until=performance.now()+20000;
  while(performance.now()<until) {
    const current=await sample(row,'setup-travel'), events=await call('debug','getEvents',[cursor]); row.setup.events=events;
    const begin=events.events.find((e:any)=>e.type==='navigation.started');
    if (begin && events.events.some((e:any)=>e.type==='navigation.completed' && e.seq>begin.seq) && current.state.movement.mode==='idle') {row.setup.after=current;return;}
    if (events.events.some((e:any)=>e.type==='navigation.failed')) throw new Error('Setup navigation failed');
    await page.waitForTimeout(100);
  }
  throw new Error('Normal setup navigation exceeded 20 seconds');
}
async function combat(row: any) {
  await call('lab','setLevel',['melee',1]); await call('lab','equipPlayer',['mainHand',null]);
  await preposition(row); await camera(row);
  const cursor=(await call('debug','getEvents',[0])).nextSeq;
  await call('debug','callTool',['corealm_attack',{entityId:row.entityId}]);
  try {
    const directional=(s:any)=>['HitLeft_MaskedOverlay','HitRight_MaskedOverlay'].includes(s.motion?.hitOverlay?.clip) && s.motion.hitOverlay.maskStatus==='native-masked';
    row.directional=await poll(row,'directional-hit',10000,directional);
    row.directionalCoverage={observedClip:row.directional.motion.hitOverlay.clip,baseMotion:row.directional.motion.clip,bones:row.directional.motion.hitOverlay.bones,scope:'One naturally observed authored side; not full left/front/right coverage'};
    await capture(row,'directional-hit',s=>directional(s) && s.motion.hitOverlay.weight>0 && s.entity?.combat?.health>0);
  } catch(e) { row.errors.push(String(e)); }
  await call('lab','setLevel',['melee',99]); await call('lab','equipPlayer',['mainHand','worn_sword']);
  await call('debug','callTool',['corealm_stop',{}]);
  const alive=await sample(row,'kill-before');
  if (!(alive.entity?.combat?.health>0)) throw new Error('Target died before the recorded death stage');
  await call('debug','callTool',['corealm_attack',{entityId:row.entityId}]);
  row.death=await poll(row,'death',16000,s=>s.motion?.clip==='Death' && !(s.entity?.combat?.health>0));
  await capture(row,'death',s=>s.motion?.clip==='Death' && s.motion.time<s.motion.duration && s.bounds.fade===0);
  row.settled=await poll(row,'settled-corpse',5000,s=>s.motion?.clip==='Death' && s.motion.duration>0 && s.motion.time>=s.motion.duration-.001 && s.bounds?.fade===0);
  await capture(row,'settled-corpse',s=>s.motion?.clip==='Death' && s.motion.time>=s.motion.duration-.001 && s.bounds.fade===0);
  row.events=await call('debug','getEvents',[cursor]);
}
try {
  const target=new URL(url!);target.searchParams.set('mode','combat');target.searchParams.set('motion','legacy');target.searchParams.set('motionActors',selected.join(','));
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:20000});
  await page.waitForFunction(()=>(window as any).__featureLab?.getState()?.ready,undefined,{timeout:20000});
  report.hardware=await page.evaluate(()=>{const gl=document.querySelector('canvas')?.getContext('webgl2');if(!gl)throw new Error('No WebGL2');const ext=gl.getExtension('WEBGL_debug_renderer_info');const renderer=String(gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER));if(/swiftshader|llvmpipe|software|microsoft basic/i.test(renderer))throw new Error(`Hardware rendering required: ${renderer}`);return {renderer,noSwiftShader:true};});
  await call('lab','setWalkingEnabled',[true]);
  await page.addStyleTag({content:'#panel-feature-lab{visibility:hidden!important}'});
  const fixture=await page.evaluate(()=>(window as any).__groundMotionLab);
  if(JSON.stringify(fixture?.actors?.map((a:any)=>a.assetId).sort())!==JSON.stringify([...selected].sort()))throw new Error('Fixture roster differs from selected actors');
  report.fixture=fixture;
  for(const id of selected) {
    const actor=fixture.actors.find((a:any)=>a.assetId===id);
    const row:any={id,entityId:actor.entityId,samples:[],frames:[],errors:[]};report.assets.push(row);
    for(const [label,fn] of [['residency',residency],['combat',combat]] as const) {
      if(stage!=='all' && stage!==label)continue;
      try {await fn(row);}catch(e){row.errors.push(`${label}: ${String(e)}`);}
    }
    row.eventsFinal=await call('debug','getEvents',[0]);row.status=row.errors.length?'coverage-incomplete':'semantic-coverage-passed';
  }
} catch(e) {report.errors.push(String(e));}
finally {
  clearTimeout(timer);
  try {report.servedBytes=await finishResponses();if(!report.servedBytes.passed)report.errors.push(...report.servedBytes.errors);}catch(e){report.errors.push(String(e));}
  report.elapsedMs=performance.now()-started;
  report.status=report.errors.length || report.assets.length!==selected.length || report.assets.some((r:any)=>r.errors.length) ? 'coverage-incomplete':'semantic-coverage-passed';
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await context.close();await browser.close();clearDeadline();
}
console.log(JSON.stringify({status:report.status,output}));
if(report.status!=='semantic-coverage-passed')process.exitCode=1;
