import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { startGameServer } from './lib/server.js';
import { gameRoot } from './lib/paths.js';
import { installTestDeadline } from './lib/deadline.js';

const mobile = process.argv.includes('--mobile'), world = process.argv.includes('--world');
const cave = process.argv.includes('--cave');
assert.ok(!cave || world, '--cave requires the release world');
const deadline = installTestDeadline('Player interaction', world ? 120_000 : 60_000);
let close: () => Promise<void>, url: string;
if (world) {
  const server = await preview({root:gameRoot,preview:{host:'127.0.0.1',port:0}});
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string'); url = `http://127.0.0.1:${address.port}`;
  close = () => new Promise<void>((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve()));
} else { const server = await startGameServer(); url=server.url; close=()=>server.close(); }
const browser = await chromium.launch({headless:true,args:[...(process.platform==='win32'?['--use-angle=d3d11']:[]),
  '--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out = `test-results/player-interaction/${cave?'cave':world?'world':'lab'}-${mobile?'mobile':'desktop'}`;
await mkdir(out,{recursive:true});
const report: Record<string,any> = {}, errors: string[] = [];
let activePage: import('playwright').Page | undefined;
try {
  const context = await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:800},
    hasTouch:mobile,isMobile:mobile,deviceScaleFactor:mobile?2:1});
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.addInitScript({content:'window.__name = value => value;'});
  await page.goto(`${url}/${world?'':'?mode=combat&performance=1'}`,{waitUntil:'commit'});
  await page.waitForFunction(()=>(window as any).__gameDebug?.getState().ready,undefined,{timeout:50_000});
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:mobile?2:1});
  if(cave) {
    await page.evaluate(async()=>{
      const d=(window as any).__gameDebug,p=d.getEntity('gravelmaw_mouth_portal');
      d.teleport(p.interactionPosition??p.position);
      await d.callTool('corealm_interact',{entityId:p.id,interaction:'enter'});
    });
    await page.waitForFunction(()=>(window as any).__gameDebug.getState().regionId==='gravelmaw'
      && !document.querySelector('.portal-transition'),undefined,{timeout:35_000});
  }
  const tap = async (x:number,y:number,jitter=false) => {
    if(mobile) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      await page.waitForTimeout(100);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } else {
      await page.mouse.move(x,y); await page.mouse.down();
      if(jitter) await page.mouse.move(x+8,y+4,{steps:2});
      await page.mouse.up();
    }
  };
  const target = await page.evaluate(async world => {
    const w=window as any,d=w.__gameDebug;
    if(!world) {
      await w.__featureLab.equipPlayer('mainHand','worn_sword');
      await w.__featureLab.spawnTarget('creature','species:goblin_archer',{distance:4});
      return w.__featureLab.getState().target.entityId as string;
    }
    const player=d.getPlayerPosition();
    const candidates=d.getEntities().filter((e:any)=>e.archetype==='enemy'&&e.health>0&&e.regionId===d.getState().regionId);
    candidates.sort((a:any,b:any)=>Math.hypot(a.position.x-player.x,a.position.z-player.z)-Math.hypot(b.position.x-player.x,b.position.z-player.z));
    if(!candidates[0])throw Error('No live creature near spawn');
    return candidates[0].id as string;
  },world);
  report.target=target;
  if(world) await page.evaluate(id=>{
    const d=(window as any).__gameDebug,e=d.getEntity(id);
    d.teleport([e.position[0]-3,e.position[1],e.position[2]]);
  },target);
  await page.waitForFunction(id=>{
    const w=window as any; return w.__gameDebug.getDrawnBounds(id)
      &&w.__gameDebug.getEntityViewStats().residency.pending===0;
  },target,{timeout:20_000});
  if(!world) await page.waitForFunction(()=>!(window as any).__renderDistanceLab.shaders()?.waiting,
    undefined,{timeout:10_000});
  const closeLab=page.getByRole('button',{name:'Close Feature lab',exact:true});
  if(!world && await closeLab.isVisible()) await closeLab.click();
  const point = await page.evaluate(id=>{
    const w=window as any,b=w.__gameDebug.getDrawnBounds(id);
    return w.__interactionFeedback.project([(b.min.x+b.max.x)/2,b.min.y+(b.max.y-b.min.y)*.55,(b.min.z+b.max.z)/2]);
  },target);
  report.point=point;
  report.pick = await page.evaluate(([x,y])=>({pick:(window as any).__interactionFeedback.pick(x,y),
    element:document.elementFromPoint(x,y)?.outerHTML.slice(0,300),width:innerWidth,height:innerHeight}),point);
  await page.evaluate(()=>{
    const w=window as any; w.__pointerEvents=[];
    for(const type of ['pointerdown','pointerup','pointercancel'])window.addEventListener(type,event=>{
      const e=event as PointerEvent;w.__pointerEvents.push({type:e.type,x:e.clientX,y:e.clientY,pointer:e.pointerType,target:(e.target as Element)?.tagName});
    },true);
  });
  const healthBefore=await page.evaluate(id=>(window as any).__gameDebug.getEntity(id).combat.health,target);
  report.healthBefore=healthBefore;
  await tap(point[0],point[1],true);
  await page.waitForFunction(id=>(window as any).__gameDebug.getState().combatTargetId===id,target,{timeout:1000});
  await page.waitForTimeout(100);
  report.attack=await page.evaluate(()=>({state:(window as any).__gameDebug.getState(),feedback:(window as any).__interactionFeedback.snapshot()}));
  assert.equal(report.attack.state.combatTargetId,target,'Pointer jitter must not cancel attack');
  assert.equal(report.attack.state.selectedEntityId,target);
  const selected=report.attack.feedback.markers.find((m:any)=>m.name===`highlight-${target}`);
  assert.ok(selected?.visible&&selected.ready); assert.ok(selected.groundError<.035);
  assert.ok(!selected.children.includes('pip'));
  await page.screenshot({path:`${out}/selected.png`});
  await page.waitForFunction(({id,health})=>(window as any).__gameDebug.getEntity(id).combat.health<health,
    {id:target,health:healthBefore},{timeout:world?12_000:5000});
  report.damage=healthBefore-(await page.evaluate(id=>(window as any).__gameDebug.getEntity(id).combat.health,target));
  // Real input interrupts combat, and the drawn player must move on the next few frames.
  const stick=mobile?await page.getByRole('slider',{name:'Move',exact:true}).boundingBox():null;
  if(mobile)assert.ok(stick);
  await page.evaluate(mobile=>{
    const w=window as any; w.__movementSamples=[];
    window.addEventListener(mobile?'pointerdown':'keydown',event=>{
      const began=event.timeStamp;w.__movementOrigin=w.__gameDebug.getPlayerPosition();
      const frame=()=>{
        w.__movementSamples.push({ms:performance.now()-began,position:w.__gameDebug.getPlayerPosition(),drawn:w.__interactionFeedback.snapshot().playerDrawn,
          combat:w.__gameDebug.getState().combatTargetId});
        if(performance.now()-began<600)requestAnimationFrame(frame);
      };requestAnimationFrame(frame);
    },{capture:true,once:true});
  },mobile);
  if(stick) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width/2+30,y:stick.y+stick.height/2,id:2}]});
  } else await page.keyboard.down('d');
  await page.waitForTimeout(450);
  if(mobile) await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await page.keyboard.up('d');
  await page.waitForTimeout(200);
  report.movement=await page.evaluate(()=>({origin:(window as any).__movementOrigin,samples:(window as any).__movementSamples}));
  const origin=report.movement.origin;
  const first=report.movement.samples.find((s:any)=>s.combat===null&&Math.hypot(s.position.x-origin.x,s.position.z-origin.z)>.002);
  assert.ok(first&&first.ms<100,`Movement started at ${first?.ms} ms`);
  assert.ok(Math.hypot(first.drawn[0]-first.position.x,first.drawn[2]-first.position.z)<.003,
    'The drawn player must use the current movement pose');
  assert.ok(report.movement.samples.some((s:any)=>s.combat===null),'Direct input must cancel combat');
  report.firstMovementMs=first.ms;
  // Select clear ground through the shared read-only picker, then send actual pointer input there.
  const ground=await page.evaluate(()=>{
    const w=window as any, width=innerWidth,height=innerHeight;
    for(const [u,v] of [[.73,.67],[.28,.65],[.7,.5],[.33,.5]] as const) {
      const x=width*u,y=height*v,p=w.__interactionFeedback.pick(x,y);
      const player=w.__gameDebug.getPlayerPosition();
      if(p&&!p.entityId && document.elementFromPoint(x,y)?.tagName==='CANVAS'
        && w.__gameDebug.getNavPath([player.x,player.y,player.z],p.point))return {x,y,point:p.point};
    }return null;
  }); assert.ok(ground,'No clear ground for movement feedback');
  const beforeWalk=await page.evaluate(()=>(window as any).__gameDebug.getPlayerPosition());
  await tap(ground.x,ground.y);
  // Query on the next animation frame, not after waiting for the shader queue to drain.
  report.walk=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve((window as any).__interactionFeedback.snapshot()))));
  const walk=report.walk.markers.find((m:any)=>m.name==='walk-destination');
  assert.ok(walk?.visible&&walk.ready,'Walk marker must be ready on the first frame');
  assert.ok(walk.groundError<.035,`Walk ring floats ${walk.groundError} m above the ground`);
  assert.deepEqual(walk.children,['walk-ring','walk-beam']);
  await page.screenshot({path:`${out}/walk.png`});
  {
    // Hold the world tick so an old route cancellation is definitely still queued when
    // the next real ground click arrives. Rendering and input keep running while paused.
    await page.evaluate(()=>(window as any).__gameDebug.setPaused(true));
    await page.keyboard.down('d'); await page.waitForTimeout(40); await page.keyboard.up('d');
    const cancelled=await page.evaluate(()=>(window as any).__interactionFeedback.snapshot());
    assert.equal(cancelled.markers.find((m:any)=>m.name==='walk-destination').visible,false,
      'Direct movement must clear the previous destination immediately');
    await page.waitForTimeout(40); await tap(ground.x,ground.y);
    const replacement=await page.evaluate(()=>(window as any).__interactionFeedback.snapshot().markers.find((m:any)=>m.name==='walk-destination'));
    assert.ok(replacement.visible,'The replacement ground click must show its destination');
    await page.evaluate(()=>(window as any).__gameDebug.setPaused(false));
    await page.waitForTimeout(250);
    report.replacedWalk=await page.evaluate(()=>(window as any).__interactionFeedback.snapshot().markers.find((m:any)=>m.name==='walk-destination'));
    assert.ok(report.replacedWalk.visible,'An old cancellation must not erase newer walk feedback');
    assert.deepEqual(report.replacedWalk.position,replacement.position);
  }
  await page.waitForTimeout(500);
  report.afterWalk=await page.evaluate(()=>({player:(window as any).__gameDebug.getPlayerPosition(),
    navigation:(window as any).__gameDebug.getNavigationState()}));
  assert.ok(Math.hypot(report.afterWalk.player.x-beforeWalk.x,report.afterWalk.player.z-beforeWalk.z)>.1,
    'Clicking clear ground must move the player');
  report.picking=await page.evaluate(()=>{
    const w=window as any,times:number[]=[];
    for(let i=0;i<30;i++) {const at=performance.now();w.__interactionFeedback.pick(innerWidth*(.2+(i%6)*.11),innerHeight*(.3+Math.floor(i/6)*.08));times.push(performance.now()-at);}
    return {maxMs:Math.max(...times),meanMs:times.reduce((a,b)=>a+b,0)/times.length};
  });
  assert.deepEqual(errors,[]); report.passed=true;
  console.log(JSON.stringify({out,target,firstMovementMs:report.firstMovementMs,damage:report.damage,picking:report.picking,walk},null,2));
} finally {
  if(activePage && !activePage.isClosed()) {
    report.final = await activePage.evaluate(id=>{
      const w=window as any;return {state:w.__gameDebug?.getState(),entity:w.__gameDebug?.getEntity(id),
        player:w.__gameDebug?.getPlayerPosition(),lab:w.__featureLab?.getState(),pointerEvents:w.__pointerEvents};
    },report.target).catch(()=>null);
    if(!report.passed)await activePage.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  }
  await writeFile(`${out}/report.json`,JSON.stringify({...report,errors},null,2));
  await browser.close();await close();deadline();
}
