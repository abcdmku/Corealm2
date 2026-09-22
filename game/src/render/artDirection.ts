import * as THREE from "three";
import { Fn, cameraViewMatrix, diffuseColor, faceDirection, float, vec3, vec4 } from "three/tsl";
import type { MeshStandardNodeMaterial } from "three/webgpu";
import { cloneNodeMaterial, composeSurface } from "./nodeMaterials.js";

export type ArtSurfaceRole = "foliage" | "bark" | "hide" | "elemental-hide";

/** Shared grass instance colours for the authored world and deterministic lab fixture. */
export const GRASS_COLOURS = { green: 0x7c8951, dry: 0xa39661 } as const;

interface OrganicTreatment {
  saturation: number;
  value: number;
  warmth: readonly [number, number, number];
  roughness: number;
  tonalCompression: boolean;
}

// These act on the combined linear albedo, including its texture and instance colour. Applying
// them to material.color alone would miss the highly saturated leaves baked into the source atlas.
const TREATMENTS: Readonly<Record<ArtSurfaceRole, OrganicTreatment>> = {
  foliage: { saturation: 0.72, value: 0.96, warmth: [1.025, 1, 0.955], roughness: 0.94, tonalCompression: false },
  bark: { saturation: 0.84, value: 0.96, warmth: [1.025, 1, 0.97], roughness: 0.92, tonalCompression: false },
  hide: { saturation: 0.91, value: 0.97, warmth: [1.012, 1, 0.986], roughness: 0.91, tonalCompression: true },
  "elemental-hide": { saturation: 0.70, value: 0.97, warmth: [1, 1, 1], roughness: 0.95, tonalCompression: false },
};

const ART_MARKER = "corealmArtSurface";
const ELEMENTAL_EMISSION_SCALE = 0.22;
const ELEMENTAL_HIGHLIGHT_SHOULDER = 0.60;
const UNDERSTORY_HIGHLIGHT_SHOULDER = 0.42;
// This rotates a horizontal leaf normal up by about 14 degrees. It changes lighting only;
// the geometry, normal maps, wind, shadow casters and shadow-map lookup remain untouched.
const LEAF_UPWARD_NORMAL_BIAS = 0.25;

/** Known source families only. Flowers, eyes, mushrooms, and painted architecture keep their art. */
export function artSurfaceRoleForMaterial(materialName: string): ArtSurfaceRole | null {
  const sourceName = materialName.split("@", 1)[0]!;
  if (/^(?:Leaves(?:_|$)|Grass$|grass-sprite$|MI_Vine$)/i.test(sourceName)) return "foliage";
  if (/^Bark(?:_|$)/i.test(sourceName)) return "bark";
  if (/^boss_rhino_.+_mat$/i.test(sourceName)) return "elemental-hide";
  if (/^(?:animal|boss)_.+_mat$/i.test(sourceName)) return "hide";
  return null;
}

/**
 * Derives one organic material without changing the source or its textures. The caller owns caching
 * by source identity and role, and disposal. Shader grading preserves alpha and emissive maps.
 * Elemental rhinos reduce their authored emission while their dark body gains reflected stone colour.
 * Apply once, then add wind to the result so both paths keep the same graded surface.
 *
 * Hide uses mild tonal compression, not spatial texture filtering. Species markings retain their
 * boundaries, and a truly black texel stays black. This adds arithmetic but no texture samples.
 */
export function createArtDirectedMaterial(source: THREE.Material, role: ArtSurfaceRole): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!(standard.isMeshStandardMaterial || (source as MeshStandardNodeMaterial).isMeshStandardNodeMaterial)
    || source.userData[ART_MARKER] === role) return source;

  const derived = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
  const sourceName = source.name.split("@", 1)[0]!;
  const understory = role === "foliage" && /^Leaves$/i.test(sourceName);
  const cutout = role === "foliage" && /_(needle|broadleaf_oak|broadleaf_yew|broadleaf_maple)_cutout$/.test(sourceName);
  const branchSpray = role === "foliage" && sourceName.endsWith("_cutout");
  const leafNormals = role === "foliage" && !/^(?:Grass|grass-sprite)$/i.test(sourceName);
  const treatment = cutout ? { ...TREATMENTS[role], saturation: 1, value: 1, warmth: [1, 1.04, 1] as const } : TREATMENTS[role];
  derived.name = `${source.name || source.type}@art:${role}`;
  derived.userData[ART_MARKER] = role;
  derived.roughness = Math.max(standard.roughness, treatment.roughness);
  derived.metalness = 0;
  if (role === "elemental-hide") {
    derived.emissiveIntensity = standard.emissiveIntensity * ELEMENTAL_EMISSION_SCALE;
  }
  composeSurface(derived, {
    // This node runs after the renderer combines texture, vertex and instance colours.
    // A colorNode treatment would grade only the texture before those authored colours.
    roughness: previous => Fn(() => {
      const luma = diffuseColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722)).toVar();
      const colour = vec3(luma).mix(diffuseColor.rgb, treatment.saturation).toVar();
      if (treatment.tonalCompression) colour.divAssign(luma.mul(0.2).add(0.9));
      if (understory) colour.divAssign(luma.mul(UNDERSTORY_HIGHLIGHT_SHOULDER).add(1));
      if (role === "elemental-hide") {
        colour.divAssign(luma.mul(ELEMENTAL_HIGHLIGHT_SHOULDER).add(1));
        colour.addAssign(vec3(0.044, 0.040, 0.034).mul(luma.smoothstep(0.012, 0.120).oneMinus()));
      }
      diffuseColor.rgb.assign(colour.mul(vec3(...treatment.warmth)).mul(treatment.value));
      return previous;
    })(),
    normal: previous => {
      if (!leafNormals) return previous;
      const worldUp = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
      let normal = previous;
      if (branchSpray) {
        if (derived.side === THREE.DoubleSide) normal = normal.mul(faceDirection);
        normal = normal.mul(normal.dot(worldUp).lessThan(0).select(float(-1), float(1)));
      }
      return normal.add(worldUp.mul(branchSpray ? 2 : LEAF_UPWARD_NORMAL_BIAS)).normalize();
    },
  });
  return derived;
}
