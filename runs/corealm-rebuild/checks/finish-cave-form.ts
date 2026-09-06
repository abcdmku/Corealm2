import {assertPerformanceHardware} from '../../../tools/performanceHardware.js';
import {installAssetCandidates} from '../../../tools/lib/assetCandidates.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const version=process.argv[process.argv.indexOf('--version')+1]||'7';
const out=`test-results/finish-cave-source-v${version}`;await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline('Cave material review',45000);
const driver=new GameDriver({url:process.env.CAVE_LAB_URL??`http://127.0.0.1:${process.env.PORT??'4175'}`,close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const sourcePaths=['game/src/render/dungeon.ts','game/src/featureLab/cave.ts','game/src/render/corealmSurfaceMaterials.ts'];
const sources=await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const report:any={passed:false,visualAccepted:false,createdAt:new Date().toISOString(),sources,shots:[]};
try{
 await driver.launch();await installAssetCandidates(driver.page!,`art/rebuild/candidates/finish-cave-source/v${version}/catalog.json`);await driver.open(25000,'/index.html?mode=combat&cave=1&caveSource=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 const state:any=await page.evaluate(()=>(window as any).__caveLab.getState());assert(state.ready);assert(state.textured);assert.equal(state.meshCount,4);assert.equal(state.materialCount,3);assert(state.sourceFacing);assert(state.sourceFacing.continuousEnvelope);assert(state.sourceFacing.domainWarp);
 report.fixture=state;report.hardware=await assertPerformanceHardware(page);
 // The enclosed roof preserves at least 7 m of measured clearance below its 8 m crown.
 for(const probe of Object.values(state.probes) as any[]){assert(probe);assert(probe.headroom>=7);assert(Math.abs(probe.floorY-probe.sampledFloorY)<.4);}
 report.navPoint=await driver.callDebug('getNavPoint',[state.origin]);
 await driver.callDebug('teleport',[state.origin]);
 const player:any=await driver.callDebug('getPlayer');report.player=player;assert.equal(player.regionId,'gravelmaw');
 const views:any[]=await page.evaluate(()=>(window as any).__caveLab.getViews());
 views.push({id:'wide-upper',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]-.8,yaw:0,pitch:-.14,distance:4.5,detached:true}});
 views.push({id:'wide-upper-reverse',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]+.8,yaw:Math.PI,pitch:-.14,distance:4.5,detached:true}});
 // Lower, unlit chamber: its roof from below, its wall across the room and the climb back through the join.
 const lower=[state.origin[0]+9,state.origin[1]-1.7,state.origin[2]-2];
 // Positive pitch places the eye above the target. Roof views therefore aim at a mid-air target from a standing eye.
 views.push({id:'upper-roof-wide',inspectPose:{x:state.origin[0],y:state.origin[1]+5,z:state.origin[2],yaw:.6,pitch:-.9,distance:4,detached:true}});
 views.push({id:'lower-up',inspectPose:{x:lower[0],y:lower[1]+4.6,z:lower[2],yaw:2.2,pitch:-1.1,distance:3,detached:true}});
 views.push({id:'lower-across',inspectPose:{x:lower[0]+2,y:lower[1]+1.4,z:lower[2]-1,yaw:-1.1,pitch:.12,distance:3.5,detached:true}});
 views.push({id:'join-from-lower',inspectPose:{x:state.origin[0]+4.5,y:state.origin[1]-.8+1.3,z:state.origin[2]-1,yaw:1.35,pitch:.02,distance:5,detached:true}});
 views.push({id:'player-standing',inspectPose:{x:state.origin[0],y:state.origin[1]+1.1,z:state.origin[2],yaw:-2.4,pitch:.34,distance:6.5,detached:true}});
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
 report.renderProfile=await driver.callDebug('getRenderProfile',['dungeon']);report.timings=await driver.callDebug('getPerformanceTimings');
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.requests=driver.requestErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error}));}











