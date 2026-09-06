import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Production Vfx and catalogue in a DOM fixture. No WebGL or game renderer.
const out="test-results/loot-receipts-browser";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:["--disable-gpu"]});
try {
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.route("**/loot-receipts-fixture",route=>route.fulfill({contentType:"text/html",body:'<html><head><link rel="stylesheet" href="/src/ui/styles.css"></head><body><div id="ui-root"></div></body></html>'}));
  await page.goto(`${process.env.COREALM_URL ?? "http://127.0.0.1:4175"}/loot-receipts-fixture`);
  await page.evaluate(`(async()=>{
    const THREE=await import('/@id/three');
    const {Vfx}=await import('/src/render/vfx.ts');
    const {content}=await import('/src/content/index.ts');
    const {ALL_ITEMS}=await import('/src/content/items.ts');content.register({items:ALL_ITEMS});
    const camera=new THREE.PerspectiveCamera(55,800/600,.1,100);
    camera.position.set(0,3,10);camera.lookAt(0,1.4,0);camera.updateMatrixWorld(true);
    window.receipts={removed:false,make:()=>new Vfx({camera,parent:new THREE.Group(),root:document.querySelector('#ui-root'),entityPosition:()=>window.receipts.removed?null:[0,0,0],playerPosition:()=>[0,0,0]})};
  })()`);
  const reports=[];
  for(const cadence of [0,80]) for(const removed of [false,true]) {
    await page.evaluate(`(() => {
      window.receipts.vfx?.dispose();window.receipts.removed=false;const vfx=window.receipts.make();window.receipts.vfx=vfx;
      const items=[['water_orb',1],['kaldite_sword',1],['kaldite_bar',6],['cairn_garnet',3],['cairn_pelt',2]];
      items.forEach(([itemId,quantity],index)=>{
        window.receipts.removed=${removed} && index===4;
        vfx.handle({seq:index+1,type:'item.received',entityId:'pile',data:{itemId,quantity,source:'loot',name:itemId.replaceAll('_',' ')}},index*${cadence});
      });
    })()`);
    for(const time of [400,700,1100]) {
      await page.evaluate(`window.receipts.vfx.update(${time})`);
      const labels=await page.locator(".vfx-xp").evaluateAll(elements=>elements.map(element=>{
        const r=element.getBoundingClientRect();return {text:element.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      }));
      assert.equal(labels.length,5);
      assert(labels.some(row=>row.text==="+1 Cobalt Sword"));
      assert(labels.some(row=>row.text==="+3 Garnet"));
      for(let a=0;a<labels.length;a++) for(let b=a+1;b<labels.length;b++) {
        const x=labels[a]!,y=labels[b]!;
        assert(!(x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top),`overlap at cadence${cadence},time${time}`);
      }
      reports.push({cadence,removed,time,labels});
    }
    await page.evaluate("window.receipts.vfx.update(400)");
    await page.screenshot({path:`${out}/receipts-${cadence}-${removed}.png`});
    await page.evaluate(`window.receipts.vfx.update(${1400+4*cadence})`);
    assert.equal(await page.locator(".vfx-xp").count(),0);
  }
  await writeFile(`${out}/report.json`,JSON.stringify({passed:true,reports},null,2));
  console.log(JSON.stringify({passed:true,scenarios:reports.length,out}));
}finally{await browser.close();}
