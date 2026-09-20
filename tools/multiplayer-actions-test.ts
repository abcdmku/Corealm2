import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startGameServer } from "./lib/server.js";
import { installTestDeadline } from "./lib/deadline.js";
import { setSkillLevel } from "../game/src/state/store.js";
import { SKILL_IDS } from "../game/src/contracts.js";

const clearDeadline = installTestDeadline("multiplayer public actions", 60_000);
const activities=process.argv.includes("--activities");
const invocations=process.argv.includes("--invocations");
const interactions=process.argv.includes("--interactions");
const lifecycle=process.argv.includes("--lifecycle");
const targeting=process.argv.includes("--targeting");
const latencyOnly=process.argv.includes("--latency");
const started=Date.now(), out=`test-results/multiplayer-${targeting?"targeting":activities?"activities":invocations?"invocations":interactions?"interactions":lifecycle?"action-lifecycle":"actions"}`; await mkdir(out,{recursive:true});
const world:WorldDescriptor={providerId:"reference",worldId:"actions",name:"Actions",endpoint:"ws://127.0.0.1:0/",
  protocolVersion:WORLD_PROTOCOL_VERSION,fixture:"lab",seed:1337,capacity:1000,population:0,availability:"available"};
const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:()=>createMultiplayerLabWorld(),
  authentication:{authenticate:async token=>({playerId:token.slice(6),name:token.slice(6)})}});
