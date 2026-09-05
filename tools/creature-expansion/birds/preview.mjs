import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const server=createServer(async(req,res)=>{try{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));const bytes=await readFile(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1500,height:800}});page.on('pageerror',e=>console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/creature-expansion/birds/preview.html`);await page.waitForFunction(()=>window.birdPreview?.ready);
  const out=path.join(root,'test-results/creature-expansion/birds');await mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,'diagnostic.png')});
  for (const id of ['blackwater_heron','scree_bustard','marchfield_turkey']) {
    await page.evaluate(id=>{const p=window.birdPreview;for(const b of p.subjects){b.object.visible=b.object.userData.species===id;b.object.position.x=0;}const heron=id==='blackwater_heron';p.camera.position.set(heron?2.5:1.75,heron?1.55:1.17,heron?3.1:2.25);p.camera.lookAt(0,heron?.85:.56,0);p.render();},id);
    await page.screenshot({path:path.join(out,`${id}-detail.png`)});
  }
  for(const [name,pose] of [['front',[0,1.12,3.0]],['three-quarter',[1.8,1.17,2.3]],['side',[3.0,1.05,.05]]]){
    await page.evaluate(pose=>{const p=window.birdPreview;for(const b of p.subjects){b.object.visible=b.object.userData.species==='marchfield_turkey';b.object.position.x=0;b.object.rotation.y=0;}p.camera.position.set(...pose);p.camera.lookAt(0,.56,0);p.render();},pose);
    await page.screenshot({path:path.join(out,`turkey-flow-${name}.png`)});
  }
  for(const id of ['blackwater_heron','scree_bustard'])for(const name of ['front','three-quarter']){
    await page.evaluate(([id,name])=>{const p=window.birdPreview;for(const b of p.subjects){b.object.visible=b.object.userData.species===id;b.object.position.x=0;b.object.rotation.y=0;}const heron=id==='blackwater_heron';p.camera.position.set(name==='front'?0:heron?2.4:1.8,heron?1.5:1.25,heron?3.7:3.0);p.camera.lookAt(0,heron?.86:.6,0);p.render();},[id,name]);
    await page.screenshot({path:path.join(out,`${id}-flow-${name}.png`)});
  }
  await page.evaluate(()=>window.birdPreview.subjects.forEach(b=>b.object.rotation.y=-.65));
  await page.evaluate(()=>{const p=window.birdPreview;p.subjects.forEach((b,i)=>{b.object.visible=true;b.object.position.x=(i-1)*1.65;});p.camera.position.set(3.6,2.5,7);p.camera.lookAt(0,.77,0);p.render();});
  for (const [clip,normalized] of [['Attack',.455],['Death',1],['Walk',.25]]) {
    await page.evaluate(async ([clip,t])=>{const p=window.birdPreview;for(const b of p.subjects)await p.pose(b.object.userData.species,clip,b.clips.find(c=>c.name===clip).duration*t);},[clip,normalized]);
    await page.screenshot({path:path.join(out,`${clip.toLowerCase()}.png`)});
  }
  console.log('test-results/creature-expansion/birds/diagnostic.png');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
