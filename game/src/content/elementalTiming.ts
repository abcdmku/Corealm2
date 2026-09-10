import type { ElementalSpellId } from "./elementalSpells.js";

// [authored choreography ms, gameplay ms]. Compress gathering and contact travel,
// while keeping falling debris, fire cooling and draining water at their natural speed.
const beats: Partial<Record<ElementalSpellId, readonly (readonly [number, number])[]>> = {
  "razor-crescent": [[0,0],[260,260],[700,460],[980,660]],
  "vacuum-coil": [[0,0],[260,260],[650,480],[1700,1040],[2200,1320]],
  "thunder-lance": [[0,0],[280,280],[850,520],[1290,760]],
  skybreaker: [[0,0],[450,450],[2400,1000],[4300,2050]],
  "tidal-fan": [[0,0],[240,240],[730,490],[870,610]],
  "geyser-chain": [[0,0],[280,280],[800,540],[1900,1230]],
  undertow: [[0,0],[280,280],[800,540],[1900,1190],[2450,1510]],
  deluge: [[0,0],[300,350],[1650,1000],[2400,1210],[3300,1550]],
  faultline: [[0,0],[260,260],[650,470],[1250,850]],
  "basalt-jaw": [[0,0],[280,280],[850,550],[1550,930]],
  "siege-boulder": [[0,0],[320,360],[1700,790],[2000,1000]],
  mountainfall: [[0,0],[250,330],[1900,880],[2350,1020],[3295,1390],[3500,1550],[4300,1910]],
  "furnace-whip": [[0,0],[190,240],[600,470],[1100,810]],
  "cinder-mine": [[0,0],[250,330],[1500,500],[1800,670],[2150,870]],
  "phoenix-pass": [[0,0],[300,330],[1000,600],[1690,1060]],
  starfall: [[0,0],[250,400],[450,580],[3000,1100]],
};

function mapTime(id:ElementalSpellId,ms:number,inverse:boolean):number {
  const points=beats[id];if(!points||ms<=0)return ms;
  const from=inverse?1:0,to=inverse?0:1;
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!;
    if(ms<=b[from])return a[to]+(ms-a[from])/(b[from]-a[from])*(b[to]-a[to]);
  }
  const last=points.at(-1)!;
  return last[to]+ms-last[from];
}
export const elementalGameplayTime=(id:ElementalSpellId,authoredMs:number)=>mapTime(id,authoredMs,false);
export const elementalChoreographyTime=(id:ElementalSpellId,gameplayMs:number)=>mapTime(id,gameplayMs,true);
