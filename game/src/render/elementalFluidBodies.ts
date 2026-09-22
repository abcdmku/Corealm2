import * as THREE from "three";
import type { MeshBasicNodeMaterial, Node } from "three/webgpu";
import { Fn, If, abs, attribute, cos, float, modelNormalMatrix, normalize, normalGeometry, positionGeometry, sin, smoothstep, varying, varyingProperty, vec3, vec4 } from "three/tsl";
import { createElementalRefractionMaterial, registerElementalRefraction } from "./elementalRefraction.js";
import { clockUniform } from "./elementalNodes.js";

import { EffectInstances, effectInstanceMatrix } from "./effectInstances.js";
import { acquireEffectMaterial, releaseEffectMaterial } from "./sharedEffectMaterial.js";

type FluidKind = "wave" | "jet" | "drop" | "pool";

function fluidMaterial(kind: FluidKind): MeshBasicNodeMaterial {
  return acquireEffectMaterial(`elemental-fluid:${kind}`, () => {
    const matrix=effectInstanceMatrix();
    const time=clockUniform(),variant=attribute("fluidVariant","vec2" as const),surface=attribute("fluidSurface","vec3" as const);
    const seed=matrix.mul(vec4(0,0,0,1)).x.mul(.31).add(matrix.mul(vec4(0,0,0,1)).z.mul(.17)).add(variant.x.mul(2.31));
    const refNormal=varyingProperty("vec3"),refLocal=varyingProperty("vec3");
    const position=Fn((): Node<"vec3"> =>{
      const p=positionGeometry.toVar(),n=normalGeometry.toVar();
      if(kind !== "drop") {
        const phase=p.y.mul(13).sub(time.mul(7)).add(seed);
        const surge=sin(phase).mul(.025).add(sin(p.x.mul(7).add(p.z.mul(9)).add(time.mul(4)).add(seed)).mul(.018));
        p.addAssign(normalGeometry.mul(surge));
        if(kind === "jet") {
          p.x.addAssign(sin(p.y.mul(6).sub(time.mul(3)).add(seed)).mul(p.y).mul(.10));
          p.z.addAssign(cos(p.y.mul(7).sub(time.mul(2.3)).add(seed)).mul(p.y).mul(.09));
          p.x.addAssign(variant.y.mul(p.y).mul(p.y).mul(.22));
          p.xz.mulAssign(sin(p.y.mul(6).add(variant.x)).mul(.13).add(1));
        } else {
          p.y.addAssign(sin(p.x.mul(4).sub(time.mul(4.1)).add(seed)).mul(.14).mul(smoothstep(.1,.8,p.y)));
          p.z.addAssign(sin(p.x.mul(3.5).add(time.mul(3.7)).add(seed)).mul(.20).mul(smoothstep(.1,.8,p.y)));
          p.y.mulAssign(sin(p.x.mul(3.1).add(variant.x.mul(1.7))).mul(.17).add(1));
          p.z.addAssign(variant.y.mul(p.x).mul(p.x).mul(.24));
          if(kind === "wave") {
            If(variant.x.greaterThanEqual(50).and(variant.x.lessThan(60)),()=>{
              const lateral=surface.x,along=surface.y,curl=along.mul(4.241150).sub(1.5707963),crest=sin(curl).add(1).mul(.5);
              const roll=sin(lateral.mul(4).sub(time.mul(2.8)).add(seed)).mul(.055).add(sin(lateral.mul(9).add(time.mul(3.1))).mul(.025)).add(.93);
              p.assign(vec3(lateral,crest.mul(roll),cos(curl).mul(.7).add(surface.z.mul(float(1).sub(along).mul(.07).add(.045)))));
              p.z.addAssign(lateral.mul(lateral).mul(.48).add(crest.mul(crest).mul(.30)));
            }).ElseIf(variant.x.greaterThanEqual(40).and(variant.x.lessThan(50)),()=>{
              p.y.mulAssign(float(1).sub(smoothstep(.64,1,abs(p.x))));
              p.z.addAssign(p.y.mul(p.y).mul(.5));p.z.mulAssign(float(1).sub(smoothstep(.80,1,abs(p.x)).mul(.7)));
            });
          }
        }
        n.addAssign(vec3(cos(phase).mul(.28),sin(phase.mul(.7)).mul(.08),sin(phase).mul(.24)));
      }
      const m=matrix.toMat3(),col0=m.mul(vec3(1,0,0)),col1=m.mul(vec3(0,1,0)),col2=m.mul(vec3(0,0,1));
      n.divAssign(vec3(col0.dot(col0),col1.dot(col1),col2.dot(col2)));
      refNormal.assign(normalize(modelNormalMatrix.mul(m.mul(n))));
      refLocal.assign(vec3(p.x,positionGeometry.y,p.z));
      return matrix.mul(vec4(p,1)).xyz;
    })();
    const material=createElementalRefractionMaterial({liquid:true,strength:kind === "drop" ? 5 : 14,
      flowMode:kind === "pool" ? 2 : kind === "wave" ? 1 : kind === "jet" ? 3 : 0,
      positionNode:position,normalNode:refNormal,localNode:refLocal,alphaNode:float(.93),seedNode:varying(seed)});
    material.side=THREE.DoubleSide;
    return material;
  });
}

