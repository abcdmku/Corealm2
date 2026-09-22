import * as THREE from "three";
import type { MeshStandardNodeMaterial, Node } from "three/webgpu";
import { diffuseColor, float, fwidth, materialAlphaTest, materialReference, normalMap, texture, uv, vec2, vec3, vec4 } from "three/tsl";
import { cloneNodeMaterial, composeSurface } from "./nodeMaterials.js";
import { assetBaseUrl } from "../app/config.js";
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
export function loadCorealmSurfaceTextures(baseUrl = `${assetBaseUrl()}textures/corealm/`): Promise<CorealmSurfaceTextures> {
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

/** Shared measured-mean normalization for UV and world-projected authored surfaces. */
export function corealmSurfaceDetail(
  sample: Node<"vec3">,
  meanLinearRgb: readonly [number, number, number],
  contrast: number,
  leaf = false,
): Node<"vec3"> {
  const relative = sample.div(vec3(...meanLinearRgb));
  const luma = relative.dot(vec3(0.2126, 0.7152, 0.0722));
  const colour = vec3(luma).mix(relative, 0.45);
  return vec3(1).mix(colour, contrast).clamp(leaf ? 0.58 : 0.42, leaf ? 1.65 : 1.90);
}

function isStandard(material: THREE.Material): boolean {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
    || (material as MeshStandardNodeMaterial).isMeshStandardNodeMaterial === true;
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
      && isStandard(source) && (source as THREE.MeshStandardMaterial).map) {
      const existing = cache.get(source);
      if (existing) return existing;
      const derived = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
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
    if (name?.endsWith("_cutout") && isStandard(source)) {
      const existing = cache.get(source);
      if (existing) return existing;
      const derived = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
      if (derived.map) derived.map = prepareLeafTexture(derived.map);
      const associatedColour = derived.map?.userData.leafAssociatedColour === true;
      derived.alphaToCoverage = true;
      derived.userData[SURFACE_MARKER] = "leaf-cutout";
      if (associatedColour && derived.map) {
        const leafSample = texture(derived.map);
        const colourSample = texture(derived.map).bias(float(1));
        // Associated-alpha filtering prevents dark fringes. Colour uses one wider mip
        // while coverage retains the authored footprint and canopy silhouette.
        derived.colorNode = vec4(
          materialReference("color", "color").mul(colourSample.rgb.div(colourSample.a.max(0.0001))),
          leafSample.a,
        );
      }
      // Three's alpha-to-coverage range normally begins at the cutoff. Centre it on
      // that cutoff instead, retaining fine needles when their footprint shrinks.
      const edgeWidth = fwidth(diffuseColor.a).max(0.0001);
      derived.alphaTestNode = materialAlphaTest.sub(edgeWidth.mul(0.5));
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
    if (!isStandard(source)) return source;
    const existing = cache.get(source);
    if (existing) return existing;

    const standard = source as THREE.MeshStandardMaterial;
    const derived = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
    const family = bark ? "bark" : leaf ? "leaf" : "stone";
    const maps = textures[family];
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
    const surfaceUv = blade ? vec2(uv().x.sub(0.5).mul(0.22).add(0.5), uv().y) : undefined;
    const sample = texture(maps.albedo, surfaceUv);
    // UV compression selects the same registered midrib in albedo, normal and roughness.
    // Uncompressed textures retain their authored texture matrix and metre-based tiling.
    derived.colorNode = vec4(
        materialReference("color", "color").mul(corealmSurfaceDetail(sample.rgb, maps.meanLinearRgb, contrast, leaf)),
        sample.a,
    );
    composeSurface(derived, {
      ...(blade ? {
        normal: () => normalMap(texture(maps.normal, surfaceUv), materialReference("normalScale", "vec2")),
        roughness: () => materialReference("roughness", "float").mul(texture(maps.roughness, surfaceUv).g),
      } : {}),
    });
    cache.set(source, derived);
    return derived;
  };

  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
  });
}
