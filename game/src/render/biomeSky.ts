import * as THREE from "three/webgpu";
import {
  Fn, If, float, mat3, mix, positionGeometry, smoothstep, uniform, varying, vec2, vec3, vec4,
} from "three/tsl";
import type { BiomeWeights } from "./biomeAtmosphere.js";
import type { RegionId } from "../contracts.js";

export const BIOME_MOOD_STRENGTH = .75;

// Horizon is also the fog's exact terminal colour. Distances scale the user's draw-distance preset.
export const BIOME_SKIES = {
  fallowmarch: { zenith: 0x3979b6, horizon: 0xe2d9ae, cloud: 0xffefd0, cloudCover: .42, fogNear: 1, fogFar: 1 },
  vellenwood: { zenith: 0x294958, horizon: 0x91ad9c, cloud: 0xb2c3ad, cloudCover: .72, fogNear: .6, fogFar: .65 },
  karrowmoor: { zenith: 0x344b7c, horizon: 0xb3c2d7, cloud: 0xc1cbd7, cloudCover: .82, fogNear: .75, fogFar: .78 },
  kilnhalt: { zenith: 0x623e50, horizon: 0xd6a27b, cloud: 0x998078, cloudCover: .76, fogNear: .45, fogFar: .55 },
  gravelmaw: { zenith: 0x201b38, horizon: 0x626078, cloud: 0x657182, cloudCover: .94, fogNear: .3, fogFar: .4 },
  wilderness: { zenith: 0x080f20, horizon: 0x303b50, cloud: 0x3c4659, cloudCover: .58, fogNear: .72, fogFar: .78 },
  crownward: { zenith: 0x477eaf, horizon: 0xe0e4d1, cloud: 0xf5f1df, cloudCover: .34, fogNear: 1, fogFar: 1 },
  gloamgarden: { zenith: 0x102b3f, horizon: 0x4c7b88, cloud: 0x58aaa7, cloudCover: .72, fogNear: .72, fogFar: .85 },
  faeholme: { zenith: 0x25143f, horizon: 0x76668f, cloud: 0x967abf, cloudCover: .83, fogNear: .68, fogFar: .8 },
} as const;
const NEUTRAL = { zenith: 0x4f83b8, horizon: 0xd0d9de, cloud: 0xe7e6df, cloudCover: 0, fogNear: 1, fogFar: 1 };

export function blendBiomeSky(weights: BiomeWeights, wildernessMagic = 0) {
  const result = { zenith: new THREE.Color(0), horizon: new THREE.Color(0), cloud: new THREE.Color(0),
    cloudCover: 0, fogNear: 0, fogFar: 0, night: 0, magic: 0, underground: 0, fairyDepth: 0 };
  let total = 0;
  let wilderness = 0, fairy = 0, deepFairy = 0;
  for (const id of Object.keys(BIOME_SKIES) as RegionId[]) {
    const weight = weights[id] ?? 0;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const look = BIOME_SKIES[id]; total += weight;
    if (id === "wilderness") wilderness += weight;
    if (id === "gloamgarden" || id === "faeholme") fairy += weight;
    if (id === "faeholme") deepFairy += weight;
    for (const key of ["zenith", "horizon", "cloud"] as const) result[key].add(new THREE.Color(look[key]).multiplyScalar(weight));
    for (const key of ["cloudCover", "fogNear", "fogFar"] as const) result[key] += look[key] * weight;
  }
  for (const key of ["zenith", "horizon", "cloud"] as const) {
    if (total) result[key].multiplyScalar(1 / total); else result[key].setHex(NEUTRAL[key]);
  }
  for (const key of ["cloudCover", "fogNear", "fogFar"] as const) result[key] = total ? result[key] / total : NEUTRAL[key];
  result.underground = total ? fairy / total : 0;
  result.fairyDepth = fairy ? deepFairy / fairy : 0;
  result.night = total ? (wilderness + fairy) / total : 0;
  result.magic = total ? wilderness / total * Math.max(0, Math.min(1, wildernessMagic)) : 0;
  result.zenith.lerp(new THREE.Color(0x100821), result.magic);
  result.horizon.lerp(new THREE.Color(0x302744), result.magic);
  result.cloud.lerp(new THREE.Color(0x51416d), result.magic);
  result.cloudCover += .13 * result.magic;
  for (const key of ["zenith", "horizon", "cloud"] as const) {
    result[key].lerp(new THREE.Color(NEUTRAL[key]), (1 - BIOME_MOOD_STRENGTH) * (1 - result.night));
  }
  result.cloudCover *= BIOME_MOOD_STRENGTH;
  result.fogNear = 1 + (result.fogNear - 1) * BIOME_MOOD_STRENGTH;
  result.fogFar = 1 + (result.fogFar - 1) * BIOME_MOOD_STRENGTH;
  return result;
}

