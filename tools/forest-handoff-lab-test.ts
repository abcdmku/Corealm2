/** Chromium movement proof: every tree keeps exactly one drawn representation across residency boundaries. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { installTestDeadline } from './lib/deadline.js';
import { GameDriver } from './lib/driver.js';
import { argValue } from './lib/paths.js';
const clearDeadline = installTestDeadline('Forest handoff lab', 59000);
const out='test-results/forest-handoff';
await mkdir(out,{recursive:true});
const driver=new GameDriver({url:argValue(process.argv.slice(2),'--url')??'http://127.0.0.1:4188',close:async()=>{}},{viewport:{width:1440,height:900},browserArgs:[...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),'--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try {
 await driver.launch(); await driver.open(25000,'/index.html?mode=combat&forest=1');
 const page=driver.page!; await page.evaluate("window.__name = (fn) => fn");
 await page.waitForFunction(()=>Boolean((window as any).__forestLab));
 await page.evaluate(()=> (window as any).__featureLab.setWalkingEnabled(true));
 await driver.callDebug('inspectPose',[{x:20,y:0,z:-23,yaw:Math.PI,pitch:.45,distance:20}]);
 await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
 await driver.wait(400);
 await page.evaluate(()=>{
  const w=window as any; w.__handoffSamples=[]; w.__sampleHandoff=true;
  const sample=()=>{
   if(!w.__sampleHandoff)return;
   const scatter=w.__forestLab.getScatterVisibility(), p=w.__gameDebug.getPlayerPosition();
   w.__handoffSamples.push({t:performance.now(),p,trees:Object.entries(scatter).map(([id,visible])=>({id,scatter:visible,view:!!w.__gameDebug.getDrawnBounds(id),resident:!!w.__gameDebug.getEntity(id)}))});
   requestAnimationFrame(sample);
  }; requestAnimationFrame(sample);
 });
 await driver.screenshot(out,'before');
 await driver.press('w',4500);
 await driver.screenshot(out,'approached');
 await driver.press('s',6500);
 await driver.screenshot(out,'departed');
 await driver.press('w',4500);
 await driver.wait(350);
 await driver.screenshot(out,'returned');
 const samples=await page.evaluate(()=>{const w=window as any;w.__sampleHandoff=false;return w.__handoffSamples;});
 const missing=samples.flatMap((s:any)=>s.trees.filter((t:any)=>!t.scatter&&!t.view).map((t:any)=>({t:s.t,p:s.p,...t})));
 const overlap=samples.flatMap((s:any)=>s.trees.filter((t:any)=>t.scatter&&t.view).map((t:any)=>({t:s.t,p:s.p,...t})));
 const transitions=samples.slice(1).flatMap((s:any,i:number)=>s.trees.filter((t:any,j:number)=>t.resident!==samples[i].trees[j].resident).map((t:any)=>({t:s.t,p:s.p,...t})));
 const errors=[...driver.consoleErrors,...driver.pageErrors];
 const report={frames:samples.length,missing,overlap,transitions,errors,samples};
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({frames:samples.length,missing:missing.length,overlap:overlap.length,transitions:transitions.length,first:samples[0]?.p,last:samples.at(-1)?.p,errors}));
 assert(samples.length>30,'Need real rendered movement frames');
 assert(transitions.some((t:any)=>t.resident)&&transitions.some((t:any)=>!t.resident),'Need both promotion and demotion');
 assert.equal(missing.length,0,'Trees disappeared during handoff');
 assert.equal(overlap.length,0,'Trees duplicated during handoff');
 assert.equal(errors.length,0);
} finally {await driver.close(); clearDeadline();}
