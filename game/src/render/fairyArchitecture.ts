import * as THREE from 'three';
import type { RegionId } from '../contracts.js';
import { architectureMaterialRoleForAsset } from './materials.js';

type FairyRegion = 'gloamgarden' | 'faeholme';
type Surface = 'roof' | 'plaster' | 'stone' | 'timber' | 'moss' | 'cloth' | 'iron' | 'glass' | 'lamp';

const PALETTES: Record<FairyRegion, Record<Exclude<Surface, 'glass' | 'lamp'>, number>> = {
  gloamgarden: { roof: 0x806195, plaster: 0xeadcc0, stone: 0x8e9180, timber: 0x78604a, moss: 0x54754b, cloth: 0x9879aa, iron: 0x53463b },
  faeholme: { roof: 0x77769e, plaster: 0xe5ddd0, stone: 0x89918b, timber: 0x716353, moss: 0x657e65, cloth: 0x8984b2, iron: 0x51483f },
};
const VALUE: Record<Exclude<Surface, 'glass' | 'lamp'>, number> = {
  roof: .87, plaster: 1.0, stone: .88, timber: .77, moss: .83, cloth: 1.35, iron: .48,
};

export function isFairyArchitectureRegion(regionId: RegionId | null): regionId is FairyRegion {
  return regionId === 'gloamgarden' || regionId === 'faeholme';
}

export function fairyArchitectureSurface(assetId: string, materialName: string): Surface | null {
  const name = materialName.split('@', 1)[0]!;
  if (name === 'MI_WindowGlass') return 'glass';
  if (assetId === 'lamp_wall' && name === 'MI_Trim_Metal') return 'lamp';
  if (/^door_/.test(assetId) && name === 'MI_MetalOrnaments') return 'iron';
  if (name === 'MI_Banner' && /^(market_stall|banner)/.test(assetId)) return 'cloth';
  return architectureMaterialRoleForAsset(assetId, name);
}

/** The source lantern cage has no glass. This insert lies inside its measured tapered body. */
export const FAIRY_LANTERN_GLASS = Object.freeze({
  centre: [0, .335, .808] as const, height: .33, bottomRadius: .112, topRadius: .139,
});
export const FAIRY_LAMP_LIGHT_BUDGET = 4;

