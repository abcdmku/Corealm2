/** Cold production travel with real input, frame gaps and optional CPU evidence. */
import assert from 'node:assert/strict';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { gameRoot } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';
import { startAuthoredTestHost } from './lib/authoredTestHost.js';
import { WORLD_PROTOCOL_VERSION } from '../game/src/contracts.js';

const args = process.argv.slice(2);
const value = (key:string,fallback:string) => args.includes(key) ? args[args.indexOf(key)+1]! : fallback;
const desktop = args.includes('--desktop'), label = value('--label','walking');
const probeBrowser = args.includes('--browser-probe'), warm = args.includes('--warm');
const traceBoot = args.includes('--trace-boot'), trace = traceBoot || args.includes('--trace');
const out = path.resolve('test-results/walking-stream',label);
await mkdir(out,{recursive:true});
const clear = installTestDeadline('Walking and streaming',115_000);
const suppliedUrl = value('--url', '');
const server = suppliedUrl ? null : await preview({root:gameRoot,preview:{host:'127.0.0.1',port:0}});
const address = server?.httpServer.address();
if (!suppliedUrl && (!address || typeof address === 'string')) throw Error('No preview address');
const url = suppliedUrl || `http://127.0.0.1:${(address as {port:number}).port}`;
const authored = args.includes('--authored');
const host = authored ? await startAuthoredTestHost() : null;
const channel = value('--channel','');
const browser = await chromium.launch({headless:true,...(channel ? {channel} : {}),args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),
  ...(probeBrowser ? ['--disable-background-timer-throttling','--disable-renderer-backgrounding'] : []),
  ...(args.includes('--gpu-commands') ? ['--enable-gpu-service-tracing'] : []),
  '--enable-gpu','--ignore-gpu-blocklist','--mute-audio','--enable-precise-memory-info']});
