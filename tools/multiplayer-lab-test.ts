import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_LAB_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";

const clearDeadline = installTestDeadline("multiplayer lab", 60_000);
const started = Date.now(); const out = "test-results/multiplayer-lab"; await mkdir(out, { recursive: true });
const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Multiplayer lab", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_LAB_CONTENT_VERSION, seed: 1337, capacity: 1000, population: 0, availability: "available" };
const secondWorld = { ...world, worldId: "second-yard", name: "Independent world" };
const fullWorld={...world,worldId:"one-slot",name:"One slot",capacity:1};
const mismatch={...world,worldId:"incompatible",name:"Incompatible",protocolVersion:999};
const unavailable={...world,worldId:"missing",name:"Unavailable"};
const database=`${out}/restart-${Date.now()}.sqlite`;
const startHost=(port=0)=>startReferenceServer({port, worlds:[world,secondWorld,fullWorld],storage:new SqliteWorldStorage(database),build:()=>createMultiplayerLabWorld(),
  authentication:{authenticate:async(token:string)=>({playerId:token.replace("guest:",""),name:token.replace("guest:","")})}});
let server=await startHost();
const game = await startGameServer();
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const errors: string[] = []; const checks: Record<string, boolean> = {};
try {
  const pages = await Promise.all(["alice", "bob"].map(async (name) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(({ descriptor, name }) => {
      window.__COREALM_MULTIPLAYER__ = descriptor;
      localStorage.setItem("corealm.settings.v1", JSON.stringify({ renderScale: 0.7, shadowQuality: "low", drawDistance: "near", music: 0, ambient: 0, sfx: 0 }));
    }, { descriptor: [world, secondWorld, fullWorld, mismatch, unavailable].map((entry) => ({ ...entry, endpoint: `ws://127.0.0.1:${server.port}/` })), name });
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message)); page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${game.url}/index.html?mode=combat&multiplayer=1`);
    await page.waitForFunction(() => !!window.__multiplayerLab, null, { timeout: 25_000 });
    await page.getByRole("textbox", { name: "Development guest name" }).fill(name);
    return page;
  }));
  const [a, b] = pages;
  if (!a || !b) throw new Error("Missing browser contexts");
  checks.explicitJoin = (await a.locator("#multiplayer-selector").getAttribute("data-phase")) !== "connected";
  for (const page of pages) {await page.locator(".worlds__row--world input").first().check();await page.getByRole("button", { name: "Join world", exact: true }).click();}
  for (const page of pages) await page.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: 5000 });
  await b.waitForFunction(() => (window.__multiplayerLab!.observe() as { players: unknown[] }).players.length === 1);
  const before = await a.evaluate(() => window.__multiplayerLab!.observe()) as { player: { position: number[] } };
  await a.locator("canvas").first().click({ position: { x: 600, y: 300 } });
  await a.keyboard.down("d"); await a.waitForTimeout(500); await a.keyboard.up("d");
  await b.waitForFunction((origin) => {
    const position = (window.__multiplayerLab!.observe() as { players: { position: number[] }[] }).players[0]!.position;
    return Math.hypot(position[0]! - origin[0]!, position[2]! - origin[2]!) > 0.5;
  }, before.player.position, { timeout: 5000 });
  const after = await a.evaluate(() => window.__multiplayerLab!.observe()) as { player: { position: number[] } };
  checks.realMovement = Math.hypot(after.player.position[0]! - before.player.position[0]!, after.player.position[2]! - before.player.position[2]!) > 0.5;
  checks.remoteVisibility = true;
  await a.screenshot({ path: `${out}/two-players.png`, timeout: 5000 });
  // Deterministic skill setup only. Movement and starting the gather still use real browser input.
  for (const hosted of server.worlds.values()) { const alice = hosted.runtime.players.get("alice"); if (alice) alice.store.get().skills.mining.level = 99; }
  const oreBefore = await a.evaluate(() => (window.__multiplayerLab!.observe() as { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } }).inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "grithe_ore" ? slot.quantity : 0), 0));
  await a.getByRole("button", { name: "Mine copper" }).click();
  await a.waitForFunction((before) => (window.__multiplayerLab!.observe() as { inventory: { slots: ({ itemId: string; quantity: number } | null)[] } }).inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "grithe_ore" ? slot.quantity : 0), 0) > before, oreBefore, { timeout: 8000 });
  const interaction = await a.evaluate(() => window.__multiplayerLab!.observe());
  checks.authoritativeInteractionAccepted = (await a.locator("#multiplayer-selector [role=status]").textContent()) === "Accepted by world";
  checks.productionGatherAwardedInventory = true;
  const sessionId=await a.evaluate(()=>(window.__multiplayerLab!.observe() as {sessionId:string}).sessionId);
  for(const hosted of server.worlds.values())for(const peer of hosted.peers.values())if(peer.playerId==="alice")peer.ws.terminate();
  await a.waitForFunction(old=>(window.__multiplayerLab!.observe() as {sessionId:string}).sessionId!==old && document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected",sessionId,{timeout:5000});
  checks.reconnectSnapshot=true;
  await a.getByRole("radio", { name: "Independent world", exact: true }).check();
  await a.getByRole("button", { name: "Join world", exact: true }).click();
  await a.waitForFunction(() => document.querySelector("#multiplayer-selector")?.getAttribute("data-phase") === "connected", null, { timeout: 5000 });
  await b.waitForFunction(() => (window.__multiplayerLab!.observe() as {players:unknown[]}).players.length === 0, null, {timeout:5000});
  checks.separateWorldIsolation = (await a.evaluate(() => (window.__multiplayerLab!.observe() as {players:unknown[]}).players.length)) === 0;
  checks.independentProgression = (await a.evaluate(() => (window.__multiplayerLab!.observe() as {inventory:{slots:({itemId:string}|null)[]}}).inventory.slots.some(slot=>slot?.itemId==="grithe_ore"))) === false;
  await a.locator(".worlds__row--local input").check(); await a.getByRole("button", { name: "Leave world", exact: true }).click();
  await b.waitForFunction(() => (window.__multiplayerLab!.observe() as { players: unknown[] }).players.length === 0, null, { timeout: 5000 });
  checks.disconnectCleanup = true;
  const joinOption=async(page:typeof a,index:number,phase:string)=>{
    await page.locator(".worlds__row--world input").nth(index).check();
    if(phase==="incompatible"){
      if(!await page.getByRole("button",{name:"Join world",exact:true}).isDisabled())throw new Error("Incompatible join enabled");
      return;
    }
    await page.getByRole("button",{name:"Join world",exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")===expected,phase,{timeout:5000});
  };
  await joinOption(a,2,"connected"); await joinOption(b,2,"full");
  checks.fullWorldUI=(await a.locator("#multiplayer-selector").getAttribute("data-phase"))==="connected";
  await b.screenshot({path:`${out}/full-world.png`,timeout:5000});
  await joinOption(b,3,"incompatible"); checks.versionMismatchUI=true;
  await joinOption(b,4,"unavailable"); checks.unavailableUI=true;
  for(const page of pages){await page.locator(".worlds__row--local input").check();await page.getByRole("button",{name:"Leave world",exact:true}).click();}
  const port=server.port; await server.close(); server=await startHost(port);
  await joinOption(a,0,"connected");
  checks.restartPersistence=await a.evaluate(()=>(window.__multiplayerLab!.observe() as {inventory:{slots:({itemId:string}|null)[]}}).inventory.slots.some(slot=>slot?.itemId==="grithe_ore"));
  await joinOption(b,0,"connected");
  const hosted=[...server.worlds.values()].find(entry=>entry.runtime.descriptor.worldId==="yard")!;
  const ore=hosted.runtime.entities.get("multiplayer:ore")!;
  const oreCount=()=>["alice","bob"].reduce((sum,id)=>sum+hosted.runtime.players.get(id)!.store.get().inventory.slots.reduce((count,slot)=>count+(slot?.itemId==="grithe_ore"?slot.quantity:0),0),0);
  for(const id of ["alice","bob"]){const player=hosted.runtime.players.get(id)!;player.api.stop();player.store.get().player.position=[6,0,0];player.store.get().skills.mining.level=99;}
  ore.state="available";ore.resource!.remaining=1;ore.resource!.maxYields=1;delete hosted.runtime.shared.nodes[ore.id];
  const contestedBefore=oreCount();
  for(const page of pages)await page.getByRole("button",{name:"Mine copper",exact:true}).click();
  const contestDeadline=Date.now()+8000;
  while(oreCount()===contestedBefore&&Date.now()<contestDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  checks.atomicResourceClaim=oreCount()===contestedBefore+1&&ore.resource!.remaining===0;
  const lootId="multiplayer:loot",lootPosition=[6,0,0] as const;
  hosted.runtime.entities.add({id:lootId,name:"Fixture loot",archetype:"loot",tier:1,regionId:"fallowmarch",position:lootPosition,state:"available",interactions:["inspect","loot"],view:{assetId:"crate_wood",scale:1}});
  hosted.runtime.shared.lootPiles[lootId]={position:lootPosition,items:[{itemId:"grithe_ore",quantity:1}],expiresAtMs:hosted.runtime.clock.elapsedMs+60_000,ownerOnly:false};
  const lootBefore=oreCount();
  for(const page of pages){await page.getByRole("button",{name:"Open fixture loot",exact:true}).click();await page.getByRole("dialog",{name:"Fixture loot contents"}).waitFor({state:"visible",timeout:5000});}
  checks.humanLootOpens=true;
  await a.screenshot({path:`${out}/loot-open.png`,timeout:5000});
  await Promise.all(pages.map(page=>page.getByRole("dialog",{name:"Fixture loot contents"}).getByRole("button").first().click({timeout:1500})));
  const lootDeadline=Date.now()+3000;while(oreCount()===lootBefore&&Date.now()<lootDeadline)await new Promise(resolve=>setTimeout(resolve,30));
  checks.atomicLootClaim=oreCount()===lootBefore+1&&!hosted.runtime.shared.lootPiles[lootId];
  const alice=hosted.runtime.players.get("alice")!;alice.store.get().world.recoveryCache={id:"recovery:alice",position:lootPosition,regionId:"fallowmarch",items:[{itemId:"grithe_ore",quantity:2}],expiresAtMs:hosted.runtime.clock.elapsedMs+60_000};
  hosted.runtime.entities.add({id:"recovery:alice",name:"Recovery Cache",archetype:"recovery_cache",tier:1,regionId:"fallowmarch",position:lootPosition,state:"available",interactions:["inspect","loot"],view:{assetId:"crate_wood",scale:1}});
  await a.getByRole("button",{name:"Open recovery cache",exact:true}).click();
  await a.getByRole("dialog",{name:"Recovery Cache contents"}).waitFor({state:"visible",timeout:5000});
  checks.privateRecoveryCache=await b.evaluate(()=>(window.__multiplayerLab!.observe() as {entities:{id:string}[]}).entities.every(entity=>entity.id!=="recovery:alice"));
  const recoveryBefore=oreCount();
  await a.getByRole("dialog",{name:"Recovery Cache contents"}).getByRole("button").first().click();
  const recoveryDeadline=Date.now()+3000;while(oreCount()===recoveryBefore&&Date.now()<recoveryDeadline)await new Promise(resolve=>setTimeout(resolve,30));
  checks.humanRecoveryOpens=oreCount()===recoveryBefore+2&&!alice.store.get().world.recoveryCache;
  const frog=hosted.runtime.entities.get("multiplayer:frog")!;
  alice.api.stop();alice.store.get().player.position=[frog.position[0]-.7,frog.position[1],frog.position[2]];
  alice.store.get().skills.melee.level=99;alice.store.get().equipment.mainHand={itemId:"worn_sword",quantity:1};
  alice.random.get("loot").setState(0);alice.random.get("combat").setState(0);
  const frogRuntime=alice.combat.runtimeFor(alice.store.get(),frog);frogRuntime.health=1;
  const combatXp=alice.store.get().skills.melee.xp;
  await a.getByRole("button",{name:"Attack fixture frog",exact:true}).click();
  const killDeadline=Date.now()+7000;while(frogRuntime.state!=="dead"&&Date.now()<killDeadline)await new Promise(resolve=>setTimeout(resolve,30));
  checks.authoritativeCombat=frogRuntime.state==="dead"&&alice.store.get().skills.melee.xp>combatXp;
  const combatPile=hosted.runtime.entities.all().find(entity=>entity.archetype==="loot"&&entity.id.startsWith("loot_"));
  checks.combatLootHasProductionView=!!combatPile?.view?.assetId;
  await a.waitForFunction(id=>(window.__multiplayerLab!.observe() as {entities:{id:string}[]}).entities.some(entity=>entity.id===id),combatPile!.id,{timeout:5000});
  await a.getByRole("button",{name:"Open combat loot",exact:true}).click();
  await a.locator(`.loot-reveal[data-source-id="${combatPile!.id}"]`).waitFor({state:"visible",timeout:5000});
  await a.screenshot({path:`${out}/combat-loot.png`,timeout:5000});
  checks.combatLootPublic=await b.evaluate(id=>(window.__multiplayerLab!.observe() as {entities:{id:string}[]}).entities.some(entity=>entity.id===id),combatPile!.id);
  checks.forgedWriteRejected=await a.evaluate(({port,protocolVersion,contentVersion})=>new Promise<boolean>(resolve=>{
    const socket=new WebSocket(`ws://127.0.0.1:${port}/`);const timer=setTimeout(()=>{socket.close();resolve(false);},4000);
    socket.onopen=()=>socket.send(JSON.stringify({type:"join",providerId:"reference",worldId:"yard",token:"guest:forger",protocolVersion,contentVersion}));
    socket.onmessage=event=>{const message=JSON.parse(event.data);
      if(message.type==="joined")socket.send(JSON.stringify({type:"command",envelope:{sessionId:message.sessionId,sequence:1,operation:1,command:{method:"grantCurrency",args:[999999]}}}));
      if(message.type==="error"){clearTimeout(timer);socket.close();resolve(message.error.code==="INVALID_MESSAGE");}
    };
  }),{port:server.port,protocolVersion:WORLD_PROTOCOL_VERSION,contentVersion:WORLD_LAB_CONTENT_VERSION});
  const crowdOrigin=alice.store.get().player.position;
  for(let i=0;i<320;i++)hosted.runtime.join(`visibility-${i}`).store.get().player.position=[crowdOrigin[0]+(i-160)*.09,0,crowdOrigin[2]+4];
  hosted.runtime.join("visibility-far").store.get().player.position=[crowdOrigin[0],0,crowdOrigin[2]+40];
  await a.waitForFunction(()=>{const state=window.__multiplayerLab!.observe() as {players:unknown[];visiblePlayerIds:string[]};return state.players.length>=320&&state.visiblePlayerIds.length===256;},null,{timeout:5000});
  const visibleBefore=await a.evaluate(()=>(window.__multiplayerLab!.observe() as {visiblePlayerIds:string[]}).visiblePlayerIds);
  checks.remoteDrawCap=visibleBefore.length===256;checks.remoteDistanceCulled=!visibleBefore.includes("visibility-far");
  await a.locator("canvas").first().click({position:{x:600,y:330}});
  await a.keyboard.down("d");await a.waitForTimeout(900);await a.keyboard.up("d");
  await a.waitForFunction(before=>{const shown=(window.__multiplayerLab!.observe() as {visiblePlayerIds:string[]}).visiblePlayerIds;return shown.some(id=>!before.includes(id));},visibleBefore,{timeout:5000});
  checks.visiblePlayersFollowMovement=true;
  await a.screenshot({path:`${out}/distance-limited-crowd.png`,timeout:5000});
  await a.locator(".worlds__row--local input").check(); await a.getByRole("button", { name: "Leave world", exact: true }).click();
  await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {visiblePlayerIds:string[]}).visiblePlayerIds.length===0,null,{timeout:5000});
  checks.visiblePlayersClearOnLeave=true;
  checks.noRuntimeErrors = errors.length === 0; checks.under60Seconds = Date.now() - started < 60_000;
  const report = { passed: Object.values(checks).every(Boolean), checks, before, after, interaction, errors, durationMs: Date.now() - started };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks, errors }));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: String(error), checks, errors,
    worlds: [...server.worlds.values()].map((hosted) => hosted.runtime.snapshot()) }, null, 2));
  throw error;
} finally { await browser.close(); await game.close(); await server.close(); clearDeadline(); }
