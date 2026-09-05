import * as THREE from "three";

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
const FRAGMENT_ANCHOR = "#include <roughnessmap_fragment>";
const LIGHTING_ANCHOR = "#include <lights_physical_fragment>";
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

function fragmentTreatment(role: ArtSurfaceRole, understory: boolean): string {
  const treatment = TREATMENTS[role];
  const warmth = treatment.warmth.map((channel) => channel.toFixed(3)).join(", ");
  return `
// Corealm organic surface: ${role}. Uses the existing sampled albedo, never another texture read.
{
  float organicLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 organicColour = mix( vec3( organicLuma ), diffuseColor.rgb, ${treatment.saturation.toFixed(3)} );
  ${treatment.tonalCompression
    ? "// Compress bright fur against dark markings without lifting black into a grey floor.\n  organicColour /= 0.90 + 0.20 * organicLuma;"
    : ""}
  ${understory
    ? `// The shared Leaves atlas is brighter than the separately authored tree crowns.
  organicColour /= 1.0 + ${UNDERSTORY_HIGHLIGHT_SHOULDER.toFixed(3)} * organicLuma;`
    : ""}
  ${role === "elemental-hide"
    ? `// Compress the bright plate albedo while retaining each element's hue and texture boundaries.
  organicColour /= 1.0 + ${ELEMENTAL_HIGHLIGHT_SHOULDER.toFixed(3)} * organicLuma;
  // Add warm reflected stone albedo only in the near-black body, never an emissive fill.
  float organicStoneLift = 1.0 - smoothstep( 0.012, 0.120, organicLuma );
  organicColour += vec3( 0.044, 0.040, 0.034 ) * organicStoneLift;`
    : ""}
  diffuseColor.rgb = organicColour * vec3( ${warmth} ) * ${treatment.value.toFixed(3)};
}
`;
}

const LEAF_NORMAL_TREATMENT = `
// Soften the lighting contrast between flat foliage cards without changing their shadows.
{
  vec3 organicWorldUp = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
  normal = normalize( normal + organicWorldUp * ${LEAF_UPWARD_NORMAL_BIAS.toFixed(3)} );
}
`;

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
  if (!standard.isMeshStandardMaterial || source.userData[ART_MARKER] === role) return source;

  const derived = standard.clone();
  const treatment = TREATMENTS[role];
  const sourceName = source.name.split("@", 1)[0]!;
  const understory = role === "foliage" && /^Leaves$/i.test(sourceName);
  const leafNormals = role === "foliage" && !/^(?:Grass|grass-sprite)$/i.test(sourceName);
  const inheritedCompile = source.onBeforeCompile;
  const inheritedProgramKey = source.customProgramCacheKey.bind(source);
  derived.name = `${source.name || source.type}@art:${role}`;
  derived.userData[ART_MARKER] = role;
  derived.roughness = Math.max(standard.roughness, treatment.roughness);
  derived.metalness = 0;
  if (role === "elemental-hide") {
    derived.emissiveIntensity = standard.emissiveIntensity * ELEMENTAL_EMISSION_SCALE;
  }
  derived.onBeforeCompile = (shader, renderer) => {
    inheritedCompile.call(source, shader, renderer);
    // This sits after the source's map, vertex-colour and alpha hooks, but before PBR lighting.
    // Fail explicitly if another material extension removes the standard shader's insertion point.
    if (!shader.fragmentShader.includes(FRAGMENT_ANCHOR)) {
      throw new Error(`Organic art treatment has no albedo insertion point: ${source.name || source.type}`);
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAGMENT_ANCHOR,
      `${fragmentTreatment(role, understory)}\n${FRAGMENT_ANCHOR}`,
    );
    if (leafNormals) {
      if (!shader.fragmentShader.includes(LIGHTING_ANCHOR)) {
        throw new Error(`Organic art treatment has no lighting insertion point: ${source.name || source.type}`);
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        LIGHTING_ANCHOR,
        `${LEAF_NORMAL_TREATMENT}\n${LIGHTING_ANCHOR}`,
      );
    }
  };
  derived.customProgramCacheKey = () => `${inheritedProgramKey()}|corealm-organic-v3:${role}:${Number(understory)}:${Number(leafNormals)}`;
  return derived;
}
