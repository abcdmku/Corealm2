/** Unpromoted native candidate bytes in the existing authored shortcut placements. One site per60s. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
import {installAssetCandidates} from '../../../tools/lib/assetCandidates.js';
import {assertGameplayHardware} from './finish-gameplay-renderer.js';
const id=process.argv[2]??'sunder_ledge';assert(['sunder_ledge','scree_slide'].includes(id));
const catalogue=process.argv.includes('--catalog')?process.argv[process.argv.indexOf('--catalog')+1]!:'art/rebuild/candidates/finish-structures/world-geology-aliases.json';
const catalog=JSON.parse(await readFile(catalogue,'utf8'));
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const generator=catalog.generator??'tools/build-corealm-geology.ts';
assert.equal(await hash(generator),catalog.generatorSha256);
const paths=[generator,'game/src/content/regions.ts','game/src/world/regionBuilder.ts','game/src/render/corealmSurfaceMaterials.ts','game/src/app/worldSpec.ts','game/src/app/worldSurface.ts','game/src/render/scene.ts','game/src/systems/movement.ts','runs/corealm-rebuild/checks/finish-geology-world.ts',catalogue];
const sources=await Promise.all(paths.map(async path=>({path,sha256:await hash(path)})));
const out=`test-results/finish-geology-world/${id}/${new Date().toISOString().replace(/[:.]/g,'-')}`;await mkdir(out,{recursive:true});
const clear=installTestDeadline(`Candidate ${id} world landing`,60000);
const driver=new GameDriver({url:process.env.COREALM_URL ?? 'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,visualAccepted:false,id,sources,candidateAliases:catalog.candidateAliases,shots:[],scope:'World terrain embedding/landing exception after compact native gallery review. Legacy semantic asset IDs are browser-only aliases for the exact candidate GLBs.'};
try{
 await driver.launch();await installAssetCandidates(driver.page!,catalogue);await driver.open(30000,'/index.html');const page=driver.page!;
 report.renderer=await assertGameplayHardware(page);
 const entity:any=await driver.callDebug('getEntity',[id]);assert(entity?.obstacle?.exitPosition);report.entity=entity;
 await driver.callDebug('setSkillLevel',['agility',20]);
 const p=entity.position,yaw=entity.view.rotationY??0;
 const start=[p[0]+Math.sin(yaw)*8,p[1],p[2]+Math.cos(yaw)*8];
 await driver.callDebug('teleport',[start]);
 await driver.callDebug('inspectPose',[{x:p[0],y:p[1]+2.2,z:p[2],yaw:yaw+.35,pitch:.52,distance:19,detached:true}]);
 await page.waitForFunction(id=>(window as any).__gameDebug.getDrawnBounds(id)?.meshes>0,id,{timeout:10000});
 report.bounds=await driver.callDebug('getDrawnBounds',[id]);assert(report.bounds);
 for(const[name,angle]of[['front',yaw+.35],['rear',yaw+Math.PI+.35],['side',yaw+Math.PI/2]]as const){
  await driver.callDebug('inspectPose',[{x:p[0],y:p[1]+2.2,z:p[2],yaw:angle,pitch:.5,distance:19,detached:true}]);await driver.wait(150);
  report.shots.push(await driver.screenshot(out,`01-${name}`));
 }
 report.before=await driver.callDebug('getState');
 report.action=await driver.callDebug('callTool',['corealm_interact',{entityId:id,interaction:'climb'}]);assert(!report.action.error,JSON.stringify(report.action));
 await page.waitForFunction(()=>(window as any).__gameDebug.getState().activity==='traversing',undefined,{timeout:10000}).catch(async()=>{
  const state:any=await driver.callDebug('getState');assert(state.activity,'Traversal must start');
 });
 report.during={player:await driver.callDebug('getPlayer'),motion:await driver.callDebug('getPlayerMotion')};
 await page.waitForFunction(()=>(window as any).__gameDebug.getState().activity===null,undefined,{timeout:12000});
 const after:any=await driver.callDebug('getPlayer');report.after=after;const exit=entity.obstacle.exitPosition;
 assert(Math.hypot(after.position.x-exit[0],after.position.z-exit[2])<.4,'Normal traversal must reach authored exit');
 report.afterState=await driver.callDebug('getState');assert(report.afterState.skills.agility.xp>report.before.skills.agility.xp,'Traversal must award normal XP');
 report.landingNav=await driver.callDebug('getNavPoint',[exit]);assert(report.landingNav);
 await driver.callDebug('inspectPose',[{x:after.position.x,y:after.position.y+1.2,z:after.position.z,yaw:0,pitch:.45,distance:12,detached:true}]);
 report.shots.push(await driver.screenshot(out,'02-landed'));
 // Ordinary keyboard walking verifies the landing is usable after the transition.
 await driver.press('w',700);const walked:any=await driver.callDebug('getPlayer');report.walked=walked;
 assert(Math.hypot(walked.position.x-after.position.x,walked.position.z-after.position.z)>.8,'Landing must allow ordinary movement');
 report.shots.push(await driver.screenshot(out,'03-left-landing'));
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.pageErrors=driver.pageErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.pageErrors,[]);
 for(const s of sources)assert.equal(await hash(s.path),s.sha256,`Changed proof input ${s.path}`);
 report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;if(driver.page)report.failureShot=await driver.screenshot(out,'failure');}
finally{await driver.close();clear();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,id,error:report.error,out}));}

