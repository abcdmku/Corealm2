import type { Vec3 } from "../contracts.js";

/** Shared by the elemental body, enchanted wake and trailing particles. */
export function basicSpellPath(release:Vec3,impact:Vec3):(progress:number)=>Vec3 {
  const dx=impact[0]-release[0],dy=impact[1]-release[1],dz=impact[2]-release[2];
  // Short shots stay compact; longer shots have a readable rise and descent.
  const lift=Math.min(4.5,Math.hypot(dx,dz)*.24);
  return progress=>{
    const u=Math.max(0,Math.min(1,progress));
    return [release[0]+dx*u,release[1]+dy*u+4*lift*u*(1-u),release[2]+dz*u];
  };
}
