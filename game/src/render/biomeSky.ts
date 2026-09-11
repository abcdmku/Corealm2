import * as THREE from "three";
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
} as const;
const NEUTRAL = { zenith: 0x4f83b8, horizon: 0xd0d9de, cloud: 0xe7e6df, cloudCover: 0, fogNear: 1, fogFar: 1 };

export function blendBiomeSky(weights: BiomeWeights, wildernessMagic = 0) {
  const result = { zenith: new THREE.Color(0), horizon: new THREE.Color(0), cloud: new THREE.Color(0),
    cloudCover: 0, fogNear: 0, fogFar: 0, night: 0, magic: 0 };
  let total = 0;
  for (const id of Object.keys(BIOME_SKIES) as RegionId[]) {
    const weight = weights[id] ?? 0;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const look = BIOME_SKIES[id]; total += weight;
    for (const key of ["zenith", "horizon", "cloud"] as const) result[key].add(new THREE.Color(look[key]).multiplyScalar(weight));
    for (const key of ["cloudCover", "fogNear", "fogFar"] as const) result[key] += look[key] * weight;
  }
  for (const key of ["zenith", "horizon", "cloud"] as const) {
    if (total) result[key].multiplyScalar(1 / total); else result[key].setHex(NEUTRAL[key]);
  }
  for (const key of ["cloudCover", "fogNear", "fogFar"] as const) result[key] = total ? result[key] / total : NEUTRAL[key];
  result.night = total ? Math.max(0, weights.wilderness ?? 0) / total : 0;
  result.magic = result.night * Math.max(0, Math.min(1, wildernessMagic));
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

/** Camera-oriented sky with no finite dome, texture downloads or per-frame PMREM regeneration. */
export class BiomeSky {
  enabled = false;
  private readonly current = blendBiomeSky({});
  private near = 26;
  private far = 210;
  private time = 0;
  private readonly material = new THREE.ShaderMaterial({
    depthWrite: false, depthTest: false, toneMapped: false, fog: false,
    uniforms: { zenith: { value: this.current.zenith }, horizon: { value: this.current.horizon },
      cloud: { value: this.current.cloud }, cloudCover: { value: 0 }, time: { value: 0 },
      night: { value: 0 },
      inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() } },
    vertexShader: `varying vec2 vSkyUv;
      void main() { vSkyUv = position.xy; gl_Position = vec4(position.xy, 1., 1.); }`,
    fragmentShader: `uniform vec3 zenith, horizon, cloud;
      uniform float cloudCover, time, night; uniform mat4 inverseProjection, cameraWorld;
      varying vec2 vSkyUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
      }
      float cloudNoise(vec2 p) {
        float n=0., a=.55;
        for(int i=0;i<4;i++) { n+=a*noise(p); p=p*2.03+17.7; a*=.5; }
        return n;
      }
      void main() {
        vec4 ray=inverseProjection*vec4(vSkyUv,1.,1.);
        vec3 direction=normalize(mat3(cameraWorld)*ray.xyz);
        // Full horizon plateau below the skyline means fog cannot reveal a mismatched sky band.
        float elevation=max(direction.y,0.);
        vec3 colour=mix(horizon,zenith,smoothstep(0.,.65,elevation));
        vec2 p=direction.xz/(.24+elevation)*2.3+vec2(time*.006,time*.002);
        float density=cloudNoise(p);
        float cover=smoothstep(.76-cloudCover*.55,.94-cloudCover*.55,density);
        // A second, finer layer breaks up the broad banks without a texture seam.
        float wisps=smoothstep(.56,.78,cloudNoise(p*2.1+vec2(time*.004,9.)));
        cover=max(cover,wisps*cloudCover*.28);
        cover*=smoothstep(.015,.16,elevation)*.82;
        vec3 litCloud=mix(cloud*.73,cloud,smoothstep(.38,.77,density));
        colour=mix(colour,litCloud,cover);
        vec3 sunDirection=normalize(vec3(-.48,.38,-.78));
        float sun=max(dot(direction,sunDirection),0.);
        float halo=pow(sun,36.)*.13+pow(sun,640.)*.38;
        colour+=cloud*halo*(1.-cover)*smoothstep(.02,.18,elevation)*(1.-night);
        // A fixed moon and sparse directional stars keep their place as the camera turns.
        vec3 moonDirection=normalize(vec3(-.48,.38,-.78));
        float moonDistance=length(direction-moonDirection);
        float moonDisc=1.-smoothstep(.024,.026,moonDistance);
        float moonHalo=exp(-moonDistance*27.)*.045;
        float moonMark=.84+.16*noise(direction.xz*430.);
        vec2 starCell=direction.xz/(.35+elevation)*180.;
        float starSeed=hash(floor(starCell));
        float star=step(.997,starSeed)*(1.-smoothstep(.02,.11,length(fract(starCell)-.5)));
        colour+=night*(1.-cover)*smoothstep(.03,.2,elevation)*
          (vec3(.45,.53,.65)*(moonDisc*moonMark+moonHalo)+vec3(.4,.49,.65)*star);
        gl_FragColor=vec4(colour,1.);
        #include <colorspace_fragment>
      }`,
  });
  private readonly geometry = new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  readonly mesh = new THREE.Mesh(this.geometry, this.material);

  constructor() {
    this.mesh.name = "biome-sky"; this.mesh.frustumCulled = false; this.mesh.renderOrder = -10000;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => {
      this.material.uniforms.inverseProjection!.value.copy(camera.projectionMatrixInverse);
      this.material.uniforms.cameraWorld!.value.copy(camera.matrixWorld);
    };
  }
  setFogRange(near: number, far: number): void { this.near = near; this.far = far; }
  update(scene: THREE.Scene, weights: BiomeWeights, deltaSeconds: number, wildernessMagic = 0): void {
    if (!this.enabled) return;
    if (this.mesh.parent !== scene) scene.add(this.mesh);
    this.mesh.visible = true;
    const target = blendBiomeSky(weights, wildernessMagic), alpha = 1 - Math.exp(-Math.min(Math.max(deltaSeconds, 0), .1) * 3);
    for (const key of ["zenith", "horizon", "cloud"] as const) this.current[key].lerp(target[key], alpha);
    for (const key of ["cloudCover", "fogNear", "fogFar", "night", "magic"] as const) this.current[key] += (target[key] - this.current[key]) * alpha;
    this.time += Math.min(Math.max(deltaSeconds, 0), .1);
    this.material.uniforms.time!.value = this.time;
    this.material.uniforms.cloudCover!.value = this.current.cloudCover;
    this.material.uniforms.night!.value = this.current.night;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(this.current.horizon);
      scene.fog.near = this.near * this.current.fogNear;
      scene.fog.far = this.far * this.current.fogFar;
    }
  }
  get nightAmount(): number { return this.enabled ? this.current.night : 0; }
  get magicAmount(): number { return this.enabled ? this.current.magic : 0; }
  snapshot() { return { enabled: this.enabled, zenith: this.current.zenith.getHex(), horizon: this.current.horizon.getHex(),
    night: this.nightAmount, magic: this.magicAmount,
    cloudCover: this.current.cloudCover, fogNear: this.near * this.current.fogNear, fogFar: this.far * this.current.fogFar }; }
  dispose(): void { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
