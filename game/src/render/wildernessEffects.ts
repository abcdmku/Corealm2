import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Ambience } from './vfx.js';
import { buildLavaSurfaceField } from '../world/lavaSurface.js';
import { buildLavaTextureField } from '../world/lavaTextureFlow.js';
import { rockMassDistance, type LavaRockMass } from '../world/lavaLandforms.js';
import { LavaBankLighting } from './lavaBankLighting.js';
import { applyCorealmSurfaceMaterials, type CorealmSurfaceTextures } from './corealmSurfaceMaterials.js';
import { isMoltenLavaAt, lavaBankWidthAt, lavaClearanceAt, lavaMagicAt, lavaSections, lavaSurfaceClearanceAt,
  type LavaChannel, type LavaSection } from '../content/wildernessLava.js';

export interface WildernessTorch {
  readonly id: string;
  /** Flame origin in world metres, already transformed from the torch asset's local origin. */
  readonly position: readonly [number, number, number];
  readonly scale?: number;
  /** Existing production torch models use none. New ruin braziers can request an iron support. */
  readonly support?: 'none' | 'brazier' | 'sconce';
  /** 0 is ordinary flame, 1 is a violet ward. Does not allocate another point light. */
  readonly magic?: number;
  /** Authored structure palette. Takes precedence over the continuous magic fallback. */
  readonly theme?: 'ember' | 'azure' | 'violet';
}

interface TorchPalette {
  readonly light: number;
  readonly flame: readonly [number, number, number];
  readonly spark: readonly [number, number, number];
}

const TORCH_PALETTES: Record<NonNullable<WildernessTorch['theme']>, TorchPalette> = {
  ember: { light: 0xffa257, flame: [1, .52, .14], spark: [1, .42, .09] },
  azure: { light: 0x447cff, flame: [.07, .34, 1], spark: [.09, .42, 1] },
  violet: { light: 0x9865ff, flame: [.38, .17, 1], spark: [.32, .20, 1] },
};

export function wildernessTorchPalette(torch: Pick<WildernessTorch, 'theme' | 'magic'>): TorchPalette {
  if (torch.theme) return TORCH_PALETTES[torch.theme];
  const magic = Math.max(0, Math.min(1, torch.magic ?? 0));
  return {
    light: new THREE.Color(TORCH_PALETTES.ember.light).lerp(new THREE.Color(TORCH_PALETTES.violet.light), magic).getHex(),
    flame: [1 - .62 * magic, .52 - .35 * magic, .14 + .86 * magic],
    spark: [1 - .68 * magic, .42 - .22 * magic, .09 + .91 * magic],
  };
}

export interface WildernessEffectsOptions {
  readonly groundHeightAt: (x: number, z: number) => number;
  readonly torches: readonly WildernessTorch[];
  readonly channels: readonly LavaChannel[];
  readonly maxLights?: number;
  readonly surfaceTextures?: CorealmSurfaceTextures;
}

/** Measured bowl centre of the shipped Torch_Metal GLB, rotated with its assembly part. */
export function torchFlameOrigin(position: readonly [number, number, number], scale = 1, rotationY = 0): readonly [number, number, number] {
  const bowlZ = .277 * scale;
  return [position[0] + Math.sin(rotationY) * bowlZ, position[1] + .35 * scale,
    position[2] + Math.cos(rotationY) * bowlZ];
}

export function wildernessEffectsLabTorches(groundHeightAt: (x: number, z: number) => number): WildernessTorch[] {
  return [[-12, 2], [0, 1], [13, 2], [24, -18], [-28, -18], [30, 8], [-32, 8], [5, 16]].map(([x, z], index) => ({
    id: `lab-ruin-brazier-${index}`, position: [x!, groundHeightAt(x!, z!) + 1.5, z!] as const,
    scale: 1.2, support: 'brazier',
  }));
}

export function deepWildernessEffectsLabTorches(groundHeightAt: (x: number, z: number) => number): WildernessTorch[] {
  return [...wildernessEffectsLabTorches(groundHeightAt),
    { id: 'lab-nightglass-ward', position: [24, groundHeightAt(24, -20) + 1.5, -20],
      scale: 1.2, support: 'brazier', magic: 1 }];
}

interface LightSource {
  id: string;
  kind: 'torch' | 'lava';
  position: THREE.Vector3;
  colour: number;
  intensity: number;
  reach: number;
  phase: number;
}

