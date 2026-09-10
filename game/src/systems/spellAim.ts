import type { Vec3 } from "../contracts.js";

/** Aim three quarters up the rendered body, including scaled creatures. */
export function spellImpactPoint(feet:Vec3,bounds?:{min:Vec3;max:Vec3}|null):Vec3 {
  const bottom=bounds?.min[1]??feet[1];
  const top=bounds?.max[1]??feet[1]+2;
  return [feet[0],bottom+Math.max(.1,top-bottom)*.75,feet[2]];
}
