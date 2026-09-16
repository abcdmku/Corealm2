/** Production loader, continuous boot feedback and creature replacement in the compact lab. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const clear = installTestDeadline('Streaming loading lab', 60_000);
const server = await startGameServer();
const browser = await chromium.launch({headless:true,args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),
  '--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out = path.resolve('test-results/streaming-loading-lab');
await mkdir(out,{recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript({content:'window.__name = (value) => value;'});
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  let release!:()=>void;
  const held = new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/src/main.ts',async route=>{await held; await route.continue();});
  await page.route('**/assets/**',async route=>{
    const file=path.resolve('game/dist',new URL(route.request().url()).pathname.slice(1));
    if(!file.startsWith(path.resolve('game/dist')+path.sep))throw Error('Fixture path escaped');
    try {
      const body=await readFile(file);
      await route.fulfill({body,contentType:file.endsWith('.json')?'application/json':file.endsWith('.webp')?'image/webp':'application/octet-stream'});
    }catch {await route.continue();}
  });
  await page.goto(`${server.url}/?mode=combat&performance=1&startup-cache=0`,{waitUntil:'commit'});
  const activity=page.locator('.boot-activity');
  await activity.waitFor({state:'visible'});
  const initial = await activity.evaluate(el=>({transform:getComputedStyle(el).transform,stage:(document.querySelector('.boot-progress') as HTMLProgressElement).value}));
  await page.waitForTimeout(450);
  const next=await activity.evaluate(el=>({transform:getComputedStyle(el).transform,stage:(document.querySelector('.boot-progress') as HTMLProgressElement).value}));
  assert.notEqual(initial.transform,next.transform); assert.equal(initial.stage,next.stage);
  await page.screenshot({path:path.join(out,'loading.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await activity.evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  release();
  await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:35_000});
  await page.locator('#lab-target').selectOption('species:goblin_archer');
  await page.evaluate(()=>{
    const w=window as any;w.__handoff=[];w.__recordHandoff=true;
    const frame=()=>{
      const target=w.__featureLab.getState().target;
      const id=target?.presetId==='species:goblin_archer' ? target.entityId : null;
      if(id){const motion=w.__gameDebug.getEntityMotion(id);w.__handoff.push({id,motion,bounds:w.__gameDebug.getDrawnBounds(id),shaders:w.__renderDistanceLab.shaders()});}
      if(w.__recordHandoff)requestAnimationFrame(frame);
    };requestAnimationFrame(frame);
  });
  await page.locator('#lab-spawn-target').click();
  await page.waitForFunction(()=>{
    const w=window as any;return w.__handoff.some((s:any)=>s.motion?.path==='live-rig');
  },undefined,{timeout:10_000});
  await page.waitForTimeout(500);
  const handoff=await page.evaluate(()=>{const w=window as any;w.__recordHandoff=false;return w.__handoff;});
  assert.ok(handoff.some((s:any)=>s.motion?.path==='sampled-rig'),'Retained sampled actor during shader preparation');
  assert.ok(handoff.filter((s:any)=>s.motion).every((s:any)=>s.bounds),'Actor never vanishes during handoff');
  await page.keyboard.press('Escape');
  const before=await page.evaluate(()=>(window as any).__gameDebug.getPlayerPosition());
  await page.locator('#viewport').click({position:{x:700,y:500}});
  await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w');
  const after=await page.evaluate(()=>(window as any).__gameDebug.getPlayerPosition());
  assert.notDeepEqual(before,after);
  await page.screenshot({path:path.join(out,'handoff.png')});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'report.json'),JSON.stringify({initial,next,handoff,before,after,errors},null,2));
  console.log(JSON.stringify({passed:true,samples:handoff.length,paths:[...new Set(handoff.map((s:any)=>s.motion?.path))],before,after}));
} finally {await browser.close();await server.close();clear();}
