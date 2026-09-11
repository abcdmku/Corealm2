import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {REGIONAL_CREATURE_VARIANTS} from '../game/src/content/regionalCreatureVariants.js';
const server=await startGameServer();
const driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out='test-results/regional-refinement';await mkdir(out,{recursive:true});const evidence:any[]=[];
try {
 await driver.launch();await driver.open(60000,'/index.html?mode=combat&atmosphere=1');const page=driver.page!;
 await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
 await page.keyboard.press('m');
 for(const region of ['fallowmarch','vellenwood','karrowmoor','kilnhalt','gravelmaw']) {
  await page.getByLabel('Map region',{exact:true}).selectOption(region);
  await page.waitForTimeout(200);
  const state=await page.locator('.map__figure').evaluate(el=>({...((el as HTMLElement).dataset)}));
  evidence.push({mapRegion:region,state});
 }
 await page.screenshot({path:`${out}/map-lab.png`});await page.getByRole('button',{name:'Close Map',exact:true}).click();await page.keyboard.press('l');
 for(const species of REGIONAL_CREATURE_VARIANTS){
  await page.getByLabel('Biome atmosphere',{exact:true}).selectOption(species.regionId);
  await page.evaluate(async id=>{const lab=window.__featureLab!;await lab.perform('reset-player');lab.setLevel('melee',10);await lab.spawnTarget('creature',`species:${id}`,{distance:3});(window.__gameDebug as any).inspectPose({x:0,y:0,z:0,yaw:1.3,pitch:.23,distance:10});},species.id);
  await page.waitForTimeout(1400);
  const before=await page.evaluate(()=>window.__featureLab!.getState());
  await page.screenshot({path:`${out}/${species.id}.png`});
  await page.getByRole('button',{name:'Attack spawned creature',exact:true}).click();
  await page.waitForFunction(hp=>(window.__featureLab!.getState().target?.health??hp)<hp,before.target!.health!,{timeout:20000});
  const after=await page.evaluate(()=>window.__featureLab!.getState());
  evidence.push({id:species.id,before,after,sky:await page.evaluate(()=>(window.__gameDebug as any).getBiomeAtmosphere())});
  assert(after.target!.health!<before.target!.health!);console.log('accepted combat',species.id);
 }
 const errors=await page.evaluate(()=>(window.__gameDebug as any).getErrors());assert.deepEqual(errors,[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);
 console.log('lab passed');
}finally{await writeFile(`${out}/lab.json`,JSON.stringify(evidence,null,2));await driver.close();await server.close();}
