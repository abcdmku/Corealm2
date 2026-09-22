import * as THREE from "three";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import { attribute, float, max, normalLocal, positionGeometry, reference, screenCoordinate, smoothstep, transformNormalToView, varying, vec2, vec3 } from "three/tsl";
import { authoredFlow, matterNoise3 as stoneNoise } from "./elementalNodes.js";
import { isolateMagicEmission } from "./magicGlow.js";
import { surfaceColorNode } from "./nodeMaterials.js";

type Face = THREE.Vector3[];
const noise = (n: number) => { const x = Math.sin(n * 127.1 + 17.7) * 43758.5453; return x - Math.floor(x); };

/** The shadow pass uses the same fragment coverage as the dissolving stone. */
export function fadeFractureShadow(material: MeshStandardNodeMaterial, fade: {value:number}): void {
  const coverageNoise=screenCoordinate.xy.floor().dot(vec2(.06711056,.00583715)).fract().mul(52.9829189).fract();
  material.maskShadowNode=coverageNoise.lessThan(reference('value','float',fade));
}

export function turnFracture(v:Node<'vec3'>,axis:Node<'vec3'>,angle:Node<'float'>):Node<'vec3'>{
  const c=angle.cos(),s=angle.sin();
  return v.mul(c).add(axis.cross(v).mul(s)).add(axis.mul(axis.dot(v)).mul(float(1).sub(c)));
}

/** Clip a convex cell, retaining the cap so every fracture fragment is a closed solid. */
function clip(faces: Face[], normal: THREE.Vector3, distance: number): Face[] {
  const next: Face[] = [], cap: THREE.Vector3[] = [];
  for (const face of faces) {
    const polygon: Face = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!, b = face[(i + 1) % face.length]!;
      const da = normal.dot(a) - distance, db = normal.dot(b) - distance;
      if (da <= 1e-7) polygon.push(a);
      if ((da < 0) !== (db < 0)) {
        const point = a.clone().lerp(b, da / (da - db));
        polygon.push(point);
        if (!cap.some(p => p.distanceToSquared(point) < 1e-10)) cap.push(point);
      }
    }
    if (polygon.length >= 3) next.push(polygon);
  }
  if (cap.length >= 3) {
    const centre = cap.reduce((v,p) => v.add(p), new THREE.Vector3()).multiplyScalar(1 / cap.length);
    const right = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) < .8 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0)).normalize();
    const up = new THREE.Vector3().crossVectors(normal,right);
    cap.sort((a,b) => Math.atan2(up.dot(a.clone().sub(centre)),right.dot(a.clone().sub(centre))) - Math.atan2(up.dot(b.clone().sub(centre)),right.dot(b.clone().sub(centre))));
    next.push(cap);
  }
  return next;
}

const cache = new Map<number, THREE.BufferGeometry>();
/** A Voronoi partition of one boulder. Neighbours share their cut plane exactly at release. */
export function fracturedBoulderGeometry(count: number): THREE.BufferGeometry {
  const cached = cache.get(count);
  if (cached) return cached.clone();
  const hull = new THREE.IcosahedronGeometry(1,1), p = hull.getAttribute("position");
  const faces: Face[] = [];
  const shape = (v: THREE.Vector3) => v.multiplyScalar(.92 + Math.sin(v.x*4+v.y*3)*Math.cos(v.z*5)*.055);
  for (let i=0; i<p.count; i+=3) faces.push([0,1,2].map(k => shape(new THREE.Vector3().fromBufferAttribute(p,i+k))));
  const seeds: THREE.Vector3[] = [];
  for (let i=0; i<count; i++) {
    const y = noise(i*3+1)*2-1, angle = noise(i*3+2)*Math.PI*2, r = Math.cbrt(noise(i*3+3))*.84;
    seeds.push(new THREE.Vector3(Math.cos(angle)*Math.sqrt(1-y*y),y,Math.sin(angle)*Math.sqrt(1-y*y)).multiplyScalar(r));
  }
  const vertices: number[] = [], centres: number[] = [], motions: number[] = [];
  let pieces = 0;
  for (const [i, seed] of seeds.entries()) {
    let cell = faces;
    for (const other of seeds) {
      if (other === seed) continue;
      const normal = other.clone().sub(seed).normalize();
      cell = clip(cell,normal,normal.dot(other.clone().add(seed).multiplyScalar(.5)));
      if (!cell.length) break;
    }
    if (!cell.length) continue;
    pieces++;
    const points = cell.flat(), centre = points.reduce((v,p) => v.add(p), new THREE.Vector3()).multiplyScalar(1/points.length);
    const extent = Math.max(...points.map(p => p.distanceTo(centre)));
    const velocity = centre.clone().normalize().multiplyScalar(2.5 + noise(i+501)*3);
    velocity.y = 2.5 + noise(i+701)*4;
    for (const face of cell) for (let k=1; k<face.length-1; k++) for (const v of [face[0]!,face[k]!,face[k+1]!]) {
      vertices.push(v.x,v.y,v.z);
      centres.push(centre.x,centre.y,centre.z,extent);
      motions.push(velocity.x,velocity.y,velocity.z,noise(i+301)*10);
    }
  }
  hull.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("shardCentre",new THREE.Float32BufferAttribute(centres,4));
  geometry.setAttribute("shardMotion",new THREE.Float32BufferAttribute(motions,4));
  geometry.computeVertexNormals();
  geometry.userData["pieces"] = pieces;
  cache.set(count,geometry);
  return geometry.clone();
}

