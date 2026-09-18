import {describe,expect,it} from "vitest";
import type {SemanticEntity} from "../game/src/contracts.js";
import {CrowdDetail} from "../game/src/multiplayer/crowdDetail.js";

const players = (count:number):SemanticEntity[] => Array.from({length:count},(_,i)=>({
  id:`player-${i}`,name:"Player",archetype:"npc",regionId:"fallowmarch",position:[i,0,0],tier:1,state:"alive",interactions:["inspect"],
}));

describe("remote crowd presentation",()=>{
  it("keeps small groups detailed and uses hysteresis when a crowd thins",()=>{
    const detail=new CrowdDetail(), all=players(100);
    expect(detail.select(all.slice(0,63),[0,0,0]).size).toBe(0);
    expect(detail.select(all,[0,0,0]).size).toBe(68);
    expect(detail.select(all.slice(0,50),[0,0,0]).size).toBe(18);
    expect(detail.select(all.slice(0,47),[0,0,0]).size).toBe(0);
  });
  it("moves detail to nearby players, tolerates boundary jitter and clears session history",()=>{
    const detail=new CrowdDetail(), all=players(100), before=structuredClone(all);
    expect(detail.select(all,[0,0,0]).has("player-0")).toBe(false);
    const right=detail.select(all,[99,0,0]);
    expect(right.has("player-0")).toBe(true);
    expect(right.has("player-99")).toBe(false);
    expect(detail.select(all,[98.9,0,0])).toEqual(right);
    detail.clear();
    expect(detail.select(all.slice(0,50),[0,0,0]).size).toBe(0);
    expect(all).toEqual(before);
  });
});
