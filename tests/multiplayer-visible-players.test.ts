import {expect,it} from "vitest";
import type {SemanticEntity} from "../game/src/contracts.js";
import {visibleRemotePlayers} from "../game/src/multiplayer/visiblePlayers.js";
const actor=(id:string,x:number,z=0):SemanticEntity=>({id,archetype:"npc",name:id,tier:1,regionId:"fallowmarch",position:[x,0,z],state:"alive",interactions:["inspect"]});
it("draws only the nearest 256 within 32 metres while retaining the source state",()=>{
  const players=Array.from({length:1000},(_,i)=>actor(`p${i}`,i/10));
  expect(visibleRemotePlayers(players,[0,0,0]).map(p=>p.id)).toEqual(players.slice(0,256).map(p=>p.id));
  expect(visibleRemotePlayers(players,[200,0,0])).toEqual([]);expect(players).toHaveLength(1000);
  expect(visibleRemotePlayers([actor("edge",32),actor("far",32.01)],[0,0,0]).map(p=>p.id)).toEqual(["edge"]);
  expect(visibleRemotePlayers(players,[99,0,0])[0]!.id).toBe("p990");
});
it("breaks equal-distance ties consistently across arrival order",()=>{
  const a=actor("a",1),b=actor("b",-1);
  expect(visibleRemotePlayers([b,a],[0,0,0])).toEqual([a,b]);
});
