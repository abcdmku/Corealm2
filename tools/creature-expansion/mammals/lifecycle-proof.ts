/** One frozen quadruped candidate's real production AI lifecycle on hardware; root schedules GPU.
 * Slice 05 port of tools/rpg-bestiary/lifecycle-proof.ts for creature-expansion species:
 *  - hit reactions are masked overlays over the continuing gait (Slice 03), so a hit is observed
 *    through motion.hitOverlay rather than a separate 'hit' motion;
 *  - the player retreat scales with the live actor's body radius so long-bodied species must pursue;
 *  - action captures are state-aware (clip time window, matching before/after states);
 *  - settled corpse captured from two yaws; natural loot pickup is proved when an item drops;
 *  - movement/turn metrics use the shared living-sample rules in tools/rpg-bestiary/lifecycle-metrics.ts.
 * Usage: npx tsx tools/creature-expansion/mammals/lifecycle-proof.ts --id redbrush_fox --catalog <catalogue.json> --url http://127.0.0.1:4181 --out test-results/<dir> */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../lib/driver.js';
import {installAssetCandidates} from '../../lib/assetCandidates.js';
import {installTestDeadline} from '../../lib/deadline.js';
import {lifecycleMetrics} from '../../rpg-bestiary/lifecycle-metrics.js';
import {CREATURE_EXPANSION} from '../../../game/src/content/creatureExpansion.js';
const args=process.argv.slice(2),arg=(n:string,d:string)=>args.includes(n)?args[args.indexOf(n)+1]!:d;
const species=arg('--id','redbrush_fox'),corpseView=arg('--corpse-view','side');assert(['side','front','rear'].includes(corpseView));const definition=CREATURE_EXPANSION.find(row=>row.id===species);assert(definition,`Unknown creature-expansion species ${species}`);
const preset=`${species}_residents`,out=arg('--out',`test-results/quadruped-lifecycle/${species}`),catalog=arg('--catalog','art/rebuild/candidates/finish-quadrupeds/promotion-catalogue.json');
const catalogBytes=await readFile(catalog);
const driver=new GameDriver({url:arg('--url',process.env.LAB_URL??'http://127.0.0.1:4175'),close:async()=>{}},{headless:true,viewport:{width:1440,height:1000},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,species,preset,setup:'Production fixture spawn at 7 m, melee 1 unarmed provocation, then normal move commands sized to the actor body radius to provoke pursuit and turning. Later melee 35/kaldite sword for a bounded kill. No actor health/AI state edits, forced death, clock changes or forced respawn.',trace:[],captures:[],captureStates:[],visualAccepted:false};
report.candidateCatalogue=catalog;report.catalogueSha256=createHash('sha256').update(catalogBytes).digest('hex');
report.assetMetadata=JSON.parse(catalogBytes.toString('utf8')).assets.find((asset:any)=>asset.id===`creature_${species}`);
assert(report.assetMetadata,`Candidate catalogue lacks creature_${species}`);
await mkdir(out,{recursive:true});const clearDeadline=installTestDeadline(`${species} natural lifecycle`,120000);
try{
 await driver.launch();const page=driver.page!;await installAssetCandidates(page,catalog);await driver.open(25000,'/index.html?mode=combat');
 report.renderer=await page.evaluate(()=>{const g=document.querySelector('canvas')!.getContext('webgl2')!,e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER);});assert(report.renderer&&!/swiftshader|software|llvmpipe/i.test(report.renderer));
 const call=(name:string,a:any)=>page.evaluate(async({name,a})=>{const r=await(window as any).__gameDebug.callTool(name,a);if(r?.error)throw Error(JSON.stringify(r));return r;},{name,a});
 await page.evaluate(async preset=>{const l=(window as any).__featureLab;await l.spawnTarget('creature',preset,{distance:7});l.setLevel('melee',1);await l.equipPlayer('mainHand',null);},preset);
 await page.waitForFunction(p=>(window as any).__featureLab.getState()?.target?.presetId===p,preset);
 const sample=async(stage:string)=>{const s=await page.evaluate(()=>{const l=(window as any).__featureLab.getState(),d=(window as any).__gameDebug;return {lab:l,motion:d.getEntityMotion(l.target.entityId),entity:d.getEntity(l.target.entityId),drawn:d.getDrawnBounds(l.target.entityId),game:d.getState()};});assert.equal(s.lab.target.presetId,preset);const row={at:Date.now(),stage,...s};report.trace.push(row);return row;};
 const hitActive=(s:any)=>{const o=s.motion?.hitOverlay;return !!(o&&o.active&&o.duration>0&&o.time>=o.duration*.15&&o.time<=o.duration*.6);};
 const capture=async(label:string,expected?:'attack'|'hit')=>{
  await page.evaluate(label=>{const d=(window as any).__gameDebug,l=(window as any).__featureLab.getState(),b=d.getDrawnBounds(l.target.entityId);if(b){const size=Math.max(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z);d.inspectPose({x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2,yaw:label==='corpse-front'?0:label==='corpse-rear'?Math.PI:Math.PI/2,pitch:label.startsWith('corpse-')?.28:.20,distance:Math.max(4.5,size*(label.startsWith('corpse-')?2.2:1.8)),detached:true});}},label);
  await driver.wait(expected||label.startsWith('corpse-')?0:180);
  const before=await sample(`capture-${label}-before`);
  if(label.startsWith('corpse-'))assert(before.drawn&&before.drawn.fade===0,'Corpse already fading before capture');
  const attempts=report.captureStates.filter((s:any)=>s.label===label).length,file=attempts?`${label}-${attempts+1}`:label;
  await driver.screenshot(out,file);const after=await sample(`capture-${label}-after`);
  const matched=!expected||(expected==='attack'?(before.motion?.motion==='attack'&&after.motion?.motion==='attack'&&before.motion?.clip===after.motion?.clip):(!!before.motion?.hitOverlay?.active&&!!after.motion?.hitOverlay?.active));
  report.captureStates.push({label,file,expected,matched,before:{at:before.at,motion:before.motion,drawn:before.drawn},after:{at:after.at,motion:after.motion,drawn:after.drawn},note:'Filename is the triggering observation; bracketing states record what the live rig actually showed.'});
  if(label.startsWith('corpse-'))assert(after.drawn&&after.drawn.fade===0,'Corpse began fading during capture');
  if(matched&&!report.captures.includes(label))report.captures.push(label);
 };
 const observe=async(stage:string,ms:number)=>{const until=Date.now()+ms;while(Date.now()<until){const s=await sample(stage);
  if(s.lab.target.motion?.motion==='attack'&&s.motion.time>=s.motion.duration*.1&&s.motion.time<s.motion.duration*.6&&!report.captures.includes('attack'))await capture('attack','attack');
  if(hitActive(s)&&!report.captures.includes('hit')){(report.hitOverlays??=[]).push(s.motion.hitOverlay);await capture('hit','hit');}
  if(s.motion?.hitOverlay?.active)report.hitOverlaySamples=(report.hitOverlaySamples??0)+1;
  await driver.wait(100);}};
 report.before=await sample('setup');assert.equal(report.before.game.clock.timeScale,1);await capture('idle');
 if(!await page.locator('#lab-attack').isVisible())await page.keyboard.press('l');await page.locator('#lab-attack').click();await observe('approach-provocation',4500);await capture('approach');
 const origin=report.before.lab.target.position,p=report.before.lab.player.position;
 const bodyRadius=report.trace.map((s:any)=>s.lab.target.ai?.bodyRadius).find((r:any)=>Number.isFinite(r))??1;
 const retreat=Math.max(3,bodyRadius+4);report.retreatMetres=retreat;report.bodyRadius=bodyRadius;
 await call('corealm_move_to',{position:[origin[0]-3,p[1],origin[2]+retreat]});await observe('pursuit',2500);await capture('pursuit');
 await call('corealm_move_to',{position:[origin[0]+3,p[1],origin[2]+retreat]});await observe('turn',2500);await capture('turn');
 // A fast actor may finish turning during its stationary attack recovery. Change the player's
 // destination only after natural pursuit is already moving, so a moving turn is actually possible.
 if(lifecycleMetrics(report.trace).movingTurnRadians<.15){
  await call('corealm_move_to',{position:[origin[0]-3,p[1],origin[2]+retreat+2]});
  const end=Date.now()+3000;let pursuing:any;
  while(Date.now()<end){const s=await sample('turn-pursuit-ready');if(['run','walk'].includes(s.motion?.motion)&&s.lab.target.ai.distanceFromPlayer>bodyRadius+.5){pursuing=s;break;}await driver.wait(100);}
  if(pursuing){const a=pursuing.lab.target.position,b=pursuing.lab.player.position,length=Math.hypot(b[0]-a[0],b[2]-a[2]);assert(length>0,'Pursuit direction is undefined');const dx=(b[0]-a[0])/length,dz=(b[2]-a[2])/length;
   await call('corealm_move_to',{position:[b[0]-dz*5+dx*2,b[1],b[2]+dx*5+dz*2]});await observe('moving-turn',2500);await capture('moving-turn');}
 }
 await call('corealm_stop',{});await page.evaluate(async()=>{const l=(window as any).__featureLab;l.setLevel('melee',35);await l.equipPlayer('mainHand','kaldite_sword');});
 report.beforeKill=await sample('kill-setup');
 await page.locator('#lab-attack').click();const end=Date.now()+35000;let dead:any;
 while(Date.now()<end){const s=await sample('natural-combat');
  if(s.lab.target.motion?.motion==='attack'&&s.motion.time>=s.motion.duration*.1&&s.motion.time<s.motion.duration*.6&&!report.captures.includes('attack'))await capture('attack','attack');
  if(hitActive(s)&&!report.captures.includes('hit')){(report.hitOverlays??=[]).push(s.motion.hitOverlay);await capture('hit','hit');}
  if(s.motion?.hitOverlay?.active)report.hitOverlaySamples=(report.hitOverlaySamples??0)+1;
  if(s.lab.target.state==='dead'&&s.lab.target.health===0){dead=s;break;}await driver.wait(100);}
 assert(dead,'No natural death within 35 s');assert(dead.lab.target.ai.respawnInMs>0);report.dead=dead;
 await page.waitForFunction(()=>{const l=(window as any).__featureLab.getState();return (window as any).__gameDebug.getEntityMotion(l.target.entityId)?.motion==='death';},undefined,{timeout:4000});
 report.deathRenderedStart=await sample('death-rendered-start');
 const deathMotion=report.deathRenderedStart.motion,remainingDeathMs=Math.max(0,deathMotion.duration-deathMotion.time)/Math.max(.01,deathMotion.timeScale)*1000;
 await observe('death-midfall',Math.min(600,remainingDeathMs*.45));await capture('death');
 const settleUntil=Date.now()+Math.min(8000,remainingDeathMs+1500);let settled:any;
 // The production corpse starts fading about half a second after Death ends, so the settled view is
 // taken inside the clip's final motionless hold (authored Death clips hold their last pose).
 const settleMargin=Number(arg('--settle-margin','0.2'));report.settleMarginSeconds=settleMargin;
 while(Date.now()<settleUntil){const s=await sample('settled-corpse-wait');if(s.motion?.motion==='death'&&s.motion.duration>0&&s.motion.time>=s.motion.duration-settleMargin){settled=s;break;}await driver.wait(50);}
 assert(settled,'Death did not reach its final pose within the bounded observation');report.settledCorpse=settled;
 // The production corpse begins fading shortly after Death settles, so one settled view per run.
 await capture(`corpse-${corpseView}`);report.corpseView=corpseView;
 report.corpseInspection=await sample('corpse-inspected');assert.equal(report.corpseInspection.lab.target.health,0);assert.equal(report.corpseInspection.motion.motion,'death');assert(report.corpseInspection.motion.time>=report.corpseInspection.motion.duration-settleMargin);
 const loot=await page.evaluate(id=>(window as any).__gameDebug.getEntities().filter((e:any)=>e.archetype==='loot'&&e.id.startsWith(`loot_${id}_`)),dead.lab.target.entityId);
 report.loot=loot;report.noItemDrop=loot.length===0;
 if(loot.length){
  report.reward=await page.evaluate(async id=>{const d=(window as any).__gameDebug;const before=await d.callTool('corealm_inventory',{});const event=d.getEvents(0).events.find((e:any)=>e.data?.pileId===id);const opened=await d.callTool('corealm_interact',{entityId:id,interaction:'loot'});return {before,expected:event?.data?.items?.[0],opened,afterOpen:await d.callTool('corealm_inventory',{})};},loot[0].id);
  assert(report.reward.expected,'Missing natural drop provenance');assert.deepEqual(report.reward.before.slots,report.reward.afterOpen.slots,'Opening loot transferred inventory');
  await page.locator('.loot-reveal:not([hidden]) .loot-reveal__slot').first().click();
  report.reward.afterTake=await call('corealm_inventory',{});
  const quantity=(inventory:any,id:string)=>(inventory.slots??[]).reduce((sum:number,s:any)=>sum+(s?.itemId===id?s.quantity:0),0);
  assert.equal(quantity(report.reward.afterTake,report.reward.expected.itemId)-quantity(report.reward.before,report.reward.expected.itemId),report.reward.expected.quantity,'Pointer pickup did not transfer exact stack');
 }
 const until=Date.now()+35000;let respawn:any;while(Date.now()<until){const s=await sample('respawn-wait');if(s.lab.target.state!=='dead'&&s.lab.target.health===s.lab.target.maxHealth&&s.lab.target.ai.respawnInMs===null){respawn=s;break;}await driver.wait(300);}
 assert(respawn,'No normal respawn within 35 real seconds');report.respawn=respawn;
 await page.waitForFunction(()=>{const l=(window as any).__featureLab.getState(),m=(window as any).__gameDebug.getEntityMotion(l.target.entityId);return l.target.state!=='dead'&&l.target.health===l.target.maxHealth&&l.target.ai.respawnInMs===null&&m&&['live-rig','sampled-rig'].includes(m.path)&&m.motion!=='death'&&m.clip!=='Death'&&Number.isFinite(m.time)&&m.duration>0&&m.drawnPosition?.every(Number.isFinite);},undefined,{timeout:4000});
 await driver.wait(250);report.respawnRendered=await sample('respawn-rendered');await capture('respawn');
 report.coverage={...lifecycleMetrics(report.trace),turnScope:'Living actor heading changes from adjacent samples; in-place rotation does not establish curved travel or planted-foot correctness.'};
 const advancing=new Set<string>(report.coverage.advancing);
 assert(report.coverage.movedMetres>.5,'Insufficient natural actor travel');assert(report.coverage.movingTurnRadians>.15,'No meaningful living actor turn while moving');assert(advancing.has('walk')||advancing.has('run'),'No advancing locomotion while moving');
 assert(report.captures.includes('attack'),'No screenshot remained in actual Attack throughout capture');assert(report.captures.includes('hit'),'No screenshot remained inside an active hit overlay throughout capture');
 assert(report.hitOverlays?.every((o:any)=>o.maskStatus==='native-masked'&&o.bones.length>0),'Hit overlay did not use the native masked reaction');
 report.rewards={meleeXP:dead.game.skills.melee.xp-report.beforeKill.game.skills.melee.xp,marks:dead.game.currency-report.beforeKill.game.currency};
 assert(report.rewards.meleeXP>0,'No kill XP after fixture level setup');assert(report.rewards.marks>0,'No kill marks');
 report.errors=await driver.callDebug('getErrors');report.pageErrors=driver.pageErrors;assert.deepEqual(report.errors,[]);assert.deepEqual(report.pageErrors,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
