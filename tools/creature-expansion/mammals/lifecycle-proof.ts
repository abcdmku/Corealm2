/** One frozen candidate's real production AI lifecycle; root schedules GPU. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GameDriver} from '../../lib/driver.js';
import {installAssetCandidates} from '../../lib/assetCandidates.js';
import {installTestDeadline} from '../../lib/deadline.js';
const args=process.argv.slice(2),arg=(n:string,d:string)=>args.includes(n)?args[args.indexOf(n)+1]!:d;
const species=arg('--id','cairn_bighorn');assert(['cairn_bighorn','bracken_tapir','ashscale_monitor','redbrush_fox'].includes(species));
const preset=`${species}_residents`,out=arg('--out',`test-results/quadruped-lifecycle/${species}`),catalog=arg('--catalog','art/rebuild/candidates/finish-quadrupeds/promotion-catalogue.json');
const driver=new GameDriver({url:arg('--url','http://127.0.0.1:4175'),close:async()=>{}},{headless:true,viewport:{width:1440,height:1000},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,species,setup:'Production fixture spawn at7m, melee1 unarmed provocation, then normal move commands to provoke pursuit and turning. Later melee35/Cobalt sword for bounded kill. No actor health/AI state edits, forced death, clock changes or forced respawn.',trace:[],captures:[],visualAccepted:false};
report.candidateCatalogue=catalog;
report.assetMetadata=JSON.parse(await readFile(catalog,'utf8')).assets.find((asset:any)=>asset.id===`creature_${species}`);
assert(report.assetMetadata,`Candidate catalogue lacks creature_${species}`);
await mkdir(out,{recursive:true});const clearDeadline=installTestDeadline(`${species} natural lifecycle`,120000);
try{
 await driver.launch();const page=driver.page!;await installAssetCandidates(page,catalog);await driver.open(25000,'/index.html?mode=combat');
 report.renderer=await page.evaluate(()=>{const g=document.querySelector('canvas')!.getContext('webgl2')!,e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER);});assert(report.renderer&&!/swiftshader|software|llvmpipe/i.test(report.renderer));
 const call=(name:string,a:any)=>page.evaluate(async({name,a})=>{const r=await(window as any).__gameDebug.callTool(name,a);if(r?.error)throw Error(JSON.stringify(r));return r;},{name,a});
 await page.evaluate(async preset=>{const l=(window as any).__featureLab;await l.spawnTarget('creature',preset,{distance:7});l.setLevel('melee',1);await l.equipPlayer('mainHand',null);},preset);
 await page.waitForFunction(p=>(window as any).__featureLab.getState()?.target?.presetId===p,preset);
 const sample=async(stage:string)=>{const s=await page.evaluate(()=>{const l=(window as any).__featureLab.getState(),d=(window as any).__gameDebug;return {lab:l,motion:d.getEntityMotion(l.target.entityId),entity:d.getEntity(l.target.entityId),game:d.getState()};});assert.equal(s.lab.target.presetId,preset);const row={at:Date.now(),stage,...s};report.trace.push(row);return row;};
 const capture=async(label:string)=>{
  await page.evaluate(()=>{const d=(window as any).__gameDebug,l=(window as any).__featureLab.getState(),b=d.getDrawnBounds(l.target.entityId);if(b){const size=Math.max(b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z);d.inspectPose({x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2,yaw:Math.PI/2,pitch:.20,distance:Math.max(4.5,size*1.8),detached:true});}});
  const frameState=()=>page.evaluate(()=>{const l=(window as any).__featureLab.getState(),d=(window as any).__gameDebug;return {at:Date.now(),target:l.target,motion:d.getEntityMotion(l.target.entityId)};});
  const before=await frameState();await driver.screenshot(out,label);const after=await frameState();
  report.captures.push(label);(report.captureDetails??=[]).push({label,before,after,note:'Filename is the triggering observation. Live motion can advance during screenshot capture; bracketing states record that explicitly.'});
 };
 const observe=async(stage:string,ms:number)=>{const until=Date.now()+ms;while(Date.now()<until){const s=await sample(stage);for(const motion of ['attack','hit'])if(s.lab.target.motion?.motion===motion&&!report.captures.includes(motion))await capture(motion);await driver.wait(100);}};
 report.before=await sample('setup');assert.equal(report.before.game.clock.timeScale,1);await capture('idle');
 if(!await page.locator('#lab-attack').isVisible())await page.keyboard.press('l');await page.locator('#lab-attack').click();await observe('approach-provocation',4500);await capture('approach');
 const origin=report.before.lab.target.position,p=report.before.lab.player.position;
 await call('corealm_move_to',{position:[origin[0]-3,p[1],origin[2]+3]});await observe('pursuit',2500);await capture('pursuit');
 await call('corealm_move_to',{position:[origin[0]+3,p[1],origin[2]+3]});await observe('turn',2500);await capture('turn');
 await call('corealm_stop',{});await page.evaluate(async()=>{const l=(window as any).__featureLab;l.setLevel('melee',35);await l.equipPlayer('mainHand','kaldite_sword');});
 report.beforeKill=await sample('kill-setup');
 await page.locator('#lab-attack').click();const end=Date.now()+35000;let dead:any;
 while(Date.now()<end){const s=await sample('natural-combat');for(const motion of ['attack','hit'])if(s.lab.target.motion?.motion===motion&&!report.captures.includes(motion))await capture(motion);if(s.lab.target.state==='dead'&&s.lab.target.health===0){dead=s;break;}await driver.wait(100);}
 assert(dead,'No natural death within35s');assert(dead.lab.target.ai.respawnInMs>0);report.dead=dead;
 await page.waitForFunction(()=>{const l=(window as any).__featureLab.getState();return (window as any).__gameDebug.getEntityMotion(l.target.entityId)?.motion==='death';},undefined,{timeout:4000});
 report.deathRenderedStart=await sample('death-rendered-start');
 const deathMotion=report.deathRenderedStart.motion,remainingDeathMs=Math.max(0,deathMotion.duration-deathMotion.time)/Math.max(.01,deathMotion.timeScale)*1000;
 await observe('death-settle',Math.min(5000,remainingDeathMs+250));report.deathSettled=await sample('death-settled');
 assert(report.deathSettled.motion.motion==='death'&&report.deathSettled.motion.time>=report.deathSettled.motion.duration-.025,'Death capture has not reached the settled clip ending');await capture('death');
 const until=Date.now()+35000;let respawn:any;while(Date.now()<until){const s=await sample('respawn-wait');if(s.lab.target.state!=='dead'&&s.lab.target.health===s.lab.target.maxHealth&&s.lab.target.ai.respawnInMs===null){respawn=s;break;}await driver.wait(300);}
 assert(respawn,'No normal respawn within35real seconds');report.respawn=respawn;await page.waitForFunction(()=>{const l=(window as any).__featureLab.getState();return l.target.state!=='dead'&&l.target.motion?.liveRig&&l.target.motion.motion!=='death';},undefined,{timeout:4000});await driver.wait(250);report.respawnRendered=await sample('respawn-rendered');await capture('respawn');
 const live=report.trace.filter((s:any)=>!['respawn-wait','setup','death-settle','respawn-rendered'].includes(s.stage)&&s.lab.target.state!=='dead'&&s.lab.target.health>0);let moved=0,turn=0,movingTurn=0,inPlaceTurn=0;const advancing=new Set<string>();
 for(let i=1;i<live.length;i++){const a=live[i-1],b=live[i];if(b.at-a.at>700)continue;const pa=a.lab.target.position,pb=b.lab.target.position,d=Math.hypot(pb[0]-pa[0],pb[2]-pa[2]);moved+=d;if(a.motion&&b.motion){const angle=Math.abs(Math.atan2(Math.sin(b.motion.semanticRotationY-a.motion.semanticRotationY),Math.cos(b.motion.semanticRotationY-a.motion.semanticRotationY)));turn+=angle;if(d>.0001)movingTurn+=angle;else inPlaceTurn+=angle;if(d>.0001&&a.motion.clip===b.motion.clip&&Math.abs(a.motion.time-b.motion.time)>.001)advancing.add(b.motion.motion);}}
 report.coverage={movedMetres:moved,turnRadians:turn,movingTurnRadians:movingTurn,inPlaceTurnRadians:inPlaceTurn,turnScope:'Living actor heading changes; in-place rotation does not establish curved travel or planted-foot correctness.',advancing:[...advancing],motions:[...new Set(live.map((s:any)=>s.lab.target.motion?.motion))]};assert(moved>.5,'Insufficient natural actor travel');assert(turn>.15,'No meaningful actor turn');assert(advancing.has('walk')||advancing.has('run'),'No advancing locomotion while moving');assert(report.captures.includes('attack'),'Enemy attack was not observed');assert(report.captures.includes('hit'),'Hit motion was not observed');
 report.rewards={meleeXP:dead.game.skills.melee.xp-report.beforeKill.game.skills.melee.xp,marks:dead.game.currency-report.beforeKill.game.currency};
 assert(report.rewards.meleeXP>0,'No kill XP');assert(report.rewards.marks>0,'No kill marks');
 report.errors=await driver.callDebug('getErrors');report.pageErrors=driver.pageErrors;assert.deepEqual(report.errors,[]);assert.deepEqual(report.pageErrors,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
