import * as THREE from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { Fn, abs, attribute, cos, dot, float, fract, mat3, max, modelNormalMatrix, normalGeometry, normalize, positionGeometry, positionView, pow, screenCoordinate, sin, smoothstep, varying, vec2, vec3, vec4 } from "three/tsl";

import { clockUniform } from "./elementalNodes.js";
import { acquireEffectMaterial, releaseEffectMaterial } from "./sharedEffectMaterial.js";

/** All motes are three-dimensional meshes. No camera-facing cards or particle atlases. */
export class ElementalParticleCloud {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    MeshBasicNodeMaterial
  >;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly colours: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private count = 0;
  private readonly clock = { value: 0 };
  private energyGain = 1;
  dropped = 0;
  private readonly colour = new THREE.Color();
  readonly capacity: number;
  private readonly sizeFactor: number;
  constructor(
    parent: THREE.Object3D,
    kind: "light" | "smoke" | "fragment" | "droplet",
    capacity: number,
  ) {
    this.capacity = capacity;
    this.sizeFactor = kind === "light" ? 0.24 : kind === "fragment" ? 0.65 : kind === "droplet" ? .32 : 1;
    const base = kind === "fragment" ? new THREE.TetrahedronGeometry(1) : new THREE.OctahedronGeometry(1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("normal", base.getAttribute("normal"));
    if (base.index) geometry.setIndex(base.index);
    this.centres = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.colours = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("centreSize", this.centres);
    geometry.setAttribute("tintAlpha", this.colours);
    geometry.setAttribute("shape", this.shapes);
    geometry.instanceCount = 0;
    const material = acquireEffectMaterial(`elemental-particle:${kind}`, () => {
      const material = new MeshBasicNodeMaterial({
        transparent: kind !== "fragment", depthWrite: kind === "fragment", depthTest: true,
        blending: kind === "light" ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.FrontSide,
      });
      const time = clockUniform();
      const centre=attribute("centreSize","vec4" as const),tint=attribute("tintAlpha","vec4" as const),shape=attribute("shape","vec4" as const);
      const c=cos(shape.x),s=sin(shape.x);
      let spin: Node<"mat3">=mat3(c,0,s.negate(),0,1,0,s,0,c);
      if(kind === "fragment") {
        const ax=shape.w.mul(1.73).add(time.mul(fract(shape.w.mul(.37)).mul(3).add(1.1)));
        const az=shape.w.mul(2.41).sub(time.mul(fract(shape.w.mul(.63)).mul(2).add(.9)));
        spin=spin.mul(mat3(1,0,0,0,cos(ax),sin(ax),0,sin(ax).negate(),cos(ax))).mul(mat3(cos(az),sin(az),0,sin(az).negate(),cos(az),0,0,0,1));
      }
      const stretch=vec3(shape.y,shape.z,1);
      material.positionNode=centre.xyz.add(spin.mul(positionGeometry.mul(stretch)).mul(centre.w));
      const normal=normalize(varying(modelNormalMatrix.mul(spin.mul((kind === "droplet" ? positionGeometry : normalGeometry).div(stretch)))));
      const local=varying(positionGeometry),seed=varying(shape.w),vTint=varying(tint);
      material.fragmentNode=Fn((): Node<"vec4"> =>{
        const face=max(dot(normal,normalize(positionView.negate())),0);
        const lit=max(dot(normal,normalize(vec3(-.4,.8,.3))),0).mul(.52).add(.48);
        const alpha=vTint.a.toVar(),colour=vTint.rgb.toVar();
        if(kind === "smoke") {
          const breakup=smoothstep(-.2,.7,sin(local.x.mul(9).add(seed)).mul(sin(local.y.mul(8).sub(time.mul(.7)))).mul(sin(local.z.mul(11).add(seed.mul(.3)))));
          alpha.mulAssign(pow(face,3).mul(breakup).mul(.32));colour.mulAssign(lit);
        } else if(kind === "fragment") {
          fract(sin(dot(screenCoordinate.xy,vec2(12.9898,78.233))).mul(43758.5453)).greaterThan(alpha).discard();colour.mulAssign(lit);
        } else if(kind === "droplet") {
          const rim=pow(float(1).sub(face),3);
          const glint=pow(max(dot(normal,normalize(normalize(positionView.negate()).add(vec3(-.4,.8,.3)))),0),32);
          colour.assign(colour.mul(lit.mul(.40).add(.46)).add(vec3(.36,.48,.49).mul(rim)).add(vec3(.84,.92,.94).mul(glint)));
          alpha.mulAssign(face.mul(.24).add(.76));
        } else {
          colour.mulAssign(pow(face,8).mul(9).add(4));alpha.mulAssign(pow(face,2.5));
        }
        alpha.lessThan(.006).discard();return vec4(colour,alpha);
      })();
      return material;
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.userData["effectClock"] = this.clock;
    this.mesh.frustumCulled = false;
    this.mesh.name = `elemental-3d-${kind}`;
    this.mesh.userData["magicGlow"] = kind === "light";
    this.mesh.userData["magicGlowOnly"] = kind === "light";
    this.mesh.renderOrder =
      kind === "fragment" ? 0 : kind === "smoke" ? 10 : 11;
    parent.add(this.mesh);
  }
  begin(seconds: number, energyGain = 1): void {
    this.energyGain = energyGain;
    this.count = 0;
    this.dropped = 0;
    this.clock.value = seconds;
  }
  put(
    x: number,
    y: number,
    z: number,
    size: number,
    hex: number,
    alpha: number,
    seed: number,
    stretch = 1,
    energy = 1,
  ): void {
    if (size < 0.001 || alpha < 0.006) return;
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.centres.setXYZW(i, x, y, z, size * this.sizeFactor);
    this.colour.setHex(hex).multiplyScalar(energy);
    if (this.energyGain !== 1) this.colour.multiplyScalar(this.energyGain);
    this.colours.setXYZW(i, this.colour.r, this.colour.g, this.colour.b, alpha);
    this.shapes.setXYZW(
      i,
      seed * 0.71,
      0.55 + Math.abs(Math.sin(seed * 3)) * 0.6,
      stretch,
      seed,
    );
  }
  get instances(): number {
    return this.count;
  }
  end(): void {
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.instanceCount = this.count;
    for (const attr of [this.centres, this.colours, this.shapes]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * 4);
      attr.needsUpdate = true;
    }
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    releaseEffectMaterial(this.mesh.material);
  }
}