// These shared node functions generate the same four-octave field on both GPU backends.
const skyHash = Fn(([p]: [THREE.Node<"vec2">]) =>
  p.dot(vec2(127.1, 311.7)).sin().mul(43758.5453).fract(),
).setLayout({ name: "biomeSkyHash", type: "float", inputs: [{ name: "p", type: "vec2" }] });
const skyNoise = Fn(([p]: [THREE.Node<"vec2">]) => {
  const i = p.floor();
  const f = p.fract().toVar();
  f.assign(f.mul(f).mul(float(3).sub(f.mul(2))));
  return mix(mix(skyHash(i), skyHash(i.add(vec2(1, 0))), f.x),
    mix(skyHash(i.add(vec2(0, 1))), skyHash(i.add(1)), f.x), f.y);
}).setLayout({ name: "biomeSkyNoise", type: "float", inputs: [{ name: "p", type: "vec2" }] });
const cloudNoise = Fn(([point]: [THREE.Node<"vec2">]) => {
  const p = point.toVar(), n = float(0).toVar();
  let amplitude = .55;
  for (let i = 0; i < 4; i++) {
    n.addAssign(skyNoise(p).mul(amplitude));
    p.assign(p.mul(2.03).add(17.7));
    amplitude *= .5;
  }
  return n;
}).setLayout({ name: "biomeCloudNoise", type: "float", inputs: [{ name: "point", type: "vec2" }] });

// The completed HDR frame is tone mapped once. Undo that transform for the sky,
// which previously bypassed tone mapping, so its authored palette stays unchanged.
export const inverseACES = Fn(([colour, exposure]: [THREE.Node<"vec3">, THREE.Node<"float">]) => {
  const inverseOutput = mat3(new THREE.Matrix3().set(
    1.60475, -.53108, -.07367, -.10208, 1.10813, -.00605, -.00327, -.07276, 1.07602,
  ).invert());
  const inverseInput = mat3(new THREE.Matrix3().set(
    .59719, .35458, .04823, .07600, .90834, .01566, .02840, .13383, .83777,
  ).invert());
  const target = inverseOutput.mul(colour.clamp(0, 1)).clamp(0, 1).toVar();
  const a = float(1).sub(target.mul(.983729));
  const b = target.mul(.4329510 * .983729).sub(.0245786);
  const c = target.mul(.238081).add(.000090537);
  const input = b.add(b.mul(b).add(a.mul(c).mul(4)).sqrt()).div(a.mul(2));
  return inverseInput.mul(input).mul(.6).div(exposure.max(.00001));
}).setLayout({ name: "biomeInverseSkyACES", type: "vec3", inputs: [
  { name: "colour", type: "vec3" }, { name: "exposure", type: "float" },
] });

