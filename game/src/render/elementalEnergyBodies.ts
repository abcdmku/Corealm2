import * as THREE from "three";
import type { Vec3, SpellElement } from "../contracts.js";
import { createElementalMatterMaterial } from "./elementalMatterMaterial.js";
import { createElementalLiquidMaterial } from "./elementalLiquidMaterial.js";
import { registerElementalRefraction } from "./elementalRefraction.js";

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
  constructor(parent: THREE.Object3D, element: SpellElement = "earth") {
    const geometry = new THREE.InstancedBufferGeometry(),
      positions: number[] = [],
      indices: number[] = [];
    const length = element === "fire" ? 18 : 28,
      sides = element === "fire" ? 8 : 10;
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
    const material = element === "earth" ? new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { time: this.clock },
      vertexShader: `attribute vec4 curveA,curveB,curveC,curveD,bodyTint;uniform float time;
      varying vec3 vNormal,vView,vColour,vSample;varying float vAlpha,vAlong,vKind,vSeed;
      void main(){float u=position.y,v=1.0-u;vec3 p=v*v*v*curveA.xyz+3.0*v*v*u*curveB.xyz+3.0*v*u*u*curveC.xyz+u*u*u*curveD.xyz;
        vec3 tangent=normalize(3.0*v*v*(curveB.xyz-curveA.xyz)+6.0*v*u*(curveC.xyz-curveB.xyz)+3.0*u*u*(curveD.xyz-curveC.xyz));
        vec3 ref=abs(tangent.y)>.94?vec3(1,0,0):vec3(0,1,0);vec3 right=normalize(cross(tangent,ref)),up=cross(right,tangent);
        float envelope=pow(max(0.0,sin(u*3.14159265)),.65);float flame=step(.5,curveA.w)*(1.0-step(1.5,curveA.w));float fold=1.0+(.12+flame*.23)*sin(u*22.0-time*5.0+bodyTint.a)*sin(u*3.14159);
        vec3 radial=right*position.x+up*position.z*curveC.w;p+=radial*curveB.w*envelope*fold;
        vec4 view=modelViewMatrix*vec4(p,1);vNormal=normalize(normalMatrix*(right*position.x+up*position.z/max(.1,curveC.w)));vView=-view.xyz;
        vSample=vec3(position.x,position.y*6.0,position.z);vAlong=u;vKind=curveA.w;vSeed=bodyTint.a;vColour=bodyTint.rgb;vAlpha=curveD.w;gl_Position=projectionMatrix*view;}`,
      fragmentShader: `uniform float time;varying vec3 vNormal,vView,vColour,vSample;varying float vAlpha,vAlong,vKind,vSeed;
      float hash(vec3 p){p=fract(p*.3183099+.17);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){vec3 flow=vSample*vec3(2.0,1.8,2.0)+vec3(vSeed,-time*3.,0.);float n=noise(flow)*.65+noise(flow*2.1)*.35;
        float face=abs(dot(normalize(vNormal),normalize(vView)));float grain=smoothstep(vKind>.5&&vKind<1.5?.25:.08,.64,n);
        float current=pow(max(0.,sin(vAlong*24.0-time*12.0+n*4.0)),6.0);float base=vKind>.5&&vKind<1.5?.06:.32;float alpha=vAlpha*(base+(1.0-base)*grain)*pow(face,.5);
        vec3 c=vColour*(1.8+grain*2.5+current*1.5);c+=vec3(.95,.98,1.0)*pow(face,14.0)*current*.14;
        if(alpha<.006)discard;gl_FragColor=vec4(c*.17,alpha*.55);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }) : element === "water" ? createElementalLiquidMaterial(this.clock) : createElementalMatterMaterial(element, this.clock);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = element === "earth" ? "elemental-energy-bodies" : `elemental-matter-${element}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.userData["magicGlow"] = element !== "water";
    this.mesh.userData["magicGlowOnly"] = element === "earth";
    parent.add(this.mesh);
    if (element === "water") this.unregisterRefraction = registerElementalRefraction(this.mesh);
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
    this.mesh.material.dispose();
  }
}