export class FracturedBoulder {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, MeshStandardNodeMaterial>;
  readonly release = { value: 0 };
  readonly scale = { value: 1 };
  private readonly energy = { value: 0 };
  private readonly floor = { value: 0 };
  private readonly fade = { value: 0 };
  constructor(parent: THREE.Object3D, count: number, name: string,private readonly ground:(x:number,z:number)=>number=()=>0) {
    const material = new MeshStandardNodeMaterial({ color: 0x7e8479, roughness: .83, flatShading: true, transparent: true });
    const t=reference('release.value','float',this),size=reference('scale.value','float',this);
    const floor=reference('floor.value','float',this),energy=reference('energy.value','float',this);
    const shardCentre=attribute('shardCentre','vec4' as const),shardMotion=attribute('shardMotion','vec4' as const);
    const axis=vec3(shardMotion.w.sin(),.7,shardMotion.w.cos()).normalize();
    const angle=t.mul(shardMotion.w.mul(.45).add(1.5));
    const centre=shardCentre.xyz.add(shardMotion.xyz.mul(float(1).sub(t.mul(-1.1).exp()).div(1.1)));
    const floorY=floor.add(shardCentre.w.mul(.48)),fall=centre.y.sub(t.mul(t).mul(7.5).div(size));
    const bounce=floorY.sub(fall).mul(2).sin().abs().mul(.11).mul(t.mul(-2).exp());
    const grounded=max(floorY,fall).add(fall.lessThan(floorY).select(bounce,0));
    material.positionNode=vec3(centre.x,t.greaterThan(.00001).select(grounded,centre.y),centre.z)
      .add(turnFracture(positionGeometry.sub(shardCentre.xyz),axis,angle));
    material.normalNode=transformNormalToView(turnFracture(normalLocal,axis,angle));
    const point=varying(positionGeometry),grain=stoneNoise(point.mul(37)),strata=stoneNoise(point.mul(vec3(4,22,4)));
    const mineral=authoredFlow(point.xz.mul(.65).add(point.y.mul(.3)),float(0),float(3));
    material.colorNode=surfaceColorNode(material).rgb.mul(grain.mul(.24).add(strata.mul(.13)).add(mineral.mul(.55)).add(.48));
    const charged=point.y.mul(5).add(mineral.mul(18)).sub(energy.mul(4)).sin().mul(.5).add(.5).pow(8);
    material.emissiveNode=vec3(.4,.78,.22).mul(smoothstep(.36,.70,mineral).pow(2)).mul(charged.mul(1.8).add(1.5));
    fadeFractureShadow(material,this.fade);
    isolateMagicEmission(material);
    this.mesh = new THREE.Mesh(fracturedBoulderGeometry(count), material);
    this.mesh.name = name;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData["magicGlow"]=true;
    this.mesh.castShadow = true;
    parent.add(this.mesh);
  }
  get pieces(): number { return this.mesh.geometry.userData["pieces"] as number; }
  hide(): void { this.mesh.visible = false; }
  pose(x:number,y:number,z:number,size:number,spin:number,shatter:number,fade:number): void {
    this.mesh.visible = fade > .01;
    this.mesh.position.set(x,y,z);
    this.mesh.scale.setScalar(size);
    this.mesh.rotation.y = spin;
    this.release.value = Math.max(0,shatter);
    this.energy.value = spin+Math.max(0,shatter)*2;
    this.scale.value = size;
    this.floor.value = (this.ground(x,z)-y)/size;
    this.mesh.material.opacity = fade;
    this.fade.value = fade;
  }
  dispose(): void { this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose(); }
}
