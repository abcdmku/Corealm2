import "./lib/repoContent.js";
import {build,preview} from "vite";
import {resolve} from "node:path";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {cpus,totalmem} from "node:os";
import {WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import { createRepoPackedWorld } from "./lib/packed-world.js";
import {startReferenceServer} from "../game/src/multiplayer/referenceServer.js";
import {SqliteWorldStorage} from "../game/src/multiplayer/sqliteStorage.js";
import {startGameServer} from "./lib/server.js";
import {installTestDeadline} from "./lib/deadline.js";
import {CROWD_EQUIPMENT} from "./lib/crowdEquipment.js";

// Render evidence only: 999 server fixture actors and one actual network/browser client.
// Admission, client activity, and server capacity are measured by multiplayer-capacity.ts.
const clearDeadline=installTestDeadline("multiplayer production render",120_000);
const production=process.argv.includes("--production");
const fullGeometry=process.argv.includes("--full-geometry");
if(fullGeometry&&!production)throw new Error("--full-geometry requires --production");
const outputRoot=process.argv.find(arg=>arg.startsWith("--out="))?.slice(6)??"test-results/performance-audit";
const out=`${outputRoot}/${production?"production":"source"}`;await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"render",worldId:"authored",name:"Crowded Corealm",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"authored",seed:1337,capacity:1000,population:0,availability:"available"};
const ports=await createRepoPackedWorld(1337);
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:async()=>ports,
  authentication:{authenticate:async()=>({playerId:"observer",name:"Observer"})}});
