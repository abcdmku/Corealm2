import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  Break, Continue, Discard, Fn, If, Loop, abs, atan, attribute, cameraPosition,
  clamp, dot, exp, float, floor, fract, length, max, min, mix,
  modelWorldMatrixInverse, normalize, positionGeometry, pow, screenCoordinate,
  sin, smoothstep, texture3D, uniform, varying, vec2, vec3, vec4,
} from "three/tsl";

let combustionNoise: THREE.Data3DTexture | undefined;
function fireNoise(): THREE.Data3DTexture {
  if (combustionNoise) return combustionNoise;
  // Seeded spatial fuel, sampled with hardware interpolation.
  // No flame silhouettes or sprite tiles are stamped into this field.
  const size = 64, data = new Uint8Array(size ** 3);
  let seed = 0x6d2b79f5;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = seed >>> 24;
  }
  combustionNoise = new THREE.Data3DTexture(data, size, size, size);
  combustionNoise.format = THREE.RedFormat;
  combustionNoise.minFilter = combustionNoise.magFilter = THREE.LinearFilter;
  combustionNoise.wrapS = combustionNoise.wrapT = combustionNoise.wrapR = THREE.RepeatWrapping;
  combustionNoise.unpackAlignment = 1;
  combustionNoise.needsUpdate = true;
  return combustionNoise;
}

