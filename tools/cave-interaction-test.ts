import { chromium } from 'playwright';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dungeonFloorHeight, type DungeonSpec } from '../game/src/render/dungeon.js';
import { REGIONS } from '../game/src/content/regions.js';
import { startGameServer } from './lib/server.js';

const world = process.argv.includes('--world');
const directory = `test-results/cave-fix/${world ? 'world' : 'lab'}`;
await mkdir(directory, {recursive:true});
const server = await startGameServer();
const browser = await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors: string[] = [];
page.on('pageerror', e=>errors.push(e.message));
const report: Record<string, unknown> = {};
const deadline = setTimeout(()=>void browser.close(), 115_000);
async function screen(point: number[]) {
  const pose = await page.evaluate(()=>(window as any).__gameDebug.getCamera());
  const camera = new THREE.PerspectiveCamera(55,1440/900,0.1,1000);
  camera.position.set(pose.position.x,pose.position.y,pose.position.z);
  camera.lookAt(pose.target.x,pose.target.y,pose.target.z); camera.updateMatrixWorld();
  const projected = new THREE.Vector3(...point as [number,number,number]).project(camera);
  return [(projected.x+1)*720,(1-projected.y)*450] as const;
}
async function player() { return page.evaluate(()=>(window as any).__gameDebug.getPlayer()); }
try {
 await page.goto(`${server.url}/index.html${world ? '' : '?mode=combat&portal=1&caveSource=1&performance=1'}`);
 await page.waitForFunction(()=> (window as any).__gameDebug?.getState().ready,undefined,{timeout:60000});
 const entryId = world ? 'gravelmaw_mouth_portal' : 'lab:portal:entry';
 const entry = await page.evaluate(id=>(window as any).__gameDebug.getEntity(id),entryId);
 await page.evaluate(e=>{const d=(window as any).__gameDebug,s=e.interactionPosition,y=e.view.rotationY ?? 0;
   d.teleport([s[0]+Math.sin(y)*3,s[1],s[2]+Math.cos(y)*3]);
   d.inspectPose({x:e.position[0],y:e.position[1]+1,z:e.position[2],yaw:y,pitch:0.18,distance:15,detached:true});
 },entry);
 await page.waitForTimeout(500);
 report.before = await player();
 report.cold = await page.evaluate(()=>(window as any).__renderDistanceLab.caveState());
 const scale = entry.view.scale ?? 1, yaw = entry.view.rotationY ?? 0;
 const opening = [entry.position[0]-Math.sin(yaw)*0.3*scale,entry.position[1]+1.2*scale,entry.position[2]-Math.cos(yaw)*0.3*scale];
 const point = await screen(opening);
 report.entryClick = point;
 await page.screenshot({path:`${directory}/entrance.png`});
 // Hold the real cave download so even a fast local cache leaves time to inspect loading UI.
 let releaseDownload: (()=>void) | undefined;
 if (!world) {
   const download = new Promise<void>(resolve=>{releaseDownload=resolve;});
   await page.route('**/assets/models/cave/rock-face-01.glb',async route=>{await download;await route.continue();});
 }
 await page.evaluate(`(() => {
   window.__portalProgress=[];
   new MutationObserver(()=>{
     const curtain=document.querySelector('.portal-transition'),bar=curtain?.querySelector('progress');
     if (!bar) return;
     const rows=window.__portalProgress,last=rows[rows.length-1];
     if (!last || last.value!==bar.value) rows.push({value:bar.value,max:bar.max,text:curtain.innerText,
       drawable:window.__renderDistanceLab.caveState().drawable});
   }).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
 })()`);
 const start = Date.now();
 await page.mouse.click(...point);
 await page.getByRole('progressbar',{name:'Destination loading progress'}).waitFor({state:'visible',timeout:10000});
 if (!world) {
   await page.locator('.portal-transition[data-phase="loading"]').waitFor();
   assert.equal(await page.locator('.portal-transition progress').getAttribute('value'),'0');
   await page.screenshot({path:`${directory}/loading.png`});
   releaseDownload!();
 }
 await page.waitForFunction(()=> (window as any).__gameDebug.getState().regionId === 'gravelmaw' && !document.querySelector('.portal-transition'),undefined,{timeout:30000});
 const progress = await page.evaluate(()=>(window as any).__portalProgress);
 report.loadingProgress=progress;
 assert.deepEqual(progress.map((row:any)=>row.value),[0,1,2,3]);
 assert.equal(progress.at(-1).drawable,true,'progress must finish only when the cave can draw');
 report.entryMs = Date.now()-start;
 report.entered = await player();
 assert.equal((report.entered as any).regionId,'gravelmaw');
 assert.equal(await page.evaluate(()=>(window as any).__renderDistanceLab.caveState().ready),true);
 assert.equal(await page.evaluate(()=>(window as any).__renderDistanceLab.caveState().drawable),true,'curtain must cover shader-hidden cave meshes');
 assert.equal(await page.evaluate(()=>(window as any).__gameDebug.getState().clock.paused),false);
 await page.screenshot({path:`${directory}/entered.png`});
 // A nearby floor click must create underground movement, not a route to surface terrain.
 const before = await player();
 const p = before.position;
 await page.evaluate(()=>(window as any).__gameDebug.setPaused(true));
 await page.evaluate(p=> (window as any).__gameDebug.inspectPose({x:p.x,y:p.y+0.3,z:p.z,yaw:Math.PI/2,pitch:0.8,distance:5,detached:true}),p);
 await page.waitForTimeout(200);
 let floor: readonly [number,number] | undefined;
 for (const [dx,dz] of [[2,0],[-2,0],[0,-2],[0,2],[2,-2],[-2,-2]]) {
   const candidate = await screen([p.x+dx!,p.y,p.z+dz!]);
   await page.mouse.move(...candidate);await page.waitForTimeout(150);
   if (await page.evaluate(()=>(window as any).__gameDebug.getState().hoveredEntityId===null)) { floor=candidate;break; }
 }
 assert.ok(floor,'a clear patch of cave floor must be clickable');
 await page.mouse.click(...floor);
 assert.equal(await page.evaluate(()=>(window as any).__gameDebug.getState().selectedEntityId),null,'floor click must not select a portal or actor');
 await page.evaluate(()=>(window as any).__gameDebug.setPaused(false));
 await page.waitForTimeout(1000);
 await page.waitForFunction(()=>!(window as any).__gameDebug.getPlayer().moving);
 const after = await player();
 report.floorWalk = {before,after,click:floor};
 assert.ok(Math.hypot(after.position.x-p.x,after.position.z-p.z)>0.8,'floor click must move the player');
 assert.equal(after.regionId,'gravelmaw');
 const spec: DungeonSpec = world ? await (async () => {
   const dungeon = REGIONS.find(r=>r.dungeon)!.dungeon!;
   const base = await page.evaluate(p=>(window as any).__gameDebug.groundHeight(...p),dungeon.entrance);
   const chambers = dungeon.chambers.map(c=>({...c,centre:[...c.centre] as [number,number],floorY:base+c.floorOffset}));
   return {regionId:dungeon.id,wallHeight:13,chambers,corridors:chambers.slice(0,-1).map((c,i)=>({from:c.centre,to:chambers[i+1]!.centre,fromY:c.floorY,toY:chambers[i+1]!.floorY,width:6}))};
 })() : await page.evaluate(()=>(window as any).__caveLab.spec);
 const floorGap = (p:any)=>Math.abs(p.position.y-dungeonFloorHeight(spec,p.position.x,p.position.z));
 assert.ok(floorGap(after)<0.02,'click movement must remain grounded on cave floor');
 const keyboardBefore = after;
 await page.keyboard.down('s');await page.waitForTimeout(500);await page.keyboard.up('s');
 const keyboardAfter = await player();
 report.keyboardWalk = {before:keyboardBefore,after:keyboardAfter};
 assert.ok(Math.hypot(keyboardAfter.position.x-after.position.x,keyboardAfter.position.z-after.position.z)>0.25,'keyboard must move the player');
 assert.equal(keyboardAfter.regionId,'gravelmaw');
 assert.ok(keyboardAfter.position.x>after.position.x+0.25,'S must walk toward the camera on the east side');
 assert.ok(floorGap(keyboardAfter)<0.02,'keyboard movement must remain grounded on cave floor');
 await page.screenshot({path:`${directory}/walking.png`});
 const frames: number[] = await page.evaluate(`new Promise(resolve=>{
   const samples=[]; let last=performance.now();const end=last+2000;
   function frame(now){samples.push(now-last);last=now;if(now<end)requestAnimationFrame(frame);else resolve(samples)}requestAnimationFrame(frame);
 })`);
 frames.sort((a,b)=>a-b);
 report.frames = {median:frames[Math.floor(frames.length/2)],p95:frames[Math.floor(frames.length*.95)]};
 report.render = await page.evaluate(()=>(window as any).__gameDebug.getState().renderer);
 if (!world) {
   // The same dark recess must be clickable from inside, and cached re-entry must still unlock input.
   for (const id of ['lab:portal:exit',entryId]) {
     const e = await page.evaluate(id=>(window as any).__gameDebug.getEntity(id),id);
     await page.evaluate(e=>{const d=(window as any).__gameDebug,s=e.interactionPosition,y=e.view.rotationY ?? 0;
       d.teleport(s); d.inspectPose({x:e.position[0],y:e.position[1]+1,z:e.position[2],yaw:y,pitch:0.18,distance:6,detached:true});
     },e);
     await page.waitForTimeout(200);
     const s=e.view.scale ?? 1,y=e.view.rotationY ?? 0;
     await page.mouse.click(...await screen([e.position[0]-Math.sin(y)*0.3*s,e.position[1]+1.2*s,e.position[2]-Math.cos(y)*0.3*s]));
     const region = id===entryId ? 'gravelmaw' : 'fallowmarch';
     await page.waitForFunction(region=>(window as any).__gameDebug.getState().regionId===region && !document.querySelector('.portal-transition'),region,{timeout:10000});
     assert.equal(await page.evaluate(()=>(window as any).__gameDebug.getState().clock.paused),false);
   }
   report.roundTrip=true;
 }
 report.errors = errors;
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify(report,null,2));
} finally {
 clearTimeout(deadline);
 await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
 await browser.close();
 await server.close();
}
