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
  '--enable-gpu','--ignore-gpu-blocklist','--mute-audio','--enable-precise-memory-info']});
try {
  const context = await browser.newContext({viewport:{width:Number(value('--width',desktop?'1440':'844')),height:Number(value('--height',desktop?'900':'390'))},
    deviceScaleFactor:desktop?1:2,hasTouch:!desktop,isMobile:!desktop,serviceWorkers:'block'});
  const page = await context.newPage(), errors:string[] = [];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  const cdp = await context.newCDPSession(page);
  const mbps = Number(value('--mbps','20')), cpu = Number(value('--cpu',desktop?'1':'2'));
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:mbps*1e6/8,uploadThroughput:1e6/8});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  if(args.includes('--quality-max'))await page.addInitScript(() => {
    localStorage.setItem('corealm.settings.v1',JSON.stringify({renderScale:1,shadowQuality:'high',drawDistance:'near',autoDrawDistance:true}));
  });
  await page.addInitScript({content:`(() => {
    window.__travelFrames=[]; window.__travelTasks=[]; window.__travelPhase='boot'; window.__travelPresentation=[];
    let previous=performance.now(),previousPhase='boot',previousUploads=0;
    let completed=0,lastCompletedId=0;
    const step=at=>{const phase=window.__travelPhase,uploads=window.__uploadCount??0;if(phase===previousPhase)window.__travelFrames.push({at,ms:at-previous,phase,uploads:uploads-previousUploads});previousUploads=uploads;
      const p=window.__gameDebug?.getPresentationState?.();
      if(p&&p.completed!==completed){for(const frame of p.recent??[])if(frame.id>lastCompletedId){window.__travelPresentation.push({at:frame.at,ms:frame.ms,phase,completed:frame.id,skipped:p.skipped,pending:p.pending});lastCompletedId=frame.id;}completed=p.completed;}
      previous=at;previousPhase=phase;requestAnimationFrame(step)};
    requestAnimationFrame(step);
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__travelTasks.push({at:e.startTime,ms:e.duration,phase:window.__travelPhase})}).observe({type:'longtask',buffered:true});
    window.__travelMemory=[];
    setInterval(()=>window.__travelMemory.push({at:performance.now(),phase:window.__travelPhase,heap:performance.memory?.usedJSHeapSize}),1000);
  })();`});
  if(args.includes('--upload-counts'))await page.addInitScript(() => {
    const w=window as any,p=WebGL2RenderingContext.prototype,original=p.texSubImage2D;
    w.__uploadCount=0;
    p.texSubImage2D=function(...args:any[]){w.__uploadCount++;return (original as any).apply(this,args);};
  });
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
  if(args.includes('--queries'))await page.addInitScript({content:`(() => {
    window.__travelQueries=[];const p=WebGL2RenderingContext.prototype;
    for(const name of ['getParameter','getQuery','getQueryParameter','getProgramParameter']){const original=p[name];p[name]=function(...args){
      const at=performance.now(),result=original.apply(this,args),ms=performance.now()-at;
      if(ms>4&&window.__travelPhase!=='boot')window.__travelQueries.push({at,name,ms,args:args.filter(x=>typeof x==='number')});return result;
    }}
  })();`});
  await page.goto(`http://127.0.0.1:${address.port}/`,{waitUntil:'commit'});
  await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:60_000});
  await page.locator('#boot-screen').waitFor({state:'detached'});
  console.log('Playable',await page.evaluate(()=>performance.now()));
  const snapshot = () => page.evaluate(() => {
    const w=window as any,d=w.__gameDebug;
    return {position:d.getPlayerPosition(),camera:d.getCamera(),timings:d.getPerformanceTimings(),
      loading:w.__corealmPlayerAssets.snapshot(),views:d.getEntityViewStats(),settings:w.__renderDistanceLab.getState().settings,
      shaders:w.__renderDistanceLab.shaders(),errors:d.getErrors()};
  });
  const states:Record<string,unknown>={start:await snapshot()};
  if(args.includes('--trace'))await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink,cc,gpu,disabled-by-default-gpu.service',transferMode:'ReturnAsStream'});
  let profileStartMs: number | undefined, navigationStartMs = 0;
  if(args.includes('--profile')){
    await cdp.send('Performance.enable');
    const { metrics } = await cdp.send('Performance.getMetrics');
    navigationStartMs = metrics.find(metric=>metric.name==='NavigationStart')!.value * 1000;
    await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  }
  await page.evaluate(()=>{(window as any).__travelPhase='idle';});
  await page.waitForTimeout(Number(value('--idle-ms','4000')));
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
  let settlingTimedOut = false;
  await page.waitForFunction(() => {
    const w = window as any, assets = w.__corealmPlayerAssets.snapshot().assets;
    return assets.queued === 0 && assets.inflight === 0
      && w.__gameDebug.getEntityViewStats().residency.pending === 0
      && w.__gameDebug.getEntityViewStats().pendingAnimations === 0
      && w.__renderDistanceLab.shaders().waiting === 0;
  }, undefined, { timeout: 10_000 }).catch(error => {
    if(error.name !== 'TimeoutError') throw error;
    settlingTimedOut = true;
  });
  const settledMs = Date.now() - settlingAt;
  states.settled = await snapshot();
  if(args.includes('--idle-after-ms')){
    await page.evaluate(()=>{(window as any).__travelPhase='idle-after';});
    await page.waitForTimeout(Number(value('--idle-after-ms','0')));
  }
  if(args.includes('--profile')){
    const {profile} = await cdp.send('Profiler.stop');
    profileStartMs = profile.startTime / 1000 - navigationStartMs;
    await writeFile(path.join(out,'cpu.json'),JSON.stringify(profile));
  }
  if(args.includes('--trace')){
    const completed=new Promise<any>(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await completed;
    let trace='';for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}
    await cdp.send('IO.close',{handle:stream});await writeFile(path.join(out,'trace.json'),trace);
  }
  const data=await page.evaluate(()=>({frames:(window as any).__travelFrames,tasks:(window as any).__travelTasks,shaders:(window as any).__travelShaders,uploads:(window as any).__travelUploads,
    memory:(window as any).__travelMemory,queries:(window as any).__travelQueries,presentation:(window as any).__travelPresentation,boot:(window as any).__corealmBootTelemetry.snapshot()}));
  const phases = ['idle','walking','settle','idle-after'].map(phase=>{
    const frames=data.frames.filter((f:any)=>phase==='walking'?f.phase.startsWith('walk-'):f.phase===phase);
    const values=frames.map((f:any)=>f.ms).sort((a:number,b:number)=>a-b);
    const at=(p:number)=>values[Math.min(values.length-1,Math.floor(values.length*p))]??0;
    return {phase,frames:values.length,p50:at(.5),p95:at(.95),p99:at(.99),max:at(1),
      ...(args.includes('--upload-counts')?{textureUpdatesPerFrame:frames.reduce((sum:number,f:any)=>sum+f.uploads,0)/frames.length}:{}),
      over50:values.filter((v:number)=>v>50.5).length,over100:values.filter((v:number)=>v>100.5).length,
      fps:1000*values.length/values.reduce((a:number,b:number)=>a+b,0)};
  });
  const end=await snapshot();
  const presentationPhases = ['idle','walking','settle','idle-after'].map(phase => {
    const frames=data.presentation.filter((f:any)=>phase==='walking'?f.phase.startsWith('walk-'):f.phase===phase);
    const times=frames.map((f:any)=>f.ms).sort((a:number,b:number)=>a-b);
    return {phase,completed:times.length,p95:times[Math.floor(times.length*.95)]??0,max:times.at(-1)??0,
      fps:frames.length>1 ? 1000*(frames.length-1)/(frames.at(-1).at-frames[0].at) : 0};
  });
  await writeFile(path.join(out,'report.json'),JSON.stringify({desktop,mbps,cpu,settledMs,settlingTimedOut,profileStartMs,states,end,phases,presentationPhases,errors,...data},null,2));
  await page.screenshot({path:path.join(out,'after-walking.png'),timeout:5000});
  const start=(states.start as any).position;
  assert.ok(Math.hypot(end.position.x-start.x,end.position.z-start.z)>8,'Real movement must cross streaming boundaries');
  assert.deepEqual(errors,[]);assert.deepEqual(end.errors,[]);
  assert.equal(end.loading.assets.failed,0);
  assert.equal(end.loading.assets.queued,0);assert.equal(end.loading.assets.inflight,0);
  assert.equal(end.views.residency.pending,0);
  assert.equal(end.views.pendingAnimations,0);
  assert.equal(end.shaders.waiting,0,'Graphics preparation must finish too');
  assert.ok(end.loading.assets.loaded>(states.start as any).loading.assets.loaded,'Travel must finish new asset work');
  if(args.includes('--budget'))for(const phase of phases) {
    assert.ok(phase.max<150,`${phase.phase} must avoid large streaming freezes`);
  }
  if(args.includes('--presentation-budget'))for(const phase of presentationPhases) {
    assert.ok(phase.p95<100,`${phase.phase} must complete graphics promptly`);
    assert.ok(phase.max<250,`${phase.phase} must not accumulate stale graphics`);
  }
  console.log(JSON.stringify({label,playableMs:data.boot.firstPlayableMs,settledMs,phases,presentationPhases,
    assetsStart:(states.start as any).loading.assets,assetsEnd:end.loading.assets},null,2));
} finally {
  await browser.close();await new Promise<void>((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));clear();
}
