import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const ids=process.argv.slice(2).length?process.argv.slice(2):['cairn_bighorn','bracken_tapir','duskoak_lynx'];
const output=process.env.CANDIDATE_OUTPUT??'test-results/finish-quadrupeds-v6';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],records=[];
page.on('pageerror',e=>errors.push(e.message));
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')),candidates=new Map();
for(const id of ids){
 const candidate=JSON.parse(await readFile(`test-results/creature-expansion/${id}.json`,'utf8'));
 candidates.set(id,candidate);
 manifest.assets=manifest.assets.map(a=>a.id===candidate.id?candidate:a);
 await page.route(`**/models/creature/creature_${id}.glb`,route=>route.fulfill({path:path.resolve(`test-results/creature-expansion/models/creature_${id}.glb`),contentType:'model/gltf-binary'}));
}
await page.route('**/assets/manifest.json',route=>route.fulfill({body:JSON.stringify(manifest),contentType:'application/json'}));
await page.goto((process.env.LAB_URL??'http://127.0.0.1:4175/')+'?mode=combat&creatures=1',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__creatureGallery?.getState().ready,{timeout:60000});
const renderer=await page.evaluate(()=>{const canvas=document.querySelector('canvas');const gl=canvas?.getContext('webgl2');if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
if(!renderer||/swiftshader|software|llvmpipe/i.test(renderer))throw Error(`Hardware renderer required, got ${renderer}`);
for(const id of ids){
 const preset=await page.evaluate(id=>window.__creatureGallery.getCatalog().find(p=>p.assetId===`creature_${id}`||p.id===id||p.id.startsWith(id+'_'))?.id,id);
 if(!preset)throw Error(`Missing preset ${id}`);
 await page.evaluate(preset=>window.__creatureGallery.show(preset,1),preset);
 await page.waitForFunction(preset=>document.querySelector('#creature-gallery-preset')?.value===preset,preset);
 await page.locator('#creature-gallery-frame').click();
 await page.waitForTimeout(250);
 records.push({id,assetMetadata:candidates.get(id),...await page.evaluate(()=>({state:window.__creatureGallery.getState(),bounds:window.__creatureGallery.getBounds()}))});
 await page.screenshot({path:`${output}/${id}-production-idle.png`});
 await page.evaluate(()=>{const b=window.__creatureGallery.getBounds(),size=Math.max(...b.max.map((v,i)=>v-b.min[i]));window.__gameDebug.inspectPose({x:(b.min[0]+b.max[0])/2,y:(b.min[1]+b.max[1])/2,z:(b.min[2]+b.max[2])/2,yaw:Math.PI/2,pitch:.16,distance:Math.max(2.8,size*1.45),detached:true});});
 await page.waitForTimeout(180);
 await page.screenshot({path:`${output}/${id}-production-side.png`});
 await page.evaluate(()=>window.__creatureGallery.play('run'));
 await page.waitForTimeout(180);
 await page.screenshot({path:`${output}/${id}-production-run.png`});
 if(process.env.CANDIDATE_EXTENDED==='1')for(const [view,yaw,motion]of [['front',0,'idle'],['rear',Math.PI,'idle'],['walk',Math.PI/2,'walk'],['attack',Math.PI/2,'attack'],['hit',Math.PI/2,'hit']]){
  await page.evaluate(({yaw,motion})=>{window.__creatureGallery.play(motion);const b=window.__creatureGallery.getBounds(),size=Math.max(...b.max.map((v,i)=>v-b.min[i]));window.__gameDebug.inspectPose({x:(b.min[0]+b.max[0])/2,y:(b.min[1]+b.max[1])/2,z:(b.min[2]+b.max[2])/2,yaw,pitch:.16,distance:Math.max(2.8,size*1.45),detached:true});},{yaw,motion});
  await page.waitForTimeout(motion==='attack'?420:180);
  await page.screenshot({path:`${output}/${id}-production-${view}.png`});
 }

}

await writeFile(`${output}/gallery.json`,JSON.stringify({records,errors,renderer,scope:'Fresh GLBs intercepted into the production asset loader and creature gallery. Stationary animation review only; natural AI motion remains unproven.'},null,2));
console.log(JSON.stringify({records,errors,output}));
}finally{await browser.close();}


