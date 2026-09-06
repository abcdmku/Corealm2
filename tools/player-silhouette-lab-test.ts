import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {GameDriver} from './lib/driver.js';
import {installTestDeadline} from './lib/deadline.js';
const world=process.argv.includes('--world');
const out=`test-results/player-silhouette/${world?'world':'lab'}`;
await mkdir(out,{recursive:true});
const deadline=installTestDeadline('player silhouette',world?119000:59000);
const driver=new GameDriver({url:'http://127.0.0.1:4174',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false};
async function shot(name:string){
 const path=await driver.screenshot(out,name);
 const {data,info}=await sharp(path).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let cyan=0;
 for(let y=250;y<700;y++)for(let x=550;x<900;x++){const i=(y*info.width+x)*info.channels;if(data[i+1]!>data[i]!+35&&data[i+2]!>data[i]!+35&&data[i+1]!>125)cyan++;}
 return {path,cyan,state:await driver.callDebug("getPlayerSilhouette") as any};
}
try{
 await driver.launch();await driver.open(world?60000:20000,world?'/index.html':'/index.html?mode=combat&environment=1');
 const page=driver.page!;
 if(!world)await page.evaluate(async()=> (window.__featureLab as any).setStructure({kind:'prefab',id:'gatehouse',kit:'stone',width:8,depth:4,seed:1}));
 const close=page.locator('#panel-feature-lab .panel__close');if(await close.isVisible())await close.click();
 const x=world?69:-11,z=world?140:8,y=await driver.callDebug('groundHeight',[x,z]) as number;
 await driver.callDebug('teleport',[[x,y,z]]);
 await driver.callDebug('inspectPose',[{x,y,z,yaw:0,pitch:0.25,distance:11,detached:false}]);
 await page.waitForTimeout(250);
 report.blockedPlayer=await driver.callDebug('getPlayer');
 report.blocked=await shot('01-blocked');
 assert(report.blocked.state.active && report.blocked.state.opacity <= 0.25,'Blocked player must produce visible silhouette pixels');
 await page.keyboard.down('a');
 await page.waitForFunction((limit)=>((window.__gameDebug as any).getPlayer().position.x < limit),x-1.7,{timeout:3000});
 await page.keyboard.up('a');
 await page.waitForTimeout(250);
 report.moving=await shot('02-moving');
 if(!world)assert(!report.moving.state.active,'Minor edge overlap must not show a silhouette');
 const p=(await driver.callDebug('getPlayer') as any).position;
 await driver.callDebug('inspectPose',[{x:p.x,y:p.y,z:p.z,yaw:world?0:Math.PI,pitch:world?1.2:0.7,distance:11,detached:false}]);
 await page.waitForTimeout(250);
 report.clear=await shot('03-clear');
 assert(!report.clear.state.active,'Unobstructed player must not glow from self occlusion');
 if(!world){
   await page.evaluate(async()=> (window as any).__environmentLab.showFoliage('corealm_oak_1',{count:1,layout:'lane',scale:2}));
   const treeY=await driver.callDebug('groundHeight',[0,22]) as number;
   await driver.callDebug('teleport',[[0,treeY,22]]);
   await driver.callDebug('inspectPose',[{x:0,y:treeY,z:22,yaw:0,pitch:0.35,distance:11,detached:false}]);
   await page.waitForTimeout(350);
   report.tree=await shot('04-tree-occlusion');
   assert(report.tree.state.active,'Rendered tree must activate the same overlay as walls');
   report.foliage=await driver.callDebug('getFoliageOcclusion');
 }
 report.camera=await driver.callDebug('getCamera');
 assert.equal(report.camera.distance,11);
 assert.deepEqual(await driver.callDebug('getErrors'),[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);
 report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();deadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}



