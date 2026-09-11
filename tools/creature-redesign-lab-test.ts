import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {installAssetCandidates} from './lib/assetCandidates.js';
const out='test-results/creature-redesign';await mkdir(out,{recursive:true});
const server=await startGameServer(),driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const evidence:any[]=[];
try{await driver.launch();const page=driver.page!;await installAssetCandidates(page,`${out}/catalog.json`);
 await driver.open(60000,'/index.html?mode=combat&creatures=1&atmosphere=1');
 await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
 for(const id of ['chalk_warden','hollow_bough','pallid_shade']){
  await page.getByLabel('Biome atmosphere',{exact:true}).selectOption(id==='chalk_warden'?'karrowmoor':'wilderness');
  await page.evaluate(async id=>{const g=(window as any).__creatureGallery;await g.show(`candidate:${id}`,1);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=g.getBounds();const s=Math.max(...b.max.map((v:number,i:number)=>v-b.min[i]));(window.__gameDebug as any).inspectPose({x:(b.min[0]+b.max[0])/2,y:(b.min[1]+b.max[1])/2,z:(b.min[2]+b.max[2])/2,yaw:-.35,pitch:.18,distance:s*1.7,detached:true});},id);
  await page.waitForTimeout(1500);
  await page.evaluate(id=>{const g=(window as any).__creatureGallery;const b=g.getBounds();(window.__gameDebug as any).inspectPose({x:0,y:(b.min[1]+b.max[1])/2,z:70,yaw:-.35,pitch:.18,distance:id==='chalk_warden'?6.5:id==='hollow_bough'?8:5.5,detached:true});},id);
  for(const motion of ['idle','walk','run','attack','hit']){
   await page.locator(`#creature-gallery-${motion}`).click();
   await page.waitForTimeout(180);
   const before=await page.evaluate(()=>{const g=(window as any).__creatureGallery;return {state:g.getState(),bounds:g.getBounds(),motion:(window.__gameDebug as any).getEntityMotion(g.getState().entityIds[0])};});
   await page.screenshot({path:`${out}/${id}-${motion}.png`});
   await page.waitForTimeout(160);
   const after=await page.evaluate(()=>{const g=(window as any).__creatureGallery;return (window.__gameDebug as any).getEntityMotion(g.getState().entityIds[0]);});
   assert(before.state.ready && before.bounds && before.motion);assert(after?.clip);
   evidence.push({id,motion,before,after});
  }
  await page.evaluate(async id=>{const lab=window.__featureLab!;await lab.perform('reset-player');lab.setFreeCameraEnabled(false);lab.setLevel('melee',40);await lab.spawnTarget('creature',`candidate:${id}`,{distance:3});},id);
  await page.keyboard.press('l');
  const combatBefore=await page.evaluate(()=>window.__featureLab!.getState());
  await page.getByRole('button',{name:'Attack spawned creature',exact:true}).click();
  await page.waitForFunction(hp=>(window.__featureLab!.getState().target?.health??hp)<hp,combatBefore.target!.health!,{timeout:8000});
  const combatAfter=await page.evaluate(()=>window.__featureLab!.getState());evidence.push({id,combatBefore,combatAfter});
  await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
  console.log(id);
 }
 assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(await page.evaluate(()=>(window.__gameDebug as any).getErrors()),[]);
}finally{await writeFile(`${out}/lab.json`,JSON.stringify(evidence,null,2));await driver.close();await server.close();}
