import {ROOTFALL_STUMP} from '../../../game/src/world/rootfallStump.js';
import assert from 'node:assert/strict';
import {assertGameplayHardware} from './finish-gameplay-renderer.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const out=`test-results/finish-rootfall-stump/${new Date().toISOString().replace(/[:.]/g,'-')}`;await mkdir(out,{recursive:true});
const clear=installTestDeadline('Rootfall native stump',55000);
const driver=new GameDriver({url:process.env.COREALM_URL ?? 'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const paths=['game/src/render/buildings.ts','game/src/render/rootfallNavigation.ts','game/src/render/structureNavigation.ts','game/src/world/rootfallStump.ts','game/src/featureLab/structures.ts','game/public/assets/models/corealm/nature/corealm_stump_oak.glb','game/public/assets/models/building/stairs_exterior.glb'];
const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report:any={passed:false,visualAccepted:false,sources,walk:[],shots:[]};
try{
 await driver.launch();await driver.open(24000,'/index.html?mode=combat');const page=driver.page!;
 report.renderer=await assertGameplayHardware(page);
 await page.locator('#panel-feature-lab .panel__close').click();
 const state:any=await page.evaluate(async()=>(window as any).__featureLab.setStructure({kind:'composition',id:'rootfall_stump',kit:'timber',width:6,depth:6,seed:1}));
 report.fixture=state;assert(state.structure.ready);
 // Same fixed origin as the production building workbench; groundHeight supplies its terrain Y.
 const x=-8,z=12,base:number=await driver.callDebug('groundHeight',[x,z]);
 const yaw=ROOTFALL_STUMP.stairYaw,axis=[Math.sin(yaw),Math.cos(yaw)],startDistance=ROOTFALL_STUMP.stairFrontZ+4;
 const startX=x+axis[0]!*startDistance,startZ=z+axis[1]!*startDistance;
 const startY:number=await driver.callDebug('groundHeight',[startX,startZ]);
 report.setup={origin:[x,base,z],stairYaw:yaw,startDistance,terrainApproach:[startX,startY,startZ]};
 const along=(p:any)=>(p.x-x)*axis[0]!+(p.z-z)*axis[1]!;
 await driver.callDebug('teleport',[[startX,startY,startZ]]);
 await driver.callDebug('inspectPose',[{x:x+axis[0]!*startDistance,y:base+1,z:z+axis[1]!*startDistance,yaw,pitch:.45,distance:13,detached:true}]);
 await page.evaluate(()=>(window as any).__featureLab.setFreeCameraEnabled(false));
 const before:any=await driver.callDebug('getPlayer');report.before=before;
 for(let i=0;i<15;i++){
  await driver.press('w',450);const player:any=await driver.callDebug('getPlayer');report.walk.push(player);
  if(along(player.position)<=1.5)break;
 }
 const after=report.walk.at(-1);assert(along(after.position)<=2,'Player must climb beyond the stair crest');
 assert(after.position.y-base>2.7,'Player must stand on the actual elevated stump cut face');
 assert(Math.abs((after.position.x-x)*axis[1]!-(after.position.z-z)*axis[0]!)<.6,'Stair walk remains within tread width');
 report.shots.push(await driver.screenshot(out,'01-real-climb'));
 await driver.callDebug('inspectPose',[{x:after.position.x,y:after.position.y+1,z:after.position.z,yaw:yaw+Math.PI,pitch:.45,distance:13,detached:true}]);
 await page.evaluate(()=>(window as any).__featureLab.setFreeCameraEnabled(false));
 report.descent=[];
 for(let i=0;i<15;i++){
  await driver.press('w',450);const player:any=await driver.callDebug('getPlayer');report.descent.push(player);
  if(along(player.position)>=startDistance-.5)break;
 }
 const returned=report.descent.at(-1);
 assert(along(returned.position)>=startDistance-.5,'Player must descend past the stair foot');
 assert(Math.abs(returned.position.y-base)<.5,'Descent must return to plaza level');
 assert(report.descent.some((p:any)=>p.position.y-base>1&&p.position.y-base<2.7),'Descent must use intermediate stair heights');
 report.shots.push(await driver.screenshot(out,'02-real-descent'));
 for(const[name,viewYaw]of[['front',yaw+.35],['rear',yaw+Math.PI+.35]]as const){
  await driver.callDebug('inspectPose',[{x,y:base+2,z:z+1,yaw:viewYaw,pitch:.56,distance:17,detached:true}]);await driver.wait(140);
  report.shots.push(await driver.screenshot(out,name));
 }
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.pageErrors=driver.pageErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.pageErrors,[]);
 for(const source of sources)assert.equal(createHash('sha256').update(await readFile(source.path)).digest('hex'),source.sha256,`Appearance source changed during capture: ${source.path}`);
 report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;if(driver.page)report.failureShot=await driver.screenshot(out,'failure');}
finally{await driver.close();clear();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}

