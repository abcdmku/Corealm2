import * as THREE from "three";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";
import { isolateMagicEmission } from "./magicGlow.js";

type Face = THREE.Vector3[];
const noise = (n: number) => { const x = Math.sin(n * 127.1 + 17.7) * 43758.5453; return x - Math.floor(x); };

/** Packed depth does not inherit transparent surface opacity. Fade its coverage too. */
export function fadeFractureShadow(shader: THREE.WebGLProgramParametersWithUniforms, fade: {value:number}): void {
  shader.uniforms['fractureFade']=fade;
  shader.fragmentShader=`uniform float fractureFade;\n${shader.fragmentShader}`.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
    float coverageNoise=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
    if(coverageNoise>=fractureFade)discard;`);
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
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly release = { value: 0 };
  readonly scale = { value: 1 };
  private readonly energy = { value: 0 };
  private readonly floor = { value: 0 };
  private readonly fade = { value: 0 };
  constructor(parent: THREE.Object3D, count: number, name: string,private readonly ground:(x:number,z:number)=>number=()=>0) {
    const material = new THREE.MeshStandardMaterial({ color: 0x7e8479, roughness: .83, flatShading: true, transparent: true });
    material.onBeforeCompile = shader => {
      shader.uniforms["shatterTime"] = this.release;
      shader.uniforms["rockScale"] = this.scale;
      shader.uniforms["rockFloor"] = this.floor;
      shader.uniforms["mineralTime"] = this.energy;
      shader.uniforms["flowTexture"]={value:elementalFlowTexture()};
      shader.vertexShader = `attribute vec4 shardCentre,shardMotion;uniform float shatterTime,rockScale,rockFloor;
        varying vec3 rockPoint;
        vec3 fractureTurn(vec3 v){
          vec3 axis=normalize(vec3(sin(shardMotion.w),.7,cos(shardMotion.w)));
          float angle=shatterTime*(1.5+shardMotion.w*.45),s=sin(angle),c=cos(angle);
          return v*c+cross(axis,v)*s+axis*dot(axis,v)*(1.-c);
        }\n${shader.vertexShader}`
        .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\nobjectNormal=fractureTurn(objectNormal);")
        .replace("#include <begin_vertex>",`float t=shatterTime;
          vec3 centre=shardCentre.xyz+shardMotion.xyz*((1.-exp(-t*1.1))/1.1);
          float floorY=rockFloor+shardCentre.w*.48;
          float fall=centre.y-7.5*t*t/rockScale;
          if(t>0.00001){centre.y=max(floorY,fall);
          if(fall<floorY)centre.y+=abs(sin((floorY-fall)*2.0))*.11*exp(-t*2.);}
          vec3 transformed=centre+fractureTurn(position-shardCentre.xyz);
          rockPoint=position;`);
      shader.fragmentShader = `uniform float mineralTime;varying vec3 rockPoint;${flowSampling}
        float stoneHash(vec3 p){p=fract(p*.3183099+.17);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        \n${shader.fragmentShader}`.replace("#include <color_fragment>",`#include <color_fragment>
        float grain=stoneNoise(rockPoint*37.0),strata=stoneNoise(rockPoint*vec3(4.,22.,4.));
        float mineral=authoredFlow(rockPoint.xz*.65+rockPoint.y*.3,0.,3.);
        diffuseColor.rgb*=.48+grain*.24+strata*.13+mineral*.55;`)
        .replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
          float charged=pow(.5+.5*sin(rockPoint.y*5.+mineral*18.-mineralTime*4.),8.);
          totalEmissiveRadiance=vec3(.4,.78,.22)*pow(smoothstep(.36,.70,mineral),2.)*(1.5+charged*1.8);`);
    };
    isolateMagicEmission(material);
    this.mesh = new THREE.Mesh(fracturedBoulderGeometry(count), material);
    this.mesh.name = name;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData["magicGlow"]=true;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader,renderer) => {
      material.onBeforeCompile(shader,renderer);
      fadeFractureShadow(shader,this.fade);
    };
    this.mesh.customDepthMaterial = depth;
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
  dispose(): void { this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();this.mesh.customDepthMaterial?.dispose(); }
}