export interface WildernessEffectsState {
  ready: boolean;
  enabled: boolean;
  lightingEnabled: boolean;
  seconds: number;
  torches: number;
  channels: number;
  pools: number;
  paletteRange: readonly [number, number];
  moltenTriangles: number;
  dryApronTriangles: number;
  crustPlates: number;
  bankRocks: number;
  rockMasses: number;
  texturedStoneMeshes: number;
  liveParticles: number;
  particleEmitters: number;
  lightBudget: number;
  bankLighting: { budget: number; active: number; strips: number };
  lights: { id: string | null; kind: 'torch' | 'lava' | null; intensity: number; colour: number; position: number[] }[];
  bounds: { min: number[]; max: number[] } | null;
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Warm flame, bank light and slow molten flow share the production render clock. */
export class WildernessEffects {
  readonly group = new THREE.Group();
  private readonly ambience: Ambience;
  private readonly lights: THREE.PointLight[] = [];
  private readonly sources: LightSource[] = [];
  private readonly assigned: (LightSource | undefined)[] = [];
  private readonly ownedGeometry = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterial = new Set<THREE.Material>();
  private readonly flowClock = { value: 0 };
  private readonly bankLighting: LavaBankLighting;
  private readonly surfaceAt: (x: number, z: number) => number;
  private readonly textureAt: (x: number, z: number) => readonly [number, number];
  private readonly viewer = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private seconds = 0;
  private enabled = true;
  private lightingEnabled = true;
  private bankLightingEnabled = true;
  private disposed = false;
  private moltenTriangles = 0;
  private dryApronTriangles = 0;
  private crustPlates = 0;
  private bankRocks = 0;
  private readonly paletteRange: [number, number] = [1, 0];
  private bounds: THREE.Box3 | null = null;

