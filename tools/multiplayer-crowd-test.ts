import "./lib/repoContent.js";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {WORLD_PROTOCOL_VERSION,type WorldDescriptor} from "../game/src/contracts.js";
import {createMultiplayerLabWorld} from "../game/src/multiplayer/labWorld.js";
import {startReferenceServer} from "../game/src/multiplayer/referenceServer.js";
import {SqliteWorldStorage} from "../game/src/multiplayer/sqliteStorage.js";
import {startGameServer} from "./lib/server.js";
import {installTestDeadline} from "./lib/deadline.js";
import {gearAppearanceParts} from "../game/src/render/equipmentVisuals.js";
import {CROWD_EQUIPMENT as kits} from "./lib/crowdEquipment.js";

const clearDeadline=installTestDeadline("multiplayer crowd lab",60_000);
const out="test-results/multiplayer-crowd";await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"reference",worldId:"yard",name:"Crowd lab",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"lab",seed:1337,capacity:1000,population:0,availability:"available"};
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:()=>createMultiplayerLabWorld(),
  authentication:{authenticate:async()=>({playerId:"observer",name:"Observer"})}});
const game=await startGameServer(),browser=await chromium.launch({headless:true,args:["--use-angle=d3d11"]});
const errors:string[]=[],checks:Record<string,boolean>={};
type State={player:{position:number[]};players:unknown[];visiblePlayerIds:string[];presentation:{id:string;equipment:Record<string,string>;materials:string[];crowd:boolean;motion:{path:string;time:number}|null}[]};
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.addInitScript(descriptor=>{
    window.__COREALM_MULTIPLAYER__=descriptor;
    localStorage.setItem("corealm.settings.v1",JSON.stringify({renderScale:.7,shadowQuality:"low",drawDistance:"near",music:0,ambient:0,sfx:0}));
  },{...world,endpoint:`ws://127.0.0.1:${server.port}/`});
  await page.goto(`${game.url}/index.html?mode=combat&multiplayer=1`);
  await page.waitForFunction(()=>!!window.__multiplayerLab);
  await page.locator(".worlds__row--world input").first().check();
  await page.getByRole("button",{name:"Join world",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected");
  const runtime=[...server.worlds.values()][0]!.runtime;
  for(let i=0;i<320;i++){
    const player=runtime.join(`crowd-${i}`);player.store.get().player.position=[(i%20-9.5)*1.1,0,(Math.floor(i/20)-7.5)*1.1];
    for(const [slot,itemId] of Object.entries(kits[i%kits.length]!))Reflect.set(player.store.get().equipment,slot,{itemId,quantity:1});
  }
  const observe=()=>page.evaluate(()=>window.__multiplayerLab!.observe()) as Promise<State>;
  await page.waitForFunction(()=>{
    const rows=(window.__multiplayerLab!.observe() as State).presentation;
    return rows.filter(r=>r.crowd).length===224 && rows.filter(r=>r.crowd).every(r=>r.motion?.path==="sampled-rig");
  },null,{timeout:15000});
  const before=await observe();checks.boundedDetail=before.presentation.filter(r=>!r.crowd).length===32;
  checks.allActorsRetained=before.players.length===320&&before.visiblePlayerIds.length===256;
  checks.equipmentPreserved=before.presentation.every(row=>{
    const kit=kits[Number(row.id.split("-")[1])%kits.length]!;
    return Object.entries(kit).every(([slot,id])=>row.equipment[slot]===id);
  });
  const expectedMaterials=kits.map(kit=>Object.values(kit).flatMap(id=>{
    const appearances=gearAppearanceParts(id);if(!appearances.length)throw new Error(`Missing fixture gear: ${id}`);
    return appearances.map(part=>`equipped:${part.assetId}:${part.tint??"native"}:`);
  }));
  await page.waitForFunction(expected=>(window.__multiplayerLab!.observe() as State).presentation.every(row=>
    expected[Number(row.id.split("-")[1])%expected.length]!.every(prefix=>row.materials.some(name=>name.startsWith(prefix))))
  ,expectedMaterials,{timeout:15000}).catch(async error=>{
    await writeFile(`${out}/material-failure.json`,JSON.stringify({state:await observe(),expectedMaterials},null,2));
    await page.screenshot({path:`${out}/material-failure.png`});throw error;
  });
  checks.equippedMeshesAndColoursDrawn=true;
  const metrics=()=>page.evaluate(()=>{
    const debug=Reflect.get(window,"__gameDebug") as unknown as {getMetrics():{drawCalls:number;triangles:number};getEntityViewStats():{crowdGeometry:{sourceTriangles:number;triangles:number;drawCalls:number;shadowDrawCalls:number}}};
    return {render:debug.getMetrics(),views:debug.getEntityViewStats()};
  });
  await page.locator("canvas").first().click({position:{x:700,y:330}});
  await page.keyboard.down("d");await page.waitForTimeout(900);await page.keyboard.up("d");
  const after=await observe();
  checks.realMovement=Math.hypot(after.player.position[0]!-before.player.position[0]!,after.player.position[2]!-before.player.position[2]!)>.5;
  checks.crowdAnimationAdvances=before.presentation.filter(r=>r.crowd).some(r=>{
    const next=after.presentation.find(n=>n.id===r.id);return next?.crowd&&next.motion?.path==="sampled-rig"&&next.motion.time!==r.motion?.time;
  });
  checks.detailFollowsMovement=after.presentation.some(row=>!row.crowd&&before.presentation.some(old=>old.id===row.id&&old.crowd));
  await page.waitForTimeout(2000);
  const simplified=await metrics();await page.screenshot({path:`${out}/simplified.png`});
  checks.reducedCrowdGeometry=simplified.views.crowdGeometry.triangles<simplified.views.crowdGeometry.sourceTriangles*.8;
  checks.sharedCrowdDraws=simplified.views.crowdGeometry.drawCalls<224;
  checks.crowdKeepsShadows=simplified.views.crowdGeometry.shadowDrawCalls===simplified.views.crowdGeometry.drawCalls
    && simplified.views.crowdGeometry.shadowDrawCalls>0;
  const wearer=(await observe()).presentation.reverse().find(row=>row.crowd)!;
  await page.getByLabel("Simplify crowds").uncheck();
  await page.waitForFunction(()=>(window.__multiplayerLab!.observe() as State).presentation.every(r=>!r.crowd));
  await page.waitForTimeout(2000);const detailed=await metrics();
  await page.screenshot({path:`${out}/detailed.png`});
  checks.fewerTriangleSubmissions=simplified.render.triangles<detailed.render.triangles;
  const materialChange={id:wearer.id,
    next:gearAppearanceParts("kaldite_plate").map(part=>`equipped:${part.assetId}:${part.tint??"native"}:`),
    old:gearAppearanceParts(wearer.equipment.body!).map(part=>`equipped:${part.assetId}:${part.tint??"native"}:`)};
  runtime.players.get(wearer.id)!.store.get().equipment.body={itemId:"kaldite_plate",quantity:1};
  const changedMaterials=({id,next,old}:typeof materialChange)=>{
    const row=(window.__multiplayerLab!.observe() as State).presentation.find(row=>row.id===id);
    return !!row && row.equipment.body==="kaldite_plate" && next.every(prefix=>row.materials.some(name=>name.startsWith(prefix)))
      && old.every(prefix=>!row.materials.some(name=>name.startsWith(prefix)));
  };
  await page.waitForFunction(changedMaterials,materialChange,{timeout:10000});
  checks.equipmentChangeReplicates=true;
  await page.getByLabel("Simplify crowds").check();
  await page.waitForFunction(()=>(window.__multiplayerLab!.observe() as State).presentation.filter(r=>r.crowd).length===224);
  checks.toggleRestoresCrowd=true;
  await page.waitForFunction(id=>(window.__multiplayerLab!.observe() as State).presentation.find(row=>row.id===id)?.crowd===true,wearer.id,{timeout:5000});
  await page.waitForFunction(changedMaterials,materialChange,{timeout:5000});
  checks.equipmentSurvivesDetailChange=true;
  const restoredShadows=(await metrics()).views.crowdGeometry;
  checks.shadowsSurviveDetailChange=restoredShadows.shadowDrawCalls===restoredShadows.drawCalls&&restoredShadows.drawCalls>0;
  const changed=(await observe()).presentation.find(row=>row.id===wearer.id);
  await page.screenshot({path:`${out}/changed-armour.png`});
  await page.locator(".worlds__row--local input").check(); await page.getByRole("button", { name: "Leave world", exact: true }).click();
  await page.waitForFunction(()=>(window.__multiplayerLab!.observe() as State).presentation.length===0);
  checks.leaveClearsViews=true;checks.noErrors=errors.length===0;
  const report={checks,before,after,materialChange,changed,simplified,detailed,errors,passed:Object.values(checks).every(Boolean)};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({checks,simplified:simplified.render,detailed:detailed.render,errors}));
  if(!report.passed)process.exitCode=1;
} catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors}));throw error;}
finally{await browser.close();await game.close();await server.close();clearDeadline();}
