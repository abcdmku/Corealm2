import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const out='test-results/finish-cave-relief-v3';await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline('Cave material review',45000);
const driver=new GameDriver({url:process.env.COREALM_URL ?? 'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const sourcePaths=['game/src/render/dungeon.ts','game/src/featureLab/cave.ts','game/src/render/corealmSurfaceMaterials.ts'];
const sources=await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report:any={passed:false,visualAccepted:false,createdAt:new Date().toISOString(),sources,shots:[]};
try{
 await driver.launch();await driver.open(25000,'/index.html?mode=combat&cave=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 const state:any=await page.evaluate(()=>(window as any).__caveLab.getState());assert(state.ready);assert(state.textured);assert.equal(state.meshCount,3);assert.equal(state.materialCount,2);
 report.fixture=state;
 // The enclosed roof preserves at least 7 m of measured clearance below its 8 m crown.
 for(const probe of Object.values(state.probes) as any[]){assert(probe);assert(probe.headroom>=7);assert(Math.abs(probe.floorY-probe.sampledFloorY)<.4);}
 report.navPoint=await driver.callDebug('getNavPoint',[state.origin]);
 await driver.callDebug('teleport',[state.origin]);
 const player:any=await driver.callDebug('getPlayer');report.player=player;assert.equal(player.regionId,'gravelmaw');
 const views:any[]=await page.evaluate(()=>(window as any).__caveLab.getViews());
 views.push({id:'wide-upper',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]-.8,yaw:0,pitch:-.14,distance:4.5,detached:true}});
 views.push({id:'wide-upper-reverse',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]+.8,yaw:Math.PI,pitch:-.14,distance:4.5,detached:true}});
 for(const view of views){
  assert(view.inspectPose,`${view.id} must have an inspection pose`);
  if(!view.eye){const p=view.inspectPose;view.eye=[p.x+Math.sin(p.yaw)*Math.cos(p.pitch)*p.distance,p.y-.1+Math.sin(p.pitch)*p.distance,p.z+Math.cos(p.yaw)*Math.cos(p.pitch)*p.distance];}
  await driver.callDebug('inspectPose',[view.inspectPose]);await driver.wait(180);
  const camera:any=await driver.callDebug('getCamera');
  assert(Math.hypot(camera.position.x-view.eye[0],camera.position.y-view.eye[1],camera.position.z-view.eye[2])<.16,`${view.id} camera must match authored inspection eye`);
  report.shots.push({view,camera,state:await page.evaluate(()=>(window as any).__caveLab.getState()),file:await driver.screenshot(out,view.id)});
 }
 await page.evaluate(()=>(window as any).__featureLab.setFreeCameraEnabled(false));
 const camera:any=await driver.callDebug('getCamera');assert(camera.pitch>=.18,'Returning to play restores camera pitch range');
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.requests=driver.requestErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error}));}
