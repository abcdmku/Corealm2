import type { InstancedBufferAttribute } from "three";
import type { Node } from "three/webgpu";
import { Fn, If, buffer, instanceIndex, cos, dot, float, floor, fract, max, mix, pow, reference, sin, smoothstep, sqrt, texture, vec2, vec3 } from "three/tsl";
import { elementalFlowTexture } from "./elementalFlowTexture.js";
import { elementalFlameTexture } from "./elementalFlameTexture.js";

// Shared identities; explicit preparation downloads and decodes the maps before effects compile.
const flowMap = texture(elementalFlowTexture());
const flameMap = texture(elementalFlameTexture());

/** Three supports buffer element access at runtime; r185 declarations omit it. */
export function elementalInstanceMatrix(attribute: InstancedBufferAttribute): Node<"mat4"> {
  const matrices = buffer(attribute.array, "mat4" as const, attribute.count);
  const indexed = matrices as typeof matrices & { element(index: Node<"uint">): Node<"mat4"> };
  return indexed.element(instanceIndex);
}

/** Authored elemental sampling shared by the native renderer's spatial effects. */
export const clockUniform = (clock?: { value: number }): Node<"float"> => clock
  ? reference("value", "float", clock) : reference("userData.effectClock.value", "float", null);
export const authoredFlow = Fn(([uv, time, seed]: [Node<"vec2">, Node<"float">, Node<"float">]): Node<"float"> => {
  const drift = vec2(seed.mul(.137), time.mul(-.28));
  const warp = flowMap.sample(uv.mul(.47).add(drift.mul(.38))).rg;
  const a = flowMap.sample(uv.add(drift).add(vec2(warp.x, warp.y.negate()).mul(.11))).r;
  const b = flowMap.sample(uv.mul(1.73).add(vec2(seed.mul(-.09), time.mul(.13)))).r;
  return a.mul(.8).add(b.mul(.2));
});

const spatialHash = (p: Node<"vec3">, offset: Node<"vec3">): Node<"float"> => {
  const q = fract(p.mul(.3183099).add(offset)).mul(17);
  return fract(q.x.mul(q.y).mul(q.z).mul(q.x.add(q.y).add(q.z)));
};
const spatialNoise = (p: Node<"vec3">, offset: Node<"vec3">): Node<"float"> => {
  const i = floor(p), raw = fract(p), f = raw.mul(raw).mul(float(3).sub(raw.mul(2)));
  const h = (x: number, y: number, z: number) => spatialHash(i.add(vec3(x, y, z)), offset);
  return mix(mix(mix(h(0,0,0),h(1,0,0),f.x),mix(h(0,1,0),h(1,1,0),f.x),f.y),
    mix(mix(h(0,0,1),h(1,0,1),f.x),mix(h(0,1,1),h(1,1,1),f.x),f.y),f.z);
};
export const noise3 = Fn(([p]: [Node<"vec3">]): Node<"float"> => spatialNoise(p, vec3(.13,.37,.71)));
export const matterNoise3 = Fn(([p]: [Node<"vec3">]): Node<"float"> => spatialNoise(p, vec3(.17)));
export const fbm3 = Fn(([p]: [Node<"vec3">]): Node<"float"> => noise3(p).mul(.55).add(noise3(p.mul(2.03)).mul(.28)).add(noise3(p.mul(4.07)).mul(.17)));

const flameHash = Fn(([p]: [Node<"vec2">]): Node<"vec2"> => fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)))).mul(43758.5453)));
export const flameNoise = Fn(([p]: [Node<"vec2">]): Node<"float"> => {
  const i=floor(p),raw=fract(p),f=raw.mul(raw).mul(float(3).sub(raw.mul(2)));
  return mix(mix(flameHash(i).x,flameHash(i.add(vec2(1,0))).x,f.x),mix(flameHash(i.add(vec2(0,1))).x,flameHash(i.add(vec2(1,1))).x,f.x),f.y);
});
const flamePatch = Fn(([uv,cell,seed]: [Node<"vec2">,Node<"vec2">,Node<"float">]): Node<"float"> => {
  const r=flameHash(cell.add(seed.mul(vec2(.73,1.19))));
  const turn=r.x.sub(.5).mul(.85), c=cos(turn),s=sin(turn);
  const sample=vec2(c.mul(uv.x).add(s.mul(uv.y)),s.negate().mul(uv.x).add(c.mul(uv.y))).mul(mix(.67,1.25,r.y)).add(r.mul(17.3));
  return flameMap.sample(sample).r;
});
export const flameDetail = Fn(([sourceUv,clock,seed]: [Node<"vec2">,Node<"float">,Node<"float">]): Node<"float"> => {
  const variation=fract(sin(vec3(seed.add(1.7),seed.add(19.3),seed.add(41.9)).mul(vec3(12.9898,39.3468,73.156))).mul(43758.5453));
  const uv=sourceUv.mul(vec2(.66,.68).add(vec2(.62,.51).mul(variation.xy))).toVar();
  uv.x.addAssign(uv.y.sub(.5).mul(variation.z.sub(.5)).mul(.58));
  const drift=vec2(variation.z.sub(.5).mul(clock).mul(.045),clock.negate().mul(variation.x.mul(.38).add(.46)));
  const moving=uv.add(drift).toVar();
  const curl=vec2(flameNoise(moving.mul(2.3).add(seed)),flameNoise(moving.mul(2.1).add(seed).add(13.7))).sub(.5);
  moving.addAssign(curl.mul(.44));
  const grid=vec2(moving.x.sub(moving.y.mul(.57735027)),moving.y.mul(1.15470054)).mul(2.4);
  const cell=floor(grid).toVar(), f=fract(grid), b=vec2(0).toVar(),c=vec2(0).toVar(),weights=vec3(0).toVar();
  If(f.x.add(f.y).lessThan(1),()=>{
    b.assign(cell.add(vec2(1,0)));c.assign(cell.add(vec2(0,1)));weights.assign(vec3(float(1).sub(f.x).sub(f.y),f.x,f.y));
  }).Else(()=>{
    cell.addAssign(vec2(1));b.assign(cell.sub(vec2(1,0)));c.assign(cell.sub(vec2(0,1)));weights.assign(vec3(f.x.add(f.y).sub(1),float(1).sub(f.x),float(1).sub(f.y)));
  });
  weights.assign(pow(max(weights,vec3(0)),vec3(3)));weights.divAssign(dot(weights,vec3(1)));
  const samples=vec3(flamePatch(moving,cell,seed),flamePatch(moving,b,seed),flamePatch(moving,c,seed));
  return sqrt(dot(samples.mul(samples),weights));
});
export const flameColor = Fn(([ink,height,emission]: [Node<"float">,Node<"float">,Node<"float">]): Node<"vec3"> => {
  const heat=smoothstep(.08,.62,ink).mul(float(1).sub(height.mul(.22))), gold=smoothstep(.48,.85,ink),hot=smoothstep(.80,.98,ink);
  const body=mix(vec3(.065,.0008,.002),vec3(1.05,.018,.001),sqrt(heat)).toVar();
  body.assign(mix(body,vec3(2.35,.38,.012),heat.mul(heat)));
  body.addAssign(vec3(1.8,1,.12).mul(gold).add(vec3(1.8,2,1.1).mul(hot)));
  const energy=vec3(1.5,.075,.001).mul(heat).mul(heat).add(vec3(2.9,1.1,.04).mul(gold)).add(vec3(2.2,2.4,1.3).mul(hot));
  return mix(body,energy,emission);
});
