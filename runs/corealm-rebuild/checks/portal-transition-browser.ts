import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {PerspectiveCamera,Vector3} from 'three';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
import {CAMERA} from '../../../game/src/app/config.js';
const out='test-results/portal-transition-browser';await mkdir(out,{recursive:true});
const deadline=installTestDeadline('Portal transition browser',55000);
const driver=new GameDriver({url:process.env.COREALM_URL ?? 'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,shots:[]};
try{
 await driver.launch();await driver.open(24000,'/index.html?mode=combat&portal=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 const fixture:any=await page.evaluate(()=>(window as any).__portalLab);assert(fixture);report.fixture=fixture;
 const entry=fixture.entities[0],stance=entry.interactionPosition;
 await driver.callDebug('teleport',[[stance[0],stance[1],stance[2]+8]]);
 await driver.callDebug('inspectPose',[{x:18,y:.8,z:10,yaw:0,pitch:.34,distance:20,detached:true}]);await driver.wait(200);
 await page.evaluate(`(() => {
  window.__portalTrace=[];window.__portalTraceActive=true;
  const sample=()=>{if(!window.__portalTraceActive)return;const d=window.__gameDebug,c=document.querySelector('.portal-transition');
   window.__portalTrace.push({at:performance.now(),player:d.getPlayer(),phase:c?.dataset.phase??null,opacity:c?Number(getComputedStyle(c).opacity):0,clock:d.getState().clock});
   requestAnimationFrame(sample);};requestAnimationFrame(sample);
 })()`);
 async function clickArch(id:string){
  const b:any=await driver.callDebug('getDrawnBounds',[id]);assert(b);
  const c:any=await driver.callDebug('getCamera');
  const camera=new PerspectiveCamera(CAMERA.fov,1440/900,.1,1500);camera.position.set(c.position.x,c.position.y,c.position.z);camera.lookAt(c.target.x,c.target.y,c.target.z);camera.updateMatrixWorld();
  const p=new Vector3(b.min.x+(b.max.x-b.min.x)*.12,b.min.y+(b.max.y-b.min.y)*.32,b.max.z).project(camera);
  const x=(p.x*.5+.5)*1440,y=(-p.y*.5+.5)*900;assert(x>0&&x<1440&&y>0&&y<900);report.clicks??=[];report.clicks.push({id,x,y,b,c});
  await page.mouse.click(x,y);
 }
 report.before=await driver.callDebug('getPlayer');report.shots.push(await driver.screenshot(out,'01-approach'));
 await clickArch(entry.id);
 await page.waitForFunction(()=>(window as any).__gameDebug.getPlayer().regionId==='gravelmaw',null,{timeout:16000});
 await page.waitForFunction(()=>!document.querySelector('.portal-transition'),null,{timeout:6000});
 report.inside=await driver.callDebug('getPlayer');report.shots.push(await driver.screenshot(out,'02-inside'));
 const trace:any[]=await page.evaluate(`(() => {window.__portalTraceActive=false;return window.__portalTrace;})()`);report.trace=trace;
 assert(trace.some(r=>r.phase==='closing'&&r.player.regionId==='fallowmarch'));
 const firstInside=trace.find(r=>r.player.regionId==='gravelmaw');assert(firstInside);assert(firstInside.opacity>=.99,'Placement must occur behind a fully opaque fade');
 const closing=trace.find(r=>r.phase==='closing');assert(closing);assert(Math.hypot(closing.player.position.x-stance[0],closing.player.position.z-stance[2])<=.45,'Walk must reach the front approach before fade');
 assert(Math.hypot(report.before.position.x-closing.player.position.x,report.before.position.z-closing.player.position.z)>7,'Click must perform the real approach walk');
 assert.equal(report.inside.regionId,'gravelmaw');assert(Math.abs(report.inside.position.y+12)<.3);
 await driver.callDebug('inspectPose',[{x:-36,y:-11.4,z:-39,yaw:0,pitch:.25,distance:5.5,detached:true}]);await driver.wait(150);
 await clickArch(fixture.exitId);
 await page.waitForFunction(()=>(window as any).__gameDebug.getPlayer().regionId==='fallowmarch',null,{timeout:9000});
 await page.waitForFunction(()=>!document.querySelector('.portal-transition'),null,{timeout:6000});
 report.returned=await driver.callDebug('getPlayer');report.shots.push(await driver.screenshot(out,'03-returned'));
 assert(Math.hypot(report.returned.position.x-stance[0],report.returned.position.z-stance[2])<.4);
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.requests=driver.requestErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();deadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error}));}
