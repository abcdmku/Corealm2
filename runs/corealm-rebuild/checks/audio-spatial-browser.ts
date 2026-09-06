import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { audioCheckUrl } from "./audio-capture-support.js";

// Production audio graph in Chromium OfflineAudioContext. No renderer or GPU.
const out="test-results/audio-spatial-browser";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:["--disable-gpu"]});
try {
  const page=await browser.newPage();
  await page.route("**/audio-fixture",route=>route.fulfill({contentType:"text/html",body:"<html><body>Audio graph check</body></html>"}));
  await page.goto(`${audioCheckUrl()}/audio-fixture`);
  const report=await page.evaluate(`(async()=>{
    const {AudioEngine}=await import('/src/audio/engine.ts');
    const samples=12000,rate=24000;
    const wav=new ArrayBuffer(44+samples*2), view=new DataView(wav);
    function tag(offset,text){for(let i=0;i<text.length;i++) view.setUint8(offset+i,text.charCodeAt(i));}
    tag(0,'RIFF');view.setUint32(4,36+samples*2,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,samples*2,true);
    let seed=42;
    for(let i=0;i<samples;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;view.setInt16(44+i*2,(seed/4294967296-0.5)*24000,true);}
    async function render(x,forward=[0,0,-1]){
      const offline=new OfflineAudioContext(2,24000,rate);
      const context=new Proxy(offline,{get(target,key){if(key==='state')return 'running';const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
      const engine=new AudioEngine({cues:{'ui.click':{variants:['fixture:wave']}}},{contextFactory:()=>context,fetcher:async()=>new Response(wav.slice(0)),initialVolumes:{sfx:1}});
      engine.setListenerPose([0,0,0],forward);
      const played=await engine.playCue('ui.click',{position:[x,0,0],maxDistance:34});
      const output=await offline.startRendering();
      const energy=[0,1].map(channel=>output.getChannelData(channel).reduce((sum,v)=>sum+v*v,0));
      return {played,energy};
    }
    return {right:await render(6),left:await render(-6),turned:await render(6,[0,0,1]),distant:await render(30)};
  })()`);
  console.log(JSON.stringify(report));
  assert.ok(report.right.played && report.left.played && report.turned.played);
  assert.ok(report.right.energy[1]>report.right.energy[0]*1.2,"right source must be louder in right channel");
  assert.ok(report.left.energy[0]>report.left.energy[1]*1.2,"left source must be louder in left channel");
  assert.ok(report.turned.energy[0]>report.turned.energy[1]*1.2,"turning camera must reverse stereo side");
  assert.ok(report.distant.energy[0]+report.distant.energy[1]<(report.right.energy[0]+report.right.energy[1])*0.2,"distance must attenuate sound");
  await writeFile(`${out}/report.json`,JSON.stringify({passed:true,...report},null,2));
  console.log(JSON.stringify({passed:true,...report}));
}finally{await browser.close();}
