import * as THREE from 'three';

import { MeshPhysicalNodeMaterial, PhysicalLightingModel, type MeshStandardNodeMaterial, type NodeBuilder } from 'three/webgpu';
import {
  float, materialColor, materialIridescenceThickness, materialReference, materialSheen,
  normalView, normalViewGeometry, positionViewDirection, vec3, vec4, vertexColor,
} from 'three/tsl';
import { ensureNodeMaterial } from './nodeMaterials.js';

const lumaWeights = vec3(0.2126, 0.7152, 0.0722);

/** Keep embroidered color visible in grazing daylight highlights.
 * applyFabMagicSurface retains this flag when it promotes the material. */
export function preserveFabClothHighlights(material: THREE.Material): void {
  material.userData.preserveFabClothHighlights = true;
}

class FabClothLightingModel extends PhysicalLightingModel {
  override ambientOcclusion(builder: NodeBuilder): void {
    super.ambientOcclusion(builder);
    const reflected = builder.context.reflectedLight;
    let reflection = vec3(reflected.directSpecular).add(reflected.indirectSpecular);
    if (this.sheen && this.sheenSpecularDirect && this.sheenSpecularIndirect) {
      reflection = reflection.add(this.sheenSpecularDirect, this.sheenSpecularIndirect);
    }
    const limit = vec3(reflected.directDiffuse).add(reflected.indirectDiffuse)
      .dot(lumaWeights).mul(0.8).add(0.035);
    const scale = limit.div(limit.add(reflection.dot(lumaWeights))).toVar();
    vec3(reflected.directSpecular).mulAssign(scale);
    vec3(reflected.indirectSpecular).mulAssign(scale);
    if (this.sheen && this.sheenSpecularDirect && this.sheenSpecularIndirect) {
      vec3(this.sheenSpecularDirect).mulAssign(scale);
      vec3(this.sheenSpecularIndirect).mulAssign(scale);
    }
  }
}

export interface FabMagicSurfaceOptions {
  tier: number;
  role: 'cloth' | 'leather' | 'trim';
  /** Linear detail mask. The caller owns its channel, tiling and lifetime. */
  detailTexture?: THREE.Texture;
  /** Smooth panel sheen for the rare mage outfits; never samples projected UVs. */
  tailored?: boolean;
}

/** Slow, continuous movement of the interference colors, with no brightness pulse. */
export function fabMagicShimmerPhase(seconds: number): number {
  return Math.sin(seconds * 0.38) * 0.72 + Math.sin(seconds * 0.17) * 0.28;
}

let sampleTime: number | null = null;

export interface FabMagicSurfaceState {
  name: string;
  tier: number;
  role: FabMagicSurfaceOptions['role'];
  phase: number;
  sampleTime: number;
  iridescence: number;
  detailChannel: number | null;
  lastRenderedMs: number;
}

// Diagnostic values only: this registry never retains a mesh, texture or material.
const renderedSurfaces = new Map<string, FabMagicSurfaceState>();
const maxRecordedSurfaces = 256;
const recentRenderWindowMs = 1000;

/** Recent production renders, sorted by material name and detached from live state. */
export function getFabMagicSurfaceState(): FabMagicSurfaceState[] {
  const now = performance.now();
  for (const [name, state] of renderedSurfaces) {
    if (now - state.lastRenderedMs > recentRenderWindowMs || now < state.lastRenderedMs) {
      renderedSurfaces.delete(name);
    }
  }
  return [...renderedSurfaces.values()]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(state => ({ ...state }));
}

/** Freeze material animation for reproducible lab captures; null restores real time. */
export function setFabMagicSampleTime(seconds: number | null): void {
  sampleTime = seconds !== null && Number.isFinite(seconds) ? seconds : null;
}

// Material references bind to the material being drawn. Clones share immutable
// node graphs while their animation values and diagnostics remain independent.
class FabMagicMaterial extends MeshPhysicalNodeMaterial {
  _fabMagicShimmer = 0;
  _fabMagicTintStrength = 0.03;
  _fabMagicShimmerStrength = 10;
  _fabMagicTailored = false;

  override copy(source: THREE.Material): this {
    // NodeMaterial serializes userData, which can also hold live asset metadata.
    super.copy(Object.assign(Object.create(source) as THREE.Material, { userData: {} }));
    this.userData = { ...source.userData };
    if (source.userData.magicSurface) this.userData.magicSurface = { ...source.userData.magicSurface };
    if (source instanceof FabMagicMaterial) {
      this._fabMagicShimmer = source._fabMagicShimmer;
      this._fabMagicTintStrength = source._fabMagicTintStrength;
      this._fabMagicShimmerStrength = source._fabMagicShimmerStrength;
      this._fabMagicTailored = source._fabMagicTailored;
    }
    return this;
  }

