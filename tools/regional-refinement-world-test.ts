import * as THREE from 'three';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {REGIONAL_VARIANT_GROUPS,AMETHYST_CAVE_GROUP} from '../game/src/content/regionalVariantHabitats.js';
const server=await startGameServer();const driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out='test-results/regional-refinement';await mkdir(out,{recursive:true});const evidence:any[]=[];
const started=Date.now();
const caveOnly=process.argv.includes('--cave-only');
try{
 await driver.launch();await driver.open(60000);const page=driver.page!;
 if(!caveOnly){
 for(const group of [...REGIONAL_VARIANT_GROUPS,AMETHYST_CAVE_GROUP]){
  const result=await page.evaluate(group=>{const d=window.__gameDebug as any;
   const actors=d.getEntities().filter((e:any)=>e.id===group.id||e.id.startsWith(group.id+'_')).map((e:any)=>d.getEntity(e.id));
   if(!group.id.startsWith('gravelmaw'))d.inspectPose({x:group.centre[0],y:d.groundHeight(...group.centre),z:group.centre[1]+10,yaw:1.2,pitch:.38,distance:20});
   return {actors,samples:actors.map((a:any)=>d.sampleWorld(a.position[0],a.position[2])),paths:actors.slice(1).map((a:any)=>d.getNavPath(actors[0].position,a.position)),sky:d.getBiomeAtmosphere()};
  },group);
  evidence.push({id:group.id,...result});assert.equal(result.actors.length,group.count,group.id);
  if(!group.id.startsWith('gravelmaw')){
   for(const s of result.samples)assert(s.playable&&!s.waterBodyId,`${group.id} dry ground`);
   for(const [index,path] of result.paths.entries()){assert(path?.length,`${group.id} path`);const end=path.at(-1),target=result.actors[index+1].position;assert(Math.hypot(end.x-target[0],end.z-target[2])<1,`${group.id} complete route`);}
   await page.waitForTimeout(150);
   await page.waitForFunction(ids=>{const d=window.__gameDebug as any;
    const resident=new Set(d.getEntityViewStats().residency.residentIds),shaders=(window as any).__renderDistanceLab.shaders();
    return !shaders.waiting&&!shaders.queued&&!shaders.compiling&&ids.every((id:string)=>resident.has(id)&&d.getDrawnBounds(id));
   },result.actors.map((actor:any)=>actor.id),{timeout:35000});
   await page.screenshot({path:`${out}/world-${group.id}.png`});
  }
  console.log('world placement',group.id);
 }
 await page.keyboard.press('m');
 for(const region of ['fallowmarch','vellenwood','karrowmoor','kilnhalt','gravelmaw']){
  const before=await page.locator('.map__figure').evaluate(el=>[el.getAttribute('data-map-centre-u'),el.getAttribute('data-map-centre-v')].join(','));
  await page.getByLabel('Map region',{exact:true}).selectOption(region);await page.waitForTimeout(300);
  const after=await page.locator('.map__figure').evaluate(el=>[el.getAttribute('data-map-centre-u'),el.getAttribute('data-map-centre-v')].join(','));assert.notEqual(before,after,region);
  await page.screenshot({path:`${out}/map-${region}.png`});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);
 const panelBounds=await page.locator('#panel-map').boundingBox();assert(panelBounds&&panelBounds.width<=390,'mobile map fits');await page.screenshot({path:`${out}/map-mobile.png`});
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Close Map',exact:true}).click();
 }
 const entry=await page.evaluate(()=>(window.__gameDebug as any).getEntity('gravelmaw_mouth_portal'));
 await page.evaluate(e=>{const d=window.__gameDebug as any,s=e.interactionPosition,y=e.view.rotationY??0;d.teleport([s[0]+Math.sin(y)*3,s[1],s[2]+Math.cos(y)*3]);d.inspectPose({x:e.position[0],y:e.position[1]+1,z:e.position[2],yaw:y,pitch:.18,distance:15,detached:true});},entry);
 await page.waitForTimeout(500);
 const pose=await page.evaluate(()=>(window.__gameDebug as any).getCamera());
 const camera=new THREE.PerspectiveCamera(55,1440/900,.1,1000);camera.position.set(pose.position.x,pose.position.y,pose.position.z);camera.lookAt(pose.target.x,pose.target.y,pose.target.z);camera.updateMatrixWorld();
 const scale=entry.view.scale??1,yaw=entry.view.rotationY??0;
 const projected=new THREE.Vector3(entry.position[0]-Math.sin(yaw)*.3*scale,entry.position[1]+1.2*scale,entry.position[2]-Math.cos(yaw)*.3*scale).project(camera);
 await page.mouse.click((projected.x+1)*720,(1-projected.y)*450);
 await page.waitForFunction(()=>(window.__gameDebug as any).getState().regionId==='gravelmaw'&&!document.querySelector('.portal-transition'),undefined,{timeout:30000});
 const cave=await page.evaluate(()=>{const d=window.__gameDebug as any;const actors=d.getEntities().filter((a:any)=>a.id.startsWith('gravelmaw_amethyst_spiders')).map((a:any)=>d.getEntity(a.id));d.inspectPose({x:35,y:actors[0].position[1],z:-42,yaw:1.1,pitch:.42,distance:12,detached:true});return {actors,paths:actors.slice(1).map((a:any)=>d.getNavPath(actors[0].position,a.position)),state:d.getState()};});
 assert.equal(cave.actors.length,AMETHYST_CAVE_GROUP.count,'cave resident count');
 assert(cave.actors.every((actor:any)=>actor.view.assetId==='creature_blind_cave_weaver'),'cave uses accepted replacement bodies');
 for(const path of cave.paths)assert(path?.length,'cave spider path');evidence.push({cave});
 await page.waitForTimeout(800);await page.screenshot({path:`${out}/world-amethyst-cave.png`});
 assert.deepEqual(await page.evaluate(()=>(window.__gameDebug as any).getErrors()),[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);
 assert(Date.now()-started<120000,'regional/cave world smoke budget');
 console.log(`world passed in ${((Date.now()-started)/1000).toFixed(1)}s`);
}finally{await writeFile(`${out}/world.json`,JSON.stringify(evidence,null,2));await driver.close();await server.close();}
