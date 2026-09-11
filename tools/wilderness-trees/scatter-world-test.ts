import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {SCATTER_STREAM_TILE_METRES} from '../../game/src/world/scatter.js';
import {GameDriver,FAST_TEST_SETTINGS} from '../lib/driver.js';
import {startGameServer} from '../lib/server.js';
import {installTestDeadline} from '../lib/deadline.js';
const software=process.argv.includes('--software');
const out=`test-results/wilderness-trees/solitary${software?'-software':''}`;await mkdir(out,{recursive:true});
const deadline=installTestDeadline('Solitary Wilderness timber',120000);
const server=await startGameServer(),driver=new GameDriver(server,{viewport:{width:1440,height:900},...(software?{settings:FAST_TEST_SETTINGS,browserArgs:['--enable-unsafe-swiftshader','--mute-audio']}:{browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']})});
const report:any={passed:false,placementPassed:false,software,samples:[]};
try{
 await driver.launch();const page=driver.page!;
 await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
 await driver.open(65000,'/index.html');
 for(const [x,z] of [[-140,545],[140,610],[-130,790],[130,895]] as const){
  await page.evaluate(({x,z})=>{const d=window.__gameDebug as any;d.inspectPose({x,z,y:d.groundHeight(x,z),yaw:0,pitch:.4,distance:11});},{x,z});
  await page.waitForTimeout(700);
  await page.waitForFunction(size=>{const d=window.__gameDebug as any,p=d.getPlayerPosition();return d.getScatterResidency().pending.every((id:string)=>{const [col,row]=id.split(':').map(Number);const dx=Math.max(col!*size-p.x,0,p.x-(col!+1)*size),dz=Math.max(row!*size-p.z,0,p.z-(row!+1)*size);return dx*dx+dz*dz>65*65;});},SCATTER_STREAM_TILE_METRES,{timeout:18000});
  await page.waitForTimeout(800);
  const trees=await page.evaluate(()=>{const d=window.__gameDebug as any;return d.getEntities().filter((e:any)=>e.id.includes(':wandering_timber:')).map((e:any)=>d.getEntity(e.id));});
  report.samples.push({x,z,trees,scatter:await driver.callDebug('getScatterStats')});
  const tree=trees.find((e:any)=>Math.hypot(e.position[0]-x,e.position[2]-z)<40);
  if(tree){
   await page.evaluate(p=>{const d=window.__gameDebug as any;d.inspectPose({x:p[0],z:p[2]+10,y:d.groundHeight(p[0],p[2]+10),yaw:0,pitch:.4,distance:11});},tree.position);
   await page.waitForTimeout(1000);
   assert.equal(tree.name,tree.tier===50?'Veinwood':'Magic Tree');assert(tree.interactions.includes('chop')&&tree.resource.remaining>0);
  }
  const before:any=await driver.callDebug('getPlayerPosition');await page.keyboard.down('d');await page.waitForTimeout(350);await page.keyboard.up('d');const after:any=await driver.callDebug('getPlayerPosition');
  assert(Math.hypot(after.x-before.x,after.z-before.z)>.2);
  report.samples.at(-1).movement={before,after};
  await page.screenshot({path:`${out}/${x}-${z}.png`,timeout:5000});
 }
 const trees=report.samples.flatMap((s:any)=>s.trees);assert(trees.some((t:any)=>t.tier===50)&&trees.some((t:any)=>t.tier===70));
 report.placementPassed=true;report.errors=await driver.callDebug('getErrors');assert.deepEqual(report.errors,[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{if(driver.page){report.finalScatter=await driver.callDebug('getScatterStats').catch(()=>null);await driver.page.screenshot({path:`${out}/final.png`,timeout:3000}).catch(()=>{});}report.consoleErrors=driver.consoleErrors;await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await driver.close();await server.close();deadline();}
console.log(JSON.stringify({passed:report.passed,placementPassed:report.placementPassed,samples:report.samples.map((s:any)=>({x:s.x,z:s.z,trees:s.trees.length})),failure:report.failure?.slice(0,200)}));
