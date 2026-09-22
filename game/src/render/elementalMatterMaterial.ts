import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { abs, atan, attribute, cos, cross, float, max, mix, modelNormalMatrix, normalize, positionGeometry, pow, sin, smoothstep, varying, vec2, vec3 } from "three/tsl";
import { isolateMagicEmission } from "./magicGlow.js";
import { authoredFlow, clockUniform } from "./elementalNodes.js";

/** Lit elemental matter: its surface carries the shape, with emission confined to hot or wet detail. */
export function createElementalMatterMaterial(element: "wind" | "water" | "fire", clock: { value: number }): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: element === "water" ? .3 : element === "wind" ? .8 : .65,
    metalness: 0, transparent: true, depthWrite: false, side: THREE.FrontSide });
  const time=clockUniform(clock),a=attribute("curveA","vec4" as const),b=attribute("curveB","vec4" as const),c=attribute("curveC","vec4" as const),d=attribute("curveD","vec4" as const),tint=attribute("bodyTint","vec4" as const);
  const u=positionGeometry.y,v=float(1).sub(u);
  const tangent=normalize(b.xyz.sub(a.xyz).mul(v.mul(v).mul(3)).add(c.xyz.sub(b.xyz).mul(v.mul(u).mul(6))).add(d.xyz.sub(c.xyz).mul(u.mul(u).mul(3))));
  const chord=normalize(d.xyz.sub(a.xyz)),reference=abs(chord.y).greaterThan(.85).select(vec3(1,0,0),vec3(0,1,0));
  const right=normalize(cross(tangent,reference)),up=cross(right,tangent);
  const envelope=pow(max(sin(u.mul(3.14159265)),0),.65);
  const fold=sin(u.mul(23).sub(time.mul(6)).add(tint.a)).mul(.2).mul(sin(u.mul(3.14159))).add(1);
  let p=a.xyz.mul(v.pow(3)).add(b.xyz.mul(v.mul(v).mul(u).mul(3))).add(c.xyz.mul(v.mul(u).mul(u).mul(3))).add(d.xyz.mul(u.pow(3)));
  p=p.add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z).mul(c.w)).mul(b.w).mul(envelope).mul(fold));
  if(element === "fire") {
    const flicker=u.mul(13).sub(time.mul(7)).add(tint.a);
    p=p.add(right.mul(sin(flicker.mul(.47))).add(up.mul(cos(flicker.mul(.61)))).mul(b.w).mul(.42).mul(envelope));
    p=p.add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z)).mul(sin(flicker.add(atan(positionGeometry.z,positionGeometry.x).mul(3)))).mul(b.w).mul(.20).mul(envelope));
  }
  material.positionNode=p;
  material.normalNode=normalize(varying(modelNormalMatrix.mul(normalize(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z).div(max(c.w,.1)))))));
  const sample=varying(vec3(positionGeometry.x,u.mul(6),positionGeometry.z)),along=varying(u),seed=varying(tint.a),colour=varying(tint.rgb),alpha=varying(d.w);
  const grain=authoredFlow(vec2(atan(sample.z,sample.x).div(6.2831853).mul(2),along.mul(1.4)),time.mul(1.6),seed);
  const crest=smoothstep(.55,.75,grain);
  if(element === "wind") {
    material.colorNode=colour.mul(grain.mul(.5).add(.5));
    material.opacityNode=alpha.mul(smoothstep(.23,.56,grain)).mul(.65);
    material.emissiveNode=colour.mul(crest).mul(.18);
  } else if(element === "water") {
    material.colorNode=mix(vec3(.016,.095,.12),colour.mul(.7),crest.mul(.8));
    material.opacityNode=alpha.mul(grain.mul(.3).add(.7)).mul(float(1).sub(smoothstep(.5,1,along).mul(float(1).sub(smoothstep(.3,.57,grain)))));
    const current=pow(sin(grain.mul(20).sub(time.mul(5)).add(along.mul(11))).mul(.5).add(.5),8);
    material.emissiveNode=vec3(.12,.66,.85).mul(crest).mul(current.mul(1.2).add(.8));
  } else {
    material.colorNode=mix(vec3(.13,.002,.001),vec3(.42,.025,.001),grain);
    material.opacityNode=alpha.mul(smoothstep(.025,.40,grain.add(float(1).sub(along).mul(.14)))).mul(float(1).sub(smoothstep(.80,1,along)));
    const heat=smoothstep(.1,.67,grain).mul(float(1).sub(smoothstep(.75,1,along)));
    const radiance=mix(mix(vec3(.42,.009,.002),vec3(3.8,.42,.006),heat),vec3(6,2.4,.45),smoothstep(.58,.87,grain));
    material.emissiveNode=radiance.add(vec3(1.7,.52,.09).mul(pow(sin(grain.mul(23).sub(time.mul(4.6)).add(along.mul(9))).mul(.5).add(.5),9)).mul(heat));
  }
  material.alphaTest=.008;
  isolateMagicEmission(material);
  return material;
}
