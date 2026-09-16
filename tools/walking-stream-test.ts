/** Cold production travel with real input, frame gaps and optional CPU evidence. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { gameRoot } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';

const args = process.argv.slice(2);
const value = (key:string,fallback:string) => args.includes(key) ? args[args.indexOf(key)+1]! : fallback;
const desktop = args.includes('--desktop'), label = value('--label','walking');
const out = path.resolve('test-results/walking-stream',label);
await mkdir(out,{recursive:true});
const clear = installTestDeadline('Walking and streaming',115_000);
const server = await preview({root:gameRoot,preview:{host:'127.0.0.1',port:0}});
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw Error('No preview address');
const browser = await chromium.launch({headless:true,args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),
  '--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try {
  const context = await browser.newContext({viewport:desktop?{width:1440,height:900}:{width:844,height:390},
    deviceScaleFactor:desktop?1:2,hasTouch:!desktop,isMobile:!desktop,serviceWorkers:'block'});
  const page = await context.newPage(), errors:string[] = [];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  const cdp = await context.newCDPSession(page);
  const mbps = Number(value('--mbps','20')), cpu = Number(value('--cpu',desktop?'1':'2'));
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:mbps*1e6/8,uploadThroughput:1e6/8});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  await page.addInitScript({content:`(() => {
    window.__travelFrames=[]; window.__travelTasks=[]; window.__travelPhase='boot';
    let previous=performance.now(),previousPhase='boot';
    const step=at=>{const phase=window.__travelPhase;if(phase===previousPhase)window.__travelFrames.push({at,ms:at-previous,phase});previous=at;previousPhase=phase;requestAnimationFrame(step)};
    requestAnimationFrame(step);
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__travelTasks.push({at:e.startTime,ms:e.duration,phase:window.__travelPhase})}).observe({type:'longtask',buffered:true});
  })();`});
  if(args.includes('--shaders'))await page.addInitScript(() => {
    const w=window as any;w.__travelShaders=[];
    const source=new WeakMap<WebGLShader,string>(),p=WebGL2RenderingContext.prototype;
    const shaderSource=p.shaderSource,info=p.getProgramInfoLog;
    p.shaderSource=function(shader,text){source.set(shader,text);shaderSource.call(this,shader,text);};
    p.getProgramInfoLog=function(program){
      const at=performance.now(),result=info.call(this,program),ms=performance.now()-at;
      if(ms>10&&w.__travelPhase!=='boot')w.__travelShaders.push({at,ms,phase:w.__travelPhase,
        defines:this.getAttachedShaders(program)?.map(s=>source.get(s)?.split('\n').filter(l=>l.startsWith('#define')))});
      return result;
    };
  });
  if(args.includes('--uploads'))await page.addInitScript({content:`(() => {
    window.__travelUploads=[];const p=WebGL2RenderingContext.prototype;
    for(const name of ['texStorage2D','texImage2D','texSubImage2D','bufferData']){const original=p[name];p[name]=function(...args){
      const at=performance.now();const result=original.apply(this,args);
      if(window.__travelPhase!=='boot'){
        const bytes=name==='bufferData'?(typeof args[1]==='number'?args[1]:args[1]?.byteLength):args.find(x=>x?.byteLength)?.byteLength;
        window.__travelUploads.push({at,name,ms:performance.now()-at,bytes,args:args.map(x=>typeof x==='number'?x:x?.width?{width:x.width,height:x.height}:null)});
      }return result;
    }}
  })();`});
  await page.goto(`http://127.0.0.1:${address.port}/`,{waitUntil:'commit'});
  await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:60_000});
  await page.locator('#boot-screen').waitFor({state:'detached'});
  const snapshot = () => page.evaluate(() => {
    const w=window as any,d=w.__gameDebug;
    return {position:d.getPlayerPosition(),camera:d.getCamera(),timings:d.getPerformanceTimings(),
      loading:w.__corealmPlayerAssets.snapshot(),views:d.getEntityViewStats(),shaders:w.__renderDistanceLab.shaders(),errors:d.getErrors()};
  });
  const states:Record<string,unknown>={start:await snapshot()};
  if(args.includes('--trace'))await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink,cc,gpu,disabled-by-default-gpu.service',transferMode:'ReturnAsStream'});
  if(args.includes('--profile')){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await page.evaluate(()=>{(window as any).__travelPhase='idle';});
  await page.waitForTimeout(4000);
  states.idle=await snapshot();
  const stick = desktop ? null : await page.getByRole('slider',{name:'Move',exact:true}).boundingBox();
  if(!desktop)assert.ok(stick);
  for(const [key,dx,dy] of [['s',0,1],['a',-1,0],['s',0,1],['d',1,0]] as const){
    const phase=`walk-${Object.keys(states).length}-${key}`;
    await page.evaluate(phase=>{(window as any).__travelPhase=phase;},phase);
    if(stick)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width/2+dx*30,y:stick.y+stick.height/2+dy*30,id:1}]});
    else await page.keyboard.down(key);
    await page.waitForTimeout(4000);
    if(stick)await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.keyboard.up(key);
    states[phase]=await snapshot();
  }
  await page.evaluate(()=>{(window as any).__travelPhase='settle';});
  const settlingAt = Date.now();
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => {
    const w = window as any, assets = w.__corealmPlayerAssets.snapshot().assets;
    return assets.queued === 0 && assets.inflight === 0
      && w.__gameDebug.getEntityViewStats().residency.pending === 0
      && w.__renderDistanceLab.shaders().waiting === 0;
  }, undefined, { timeout: 10_000 });
  const settledMs = Date.now() - settlingAt;
  if(args.includes('--profile'))await writeFile(path.join(out,'cpu.json'),JSON.stringify((await cdp.send('Profiler.stop')).profile));
  if(args.includes('--trace')){
    const completed=new Promise<any>(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await completed;
    let trace='';for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}
    await cdp.send('IO.close',{handle:stream});await writeFile(path.join(out,'trace.json'),trace);
  }
  const data=await page.evaluate(()=>({frames:(window as any).__travelFrames,tasks:(window as any).__travelTasks,shaders:(window as any).__travelShaders,uploads:(window as any).__travelUploads,
    boot:(window as any).__corealmBootTelemetry.snapshot()}));
  const phases = ['idle','walking','settle'].map(phase=>{
    const frames=data.frames.filter((f:any)=>phase==='walking'?f.phase.startsWith('walk-'):f.phase===phase);
    const values=frames.map((f:any)=>f.ms).sort((a:number,b:number)=>a-b);
    const at=(p:number)=>values[Math.min(values.length-1,Math.floor(values.length*p))]??0;
    return {phase,frames:values.length,p50:at(.5),p95:at(.95),p99:at(.99),max:at(1),
      over50:values.filter((v:number)=>v>50.5).length,over100:values.filter((v:number)=>v>100.5).length,
      fps:1000*values.length/values.reduce((a:number,b:number)=>a+b,0)};
  });
  const end=await snapshot();
  await writeFile(path.join(out,'report.json'),JSON.stringify({desktop,mbps,cpu,settledMs,states,end,phases,errors,...data},null,2));
  await page.screenshot({path:path.join(out,'after-walking.png'),timeout:5000});
  const start=(states.start as any).position;
  assert.ok(Math.hypot(end.position.x-start.x,end.position.z-start.z)>8,'Real movement must cross streaming boundaries');
  assert.deepEqual(errors,[]);assert.deepEqual(end.errors,[]);
  assert.equal(end.loading.assets.failed,0);
  assert.equal(end.loading.assets.queued,0);assert.equal(end.loading.assets.inflight,0);
  assert.equal(end.views.residency.pending,0);
  assert.equal(end.shaders.waiting,0,'Graphics preparation must finish too');
  assert.ok(end.loading.assets.loaded>(states.start as any).loading.assets.loaded,'Travel must finish new asset work');
  if(args.includes('--budget'))assert.ok(phases.find(p=>p.phase==='walking')!.max<150,'Walking must avoid large streaming freezes');
  console.log(JSON.stringify({label,playableMs:data.boot.firstPlayableMs,settledMs,phases,
    assetsStart:(states.start as any).loading.assets,assetsEnd:end.loading.assets},null,2));
} finally {
  await browser.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));clear();
}
