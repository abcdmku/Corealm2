import * as THREE from "three";
import type { MeshBasicNodeMaterial, Node } from "three/webgpu";
import { Fn, abs, attribute, clamp, cos, float, fract, max, min, pow, reference, sin, smoothstep, vec3, vec4 } from "three/tsl";
import { FINALE } from "../content/elementalFinales.js";
import { delugeSplashPoint } from "./delugeSurface.js";
import { acquireParticleMaterial, particleGeometry } from "./particleMaterial.js";
import { releaseEffectMaterial } from "./sharedEffectMaterial.js";

const FOAM_COUNT = 12000, SPRAY_COUNT = 18000;
const CRASH = FINALE.deluge.contact + FINALE.deluge.rowGap * 2;
const ease = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
const rand = (i: number, s = 0) => { const n = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return n - Math.floor(n); };
interface StaticParticles {
  foam: Float32Array; launch: Float32Array; motion: Float32Array;
  foamTint: Float32Array; sprayTint: Float32Array;
  foamShape: Float32Array; sprayShape: Float32Array;
  births: Float64Array; deaths: Float64Array; phases: Float64Array;
}
let prepared: StaticParticles | undefined;
function staticParticles(): StaticParticles {
  if (prepared) return prepared;
  const foam = new Float32Array(FOAM_COUNT * 4), launch = new Float32Array(SPRAY_COUNT * 4), motion = new Float32Array(SPRAY_COUNT * 4);
  const foamTint = new Float32Array(FOAM_COUNT * 3), sprayTint = new Float32Array(SPRAY_COUNT * 3);
  const foamShape = new Float32Array(FOAM_COUNT * 4), sprayShape = new Float32Array(SPRAY_COUNT * 4);
  const births = new Float64Array(SPRAY_COUNT), deaths = new Float64Array(SPRAY_COUNT), phases = new Float64Array(FOAM_COUNT);
  const foamColors = [new THREE.Color(0x8fbec5), new THREE.Color(0xe1edeb)];
  const sprayColors = [new THREE.Color(0x8cb9c1), new THREE.Color(0xd6e8e8)];
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const n = i * 4, burst = i < 6000, birth = .018 + Math.pow(rand(i, 30), 1.7) * (burst ? .115 : .26);
    const lobe = Math.floor(rand(i, 31) * 8), v = rand(i, 32);
    const position = delugeSplashPoint(lobe, rand(i, 36), burst ? .18 + v * .45 : .52 + v * .46, CRASH + birth * 1000);
    const angle = Math.atan2(position[2], position[0]) - (burst ? .25 : .7) + (rand(i, 37) - .5) * .85;
    const speed = burst ? 6 + rand(i, 33) * 9 : 1.2 + rand(i, 33) * 5.8;
    // Preserve the original Float32 launch cache and JS random distribution exactly.
    launch.set([birth, ...position], n);
    motion.set([Math.cos(angle) * speed, burst ? 2 + rand(i, 34) * 5 : 3.5 + rand(i, 34) * 8.5, Math.sin(angle) * speed,
      i % 43 === 0 ? .060 + v * .032 : .018 + rand(i, 35) * .028], n);
    sprayColors[i % 7 ? 0 : 1]!.toArray(sprayTint, i * 3);
    sprayShape.set([i * .71, .55 + Math.abs(Math.sin(i * 3)) * .6, 1.25, i], n);
    const vy = motion[n + 1]!, height = launch[n + 2]!;
    births[i] = launch[n]!;
    deaths[i] = launch[n]! + (vy + Math.sqrt(vy * vy + 24 * height)) / 12;
  }
  for (let i = 0; i < FOAM_COUNT; i++) {
    foam.set([rand(i, 10) * Math.PI * 2, .26 + rand(i, 11) * .65, rand(i, 16), .017 + rand(i, 12) * .025], i * 4);
    foamColors[i % 5 ? 0 : 1]!.toArray(foamTint, i * 3);
    foamShape.set([i * .71, .55 + Math.abs(Math.sin(i * 3)) * .6, 1.25, i], i * 4);
    phases[i] = foam[i * 4 + 2]!;
  }
  births.sort(); deaths.sort(); phases.sort();
  return prepared = { foam, launch, motion, foamTint, sprayTint, foamShape, sprayShape, births, deaths, phases };
}

