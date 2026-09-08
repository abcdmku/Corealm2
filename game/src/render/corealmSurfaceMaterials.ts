import * as THREE from "three";
import { ASSET_BASE_URL } from "../app/config.js";
import { prepareLeafTexture } from "./leafTexture.js";

interface CorealmSurfaceMapSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  meanLinearRgb: readonly [number, number, number];
  tileMetres: number;
}

export interface CorealmSurfaceTextures {
  bark: CorealmSurfaceMapSet;
  stone: CorealmSurfaceMapSet;
  leaf: CorealmSurfaceMapSet;
}

type SurfaceFamily = keyof CorealmSurfaceTextures;
interface SurfaceManifest {
  version: number;
  surfaces: Record<SurfaceFamily, {
    meanLinearRgb: [number, number, number];
    tileMetres: number;
  }>;
}

const textureLoads = new Map<string, Promise<CorealmSurfaceTextures>>();
const materialCaches = new WeakMap<CorealmSurfaceTextures, WeakMap<THREE.Material, THREE.Material>>();
const SURFACE_MARKER = "corealmAuthoredSurface";

/** Shared authored albedo and registered PBR maps; no image processing runs during game loading. */
export function loadCorealmSurfaceTextures(baseUrl = `${ASSET_BASE_URL}textures/corealm/`): Promise<CorealmSurfaceTextures> {
  const directory = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const cached = textureLoads.get(directory);
  if (cached) return cached;

  const loader = new THREE.TextureLoader();
  const pending = (async () => {
    const families = ["bark", "stone", "leaf"] as const;
    const results = await Promise.allSettled([
      fetch(`${directory}corealm-surfaces.json`).then(async response => {
        if (!response.ok) throw new Error(`Corealm surface metadata failed: ${response.status}`);
        return await response.json() as SurfaceManifest;
      }),
      ...families.flatMap(family => ["", "-normal", "-roughness"].map(suffix =>
        loader.loadAsync(`${directory}corealm-${family}${suffix}.png`))),
    ]);
    const failure = results.find(result => result.status === "rejected");
    if (failure) {
      for (const result of results) {
        if (result.status === "fulfilled" && result.value instanceof THREE.Texture) result.value.dispose();
      }
      throw new Error("Corealm surface texture loading failed", { cause: failure.reason });
    }
    const values = results.map(result => (result as PromiseFulfilledResult<THREE.Texture | SurfaceManifest>).value);
    const manifest = values[0] as SurfaceManifest;
    const surfaces = {} as CorealmSurfaceTextures;
    for (let i = 0; i < families.length; i++) {
      const family = families[i]!;
      const profile = manifest.surfaces[family];
      const [albedo, normal, roughness] = values.slice(1 + i * 3, 4 + i * 3) as THREE.Texture[];
      for (const texture of [albedo!, normal!, roughness!]) {
        texture.colorSpace = texture === albedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = family === "leaf" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.repeat.setScalar(family === "leaf" ? 1 : 1 / profile.tileMetres);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy = 8;
        texture.flipY = false;
        texture.needsUpdate = true;
      }
      albedo!.name = `Corealm ${family} albedo`;
      normal!.name = `Corealm ${family} normal`;
      roughness!.name = `Corealm ${family} roughness`;
      surfaces[family] = { albedo: albedo!, normal: normal!, roughness: roughness!, ...profile };
    }
    return surfaces;
  })().catch(error => {
    textureLoads.delete(directory);
    throw error;
  });
  textureLoads.set(directory, pending);
  return pending;
}

/**
 * Apply before caching the loaded GLB. Geometry and source materials remain unchanged, and
 * subsequent Object3D clones reuse these materials and their PBR maps.
 */
