import "./lib/repoContent.js";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {cpus,totalmem} from "node:os";
import {WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import { createRepoPackedWorld } from "./lib/packed-world.js";
import {startReferenceServer} from "../game/src/multiplayer/referenceServer.js";
import {SqliteWorldStorage} from "../game/src/multiplayer/sqliteStorage.js";
import {startGameServer} from "./lib/server.js";
import {installTestDeadline} from "./lib/deadline.js";

// Render evidence only: 999 server fixture actors and one actual network/browser client.
// Admission, client activity, and server capacity are measured by multiplayer-capacity.ts.
const clearDeadline=installTestDeadline("multiplayer production render",120_000);
const out="test-results/multiplayer-render";await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"render",worldId:"authored",name:"Crowded Corealm",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"authored",seed:1337,capacity:1000,population:0,availability:"available"};
const ports=await createRepoPackedWorld(1337);
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:async()=>ports,
  authentication:{authenticate:async()=>({playerId:"observer",name:"Observer"})}});
const game=await startGameServer();
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const errors:string[]=[];
try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(descriptor=>{
    window.__COREALM_MULTIPLAYER__=descriptor;window.__COREALM_DEVELOPMENT_GUESTS__=true;
    localStorage.setItem("corealm.settings.v1",JSON.stringify({renderScale:.7,shadowQuality:"low",drawDistance:"near",music:0,ambient:0,sfx:0}));
  },{...world,endpoint:`ws://127.0.0.1:${server.port}/`});
  const page=await context.newPage();page.on("pageerror",error=>errors.push(error.message));
  // tsx's named-function helper is needed by the serialized frame sampler.
  await page.addInitScript("window.__name = (fn) => fn");
  await page.goto(`${game.url}/index.html`);await page.waitForFunction(()=>!!window.__multiplayerLab,null,{timeout:60_000});
  await page.locator(".worlds__row--world input").first().check();
  await page.getByRole("button",{name:"Join world",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected",null,{timeout:5000});
  const runtime=[...server.worlds.values()][0]!.runtime;
  const sample=async(seconds:number)=>page.evaluate(async seconds=>{
    const frames:number[]=[];let previous=performance.now();const end=previous+seconds*1000;
    await new Promise<void>(resolve=>{const frame=(now:number)=>{frames.push(now-previous);previous=now;if(now<end)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
    const sorted=frames.slice(3).sort((a,b)=>a-b),at=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;
    const canvas=document.querySelector("canvas")!,gl=canvas.getContext("webgl2"),extension=gl?.getExtension("WEBGL_debug_renderer_info");
    const debug=Reflect.get(window,"__gameDebug") as unknown as {getMetrics():unknown};
    return {frames:sorted.length,p50FrameMs:at(.5),p95FrameMs:at(.95),impliedMedianFps:1000/at(.5),metrics:debug.getMetrics(),
      gpu:extension?gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL):"unknown",
      actors:(window.__multiplayerLab!.observe() as {players:unknown[]}).players.length,
      drawnActors:(window.__multiplayerLab!.observe() as {visiblePlayerIds:string[]}).visiblePlayerIds.length};
  },seconds);
  const baseline=await sample(5);
  const actorIds:string[]=[];
  for(let index=0;index<999;index++){
    const id=`render-${index}`,player=runtime.join(id);actorIds.push(id);
    const x=ports.spawn[0]+(index%32-15.5)*.8,z=ports.spawn[2]+(Math.floor(index/32)-15.5)*.8;
    player.store.get().player.position=ports.nav.nearestWalkable([x,ports.spawn[1],z])??ports.spawn;
  }
  const move=setInterval(()=>{for(const id of actorIds)runtime.players.get(id)!.execute({method:"steer",args:[Math.sin(runtime.clock.tick/10)*.2,0]});},300);
  try{
    await page.waitForFunction(()=>(window.__multiplayerLab!.observe() as {players:unknown[]}).players.length===999,null,{timeout:10_000});
    await page.waitForTimeout(2000);const crowded=await sample(15);
    await page.screenshot({path:`${out}/crowded.png`,timeout:5000});
    const report={scope:"Production authored scene, 999 synthetic server actors plus one browser. Not network capacity evidence.",
      hardware:{cpu:cpus()[0]?.model,memory:totalmem()},settings:{viewport:[1280,800],renderScale:.7,shadows:"low",drawDistance:"near"},
      baseline,crowded,errors,passed:crowded.actors===999&&crowded.drawnActors===256&&errors.length===0};
    await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
  }finally{clearInterval(move);}
}catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),errors}));throw error;}
finally{await browser.close();await game.close();await server.close();clearDeadline();}
