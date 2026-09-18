import {expect,it} from "vitest";
import {MovementPrediction} from "../game/src/multiplayer/movementPrediction.js";
import {createMultiplayerLabWorld} from "../game/src/multiplayer/labWorld.js";
import {Movement} from "../game/src/systems/movement.js";
import {EventBus} from "../game/src/core/events.js";
import {createInitialState} from "../game/src/state/store.js";
import type {SemanticEntity} from "../game/src/contracts.js";

it("predicts only a bounded drawn pose and reconciles server corrections without changing replicated reads",async()=>{
  const ports=await createMultiplayerLabWorld();const state=createInitialState(1337,0);
  const prediction=new MovementPrediction(new Movement(ports.nav,new EventBus(),ports.movement));
  prediction.reconcile(state,0,0);prediction.input({forward:0,strafe:1,cameraYaw:0});
  for(let now=50;now<=250;now+=50)prediction.sample(now);
  const predicted=prediction.sample(300)!;
  expect(predicted.position[0]).toBeGreaterThan(0);expect(state.player.position).toEqual([0,0,0]);
  expect(prediction.sample(1000)!.position).toEqual(predicted.position);
  state.player.position=[20,0,0];prediction.reconcile(state,1000,1000);
  expect(prediction.sample(1000)!.position).toEqual([20,0,0]);
  prediction.clear();expect(prediction.sample(1100)).toBeNull();
});

it("preserves the displayed correction across repeated snapshots and predicts click paths",async()=>{
  const ports=await createMultiplayerLabWorld(),state=createInitialState(1337,0);
  const source=new Movement(ports.nav,new EventBus(),ports.movement);
  const prediction=new MovementPrediction(source);
  source.startPath(state,[10,0,0],null,0);
  prediction.reconcile(state,0,0);
  for(let now=20;now<=80;now+=20)prediction.sample(now);
  expect(prediction.sample(80)!.position[0]).toBeGreaterThan(0);
  for(let now=100;now<=400;now+=100){
    const before=prediction.sample(now)!;
    state.player.position=[state.player.position[0]+.1,0,0];
    state.player.facingRad=now/100;
    prediction.reconcile(state,now,now);
    const after=prediction.sample(now)!;
    expect(after.position[0]).toBeCloseTo(before.position[0],10);
    expect(after.facingRad).toBeCloseTo(before.facingRad,10);
  }
});

it("predicts through remote player presentations while keeping ordinary NPC collision",async()=>{
  const ports=await createMultiplayerLabWorld();
  const entity:SemanticEntity={id:"other",name:"Other",archetype:"npc",tier:1,regionId:"fallowmarch",position:[1,0,0],state:"alive",interactions:[]};
  const run=(remote:boolean)=>{
    entity.meta={remotePlayer:remote};
    const source=new Movement(ports.nav,new EventBus(),{...ports.movement,entities:{get:()=>entity,index:()=>({forEachInRadius:(_p,_r,visit)=>{visit(entity.id,0);}})}});
    const prediction=source.createPrediction(new EventBus()),state=createInitialState(1337,0);
    prediction.setDirectInput({forward:0,strafe:1,cameraYaw:0});
    for(let time=50;time<=1000;time+=50)prediction.update(state,50,time);
    return state.player.position[0];
  };
  expect(run(true)).toBeGreaterThan(3);
  expect(run(false)).toBeLessThan(1);
});

it("abandons the old NPC detour when a new click replaces the path",async()=>{
  const ports=await createMultiplayerLabWorld();
  const npc:SemanticEntity={id:"npc",name:"NPC",archetype:"npc",tier:1,regionId:"fallowmarch",position:[2,0,0],state:"alive",interactions:[]};
  const source=new Movement(ports.nav,new EventBus(),{...ports.movement,entities:{get:()=>npc,index:()=>({forEachInRadius:(_p,_r,visit)=>{visit(npc.id,0);}})}});
  const prediction=new MovementPrediction(source),state=createInitialState(1337,0);
  source.startPath(state,[10,0,0],null,0);prediction.reconcile(state,0,0);
  for(let at=25;at<=200;at+=25)prediction.sample(at);
  const before=prediction.sample(200)!.position;
  state.player.position=[...before];
  source.startPath(state,[-10,0,0],null,200);prediction.reconcile(state,200,200);
  for(let at=225;at<=450;at+=25)prediction.sample(at);
  expect(prediction.sample(450)!.position[0]).toBeLessThan(before[0]-.1);
});

it("starts clicks before acknowledgement and keeps the newest intent across older snapshots",async()=>{
  const ports=await createMultiplayerLabWorld(),state=createInitialState(1337,0);
  const prediction=new MovementPrediction(new Movement(ports.nav,new EventBus(),ports.movement));
  prediction.reconcile(state,0,0);
  const first=prediction.command({method:"moveTo",args:[{position:[10,0,0]}]});
  expect(prediction.sample(16)!.position[0]).toBeGreaterThan(0);
  const latest=prediction.command({method:"moveTo",args:[{position:[-10,0,0]}]});
  prediction.cancel(first); // An older failed send cannot cancel the newer click.
  prediction.acknowledge(first,{status:"accepted",sequence:1,tick:1,result:{}});
  prediction.reconcile(state,100,100,1);
  for(let now=120;now<=240;now+=20)prediction.sample(now);
  expect(prediction.sample(240)!.position[0]).toBeLessThan(0);
  prediction.acknowledge(latest,{status:"rejected",sequence:2,tick:2,error:{code:"NOT_REACHABLE",message:"Blocked"}});
  prediction.reconcile(state,250,250,2);
  const before=prediction.sample(250)!.position[0];
  expect(prediction.sample(500)!.position[0]).toBeGreaterThan(before);
  expect(state.player.position).toEqual([0,0,0]);
  const failed=prediction.command({method:"moveTo",args:[{position:[10,0,0]}]});
  prediction.cancel(failed);
  prediction.reconcile(state,600,600,2);
  const start=prediction.sample(600)!.position[0];
  const end=prediction.sample(850)!.position[0];
  expect(Math.abs(end)).toBeLessThanOrEqual(Math.abs(start));
});