/** First item >= value, or > value when inclusive is true. */
function bound(values: Float64Array, value: number, inclusive = false): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < value || (inclusive && values[middle] === value)) low = middle + 1;
    else high = middle;
  }
  return low;
}
function foamCount(phases: Float64Array, time: number, alpha: number): number {
  const threshold = (.006 / alpha - .6) / .3;
  if (threshold <= 0) return FOAM_COUNT;
  if (threshold >= 1) return 0;
  const shift = time * .85 % 1, start = ((threshold - shift) % 1 + 1) % 1, end = 1 - shift;
  if (start < end) return bound(phases, end) - bound(phases, start);
  return FOAM_COUNT - bound(phases, start) + bound(phases, end);
}

const stateFloat = (name: string) => reference(`userData.delugeParticles.${name}`, "float", null);
const stateOrigin = () => reference("userData.delugeParticles.origin", "vec3", null);
const surfPoint = Fn(([seed, age]: [Node<"vec4">, Node<"float">]): Node<"vec3"> => {
  const angle = seed.x, u = seed.y, t = age.div(1000);
  const swell = sin(angle.mul(2).add(.8)).mul(.39).add(sin(angle.mul(3).sub(1.7)).mul(.24)).add(sin(angle.mul(7).add(.3)).mul(.08));
  const localAge = age.add(swell.mul(170));
  const rise = smoothstep(0, 1, localAge.sub(250).div(1300));
  const pull = pow(clamp(localAge.sub(1650).div(CRASH - 1650), 0, 1), 1.35);
  const radius = float(10.2).mul(float(1).sub(pull)).add(pull.mul(.65)).add(swell.mul(.9).mul(float(1).sub(pull)));
  const curl = u.mul(sin(angle.mul(3).sub(t.mul(1.1))).mul(.23).add(Math.PI * 1.43)).sub(Math.PI / 2);
  const breaking = float(1).sub(smoothstep(0, 1, age.sub(CRASH).div(220)));
  const compression = pow(pull, 4).mul(float(1).sub(smoothstep(0, 1, age.sub(CRASH).div(130))));
  const height = swell.mul(1.9).add(4.1).mul(rise).mul(float(1).sub(pull.mul(.14)).add(compression.mul(.40))).mul(breaking);
  const lip = sin(curl).add(1).mul(.5);
  const turned = angle.sub(pull.mul(pull).mul(1.35).add(u.mul(pull).mul(.48)));
  const radiusAt = radius.sub(cos(curl).mul(pull.mul(.75).add(1.65))).add(sin(turned.mul(5).sub(t.mul(2.3))).mul(u).mul(.14));
  return vec3(cos(turned).mul(radiusAt), lip.mul(height).add(.035), sin(turned).mul(radiusAt));
});
function foamMaterial() {
  return acquireParticleMaterial("droplet", "deluge-foam", () => {
    const seed = attribute("delugeFoam", "vec4" as const), shape = attribute("delugeShape", "vec4" as const);
    const time = stateFloat("age").div(1000), pull = stateFloat("pull"), baseAlpha = stateFloat("foamAlpha");
    const point = surfPoint(seed, stateFloat("age")), spill = fract(seed.z.add(time.mul(.85)));
    const drift = spill.mul(pull).mul(.8), fall = spill.mul(spill).mul(pull).mul(1.2);
    const position = stateOrigin().add(vec3(point.x.mul(float(1).sub(drift.mul(.07))), max(.04, point.y.sub(fall)), point.z.mul(float(1).sub(drift.mul(.07)))));
    return { centre: vec4(position, seed.w), tint: vec4(attribute("delugeTint", "vec3" as const), baseAlpha.mul(spill.mul(.3).add(.6))), shape };
  });
}
function sprayMaterial() {
  return acquireParticleMaterial("droplet", "deluge-spray", () => {
    const launch = attribute("delugeLaunch", "vec4" as const), motion = attribute("delugeMotion", "vec4" as const), shape = attribute("delugeShape", "vec4" as const);
    const flight = stateFloat("impactAge").sub(launch.x);
    const height = launch.z.add(motion.y.mul(flight)).sub(flight.mul(flight).mul(6));
    const position = stateOrigin().add(vec3(launch.y.add(motion.x.mul(flight)).add(flight.mul(flight).mul(.45)), height,
      launch.w.add(motion.z.mul(flight)).sub(flight.mul(.3))));
    const alpha = flight.greaterThanEqual(0).and(height.greaterThanEqual(0)).select(stateFloat("sprayAlpha"), 0);
    const stretch = min(1.6, abs(motion.y.sub(flight.mul(12))).mul(.10)).add(1.25);
    return { centre: vec4(position, motion.w), tint: vec4(attribute("delugeTint", "vec3" as const), alpha), shape: vec4(shape.xy, stretch, shape.w) };
  });
}

