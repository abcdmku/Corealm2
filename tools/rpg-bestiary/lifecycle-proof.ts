import {lifecycleMetrics} from './lifecycle-metrics.js';
/** One frozen candidate's real production AI lifecycle; root schedules GPU. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GameDriver} from '../lib/driver.js';
import {installAssetCandidates} from '../lib/assetCandidates.js';
import {installTestDeadline} from '../lib/deadline.js';
import {createHash} from 'node:crypto';
import {RPG_BESTIARY,RPG_BESTIARY_STAGED} from '../../game/src/content/rpgBestiary.js';
const args=process.argv.slice(2),arg=(n:string,d:string)=>args.includes(n)?args[args.indexOf(n)+1]!:d;
const corpseOnly=args.includes('--corpse-only'),supplement=args.includes('--supplement')||corpseOnly;
const species=arg('--id','webweaver_spider'),definition=[...RPG_BESTIARY,...RPG_BESTIARY_STAGED].find(row=>row.id===species);assert(definition);
const preset=`${RPG_BESTIARY_STAGED.some(row=>row.id===species)?'candidate':'species'}:${species}`,out=arg('--out',`test-results/bestiary-lifecycle/${species}`),catalog=arg('--catalog','art/rebuild/candidates/finish-bestiary/whole-source-first2/catalog.json');
const catalogBytes=await readFile(catalog);
const driver=new GameDriver({url:arg('--url','http://127.0.0.1:4175'),close:async()=>{}},{headless:true,viewport:{width:1440,height:1000},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,species,setup:'Production fixture spawn at7m, melee1 unarmed provocation, then normal move commands to provoke pursuit and turning. Later melee35/Cobalt sword for bounded kill. No actor health/AI state edits, forced death, clock changes or forced respawn.',trace:[],captures:[],visualAccepted:false};
await mkdir(out,{recursive:true});const clearDeadline=installTestDeadline(`${species} natural lifecycle`,supplement?60000:120000);report.supplement=supplement;report.corpseOnly=corpseOnly;
report.catalogueSha256=createHash('sha256').update(catalogBytes).digest('hex');report.catalogPath=catalog;
try{
 await driver.launch();const page=driver.page!;await installAssetCandidates(page,catalog);await driver.open(25000,'/index.html?mode=combat');
 report.renderer=await page.evaluate(()=>{const g=document.querySelector('canvas')!.getContext('webgl2')!,e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER);});assert(report.renderer&&!/swiftshader|software|llvmpipe/i.test(report.renderer));
 const call=(name:string,a:any)=>page.evaluate(async({name,a})=>{const r=await(window as any).__gameDebug.callTool(name,a);if(r?.error)throw Error(JSON.stringify(r));return r;},{name,a});
 await page.evaluate(async preset=>{const l=(window as any).__featureLab;await l.spawnTarget('creature',preset,{distance:7});l.setLevel('melee',1);await l.equipPlayer('mainHand',null);},preset);
 await page.waitForFunction(p=>(window as any).__featureLab.getState()?.target?.presetId===p,preset);
 const sample=async(stage:string)=>{const s=await page.evaluate(()=>{const l=(window as any).__featureLab.getState(),d=(window as any).__gameDebug;return {lab:l,motion:d.getEntityMotion(l.target.entityId),entity:d.getEntity(l.target.entityId),drawn:d.getDrawnBounds(l.target.entityId),game:d.getState()};});assert.equal(s.lab.target.presetId,preset);const row={at:Date.now(),stage,...s};report.trace.push(row);return row;};
 const capture=async(label:string,expectedMotion?:string)=>{
  if(!expectedMotion){await page.evaluate(label=>{const d=(window as any).__gameDebug,l=(window as any).__featureLab.getState(),b=d.getDrawnBounds(l.target.entityId);if(b){const size=Math.max(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z);d.inspectPose({x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2,yaw:label==='corpse-front'?0:Math.PI/2,pitch:.20,distance:Math.max(4.5,size*(label.includes('corpse')?2.6:1.8)),detached:true});}},label);await driver.wait(corpseOnly&&label.startsWith('corpse-')?16:180);}
  const before=await sample(`capture-${label}-before`);if(label.startsWith('corpse-'))assert(before.drawn&&before.drawn.fade===0,'Corpse already fading before capture');
  const attempts=(report.captureStates??=[]).filter((s:any)=>s.label===label).length;
  const file=attempts?`${label}-${attempts+1}`:label;
  await driver.screenshot(out,file);const after=await sample(`capture-${label}-after`);
  const matched=!expectedMotion||(before.motion?.motion===expectedMotion&&after.motion?.motion===expectedMotion&&before.motion?.clip===after.motion?.clip);
  report.captureStates.push({label,file,expectedMotion,matched,before:{at:before.at,motion:before.motion,drawn:before.drawn},after:{at:after.at,motion:after.motion,drawn:after.drawn}});
  if(label.startsWith('corpse-'))assert(after.drawn&&after.drawn.fade===0,'Corpse began fading during capture');
  if(matched)report.captures.push(label);
 };
 const observe=async(stage:string,ms:number)=>{const until=Date.now()+ms;while(Date.now()<until){const s=await sample(stage);for(const motion of ['attack','hit'])if(s.lab.target.motion?.motion===motion&&s.motion.time>=s.motion.duration*(motion==='hit'?.2:.1)&&s.motion.time<s.motion.duration*.6&&!report.captures.includes(motion))await capture(motion,motion);await driver.wait(100);}};
 report.before=await sample('setup');assert.equal(report.before.game.clock.timeScale,1);await capture('idle');
 if(!await page.locator('#lab-attack').isVisible())await page.keyboard.press('l');await page.locator('#lab-attack').click();await observe('approach-provocation',4500);await capture('approach');
 const origin=report.before.lab.target.position,p=report.before.lab.player.position;
 const reach=definition.stats.attackRangeM??1.8;
 const retreat=reach>2?reach+4:3;
 if(!supplement){
 await call('corealm_move_to',{position:[origin[0]-3,p[1],origin[2]+retreat]});await observe('pursuit',2500);await capture('pursuit');
 await call('corealm_move_to',{position:[origin[0]+3,p[1],origin[2]+retreat]});await observe('turn',2500);await capture('turn');
 // A fast actor may finish turning during its stationary attack recovery.
 // Change the player's destination only after natural pursuit is already moving.
 if(lifecycleMetrics(report.trace).movingTurnRadians<.15){
  const end=Date.now()+2000;let pursuing:any;
  while(Date.now()<end){const s=await sample('turn-pursuit-ready');if(s.motion?.motion==='run'&&s.lab.target.ai.distanceFromPlayer>reach+.25){pursuing=s;break;}await driver.wait(100);}
  if(pursuing){
   const a=pursuing.lab.target.position,b=pursuing.lab.player.position;
   const length=Math.hypot(b[0]-a[0],b[2]-a[2]);
   assert(length>0,'Pursuit direction is undefined');
   const dx=(b[0]-a[0])/length,dz=(b[2]-a[2])/length;
   await call('corealm_move_to',{position:[b[0]-dz*5+dx*2,b[1],b[2]+dx*5+dz*2]});
   await observe('moving-turn',2500);await capture('moving-turn');
  }
 }
 }
 await call('corealm_stop',{});await page.evaluate(async()=>{const l=(window as any).__featureLab;l.setLevel('melee',35);await l.equipPlayer('mainHand','kaldite_sword');});
 report.beforeKill=await sample('kill-setup');
 if(corpseOnly){await page.keyboard.press('l');await page.evaluate(()=>(window as any).__featureLab.perform('attack'));}else await page.locator('#lab-attack').click();const end=Date.now()+35000;let dead:any;
 while(Date.now()<end){const s=await sample('natural-combat');for(const motion of ['attack','hit'])if(s.lab.target.motion?.motion===motion&&s.motion.time>=s.motion.duration*(motion==='hit'?.2:.1)&&s.motion.time<s.motion.duration*.6&&!report.captures.includes(motion))await capture(motion,motion);if(s.lab.target.state==='dead'&&s.lab.target.health===0){dead=s;break;}await driver.wait(100);}
 assert(dead,'No natural death within35s');assert(dead.lab.target.ai.respawnInMs>0);report.dead=dead;
 if(corpseOnly){
  const a=dead.lab.target.position,b=dead.lab.player.position,length=Math.hypot(b[0]-a[0],b[2]-a[2]);
  const dx=length>.01?(b[0]-a[0])/length:1,dz=length>.01?(b[2]-a[2])/length:0;
  await call('corealm_move_to',{position:[b[0]+dx*3,b[1],b[2]+dz*3]});
 }else{await observe('death-settle',900);await capture('death');}
 const settleUntil=Date.now()+8000;let settled:any;
 while(Date.now()<settleUntil){const s=await sample('settled-corpse-wait');if(s.motion?.motion==='death'&&s.motion.duration>0&&s.motion.time>=s.motion.duration-.025){settled=s;break;}await driver.wait(100);}
 assert(settled,'Native Death did not reach its final pose within the bounded observation');report.settledCorpse=settled;if(!corpseOnly)await capture('settled-corpse');
 if(corpseOnly){
  const requestedView=arg('--corpse-view','both');assert(['side','front','both'].includes(requestedView));
  if(requestedView!=='front')await capture('corpse-side');if(requestedView!=='side')await capture('corpse-front');
  report.corpseInspection=await sample('corpse-inspected');
  assert.equal(report.corpseInspection.lab.target.health,0);assert.equal(report.corpseInspection.motion.motion,'death');
  assert(report.corpseInspection.motion.time>=report.corpseInspection.motion.duration-.025);
 }
 const loot=await page.evaluate(id=>(window as any).__gameDebug.getEntities().filter((e:any)=>e.archetype==='loot'&&e.id.startsWith(`loot_${id}_`)),dead.lab.target.entityId);
 report.loot=loot;report.noItemDrop=loot.length===0;
 if(loot.length&&!corpseOnly){
  report.reward=await page.evaluate(async id=>{const d=(window as any).__gameDebug;const before=await d.callTool('corealm_inventory',{});const event=d.getEvents(0).events.find((e:any)=>e.data?.pileId===id);const opened=await d.callTool('corealm_interact',{entityId:id,interaction:'loot'});return {before,expected:event?.data?.items?.[0],opened,afterOpen:await d.callTool('corealm_inventory',{})};},loot[0].id);
  assert(report.reward.expected,'Missing natural drop provenance');assert.deepEqual(report.reward.before.slots,report.reward.afterOpen.slots,'Opening loot transferred inventory');
  await page.locator('.loot-reveal:not([hidden]) .loot-reveal__slot').first().click();
  report.reward.afterTake=await call('corealm_inventory',{});
  const quantity=(inventory:any,id:string)=>(inventory.slots??[]).reduce((sum:number,s:any)=>sum+(s?.itemId===id?s.quantity:0),0);
  assert.equal(quantity(report.reward.afterTake,report.reward.expected.itemId)-quantity(report.reward.before,report.reward.expected.itemId),report.reward.expected.quantity,'Pointer pickup did not transfer exact stack');
 }
 if(!supplement){
 const until=Date.now()+35000;let respawn:any;while(Date.now()<until){const s=await sample('respawn-wait');if(s.lab.target.state!=='dead'&&s.lab.target.health===s.lab.target.maxHealth&&s.lab.target.ai.respawnInMs===null){respawn=s;break;}await driver.wait(300);}
 assert(respawn,'No normal respawn within35real seconds');report.respawn=respawn;await page.waitForFunction(()=>{const l=(window as any).__featureLab.getState(),m=(window as any).__gameDebug.getEntityMotion(l.target.entityId);return l.target.state!=='dead'&&l.target.health===l.target.maxHealth&&l.target.ai.respawnInMs===null&&m&&['live-rig','sampled-rig'].includes(m.path)&&m.motion!=='death'&&m.clip!=='Death'&&Number.isFinite(m.time)&&m.duration>0&&m.drawnPosition?.every(Number.isFinite);},undefined,{timeout:4000});await driver.wait(250);report.respawnRendered=await sample('respawn-rendered');await capture('respawn');
 report.coverage=lifecycleMetrics(report.trace);const moved=report.coverage.movedMetres,turn=report.coverage.movingTurnRadians,advancing=new Set(report.coverage.advancing);assert(moved>.5,'Insufficient natural actor travel');assert(turn>.15,'No meaningful living actor turn while moving');assert(advancing.has('walk')||advancing.has('run'),'No advancing locomotion while moving');assert(report.captures.includes('attack'),'Enemy attack was not observed');assert(report.captures.includes('hit'),'Hit motion was not observed');
 }
 if(!corpseOnly){assert(report.captures.includes('attack'),'No screenshot remained in actual Attack throughout capture');assert(report.captures.includes('hit'),'No screenshot remained in actual Hit throughout capture');}
 assert(dead.game.skills.melee.xp>report.beforeKill.game.skills.melee.xp,'No kill XP after fixture level setup');assert(dead.game.currency>report.beforeKill.game.currency,'No kill marks');
 report.errors=await driver.callDebug('getErrors');report.pageErrors=driver.pageErrors;assert.deepEqual(report.errors,[]);assert.deepEqual(report.pageErrors,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
