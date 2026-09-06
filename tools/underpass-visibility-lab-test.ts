import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import * as THREE from "three";
import { GameDriver } from "./lib/driver.js";
import { installTestDeadline } from "./lib/deadline.js";
import type { FeatureLabApi } from "../game/src/contracts.js";
const world = process.argv.includes("--world");
const out = `test-results/underpass-visibility/${world ? "world" : "lab"}`;
await mkdir(out, {recursive:true});
const clear = installTestDeadline("underpass visibility", world ? 119000 : 59000);
const driver = new GameDriver({url:"http://127.0.0.1:4174",close:async()=>{}}, {
 headless:true, viewport:{width:1440,height:900},
 browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"],
});
const report: Record<string, any> = {passed:false};
try {
 await driver.launch(); await driver.open(world ? 60000 : 20000,world ? "/index.html" : "/index.html?mode=combat");
 const page=driver.page!;
 if (!world) await page.evaluate(async()=> (window.__featureLab as FeatureLabApi).setStructure({kind:"prefab",id:"gatehouse",kit:"stone",width:8,depth:4,seed:1}));
 const close=page.locator("#panel-feature-lab .panel__close"); if(await close.isVisible()) await close.click();
 const x=world ? 72 : -8,z=world ? 149 : 17,y=await driver.callDebug("groundHeight",[x,z]) as number;
 if (!world) {
   await driver.callDebug("teleport",[[x,y,8]]);
   await driver.callDebug("inspectPose",[{x,y,z:8,yaw:0,pitch:0.55,distance:11,detached:false}]);
   await page.waitForFunction(()=>((window.__gameDebug as any).getRoofVisibility().hiddenEntityIds as string[]).some(id=>id.includes("#ceiling_")));
   report.cameraOnly=await driver.callDebug("getRoofVisibility");
   report.cameraOnlyShot=await driver.screenshot(out,"00-camera-obstruction-without-entry");
   await page.mouse.move(700,450);
   await page.mouse.down({button:"right"});
   await page.mouse.move(700,410,{steps:4});
   await page.mouse.up({button:"right"});
   report.manualCamera=await driver.callDebug("getCamera") as any;
   assert(Math.abs(report.manualCamera.pitch-0.55)>0.02,"Real drag must adjust pitch");
   assert(Math.abs(report.manualCamera.effectivePitch-report.manualCamera.pitch)<0.02,"Manual pitch must follow without delay");
 }
 await driver.callDebug("teleport",[[x,y,z]]);
 await driver.callDebug("inspectPose",[{x,y,z,yaw:0,pitch:0.55,distance:11,detached:false}]);
 report.before=await driver.callDebug("getPlayer");
 report.beforeShot=await driver.screenshot(out,"01-approach");
 const sampling=page.evaluate(async()=>{
   const states:unknown[]=[]; const start=performance.now();
   while(performance.now()-start<1450){states.push(window.__gameDebug!.getCamera()); await new Promise(r=>requestAnimationFrame(r));}
   return states;
 });
 await driver.press("w",1200);
 report.frames=await sampling;
 report.under=await driver.callDebug("getPlayer");
 assert(report.under.position.z < report.before.position.z-2,"keyboard must enter passage");
 for(const frame of report.frames){assert.equal(frame.effectiveYaw,0);assert.equal(frame.effectivePitch,0.55);assert.equal(frame.distance,11);}
 report.visibility=await driver.callDebug("getRoofVisibility") as any;
 const ids=(report.visibility as any).hiddenEntityIds as string[];
 assert(ids.some(id=>id.includes("#ceiling_")), "Passage ceiling must be removed");
 assert(ids.some(id=>/#h[fb]_/.test(id)), "Upper wall across the passage must be removed");
 assert(!ids.some(id=>/#p[fb]0_/.test(id)), "Ground-floor piers must remain visible");
 assert.equal((report.visibility as any).hiddenBuildingIds.length,1);
 report.underShot=await driver.screenshot(out,"02-underpass");
 const state=await driver.callDebug("getCamera") as any;
 const view=new THREE.PerspectiveCamera(55,1440/900,0.1,300);
 view.position.set(state.position.x,state.position.y,state.position.z);
 view.lookAt(state.target.x,state.target.y,state.target.z);view.updateMatrixWorld(true);
 const targetZ = world ? 140 : 8;
 const target=[x,await driver.callDebug("groundHeight",[x,targetZ]),targetZ] as number[];
 const projected=new THREE.Vector3(...target as [number,number,number]).project(view);
 report.click={x:(projected.x+1)*720,y:(1-projected.y)*450,target};
 await page.mouse.click(report.click.x,report.click.y);
 await page.waitForFunction((limit)=>{const p=window.__gameDebug!.getPlayer() as any;return p.position.z<limit;},targetZ+1,{timeout:5000});
 report.after=await driver.callDebug("getPlayer");
 report.afterShot=await driver.screenshot(out,"03-clicked-through");
 report.exitVisibility=await driver.callDebug("getRoofVisibility") as any;
 assert(report.exitVisibility.hiddenEntityIds.some((id:string)=>id.includes("#ceiling_")),
   "Ceiling must remain hidden after the player exits while the camera arm crosses it");
 if (world) {
   const streetY=await driver.callDebug("groundHeight",[60,127]) as number;
   await driver.callDebug("teleport",[[60,streetY,127]]);
   await driver.callDebug("inspectPose",[{x:60,y:streetY,z:127,yaw:0,pitch:0.55,distance:11,detached:false}]);
   report.streetBefore=await driver.callDebug("getPlayer");
   const streetSampling=page.evaluate(async()=>{
     const frames:any[]=[];const start=performance.now();
     while(performance.now()-start<4500){frames.push(window.__gameDebug!.getCamera());await new Promise(r=>requestAnimationFrame(r));}
     return frames;
   });
   await driver.press("w",2000);
   report.streetShot=await driver.screenshot(out,"05-town-running");
   await driver.press("d",2000);
   report.streetFrames=await streetSampling;
   report.streetAfter=await driver.callDebug("getPlayer");
   assert(Math.hypot(report.streetAfter.position.x-report.streetBefore.position.x,report.streetAfter.position.z-report.streetBefore.position.z)>2,"Town run must move the player");
   for(const frame of report.streetFrames){assert.equal(frame.distance,11);assert.equal(frame.effectivePitch,0.55);assert.equal(frame.effectiveYaw,0);}
   report.streetAfterShot=await driver.screenshot(out,"06-town-after-turn");
 }
 if (!world) {
   const exitSampling=page.evaluate(async()=>{
     const states:any[]=[]; const start=performance.now();
     while(performance.now()-start<4000){states.push({camera:window.__gameDebug!.getCamera(),visibility:(window.__gameDebug as any).getRoofVisibility()});await new Promise(r=>requestAnimationFrame(r));}
     return states;
   });
   await driver.press("w",2600);
   report.exitFrames=await exitSampling;
   assert(report.exitFrames.every((f:any)=>f.camera.effectiveYaw===0),"Restoration must not turn the camera");
   assert(report.exitFrames.every((f:any)=>f.camera.distance>10),"Exiting and restoring the building must not push the camera in");
   report.restored=await driver.callDebug("getRoofVisibility") as any;
   assert.equal(report.restored.hiddenBuildingIds.length,0,"Building must restore after camera clearance");
   report.restoredShot=await driver.screenshot(out,"04-restored-after-clearance");
 }
 report.errors=await driver.callDebug("getErrors");
 assert.deepEqual(report.errors,[]);assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);
 report.passed=true;
} catch(error){report.error=String(error);process.exitCode=1;if(driver.page)await driver.screenshot(out,"failure").catch(()=>{});}
finally{await driver.close();clear();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
