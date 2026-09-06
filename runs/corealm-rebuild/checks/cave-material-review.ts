import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const out='test-results/cave-material-review';await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline('Cave material review',45000);
const driver=new GameDriver({url:process.env.CAVE_LAB_URL??`http://127.0.0.1:${process.env.PORT??'4175'}`,close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,visualAccepted:false,shots:[]};
try{
 await driver.launch();await driver.open(25000,'/index.html?mode=combat&cave=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 const state:any=await page.evaluate(()=>(window as any).__caveLab.getState());assert(state.ready);assert(state.textured);assert.equal(state.meshCount,3);assert.equal(state.materialCount,2);
 report.fixture=state;
 // The authored corbel roof has 7.25 m minimum measured clearance, below its 8 m crown.
 for(const probe of Object.values(state.probes) as any[]){assert(probe);assert(probe.headroom>=7);assert(Math.abs(probe.floorY-probe.sampledFloorY)<.4);}
 report.navPoint=await driver.callDebug('getNavPoint',[state.origin]);
 await driver.callDebug('teleport',[state.origin]);
 const player:any=await driver.callDebug('getPlayer');report.player=player;assert.equal(player.regionId,'gravelmaw');
 const views:any[]=await page.evaluate(()=>(window as any).__caveLab.getViews());
 for(const view of views){
  assert(view.inspectPose,`${view.id} must have an inspection pose`);
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
