import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import {createMultiplayerLabWorld} from "../game/src/multiplayer/labWorld.js";
import {startReferenceServer} from "../game/src/multiplayer/referenceServer.js";
import {SqliteWorldStorage} from "../game/src/multiplayer/sqliteStorage.js";
import {startGameServer} from "./lib/server.js";
import {installTestDeadline} from "./lib/deadline.js";
import {CROWD_EQUIPMENT} from "./lib/crowdEquipment.js";

const clearDeadline=installTestDeadline("multiplayer motion lab",60_000);
const crowdCount=process.argv.includes("--crowded")?144:64;
const menuMode=process.argv.includes("--menu");
const out="test-results/multiplayer-motion";await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"reference",worldId:"motion",name:"Motion lab",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"lab",seed:1337,capacity:1000,population:0,availability:"available"};
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:()=>createMultiplayerLabWorld(),
  authentication:{authenticate:async()=>({playerId:"observer",name:"Observer"})}});
const game=await startGameServer(),browser=await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
let move:ReturnType<typeof setInterval>|undefined;
const errors:string[]=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>errors.push(e.message));
  const descriptor={...world,endpoint:`ws://127.0.0.1:${server.port}/`};
  await page.addInitScript(descriptor=>{window.__COREALM_MULTIPLAYER__=descriptor;},menuMode?[descriptor,
    {...descriptor,worldId:"full",name:"Karrowmoor",population:1000,availability:"full" as const},
    {...descriptor,worldId:"version",name:"Fallowmarch",protocolVersion:99},
    {...descriptor,worldId:"down",name:"Dusk coast",availability:"unavailable" as const}]:descriptor);
  await page.addInitScript("window.__name = (fn) => fn");
  await page.goto(`${game.url}/index.html?mode=combat&multiplayer=1${menuMode?"&worldMenu=1":""}`);
  await page.waitForFunction(()=>!!window.__multiplayerLab);
  const worldsPanel=page.locator("#multiplayer-selector"), title=page.getByRole("dialog",{name:"Corealm",exact:true});
  const openWorlds=async()=>{
    if(await worldsPanel.isVisible().catch(()=>false))return;
    if(!await title.isVisible().catch(()=>false))await page.getByRole("button",{name:"Open menu",exact:true}).click();
    if(await worldsPanel.isVisible().catch(()=>false))return;
    await page.getByRole("button",{name:"Worlds",exact:true}).click();
  };
  if(menuMode){
    if(!await worldsPanel.isVisible())throw new Error("Configured world menu did not open");
    if(!await title.isVisible())throw new Error("Configured world menu did not open the title dialog");
    await page.getByRole("button",{name:"Back to menu",exact:true}).click();
    if(await worldsPanel.isVisible())throw new Error("World list leaked into root menu");
    await page.screenshot({path:`${out}/main-menu.png`});
    await page.getByRole("button",{name:"Worlds",exact:true}).click();
    if(await page.locator("#multiplayer-selector input[type=radio]:checked").count())throw new Error("Offline world preselected");
    if(!await page.getByRole("button",{name:"Join world",exact:true}).isDisabled())throw new Error("Join enabled without a choice");
    await page.getByRole("button",{name:"Refresh worlds",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>("#multiplayer-selector .worlds__header button")?.disabled===false);
    if(await page.locator("#multiplayer-selector input[type=radio]:checked").count())throw new Error("Refresh selected an offline world");
    for(const name of ["Karrowmoor","Fallowmarch","Dusk coast"]){
      await page.getByRole("radio",{name,exact:true}).check();
      if(!await page.getByRole("button",{name:"Join world",exact:true}).isDisabled())throw new Error("Unavailable world can join");
    }
    await page.getByRole("radio",{name:"Motion lab",exact:true}).check();
    await page.getByRole("button",{name:"Refresh worlds",exact:true}).click();
    if(!await page.evaluate(()=>!!document.activeElement?.closest(".title")))throw new Error("Refresh lost menu focus");
    await page.screenshot({path:`${out}/world-menu.png`});
  }
  await page.getByRole("radio",{name:"Motion lab",exact:true}).check();
  await page.getByRole("button",{name:"Join world",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected");
  if(menuMode)await title.waitFor({state:"hidden",timeout:5000});
  const runtime=[...server.worlds.values()][0]!.runtime;
  for(let i=0;i<crowdCount;i++){
    const bot=runtime.join(`motion-${i}`);bot.store.get().player.position=[-8+i%8*1.8,0,-10+Math.floor(i/8)*1.8];
    bot.store.get().player.name=`motion-${i}`;
    for(const [slot,itemId]of Object.entries(CROWD_EQUIPMENT[i%3]!))Reflect.set(bot.store.get().equipment,slot,{itemId,quantity:1});
  }
  type Observation={presentation:{id:string;motion:{drawnPosition:number[]}|null}[]};
  await page.waitForFunction(count=>(window.__multiplayerLab!.observe() as Observation).presentation.filter(r=>r.motion).length===count,crowdCount);
  move=setInterval(()=>{for(let i=0;i<crowdCount;i++)runtime.players.get(`motion-${i}`)!.execute({method:"steer",args:[.2,0]});},150);
  await page.waitForTimeout(1200);
  const frames=await page.evaluate(async()=>{
    const rows:{at:number;x:number}[]=[];const end=performance.now()+3000;
    await new Promise<void>(resolve=>{const frame=(at:number)=>{
      const actor=(window.__multiplayerLab!.observe() as Observation).presentation.find(r=>r.id==="motion-0");
      if(actor?.motion)rows.push({at,x:actor.motion.drawnPosition[0]!});
      if(at<end)requestAnimationFrame(frame);else resolve();
    };requestAnimationFrame(frame);});return rows;
  });
  const backwards=frames.slice(1).filter((row,i)=>row.x<frames[i]!.x-.001).length;
  let lastMotionAt=frames[0]!.at,maxStationaryMs=0;
  for(let i=1;i<frames.length;i++){
    const row=frames[i]!;
    if(Math.abs(row.x-frames[i-1]!.x)>.0001)lastMotionAt=row.at;
    else maxStationaryMs=Math.max(maxStationaryMs,row.at-lastMotionAt);
  }
  const hoverTargets:(string|null)[]=[];
  for(const y of [400,500,600])for(const x of [350,450,550,650,750,850]){
    await page.mouse.move(x,y);await page.waitForTimeout(85);
    hoverTargets.push(await page.evaluate(()=>{
      const debug=Reflect.get(window,"__gameDebug") as unknown as {getState():{hoveredEntityId:string|null}};
      return debug.getState().hoveredEntityId;
    }));
  }
  await page.mouse.click(750,500);await page.waitForTimeout(300);
  const selected=await page.evaluate(()=>{
    const debug=Reflect.get(window,"__gameDebug") as unknown as {getState():{selectedEntityId:string|null}};
    return debug.getState().selectedEntityId;
  });
  const ignoresRemotePlayers=hoverTargets.every(id=>!id?.startsWith("remote:"))&&!selected?.startsWith("remote:");
  clearInterval(move);move=undefined;
  for(let i=0;i<crowdCount;i++)runtime.players.get(`motion-${i}`)!.execute({method:"steer",args:[0,0]});
  let playerMenu=false;
  for(const [x,y]of [[750,500],[650,450],[550,450],[450,400],[750,400]]){
    await page.keyboard.press("Escape");await page.mouse.click(x!,y!,{button:"right"});
    const menu=page.getByRole("menu");
    if(await menu.count() && (await menu.innerText()).includes("Trade with motion-")){
      const text=await menu.innerText();
      playerMenu=text.includes("Level 1")&&text.includes("Examine")&&text.includes("Walk here")&&text.includes("Player trading is not available yet");
      await page.screenshot({path:`${out}/player-menu.png`});break;
    }
  }
  await page.keyboard.press("Escape");
  const playerFramesPromise=page.evaluate(async()=>{
    const rows:{at:number;position:number[]}[]=[];const end=performance.now()+4200;
    const debug=Reflect.get(window,"__gameDebug") as unknown as {getPlayerMotion():{drawnPosition:number[]}};
    await new Promise<void>(resolve=>{const frame=(at:number)=>{
      rows.push({at,position:debug.getPlayerMotion().drawnPosition});
      if(at<end)requestAnimationFrame(frame);else resolve();
    };requestAnimationFrame(frame);});return rows;
  });
  // Repeat destinations on the same side, then slide a held left button and release.
  for(let i=0;i<8;i++){await page.mouse.click(820,550+i%2*10);await page.waitForTimeout(130);}
  await page.mouse.move(820,550);await page.mouse.down();
  for(let i=0;i<12;i++){await page.mouse.move(820-i*6,550+i*3);await page.waitForTimeout(100);}
  await page.mouse.up();
  const playerFrames=await playerFramesPromise;
  const speeds=playerFrames.slice(1).map((row,i)=>Math.hypot(...row.position.map((v,j)=>v-playerFrames[i]!.position[j]!))/((row.at-playerFrames[i]!.at)/1000));
  const playerTravel=Math.hypot(...playerFrames.at(-1)!.position.map((v,i)=>v-playerFrames[0]!.position[i]!));
  const playerMotionContinuous=playerTravel>1&&Math.max(...speeds)<12;
  const passed=frames.length>30&&frames.at(-1)!.x-frames[0]!.x>1&&backwards===0&&maxStationaryMs<300&&ignoresRemotePlayers&&playerMenu&&playerMotionContinuous&&errors.length===0;
  await page.screenshot({path:`${out}/crowd.png`});
  if(menuMode){
    await openWorlds();
    await page.locator(".worlds__row--local input").check(); await page.getByRole("button", { name: "Leave world", exact: true }).click();
    await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="offline");
    if(await page.locator("#multiplayer-selector input[type=radio]:checked").count())throw new Error("Leave kept a world selected");
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:`${out}/world-menu-mobile.png`});
    await page.keyboard.press("Escape");
    if(await page.getByRole("button",{name:"New game",exact:true}).isDisabled())throw new Error("Offline reset stayed disabled");
    await page.screenshot({path:`${out}/main-menu-mobile.png`});
  }
  await writeFile(`${out}/report.json`,JSON.stringify({passed,crowdCount,maxStationaryMs,backwards,ignoresRemotePlayers,playerMenu,playerMotionContinuous,playerTravel,maxPlayerSpeed:Math.max(...speeds),playerFrames,hoverTargets,selected,errors,frames},null,2));
  console.log(JSON.stringify({passed,crowdCount,maxStationaryMs,backwards,ignoresRemotePlayers,playerMenu,playerMotionContinuous,playerTravel,maxPlayerSpeed:Math.max(...speeds),frames:frames.length,errors}));if(!passed)process.exitCode=1;
}finally{if(move)clearInterval(move);await browser.close();await game.close();await server.close();clearDeadline();}
