/** Paints the opaque shell emissive magenta behind the scanned facing, then counts magenta pixels in every cave view.
 * Any magenta pixel is a hole through the visible rock facing. PORT / CAVE_LAB_URL select the server; --version selects the candidate. */
import {assertPerformanceHardware} from '../../../tools/performanceHardware.js';
import {installAssetCandidates} from '../../../tools/lib/assetCandidates.js';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const version=process.argv[process.argv.indexOf('--version')+1]||'7';
const out=`test-results/finish-cave-source-v${version}/holes`;await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline('Cave hole check',60000);
const driver=new GameDriver({url:process.env.CAVE_LAB_URL??`http://127.0.0.1:${process.env.PORT??'4175'}`,close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,version,createdAt:new Date().toISOString(),views:[]};
try{
 await driver.launch();await installAssetCandidates(driver.page!,`art/rebuild/candidates/finish-cave-source/v${version}/catalog.json`);await driver.open(25000,'/index.html?mode=combat&cave=1&caveSource=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 const state:any=await page.evaluate(()=>(window as any).__caveLab.getState());assert(state.ready);assert(state.sourceFacing?.domainWarp);
 report.hardware=await assertPerformanceHardware(page);
 report.painted=await page.evaluate(()=>{const lab=(window as any).__caveLab;const names:string[]=[];
  // The apron is a legitimately visible bay floor merged into the wall mesh; only the wall faces and roof sit behind the facing.
  for(const mesh of lab.blockers){if(mesh.name==='dungeon-rock-facing')continue;const m=mesh.material;const paint=m.clone();paint.emissive.setRGB(1,0,1);paint.emissiveIntensity=1;paint.color.setRGB(1,0,1);paint.map=null;paint.normalMap=null;paint.roughnessMap=null;paint.vertexColors=false;paint.onBeforeCompile=()=>{};paint.customProgramCacheKey=()=>'cave-hole-paint';paint.needsUpdate=true;
   const wallVertices=mesh.geometry.userData.wallVertexCount;
   if(wallVertices){mesh.geometry.clearGroups();mesh.geometry.addGroup(0,wallVertices,0);mesh.geometry.addGroup(wallVertices,mesh.geometry.getAttribute('position').count-wallVertices,1);mesh.material=[paint,m];names.push(mesh.name+':wall-faces-only');}
   else{mesh.material=paint;names.push(mesh.name);}}
  return names;});
 await driver.callDebug('teleport',[state.origin]);
 const views:any[]=await page.evaluate(()=>(window as any).__caveLab.getViews());
 views.push({id:'wide-upper',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]-.8,yaw:0,pitch:-.14,distance:4.5,detached:true}});
 views.push({id:'wide-upper-reverse',inspectPose:{x:state.origin[0],y:state.origin[1]+3.5,z:state.origin[2]+.8,yaw:Math.PI,pitch:-.14,distance:4.5,detached:true}});
 views.push({id:'lower-up',inspectPose:{x:state.origin[0]+9,y:state.origin[1]-1.7+1.6,z:state.origin[2]-2,yaw:2.2,pitch:1.1,distance:3,detached:true}});
 views.push({id:'lower-across',inspectPose:{x:state.origin[0]+9,y:state.origin[1]-1.7+1.6,z:state.origin[2]-2,yaw:-1.2,pitch:.1,distance:3,detached:true}});
 for(const view of views){
  await driver.callDebug('inspectPose',[view.inspectPose]);await driver.wait(200);
  const file=await driver.screenshot(out,view.id);
  const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});
  let magenta=0;for(let i=0;i<data.length;i+=info.channels){const r=data[i]!,g=data[i+1]!,b=data[i+2]!;if(r>150&&b>150&&g<90)magenta++;}
  report.views.push({id:view.id,file,magentaPixels:magenta,fraction:magenta/(info.width*info.height)});
 }
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);report.passed=report.views.every((v:any)=>v.magentaPixels===0);
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,views:report.views.map((v:any)=>[v.id,v.magentaPixels])}));}
