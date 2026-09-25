import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { Fn, float, fract, fwidth, max, min, mix, positionGeometry, sin, smoothstep, varying, vec2, vec3, vertexColor } from 'three/tsl';
import { cloneNodeMaterial, composeSurface } from './nodeMaterials.js';
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
  if (name === 'MI_Banner' && assetId.startsWith('banner')) return 'cloth';
  return architectureMaterialRoleForAsset(assetId, name);
}

/** The source lantern cage has no glass. This insert lies inside its measured tapered body. */
export const FAIRY_LANTERN_GLASS = Object.freeze({
  centre: [0, .335, .808] as const, height: .33, bottomRadius: .112, topRadius: .139,
});
export const FAIRY_LAMP_LIGHT_BUDGET = 4;

/** Shared source textures retain their grain and normal maps; only fairy settlements use these clones. */
export class FairyArchitecture {
  private readonly materials = new Map<string, MeshStandardNodeMaterial>();
  private glassGeometry: THREE.BufferGeometry | null = null;
  private glassMaterial: MeshStandardNodeMaterial | null = null;
  private readonly lights: THREE.PointLight[] = [];

  material(base: THREE.Material, assetId: string, regionId: RegionId | null): THREE.Material | null {
    if (!isFairyArchitectureRegion(regionId) || (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial
      && !(base as MeshStandardNodeMaterial).isMeshStandardNodeMaterial)) return null;
    const surface = fairyArchitectureSurface(assetId, base.name);
    if (!surface) return null;
    const key = `${base.uuid}:${regionId}:${surface}`;
    const old = this.materials.get(key);
    if (old) return old;
    const source = base as THREE.MeshStandardMaterial;
    const material = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
    material.name = `${source.name}@fairy-architecture:${regionId}:${surface}`;
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
      // Local coordinates keep the leading continuous across separate UV islands.
      const panePosition = varying(positionGeometry.xy);
      const grid = vec2(panePosition.x.add(panePosition.y), panePosition.x.sub(panePosition.y)).mul(2.5);
      const leads = fract(grid).sub(.5).abs();
      const distance = min(leads.x, leads.y);
      const aa = max(fwidth(distance), .002);
      const pane = smoothstep(float(.018).sub(aa), float(.018).add(aa), distance);
      const cell = grid.add(.5).floor();
      const variation = fract(sin(cell.dot(vec2(127.1, 311.7))).mul(43758.5453));
      const value = variation.mul(.13).add(.77).add(smoothstep(.02, .22, distance).mul(.10));
      composeSurface(material, {
        color: previous => previous.mul(mix(.14, value, pane)),
        emissive: previous => previous.mul(mix(.003, value, pane)),
      });
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
      const tintNode = vec3(tint.r, tint.g, tint.b);
      const sourceVertexColors = material.vertexColors;
      // Recolor after imported COLOR_0, otherwise orange cloth erases the blue channel.
      // The graph chooses geometry attributes during compilation, including atlas meshes
      // without COLOR_0 that share the same authored material.
      material.vertexColors = false;
      composeSurface(material, {
        color: previous => Fn(builder => {
          const sourceColor = sourceVertexColors && builder.geometry.hasAttribute('color')
            ? previous.mul(vertexColor().rgb) : previous;
          const value = sourceColor.dot(vec3(.2126, .7152, .0722));
          const tinted = value.mul(tintNode).clamp(0, 1);
          return mix(sourceColor, tinted, .96).mul(VALUE[surface]);
        })(),
      });
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
      this.glassMaterial = new MeshStandardNodeMaterial({
        name: 'fairy-lantern-amber-glass', color: 0xad7738, emissive: 0xffa43d,
        emissiveIntensity: .95, roughness: .78, metalness: 0, side: THREE.DoubleSide,
      });
      const height = varying(positionGeometry.y.div(FAIRY_LANTERN_GLASS.height / 2));
      composeSurface(this.glassMaterial, {
        emissive: previous => previous.mul(smoothstep(.05, 1, height.abs()).mul(.32).oneMinus()),
      });
    }
    return {
      geometry: this.glassGeometry, material: this.glassMaterial,
      matrix: new THREE.Matrix4().makeTranslation(...FAIRY_LANTERN_GLASS.centre), triangles: 16,
    };
  }

  /** Four unshadowed lamps share a fixed light budget, including when a whole town is resident. */
  updateLights(parent: THREE.Object3D, positions: readonly THREE.Vector3[], viewer: THREE.Vector3): void {
    // Reserve the pool on the first update, before startup shader preparation. Adding lights
    // on first arrival changes NUM_POINT_LIGHTS and recompiles every lit material mid-frame.
    // Zero intensity keeps unused lamps dark without changing the compiled light count.
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
    for (const light of this.lights) { light.removeFromParent(); light.dispose(); }
    this.lights.length = 0;
  }
}
