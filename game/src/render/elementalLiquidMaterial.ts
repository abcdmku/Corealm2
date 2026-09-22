import * as THREE from "three";
import { abs, attribute, cross, float, max, modelNormalMatrix, normalize, positionGeometry, pow, sin, varying, vec3 } from "three/tsl";
import { createElementalRefractionMaterial } from "./elementalRefraction.js";
import { clockUniform } from "./elementalNodes.js";

/** Refracting streams and splashes use the same curved spatial geometry as their attack path. */
export function createElementalLiquidMaterial(clock?: { value: number }) {
  const time=clockUniform(clock),a=attribute("curveA","vec4" as const),b=attribute("curveB","vec4" as const),c=attribute("curveC","vec4" as const),d=attribute("curveD","vec4" as const),tint=attribute("bodyTint","vec4" as const);
  const u=positionGeometry.y,v=float(1).sub(u);
  const tangent=normalize(b.xyz.sub(a.xyz).mul(v.mul(v).mul(3)).add(c.xyz.sub(b.xyz).mul(v.mul(u).mul(6))).add(d.xyz.sub(c.xyz).mul(u.mul(u).mul(3))));
  const chord=normalize(d.xyz.sub(a.xyz)),ref=abs(chord.y).greaterThan(.85).select(vec3(1,0,0),vec3(0,1,0));
  const right=normalize(cross(tangent,ref)),up=cross(right,tangent),envelope=pow(max(sin(u.mul(3.14159)),0),.5);
  const phase=u.mul(18).sub(time.mul(7)).add(tint.a),swell=sin(phase).mul(.17).add(sin(phase.mul(2.3)).mul(.08)).add(1);
  const position=a.xyz.mul(v.pow(3)).add(b.xyz.mul(v.mul(v).mul(u).mul(3))).add(c.xyz.mul(v.mul(u).mul(u).mul(3))).add(d.xyz.mul(u.pow(3)))
    .add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z).mul(c.w)).mul(b.w).mul(envelope).mul(swell))
    .add(right.mul(sin(phase.mul(.43))).mul(b.w).mul(.24).mul(envelope));
  const normal=normalize(varying(modelNormalMatrix.mul(right.mul(positionGeometry.x.add(sin(phase).mul(.2))).add(up.mul(positionGeometry.z).div(max(c.w,.1))))));
  const material=createElementalRefractionMaterial({clock,liquid:true,strength:15,flowMode:0,positionNode:position,normalNode:normal,
    localNode:varying(vec3(positionGeometry.x,u,positionGeometry.z)),alphaNode:varying(d.w),seedNode:varying(tint.a)});
  material.side=THREE.FrontSide;
  return material;
}