/** Camera-oriented sky with no finite dome, texture downloads or per-frame PMREM regeneration. */
export class BiomeSky {
  enabled = false;
  private readonly current = blendBiomeSky({});
  private near = 26;
  private far = 210;
  private time = 0;
  private readonly uniforms = {
    zenith: uniform(this.current.zenith), horizon: uniform(this.current.horizon),
    cloud: uniform(this.current.cloud), cloudCover: uniform(0), time: uniform(0),
    night: uniform(0), underground: uniform(0), fairyDepth: uniform(0), exposure: uniform(1),
    inverseProjection: uniform(new THREE.Matrix4()), cameraWorld: uniform(new THREE.Matrix4()),
  };
  private readonly material = this.createMaterial();

  private createMaterial(): THREE.NodeMaterial {
    const material = new THREE.NodeMaterial({ depthWrite: false, depthTest: false, toneMapped: false, fog: false });
    const skyUv = varying(positionGeometry.xy, "vSkyUv");
    material.vertexNode = vec4(positionGeometry.xy, 1, 1);
    material.fragmentNode = Fn(() => {
      const { zenith, horizon, cloud, cloudCover, time, night, underground, fairyDepth, inverseProjection, cameraWorld } = this.uniforms;
      const ray = inverseProjection.mul(vec4(skyUv, 1, 1));
      const direction = cameraWorld.mul(vec4(ray.xyz, 0)).xyz.normalize().toVar();
      // Full horizon plateau below the skyline matches the terminal fog colour.
      const elevation = direction.y.max(0).toVar();
      const colour = mix(horizon, zenith, smoothstep(0, .65, elevation)).toVar();
      const p = direction.xz.div(elevation.add(.24)).mul(2.3).add(vec2(time.mul(.006), time.mul(.002))).toVar();
      const density = cloudNoise(p).toVar();
      const cover = smoothstep(float(.76).sub(cloudCover.mul(.55)), float(.94).sub(cloudCover.mul(.55)), density).toVar();
      // The second finer cloud layer breaks broad banks without a texture seam.
      const wisps = smoothstep(.56, .78, cloudNoise(p.mul(2.1).add(vec2(time.mul(.004), 9))));
      cover.assign(cover.max(wisps.mul(cloudCover).mul(.28)));
      cover.mulAssign(smoothstep(.015, .16, elevation).mul(.82));
      const litCloud = mix(cloud.mul(.73), cloud, smoothstep(.38, .77, density));
      colour.assign(mix(colour, litCloud, cover));
      // The fairy map's mineral vault stays directional as the follow camera turns.
      If(underground.greaterThan(.001), () => {
        const vaultPoint = direction.xz.div(elevation.add(.38)).mul(2.8).toVar();
        const folds = cloudNoise(vaultPoint.add(vec2(time.mul(.0015), 0))).toVar();
        const strata = cloudNoise(vaultPoint.mul(1.7).add(vec2(folds.mul(3.5), folds.mul(1.8))));
        const ridge = float(1).sub(strata.mul(2).sub(1).abs());
        const ceiling = smoothstep(.24, .78, folds).mul(.68);
        const vault = mix(zenith.mul(.58), cloud.mul(.62), ceiling).toVar();
        const seam = ridge.max(0).pow(16).mul(smoothstep(.36, .65, folds));
        const mineral = mix(vec3(.10, .56, .47), vec3(.40, .20, .65), fairyDepth);
        vault.addAssign(mineral.mul(seam).mul(.22));
        // Loose luminous grains are distant spores, with no celestial moon or stars.
        const grainPoint = vaultPoint.mul(68).toVar();
        const grainSeed = skyHash(grainPoint.floor()).toVar();
        const grain = grainSeed.step(.993).mul(float(1).sub(smoothstep(.015, .085, grainPoint.fract().sub(.5).length())));
        vault.addAssign(mineral.mul(grain).mul(time.mul(.7).add(grainSeed.mul(20)).sin().mul(.15).add(.3)));
        colour.assign(mix(colour, vault, underground.mul(smoothstep(.015, .25, elevation))));
      });
      const sunDirection = vec3(-.48, .38, -.78).normalize();
      const sun = direction.dot(sunDirection).max(0).toVar();
      const halo = sun.pow(36).mul(.13).add(sun.pow(640).mul(.38));
      colour.addAssign(cloud.mul(halo).mul(float(1).sub(cover)).mul(smoothstep(.02, .18, elevation)).mul(float(1).sub(night)));
      // Fixed moon, surface markings and sparse directional stars retain their positions.
      const moonDistance = direction.sub(sunDirection).length().toVar();
      const moonDisc = float(1).sub(smoothstep(.024, .026, moonDistance));
      const moonHalo = moonDistance.mul(-27).exp().mul(.045);
      const moonMark = skyNoise(direction.xz.mul(430)).mul(.16).add(.84);
      const starCell = direction.xz.div(elevation.add(.35)).mul(180).toVar();
      const starSeed = skyHash(starCell.floor());
      const star = starSeed.step(.997).mul(float(1).sub(smoothstep(.02, .11, starCell.fract().sub(.5).length())));
      colour.addAssign(night.mul(float(1).sub(underground)).mul(float(1).sub(cover)).mul(smoothstep(.03, .2, elevation))
        .mul(vec3(.45, .53, .65).mul(moonDisc.mul(moonMark).add(moonHalo)).add(vec3(.4, .49, .65).mul(star))));
      return vec4(inverseACES(colour, this.uniforms.exposure), 1);
    })();
    return material;
  }
  private readonly geometry = new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  readonly mesh = new THREE.Mesh(this.geometry, this.material);