/** Cloth hangs between the rear posts and the full native front crossbar, then drapes past them. */
export function createFairyMarketCanopyGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const across = 28, along = 22;
  const smooth = (value: number) => {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const height = (x: number, z: number) => {
    // Native front timber tops out at 2.572 m over z=.309.. .432. It supports the entire
    // cloth width there, so the central sag must end at the beam rather than cut through it.
    const betweenTies = THREE.MathUtils.clamp((z + .85) / 1.25, 0, 1);
    const acrossTies = Math.max(0, 1 - (x / .845) ** 2) ** 2;
    const hanging = Math.sin(betweenTies * Math.PI) ** 2 * acrossTies;
    const sag = .10 * hanging;
    const softFold = .009 * Math.sin(x * 8 + z * 1.4) * hanging;
    const sideDrop = .06 * smooth((Math.abs(x) - .845) / .605);
    return 2.82 - .18 * (z + .85) - sag + softFold - sideDrop;
  };
  const roofPoint = (u: number, v: number) => {
    // Tension pulls each free edge slightly inward between the corners.
    const x = (-1.45 + 2.9 * u) * (1 - .025 * Math.sin(v * Math.PI) ** 2);
    const z = -1.1 + 2.2 * v + .06 * Math.sin(u * Math.PI) ** 2 * (1 - 2 * v);
    return [x, height(x, z), z] as const;
  };
  for (let row = 0; row <= along; row++) {
    const v = row / along;
    for (let col = 0; col <= across; col++) {
      const u = col / across;
      positions.push(...roofPoint(u, v));
      // Plain weathered cloth on the source atlas, clear of its black pictogram panels.
      uv.push(.65 + .31 * u, .17 + .24 * v);
      if (row < along && col < across) {
        const a = row * (across + 1) + col, b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const frontStart = positions.length / 3;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col <= across; col++) {
      const u = col / across, [x, y, z] = roofPoint(u, 1);
      positions.push(x, y - row * (.14 + .035 * Math.sin(u * Math.PI)), z + row * .015);
      uv.push(.65 + .31 * u, .41 + row * .035);
      if (row === 0 && col < across) {
        const a = frontStart + col, b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Shared source textures retain their grain and normal maps; only fairy settlements use these clones. */
export class FairyArchitecture {
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private glassGeometry: THREE.BufferGeometry | null = null;
  private glassMaterial: THREE.MeshStandardMaterial | null = null;
  private canopyGeometry: THREE.BufferGeometry | null = null;
  private readonly canopySources = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private readonly lights: THREE.PointLight[] = [];

  material(base: THREE.Material, assetId: string, regionId: RegionId | null): THREE.Material | null {
    if (!isFairyArchitectureRegion(regionId) || !(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) return null;
    const surface = fairyArchitectureSurface(assetId, base.name);
    if (!surface) return null;
    const key = `${base.uuid}:${regionId}:${surface}`;
    const old = this.materials.get(key);
    if (old) return old;
    const source = base as THREE.MeshStandardMaterial;
    const material = source.clone();
    material.name = `${source.name}@fairy-architecture:${regionId}:${surface}`;
    const programKey = `${source.customProgramCacheKey()}|fairy-architecture-v3:${regionId}:${surface}`;
    material.customProgramCacheKey = () => programKey;
    if (surface === 'glass') {
      // Amber remains below the tone mapper's white shoulder. The glass is a lit pane,
      // while its small leads and the separate native wooden frame stay dark.
      material.color.setHex(0xa87436);
      material.emissive.setHex(0xffa43d);
      material.emissiveIntensity = .68;
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.metalness = 0;
      material.roughness = .63;
      material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(source, shader, renderer);
        // The source glass UV atlas splits single panes into unrelated islands. Local
        // coordinates keep the leading continuous across those source triangles.
        shader.vertexShader = 'varying vec2 vFairyWindowPosition;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFairyWindowPosition = position.xy;');
        shader.fragmentShader = 'varying vec2 vFairyWindowPosition;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec2 fairyLeadGrid = vec2(vFairyWindowPosition.x + vFairyWindowPosition.y, vFairyWindowPosition.x - vFairyWindowPosition.y) * 2.5;
vec2 fairyLeads = abs(fract(fairyLeadGrid) - .5);
float fairyLeadDistance = min(fairyLeads.x, fairyLeads.y);
float fairyLeadAA = max(fwidth(fairyLeadDistance), .002);
float fairyPane = smoothstep(.018 - fairyLeadAA, .018 + fairyLeadAA, fairyLeadDistance);
vec2 fairyPaneCell = floor(fairyLeadGrid + .5);
float fairyPaneVariation = fract(sin(dot(fairyPaneCell, vec2(127.1, 311.7))) * 43758.5453);
float fairyPaneValue = .77 + .13 * fairyPaneVariation + .10 * smoothstep(.02, .22, fairyLeadDistance);
diffuseColor.rgb *= mix(.14, fairyPaneValue, fairyPane);
totalEmissiveRadiance *= mix(.003, fairyPaneValue, fairyPane);`);
      };
    } else if (surface === 'lamp') {
      material.color.setHex(0x6a5540);
      material.metalness = .48;
      material.roughness = .77;
    } else {
      if (surface === 'iron') {
        // The native door grille is blue polished metal. Keep its ornament texture,
        // but prevent the purple sky reflection from dominating the cottage doorway.
        material.metalness = .18;
        material.roughness = .92;
      }
      const tint = new THREE.Color(PALETTES[regionId][surface]);
      tint.multiplyScalar(1 / Math.max(.0001, .2126 * tint.r + .7152 * tint.g + .0722 * tint.b));
      const colour = `vec3(${tint.r.toFixed(6)}, ${tint.g.toFixed(6)}, ${tint.b.toFixed(6)})`;
      material.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile.call(source, shader, renderer);
        // Imported stall cloth carries burnt-orange COLOR_0 values. Recolor after that multiply,
        // otherwise the vertex colors remove the blue channel from an already-purple texture.
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float fairySourceValue = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
vec3 fairySurfaceColour = clamp(fairySourceValue * ${colour}, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, fairySurfaceColour, .96) * ${VALUE[surface].toFixed(3)};`);
      };
    }
    this.materials.set(key, material);
    return material;
  }

  lanternPart() {
    if (!this.glassGeometry) {
      this.glassGeometry = new THREE.CylinderGeometry(FAIRY_LANTERN_GLASS.topRadius, FAIRY_LANTERN_GLASS.bottomRadius, FAIRY_LANTERN_GLASS.height, 8, 1, true);
      this.glassGeometry.rotateY(Math.PI / 8);
    }
    if (!this.glassMaterial) {
      this.glassMaterial = new THREE.MeshStandardMaterial({
        name: 'fairy-lantern-amber-glass', color: 0xad7738, emissive: 0xffa43d,
        emissiveIntensity: .95, roughness: .78, metalness: 0, side: THREE.DoubleSide,
      });
      this.glassMaterial.customProgramCacheKey = () => 'fairy-lantern-amber-glass-v2';
      this.glassMaterial.onBeforeCompile = shader => {
        shader.vertexShader = 'varying float vFairyLampHeight;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vFairyLampHeight = position.y / ${(FAIRY_LANTERN_GLASS.height / 2).toFixed(3)};`);
        shader.fragmentShader = 'varying float vFairyLampHeight;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= 1.0 - .32 * smoothstep(.05, 1.0, abs(vFairyLampHeight));`);
      };
    }
    return {
      geometry: this.glassGeometry, material: this.glassMaterial,
      matrix: new THREE.Matrix4().makeTranslation(...FAIRY_LANTERN_GLASS.centre), triangles: 16,
    };
  }

  marketCanopyPart(base: THREE.Material, regionId: RegionId | null) {
    this.canopyGeometry ??= createFairyMarketCanopyGeometry();
    let source = this.canopySources.get(base);
    if (!source) {
      source = (base as THREE.MeshStandardMaterial).clone();
      source.name = 'MI_Banner';
      source.vertexColors = false;
      source.color.setRGB(.54, .54, .54);
      source.metalness = 0;
      source.roughness = .96;
      source.side = THREE.DoubleSide;
      this.canopySources.set(base, source);
    }
    const material = this.material(source, 'market_stall', regionId)!;
    return {
      geometry: this.canopyGeometry, material, matrix: new THREE.Matrix4(),
      triangles: this.canopyGeometry.index!.count / 3,
    };
  }

  /** Four unshadowed lamps share a fixed light budget, including when a whole town is resident. */
  updateLights(parent: THREE.Object3D, positions: readonly THREE.Vector3[], viewer: THREE.Vector3): void {
    if (positions.length === 0 && this.lights.length === 0) return;
    while (this.lights.length < FAIRY_LAMP_LIGHT_BUDGET) {
      const light = new THREE.PointLight(0xffc274, 0, 5.5, 2);
      light.name = `fairy-lantern-light-${this.lights.length}`;
      light.castShadow = false;
      parent.add(light);
      this.lights.push(light);
    }
    const closest = positions.filter(position => position.distanceToSquared(viewer) < 32 ** 2)
      .sort((a, b) => a.distanceToSquared(viewer) - b.distanceToSquared(viewer));
    for (let index = 0; index < this.lights.length; index++) {
      const light = this.lights[index]!;
      const position = closest[index];
      light.intensity = position ? 8 : 0;
      if (position) light.position.copy(position);
    }
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.glassGeometry?.dispose();
    this.glassMaterial?.dispose();
    this.glassGeometry = null;
    this.glassMaterial = null;
    this.canopyGeometry?.dispose();
    this.canopyGeometry = null;
    for (const source of this.canopySources.values()) source.dispose();
    this.canopySources.clear();
    for (const light of this.lights) { light.removeFromParent(); light.dispose(); }
    this.lights.length = 0;
  }
}