  override customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|fab-cloth-highlights:${!!this.userData.preserveFabClothHighlights}`;
  }

  setShimmerStrength(nanometers: number): void {
    this._fabMagicShimmerStrength = nanometers;
  }

  setTintStrength(strength: number): void {
    this._fabMagicTintStrength = strength;
  }

  setTailored(tailored: boolean): void {
    this._fabMagicTailored = tailored;
  }

  buildMagicNodes(): void {
    const shimmer = materialReference('_fabMagicShimmer', 'float');
    const tintStrength = materialReference('_fabMagicTintStrength', 'float');
    const thickness = float(this.iridescenceThicknessNode ?? materialIridescenceThickness)
      .add(shimmer).max(1);
    const normal = this._fabMagicTailored ? normalViewGeometry : normalView;
    const facing = normal.dot(positionViewDirection).abs();
    const hue = facing.oneMinus().mul(4)
      .add(this._fabMagicTailored ? float(2.2) : thickness.mul(0.012))
      .add(shimmer.mul(0.045)).sin().mul(0.5).add(0.5);
    this.iridescenceThicknessNode = thickness;
    if (this._fabMagicTailored) {
      this.sheenNode = vec3(this.sheenNode ?? materialSheen)
        .mul(vec3(0.34, 0.92, 0.85).mix(vec3(0.86, 0.4, 1), hue));
    } else {
      const sourceColor = vec4(this.colorNode ?? materialColor);
      const vertexTint = this.vertexColors ? vertexColor() : vec4(1);
      const rgba = sourceColor.mul(vertexTint);
      const base = rgba.rgb;
      this.vertexColors = false;
      const tint = vec3(0.08, 0.75, 0.65).mix(vec3(0.6, 0.19, 0.88), hue);
      const equalLumaTint = tint.div(tint.dot(lumaWeights));
      this.colorNode = vec4(base.mix(equalLumaTint.mul(base.dot(lumaWeights)),
        tintStrength.mul(base.r.sub(base.b).smoothstep(0.025, 0.14).oneMinus())), rgba.a);
    }
  }

  override setupLightingModel(): PhysicalLightingModel {
    if (!this.userData.preserveFabClothHighlights) return super.setupLightingModel() as PhysicalLightingModel;
    return new FabClothLightingModel(this.useClearcoat, this.useSheen, this.useIridescence,
      this.useAnisotropy, this.useTransmission, this.useDispersion);
  }

  override onBeforeRender(): void {
    const now = performance.now();
    const seconds = sampleTime ?? now / 1000;
    const phase = fabMagicShimmerPhase(seconds);
    this._fabMagicShimmer = phase * this._fabMagicShimmerStrength;
    if (this.userData.magicSurface) {
      this.userData.magicSurface = { ...this.userData.magicSurface, phase, sampleTime: seconds };
      renderedSurfaces.delete(this.name);
      renderedSurfaces.set(this.name, {
        name: this.name,
        tier: this.userData.magicSurface.tier,
        role: this.userData.magicSurface.role,
        phase,
        sampleTime: seconds,
        iridescence: this.iridescence,
        detailChannel: this.iridescenceThicknessMap?.channel ?? null,
        lastRenderedMs: now,
      });
      if (renderedSurfaces.size > maxRecordedSurfaces) {
        renderedSurfaces.delete(renderedSurfaces.keys().next().value!);
      }
    }
  }
}

/** Adds an iridescent woven finish without replacing authored color or normal maps. */
export function applyFabMagicSurface(
  source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial,
  options: FabMagicSurfaceOptions,
): MeshPhysicalNodeMaterial {
  const material = new FabMagicMaterial();
  material.copy(ensureNodeMaterial(source));
  const richness = THREE.MathUtils.clamp((options.tier - 1) / 89, 0, 1);
  const trim = options.role === 'trim';
  const cloth = options.role === 'cloth';
  // Most reflected light remains diffuse so scales still read as dyed hide/weave.
  material.metalness = trim ? Math.min(source.metalness, 0.35) : 0;
  material.roughness = Math.max(source.roughness, cloth ? 0.66 : trim ? 0.42 : 0.6);
  material.iridescence = (trim ? 0.12 : 0.18) + richness * (trim ? 0.38 : 0.64);
  material.iridescenceIOR = 1.34;
  material.iridescenceThicknessRange = [300 - richness * 140, 370 + richness * 170];
  if (options.detailTexture) material.iridescenceThicknessMap = options.detailTexture;
  material.sheen = (cloth ? 0.24 : 0.12) + richness * 0.3;
  // The imported bronze sheen masks do not describe the new dyed fiber finish.
  material.sheenColorMap = null;
  material.sheenRoughnessMap = null;
  material.sheenColor.setHex(cloth ? 0x91c4de : 0xa59ed7);
  material.sheenRoughness = cloth ? 0.76 : 0.66;
  material.clearcoat = trim ? 0.09 : 0.025 + richness * 0.045;
  material.clearcoatRoughness = 0.65;
  material.setShimmerStrength(8 + richness * 28);
  material.setTintStrength(options.tier >= 90 && !trim ? 0.62
    : (trim ? 0.02 : 0.035) + richness * (trim ? 0.075 : 0.165));
  if (options.tailored) {
    material.setTailored(true);
    material.iridescenceThicknessMap = null;
    material.iridescenceMap = null;
    material.iridescence = cloth ? 0.35 + richness * 0.4 : 0.12 + richness * 0.18;
    material.iridescenceThicknessRange = [320, 395];
    material.setShimmerStrength(8 + richness * 12);
    material.setTintStrength(0);
    material.sheen = cloth ? 0.65 + richness * 0.25 : 0.12;
    material.sheenColor.setHex(0xe2e4ed);
    material.sheenRoughness = cloth ? 0.38 : 0.68;
    material.anisotropy = cloth ? 0.55 : 0;
    material.anisotropyRotation = Math.PI / 2;
    material.clearcoat = 0;
    material.clearcoatMap = null;
    material.clearcoatNormalMap = null;
    material.specularIntensity = cloth ? 0.65 : 0.35;
  }
  material.userData.magicSurface = { tier: options.tier, role: options.role, phase: 0, sampleTime: 0 };
  material.name = `${source.name}|magic:${options.role}:${options.tier}`;
  material.buildMagicNodes();
  material.needsUpdate = true;
  return material;
}