  constructor() {
    this.mesh.name = "biome-sky"; this.mesh.frustumCulled = false; this.mesh.renderOrder = -10000;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.uniforms.exposure.value = _renderer.toneMappingExposure;
      this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      this.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    };
  }
  setFogRange(near: number, far: number): void { this.near = near; this.far = far; }
  update(scene: THREE.Scene, weights: BiomeWeights, deltaSeconds: number, wildernessMagic = 0): void {
    if (!this.enabled) return;
    if (this.mesh.parent !== scene) scene.add(this.mesh);
    this.mesh.visible = true;
    const target = blendBiomeSky(weights, wildernessMagic), alpha = 1 - Math.exp(-Math.min(Math.max(deltaSeconds, 0), .1) * 3);
    for (const key of ["zenith", "horizon", "cloud"] as const) this.current[key].lerp(target[key], alpha);
    for (const key of ["cloudCover", "fogNear", "fogFar", "night", "magic", "underground", "fairyDepth"] as const) this.current[key] += (target[key] - this.current[key]) * alpha;
    this.time += Math.min(Math.max(deltaSeconds, 0), .1);
    this.uniforms.time.value = this.time;
    this.uniforms.cloudCover.value = this.current.cloudCover;
    this.uniforms.night.value = this.current.night;
    this.uniforms.underground.value = this.current.underground;
    this.uniforms.fairyDepth.value = this.current.fairyDepth;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(this.current.horizon);
      scene.fog.near = this.near * this.current.fogNear;
      scene.fog.far = this.far * this.current.fogFar;
    }
  }
  get nightAmount(): number { return this.enabled ? this.current.night : 0; }
  get magicAmount(): number { return this.enabled ? this.current.magic : 0; }
  get undergroundAmount(): number { return this.enabled ? this.current.underground : 0; }
  /** T60's share within the fairy blend. Apply together with undergroundAmount. */
  get fairyDepthAmount(): number { return this.enabled ? this.current.fairyDepth : 0; }
  snapshot() { return { enabled: this.enabled, zenith: this.current.zenith.getHex(), horizon: this.current.horizon.getHex(),
    night: this.nightAmount, magic: this.magicAmount, underground: this.undergroundAmount, fairyDepth: this.fairyDepthAmount,
    cloudCover: this.current.cloudCover, fogNear: this.near * this.current.fogNear, fogFar: this.far * this.current.fogFar }; }
  dispose(): void { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