export function applyCorealmSurfaceMaterials(root: THREE.Object3D, textures: CorealmSurfaceTextures): void {
  let cache = materialCaches.get(textures);
  if (!cache) {
    cache = new WeakMap();
    materialCaches.set(textures, cache);
  }

  const apply = (source: THREE.Material): THREE.Material => {
    if (source.userData[SURFACE_MARKER]) return source;
    const name = source.name.split("@", 1)[0];
    // Botanical GLBs carry their own bark scan in metre-based UVs. Do not replace it
    // with the legacy mean-normalized surface, which would wash out their albedo.
    if (name === "Bark_Corealm" && source.userData.corealmBarkRelief
      && (source as THREE.MeshStandardMaterial).isMeshStandardMaterial && (source as THREE.MeshStandardMaterial).map) {
      const existing = cache.get(source);
      if (existing) return existing;
      const derived = (source as THREE.MeshStandardMaterial).clone();
      derived.bumpMap = derived.map;
      derived.bumpScale = .035;
      derived.roughness = .94;
      derived.map!.anisotropy = 8;
      derived.map!.needsUpdate = true;
      derived.userData[SURFACE_MARKER] = "botanical-bark";
      cache.set(source, derived);
      return derived;
    }
    // Keep the embedded species texture and UVs. Alpha-to-coverage uses the existing MSAA
    // samples to soften leaf edges without sorting transparent cards or adding geometry.
    if (name?.endsWith("_cutout") && (source as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const existing = cache.get(source);
      if (existing) return existing;
      const derived = (source as THREE.MeshStandardMaterial).clone();
      if (derived.map) derived.map = prepareLeafTexture(derived.map);
      const associatedColour = derived.map?.userData.leafAssociatedColour === true;
      derived.alphaToCoverage = true;
      derived.userData[SURFACE_MARKER] = "leaf-cutout";
      const inheritedCompile = source.onBeforeCompile;
      const inheritedProgramKey = source.customProgramCacheKey.bind(source);
      derived.onBeforeCompile = (shader, renderer) => {
        inheritedCompile.call(source, shader, renderer);
        if (associatedColour) {
          // Filter associated RGB and alpha together, then recover the leaf's colour. Empty
          // texels cannot turn green leaves black as their footprint moves between mip levels.
          shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  vec4 leafSample = texture2D( map, vMapUv );
  // Shade fine leaf colour from a slightly wider footprint. Coverage keeps the original
  // footprint so this cannot erase leaves or change the canopy silhouette.
  vec4 leafColourSample = texture2D( map, vMapUv, 1.0 );
  leafSample.rgb = leafColourSample.rgb / max( leafColourSample.a, 0.0001 );
  diffuseColor *= leafSample;
#endif`);
        }
        // Centre the one-pixel coverage ramp on the authored cutoff. Three's one-sided
        // ramp erodes tiny needles as their texture footprint grows at distance.
        shader.fragmentShader = shader.fragmentShader.replace("#include <alphatest_fragment>", `
#if defined( USE_ALPHATEST ) && defined( ALPHA_TO_COVERAGE )
  float leafEdgeWidth = max( fwidth( diffuseColor.a ), 0.0001 );
  diffuseColor.a = smoothstep( alphaTest - 0.5 * leafEdgeWidth, alphaTest + 0.5 * leafEdgeWidth, diffuseColor.a );
  if ( diffuseColor.a == 0.0 ) discard;
#else
  #include <alphatest_fragment>
#endif`);
      };
      derived.customProgramCacheKey = () => `${inheritedProgramKey()}|corealm-leaf-coverage-v4:${Number(associatedColour)}`;
      if (derived.map) {
        const changed = derived.map.minFilter !== THREE.LinearMipmapLinearFilter || derived.map.magFilter !== THREE.LinearFilter
          || !derived.map.generateMipmaps || derived.map.anisotropy !== 8;
        derived.map.minFilter = THREE.LinearMipmapLinearFilter;
        derived.map.magFilter = THREE.LinearFilter;
        derived.map.generateMipmaps = true;
        derived.map.anisotropy = 8;
        if (changed) derived.map.needsUpdate = true;
      }
      cache.set(source, derived);
      return derived;
    }
    const bark = name === "Bark_Corealm";
    const mineral = name === "Corealm mineral seam";
    const leaf = /^Leaves_Corealm(?:_|$)/.test(name ?? "");
    if (!bark && !mineral && !leaf && name !== "Corealm weathered strata") return source;
    if (!(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return source;
    const existing = cache.get(source);
    if (existing) return existing;

    const standard = source as THREE.MeshStandardMaterial;
    const derived = standard.clone();
    const inheritedCompile = source.onBeforeCompile;
    const inheritedProgramKey = source.customProgramCacheKey.bind(source);
    const family = bark ? "bark" : leaf ? "leaf" : "stone";
    const maps = textures[family];
    const meanRgbKey = maps.meanLinearRgb.map(value => value.toFixed(6)).join(", ");
    const blade = name === "Leaves_Corealm_needle" || name === "Leaves_Corealm_grass";
    const role = mineral ? "mineral" : blade ? "blade" : family;
    const contrast = mineral ? 0.34 : blade ? 0.46 : bark ? 0.80 : leaf ? 0.72 : 0.86;
    derived.map = maps.albedo;
    derived.normalMap = maps.normal;
    derived.normalMapType = THREE.TangentSpaceNormalMap;
    derived.normalScale.setScalar(mineral ? 0.20 : blade ? 0.22 : bark ? 0.72 : leaf ? 0.36 : 0.65);
    derived.roughnessMap = maps.roughness;
    // The registered map supplies surface roughness. Mineral faces have a narrower specular
    // lobe than their host while ordinary stone seams retain a mostly diffuse response.
    derived.roughness = mineral ? (standard.metalness >= 0.15 ? 0.58 : 0.86) : 1;
    derived.metalness = mineral ? standard.metalness : 0;
    derived.flatShading = false;
    derived.userData[SURFACE_MARKER] = role;
    derived.onBeforeCompile = (shader, renderer) => {
      inheritedCompile.call(source, shader, renderer);
      if (blade) {
        // Needle and grass meshes share the registered midrib region, rather than stretching
        // a whole broadleaf's branching vein network over a narrow blade. All maps stay aligned.
        shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `
#include <uv_vertex>
#ifdef USE_MAP
  vMapUv.x = 0.5 + ( vMapUv.x - 0.5 ) * 0.22;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv.x = 0.5 + ( vNormalMapUv.x - 0.5 ) * 0.22;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv.x = 0.5 + ( vRoughnessMapUv.x - 0.5 ) * 0.22;
#endif
`);
      }
      if (!shader.fragmentShader.includes("#include <map_fragment>")) {
        throw new Error(`Corealm surface has no map insertion point: ${source.name}`);
      }
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
#ifdef USE_MAP
  // Normalize against the source map's measured mean RGB before modulation. Region/species
  // vertex colors remain the palette while cracks, pigment changes and veins retain their color.
  vec3 corealmSurfaceSample = texture2D( map, vMapUv ).rgb;
  vec3 corealmSurfaceRelative = corealmSurfaceSample / vec3( ${meanRgbKey} );
  float corealmSurfaceLuma = dot( corealmSurfaceRelative, vec3( 0.2126, 0.7152, 0.0722 ) );
  corealmSurfaceRelative = mix( vec3( corealmSurfaceLuma ), corealmSurfaceRelative, 0.45 );
  vec3 corealmSurfaceDetail = clamp(
    mix( vec3( 1.0 ), corealmSurfaceRelative, ${contrast.toFixed(2)} ),
    vec3( ${leaf ? "0.58" : "0.42"} ), vec3( ${leaf ? "1.65" : "1.90"} )
  );
  diffuseColor.rgb *= corealmSurfaceDetail;
#endif
`);
    };
    derived.customProgramCacheKey = () => `${inheritedProgramKey()}|corealm-authored-surface-v2:${role}:${meanRgbKey}`;
    cache.set(source, derived);
    return derived;
  };

  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
  });
}