type ParticleMesh = THREE.Mesh<THREE.InstancedBufferGeometry, MeshBasicNodeMaterial>;
/** Absolute-time GPU recipes. Per-frame CPU work is uniform updates and binary searches. */
export class DelugeParticles {
  readonly foam: ParticleMesh;
  readonly spray: ParticleMesh;
  readonly capacity = FOAM_COUNT + SPRAY_COUNT;
  readonly dropped = 0;
  private readonly data = staticParticles();
  private readonly clock = { value: 0 };
  private readonly state = { origin: new THREE.Vector3(), age: 0, impactAge: 0, pull: 0, foamAlpha: 0, sprayAlpha: 0 };
  private liveFoam = 0;
  private liveSpray = 0;
  constructor(parent: THREE.Object3D) {
    this.foam = this.mesh(parent, "elemental-3d-deluge-foam", foamMaterial(), {
      delugeFoam: [this.data.foam, 4], delugeTint: [this.data.foamTint, 3], delugeShape: [this.data.foamShape, 4],
    });
    this.spray = this.mesh(parent, "elemental-3d-deluge-droplets", sprayMaterial(), {
      delugeLaunch: [this.data.launch, 4], delugeMotion: [this.data.motion, 4], delugeTint: [this.data.sprayTint, 3], delugeShape: [this.data.sprayShape, 4],
    });
  }
  private mesh(parent: THREE.Object3D, name: string, material: MeshBasicNodeMaterial, attributes: Record<string, readonly [Float32Array, number]>): ParticleMesh {
    const geometry = particleGeometry("droplet");
    for (const [key, [data, size]] of Object.entries(attributes)) geometry.setAttribute(key, new THREE.InstancedBufferAttribute(data.slice(), size));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 11;
    mesh.userData["effectClock"] = this.clock; mesh.userData["delugeParticles"] = this.state;
    mesh.userData["magicGlow"] = false; mesh.userData["magicGlowOnly"] = false;
    parent.add(mesh); return mesh;
  }
  begin(seconds: number): void {
    this.clock.value = seconds;
    this.liveFoam = this.liveSpray = 0;
    this.foam.visible = this.spray.visible = false;
    this.foam.geometry.instanceCount = this.spray.geometry.instanceCount = 0;
  }
  update(x: number, y: number, z: number, age: number): void {
    if (age < 0 || age >= FINALE.deluge.end) return;
    const a = (age - CRASH) / 1000, rise = ease((age - 300) / 1250), vanish = 1 - ease(a / .24);
    this.state.origin.set(x, y, z); this.state.age = age; this.state.impactAge = a;
    this.state.pull = ease((age - 1600) / (CRASH - 1600));
    this.state.foamAlpha = rise * vanish;
    this.state.sprayAlpha = (1 - ease((a - 2.3) / 1.1)) * .94;
    this.liveFoam = rise > .01 && vanish > .01 ? foamCount(this.data.phases, age / 1000, this.state.foamAlpha) : 0;
    this.liveSpray = a >= 0 && this.state.sprayAlpha >= .006 ? bound(this.data.births, a, true) - bound(this.data.deaths, a) : 0;
    this.foam.visible = this.liveFoam > 0; this.spray.visible = this.liveSpray > 0;
    this.foam.geometry.instanceCount = this.liveFoam > 0 ? FOAM_COUNT : 0;
    this.spray.geometry.instanceCount = this.liveSpray > 0 ? SPRAY_COUNT : 0;
  }
  get instances(): number { return this.liveFoam + this.liveSpray; }
  get candidateCount(): number { return this.foam.geometry.instanceCount + this.spray.geometry.instanceCount; }
  end(): void { /* Static attributes remain resident; the renderer reads the per-draw state. */ }
  dispose(): void {
    for (const mesh of [this.foam, this.spray]) { mesh.removeFromParent(); mesh.geometry.dispose(); releaseEffectMaterial(mesh.material); }
  }
}
