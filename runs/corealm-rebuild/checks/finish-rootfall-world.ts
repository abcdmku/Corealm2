import {ROOTFALL_STUMP} from '../../../game/src/world/rootfallStump.js';
import assert from 'node:assert/strict';
import {assertGameplayHardware} from './finish-gameplay-renderer.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const out=`test-results/finish-rootfall-world/${new Date().toISOString().replace(/[:.]/g,'-')}`;await mkdir(out,{recursive:true});
const clear=installTestDeadline('Rootfall world stair and bank',60000);
const driver=new GameDriver({url:'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const paths=['game/src/render/camera.ts','game/src/systems/staticCameraQueries.ts','game/src/render/structureCameraSources.ts','game/src/app/boot.ts','game/src/app/config.ts','game/src/systems/movement.ts','game/src/systems/navigation.ts','game/src/content/regions.ts','game/src/content/settlements/rootfall.ts','game/src/render/buildings.ts','game/src/render/rootfallNavigation.ts','game/src/render/structureNavigation.ts','game/src/world/rootfallStump.ts','game/src/featureLab/structures.ts','game/public/assets/models/corealm/nature/corealm_stump_oak.glb','game/public/assets/models/building/stairs_exterior.glb'];
const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report:any={passed:false,visualAccepted:false,sources,walk:[],shots:[]};
try{
 await driver.launch();await driver.open(28000,'/index.html');const page=driver.page!;
 report.renderer=await assertGameplayHardware(page);
 const hero:any=await driver.callDebug('getEntity',['rootfall_stump']);assert.equal(hero.view.assetId,'corealm_stump_oak');report.hero=hero;
 // Final authored Rootfall landmark. Only this initial terrain approach is a setup teleport.
 const x=60,z=120,base:number=await driver.callDebug('groundHeight',[x,z]);
 const yaw=ROOTFALL_STUMP.stairYaw,axis=[Math.sin(yaw),Math.cos(yaw)],startDistance=ROOTFALL_STUMP.stairFrontZ+4;
 const startX=x+axis[0]!*startDistance,startZ=z+axis[1]!*startDistance;
 const startY:number=await driver.callDebug('groundHeight',[startX,startZ]);
 report.setup={origin:[x,base,z],stairYaw:yaw,startDistance,terrainApproach:[startX,startY,startZ]};
 const along=(p:any)=>(p.x-x)*axis[0]!+(p.z-z)*axis[1]!;
 await driver.callDebug('teleport',[[startX,startY,startZ]]);
 await driver.callDebug('inspectPose',[{x:x+axis[0]!*startDistance,y:base+1,z:z+axis[1]!*startDistance,yaw,pitch:.45,distance:10,detached:false}]);

 const before:any=await driver.callDebug('getPlayer');report.before=before;
 for(let i=0;i<15;i++){
  await driver.press('w',450);const player:any=await driver.callDebug('getPlayer');report.walk.push(player);
  if(along(player.position)<=1.5)break;
 }
 const after=report.walk.at(-1);assert(along(after.position)<=2,'Player must climb beyond the stair crest');
 assert(after.position.y-base>2.7,'Player must stand on the actual elevated stump cut face');
 assert(Math.abs((after.position.x-x)*axis[1]!-(after.position.z-z)*axis[0]!)<.6,'Stair walk remains within tread width');
 report.shots.push(await driver.screenshot(out,'01-real-climb'));
 report.descent=[];
 for(let i=0;i<15;i++){
  await driver.press('s',450);const player:any=await driver.callDebug('getPlayer');report.descent.push(player);
  if(along(player.position)>=startDistance-.5)break;
 }
 const returned=report.descent.at(-1);
 assert(along(returned.position)>=startDistance-.5,'Player must descend past the stair foot');
 assert(Math.abs(returned.position.y-base)<.5,'Descent must return to plaza level');
 assert(report.descent.some((p:any)=>p.position.y-base>1&&p.position.y-base<2.7),'Descent must use intermediate stair heights');
 report.shots.push(await driver.screenshot(out,'02-real-descent'));
 report.bankMove=await driver.callDebug('callTool',['corealm_move_to',{entityId:'rootfall_bank_chest'}]);assert(!report.bankMove.error);
 await page.waitForFunction(()=>!(window as any).__gameDebug.getPlayer().moving,undefined,{timeout:12000});
 report.bankArrival=await driver.callDebug('getPlayer');
 report.bankAction=await driver.callDebug('callTool',['corealm_interact',{entityId:'rootfall_bank_chest',interaction:'bank'}]);assert(!report.bankAction.error);
 await page.locator('#panel-bank').waitFor({state:'visible',timeout:3000});
 assert(await page.locator('#panel-bank .bank-grid').count()>0);
 report.shots.push(await driver.screenshot(out,'03-bank-arrival'));
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.pageErrors=driver.pageErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.pageErrors,[]);
 for(const source of sources)assert.equal(createHash('sha256').update(await readFile(source.path)).digest('hex'),source.sha256,`Appearance source changed during capture: ${source.path}`);
 report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;if(driver.page)report.failureShot=await driver.screenshot(out,'failure');}
finally{await driver.close();clear();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}