const game=await startGameServer();
const browser=await chromium.launch({headless:true,args:["--use-angle=d3d11","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const errors:string[]=[], checks:Record<string,boolean>={}, evidence:unknown[]=[];
let failureEvidence:(()=>Promise<unknown>)|undefined;
const captures:{start:number;end:number}[]=[];
const capture=async(page:Page,options:Parameters<Page["screenshot"]>[0])=>{
  if(latencyOnly)return;
  const start=Date.now();await page.screenshot(options);captures.push({start,end:Date.now()});
};
type Observation={actions:{sequence:number;type:string;playerId:string;receivedAt:number}[];activity:{kind:string}|null;
  players:{id:string;meta:{pose:string}}[]; presentation:{id:string;equipment:Record<string,string>;motion:{motion:string;clip:string;drawnPosition:number[]}|null}[]};
const observe=(page:Page)=>page.evaluate(()=>window.__multiplayerLab!.observe() as Observation);
const perform=async(page:Page,label:string)=>{await page.getByRole("combobox",{name:"Multiplayer action",exact:true}).selectOption({label});await page.getByRole("button",{name:"Perform action",exact:true}).click();};
try {
  const openPlayer=async(name:string)=>{
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    if(process.argv.includes("--profile"))await context.addInitScript(()=>{
      const original=WebGL2RenderingContext.prototype.getProgramInfoLog;
      const rows:unknown[]=[];Reflect.set(window,"__shaderStalls",rows);
      WebGL2RenderingContext.prototype.getProgramInfoLog=function(program){
        const start=performance.now(),result=original.call(this,program),ms=performance.now()-start;
        if(ms>20)rows.push({ms,at:performance.timeOrigin+start,sources:this.getAttachedShaders(program)?.map(shader=>this.getShaderSource(shader))});
        return result;
      };
    });
    await context.addInitScript(descriptor=>{window.__COREALM_MULTIPLAYER__=descriptor;
      localStorage.setItem("corealm.settings.v1",JSON.stringify({renderScale:.7,shadowQuality:"low",drawDistance:"near",music:0,ambient:0,sfx:0}));
    },{...world,endpoint:`ws://127.0.0.1:${server.port}/`});
    await context.addInitScript("window.__name = (fn) => fn");
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
    page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
    await page.goto(`${game.url}/index.html?mode=combat&multiplayer=1`);
    await page.waitForFunction(()=>!!window.__multiplayerLab,null,{timeout:25000});
    await page.locator('.dock__btn[data-panel="feature-lab"]').click();
    await page.getByRole("textbox",{name:"Development guest name"}).fill(name);
    await page.locator(".worlds__row--world input").first().check();await page.getByRole("button",{name:"Join world",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector("#multiplayer-selector")?.getAttribute("data-phase")==="connected");return page;
  };
  const pages=targeting?[await openPlayer("alice"),await openPlayer("bob")]:await Promise.all(["alice","bob"].map(openPlayer));
  const [a,b]=pages as [Page,Page], runtime=[...server.worlds.values()][0]!.runtime;
  const profiler=process.argv.includes("--profile")?await b.context().newCDPSession(b):null;
  if(profiler){await profiler.send("Profiler.enable");await profiler.send("Profiler.start");}
  const alice=runtime.players.get("alice")!, bob=runtime.players.get("bob")!, state=alice.store.get();
  const published=new Map<number,number>(),publish=runtime.actions.publish.bind(runtime.actions);
  runtime.actions.publish=(state,action)=>{publish(state,action);published.set(runtime.actions.currentSequence(),Date.now());};
  state.player.position=[10.5,0,0];bob.store.get().player.position=[8,0,-4];
  for(const skill of SKILL_IDS)setSkillLevel(state,skill,99);
  for(const itemId of ["water_essence","earth_essence","fire_essence","mind_rune","chaos_rune","cosmic_rune","silt_minnow","seared_minnow","palewood_log","grithe_ore"]) {
    const slot=state.inventory.slots.indexOf(null);state.inventory.slots[slot]={itemId,quantity:100,slotIndex:slot};
  }
  const frog=runtime.entities.get("multiplayer:frog")!;
  frog.combat!.maxHealth=100000;alice.combat.runtimeFor(state,frog).health=100000;
  if(targeting){
    checks.sequentialJoin=[...runtime.active].join(",")==="alice,bob";
    await perform(b,"Equip sword");
    // Sequential loading gives the production frog time to wander. Place both players around
    // its current position and leave contact margin so a walking target cannot turn this into
    // an out-of-reach miss before the first windup ends.
    state.player.position=[frog.position[0]-.45,0,frog.position[2]-.15];
    bob.store.get().player.position=[frog.position[0]-1,0,frog.position[2]];
    const placement={alice:[...state.player.position],bob:[...bob.store.get().player.position]};
    state.player.health=100000; // The next production health tick clamps to the derived full cap.
    const targetingEvidence=async(label:string)=>{
      const client=(page:Page)=>page.evaluate(()=>{
        const o=window.__multiplayerLab!.observe() as Observation&{phase:string;tick:number;player:{id:string;position:number[];health:number};combat:unknown};
        return {phase:o.phase,tick:o.tick,player:{id:o.player.id,position:o.player.position,health:o.player.health},combat:o.combat,actions:o.actions.slice(-12)};
      });
      const authority=(player:typeof alice)=>({position:[...player.store.get().player.position],health:player.store.get().player.health,combat:structuredClone(player.store.get().combat)});
      return {label,server:{tick:runtime.clock.tick,frog:{position:[...frog.position],runtime:structuredClone(runtime.shared.enemies[frog.id])},
        alice:authority(alice),bob:authority(bob),actions:runtime.actions.since(Math.max(0,runtime.actions.currentSequence()-12))},
        browsers:await Promise.all([client(a),client(b)])};
    };
    failureEvidence=()=>targetingEvidence("failure");
    await Promise.all([a.waitForFunction(position=>{
      const o=window.__multiplayerLab!.observe() as {player:{position:number[];health:number;maxHealth:number}};
      return Math.abs(o.player.position[0]!-position[0]!)<.01&&Math.abs(o.player.position[2]!-position[2]!)<.01&&o.player.health===o.player.maxHealth;
    },placement.alice,{timeout:7000}),b.waitForFunction(position=>{
      const o=window.__multiplayerLab!.observe() as {player:{position:number[]}};
      return Math.abs(o.player.position[0]!-position[0]!)<.01&&Math.abs(o.player.position[2]!-position[2]!)<.01;
    },placement.bob,{timeout:7000})]);
    const initialAliceHealth=state.player.health,before=runtime.actions.currentSequence();
    assert(Math.hypot(state.player.position[0]-frog.position[0],state.player.position[2]-frog.position[2])
      <Math.hypot(bob.store.get().player.position[0]-frog.position[0],bob.store.get().player.position[2]-frog.position[2]));
    checks.aliceCloser=true;
    await b.getByRole("button",{name:"Attack fixture frog",exact:true}).click();
    const waitForPublished=async(predicate:(action:ReturnType<typeof runtime.actions.since>[number])=>boolean)=>{
      const deadline=Date.now()+7000;
      while(Date.now()<deadline){const action=runtime.actions.since(before).find(predicate);if(action)return action;await new Promise(r=>setTimeout(r,25));}
      throw new Error("Timed out waiting for authoritative targeting action");
    };
    const contact=await waitForPublished(action=>action.type==="hit"&&action.hit.attacker==="player"
      &&action.hit.sourceId==="bob"&&action.hit.targetId===frog.id);
    evidence.push({contact,atContact:await targetingEvidence("contact")});
    await Promise.all(pages.map(page=>page.waitForFunction(sequence=>(window.__multiplayerLab!.observe() as Observation)
      .actions.some(action=>action.sequence===sequence),contact.sequence,{timeout:7000})));
    checks.contactObservedByBoth=true;
    await perform(b,"Stop");
    evidence.push(await targetingEvidence("after-stop"));
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {combat:{engagedBy:string[]}}).combat.engagedBy.length===0,null,{timeout:7000});
    await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as {combat:{engagedBy:string[]}}).combat.engagedBy.includes("multiplayer:frog"),null,{timeout:7000});
    checks.correctReplicatedEngagement=true;
    const retaliation=await waitForPublished(action=>action.type==="attack"&&action.attack.attacker==="enemy"&&action.attack.sourceId===frog.id);
    const hit=await waitForPublished(action=>action.type==="hit"&&action.hit.attacker==="enemy"&&action.hit.sourceId===frog.id);
    await Promise.all(pages.map(page=>page.waitForFunction(sequences=>{
      const actions=(window.__multiplayerLab!.observe() as Observation).actions;
      return sequences.every(sequence=>actions.some(action=>action.sequence===sequence));
    },[retaliation.sequence,hit.sequence],{timeout:7000})));
    const enemyActions=runtime.actions.since(before).filter(action=>(action.type==="attack"&&action.attack.attacker==="enemy"&&action.attack.sourceId===frog.id)
      ||(action.type==="hit"&&action.hit.attacker==="enemy"&&action.hit.sourceId===frog.id));
    assert(enemyActions.length>=2);
    assert(enemyActions.every(action=>action.type==="attack"?action.attack.targetId==="bob":action.type==="hit"&&action.hit.targetId==="bob"));
    checks.enemyAttacksAndHitsBobOnly=true;
    const aliceObservation=await a.evaluate(()=>window.__multiplayerLab!.observe() as {player:{health:number};combat:{engagedBy:string[]}});
    assert.equal(state.player.health,initialAliceHealth);assert.equal(aliceObservation.player.health,initialAliceHealth);
    assert.deepEqual(aliceObservation.combat.engagedBy,[]);checks.aliceUnaffected=true;
    await capture(a,{path:`${out}/bob-retaliation.png`,timeout:5000});
    evidence.push({initialAliceHealth,contact,enemyActions,alice:await observe(a),bob:await observe(b)});
  }else if(lifecycle){
    state.player.position=[0,0,21];bob.store.get().player.position=[3,0,18];
    await perform(a,"Cross passage");
    await a.waitForFunction(()=>document.querySelector<HTMLElement>(".traversal-transition")?.style.opacity==="1");
    checks.passageCovered=true;
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).activity===null);
    await a.waitForFunction(()=>!document.querySelector(".traversal-transition"));
    assert(state.player.position[0]>11);checks.passageCommitted=true;
    state.player.position=[-12,0,11.8];await perform(a,"Climb");
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).activity?.kind==="traversing");
    await a.waitForTimeout(900);await perform(a,"Stop");
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).activity===null&&!document.querySelector(".traversal-transition"));
    assert(state.player.position[2]<12);checks.traversalCancelled=true;
    const caster=runtime.entities.get("multiplayer:caster")!;
    state.player.position=[caster.position[0]-3,0,caster.position[2]];state.player.health=state.player.maxHealth;
    bob.store.get().player.position=[caster.position[0]-4,0,caster.position[2]-3];
    // Let the real camera follow the fixture placement and residency prepare its production rig.
    await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as {player:{position:number[]}}).player.position[0]!>20);
    await b.waitForTimeout(500);
    await perform(a,"Attack caster");
    const projectile=(page:Page)=>page.waitForFunction(()=>(window.__multiplayerLab!.observe() as {projectiles:{visible:number;targets:string[]}}).projectiles.visible>0,null,{timeout:7000});
    await Promise.all([projectile(a),projectile(b)]);checks.projectileVisibleToOwnerAndObserver=true;
    await capture(b,{path:`${out}/incoming-magic.png`,timeout:5000});
    const seq=(await observe(b)).actions.at(-1)?.sequence??0;
    state.player.health=0;
    await b.waitForFunction(seq=>(window.__multiplayerLab!.observe() as Observation).actions.some(a=>a.sequence>seq&&a.type==="death"),seq);
    await b.getByText("Player died",{exact:true}).waitFor({state:"visible"});
    assert(state.player.health>0);assert.equal(state.activity,null);checks.deathAndRespawn=true;
    assert(!(await b.evaluate(()=>(window.__multiplayerLab!.observe() as {entities:{id:string}[]}).entities.some(e=>e.id==="recovery:alice"))));
    checks.recoveryPrivate=true;await capture(b,{path:`${out}/remote-death.png`,timeout:5000});
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {projectiles:{visible:number}}).projectiles.visible===0);
    checks.projectilesClearOnDeath=true;evidence.push({observer:await observe(b)});
  }else if(interactions){
    for(const [index,pose] of ["climb","vault","balance","slide"].entries()){
      state.player.position=[-12+index*6,0,11.8];bob.store.get().player.position=[state.player.position[0]+3,0,14];
      await perform(a,pose[0]!.toUpperCase()+pose.slice(1));
      await b.waitForFunction(pose=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion?.motion===pose),pose);
      await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion!.drawnPosition[2]!>13),null,{timeout:4000});
      assert.equal(state.activity?.kind,"traversing");assert.equal(state.player.position[2],11.8);
      checks[`${pose}-continuous`]=true;await capture(b,{path:`${out}/${pose}.png`,timeout:5000});
      await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).activity===null,null,{timeout:5000});
      assert(state.player.position[2]>16,`${pose} committed the server landing`);
    }
    state.player.position=[-10,0,4];bob.store.get().player.position=[-7,0,5];state.currency=10000;
    const amount=()=>state.inventory.slots.reduce((sum,s)=>sum+(s?.itemId==="air_essence"?s.quantity:0),0),before=amount();
    await perform(a,"Open shop");await perform(a,"Buy essence");
    await a.waitForFunction(before=>(window.__multiplayerLab!.observe() as {inventory:{slots:({itemId:string;quantity:number}|null)[]}}).inventory.slots.reduce((n,s)=>n+(s?.itemId==="air_essence"?s.quantity:0),0)===before+1,before);
    await perform(a,"Sell essence");
    await a.waitForFunction(before=>(window.__multiplayerLab!.observe() as {inventory:{slots:({itemId:string;quantity:number}|null)[]}}).inventory.slots.reduce((n,s)=>n+(s?.itemId==="air_essence"?s.quantity:0),0)===before,before);
    checks.shopTransfers=amount()===before&&state.currency<10000;
    state.player.position=[-10,0,7];await perform(a,"Talk");
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {dialogue:{nodeId:string}|null}).dialogue?.nodeId==="ilse_root");
    await perform(a,"Choose dialogue");
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {dialogue:{nodeId:string}|null}).dialogue?.nodeId==="ilse_directory");
    assert.equal(bob.store.get().dialogue,null);checks.dialogueChoice=true;await perform(a,"End dialogue");
    state.player.position=[-14,0,4];await perform(a,"Enter portal");
    await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion!.drawnPosition[0]!>13));
    checks.portalVisible=state.player.position[0]>13;
    state.player.position=[2,0,2];await perform(a,"Open bank");
    await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).actions.some(a=>a.type==="gesture"));
    evidence.push({observer:await observe(b)});
  }else if(activities){
    const fixtures=[
      {label:"Mine",pose:"mine",at:[5,0,0],tool:"worn_pickaxe",item:"grithe_ore"},
      {label:"Chop",pose:"chop",at:[-5,0,0],tool:"worn_hatchet",item:"palewood_log"},
      {label:"Fish",pose:"fish",at:[-5,0,-6],tool:"worn_rod",item:"silt_minnow"},
      {label:"Cook",pose:"produce",at:[-2,0,0],item:"seared_minnow"},
      {label:"Eat",pose:"eat",at:[0,0,6]},
      {label:"Build campfire",pose:"produce",at:[0,0,10]},
    ];
    const amount=(id:string)=>state.inventory.slots.reduce((sum,s)=>sum+(s?.itemId===id?s.quantity:0),0);
    for(const fixture of fixtures){
      await perform(a,"Stop");state.player.position=fixture.at as [number,number,number];
      bob.store.get().player.position=[fixture.at[0]!+3,0,fixture.at[2]!-4];
      if(fixture.label==="Eat")state.player.health=30;
      const before=fixture.item?amount(fixture.item):0;
      await perform(a,fixture.label);
      await b.waitForFunction(({pose,tool})=>(window.__multiplayerLab!.observe() as Observation).presentation
        .some(p=>p.id==="alice"&&p.motion?.motion===pose&&(!tool||p.equipment.mainHand===tool)),fixture,{timeout:5000});
      checks[`${fixture.label}-visible`]=true;
      await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&(p.motion as unknown as {path:string})?.path==="live-rig"),null,{timeout:5000});
      if(fixture.label==="Fish")await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as {presentation:{id:string;activity:{fishingLineVisible:boolean}|null}[]}).presentation.some(p=>p.id==="alice"&&p.activity?.fishingLineVisible),null,{timeout:3000});
      await b.waitForTimeout(250);
      await capture(b,{path:`${out}/${fixture.pose}-${fixture.label}.png`,timeout:5000});
      if(fixture.item){const deadline=Date.now()+5000;while(amount(fixture.item)<=before&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
        assert(amount(fixture.item)>before,`${fixture.label} awarded a production item`);}
      else if(fixture.label==="Build campfire"){
        await b.waitForFunction(()=>!!(window.__multiplayerLab!.observe() as {entities:{id:string}[]}).entities.find(e=>e.id==="campfire:alice"),null,{timeout:5000});
        checks.sharedCampfire=true;
      }
      evidence.push({label:fixture.label,observer:await observe(b)});
      await perform(a,"Stop");
      await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion?.motion==="idle"),null,{timeout:2000});
    }
    state.player.position=[2,0,2];bob.store.get().player.position=[4,0,4];
    const before=(await observe(b)).actions.at(-1)?.sequence??0;
    await perform(a,"Open bank");
    await b.waitForFunction(before=>(window.__multiplayerLab!.observe() as Observation).actions.some(a=>a.sequence>before&&a.type==="gesture"),before);
    checks.bankGesture=true;
    const ore=amount("grithe_ore");await perform(a,"Deposit ore");
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {bank:{slots:({itemId:string}|null)[]}}).bank.slots.some(s=>s?.itemId==="grithe_ore"));
    assert.equal(amount("grithe_ore"),ore-1);await perform(a,"Withdraw ore");
    const deadline=Date.now()+2000;while(amount("grithe_ore")!==ore&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    checks.bankTransfers=amount("grithe_ore")===ore;
  }else if(invocations){
    await a.evaluate(()=>{
      for(const [id,slot] of [["ember-dart",4],["furnace-whip",5]] as const){
        const target=document.querySelector<HTMLElement>(`.abar[data-bar="0"] .abar__slot[data-slot="${slot}"]`)!;
        const data=new DataTransfer();data.setData("text/x-corealm-spell",JSON.stringify({id}));
        target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:data}));
        target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
      }
    });
    await a.locator('.abar[data-bar="0"] .abar__slot[data-slot="3"]').click();
    await a.waitForFunction(()=>(window.__multiplayerLab!.observe() as {combat:{preferredSpellId:string}}).combat.preferredSpellId==="emberlash");
    checks.standingSpellAuthoritative=true;
    await a.getByRole("button",{name:"Attack fixture frog",exact:true}).click();
    const amount=(id:string)=>state.inventory.slots.reduce((sum,s)=>sum+(s?.itemId===id?s.quantity:0),0);
    const mind=amount("mind_rune");await a.locator('.abar[data-bar="0"] .abar__slot[data-slot="4"]').click();
    await b.waitForFunction(()=>(window.__gameDebug as unknown as {getBasicSpellState():{spellId:string;particles:number}[]}).getBasicSpellState().some(s=>s.spellId==="ember-dart"&&s.particles>0),null,{timeout:6000});
    assert.equal(amount("mind_rune"),mind-1);checks.targetedInvocation=true;
    await a.waitForFunction(()=>document.querySelector('.abar.is-busy')!==null);
    checks.authoritativeCastLock=true;await capture(b,{path:`${out}/targeted.png`,timeout:5000});
    await a.waitForFunction(()=>document.querySelector('.abar.is-busy')===null,null,{timeout:8000});
    const chaos=amount("chaos_rune"),cosmic=amount("cosmic_rune");
    await a.locator('.abar[data-bar="0"] .abar__slot[data-slot="5"]').click();
    await a.waitForFunction(()=>document.body.classList.contains("is-aiming"));
    const box=(await a.locator("#viewport").boundingBox())!;
    await a.mouse.click(box.x+box.width*.5,box.y+box.height*.62);
    await b.waitForFunction(()=>(window.__gameDebug as unknown as {getBasicSpellState():{spellId:string;particles:number}[]}).getBasicSpellState().some(s=>s.spellId==="furnace-whip"&&s.particles>0),null,{timeout:5000});
    assert.equal(amount("chaos_rune"),chaos-1);assert.equal(amount("cosmic_rune"),cosmic-1);
    checks.areaInvocation=true;await capture(b,{path:`${out}/area.png`,timeout:5000});
    for(const skill of SKILL_IDS)setSkillLevel(bob.store.get(),skill,99);
    const inv=bob.store.get().inventory.slots;
    for(const itemId of ["fire_essence","mind_rune"]){const slot=inv.indexOf(null);inv[slot]={itemId,quantity:10,slotIndex:slot};}
    await perform(b,"Cast ember-dart");
    await b.waitForFunction(()=>{
      const fx=(window.__gameDebug as unknown as {getBasicSpellState():{spellId:string;origin:number[]}[]}).getBasicSpellState();
      return fx.some(s=>s.spellId==="furnace-whip")&&fx.some(s=>s.spellId==="ember-dart");
    },null,{timeout:5000});
    checks.concurrentCasters=true;await capture(b,{path:`${out}/concurrent.png`,timeout:5000});
    evidence.push({observer:await observe(b),effects:await b.evaluate(()=>(window.__gameDebug as unknown as {getBasicSpellState():unknown}).getBasicSpellState())});
  }else{
  await perform(a,"Equip sword");
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.equipment?.mainHand==="worn_sword"&&p.motion));
  checks.equipment=true;
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&(p.motion as unknown as {path:string})?.path==="live-rig"),null,{timeout:5000});
  await a.getByRole("button",{name:"Attack fixture frog",exact:true}).click();
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion?.motion==="player_attack"),null,{timeout:6000});
  checks.meleeAnimation=true;await capture(b,{path:`${out}/remote-melee.png`,timeout:5000});
  await b.waitForTimeout(250);
  assert.equal((await observe(b)).presentation.find(p=>p.id==="alice")?.motion?.motion,"player_attack");
  checks.meleeSurvivesHeartbeats=true;
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).actions.some(a=>a.playerId==="alice"&&a.type==="hit"));
  checks.impact=true;
  await perform(a,"Stop");
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.some(p=>p.id==="alice"&&p.motion?.motion==="idle"),null,{timeout:1000});
  checks.cancelledAttackStops=true;await perform(a,"Equip wand");
  for(const spell of ["voltrend","rimewash","stonebrand","emberlash"]){
    const before=(await observe(b)).actions.at(-1)?.sequence??0;
    const start=performance.now();await perform(a,`Cast ${spell}`);
    await b.waitForFunction(before=>{
      const o=window.__multiplayerLab!.observe() as Observation;
      const debug=window.__gameDebug as unknown as {getBasicSpellState():{particles:number}[]};
      return o.actions.some(a=>a.sequence>before&&a.type==="spell"&&a.playerId==="alice")
        &&o.presentation.some(p=>p.id==="alice"&&p.motion?.motion==="cast")&&debug.getBasicSpellState().some(s=>s.particles>0);
    },before,{timeout:6000});
    const latency=performance.now()-start;checks[`spell-${spell}`]=true;
    await b.waitForTimeout(250);
    assert.equal((await observe(b)).presentation.find(p=>p.id==="alice")?.motion?.motion,"cast");
    evidence.push({spell,latencyMs:latency,observer:await observe(b),effect:await b.evaluate(()=>(window.__gameDebug as unknown as {getBasicSpellState():unknown}).getBasicSpellState())});
    await capture(b,{path:`${out}/remote-${spell}.png`,timeout:5000});await perform(a,"Stop");
  }
  }
  const deliveries=(await observe(b)).actions.filter(action=>published.has(action.sequence)).map(action=>({...action,latencyMs:action.receivedAt-published.get(action.sequence)!}));
  if(profiler){await writeFile(`${out}/observer.cpuprofile`,JSON.stringify((await profiler.send("Profiler.stop")).profile));
    await writeFile(`${out}/shader-stalls.json`,JSON.stringify(await b.evaluate(()=>Reflect.get(window,"__shaderStalls"))));}
  const latencies=deliveries.map(action=>action.latencyMs).sort((a,b)=>a-b);
  const delivery={samples:latencies.length,p50Ms:latencies[Math.floor(latencies.length*.5)],p95Ms:latencies[Math.floor(latencies.length*.95)],maxMs:latencies.at(-1)};
  evidence.push({publicActionDelivery:delivery,deliveries,captures,latencyOnly});checks.deliveryLatency=delivery.p95Ms!==undefined&&delivery.p95Ms<250;
  await a.locator(".worlds__row--local input").check(); await a.getByRole("button", { name: "Leave world", exact: true }).click();
  await b.waitForFunction(()=>(window.__multiplayerLab!.observe() as Observation).presentation.length===0);
  checks.leaveCleanup=true;checks.noRuntimeErrors=errors.length===0;
  const report={passed:Object.values(checks).every(Boolean),checks,evidence,errors,durationMs:Date.now()-started};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks,errors,durationMs:report.durationMs}));assert(report.passed);
} catch(error) {if(failureEvidence)try{evidence.push(await failureEvidence());}catch(diagnosticError){evidence.push({diagnosticError:String(diagnosticError)});}
  await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors,evidence},null,2));throw error;}
finally{await browser.close();await game.close();await server.close();clearDeadline();}