// Disposable A/B build: change only the simplifier's early-return condition. Production files stay intact.
const baselineBuild=resolve(out,"full-geometry-build");
if(fullGeometry)await build({root:"game",logLevel:"error",build:{outDir:baselineBuild},plugins:[{
  name:"crowd-geometry-baseline",enforce:"pre",transform(code,id){
    if(!id.replaceAll("\\","/").endsWith("/render/crowdGeometry.ts"))return;
    const guard="if (!ready || count < 192";
    if(!code.includes(guard))throw new Error("Crowd geometry baseline guard changed; update the A/B tool.");
    return code.replace(guard,"if (true || !ready || count < 192");
  },
}]});
const previewServer=production?await preview({root:"game",...(fullGeometry?{build:{outDir:baselineBuild}}:{}),server:{host:"127.0.0.1"},preview:{host:"127.0.0.1",port:0}}):null;
const game=previewServer?{url:previewServer.resolvedUrls!.local[0]!.replace(/\/$/,""),close:()=>new Promise<void>(resolve=>previewServer.httpServer.close(()=>resolve()))}:await startGameServer();
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const errors:string[]=[];
function summarizeProfile(profile:any){
 const nodes=new Map<number,any>(profile.nodes.map((n:any)=>[n.id,n]));const totals=new Map<number,number>();
 for(let i=0;i<(profile.samples?.length??0);i++){const id=profile.samples[i];totals.set(id,(totals.get(id)??0)+(profile.timeDeltas?.[i]??1000));}
 const duration=profile.endTime-profile.startTime;
 return [...totals].map(([id,time])=>({function:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber+1,selfMs:time/1000,wallPercent:time/duration*100})).sort((a,b)=>b.selfMs-a.selfMs).slice(0,35);
}
try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(descriptor=>{
    window.__COREALM_MULTIPLAYER__=descriptor;window.__COREALM_DEVELOPMENT_GUESTS__=true;
    localStorage.setItem("corealm.settings.v1",JSON.stringify({renderScale:.7,shadowQuality:"low",drawDistance:"near",music:0,ambient:0,sfx:0}));
  },{...world,endpoint:`ws://127.0.0.1:${server.port}/`});
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  // tsx's named-function helper is needed by the serialized frame sampler.
  await page.addInitScript("window.__name = (fn) => fn");
  const cdp=await context.newCDPSession(page);await cdp.send("Profiler.enable");await cdp.send("Profiler.setSamplingInterval",{interval:1000});
  await page.addInitScript("window.__auditLongTasks=[];new PerformanceObserver(list=>window.__auditLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})");
  const profile=async(label:string)=>{await cdp.send("Profiler.start");await page.waitForTimeout(6000);const {profile}=await cdp.send("Profiler.stop");await writeFile(out+"/"+label+".cpuprofile",JSON.stringify(profile));return summarizeProfile(profile);};
  const openWorlds=async()=>{
    const panel=page.locator("#multiplayer-selector");
    if(await panel.isVisible().catch(()=>false))return;
    const title=page.getByRole("dialog",{name:"Corealm",exact:true});
    if(!await title.isVisible().catch(()=>false))await page.getByRole("button",{name:"Open menu",exact:true}).click();
    if(await panel.isVisible().catch(()=>false))return;
    await page.getByRole("button",{name:"Worlds",exact:true}).click();
  };
  await page.goto(`${game.url}/index.html`);await page.waitForFunction(()=>!!window.__multiplayerLab,null,{timeout:60_000});
  const boot=await page.evaluate(()=>({readyMs:performance.now(),paint:performance.getEntriesByType("paint").map(e=>({name:e.name,start:e.startTime})),resources:performance.getEntriesByType("resource").map(e=>({url:e.name,encoded:(e as PerformanceResourceTiming).encodedBodySize,transfer:(e as PerformanceResourceTiming).transferSize,duration:e.duration})),telemetry:(Reflect.get(window,"__corealmBootTelemetry") as {snapshot():unknown}|undefined)?.snapshot(),longTasks:Reflect.get(window,"__auditLongTasks")}));
  const offlineProfile=await profile("offline");
  await openWorlds();
  if(await page.locator("#multiplayer-selector").getAttribute("data-phase")==="connected")throw new Error("World joined before explicit selection");
  await page.locator(".worlds__row--world input").first().check();
  await page.getByRole("button",{name:"Join world",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected",null,{timeout:5000});
  await page.getByRole("dialog",{name:"Corealm",exact:true}).waitFor({state:"hidden",timeout:5000});
  const runtime=[...server.worlds.values()][0]!.runtime;
  const sample=async(seconds:number)=>page.evaluate(async seconds=>{
    const frames:number[]=[];let previous=performance.now();const end=previous+seconds*1000;
    await new Promise<void>(resolve=>{const frame=(now:number)=>{frames.push(now-previous);previous=now;if(now<end)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
    const sorted=frames.slice(3).sort((a,b)=>a-b),at=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;
    const canvas=document.querySelector("canvas")!,gl=canvas.getContext("webgl2"),extension=gl?.getExtension("WEBGL_debug_renderer_info");
    const debug=Reflect.get(window,"__gameDebug") as unknown as {getMetrics():unknown;getEntityViewStats():{crowdGeometry:{sourceTriangles:number;triangles:number;drawCalls:number}}};
    return {frames:sorted.length,averageFps:sorted.length*1000/sorted.reduce((sum,ms)=>sum+ms,0),p50FrameMs:at(.5),p95FrameMs:at(.95),impliedMedianFps:1000/at(.5),metrics:debug.getMetrics(),crowdGeometry:debug.getEntityViewStats().crowdGeometry,
      gpu:extension?gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL):"unknown",
      actors:(window.__multiplayerLab!.observe() as {players:unknown[]}).players.length,
      drawnActors:(window.__multiplayerLab!.observe() as {visiblePlayerIds:string[]}).visiblePlayerIds.length};
  },seconds);
  const baseline=await sample(5);const onlineProfile=await profile("online-empty");
  const actorIds:string[]=[];
  for(let index=0;index<999;index++){
    const id=`render-${index}`,player=runtime.join(id);actorIds.push(id);
    if(process.argv.includes("--armour"))for(const [slot,itemId] of Object.entries(CROWD_EQUIPMENT[index%CROWD_EQUIPMENT.length]!))
      Reflect.set(player.store.get().equipment,slot,{itemId,quantity:1});
    const x=ports.spawn[0]+(index%32-15.5)*.8,z=ports.spawn[2]+(Math.floor(index/32)-15.5)*.8;
    player.store.get().player.position=ports.nav.nearestWalkable([x,ports.spawn[1],z])??ports.spawn;
  }
  const move=setInterval(()=>{for(const id of actorIds)runtime.players.get(id)!.execute({method:"steer",args:[Math.sin(runtime.clock.tick/10)*.2,0]});},300);
  try{
    await page.waitForFunction(()=>(window.__multiplayerLab!.observe() as {players:unknown[]}).players.length===999,null,{timeout:10_000});
    await page.waitForTimeout(2000);const crowded=await sample(15);const crowdedProfile=await profile("online-crowd");
    await page.screenshot({path:`${out}/crowded.png`,timeout:5000});
    const report={production,fullGeometry,armour:process.argv.includes("--armour"),boot,profiles:{offline:offlineProfile,online:onlineProfile,crowded:crowdedProfile},serverStages:server.metrics.stages,scope:"Production authored scene, 999 synthetic server actors plus one browser. Not network capacity evidence.",
      hardware:{cpu:cpus()[0]?.model,memory:totalmem()},settings:{viewport:[1280,800],renderScale:.7,shadows:"low",drawDistance:"near"},
      baseline,crowded,errors,passed:crowded.actors===999&&crowded.drawnActors===256&&errors.length===0
        && crowded.crowdGeometry.sourceTriangles>0
        && (fullGeometry?crowded.crowdGeometry.triangles===crowded.crowdGeometry.sourceTriangles
          :crowded.crowdGeometry.triangles<crowded.crowdGeometry.sourceTriangles)};
    await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({production,baseline,crowded,passed:report.passed,report:out+"/report.json"}));if(!report.passed)process.exitCode=1;
  }finally{clearInterval(move);}
}catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),errors}));throw error;}
finally{await browser.close();await game.close();await server.close();clearDeadline();}
