import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
const out='test-results/wilderness-lab'; await mkdir(out,{recursive:true});
const server=await startGameServer();
const driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const evidence:any[]=[];
try {
 await driver.launch(); await driver.open(60000,'/index.html?mode=building&atmosphere=1&creatures=1');
 const page=driver.page!;
 const before=await page.evaluate(()=>window.__featureLab!.getState().structure);
 const castle=await page.evaluate(async()=> (await window.__featureLab!.setStructure({kind:'composition',id:'black_knight_castle',kit:'stone'})).structure);
 assert(castle.ready && castle.revision>before.revision && castle.partCount>300 && castle.collisionCount>30);
 evidence.push({before,castle});
 await page.getByLabel('Biome atmosphere',{exact:true}).selectOption('wilderness');
 await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
 await page.waitForFunction(()=>(window.__gameDebug as any).getBiomeAtmosphere().sky.night>.98,null,{timeout:8000});
 for (const [name,yaw,pitch,distance,z] of [['road',.15,.08,34,43],['court',.7,.27,30,17],['rear',3.55,.15,34,-21]] as const) {
  await page.evaluate(({yaw,pitch,distance,z})=>(window.__gameDebug as any).inspectPose({x:-8,y:10,z,yaw,pitch,distance,detached:true}),{yaw,pitch,distance,z});
  await page.waitForTimeout(200); await page.screenshot({path:`${out}/castle-${name}.png`});
 }
 const sky=await page.evaluate(()=>(window.__gameDebug as any).getBiomeAtmosphere()); evidence.push({sky});
 const path=await page.evaluate(()=>(window.__gameDebug as any).getNavPath([-8,0,41],[-8,0,20]));
 assert(path && path.length>=2,'Castle gate must connect the outside road and courtyard');
 await page.evaluate(()=>{window.__featureLab!.setWalkingEnabled(true);(window.__gameDebug as any).inspectPose({x:-8,y:0,z:41,yaw:0,pitch:.25,distance:12});});
 const entryBefore=await page.evaluate(()=>window.__featureLab!.getState());
 await page.keyboard.down('w');await page.waitForTimeout(3300);await page.keyboard.up('w');
 const entryAfter=await page.evaluate(()=>window.__featureLab!.getState());
 assert(entryAfter.playerPosition[2]<30,`Player failed to walk through gate: ${entryAfter.playerPosition}`);
 evidence.push({path,entryBefore,entryAfter});await page.screenshot({path:`${out}/castle-walked-through.png`});
 for (const id of ['wraith','skeleton_soldier','grave_ghoul','mossback_sentinel','shale_elemental','beetle_golem','lava_golem']) {
  await page.evaluate(async id=>{const g=(window as any).__creatureGallery;await g.show(`species:${id}`,1); const b=g.getBounds();const span=Math.max(...b.max.map((v:number,i:number)=>v-b.min[i]));(window.__gameDebug as any).inspectPose({x:(b.min[0]+b.max[0])/2,y:(b.min[1]+b.max[1])/2,z:(b.min[2]+b.max[2])/2,yaw:.65,pitch:.22,distance:span*1.8,detached:true});},id);
  await page.waitForTimeout(180);await page.screenshot({path:`${out}/${id}.png`});
  const motion=await page.evaluate(()=>{const g=(window as any).__creatureGallery;g.play('attack');return (window.__gameDebug as any).getEntityMotion(g.getState().entityIds[0]);});
  evidence.push({id,motion}); console.log(id);
 }
 const errors=await page.evaluate(()=>(window.__gameDebug as any).getErrors());assert.deepEqual(errors,[]);assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
 console.log('Wilderness lab renders and state checks passed.');
}finally{await writeFile(`${out}/report.json`,JSON.stringify(evidence,null,2));await driver.close();await server.close();}