const spatialHash = Fn(([point]: [Node<"vec3">]) => {
  const p = fract(point.mul(.3183099).add(vec3(.13, .37, .71))).mul(17).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({ name: "atmosphereHash", type: "float", inputs: [{ name: "point", type: "vec3" }] });

const spatialNoise = Fn(([point]: [Node<"vec3">]) => {
  const cell = floor(point).toVar();
  const f = fract(point).toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  return mix(
    mix(mix(spatialHash(cell), spatialHash(cell.add(vec3(1, 0, 0))), f.x),
      mix(spatialHash(cell.add(vec3(0, 1, 0))), spatialHash(cell.add(vec3(1, 1, 0))), f.x), f.y),
    mix(mix(spatialHash(cell.add(vec3(0, 0, 1))), spatialHash(cell.add(vec3(1, 0, 1))), f.x),
      mix(spatialHash(cell.add(vec3(0, 1, 1))), spatialHash(cell.add(vec3(1, 1, 1))), f.x), f.y), f.z,
  );
}).setLayout({ name: "atmosphereNoise", type: "float", inputs: [{ name: "point", type: "vec3" }] });

/** Twelve-triangle proxies; flowing density is evaluated on the GPU inside each 3D volume. */
export class ElementalAtmosphere {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, MeshBasicNodeMaterial>;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly floors: THREE.InstancedBufferAttribute;
  private readonly phases: THREE.InstancedBufferAttribute;
  private readonly time = uniform(0);
  private count = 0;
  dropped = 0;
  readonly capacity = 48;
  constructor(parent: THREE.Object3D, kind: "fire" | "wind" | "dust" | "smoke") {
    const base = new THREE.BoxGeometry(2, 2, 2), geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));geometry.setIndex(base.index);
    this.centres = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.floors = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1).setUsage(THREE.DynamicDrawUsage);
    this.phases = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("volumeCentre",this.centres);geometry.setAttribute("volumeShape",this.shapes);geometry.setAttribute("volumeFloor",this.floors);geometry.setAttribute("volumePhase",this.phases);geometry.instanceCount=0;

    const centre = attribute("volumeCentre", "vec4");
    const shape = attribute("volumeShape", "vec4");
    const vCentre = varying(centre.xyz);
    const vSize = varying(shape.xyz);
    const vAlpha = varying(centre.w);
    const vSeed = varying(shape.w);
    const vFloor = varying(attribute("volumeFloor", "float"));
    const vPhase = varying(attribute("volumePhase", "float"));
    const vSurface = varying(positionGeometry);
    const vEye = varying(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz.sub(centre.xyz).div(shape.xyz));
    const magicEmissionPass = uniform(0);
    const noiseTexture = kind === "fire" ? fireNoise() : null;
    // Explicit LOD is required inside divergent raymarch loops on WebGPU. This
    // single-level field uses the same trilinear samples as the original shader.
    const noise3 = noiseTexture
      ? (point: Node<"vec3">) => texture3D(noiseTexture, point.add(.5).div(64), 0).r
      : spatialNoise;
    const material = new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
      fog: false,
    });
    material.positionNode = centre.xyz.add(positionGeometry.mul(shape.xyz));
    material.fragmentNode = Fn(() => {
      const ray = normalize(vSurface.sub(vEye)).toVar();
      const inv = float(1).div(ray).toVar();
      const a = float(-1).sub(vEye).mul(inv).toVar();
      const b = float(1).sub(vEye).mul(inv).toVar();
      const lo = min(a, b).toVar(), hi = max(a, b).toVar();
      const enter = max(0, max(lo.x, max(lo.y, lo.z))).toVar();
      const leave = min(hi.x, min(hi.y, hi.z)).toVar();
      If(leave.lessThanEqual(enter), () => { Discard(); });
      const steps = kind === "fire" ? 96 : 18;
      const stride = leave.sub(enter).div(steps).toVar();
      const offset = fract(dot(screenCoordinate.xy, vec2(.06711056, .00583715))).mul(.5).add(.25).toVar();
      const sum = vec4(0).toVar();
      Loop(steps, ({ i }) => {
        if (kind === "fire") {
          const jitter = fract(screenCoordinate.xyx.mul(.1031).add(float(i).mul(.123))).toVar();
          jitter.addAssign(dot(jitter, jitter.yzx.add(33.33)));
          offset.assign(fract(jitter.x.add(jitter.y).mul(jitter.z)));
        }
        const p = vEye.add(ray.mul(enter.add(float(i).add(offset).mul(stride)))).toVar();
        If(vCentre.y.add(p.y.mul(vSize.y)).lessThan(vFloor), () => { Continue(); });
        const density = float(0).toVar();
        const fireHeat = float(1).toVar();
        const color = vec3(0).toVar();
        if (kind === "fire") {
          // Advected 3D combustion. Shape and temperature use different fields.
          const world = vCentre.add(p.mul(vSize)).toVar();
          const fuel = world.mul(1.35).add(vec3(vSeed.mul(.173), this.time.mul(-2.8), vSeed.mul(.271))).toVar();
          If(vPhase.greaterThanEqual(0), () => {
            const radial = world.xz.sub(vCentre.xz).toVar();
            fuel.xz.subAssign(radial.div(max(.1, length(radial))).mul(float(1).sub(exp(vPhase.mul(-5)))).mul(2.4));
          });
          const drift = vec3(noise3(fuel.mul(.38)), noise3(fuel.mul(.38).add(17.3)), noise3(fuel.mul(.38).add(41.7))).sub(.5).toVar();
          fuel.addAssign(drift.mul(2.6));
          const billow = noise3(fuel.mul(.78)).toVar();
          const detail = noise3(fuel.mul(2.13).add(drift.mul(.7))).toVar();
          const tear = noise3(fuel.mul(4.71)).toVar();
          const envelope = float(1).sub(length(p.mul(vec3(.92, 1, .96)))).toVar();
          const cooling = float(0).toVar();
          If(vPhase.greaterThanEqual(0), () => {
            const spread = float(1).sub(exp(vPhase.mul(-10.5))).toVar();
            const radius = spread.mul(8.3).add(.75).toVar();
            const height = spread.mul(3.8).add(1).add(vPhase.mul(.85)).toVar();
            const q = vec3(
              world.x.sub(vCentre.x).sub(drift.x.mul(1.5)).div(radius),
              world.y.sub(vFloor).sub(.12).div(height),
              world.z.sub(vCentre.z).sub(drift.z.mul(1.7)).div(radius.mul(.86)),
            ).toVar();
            q.x.addAssign(q.y.mul(q.y).mul(drift.z.mul(.22).add(.10)));
            q.z.subAssign(q.y.mul(q.y).mul(.18));
            envelope.assign(float(1).sub(length(q)));
            cooling.assign(smoothstep(.45, 2.55, vPhase).mul(.65));
          });
          const edge = envelope.add(billow.sub(.5).mul(.95)).add(detail.sub(.5).mul(.28));
          const turbulence = billow.mul(.55).add(detail.mul(.30)).add(tear.mul(.15)).toVar();
          const border = float(1).sub(smoothstep(.80, 1, max(abs(p.x), max(abs(p.y), abs(p.z)))));
          density.assign(smoothstep(-.16, .26, edge).mul(smoothstep(.25, .55, turbulence)).mul(border));
          If(vPhase.greaterThanEqual(0), () => {
            // Low-frequency gaps keep the explosion from becoming an opaque ball.
            const openings = noise3(fuel.mul(.27).add(vec3(4, 3, 12)));
            density.mulAssign(smoothstep(.34, .65, openings));
          });
          fireHeat.assign(clamp(smoothstep(.45, .74, turbulence.add(max(0, envelope).mul(.035))).sub(cooling), 0, 1));
          const soot = mix(vec3(.013, .005, .008), vec3(.085, .027, .012), billow);
          const flame = mix(vec3(.24, .002, .001), vec3(1.35, .075, .002), fireHeat).toVar();
          flame.assign(mix(flame, vec3(2.4, .55, .025), smoothstep(.70, .96, fireHeat)));
          color.assign(magicEmissionPass.greaterThan(.5).select(
            flame.mul(fireHeat).mul(.60), mix(soot, flame, smoothstep(.16, .68, fireHeat)),
          ));
        } else {
          const flow = p.mul(vec3(3.8, 2.4, 3.8)).add(vec3(vSeed, this.time.mul(-1.8), this.time.mul(.24))).toVar();
          const n = noise3(flow.add(noise3(flow.mul(.65)).mul(1.9))).mul(.7).add(noise3(flow.mul(2.07)).mul(.3)).toVar();
          if (kind === "wind") {
            const u = p.y.mul(.5).add(.5).toVar();
            const angle = atan(p.z, p.x);
            const radius = pow(u, .8).mul(.77).add(.08);
            const coil = sin(angle.mul(3).sub(u.mul(34)).add(this.time.mul(5)).add(n.mul(3.5))).mul(.5).add(.5).toVar();
            const shell = exp(abs(length(p.xz).sub(radius)).mul(-17));
            density.assign(shell.mul(smoothstep(.23, .75, n.mul(.58).add(coil.mul(.42)))).mul(1.25).mul(smoothstep(0, .08, u)));
            color.assign(mix(vec3(.08, .11, .16), vec3(.30, .34, .38), n).mul(coil.mul(.3).add(.7)));
          } else if (kind === "smoke") {
            density.assign(smoothstep(.01, .48, float(1).sub(length(p).mul(1.2)).add(n.mul(.28)).sub(.1)));
            color.assign(mix(vec3(.008, .006, .008), vec3(.075, .044, .038), n.mul(.7).add(max(0, p.y).mul(.15))));
          } else {
            density.assign(smoothstep(.03, .65, float(1).sub(length(p)).add(n.mul(.65)).sub(.3)));
            color.assign(mix(vec3(.19, .17, .14), vec3(.53, .49, .40), n).mul(max(0, p.y).mul(.3).add(.7)));
          }
        }
        const extinction = kind === "fire"
          ? density.mul(stride).mul(length(ray.mul(vSize))).mul(vPhase.greaterThanEqual(0).select(.60, 1.4))
          : density.mul(stride).mul(kind === "smoke" ? 1.25 : 3.8);
        const opacity = float(1).sub(exp(extinction.negate())).mul(vAlpha).toVar();
        if (kind === "fire") {
          If(magicEmissionPass.greaterThan(.5), () => { opacity.mulAssign(smoothstep(.15, .6, fireHeat)); });
        }
        sum.rgb.addAssign(float(1).sub(sum.a).mul(opacity).mul(color));
        sum.a.addAssign(float(1).sub(sum.a).mul(opacity));
        If(sum.a.greaterThan(.98), () => { Break(); });
      });
      If(sum.a.lessThan(.008), () => { Discard(); });
      return vec4(sum.rgb.div(max(sum.a, .001)), sum.a);
    })();
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name=`elemental-atmosphere-${kind}`;
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=kind==="fire"?10:kind==="smoke"?14:9;
    this.mesh.userData["magicGlow"]=kind==="fire";this.mesh.userData["magicGlowOnly"]=false;
    if(kind==="fire")material.userData["magicEmissionPass"]=magicEmissionPass;
    parent.add(this.mesh);
  }
  begin(seconds:number):void{this.count=0;this.dropped=0;this.mesh.visible=false;this.time.value=seconds;}
  put(x:number,y:number,z:number,sx:number,sy:number,sz:number,alpha:number,seed:number,floor=-1000,phase=-1):void{
    if(alpha<.008||Math.min(sx,sy,sz)<.005)return;
    if(this.count>=this.capacity){this.dropped++;return;}
    this.centres.setXYZW(this.count,x,y,z,alpha);this.shapes.setXYZW(this.count,sx,sy,sz,seed);this.floors.setX(this.count,floor);this.phases.setX(this.count++,phase);
  }
  get instances():number{return this.count;}
  end():void{this.mesh.visible=this.count>0;this.mesh.geometry.instanceCount=this.count;for(const a of [this.centres,this.shapes,this.floors,this.phases]){a.clearUpdateRanges();a.addUpdateRange(0,this.count*a.itemSize);a.needsUpdate=true;}}
  dispose():void{this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
