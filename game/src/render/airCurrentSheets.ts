import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import { attribute, buffer, cos, exp, float, instanceIndex, mix, modelNormalMatrix, sin, smoothstep, transformNormal, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { authoredFlow, clockUniform } from "./elementalNodes.js";
import { createElementalRefractionMaterial, registerElementalRefraction } from "./elementalRefraction.js";

type CurrentShape = "crescent" | "spiral" | "jet" | "helix";
interface CurrentProfile { turns?: number; width?: number; foot?: number; drift?: number; }

/** Sculpted air currents: 384 triangles per strip, with scene distortion and eroded luminous edges. */
export class AirCurrentSheets {
  private readonly batches = new Map<CurrentShape, {
    visible: THREE.InstancedMesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
    pressure: THREE.InstancedMesh<THREE.BufferGeometry, MeshBasicNodeMaterial>;
  }>();
  private readonly clock = { value: 0 };
  private readonly pose = new THREE.Object3D();
  private readonly unregister: (() => void)[] = [];
  dropped = 0;
  constructor(parent: THREE.Object3D, name = "elemental-air") {
    for (const [shape, id] of [["crescent", 0], ["spiral", 1], ["jet", 2], ["helix", 3]] as const) {
      const geometry = new THREE.PlaneGeometry(1, 1, 48, 4);
      const pos = geometry.getAttribute("position"), coords = geometry.getAttribute("uv");
      for (let i = 0; i < pos.count; i++) {
        const u = coords.getX(i), v = coords.getY(i), a = u * Math.PI * 2;
        pos.setXYZ(i, Math.cos(a) * (.8 + v * .2), u + Math.sin(a) * .1, Math.sin(a) * (.8 + v * .2));
      }
      geometry.computeVertexNormals();
      geometry.setAttribute("currentLife", new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("currentProfile", new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const life=attribute("currentLife","vec4"),profile=attribute("currentProfile","vec4"),time=clockUniform(this.clock);
      const currentPoint=(coords:Node<"vec2">):Node<"vec3">=>{
        const u=coords.x,v=coords.y,seed=life.y,turns=profile.x;
        const taper=sin(u.mul(Math.PI)).max(.0001).pow(.65),width=profile.y;
        const curl=sin(u.mul(14).sub(time.mul(5)).add(seed)).mul(.022)
          .add(sin(u.mul(29).add(time.mul(3)).add(seed)).mul(.009));
        if(id===0){
          const angle=u.sub(.5).mul(2.95),radius=float(1).sub(v.mul(width).mul(taper)).add(curl.mul(taper));
          return vec3(sin(angle).mul(radius),cos(angle).mul(radius).sub(.48),
            sin(u.mul(6).add(seed)).mul(.11).mul(taper).add(sin(v.mul(3.14)).mul(.18)));
        }
        if(id===1){
          const angle=u.mul(Math.PI*2).mul(turns).add(time.mul(profile.w));
          const radius=float(1).sub(u.mul(.88)).add(v.sub(.5).mul(width).mul(taper)).add(curl);
          return vec3(cos(angle).mul(radius),u.mul(.7).add(sin(u.mul(9).add(seed)).mul(.12).mul(taper)),sin(angle).mul(radius));
        }
        if(id===2){
          const angle=v.sub(.5).mul(width).mul(5).add(u.mul(Math.PI*2).mul(turns)).add(time.mul(profile.w));
          const radius=float(1).sub(u).max(0).pow(1.35).mul(.70).add(.025).mul(curl.mul(4).add(1));
          return vec3(cos(angle).mul(radius),sin(angle).mul(radius),u.mul(2).sub(1));
        }
        const angle=u.mul(Math.PI*2).mul(turns).add(time.mul(profile.w));
        const radius=profile.z.add(float(1).sub(profile.z).mul(u)).mul(curl.mul(2.5).add(1));
        return vec3(cos(angle).mul(radius).add(sin(u.mul(6).add(time.mul(1.1)).add(seed)).mul(u).mul(.10)),
          u.add(v.sub(.5).mul(width).mul(taper)),sin(angle).mul(radius).add(cos(u.mul(5).sub(time).add(seed)).mul(u).mul(.08)));
      };
      const coord=uv(),point=currentPoint(coord);
      const du=currentPoint(coord.add(vec2(.001,0))).sub(point),dv=currentPoint(coord.add(vec2(0,.001))).sub(point);
      const localNormal=du.cross(dv).add(vec3(.00000001)).normalize();
      const matrices=new THREE.InstancedBufferAttribute(new Float32Array(64*16),16).setUsage(THREE.DynamicDrawUsage);
      const matrix=buffer(matrices.array,"mat4",64).element(instanceIndex);
      const positionNode=matrix.mul(vec4(point,1)).xyz;
      const normalNode=varying(modelNormalMatrix.mul(transformNormal(localNormal,matrix)).normalize());
      const emission={value:0};
      const material=new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,alphaTest:.009});
      material.positionNode=positionNode;
      const u=coord.x,v=coord.y;
      const noise=authoredFlow(vec2(u.mul(2.4).sub(time.mul(.48)),v.mul(.55).add(u.mul(.16))),time.mul(.6),life.y);
      const ends=smoothstep(0,.08,u).mul(float(1).sub(smoothstep(.86,1,u)));
      const edgePath=sin(u.mul(18).sub(time.mul(5)).add(noise.mul(2))).mul(.038).add(.12);
      const leading=exp(v.sub(edgePath).div(.075).pow(2).negate());
      const tearing=smoothstep(.08,.58,noise.add(v.mul(.18)));
      const body=sin(v.mul(Math.PI)).mul(tearing).mul(.62);
      const striae=sin(v.mul(46).add(noise.mul(6)).sub(u.mul(18)).sub(time.mul(3))).mul(.5).add(.5).pow(12).mul(tearing);
      const pulse=sin(u.mul(27).sub(time.mul(9)).add(life.y)).mul(.5).add(.5).pow(6);
      const tint=mix(vec3(.018,.085,.19),vec3(.065,.08,.23),life.z.mul(.35));
      const color=mix(tint,vec3(.78,.94,1),leading.mul(.90).add(striae.mul(.20)));
      const energy=vec3(.03,.17,.45).mul(striae).mul(.55)
        .add(mix(vec3(.48,1.25,2.4),vec3(.75,1.1,2.5),life.z.mul(.35)).mul(leading).mul(pulse.mul(2.1).add(1.05)));
      material.colorNode=mix(color,energy,clockUniform(emission));
      material.opacityNode=life.x.mul(ends).mul(body.add(leading.mul(tearing.mul(.75).add(.12))).add(striae.mul(.16)));
      material.userData["magicEmissionPass"]=emission;
      const pressureMaterial=createElementalRefractionMaterial({clock:this.clock,liquid:false,strength:22,
        positionNode,normalNode,localNode:varying(point),alphaNode:life.x.mul(.88),seedNode:life.y,
        coverageNode:smoothstep(0,.05,u).mul(float(1).sub(smoothstep(.90,1,u))).mul(sin(v.mul(Math.PI)))});
      pressureMaterial.side=THREE.DoubleSide;
      const visible=new THREE.InstancedMesh(geometry,material,64);
      const pressure=new THREE.InstancedMesh(geometry,pressureMaterial,64);
      visible.instanceMatrix=pressure.instanceMatrix=matrices;
      for (const mesh of [visible, pressure]) {
        mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(mesh);
      }
      visible.name = `${name}-current-${shape}`; visible.renderOrder = 14;
      visible.userData["magicGlow"] = true;
      pressure.name = `${name}-current-refraction-${shape}`;
      this.unregister.push(registerElementalRefraction(pressure));
      this.batches.set(shape, { visible, pressure });
    }
  }
  get instances(): number { return [...this.batches.values()].reduce((n, b) => n + b.visible.count * 2, 0); }
  begin(seconds: number): void { this.clock.value = seconds; this.dropped = 0; for (const b of this.batches.values()) b.visible.count = b.pressure.count = 0; }
  put(shape: CurrentShape, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    alpha: number, seed: number, yaw = 0, pitch = 0, roll = 0, profile: CurrentProfile = {}): void {
    if (alpha < .009 || Math.min(sx, sy, sz) < .008) return;
    const b = this.batches.get(shape)!, i = b.visible.count;
    if (i >= 64) { this.dropped++; return; }
    this.pose.position.set(x, y, z); this.pose.rotation.set(pitch, yaw, roll); this.pose.scale.set(sx, sy, sz); this.pose.updateMatrix();
    b.visible.setMatrixAt(i, this.pose.matrix); b.pressure.setMatrixAt(i, this.pose.matrix);
    (b.visible.geometry.getAttribute("currentLife") as THREE.InstancedBufferAttribute).setXYZW(i, alpha, seed, (seed % 5) / 4, 0);
    (b.visible.geometry.getAttribute("currentProfile") as THREE.InstancedBufferAttribute).setXYZW(i, profile.turns ?? 1.2, profile.width ?? .4, profile.foot ?? .68, profile.drift ?? 1.4);
    b.visible.count++; b.pressure.count++;
  }
  end(): void {
    for (const b of this.batches.values()) {
      for (const mesh of [b.visible, b.pressure]) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; }
      b.visible.geometry.getAttribute("currentLife").needsUpdate = true;
      b.visible.geometry.getAttribute("currentProfile").needsUpdate = true;
    }
  }
  dispose(): void {
    for (const unregister of this.unregister) unregister();
    for (const b of this.batches.values()) { b.visible.removeFromParent(); b.pressure.removeFromParent(); b.visible.geometry.dispose(); b.visible.material.dispose(); b.pressure.material.dispose(); }
  }
}
