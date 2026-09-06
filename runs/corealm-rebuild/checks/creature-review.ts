import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {GameDriver} from '../../../tools/lib/driver.js';
import {CREATURE_EXPANSION} from '../../../game/src/content/creatureExpansion.js';
const out='test-results/creature-review';await mkdir(out,{recursive:true});
const driver=new GameDriver({url:process.env.COREALM_URL ?? 'http://127.0.0.1:4175',close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const selected=process.argv.slice(2), species=CREATURE_EXPANSION.filter(s=>!selected.length||selected.includes(s.id));
const report:any={passed:false,actors:[]};
try{
 await driver.launch();await driver.open(20000,'/index.html?mode=combat&creatures=1');const page=driver.page!;
 await page.locator('#panel-feature-lab .panel__close').click();
 for(const speciesDef of species){
  const id=speciesDef.id,preset=`species:${id}`;
  await page.evaluate(p=>(window as any).__creatureGallery.show(p,1),preset);
  await driver.callDebug('inspectPose',[{x:0,y:1,z:70,yaw:.88,pitch:.13,distance:8,detached:true}]);
  await driver.wait(300);
  const bounds:any=await page.evaluate(()=>(window as any).__creatureGallery.getBounds());assert(bounds);
  const width=Math.max(bounds.max[0]-bounds.min[0],bounds.max[2]-bounds.min[2]);
  const height=bounds.max[1]-bounds.min[1],distance=Math.max(2.4,width*1.9,height*2.5);
  const pose={x:(bounds.max[0]+bounds.min[0])/2,y:(bounds.max[1]+bounds.min[1])/2,z:(bounds.max[2]+bounds.min[2])/2,yaw:.88,pitch:.13,distance,detached:true};
  await driver.callDebug('inspectPose',[pose]);await driver.wait(160);
  await driver.screenshot(out,`${id}-idle`);
  const entityId=`lab:creatures:${preset}:1`;
  const actor:any={id,bounds,pose,states:[]};
  for(const motion of ['walk','attack','hit']){
   await page.evaluate(m=>(window as any).__creatureGallery.play(m),motion);
   await driver.wait(motion==='walk'?200:100);
   const sample:any=await driver.callDebug('getEntityMotion',[entityId]);
   assert.equal(sample.motion,motion);assert(sample.clip);assert(sample.duration>0);
   actor.states.push(sample);
   if(motion!=='walk')await driver.screenshot(out,`${id}-${motion}`);
  }
  report.actors.push(actor);console.log(JSON.stringify({id,meshesReady:true,motions:actor.states.map((s:any)=>s.clip)}));
 }
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.page=driver.pageErrors;report.requests=driver.requestErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.page,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
for(let start=0;start<report.actors.length;start+=6){
 const group=report.actors.slice(start,start+6),images=[];
 for(let index=0;index<group.length;index++){
  const id=group[index].id;
  const cropped=await sharp(await readFile(`${out}/${id}-idle.png`)).extract({left:325,top:90,width:1000,height:690}).resize(600,414).toBuffer();
  const label=Buffer.from(`<svg width="600" height="36"><rect width="600" height="36" fill="#172027"/><text x="12" y="25" fill="white" font-family="Arial" font-size="20">${id}</text></svg>`);
  images.push({input:cropped,left:(index%2)*600,top:Math.floor(index/2)*450+36},{input:label,left:(index%2)*600,top:Math.floor(index/2)*450});
 }
 await sharp({create:{width:1200,height:Math.ceil(group.length/2)*450,channels:4,background:'#172027'}}).composite(images).png().toFile(`${out}/sheet-${Math.floor(start/6)+1}.png`);
}
console.log(JSON.stringify({passed:report.passed,count:report.actors.length,error:report.error}));
