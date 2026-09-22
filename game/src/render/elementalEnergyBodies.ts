import * as THREE from "three";
import type { Node } from "three/webgpu";
import type { Vec3, SpellElement } from "../contracts.js";
import { createElementalMatterMaterial } from "./elementalMatterMaterial.js";
import { createElementalLiquidMaterial } from "./elementalLiquidMaterial.js";
import { registerElementalRefraction } from "./elementalRefraction.js";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { Fn, If, abs, atan, attribute, cross, dot, float, max, mix, modelNormalMatrix, normalize, positionGeometry, positionView, pow, sin, smoothstep, step, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import { authoredFlow, clockUniform, flameColor, flameDetail, matterNoise3 } from "./elementalNodes.js";
import { acquireEffectMaterial, releaseEffectMaterial } from "./sharedEffectMaterial.js";

/** Swept, tapered 3D volumes provide the principal silhouette above the fine spark layer. */
export class ElementalEnergyBodies {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.Material
  >;
  private readonly controls: THREE.InstancedBufferAttribute[] = [];
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly colour = new THREE.Color();
  private count = 0;
  dropped = 0;
  readonly capacity = 256;
  private readonly clock = { value: 0 };
  private readonly unregisterRefraction: (() => void) | undefined;
  constructor(parent: THREE.Object3D, element: SpellElement = "earth", magical = false) {
    const geometry = new THREE.InstancedBufferGeometry(),
      positions: number[] = [],
      indices: number[] = [];
    const length = magical ? 24 : element === "fire" ? 18 : 28,
      sides = magical ? 6 : element === "fire" ? 8 : 10;
    for (let j = 0; j <= length; j++)
      for (let k = 0; k <= sides; k++)
        positions.push(
          Math.cos((k * Math.PI * 2) / sides),
          j / length,
          Math.sin((k * Math.PI * 2) / sides),
        );
    for (let j = 0; j < length; j++)
      for (let k = 0; k < sides; k++) {
        const a = j * (sides + 1) + k,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    for (const key of ["curveA", "curveB", "curveC", "curveD"]) {
      const attr = new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity * 4),
        4,
      ).setUsage(THREE.DynamicDrawUsage);
      this.controls.push(attr);
      geometry.setAttribute(key, attr);
    }
    this.tint = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("bodyTint", this.tint);
    geometry.instanceCount = 0;
    const material = acquireEffectMaterial(`elemental-energy:${element}:${magical}`, () => {
    if(element === "earth" || magical) {
      const node = new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
        blending:element === "fire" ? THREE.NormalBlending : THREE.AdditiveBlending});
      const time=clockUniform(),emission=uniform(0);
      node.userData["magicEmissionPass"]=emission;
      const a=attribute("curveA","vec4" as const),b=attribute("curveB","vec4" as const),c=attribute("curveC","vec4" as const),d=attribute("curveD","vec4" as const),tint=attribute("bodyTint","vec4" as const);
      const u=positionGeometry.y,v=float(1).sub(u);
      const tangent=normalize(b.xyz.sub(a.xyz).mul(v.mul(v).mul(3)).add(c.xyz.sub(b.xyz).mul(v.mul(u).mul(6))).add(d.xyz.sub(c.xyz).mul(u.mul(u).mul(3))));
      const ref=abs(tangent.y).greaterThan(.94).select(vec3(1,0,0),vec3(0,1,0)),right=normalize(cross(tangent,ref)),up=cross(right,tangent);
      const envelope=pow(max(sin(u.mul(3.14159265)),0),.65),flame=step(.5,a.w).mul(float(1).sub(step(1.5,a.w)));
      const fold=flame.mul(.23).add(.12).mul(sin(u.mul(22).sub(time.mul(5)).add(tint.a))).mul(sin(u.mul(3.14159))).add(1);
      node.positionNode=a.xyz.mul(v.pow(3)).add(b.xyz.mul(v.mul(v).mul(u).mul(3))).add(c.xyz.mul(v.mul(u).mul(u).mul(3))).add(d.xyz.mul(u.pow(3)))
        .add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z).mul(c.w)).mul(b.w).mul(envelope).mul(fold));
      const normal=normalize(varying(modelNormalMatrix.mul(right.mul(positionGeometry.x).add(up.mul(positionGeometry.z).div(max(c.w,.1))))));
      const sample=varying(vec3(positionGeometry.x,u.mul(6),positionGeometry.z)),along=varying(u),kind=varying(a.w),seed=varying(tint.a),colour=varying(tint.rgb),sourceAlpha=varying(d.w);
      node.fragmentNode=Fn((): Node<"vec4"> =>{
        const flow=sample.mul(vec3(2,1.8,2)).add(vec3(seed,time.mul(-3),0));
        const n=matterNoise3(flow).mul(.65).add(matterNoise3(flow.mul(2.1)).mul(.35));
        const face=abs(dot(normal,normalize(positionView.negate()))),isFlame=kind.greaterThan(.5).and(kind.lessThan(1.5));
        const grain=smoothstep(isFlame.select(.25,.08),.64,n),current=pow(max(sin(along.mul(24).sub(time.mul(12)).add(n.mul(4))),0),6);
        const base=isFlame.select(.06,.32);
        const alpha=sourceAlpha.mul(base.add(float(1).sub(base).mul(grain))).mul(pow(face,.5)).toVar();
        const color=colour.mul(grain.mul(2.5).add(current.mul(1.5)).add(1.8)).add(vec3(.95,.98,1).mul(pow(face,14)).mul(current).mul(.14)).toVar();
        if(magical) {
          const across=atan(sample.z,sample.x).div(6.2831853);
          const ink=authoredFlow(vec2(along.mul(1.8).sub(time.mul(.48)),across.mul(1.5).add(seed.mul(.13))),time.mul(.18),seed);
          const torn=smoothstep(.15,.57,ink.add(n.mul(.20))),endFade=pow(max(sin(along.mul(3.14159)),0),.48);
          const heart=pow(face,7).mul(ink.mul(.52).add(.48));
          alpha.assign(sourceAlpha.mul(endFade).mul(pow(face,.7)).mul(torn.mul(.82).add(.18)));
          color.assign(colour.mul(ink.mul(2.8).add(1.8)).add(mix(colour,vec3(1),.72).mul(heart).mul(2.8)));
          If(element === "fire" ? float(1).greaterThan(0) : isFlame,()=>{
            const fire=flameDetail(vec2(across.mul(1.5),along.mul(1.25)),time.mul(1.25),seed);
            alpha.assign(sourceAlpha.mul(endFade).mul(smoothstep(.04,.33,fire)).mul(pow(face,.55)));
            color.assign(flameColor(fire,float(1).sub(along),emission));
          }).ElseIf(element === "water" ? float(1).greaterThan(0) : kind.greaterThan(2.5),()=>{
            const crest=pow(face,10).mul(smoothstep(.25,.65,ink)),bead=pow(sin(along.mul(19).sub(time.mul(7)).add(n.mul(3)).add(seed)).mul(.5).add(.5),8);
            color.assign(mix(vec3(.03,.30,2.5),vec3(.06,2.25,2.9),ink).add(vec3(2.8,3.8,3.3).mul(crest).mul(bead.mul(.95).add(.35))));
            alpha.mulAssign(torn.mul(.36).add(.64));
          });
          alpha.lessThan(.008).discard();return vec4(color,alpha);
        }
        alpha.lessThan(.006).discard();return vec4(color.mul(.17),alpha.mul(.55));
      })();
      return node;
    }
    return element === "water" ? createElementalLiquidMaterial() : createElementalMatterMaterial(element);
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.userData.effectClock = this.clock;
    this.mesh.name = element === "earth" ? "elemental-energy-bodies" : `elemental-matter-${element}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.userData["magicGlow"] = magical || element !== "water";
    this.mesh.userData["magicGlowOnly"] = (magical && element !== "fire") || element === "earth";
    parent.add(this.mesh);
    if (element === "water" && !magical) this.unregisterRefraction = registerElementalRefraction(this.mesh);
  }
  begin(seconds: number): void {
    this.count = 0;
    this.dropped = 0;
    this.clock.value = seconds;
  }
  curve(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    width: number,
    hex: number,
    alpha: number,
    seed: number,
    depth = 0.45,
    kind = 0,
  ): void {
    if (alpha < 0.008 || width < 0.002) return;
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    for (const [j, p] of [a, b, c, d].entries())
      this.controls[j]!.setXYZW(
        i,
        p[0],
        p[1],
        p[2],
        [kind, width, depth, alpha][j]!,
      );
    this.colour.setHex(hex);
    this.tint.setXYZW(i, this.colour.r, this.colour.g, this.colour.b, seed);
  }
  get instances(): number {
    return this.count;
  }
  end(): void {
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const attr of [...this.controls, this.tint]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * 4);
      attr.needsUpdate = true;
    }
  }
  dispose(): void {
    this.unregisterRefraction?.();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    releaseEffectMaterial(this.mesh.material);
  }
}