try {
  const errors:string[] = [];
  const socketFrames: {at:number;direction:string;bytes:number;type:string}[] = [];
  // A separate renderer detects shared-GPU stalls that the game's own RAF cannot attribute.
  // Submit only one tiny frame at a time; never synchronously wait for the GPU.
  const observerContext = probeBrowser ? await browser.newContext({viewport:{width:320,height:240}}) : null;
  const observer = observerContext ? await observerContext.newPage() : null;
  if(observer) {
    observer.on('pageerror',error=>errors.push(`Browser probe: ${String(error)}`));
    await observer.setContent('<canvas width="64" height="64"></canvas>');
    await observer.evaluate(`(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      if(!gl) throw new Error('Browser probe requires WebGL2');
      const w = window;
      w.__browserFrames = []; w.__browserPhase = 'baseline';
      let last = performance.now(), sent = 0, fence = null;
      requestAnimationFrame(function sample(at) {
        const now = performance.now();
        let completed = null;
        if(fence) {
          const status = gl.clientWaitSync(fence,0,0);
          if(status === gl.WAIT_FAILED) throw new Error('Browser probe GPU fence failed');
          if(status !== gl.TIMEOUT_EXPIRED) {
            completed = now-sent; gl.deleteSync(fence); fence = null;
          }
        }
        if(!fence) {
          gl.clearColor(0,.3,.2,1); gl.clear(gl.COLOR_BUFFER_BIT);
          fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0); sent = performance.now();
        }
        w.__browserFrames.push({at:performance.timeOrigin+now,raf:at-last,completed,phase:w.__browserPhase});
        last = at; requestAnimationFrame(sample);
      });
    })()`);
    await observer.waitForTimeout(1000);
  }
  const context = await browser.newContext({viewport:{width:Number(value('--width',desktop?'1440':'844')),height:Number(value('--height',desktop?'900':'390'))},
    deviceScaleFactor:desktop?1:2,hasTouch:!desktop,isMobile:!desktop,serviceWorkers:'block'});
  if(host)await context.addInitScript(descriptor=>{
    (window as any).__COREALM_MULTIPLAYER__=descriptor;
    (window as any).__COREALM_DEVELOPMENT_GUESTS__=true;
  }, {providerId:'reference',worldId:'authored',name:'Authored travel',endpoint:`ws://127.0.0.1:${host.port}/`,
    protocolVersion:WORLD_PROTOCOL_VERSION,fixture:'authored',seed:1337,capacity:1000,population:0,availability:'available'});
  const page = await context.newPage();
  page.on('websocket', socket => {
    const record = (direction: string) => (frame: {payload:string|Buffer}) => {
      if(socketFrames.length>=80)return;
      const payload=frame.payload;
      socketFrames.push({at:Date.now(),direction,bytes:typeof payload==='string'?Buffer.byteLength(payload):payload.byteLength,
        type:String(payload).slice(0,120).match(/"type":"([^"]+)"/)?.[1]??'unknown'});
    };
    socket.on('framesent',record('framesent'));
    socket.on('framereceived',record('framereceived'));
  });
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  const cdp = await context.newCDPSession(page);
  const mbps = Number(value('--mbps','20')), cpu = Number(value('--cpu',desktop?'1':'2'));
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled',{cacheDisabled:!warm});
  // Throttle asset delivery only. Legacy global CDP throttling also delays WebSocket frames,
  // turning a local server's 50 ms snapshot into a spurious five-second join timeout.
  await cdp.send('Network.emulateNetworkConditionsByRule',{matchedNetworkConditions:[{
    urlPattern:new URL(url).origin+'/*',latency:80,downloadThroughput:mbps*1e6/8,uploadThroughput:1e6/8,
  }]});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  if(args.includes('--quality-max'))await page.addInitScript(() => {
    localStorage.setItem('corealm.settings.v1',JSON.stringify({renderScale:1,shadowQuality:'high',drawDistance:'near',autoDrawDistance:true}));
  });
  await page.addInitScript({content:`(() => {
    window.__travelFrames=[]; window.__travelTasks=[]; window.__travelPhase='boot'; window.__travelPresentation=[];
    window.__startingWorld=null;
    let previous=performance.now(),previousPhase='boot',previousUploads=0;
    let completed=0,lastCompletedId=0;
    const step=at=>{const phase=window.__travelPhase,uploads=window.__uploadCount??0;if(phase===previousPhase)window.__travelFrames.push({at,ms:at-previous,phase,uploads:uploads-previousUploads});previousUploads=uploads;
      const debug=window.__gameDebug;
      if(!window.__startingWorld && debug?.getState().ready) {
        const ids=['coldbrace_bank','coldbrace_forge_shed#roof','coldbrace_cookhouse#b0_w',
          'coldbrace_red_worms_7','coldbrace_red_worms_8','coldbrace_smith','npc_smith_harrow'];
        window.__startingWorld={at:performance.now(),views:debug.getEntityViewStats(),
          drawn:Object.fromEntries(ids.map(id=>[id,debug.getDrawnBounds(id)]))};
      }
      const p=debug?.getPresentationState?.();
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
  const startTrace = () => cdp.send('Tracing.start',{categories:args.includes('--gpu-commands')
    ? 'gpu,disabled-by-default-gpu.service,devtools.timeline'
    : 'devtools.timeline,v8,blink,cc,gpu,disabled-by-default-gpu.service',transferMode:'ReturnAsStream'});
  const playUrl = new URL(authored?'/?play=reference/authored':'/?play=local&local=memory',url).href;
  if(warm) {
    if(observer)await observer.evaluate(()=>{(window as any).__browserPhase='warming';});
    await page.goto(playUrl,{waitUntil:'commit'});
    await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:60_000});
    // Reload the same browser/context so HTTP, world-data and driver caches survive.
  }
  if(traceBoot)await startTrace();
  if(observer)await observer.evaluate(()=>{(window as any).__browserPhase='boot';});
  await page.goto(playUrl,{waitUntil:'commit'});
  await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:60_000});
  await page.locator('#boot-screen').waitFor({state:'detached'});
  if(observer)await observer.evaluate(()=>{(window as any).__browserPhase='play';});
  console.log('Playable',await page.evaluate(()=>performance.now()));
  const snapshot = () => page.evaluate(() => {
    const w=window as any,d=w.__gameDebug;
    return {position:d.getPlayerPosition(),camera:d.getCamera(),timings:d.getPerformanceTimings(),
      loading:w.__corealmPlayerAssets.snapshot(),views:d.getEntityViewStats(),settings:w.__renderDistanceLab.getState().settings,
      shaders:w.__renderDistanceLab.shaders(),errors:d.getErrors()};
  });
  const states:Record<string,unknown>={start:await snapshot()};
  // Prove that the first ready world accepts real movement, before an idle settling period.
  const inputStart = await page.evaluate(() => ({at:performance.now(),position:(window as any).__gameDebug.getPlayerPosition()}));
  await page.evaluate(()=>{(window as any).__travelPhase='walk-first-input';});
  await page.keyboard.down('s');
  let firstMovementMs: number;
  try {
    await page.waitForFunction(origin=>{
      const w=window as any,p=w.__gameDebug.getPlayerPosition();
      if(Math.hypot(p.x-origin.position.x,p.z-origin.position.z)<.1)return false;
      w.__firstMovementMs=performance.now()-origin.at;return true;
    },inputStart,{timeout:2000});
    firstMovementMs=await page.evaluate(()=>(window as any).__firstMovementMs);
  } catch(error) {
    await writeFile(path.join(out,'report.json'),JSON.stringify({failure:String(error),errors,socketFrames,inputStart,
      state:await snapshot(),diagnostic:await page.evaluate(()=>({
        active:document.activeElement?.outerHTML,worldPhase:document.querySelector('#multiplayer-selector')?.getAttribute('data-phase'),
        status:document.querySelector('.worlds__status')?.textContent,title:document.querySelector('.title')?.outerHTML,
        boot:(window as any).__corealmBootTelemetry.snapshot(),startingWorld:(window as any).__startingWorld,
      }))},null,2));
    await page.screenshot({path:path.join(out,'input-failure.png')});
    throw error;
  } finally { await page.keyboard.up('s'); }
  if(trace && !traceBoot)await startTrace();
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
  // Trace extraction can take seconds. It is reporting work, outside the gameplay windows.
  const browserFrames = observer ? await observer.evaluate(()=>{
    const w=window as any;w.__browserPhase='reporting';return w.__browserFrames;
  }) : undefined;
  const browserPhases = browserFrames ? ['baseline','boot','play'].map(phase=>{
    const samples=browserFrames.filter((s:any)=>s.phase===phase);
    return {phase,samples:samples.length,maxRaf:Math.max(0,...samples.map((s:any)=>s.raf)),
      maxGpu:Math.max(0,...samples.map((s:any)=>s.completed??0))};
  }) : undefined;
  await page.evaluate(()=>{(window as any).__travelPhase='reporting';});
  if(args.includes('--profile')){
    const {profile} = await cdp.send('Profiler.stop');
    profileStartMs = profile.startTime / 1000 - navigationStartMs;
    await writeFile(path.join(out,'cpu.json'),JSON.stringify(profile));
  }
  if(trace){
    const completed=new Promise<any>(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');const {stream}=await completed;
    const traceFile = await open(path.join(out, 'trace.json'), 'w');
    try {
      for (;;) {
        const part = await cdp.send('IO.read', { handle: stream, size: 1_048_576 });
        await traceFile.writeFile(part.base64Encoded ? Buffer.from(part.data, 'base64') : part.data);
        if (part.eof) break;
      }
    } finally {
      await traceFile.close();
      await cdp.send('IO.close', { handle: stream });
    }
  }
  const data=await page.evaluate(()=>({frames:(window as any).__travelFrames,tasks:(window as any).__travelTasks,shaders:(window as any).__travelShaders,uploads:(window as any).__travelUploads,
    startingWorld:(window as any).__startingWorld,memory:(window as any).__travelMemory,queries:(window as any).__travelQueries,presentation:(window as any).__travelPresentation,boot:(window as any).__corealmBootTelemetry.snapshot()}));
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
  await writeFile(path.join(out,'report.json'),JSON.stringify({socketFrames,firstMovementMs,warm,authored,desktop,mbps,cpu,browserVersion:browser.version(),channel,settledMs,settlingTimedOut,profileStartMs,states,end,phases,presentationPhases,browserPhases,browserFrames,errors,...data},null,2));
  await page.screenshot({path:path.join(out,'after-walking.png'),timeout:5000});
  const start=(states.start as any).position;
  assert.ok(Math.hypot(end.position.x-start.x,end.position.z-start.z)>8,'Real movement must cross streaming boundaries');
  assert.deepEqual(errors,[]);assert.deepEqual(end.errors,[]);
  assert.ok(data.startingWorld,'Capture the first ready frame');
  assert.equal(data.startingWorld.views.residency.pending,0,'Ready must include nearby entities');
  assert.equal(data.startingWorld.views.residency.missing,0,'Ready must not omit missing models');
  assert.equal(data.startingWorld.views.residency.failed,0,'Ready must not hide failed model loads');
  assert.equal(data.startingWorld.views.pendingAnimations,0,'Ready must include creature animations');
  for(const [id,drawn] of Object.entries(data.startingWorld.drawn) as [string,any][]) {
    assert.ok(drawn && drawn.meshes>0 && drawn.height>0 && drawn.width>0,`${id} must have actual drawn geometry at readiness`);
  }
  assert.equal(end.loading.assets.failed,0);
  assert.equal(end.loading.assets.queued,0);assert.equal(end.loading.assets.inflight,0);
  assert.equal(end.views.residency.pending,0);
  assert.equal(end.views.pendingAnimations,0);
  assert.equal(end.shaders.waiting,0,'Graphics preparation must finish too');
  const startingIds = new Set((states.start as any).views.residency.residentIds);
  assert.ok(end.views.residency.residentIds.some((id:string)=>!startingIds.has(id)),
    'Travel must bring new entities into the rendered working set, even when they share loaded models');
  if(args.includes('--budget'))assert.ok(data.boot.firstPlayableMs<20_000,
    'The complete playable world must meet the existing 20-second startup budget');
  if(args.includes('--budget'))assert.ok(firstMovementMs<250,`Ready input took ${firstMovementMs} ms to move the player`);
  if(args.includes('--budget'))for(const phase of phases) {
    assert.ok(phase.max<150,`${phase.phase} must avoid large streaming freezes`);
  }
  if(args.includes('--budget') && browserPhases)for(const phase of browserPhases) {
    assert.ok(phase.samples>0,`Browser probe must sample ${phase.phase}`);
    // Startup still includes first-use driver compilation. This catches multi-second shared
    // GPU lockups; the normal 150 ms interaction budget applies after joining.
    const limit = phase.phase==='boot' ? 1000 : 150;
    assert.ok(phase.maxRaf<limit && phase.maxGpu<limit,
      `Other browser page stalled during ${phase.phase}: RAF ${phase.maxRaf}, GPU ${phase.maxGpu}`);
  }
  if(args.includes('--presentation-budget'))for(const phase of presentationPhases) {
    assert.ok(phase.p95<100,`${phase.phase} must complete graphics promptly`);
    assert.ok(phase.max<250,`${phase.phase} must not accumulate stale graphics`);
  }
  console.log(JSON.stringify({label,playableMs:data.boot.firstPlayableMs,settledMs,phases,presentationPhases,browserPhases,
    assetsStart:(states.start as any).loading.assets,assetsEnd:end.loading.assets},null,2));
} finally {
  await browser.close();await host?.close();if(server)await new Promise<void>((resolve,reject)=>server.httpServer.close(e=>e?reject(e):resolve()));clear();
}
