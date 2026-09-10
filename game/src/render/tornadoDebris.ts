import type { Vec3 } from "../contracts.js";
import { FINALE } from "../content/elementalFinales.js";

const random=(i:number,s:number)=>{const n=Math.sin(i*127.1+s*311.7)*43758.5453;return n-Math.floor(n);};
const ease=(n:number)=>{const t=Math.max(0,Math.min(1,n));return t*t*(3-2*t);};

/** The same orbiting grain is released into a ballistic fall, then rests on terrain. */
export function tornadoDebris(i:number,age:number,x:number,z:number,ground:(x:number,z:number)=>number){
  const timing=FINALE.skybreaker,t=Math.min(age,timing.release)/1000;
  const u=(random(i,151)+t*.28)%1,a=random(i,152)*Math.PI*2+t*3.8+u*7;
  const rise=ease((age-500)/(timing.contact-500)),r=(3.8+random(i,153)*2)*(1-u*.16);
  const fall=Math.max(0,(age-timing.release)/1000);
  const sx=x+Math.cos(a)*r,sz=z+Math.sin(a)*r;
  const initial=ground(x,z)+.08+u*u*10.5*rise,vy=.8+random(i,154)*3.2;
  const releaseAngle=random(i,160)*Math.PI*2, speed=1+random(i,161)*10;
  const flight=(vy+Math.sqrt(vy*vy+28*Math.max(0,initial-ground(sx,sz)-.025)))/14;
  const travel=Math.min(fall,flight),drag=(1-Math.exp(-travel*.6))/.6;
  const px=sx+Math.cos(releaseAngle)*speed*drag,pz=sz+Math.sin(releaseAngle)*speed*drag;
  const floor=ground(px,pz)+.025,py=initial+fall*vy-fall*fall*7;
  const settled=fall>0&&py<=floor;
  return {position:[px,Math.max(floor,py),pz] as Vec3,settled,
    alpha:ease((age-400)/650)*(1-ease((age-6650)/550)),size:.021+random(i,155)**2*.07};
}