  constructor(parent: THREE.Object3D, private readonly options: WildernessEffectsOptions) {
    this.group.name = 'wilderness-effects';
    parent.add(this.group);
    this.ambience = new Ambience(this.group, { maxParticles: 512 });
    for (let i = 0; i < Math.max(0, Math.min(6, options.maxLights ?? 6)); i++) {
      const light = new THREE.PointLight(0xff9a4a, 0, 16, 2);
      light.name = `wilderness-light-${i}`;
      light.castShadow = false;
      this.group.add(light);
      this.lights.push(light);
    }
    this.surfaceAt = buildLavaSurfaceField(options.channels, options.groundHeightAt);
    this.textureAt = buildLavaTextureField(options.channels, options.groundHeightAt);
    this.bankLighting = new LavaBankLighting(this.group, options.channels, options.groundHeightAt);
    this.buildTorches();
    for (const channel of options.channels) this.buildChannel(channel);
    for (const channel of options.channels) for (const mass of channel.rockMasses ?? []) this.buildRockMass(mass);
    if (options.surfaceTextures) {
      applyCorealmSurfaceMaterials(this.group, options.surfaceTextures);
      this.group.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.name.startsWith('wilderness-')) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.ownedMaterial.add(material);
        }
      });
    }
    const visibleGeometry = new THREE.Box3();
    this.group.updateMatrixWorld(true);
    for (const child of this.group.children) {
      if (child.name.startsWith('wilderness-') && (child as THREE.Mesh).isMesh) {
        visibleGeometry.union(new THREE.Box3().setFromObject(child));
      }
    }
    if (!visibleGeometry.isEmpty()) this.bounds = visibleGeometry;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (!enabled) { for (const light of this.lights) light.intensity = 0; this.bankLighting.disable(); }
  }

  /** Diagnostic comparison keeps flames, ironwork and lava visible while removing their point light. */
  setLightingEnabled(enabled: boolean): void {
    this.lightingEnabled = enabled;
    if (!enabled) { for (const light of this.lights) light.intensity = 0; this.bankLighting.disable(); }
  }

  /** Compare receiving-bank illumination without changing the molten material or torches. */
  setBankLightingEnabled(enabled: boolean): void {
    this.bankLightingEnabled = enabled;
    if (!enabled) this.bankLighting.disable();
  }

  update(seconds: number, camera: THREE.Camera): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    this.seconds = seconds;
    this.flowClock.value = seconds;
    this.bankLighting.update(camera, this.enabled && this.lightingEnabled && this.bankLightingEnabled, seconds);
    if (!this.enabled) return;
    camera.getWorldPosition(this.viewer);
    camera.getWorldQuaternion(this.facing);
    this.ambience.update(seconds * 1000, this.viewer, this.facing);
    const nearest = this.sources.map(source => ({ source, distance: source.position.distanceToSquared(this.viewer) }))
      .filter(row => row.distance < 65 * 65)
      .sort((a, b) => a.distance - b.distance || a.source.id.localeCompare(b.source.id))
      .slice(0, this.lights.length);
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i]!;
      const row = nearest[i];
      this.assigned[i] = row?.source;
      if (!row) { light.intensity = 0; continue; }
      const source = row.source;
      const phase = source.phase;
      const pulse = source.kind === 'torch'
        ? .88 + .07 * Math.sin(seconds * 11 + phase) + .05 * Math.sin(seconds * 17.3 + phase * 2)
        : .94 + .06 * Math.sin(seconds * .8 + phase);
      const fade = Math.min(1, Math.max(0, (65 - Math.sqrt(row.distance)) / 14));
      light.position.copy(source.position);
      light.color.setHex(source.colour);
      light.distance = source.reach;
      light.intensity = this.lightingEnabled ? source.intensity * pulse * fade : 0;
    }
  }

  getState(): WildernessEffectsState {
    return {
      ready: !this.disposed, enabled: this.enabled, lightingEnabled: this.lightingEnabled, seconds: this.seconds,
      torches: this.options.torches.length, channels: this.options.channels.length,
      pools: this.options.channels.filter(channel => channel.kind === 'pool').length,
      paletteRange: this.options.channels.length ? [...this.paletteRange] : [0, 0],
      moltenTriangles: this.moltenTriangles, dryApronTriangles: this.dryApronTriangles,
      crustPlates: this.crustPlates, bankRocks: this.bankRocks,
      rockMasses: this.options.channels.reduce((sum, channel) => sum + (channel.rockMasses?.length ?? 0), 0),
      texturedStoneMeshes: this.group.children.filter(child => {
        const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        return material?.userData.corealmAuthoredSurface === 'stone' && !!material.map && !!material.normalMap;
      }).length,
      liveParticles: this.enabled ? this.ambience.liveParticles() : 0,
      particleEmitters: this.ambience.emitterCount(), lightBudget: this.lights.length, bankLighting: this.bankLighting.snapshot(),
      lights: this.lights.map((light, i) => ({ id: this.assigned[i]?.id ?? null,
        kind: this.assigned[i]?.kind ?? null, intensity: light.intensity, colour: light.color.getHex(), position: light.position.toArray() })),
      bounds: this.bounds ? { min: this.bounds.min.toArray(), max: this.bounds.max.toArray() } : null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bankLighting.dispose();
    this.ambience.dispose();
    this.group.removeFromParent();
    for (const geometry of this.ownedGeometry) geometry.dispose();
    for (const material of this.ownedMaterial) material.dispose();
    for (const light of this.lights) light.dispose();
    this.group.clear();
  }

  private addMesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.ownedGeometry.add(geometry);
    this.ownedMaterial.add(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }

  private buildTorches(): void {
    const iron: THREE.BufferGeometry[] = [];
    const coal: THREE.BufferGeometry[] = [];
    for (const [index, torch] of this.options.torches.entries()) {
      const scale = torch.scale ?? 1;
      const [x, y, z] = torch.position;
      const palette = wildernessTorchPalette(torch);
      this.sources.push({ id: torch.id, kind: 'torch', position: new THREE.Vector3(x, y + .22 * scale, z),
        colour: palette.light, intensity: 24 * scale, reach: 13 * Math.sqrt(scale), phase: hash(index + 71) * 20 });
      this.ambience.addEmitter({ id: `wilderness:${torch.id}:flame`, kind: 'flame', position: torch.position,
        count: 11, scale: 1.8 * scale, cullMetres: 65,
        colour: palette.flame });
      this.ambience.addEmitter({ id: `wilderness:${torch.id}:embers`, kind: 'spark', position: torch.position,
        count: 3, scale: .5 * scale, cullMetres: 42,
        colour: palette.spark });
      if (!torch.support || torch.support === 'none') continue;
      const supportBottom = torch.support === 'sconce'
        ? y - .75 * scale : this.options.groundHeightAt(x, z) - .06;
      const stemHeight = Math.max(.3, y - supportBottom - .14 * scale);
      iron.push(new THREE.CylinderGeometry(.055 * scale, .09 * scale, stemHeight, 7)
        .translate(x, supportBottom + stemHeight / 2, z));
      iron.push(new THREE.CylinderGeometry(.3 * scale, .13 * scale, .28 * scale, 8, 1, true)
        .translate(x, y - .12 * scale, z));
      iron.push(new THREE.TorusGeometry(.29 * scale, .035 * scale, 5, 8)
        .rotateX(Math.PI / 2).translate(x, y + .01 * scale, z));
      coal.push(new THREE.IcosahedronGeometry(.24 * scale, 1)
        .scale(1, .32, 1).translate(x, y - .03 * scale, z));
      for (let side = 0; side < 4; side++) {
        const angle = side * Math.PI / 2;
        const px = x + Math.sin(angle) * .25 * scale;
        const pz = z + Math.cos(angle) * .25 * scale;
        iron.push(new THREE.CylinderGeometry(.025 * scale, .036 * scale, .46 * scale, 5)
          .translate(px, y - .03 * scale, pz));
      }
      if (torch.support === 'brazier') {
        iron.push(new THREE.CylinderGeometry(.25 * scale, .4 * scale, .2 * scale, 6)
          .translate(x, supportBottom + .08 * scale, z));
      }
    }
    this.addMerged('wilderness-torch-iron', iron,
      new THREE.MeshStandardMaterial({ color: 0x262526, roughness: .87, metalness: .68 }));
    this.addMerged('wilderness-torch-coals', coal,
      new THREE.MeshStandardMaterial({ color: 0x36201b, emissive: 0xa52e08, emissiveIntensity: .9, roughness: 1 }));
  }

  private addMerged(name: string, pieces: THREE.BufferGeometry[], material: THREE.Material): void {
    if (pieces.length === 0) { material.dispose(); return; }
    // Source primitives differ in indexed topology. One nonindexed stream keeps the merged draw valid.
    const compatible = pieces.map(piece => piece.index ? piece.toNonIndexed() : piece);
    const merged = mergeGeometries(compatible, false);
    for (const geometry of new Set([...pieces, ...compatible])) geometry.dispose();
    if (!merged) { material.dispose(); throw new Error(`Unable to merge ${name}`); }
    this.addMesh(name, merged, material);
  }

  private buildChannel(channel: LavaChannel): void {
    const sections = lavaSections(channel, .55);
    const columns = Math.max(12, Math.ceil(Math.max(...sections.map(row => row.halfWidth)) * 2 / .45));
    const molten = this.channelRibbon(channel, sections, Array.from({ length: columns + 1 }, (_, i) => i / columns * 2 - 1), false);
    this.moltenTriangles += molten.index!.count / 3;
    const material = new THREE.MeshStandardMaterial({ color: 0x2b1816, roughness: .91,
      emissive: 0xff5a08, emissiveIntensity: 1, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.uniforms.wildernessTime = this.flowClock;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute float lavaMagic;
        attribute float lavaBank;
        attribute vec2 lavaTransport;
        varying vec2 lavaUv;
        varying float moltenMagic;
        varying float moltenBank;
      `).replace('#include <begin_vertex>', `#include <begin_vertex>
        lavaUv = lavaTransport;
        moltenMagic = lavaMagic;
        moltenBank = lavaBank;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float wildernessTime;
        varying vec2 lavaUv;
        varying float moltenMagic;
        varying float moltenBank;
        vec2 lavaHash(vec2 p) {
          return fract(sin(vec2(dot(p, vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453);
        }
        float lavaNoise(vec2 p) {
          vec2 i=floor(p), f=fract(p);
          f=f*f*(3.0-2.0*f);
          return mix(mix(lavaHash(i).x,lavaHash(i+vec2(1,0)).x,f.x),
            mix(lavaHash(i+vec2(0,1)).x,lavaHash(i+vec2(1,1)).x,f.x),f.y);
        }
        float lavaFbm(vec2 p) {
          return lavaNoise(p)*.57+lavaNoise(p*2.07+9.1)*.29+lavaNoise(p*4.31+17.7)*.14;
        }
        float lavaFracture(vec2 p) {
          vec2 cell = floor(p), part = fract(p);
          float first = 8.0, second = 8.0;
          for (int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
            vec2 offset = vec2(float(x),float(y));
            vec2 jitter = .18 + .64 * lavaHash(cell+offset);
            float d = length(offset+jitter-part);
            if (d<first) { second=first; first=d; } else second=min(second,d);
          }
          return second-first;
        }
        vec4 lavaField(vec2 flow) {
          flow.x += sin(flow.y*.36)*.16;
          vec2 warp = vec2(lavaFbm(flow*.8),lavaFbm(flow*.7+18.4))-.5;
          vec2 broken = flow*vec2(.7,.45)+warp*1.45;
          return vec4(lavaFracture(broken), lavaFbm(flow*.47+3.8),
            lavaFbm(flow*.63-11.0), lavaFbm(flow*7.7));
        }
      `).replace('#include <color_fragment>', `#include <color_fragment>
        vec2 flow = lavaUv - vec2(0.0, wildernessTime * .11);
        vec4 field = lavaField(flow);
        float crack = 1.0 - smoothstep(.006, .060, field.x);
        float openings = smoothstep(.40, .74, field.y);
        float hotPool = smoothstep(.73, .86, field.z) * openings;
        float heat = max(crack * (.10 + .90 * openings), hotPool * .48);
        float edge = 1.0 - smoothstep(.66, .96, abs(moltenBank));
        heat *= .62 + .38 * edge;
        float grit = field.w * .048;
        vec3 warmRock = vec3(.029+grit,.027+grit,.025+grit);
        vec3 coldRock = vec3(.027+grit,.025+grit,.034+grit);
        vec3 hotRock = mix(vec3(.16,.032,.008),vec3(.048,.031,.18),moltenMagic);
        diffuseColor.rgb = mix(mix(warmRock,coldRock,moltenMagic),hotRock,heat);
      `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hottest = smoothstep(.70,.99,heat);
        vec3 warmMolten = mix(vec3(1.08,.068,.0015),vec3(2.025,.315,.009),hottest);
        vec3 coldMolten = mix(vec3(.33,.018,.87),vec3(.042,.42,1.32),hottest);
        vec3 moltenColour = mix(warmMolten,coldMolten,moltenMagic);
        totalEmissiveRadiance = mix(mix(vec3(.02,.001,.0005),vec3(.003,.001,.028),moltenMagic),moltenColour * 1.6,heat);
      `);
    };
    material.customProgramCacheKey = () => 'wilderness-lava-transport-v10';
    this.addMesh(`wilderness-lava-${channel.id}`, molten, material);
    const bankColumns = [...Array.from({ length: 9 }, (_, i) => -2 + i / 8),
      ...Array.from({ length: 9 }, (_, i) => 1 + i / 8)];
    const banks = this.channelRibbon(channel, sections, bankColumns, true);
    const bankMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
    bankMaterial.name = 'Corealm weathered strata';
    if (channel.naturalBanks) {
      bankMaterial.transparent = true;
      bankMaterial.depthWrite = false;
      bankMaterial.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
          attribute float lavaBank; varying float shoreFade;
        `).replace('#include <begin_vertex>', `#include <begin_vertex>
          shoreFade = 2.0 - abs(lavaBank);
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
          varying float shoreFade;
        `).replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.a *= smoothstep(0.0, .6, shoreFade);
        `);
      };
      bankMaterial.customProgramCacheKey = () => 'lava-weathered-bank-v1';
    }
    this.addMesh(`wilderness-lava-banks-${channel.id}`, banks, bankMaterial);
    const rocks: THREE.BufferGeometry[] = [];
    for (let i = 2; !channel.naturalBanks && !channel.rockMasses?.length && i < sections.length - 2; i += channel.rugged ? 11 : 4) {
      const section = sections[i]!;
      if (section.halfWidth < .4) continue;
      for (const side of [-1, 1]) {
        const shoreWidth = side < 0 ? section.leftHalfWidth : section.rightHalfWidth;
        const width = channel.rugged ? 1.1 + hash(i * 2 + side) * 1.2 : .35 + hash(i * 2 + side) * .7;
        const lateral = side * (shoreWidth + (channel.rugged ? width + 1.2 : .55) + hash(i + side + channel.seed) * 1.65);
        const x = section.x - section.tz * lateral;
        const z = section.z + section.tx * lateral;
        if (isMoltenLavaAt(x, z, this.options.channels, channel.rugged ? width + .25 : 1.1)) continue;
        const rock = new THREE.IcosahedronGeometry(1, 0);
        rock.scale(width, channel.rugged ? .55 + hash(i + 6) * .55 : .22 + hash(i + 6) * .55,
          channel.rugged ? 1.2 + hash(i + 11) * 1.1 : .4 + hash(i + 11) * .65);
        rock.rotateY(hash(i + side + 9) * 6.28);
        rock.translate(x, this.options.groundHeightAt(x, z) + (channel.rugged ? -.15 : .02), z);
        rocks.push(rock); this.bankRocks++;
      }
    }

    const basaltMaterial = new THREE.MeshStandardMaterial({ color: 0x66636a, roughness: 1 });
    basaltMaterial.name = 'Corealm weathered strata';
    this.addMerged(`wilderness-lava-basalt-${channel.id}`, rocks, basaltMaterial);
    if (!channel.naturalBanks) this.buildDryApron(channel, sections);
  }

  /** Continuous exposed host rock follows the actual sculpted terrain, including the channel cut. */
  private buildRockMass(mass: LavaRockMass): void {
    if (mass.weathered) return; // The shared terrain material continues across the whole shoulder.
    const minX = Math.floor(Math.min(...mass.polygon.map(p => p[0])) - 3);
    const maxX = Math.ceil(Math.max(...mass.polygon.map(p => p[0])) + 3);
    const minZ = Math.floor(Math.min(...mass.polygon.map(p => p[1])) - 3);
    const maxZ = Math.ceil(Math.max(...mass.polygon.map(p => p[1])) + 3);
    const positions: number[] = [], colours: number[] = [], uv: number[] = [];
    const vertex = (x: number, z: number): void => {
      const y = this.options.groundHeightAt(x, z) + .09;
      positions.push(x, y, z); uv.push(x * .7, z * .7);
      const layer = Math.floor(y / 1.15);
      const tint = .24 + .065 * hash(layer * 19) + .025 * hash(Math.floor(x * .45) * 31 + Math.floor(z * .45));
      colours.push(tint * .87, tint * .9, tint);
    };
    const triangle = (a: readonly [number,number], b: readonly [number,number], c: readonly [number,number]): void => {
      if ([a,b,c].some(p => rockMassDistance(mass, p[0],p[1]) > 2.5
        || isMoltenLavaAt(p[0],p[1],this.options.channels,.06))) return;
      for (const p of [a,b,c]) vertex(p[0],p[1]);
    };
    for (let z = minZ; z < maxZ; z += .75) for (let x = minX; x < maxX; x += .75) {
      triangle([x,z],[x,z+.75],[x+.75,z]);
      triangle([x+.75,z],[x,z+.75],[x+.75,z+.75]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,flatShading:true});
    material.name = 'Corealm weathered strata';
    this.addMesh(`wilderness-rock-mass-${mass.id}`, this.projectRockUvs(geometry), material);
  }

  /** Project each exposed face in metres; planar XZ UVs stretch vertically on canyon walls. */
  private projectRockUvs(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    const positions = geometry.getAttribute('position');
    const uv: number[] = [], indices: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 3) {
      a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
      const normal = b.sub(a).cross(c.sub(a));
      const axis = Math.abs(normal.y) > Math.max(Math.abs(normal.x), Math.abs(normal.z)) ? 1
        : Math.abs(normal.x) > Math.abs(normal.z) ? 0 : 2;
      for (let j = i; j < i + 3; j++) {
        uv.push((axis === 0 ? positions.getZ(j) : positions.getX(j)) * .7,
          (axis === 1 ? positions.getZ(j) : positions.getY(j)) * .7);
        indices.push(j);
      }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  private conformBank(source: THREE.BufferGeometry, channel: LavaChannel): THREE.BufferGeometry {
    const attributes = Object.entries(source.attributes).map(([name, value]) =>
      ({ name, size: value.itemSize, values: Array.from(value.array) }));
    const positions = attributes.find(a => a.name === 'position')!.values;
    for (let i = 0; i < positions.length; i += 3)
      positions[i + 1] = this.options.groundHeightAt(positions[i]!, positions[i + 2]!) + .065;
    const others = this.options.channels.filter(c => c !== channel);
    const wet = new Map<number, boolean>();
    const isWet = (i: number): boolean => {
      if (!wet.has(i)) wet.set(i, isMoltenLavaAt(positions[i*3]!, positions[i*3+2]!, others, .021));
      return wet.get(i)!;
    };
    const indices: number[] = [], midpoints = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const cached = midpoints.get(key);
      if (cached !== undefined) return cached;
      const index = positions.length / 3;
      for (const attribute of attributes) for (let k = 0; k < attribute.size; k++)
        attribute.values.push((attribute.values[a * attribute.size + k]! + attribute.values[b * attribute.size + k]!) / 2);
      positions[index * 3 + 1] = this.options.groundHeightAt(positions[index * 3]!, positions[index * 3 + 2]!) + .065;
      midpoints.set(key, index);
      return index;
    };
    const triangle = (a: number, b: number, c: number, depth = 0): void => {
      const x = (positions[a*3]! + positions[b*3]! + positions[c*3]!) / 3;
      const z = (positions[a*3+2]! + positions[b*3+2]! + positions[c*3+2]!) / 3;
      let error = Math.abs(this.options.groundHeightAt(x,z) + .065
        - (positions[a*3+1]! + positions[b*3+1]! + positions[c*3+1]!) / 3);
      for (const [from,to] of [[a,b],[b,c],[c,a]]) {
        const mx = (positions[from!*3]! + positions[to!*3]!) / 2;
        const mz = (positions[from!*3+2]! + positions[to!*3+2]!) / 2;
        error = Math.max(error, Math.abs(this.options.groundHeightAt(mx,mz) + .065
          - (positions[from!*3+1]! + positions[to!*3+1]!) / 2));
      }
      if (depth < 4 && error > .018) {
        const ab=midpoint(a,b), bc=midpoint(b,c), ca=midpoint(c,a);
        triangle(a,ab,ca,depth+1); triangle(ab,b,bc,depth+1);
        triangle(ca,bc,c,depth+1); triangle(ab,bc,ca,depth+1);
      } else if (![a,b,c].some(isWet)) indices.push(a,b,c);
    };
    const original = source.index!.array;
    for (let i=0;i<original.length;i+=3) triangle(original[i]!,original[i+1]!,original[i+2]!);
    for (const a of attributes) source.setAttribute(a.name,new THREE.Float32BufferAttribute(a.values,a.size));
    source.setIndex(indices); source.computeVertexNormals();
    return source;
  }

  /** A thin dry cinder layer closes the narrow spaces between curved berms and rounded end caps.
   * It follows the existing ground and never changes the molten, terrain or collision footprint. */
  private buildDryApron(channel: LavaChannel, sections: readonly LavaSection[]): void {
    const step = .5;
    const fringe = .65;
    const margin = Math.max(...sections.map(row => row.halfWidth)) + channel.bankWidth + fringe;
    const minX = Math.floor((Math.min(...sections.map(row => row.x)) - margin) / step);
    const maxX = Math.ceil((Math.max(...sections.map(row => row.x)) + margin) / step);
    const minZ = Math.floor((Math.min(...sections.map(row => row.z)) - margin) / step);
    const maxZ = Math.ceil((Math.max(...sections.map(row => row.z)) + margin) / step);
    const positions: number[] = [], uv: number[] = [], colours: number[] = [], indices: number[] = [];
    const distances: number[] = [];
    const vertices = new Map<string, number>();
    const add = (x: number, z: number, clearance: number): number => {
      const index = positions.length / 3;
      positions.push(x, this.options.groundHeightAt(x, z) + .055, z);
      uv.push(x * .55, z * .55);
      // Global coordinates keep overlapping aprons identical at a fork.
      const tint = .135 + hash(Math.floor(x * 2) * 71 + Math.floor(z * 2) * 137) * .035;
      colours.push(tint * .9, tint * .91, tint);
      distances.push(clearance);
      return index;
    };
    const at = (gx: number, gz: number): number => {
      const key = `${gx}:${gz}`;
      const existing = vertices.get(key);
      if (existing !== undefined) return existing;
      const x = gx * step, z = gz * step;
      const index = add(x, z, lavaClearanceAt(x, z, [channel]) - fringe);
      vertices.set(key, index);
      return index;
    };
    const boundary = (a: number, b: number): number => {
      const t = distances[a]! / (distances[a]! - distances[b]!);
      return add(positions[a * 3]! + (positions[b * 3]! - positions[a * 3]!) * t,
        positions[a * 3 + 2]! + (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * t, 0);
    };
    const conform = (a: number, b: number, c: number, depth = 0): void => {
      const midpoint = (from: number, to: number) => {
        const x = (positions[from * 3]! + positions[to * 3]!) / 2;
        const z = (positions[from * 3 + 2]! + positions[to * 3 + 2]!) / 2;
        const height = this.options.groundHeightAt(x, z) + .055;
        return { x, z, error: Math.abs(height - (positions[from * 3 + 1]! + positions[to * 3 + 1]!) / 2) };
      };
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      const centreX = (positions[a * 3]! + positions[b * 3]! + positions[c * 3]!) / 3;
      const centreZ = (positions[a * 3 + 2]! + positions[b * 3 + 2]! + positions[c * 3 + 2]!) / 3;
      const centreError = Math.abs(this.options.groundHeightAt(centreX, centreZ) + .055
        - (positions[a * 3 + 1]! + positions[b * 3 + 1]! + positions[c * 3 + 1]!) / 3);
      if (depth < 4 && Math.max(ab.error, bc.error, ca.error, centreError) > .014) {
        // Pool ends and terrain triangle seams need finer contact than the broad flat banks.
        const iab = add(ab.x, ab.z, 0), ibc = add(bc.x, bc.z, 0), ica = add(ca.x, ca.z, 0);
        conform(a, iab, ica, depth + 1); conform(iab, b, ibc, depth + 1);
        conform(ica, ibc, c, depth + 1); conform(iab, ibc, ica, depth + 1);
      } else indices.push(a, b, c);
    };
    const triangle = (a: number, b: number, c: number): void => {
      const input = [a, b, c];
      const polygon: number[] = [];
      for (let i = 0; i < 3; i++) {
        const from = input[(i + 2) % 3]!, to = input[i]!;
        const fromInside = distances[from]! <= 0, toInside = distances[to]! <= 0;
        if (fromInside !== toInside) polygon.push(boundary(from, to));
        if (toInside) polygon.push(to);
      }
      for (let i = 1; i < polygon.length - 1; i++) conform(polygon[0]!, polygon[i]!, polygon[i + 1]!);
    };
    for (let gz = minZ; gz < maxZ; gz++) {
      for (let gx = minX; gx < maxX; gx++) {
        const a = at(gx, gz), b = at(gx + 1, gz), c = at(gx, gz + 1), d = at(gx + 1, gz + 1);
        triangle(a, c, b); triangle(b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.dryApronTriangles += indices.length / 3;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
    material.name = 'Corealm weathered strata';
    const mesh = this.addMesh(`wilderness-lava-apron-${channel.id}`, geometry, material);
    // Existing lava and raised banks reject hidden apron fragments before their texture work.
    mesh.renderOrder = 1;
  }

  private channelRibbon(channel: LavaChannel, sections: readonly LavaSection[],
    columns: readonly number[], banks: boolean): THREE.BufferGeometry {
    const positions: number[] = [];
    const uv: number[] = [];
    const colours: number[] = [];
    const magicValues: number[] = [];
    const edgeValues: number[] = [];
    const bankDistance: number[] = [];
    const indices: number[] = [];
    // Earlier channels own their molten footprint. Trim later tributaries at that shore
    // so a shallow join has one surface instead of two coplanar, flickering ribbons.
    const adjoining = banks ? this.options.channels.filter(other => other !== channel)
      : this.options.channels.slice(0, this.options.channels.indexOf(channel));
    const clipEnds = banks ? [] : adjoining.map(other => {
      const rows = lavaSections(other, .55);
      return { channel: other, first: rows[0]!, last: rows.at(-1)! };
    });
    const clearance = (x: number, z: number): number => banks
      ? lavaSurfaceClearanceAt(x, z, adjoining)
      : Math.min(...clipEnds.map(({ channel: other, first, last }) => Math.max(
        lavaSurfaceClearanceAt(x, z, [other]),
        -(x - first.x) * first.tx - (z - first.z) * first.tz,
        (x - last.x) * last.tx + (z - last.z) * last.tz)));
    for (const [row, section] of sections.entries()) {
      for (const [column, offset] of columns.entries()) {
        const side = Math.sign(offset);
        const abs = Math.abs(offset);
        const edgeBreak = .83 + .17 * Math.sin(section.distance * .95 + side * 3.1) ** 2;
        const shoreWidth = side < 0 ? section.leftHalfWidth : section.rightHalfWidth;
        const bankWidth = lavaBankWidthAt(channel, section.progress, side);
        const distance = banks ? side * (shoreWidth + (abs - 1) * bankWidth * (channel.naturalBanks ? 1 : edgeBreak)) : offset * shoreWidth;
        const x = section.x - section.tz * distance;
        const z = section.z + section.tx * distance;
        // Broken ledges sit on the physical cut, tapering into the receiving terrain.
        const bankT = abs - 1;
        const ledge = Math.sin(bankT * Math.PI) * (.12 + .09 * Math.sin(section.distance * 1.7 + side * 2.3));
        const strata = Math.sin(bankT * Math.PI * 5 + Math.sin(section.distance * .6)) * .055;
        const rise = banks ? channel.naturalBanks ? .065 : .065 + Math.max(0, ledge + strata * Math.sin(bankT * Math.PI)) : .16;
        const y = banks ? this.options.groundHeightAt(x, z) + rise : this.surfaceAt(x, z);
        positions.push(x, y, z);
        const magic = lavaMagicAt(channel, x, z);
        this.paletteRange[0] = Math.min(this.paletteRange[0], magic);
        this.paletteRange[1] = Math.max(this.paletteRange[1], magic);
        magicValues.push(magic);
        edgeValues.push(offset);
        bankDistance.push(adjoining.length ? clearance(x, z) : Infinity);
        uv.push(distance, section.distance);
        const tint = channel.naturalBanks ? .073 + .025 * hash(Math.floor(x / 3) * 17 + Math.floor(z / 3))
          : .2 + hash(row * 5 + column + channel.seed) * .075;
        colours.push(tint * .89, tint * .9, tint);
        if (row > 0 && column > 0) {
          // Leave the molten centre open between the independent left and right banks.
          if (banks && columns[column - 1]! < 0 && offset > 0) continue;
          const c = row * columns.length + column;
          const a = c - columns.length;
          indices.push(a - 1, a, c - 1, a, c, c - 1);
        }
      }
    }
    if (adjoining.length) {
      const clipped: number[] = [];
      const shore = banks ? .025 : -.015;
      const intersect = (a: number, b: number): number => {
        // Locate the real curved shoreline rather than leaving a whole triangular patch of bare
        // terrain whenever a single corner crosses a fork. All attributes stay on the same edge.
        let lo = 0, hi = 1;
        const aDry = bankDistance[a]! >= shore;
        for (let iteration = 0; iteration < 9; iteration++) {
          const t = (lo + hi) / 2;
          const x = positions[a * 3]! + (positions[b * 3]! - positions[a * 3]!) * t;
          const z = positions[a * 3 + 2]! + (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * t;
          if ((clearance(x, z) >= shore) === aDry) lo = t;
          else hi = t;
        }
        const t = aDry ? lo : hi;
        const index = positions.length / 3;
        const interpolate = (array: number[], stride: number): void => {
          for (let component = 0; component < stride; component++) {
            array.push(array[a * stride + component]!
              + (array[b * stride + component]! - array[a * stride + component]!) * t);
          }
        };
        interpolate(positions, 3); interpolate(uv, 2); interpolate(colours, 3);
        if (!banks) positions[index * 3 + 1] = this.surfaceAt(positions[index * 3]!, positions[index * 3 + 2]!);
        interpolate(magicValues, 1); interpolate(edgeValues, 1);
        bankDistance.push(shore);
        return index;
      };
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = indices.slice(i, i + 3);
        const polygon: number[] = [];
        for (let j = 0; j < 3; j++) {
          const a = triangle[(j + 2) % 3]!, b = triangle[j]!;
          const aDry = bankDistance[a]! >= shore, bDry = bankDistance[b]! >= shore;
          if (aDry !== bDry) polygon.push(intersect(a, b));
          if (bDry) polygon.push(b);
        }
        for (let j = 1; j < polygon.length - 1; j++) clipped.push(polygon[0]!, polygon[j]!, polygon[j + 1]!);
      }
      indices.length = 0;
      indices.push(...clipped);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('lavaMagic', new THREE.Float32BufferAttribute(magicValues, 1));
    geometry.setAttribute('lavaBank', new THREE.Float32BufferAttribute(edgeValues, 1));
    const transport: number[] = [];
    if (!banks) {
      for (let i = 0; i < positions.length; i += 3) transport.push(...this.textureAt(positions[i]!, positions[i + 2]!));
      geometry.setAttribute('lavaTransport', new THREE.Float32BufferAttribute(transport, 2));
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return banks ? this.projectRockUvs(channel.naturalBanks ? this.conformBank(geometry, channel) : geometry) : geometry;
  }
}