/** Closed, curling water volumes. Surface lighting and airborne spray are separate layers. */
export class ElementalFluidBodies {
  private readonly batches = new Map<FluidKind, EffectInstances<MeshBasicNodeMaterial>>();
  private readonly unregister: (()=>void)[] = [];
  private readonly object = new THREE.Object3D();
  private readonly clock = { value: 0 };
  dropped=0;
  constructor(parent: THREE.Object3D) {
    const wave = new THREE.BufferGeometry();
    const surfaceCoordinates:number[]=[];
    const vertices: number[] = [],
      indices: number[] = [];
    const columns = 40,
      rows = 16;
    for (let side = 0; side < 2; side++)
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= columns; i++) {
          const x = (i / columns) * 2 - 1,
            u = j / rows;
          const a = -Math.PI / 2 + u * Math.PI * 1.35;
          const ripple =
            0.035 * Math.sin(x * 6 + u * 5) + 0.012 * Math.sin(x * 13 - u * 8);
          const thickness = (side ? 1 : -1) * (0.07 + (1 - u) * 0.08);
          surfaceCoordinates.push(x,u,side?1:-1);
          vertices.push(
            x,
            ((Math.sin(a) + 1) * 0.5 +
              Math.max(0, Math.sin(u * Math.PI)) * ripple) *
              (1 - 0.65 * Math.pow(Math.abs(x),6) + .065*Math.sin(x*7+1.2) + .035*Math.sin(x*13)),
            (Math.cos(a) * 0.7 + thickness)*(1-.68*Math.pow(Math.abs(x),8)),
          );
        }
    const surface = (columns + 1) * (rows + 1);
    for (let side = 0; side < 2; side++)
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < columns; i++) {
          const a = side * surface + j * (columns + 1) + i,
            b = a + 1,
            c = a + columns + 1,
            d = c + 1;
          if (side) indices.push(a, c, b, b, c, d);
          else indices.push(a, b, c, b, d, c);
        }
    // Join the front and back surfaces around their perimeter.
    for (let j = 0; j < rows; j++)
      for (const i of [0, columns]) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, a + surface, b, b, a + surface, b + surface);
      }
    for (let i = 0; i < columns; i++)
      for (const j of [0, rows]) {
        const a = j * (columns + 1) + i,
          b = a + 1;
        indices.push(a, b, a + surface, b, b + surface, a + surface);
      }
    wave.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    wave.setAttribute("fluidSurface",new THREE.Float32BufferAttribute(surfaceCoordinates,3));
    wave.setIndex(indices);
    wave.computeVertexNormals();
    const jet = new THREE.CylinderGeometry(0.55, 0.18, 1, 24, 12, true);
    jet.translate(0, 0.5, 0);
    const jetVertices = jet.getAttribute("position");
    for (let i = 0; i < jetVertices.count; i++) {
      const x = jetVertices.getX(i),
        u = jetVertices.getY(i),
        z = jetVertices.getZ(i),
        a = Math.atan2(z, x);
      const fold =
        1 + Math.sin(a * 5 + u * 8) * 0.16 + Math.sin(a * 11 - u * 13) * 0.08;
      // The column breaks at different heights; detached spray carries the outward fall.
      const radius = 0.12 + Math.pow(Math.max(0,Math.sin(u*Math.PI)),.55)*.31,
        height = u * (0.90 + Math.sin(a * 3 + 1.3) * 0.025 + Math.sin(a * 7) * 0.014);
      jetVertices.setXYZ(
        i,
        Math.cos(a) * radius * fold + Math.sin(u * 3) * 0.09,
        height,
        Math.sin(a) * radius * fold + Math.sin(u * 4) * 0.09,
      );
    }
    jet.computeVertexNormals();
    for (const [kind, geometry] of [
      ["wave", wave],
      ["jet", jet],
      ["drop", new THREE.SphereGeometry(1,8,6)],
      ["pool", new THREE.SphereGeometry(1,32,12)],
    ] as const) {
      geometry.setAttribute("fluidVariant",new THREE.InstancedBufferAttribute(new Float32Array((kind==="drop"?640:32)*2),2).setUsage(THREE.DynamicDrawUsage));
      const mesh = new EffectInstances(geometry, fluidMaterial(kind), kind === "drop" ? 640 : 32);
      mesh.userData["effectClock"] = this.clock;
      this.unregister.push(registerElementalRefraction(mesh));
      mesh.instanceCount = 0;
      mesh.frustumCulled = false;
      mesh.name = `elemental-fluid-${kind}`;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 9;
      parent.add(mesh);
      this.batches.set(kind, mesh);
    }
  }
  begin(seconds: number): void {
    this.clock.value = seconds;
    this.dropped=0;
    for (const mesh of this.batches.values()) mesh.instanceCount = 0;
  }
  put(
    kind: "wave" | "jet" | "drop" | "pool",
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    pitch=0,
    variant=0,
    bend=0,
  ): void {
    const mesh = this.batches.get(kind)!;
    if(Math.min(sx,sy,sz)<.005)return;
    if(mesh.instanceCount>=mesh.instanceMatrix.count){this.dropped++;return;}
    this.object.position.set(x, y, z);
    this.object.rotation.set(pitch, yaw, 0);
    this.object.scale.set(sx, sy, sz);
    this.object.updateMatrix();
    mesh.setMatrixAt(mesh.instanceCount, this.object.matrix);
    (mesh.geometry.getAttribute("fluidVariant") as THREE.InstancedBufferAttribute).setXY(mesh.instanceCount++,variant,bend);
  }
  get instances(): number {
    return [...this.batches.values()].reduce((sum, m) => sum + m.instanceCount, 0);
  }
  end(): void {
    for (const mesh of this.batches.values()) {
      mesh.visible = mesh.instanceCount > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute("fluidVariant").needsUpdate = true;
    }
  }
  dispose(): void {
    for (const unregister of this.unregister) unregister();
    for (const mesh of this.batches.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      releaseEffectMaterial(mesh.material);
    }
  }
}
