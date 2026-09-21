import "./lib/repoContent.js";
import {chromium,type Page} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import {createInitialState} from "../game/src/state/store.js";
import {startAuthoredTestHost} from "./lib/authoredTestHost.js";
import {startGameServer} from "./lib/server.js";
import {installTestDeadline} from "./lib/deadline.js";

const clearDeadline=installTestDeadline("multiplayer authored integration",120_000);
const started=Date.now(),out="test-results/multiplayer-authored";await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"reference",worldId:"authored",name:"Corealm",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"authored",seed:1337,capacity:1000,population:0,availability:"available"};
const server=await startAuthoredTestHost();console.log("Authored host ready",Date.now()-started);
const game=await startGameServer();
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const checks:Record<string,boolean>={},errors:string[]=[];
try{
  const offline=createInitialState(1337,0);offline.currency=432;
  const openWorlds=async(page:Page)=>{
    const panel=page.locator("#multiplayer-selector");
    if(await panel.isVisible().catch(()=>false))return;
    const title=page.getByRole("dialog",{name:"Corealm",exact:true});
    if(!await title.isVisible().catch(()=>false))await page.getByRole("button",{name:"Open menu",exact:true}).click();
    if(await panel.isVisible().catch(()=>false))return;
    await page.getByRole("button",{name:"Worlds",exact:true}).click();
  };
  const pages=await Promise.all(["alice","bob"].map(async name=>{
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    await context.addInitScript(({descriptor,save})=>{
      window.__COREALM_MULTIPLAYER__=descriptor;window.__COREALM_DEVELOPMENT_GUESTS__=true;
      if(!localStorage.getItem("corealm.save.v1"))localStorage.setItem("corealm.save.v1",JSON.stringify(save));
      localStorage.setItem("corealm.settings.v1",JSON.stringify({renderScale:.7,shadowQuality:"low",drawDistance:"near",music:0,ambient:0,sfx:0}));
    },{descriptor:{...world,endpoint:`ws://127.0.0.1:${server.port}/`},save:offline});
    const page=await context.newPage();page.setDefaultTimeout(5000);const pending=new Set<string>();page.on("request",r=>pending.add(r.url()));page.on("requestfinished",r=>pending.delete(r.url()));page.on("requestfailed",r=>pending.delete(r.url()));page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
    await page.goto(`${game.url}/index.html`,{waitUntil:"domcontentloaded",timeout:15000});
    await page.waitForFunction(()=>!!window.__multiplayerLab,null,{timeout:60_000}).catch(async error=>{
      await page.screenshot({path:`${out}/${name}-boot-failure.png`});
      await writeFile(`${out}/${name}-boot-failure.json`,JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,debug:window.__gameDebug?.getState(),telemetry:(window as any).__corealmBootTelemetry})),null,2));
      console.log(JSON.stringify({name,pending:[...pending],}));
      throw error;
    });
    console.log(`${name} world ready`,Date.now()-started);
    await openWorlds(page);
    await page.getByRole("textbox",{name:"Development guest name"}).fill(name);return page;
  }));
  const a=pages[0]!,b=pages[1]!;console.log("Both worlds ready",Date.now()-started);
  checks.explicitJoin=await a.locator("#multiplayer-selector").getAttribute("data-phase")!=="connected";
  const savedBefore=await a.evaluate(()=>localStorage.getItem("corealm.save.v1"));
  for(const page of pages){await page.locator(".worlds__row--world input").first().check();await page.getByRole("button",{name:"Join world",exact:true}).click();}
  for(const page of pages)await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected",null,{timeout:5000});
  for(const page of pages)await page.getByRole("dialog",{name:"Corealm",exact:true}).waitFor({state:"hidden",timeout:5000});
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as {players:unknown[]}).players.length===1,null,{timeout:5000});
  console.log("Both players joined",Date.now()-started);
  const before=await a.evaluate(()=>window.__multiplayerLab!.observe()) as {player:{position:number[]}};
  await a.locator("canvas").first().click({position:{x:600,y:330}});
  await a.keyboard.down("d");
  try {
    await b.waitForFunction(origin=>{const position=(window.__multiplayerLab!.observe() as {players:{position:number[]}[]}).players[0]!.position;
      return Math.hypot(position[0]!-origin[0]!,position[2]!-origin[2]!)>.4;},before.player.position,{timeout:5000});
  } finally { await a.keyboard.up("d"); }
  checks.authoritativeMovement=true;checks.remoteActor=true;
  checks.offlineSaveUnchanged=savedBefore===await a.evaluate(()=>localStorage.getItem("corealm.save.v1"));
  checks.offlineProgressNotImported=await a.evaluate(()=>(window.__gameDebug!.getState() as {currency:number}).currency===0);
  await a.screenshot({path:`${out}/connected.png`,timeout:5000});
  const after=await a.evaluate(()=>window.__multiplayerLab!.observe());
  await openWorlds(a);
  await a.locator(".worlds__row--local input").check(); await a.getByRole("button", { name: "Leave world", exact: true }).click();
  await a.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="offline",null,{timeout:5000});
  checks.offlineRestored=await a.evaluate(()=>JSON.parse(localStorage.getItem("corealm.save.v1")!).currency===432
    &&(window.__gameDebug!.getState() as {currency:number}).currency===432);
  await a.screenshot({path:`${out}/offline-restored.png`,timeout:5000});
  console.log("Offline state restored",Date.now()-started);
  await a.reload({waitUntil:"domcontentloaded"});await a.waitForFunction(()=>!!window.__multiplayerLab,null,{timeout:45_000});
  checks.offlineReload=await a.evaluate(()=>(window.__gameDebug!.getState() as {currency:number}).currency===432
    &&document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")!=="connected");
  checks.noRuntimeErrors=errors.length===0;checks.withinBudget=Date.now()-started<120_000;
  const report={passed:Object.values(checks).every(Boolean),checks,errors,before,after,durationMs:Date.now()-started};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks,errors,durationMs:report.durationMs}));if(!report.passed)process.exitCode=1;
}catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors},null,2));throw error;}
finally{await browser.close();await game.close();await server.close();clearDeadline();}
