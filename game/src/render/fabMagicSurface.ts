import * as THREE from 'three';

/** Keep embroidered color visible in grazing daylight highlights. */
export function preserveFabClothHighlights(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
    vec3 mageReflection = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
    #ifdef USE_SHEEN
      mageReflection += sheenSpecularDirect + sheenSpecularIndirect;
    #endif
    float mageReflectionLuma = dot(mageReflection, vec3(0.2126, 0.7152, 0.0722));
    float mageHighlightLimit = 0.035 + 0.8 * dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse,
      vec3(0.2126, 0.7152, 0.0722));
    float mageHighlightScale = mageHighlightLimit / (mageHighlightLimit + mageReflectionLuma);
    reflectedLight.directSpecular *= mageHighlightScale;
    reflectedLight.indirectSpecular *= mageHighlightScale;
    #ifdef USE_SHEEN
      sheenSpecularDirect *= mageHighlightScale;
      sheenSpecularIndirect *= mageHighlightScale;
    #endif
  `);
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

// Material.clone() invokes the constructor and copy(). Keeping the hooks on the
// prototype preserves the effect when equipment tinting clones a material.
class FabMagicMaterial extends THREE.MeshPhysicalMaterial {
  private readonly shimmer = { value: 0 };
  private readonly tintStrength = { value: 0.03 };
  private shimmerStrength = 10;
  private tailored = false;
  private authoredCompile?: THREE.Material['onBeforeCompile'];
  private authoredKey?: () => string;

  override copy(source: THREE.MeshPhysicalMaterial): this {
    super.copy(source);
    if (source instanceof FabMagicMaterial) {
      this.shimmerStrength = source.shimmerStrength;
      this.tailored = source.tailored;
      this.tintStrength.value = source.tintStrength.value;
      this.authoredCompile = source.authoredCompile;
      this.authoredKey = source.authoredKey;
    }
    return this;
  }

  setShimmerStrength(nanometers: number): void {
    this.shimmerStrength = nanometers;
  }

  setTintStrength(strength: number): void {
    this.tintStrength.value = strength;
  }

  setTailored(tailored: boolean): void {
    this.tailored = tailored;
  }

  inheritSource(source: THREE.MeshStandardMaterial): void {
    if (source instanceof FabMagicMaterial) {
      this.authoredCompile = source.authoredCompile;
      this.authoredKey = source.authoredKey;
    } else {
      this.authoredCompile = source.onBeforeCompile.bind(source);
      this.authoredKey = source.customProgramCacheKey.bind(source);
    }
  }

  override onBeforeRender(): void {
    const now = performance.now();
    const seconds = sampleTime ?? now / 1000;
    const phase = fabMagicShimmerPhase(seconds);
    this.shimmer.value = phase * this.shimmerStrength;
    if (this.userData.magicSurface) {
      this.userData.magicSurface.phase = phase;
      this.userData.magicSurface.sampleTime = seconds;
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

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer): void {
    this.authoredCompile?.(shader, renderer);
    shader.uniforms.fabMagicShimmer = this.shimmer;
    shader.uniforms.fabMagicTintStrength = this.tintStrength;
    shader.fragmentShader = `uniform float fabMagicShimmer;\nuniform float fabMagicTintStrength;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>
      #ifdef USE_IRIDESCENCE
        material.iridescenceThickness = max(1.0, material.iridescenceThickness + fabMagicShimmer);
        // Dyed interference fibers remain visible under broad daylight, where
        // the physical specular lobe alone is faint on rough cloth.
        float magicFacing = abs(dot(${this.tailored ? 'nonPerturbedNormal' : 'normal'}, normalize(vViewPosition)));
        float magicHue = 0.5 + 0.5 * sin((1.0 - magicFacing) * 4.0
          + ${this.tailored ? '2.2' : 'material.iridescenceThickness * 0.012'} + fabMagicShimmer * 0.045);
        vec3 magicTint = mix(vec3(0.08, 0.75, 0.65), vec3(0.60, 0.19, 0.88), magicHue);
        // Equal luminance at every phase avoids a breathing brightness pulse.
        vec3 magicLumaWeights = vec3(0.2126, 0.7152, 0.0722);
        magicTint /= dot(magicTint, magicLumaWeights);
        float magicLuma = dot(diffuseColor.rgb, magicLumaWeights);
        ${this.tailored ? `
        // Iridescent fibers color reflected light only. The embroidered base
        // stays stable in shadow, while turning toward the light reveals silk.
        #ifdef USE_SHEEN
          material.sheenColor *= mix(vec3(0.34, 0.92, 0.85), vec3(0.86, 0.40, 1.0), magicHue);
        #endif
        ` : `material.diffuseColor = mix(diffuseColor.rgb,
          magicTint * magicLuma, fabMagicTintStrength
            * (1.0 - smoothstep(0.025, 0.14, diffuseColor.r - diffuseColor.b)));
        material.diffuseContribution = material.diffuseColor * (1.0 - metalnessFactor);`}
      #endif`,
    );
  }

  override customProgramCacheKey(): string {
    return `${this.authoredKey?.() ?? ''}|fab-magic-surface-v6:${this.tailored}`;
  }
}

/** Adds an iridescent woven finish without replacing authored color or normal maps. */
export function applyFabMagicSurface(
  source: THREE.MeshStandardMaterial,
  options: FabMagicSurfaceOptions,
): THREE.MeshPhysicalMaterial {
  const material = new FabMagicMaterial();
  if (source instanceof THREE.MeshPhysicalMaterial) material.copy(source);
  else {
    // MeshPhysicalMaterial.copy expects physical-only Color/Vector fields.
    THREE.MeshStandardMaterial.prototype.copy.call(material, source);
    material.defines = { STANDARD: '', PHYSICAL: '' };
  }
  material.inheritSource(source);
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
  material.needsUpdate = true;
  return material;
}
