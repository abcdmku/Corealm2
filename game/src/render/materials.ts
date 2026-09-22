/**
 * Corealm's material system.
 *
 * Rich stylized natural surfaces: botanical silhouettes, weathered bark and rock, readable
 * material transitions, and restrained regional palettes. Authored normal and roughness maps
 * provide surface response while the meshes carry curvature, fractures, and large forms.
 *
 * Tier variants are deliberately colour/roughness swaps over a SHARED base texture rather than
 * distinct textures. That is what keeps `InstancedMesh` batching intact — distinct textures would
 * fragment instancing across tiers x families x regions and blow the 400-draw-call budget
 * (runs/corealm/architecture.md, correction R6).
 *
 * The one rule every method in here obeys: identical inputs return the IDENTICAL material instance.
 * A cache miss that clones a material silently doubles a draw call somewhere downstream.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import { Fn, attribute, cameraViewMatrix, diffuseColor, float, ivec2,
  max, min, mix, pmremTexture, positionGeometry, reference, sin, smoothstep,
  texture, textureLoad, vec2, vec3, vec4,
  positionWorld, If } from "three/tsl";
import { cloneNodeMaterial, composeSurface, ensureNodeMaterial, sourceMaterialReference } from "./nodeMaterials.js";
import { applyGroundSurfaceNodes } from "./groundSurfaceNodes.js";
import { objectInstanceMatrix, objectInstanceWorldOrigin } from "./objectTransformNodes.js";
import { createContainedTroughWater } from "./containedTroughWater.js";
import { createMagicTreeShimmer } from "./magicTreeShimmer.js";
import { createCastleStoneMaterial, type CastleStoneStyle } from './castleStoneMaterial.js';
import type { RegionId } from "../contracts.js";
import { FAIRY_FOLIAGE_COLOURS, fairyFoliageStyle } from "../content/fairyFoliage.js";
import { oceanDepthGridBounds, type OceanDepthGrid } from "../world/coastDepth.js";
import { createArtDirectedMaterial, type ArtSurfaceRole } from "./artDirection.js";
import { createFoliageOcclusionMaterial, FoliageOcclusion } from "./foliageOcclusion.js";
import type { FairyGroundSurface } from './fairyGroundSurface.js';
import type { CorealmSurfaceTextures } from "./corealmSurfaceMaterials.js";
import {
  DETAIL_TILING_METRES,
    createDetailAtlas,
  createDetailNormals,
  createGrassSpriteTexture,
  createMacroVariation,
  createWaterNormalMap,
  disposeGeneratedTextures,
} from "./proceduralTextures.js";

/** Shared with CPU scatter bounds so wind never escapes a culled tile. */
export const GRASS_WIND_STRENGTH = 0.085;

/**
 * How much of `scene.environment` the terrain takes, against the scene default in renderer.ts.
 *
 * 0.75, and this is the one place a per-class IBL value is a look decision rather than physics. The
 * terrain is the largest surface in every frame, its albedo is the only strongly saturated albedo
 * in the palette (fallowmarch groundLow is #76854f), and a green albedo under a blue fill is
 * exactly how you make mint: shaded ground measured (138,158,130) against a lit (154,168,135) in
 * `wire-bank.png`, i.e. green and cyan with no value separation at all. Taking a quarter off the
 * ground's share of the sky lets the sun's own colour decide the hue of grass.
 */
const GROUND_ENV_RESPONSE = 0.75;

/**
 * How much of `scene.environment` standing water takes.
 *
 * 2.0, which is the only value in this file ABOVE 1, and it is not a fudge: the scene default is
 * deliberately well under 1 so that rough diffuse surfaces stop being washed out, and a
 * roughness-0.14 surface whose entire read is the sky it reflects has the opposite requirement.
 * 2.0 x the scene's 0.50 puts the water back at a full-strength sky reflection while every other
 * material keeps the reduced fill.
 */
const WATER_ENV_RESPONSE = 2.0;

export interface TierPalette {
  tier: number;
  name: string;
  /** Ore/metal accent. */
  metal: number;
  /** Rock or bark body colour. */
  body: number;
  /** Foliage or cloth accent. */
  accent: number;
  /** Emissive strength for high tiers. Zero through tier 10. */
  emissive: number;
}

/**
 * Tier palettes for the full 1-99 range. Phase 1 authors content for 1, 5, and 10 only, but the
 * table is complete so later phases add content without touching this file.
 */
export const TIER_PALETTES: Record<number, TierPalette> = {
  1: { tier: 1, name: "Grithe", metal: 0xb07a4a, body: 0x8d8579, accent: 0x7d8b5c, emissive: 0 },
  5: { tier: 5, name: "Corven", metal: 0x9aa4ad, body: 0x6f7a80, accent: 0x5f7f56, emissive: 0 },
  10: { tier: 10, name: "Kaldite", metal: 0x5f7f9e, body: 0x585f6b, accent: 0x4d6b78, emissive: 0 },
  20: { tier: 20, name: "Emberdrift", metal: 0xc2673a, body: 0x6b4a3d, accent: 0xa8533a, emissive: 0.05 },
  30: { tier: 30, name: "Mirevein", metal: 0x6d8f5a, body: 0x4e5b47, accent: 0x86a05e, emissive: 0.05 },
  40: { tier: 40, name: "Rimeshard", metal: 0xa9cfe0, body: 0x7f93a1, accent: 0xd2e8f2, emissive: 0.1 },
  50: { tier: 50, name: "Sunderglass", metal: 0xd9b168, body: 0xa08a5e, accent: 0xe6cd94, emissive: 0.1 },
  60: { tier: 60, name: "Galestone", metal: 0x7f9fc4, body: 0x5b6a7d, accent: 0xa8c4de, emissive: 0.15 },
  70: { tier: 70, name: "Blightiron", metal: 0x6b5f7a, body: 0x453f52, accent: 0x8a6f9e, emissive: 0.2 },
  80: { tier: 80, name: "Ashvarr", metal: 0xd0552f, body: 0x3a2b28, accent: 0xff8a45, emissive: 0.45 },
  90: { tier: 90, name: "Aetherfall", metal: 0x9d7fe0, body: 0x453a6b, accent: 0xc4a8ff, emissive: 0.6 },
  99: { tier: 99, name: "Corestone", metal: 0xf0e6c0, body: 0x2e2a3d, accent: 0xffd98a, emissive: 0.9 },
};

const AUTHORED_TIERS: readonly number[] = Object.keys(TIER_PALETTES)
  .map(Number)
  .sort((a, b) => a - b);

/** Nearest authored palette at or below the tier. */
export function paletteForTier(tier: number): TierPalette {
  let chosen = AUTHORED_TIERS[0]!;
  for (const candidate of AUTHORED_TIERS) if (tier >= candidate) chosen = candidate;
  return TIER_PALETTES[chosen]!;
}

/**
 * The tier silhouette rule now lives in `core/math.ts` and is re-exported here.
 *
 * It moved because `world/regionBuilder.ts` has to cancel it exactly (a 2 m wall module drawn at
 * 1.84 m would not meet its own grid), and importing it from this file pulled `import * as THREE`
 * into the world layer transitively, which the layering rule forbids. The formula and its
 * derivation are documented at the new site.
 */
export { tierSilhouetteScale } from "../core/math.js";

/**
 * A locked eight-swatch palette per region (PRD section 4, "Visual system"). Region ground
 * treatment blends `groundLow` -> `groundHigh` by altitude and slope, so one shared vertex-coloured
 * terrain material covers the whole world without a texture per region.
 */
export interface RegionPalette {
  id: RegionId;
  name: string;
  /** Low ground: valley floor, damp soil. */
  groundLow: number;
  /** High ground: exposed crest, dry grass. */
  groundHigh: number;
  /** Bare earth and worn track. */
  soil: number;
  /** Exposed stone on steep faces. */
  rock: number;
  /** Canopy / shrub. */
  foliage: number;
  /** Trunk and structural timber. */
  timber: number;
  /** Standing water. */
  water: number;
  /** The single warm accent that identifies the region at distance. */
  accent: number;
}

export const REGION_PALETTES: Record<RegionId, RegionPalette> = {
  crownward: {
    id: "crownward", name: "Crownward",
    groundLow: 0x687d54, groundHigh: 0xa3ad78, soil: 0x8b8166, rock: 0xaab2ae,
    foliage: 0x719061, timber: 0x756855, water: 0x5b8890, accent: 0xd9cba5,
  },
  gloamgarden: {
    id: "gloamgarden", name: "Gloamgarden",
    groundLow: 0x427f79, groundHigh: 0x78947a, soil: 0x588b82, rock: 0x92958a,
    foliage: 0x51c5bd, timber: 0x75618e, water: 0x398f9b, accent: 0xb195dd,
  },
  faeholme: {
    id: "faeholme", name: "Faeholme",
    groundLow: 0x4c747b, groundHigh: 0x81918c, soil: 0x627e87, rock: 0x99999b,
    foliage: 0xb98ddd, timber: 0x667c92, water: 0x518fbe, accent: 0x80d3d0,
  },
  wilderness: {
    id: "wilderness", name: "Wilderness",
    groundLow: 0x555961, groundHigh: 0x7b7e83, soil: 0x535357, rock: 0x72767e,
    foliage: 0x4b4a47, timber: 0x49464a, water: 0x313e49, accent: 0x958b80,
  },
  // Bleached grass greens, weathered grey-brown timber, and a restrained dried-clay accent.
  fallowmarch: {
    id: "fallowmarch", name: "Fallowmarch",
    groundLow: 0x76854f, groundHigh: 0xa3a978, soil: 0x8a7a5c, rock: 0x8d8579,
    foliage: 0x7d8b5c, timber: 0x7a6a55, water: 0x4d6f74, accent: 0xc07a3e,
  },
  // Deep desaturated greens, strong value contrast, bark browns pushed purple.
  vellenwood: {
    id: "vellenwood", name: "Vellenwood",
    groundLow: 0x33452c, groundHigh: 0x576b3f, soil: 0x413630, rock: 0x5b5750,
    foliage: 0x3f5f38, timber: 0x4a3d4a, water: 0x2c3c36, accent: 0x9bb05a,
  },
  // Cold blue-grey slate, lichen green-yellow, one warm firelight per camp.
  karrowmoor: {
    id: "karrowmoor", name: "Karrowmoor",
    groundLow: 0x5c6169, groundHigh: 0x7c7a6d, soil: 0x655f54, rock: 0x545a64,
    foliage: 0x53664c, timber: 0x5d554b, water: 0x46606b, accent: 0xd08a44,
  },
  // Ember foothills: warm dark soil, dark rock, dry brush, one ember-orange accent.
  kilnhalt: {
    id: "kilnhalt", name: "Kilnhalt",
    groundLow: 0x6e5f4b, groundHigh: 0x87755a, soil: 0x5a4a3a, rock: 0x463c34,
    foliage: 0x7d7248, timber: 0x4c3f36, water: 0x4f5e57, accent: 0xd06a34,
  },
  // Underground. Dark, near-monochrome, lit by torch only.
  gravelmaw: {
    id: "gravelmaw", name: "Gravelmaw",
    groundLow: 0x2a2723, groundHigh: 0x3b3730, soil: 0x2f2a25, rock: 0x3f434a,
    foliage: 0x3a4436, timber: 0x36302a, water: 0x22302f, accent: 0xc65a2a,
  },
};

/** The stable material families exported by the Medieval Village Megakit. */
export type ArchitectureMaterialRole = "roof" | "plaster" | "stone" | "timber" | "moss";

/**
 * Architecture has its own palette rather than borrowing gameplay tier or terrain colours.
 *
 * The same `MI_RoundTiles` image is embedded in every tiled-roof GLB, and the same plaster, stone
 * and wood images repeat across all three building kits. Region-specific colour therefore belongs
 * at the material layer. Keeping it out of `TIER_PALETTES` prevents a roof adjustment from changing
 * ore and equipment, while keeping it out of `REGION_PALETTES` prevents it from moving terrain,
 * water or foliage.
 */
export interface ArchitecturePalette {
  roof: number;
  plaster: number;
  stone: number;
  timber: number;
  moss: number;
}

export const ARCHITECTURE_PALETTES: Record<RegionId, ArchitecturePalette> = {
  crownward: { roof: 0x405875, plaster: 0xecece2, stone: 0xdce4e4, timber: 0xd9cba5, moss: 0x819b74 },
  gloamgarden: { roof: 0x735498, plaster: 0xaaa5c4, stone: 0x78729c, timber: 0x665879, moss: 0x68b4b0 },
  faeholme: { roof: 0x525b96, plaster: 0xc0b2d1, stone: 0x9a8bae, timber: 0x5b7186, moss: 0x9370b0 },
  wilderness: { roof: 0x292c35, plaster: 0x55565c, stone: 0x42464e, timber: 0x353035, moss: 0x424447 },
  fallowmarch: {
    roof: 0x69504a,
    plaster: 0x89908e,
    stone: 0x6f787c,
    timber: 0x4a403a,
    moss: 0x53613d,
  },
  vellenwood: {
    roof: 0x4b403b,
    plaster: 0x85897f,
    stone: 0x59615d,
    timber: 0x302d2a,
    moss: 0x3c5234,
  },
  karrowmoor: {
    roof: 0x505861,
    // The only available triangular gable face is authored as plaster. Keep it a half-step lighter
    // than the quarry masonry, but in the same cool slate family so stone shells do not end in a
    // pale foreign-looking triangle.
    plaster: 0x777b7d,
    stone: 0x626a73,
    timber: 0x403d39,
    moss: 0x566047,
  },
  kilnhalt: {
    // Fired brick and dark stone with an ember cast: the stone kit re-graded warm, which is how
    // the kiln camp gets its own vernacular without a fourth building kit.
    roof: 0x6d4436,
    plaster: 0x9a8a78,
    stone: 0x6b5c50,
    timber: 0x453931,
    moss: 0x6b6039,
  },
  gravelmaw: {
    roof: 0x3d3430,
    plaster: 0x716b61,
    stone: 0x494e52,
    timber: 0x2c2926,
    moss: 0x394532,
  },
};

/**
 * Resolves stable source-material names to an architectural surface.
 *
 * Architecture variants append an `@architecture:*` suffix so the batch key can never merge two
 * region styles. Splitting before that suffix lets the same classifier serve source and derived
 * materials without accepting vague words such as "wood" from unrelated packs.
 */
export function architectureMaterialRole(materialName: string): ArchitectureMaterialRole | null {
  const sourceName = materialName.split("@architecture:", 1)[0];
  switch (sourceName) {
    case "MI_RoundTiles": return "roof";
    case "MI_Plaster": return "plaster";
    case "MI_Brick":
    case "MI_UnevenBrick":
    case "MI_RockTrim":
    // Textured Stylized Nature rocks build the Gravelmaw, cairns and moor waypoints. Only the
    // architecture carrier archetypes consume this role, so mineable ore nodes keep their normal
    // tier treatment while built stone landmarks take on their region's slate or fieldstone hue.
    case "Rock":
    case "Rocks":
    case "PathRocks": return "stone";
    // The architecture kit splits its wood across three stable materials. Wall studs and roof
    // braces use MI_WoodTrim, doors/windows/wagons use the weathered variant, and small built-in
    // furniture such as benches, buckets and crates uses MI_Trim_Furniture. Treating only the
    // first as architectural timber left every facade with orange doors and shutters against a
    // region-tinted frame. Keeping the family together gives each settlement one wood language
    // while preserving the grain, wear and roughness authored into each source material.
    case "MI_WoodTrim":
    case "MI_WoodTrim_Wear":
    case "MI_Trim_Furniture": return "timber";
    case "MI_Vine": return "moss";
    default: return null;
  }
}

/**
 * Correct a pair of misleading source-material labels before regional architecture tinting.
 *
 * `stairs_stone` ships its masonry in a primitive named `MI_WoodTrim`. Treating that label
 * literally turns the dungeon stair into settlement timber. The exception belongs to the
 * asset/material pair, not to the global role table, because genuine doors, windows, frames and
 * furniture use the same material name and must continue to follow the local wood palette.
 */
export function architectureMaterialRoleForAsset(
  assetId: string,
  materialName: string,
): ArchitectureMaterialRole | null {
  const sourceName = materialName.split("@architecture:", 1)[0];
  if (assetId === 'crownward_premade_castle' || assetId === 'crownward_premade_fortress') return 'stone';
  if (assetId === "stairs_stone" && sourceName === "MI_WoodTrim") {
    return "stone";
  }
  return architectureMaterialRole(materialName);
}

/**
 * How strongly each source image takes the regional hue, plus its final value and contrast.
 *
 * Roof needs the strongest move because its source image averages RGB 178/84/48 and a simple
 * multiply cannot turn that orange into Karrowmoor slate. Contrast is applied around linear
 * middle grey so tile joints and wood grain remain legible after the hue replacement. Plaster and
 * timber use stronger replacement than the source assets to remove their sandstone/orange cast.
 */
const ARCHITECTURE_TREATMENT: Record<ArchitectureMaterialRole, {
  strength: number;
  brightness: number;
  contrast: number;
}> = {
  roof: { strength: 0.88, brightness: 0.88, contrast: 1.20 },
  plaster: { strength: 0.86, brightness: 0.82, contrast: 1.08 },
  stone: { strength: 0.58, brightness: 0.86, contrast: 1.06 },
  timber: { strength: 0.82, brightness: 0.72, contrast: 1.12 },
  moss: { strength: 0.68, brightness: 0.84, contrast: 1.04 },
};

/** Back-compatible flat lookup. Round 0 callers used this; keep it working. */
export const GROUND_COLOURS = {
  fallowmarch: REGION_PALETTES.fallowmarch.groundHigh,
  vellenwood: REGION_PALETTES.vellenwood.groundHigh,
  karrowmoor: REGION_PALETTES.karrowmoor.groundHigh,
  kilnhalt: REGION_PALETTES.kilnhalt.groundHigh,
  gravelmaw: REGION_PALETTES.gravelmaw.groundHigh,
} as const;

/** The eight swatches, as hex strings, for `RegionDef.palette`. */
export function regionSwatches(regionId: RegionId): string[] {
  const palette = REGION_PALETTES[regionId];
  return [
    palette.groundLow, palette.groundHigh, palette.soil, palette.rock,
    palette.foliage, palette.timber, palette.water, palette.accent,
  ].map((value) => `#${value.toString(16).padStart(6, "0")}`);
}

/**
 * The colour of a trodden track in a region: its soil, lifted toward its rock tone.
 *
 * Kept for whoever dresses a route with kerbs or path rocks and needs the track's own tone. The
 * ground itself no longer uses it: the road is stamped into the terrain splat now, and an opaque
 * ground colour needs a gentler lift than a feathered transparent ribbon did. See `surfaceColour`.
 */
export function roadColour(regionId: RegionId): number {
  const palette = REGION_PALETTES[regionId];
  return mixHex(palette.soil, palette.rock, 0.45, 1.35);
}

/**
 * The four surface tones the terrain splat needs beyond the eight authored swatches.
 *
 * All four are DERIVED from the region's own eight, not authored, so the palette contract in the
 * PRD stays a list of eight and a region cannot acquire a hue nobody signed off. They exist
 * because slope alone could only ever express "grass or rock": the measured consequence was that
 * only 12.71% of the world had any surface variation at all, and a worn track, a scree hollow, a
 * cobbled square and a waterlogged bank were all literally undrawable.
 */
export function surfaceColour(
  regionId: RegionId,
  kind: "gravel" | "dirt" | "mud" | "cobble" | "brick" | "plank" | "wet",
): number {
  const palette = REGION_PALETTES[regionId];
  switch (kind) {
    // Scree and hollow debris: the region's rock, dragged toward its soil and lifted, so it
    // separates from a cliff face rather than reading as more of the same stone.
    case "gravel": return mixHex(palette.rock, palette.soil, 0.45, 1.08);
    // A trodden track is dust and exposed grit, so it reads BRIGHTER than the vegetation beside
    // it — but only just. Two earlier passes overshot: roadColour's 1.35 was tuned for a
    // transparent ribbon feathered over grass, and 1.12 as an opaque ground colour still gave
    // fallowmarch (155,141,114), which under the old blue fill is the "pale grey-blue smear" the
    // roads read as in wire-town_entrance.png. 1.02 leaves (142,128,103): warmer than the
    // #76854f grass it cuts through, and darker than it in the blue channel, so it reads as worn
    // dirt rather than as a lighting artefact.
    case "dirt": return mixHex(palette.soil, palette.rock, 0.32, 1.02);
    // Churned wet earth at a waterline. Dark, and the only place in the palette that goes there.
    case "mud": return mixHex(palette.soil, palette.water, 0.3, 0.72);
    // Laid stone: the BED the paving is set in, so it has to match the paving.
    //
    // This was `mixHex(palette.rock, 0x9a978f, 0.55, 1.06)` - the region's natural rock lifted
    // toward a warm grey - and it gave Fallowmarch #9d978d against `floor_cobble` tiles that the
    // architecture layer tints toward `ARCHITECTURE_PALETTES.stone`, #6f787c at 0.86 brightness.
    // A warm pale tan under cool dark slate. Every metre of a settlement's paving stamp that a
    // 2 m tile does not sit on - the frayed edges, the gaps a player walks past, the whole apron
    // outside the tiled rectangle - therefore read as SAND next to the cobbles, which is the hard
    // cutoff a player called out looking north out of Coldbrace's square. Derived from the same
    // architecture stone the tiles take, dragged a quarter toward the region's soil and darkened,
    // so a gap in the paving reads as the earth the stones are bedded into.
    case "cobble": return mixHex(ARCHITECTURE_PALETTES[regionId].stone, palette.soil, 0.26, 0.9);
    // Dressed block, the quarry town's own stone. The same masonry as `cobble` but cut and laid
    // rather than gathered: less earth dragged through it and a half-step lighter, so a brick yard
    // reads as paid-for beside a cobbled square without leaving the region's stone family.
    case "brick": return mixHex(ARCHITECTURE_PALETTES[regionId].stone, palette.soil, 0.14, 1.02);
    // Sawn plank. The architecture timber is the beam colour, which is the shaded underside of a
    // building; a deck lies face up in the weather, so it goes toward soil and lifts hard. Under
    // Vellenwood's canopy this is the one man-made surface that has to hold its own against
    // 0x33452c ground, and a deck darker than the forest floor reads as a hole in the clearing.
    case "plank": return mixHex(ARCHITECTURE_PALETTES[regionId].timber, palette.soil, 0.4, 1.9);
    // Saturated ground just above the waterline.
    default: return mixHex(palette.soil, palette.water, 0.55, 0.85);
  }
}

/** Linear mix of two packed colours, then a brightness multiplier, clamped per channel. */
function mixHex(a: number, b: number, t: number, gain = 1): number {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const channelA = (a >> shift) & 0xff;
    const channelB = (b >> shift) & 0xff;
    const mixed = Math.round((channelA + (channelB - channelA) * t) * gain);
    out |= Math.min(255, Math.max(0, mixed)) << shift;
  }
  return out;
}

export type SurfaceState = "normal" | "depleted" | "dead";

/**
 * Which swatch of a tier palette a surface is pulled toward.
 *
 * The split matters for readability: an ore node's ROCK takes `body` (Grithe's soft grey,
 * Kaldite's blue-black) and its exposed SEAM takes `metal` (Grithe's warm ochre, Kaldite's cyan).
 * Round 1 pulled everything toward `metal`, which turned a tier 1 rock into an orange boulder and
 * still left it indistinguishable from the decorative boulder beside it.
 */
export type PaletteSwatch = "metal" | "body" | "accent";

/** How a `SemanticEntity.view` maps onto a material variant. Purely descriptive; no gameplay. */
export interface VariantSpec {
  tier: number;
  state?: SurfaceState;
  /** 0..1. How far the base colour is pulled toward the tier colour. 0 returns the base material. */
  strength?: number;
  /** Which tier swatch to pull toward. Defaults to `metal`, the round-0 behaviour. */
  swatch?: PaletteSwatch;
  /** Emissive floor for a self-lit seam or rune. The tier's own emissive wins when it is higher. */
  glow?: number;
}

function swatchColour(palette: TierPalette, swatch: PaletteSwatch): number {
  if (swatch === "body") return palette.body;
  if (swatch === "accent") return palette.accent;
  return palette.metal;
}

interface GroundUniforms {
  uDetail: { value: THREE.Texture };
  uMacro: { value: THREE.Texture };
  uNormalGS: { value: THREE.Texture };
  uNormalRV: { value: THREE.Texture };
  uCobble: { value: THREE.DataTexture };
  uCobbleTiling: { value: number };
  uDetailTiling: { value: THREE.Vector4 };
}

const COBBLE_TILE_METRES = 4.8;

/** Value, world-X/world-Z normal and face coverage for stones laid in a repeating 4.8 m patch. */
function createCobbleSurfaceTexture(): THREE.DataTexture {
  const size = 512;
  const courses = 8;
  const stoneMetres = COBBLE_TILE_METRES / courses;
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const wrap = (value: number, span: number): number => ((value % span) + span) % span;
  const hash = (col: number, row: number, salt: number): number => {
    let value = Math.imul(wrap(col, courses) + 1, 374761393)
      ^ Math.imul(wrap(row, courses) + 1, 668265263) ^ salt;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const sites = new Map<string, { x: number; z: number; tone: number; weight: number }>();
  for (let row = -1; row <= courses; row++) {
    for (let col = -1; col <= courses; col++) {
      sites.set(`${col}:${row}`, {
        x: col + 0.5 + (hash(col, row, 19) - 0.5) * 0.68,
        z: row + 0.5 + (hash(col, row, 47) - 0.5) * 0.68,
        tone: hash(col, row, 97),
        weight: (hash(col, row, 131) - 0.5) * 0.24,
      });
    }
  }
  const patches = Array.from({ length: courses * courses }, (_, index) => {
    const col = index % courses, row = Math.floor(index / courses);
    return Array.from({ length: 9 }, (_, neighbour) =>
      sites.get(`${col + neighbour % 3 - 1}:${row + Math.floor(neighbour / 3) - 1}`)!);
  });

  // Unequal stone sizes and jittered centres avoid the even hexagons produced by staggered rows.
  // The weighted nearest boundary keeps the stones fitted together, including at the tile seam.
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size * courses;
      const pz = (z + 0.5) / size * courses;
      const neighbours = patches[Math.floor(pz) * courses + Math.floor(px)]!;
      let closest = neighbours[0]!;
      let nearestSquared = Infinity;
      for (const site of neighbours) {
        const distanceSquared = (px - site.x) ** 2 + (pz - site.z) ** 2 - site.weight;
        if (distanceSquared < nearestSquared) {
          nearestSquared = distanceSquared;
          closest = site;
        }
      }
      let edge = Infinity;
      for (const site of neighbours) {
        if (site === closest) continue;
        const distanceSquared = (px - site.x) ** 2 + (pz - site.z) ** 2 - site.weight;
        edge = Math.min(edge, (distanceSquared - nearestSquared)
          / (2 * Math.hypot(site.x - closest.x, site.z - closest.z)));
      }
      const phaseX = px / courses * Math.PI * 2, phaseZ = pz / courses * Math.PI * 2;
      const edgeWear = Math.sin(phaseX * 23 + phaseZ * 31) * Math.sin(phaseX * 41 - phaseZ * 19);
      const inset = edge * stoneMetres + edgeWear * 0.002;
      const joint = 0.005 + closest.tone * 0.003;
      const face = THREE.MathUtils.smoothstep(inset, joint, joint + 0.009);
      const bevel = THREE.MathUtils.smoothstep(inset, joint, joint + 0.028);
      const crown = 1 - Math.exp(-Math.max(0, inset - joint) * 7);
      const stoneValue = 0.99 + closest.tone * 0.16;
      const value = THREE.MathUtils.lerp(0.80, stoneValue, face);
      const offset = (z * size + x) * 4;
      data[offset] = Math.round(value / 1.5 * 255);
      data[offset + 3] = Math.round(face * 255);
      heights[z * size + x] = bevel * 0.024 + crown * 0.027;
    }
  }
  const pixelMetres = COBBLE_TILE_METRES / size;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const dx = (heights[z * size + wrap(x + 1, size)]! - heights[z * size + wrap(x - 1, size)]!) / (2 * pixelMetres);
      const dz = (heights[wrap(z + 1, size) * size + x]! - heights[wrap(z - 1, size) * size + x]!) / (2 * pixelMetres);
      const length = Math.hypot(dx, 1, dz);
      const offset = (z * size + x) * 4;
      data[offset + 1] = Math.round((0.5 - dx / length * 0.5) * 255);
      data[offset + 2] = Math.round((0.5 - dz / length * 0.5) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "laid-cobble-value-normal-face";
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

interface WaterUniforms {
  uTime: { value: number };
  uShallow: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uNormalB: { value: THREE.Texture };
  uDepthRange: { value: number };
  uEdgeFade: { value: number };
  uWaveScale: { value: THREE.Vector2 };
  uWaveScrollA: { value: THREE.Vector2 };
  uWaveScrollB: { value: THREE.Vector2 };
}

interface WindUniforms {
  uCorealmWindTime: { value: number };
  uCorealmWindStrength: { value: number };
}

export interface WaterVariantOptions {
  time?: { value: number };
  waveScrollA?: THREE.Vector2;
  waveScrollB?: THREE.Vector2;
  edgeFade?: number;
}

/** Keep per-surface sky response while Three supplies the scene's environment intensity. */
function environmentResponse(material: MeshStandardNodeMaterial, strength: number): void {
  material.envNode = Fn((builder) => {
    const environment = (builder as typeof builder & { scene: THREE.Scene | null }).scene?.environment;
    return environment ? pmremTexture(environment).mul(strength) : vec3(0);
  })();
}

/**
 * Material cache. Identical descriptors must return the identical material instance, or instancing
 * silently fragments and the draw-call budget is gone.
 */
export class MaterialLibrary {
  private castleStoneEnabled = false;

  setCastleStoneEnabled(enabled: boolean): void { this.castleStoneEnabled = enabled; }

  castleStone(base: THREE.Material, style: CastleStoneStyle, paletteMask = false): THREE.Material {
    if (!this.castleStoneEnabled) return base;
    const key = this.key(['castle-stone', this.baseKey(base), style, String(paletteMask)]);
    return this.remember(key, () => createCastleStoneMaterial(base, style, { paletteMask }));
  }

  forContainedTrough(assetId: string, source: THREE.Material): THREE.Material {
    return assetId === "corealm_water_trough" && ((source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial || (source as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial)
      && source.name.startsWith("Corealm farm water")
      ? this.containedTroughWater(source as THREE.MeshPhysicalMaterial) : source;
  }

  /** Normal library disposal owns these clones, never their borrowed maps. */
  containedTroughWater(source: THREE.MeshPhysicalMaterial | MeshPhysicalNodeMaterial): MeshPhysicalNodeMaterial {
    const key = `contained-trough-water:${source.uuid}`;
    let material = this.cache.get(key) as MeshPhysicalNodeMaterial | undefined;
    if (!material) { material = createContainedTroughWater(source); this.cache.set(key, material); }
    return material;
  }

  private cache = new Map<string, THREE.Material>();
  /** Variants are keyed off the source material so a shared base texture stays shared. */
  private variantKeys = new WeakMap<THREE.Material, string>();
  private nextVariantKey = 0;
  /** Held so the compiled ground program cannot outlive the atlas it samples. */
  private groundUniforms: GroundUniforms | null = null;
  /** Shared authored maps are borrowed; their loader owns their lifetime. */
  private readonly groundStoneUniforms = {
    uGroundStoneAlbedo: { value: null as THREE.Texture | null },
    uGroundStoneNormal: { value: null as THREE.Texture | null },
    uGroundStoneRoughness: { value: null as THREE.Texture | null },
    uGroundStoneMean: { value: new THREE.Vector3(1, 1, 1) },
    uGroundStoneTiling: { value: 1 },
    uGroundStoneReady: { value: 0 },
  };
  private readonly fairyGrassUniforms = {
    uFairyGrassAlbedo: { value: null as THREE.Texture | null },
    uFairyGrassNormal: { value: null as THREE.Texture | null },
    uFairyGrassMean: { value: new THREE.Vector3(1, 1, 1) },
    uFairyGrassTiling: { value: 1 },
    uFairyGrassReady: { value: 0 },
  };
  private waterUniforms: WaterUniforms[] = [];
  private oceanDepthTexture: THREE.DataTexture | null = null;
  // Stable wrappers also update ocean programs compiled before a world rebuild.
  private readonly oceanDepthUniforms = {
    uOceanDepthGrid: { value: null as THREE.DataTexture | null },
    uOceanDepthReady: { value: 0 },
    uOceanGridBounds: { value: new THREE.Vector4() },
    uOceanGridSize: { value: new THREE.Vector2(2, 2) },
    uOceanGridStep: { value: new THREE.Vector2(1, 1) },
    uOceanSeaLevel: { value: 0 },
  };
  private windUniforms: WindUniforms[] = [];
  private grassSpriteMaterial: MeshStandardNodeMaterial | null = null;
  private timeSeconds = 0;
  private readonly magicTreeTime = { value: 0 };
  private readonly foliageOcclusion = new FoliageOcclusion();
  private readonly foliagePlayerFeet = new THREE.Vector3();
  private readonly foliageBufferSize = new THREE.Vector2();
  private foliageOcclusionEnabled = false;

  private key(parts: (string | number | boolean)[]): string {
    return parts.join("|");
  }

  private remember<T extends THREE.Material>(key: string, create: () => T): T {
    const cached = this.cache.get(key);
    if (cached) return cached as T;
    const material = create();
    this.cache.set(key, material);
    return material;
  }

  /** Flat stylized surface. The workhorse for terrain, rock, and architecture. */
  surface(colour: number, roughness = 0.92, metalness = 0): MeshStandardNodeMaterial {
    return this.remember(this.key(["surface", colour, roughness, metalness]), () =>
      new MeshStandardNodeMaterial({ color: colour, roughness, metalness, flatShading: false }));
  }

  /** Shared organic treatment after tier/state colour and before animation shader extensions. */
  organic(source: THREE.Material, role: ArtSurfaceRole): THREE.Material {
    return this.remember(this.key(["organic", this.baseKey(source), role]), () => {
      const organic = createArtDirectedMaterial(source, role);
      const fairy = this.fairyFoliage(organic, role);
      if (fairy !== organic && organic !== source) organic.dispose();
      const graded = createMagicTreeShimmer(fairy, this.magicTreeTime);
      if (graded !== fairy && fairy !== source) fairy.dispose();
      const name = source.name.split("@", 1)[0]!;
      const treeOrPlant = role === "bark"
        || (role === "foliage" && !/^(?:Grass|grass-sprite)$/i.test(name));
      if (!treeOrPlant) return graded;
      const reveal = createFoliageOcclusionMaterial(graded, this.foliageOcclusion);
      // The final clone retains the shader closure and shared textures. Dispose only the unused
      // intermediate material; the asset registry continues to own the original source.
      if (reveal !== graded && graded !== source) graded.dispose();
      return reveal;
    });
  }

  /** Recolour the sampled leaves, including vertex colours and atlas pixels, with native shading. */
  private fairyFoliage(source: THREE.Material, role: ArtSurfaceRole): THREE.Material {
    const style = fairyFoliageStyle(source.name);
    if (!style || (role !== "bark" && role !== "foliage")) return source;
    const standard = ensureNodeMaterial(source);
    if (!(standard instanceof MeshStandardNodeMaterial)) return source;
    const palette = FAIRY_FOLIAGE_COLOURS[style];
    const tint = new THREE.Color(role === "foliage" ? palette.leaf : palette.bark);
    tint.multiplyScalar(1 / Math.max(1e-4, luminance(tint)));
    const glow = new THREE.Color(palette.glow);
    const material = cloneNodeMaterial(standard) as MeshStandardNodeMaterial;
    composeSurface(material, {
      roughness: roughness => Fn(() => {
        const inherited = roughness.toVar();
        const value = diffuseColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb.assign(mix(diffuseColor.rgb, vec3(tint.r, tint.g, tint.b).mul(value), role === "foliage" ? 0.94 : 0.72));
        return inherited;
      })(),
      ...(role === "foliage" ? { emissive: (emissive: import('three/webgpu').Node<'vec3'>) =>
        emissive.add(vec3(glow.r, glow.g, glow.b).mul(diffuseColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722))).mul(0.12)) } : {}),
    });
    return material;
  }

  setFoliageOcclusionEnabled(enabled: boolean): void {
    this.foliageOcclusionEnabled = enabled;
    if (!enabled) this.foliageOcclusion.setEnabled(false);
  }

  setFoliageOcclusionBoundsOptimization(enabled: boolean): void {
    this.foliageOcclusion.setBoundsOptimization(enabled);
  }

  updatePlayerOcclusion(
    renderer: { getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 },
    camera: THREE.Camera,
    position: readonly [number, number, number],
    playerVisible: boolean,
  ): void {
    this.foliagePlayerFeet.set(position[0], position[1], position[2]);
    renderer.getDrawingBufferSize(this.foliageBufferSize);
    this.foliageOcclusion.update(camera, this.foliagePlayerFeet, this.foliageBufferSize,
      this.foliageOcclusionEnabled && playerVisible);
  }

  getFoliageOcclusion(): ReturnType<FoliageOcclusion["snapshot"]> {
    return this.foliageOcclusion.snapshot();
  }

  /** Boot awaits the shared surface loader, then supplies these maps before terrain creation. */
  setGroundStoneSurface(textures: CorealmSurfaceTextures): void {
    const stone = textures.stone;
    if (!Number.isFinite(stone.tileMetres) || stone.tileMetres <= 0
      || stone.meanLinearRgb.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Ground stone surface needs positive tile metres and mean linear RGB");
    }
    this.groundStoneUniforms.uGroundStoneAlbedo.value = stone.albedo;
    this.groundStoneUniforms.uGroundStoneNormal.value = stone.normal;
    this.groundStoneUniforms.uGroundStoneRoughness.value = stone.roughness;
    this.groundStoneUniforms.uGroundStoneMean.value.fromArray(stone.meanLinearRgb);
    this.groundStoneUniforms.uGroundStoneTiling.value = 1 / stone.tileMetres;
    this.groundStoneUniforms.uGroundStoneReady.value = 1;
  }

  /**
   * The one terrain material. Every terrain chunk in every region shares it; the region look comes
   * from baked vertex colours, so three regions cost one material and one shader program.
   *
   * The vertex colour still carries all of the hue — region palette, surface type, and the baked
   * horizon AO. The surface graph adds the value detail the vertex colour physically
   * cannot: measured, the colour changed by 0.12 of 255 per channel across a 2 m quad, which is
   * below the 8-bit display floor, so the ground was one flat colour at every scale a player sees.
   *
   * Eight per-vertex surface weights select which channel is sampled, and there are FOUR value
   * reads — 2.5 m from the detail atlas, then 6.3, 16 and 40 m from the macro texture — plus two
   * normal-map fetches at the detail rate. Four scales from two value textures is what kills the
   * tile repeat across a 700 x 400 m world for one extra sampler and no extra memory, and the
   * normal maps are the surface relief the ground has never had: before them the only bump on the
   * terrain was a screen-space derivative of its own albedo.
   *
   * Everything here happens to `diffuseColor` before `<lights_fragment_begin>`, so shadows, all
   * four lights, ACES tone mapping, fog and the sRGB output conversion stay downstream and keep
   * working untouched. The terrain has `castShadow = false`, so there is no depth-material variant
   * to keep in sync. This replaces the ground program rather than adding one: same material, same
   * draw calls, one more `customProgramCacheKey`.
   */
  setFairyGroundSurface(surface: FairyGroundSurface | null): void {
    const uniforms = this.fairyGrassUniforms;
    uniforms.uFairyGrassAlbedo.value = surface?.albedo ?? null;
    uniforms.uFairyGrassNormal.value = surface?.normal ?? null;
    uniforms.uFairyGrassReady.value = surface ? 1 : 0;
    if (surface) {
      uniforms.uFairyGrassMean.value.fromArray(surface.meanLinearRgb);
      uniforms.uFairyGrassTiling.value = 1 / surface.tileMetres;
    }
  }

  ground(): MeshStandardNodeMaterial {
    return this.remember("ground", () => {
      const material = new MeshStandardNodeMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.97,
        metalness: 0,
        flatShading: false,
      });
      material.name = "ground";

      const normals = createDetailNormals();
      const uniforms = {
        uDetail: { value: createDetailAtlas() },
        uMacro: { value: createMacroVariation() },
        uNormalGS: { value: normals.grassSoil },
        uNormalRV: { value: normals.rockGravel },
        uCobble: { value: createCobbleSurfaceTexture() },
        uCobbleTiling: { value: 1 / COBBLE_TILE_METRES },
        // 2.5 m for the detail read, then 6.3, 16 and 40 m — a 2.5x geometric ladder, so the four
        // reads cover 1 cm to 13 m features with no gap and no two of them come back into phase
        // inside the fog radius. The three far reads come from their OWN texture: reading the
        // atlas again at 37 m printed its cell structure at 1.5 m and 2.9 m across every stone and
        // gravel surface in the world, which is the reported honeycomb.
        uDetailTiling: { value: new THREE.Vector4(1 / DETAIL_TILING_METRES, 1 / 6.3, 1 / 16, 1 / 40) },
      };
      // Held so a hot reload cannot orphan the atlas while a compiled program still references it.
      this.groundUniforms = uniforms;

      applyGroundSurfaceNodes(material, { ...uniforms, ...this.groundStoneUniforms, ...this.fairyGrassUniforms });
      environmentResponse(material, GROUND_ENV_RESPONSE);
      return material;
    });
  }


  /**
   * The shared cutout material for every grass card.
   *
   * Alpha testing keeps the cards in the opaque queue, writes depth, and avoids sorting hundreds
   * of thousands of overlapping tufts. `alphaToCoverage` softens that hard cut on the renderer's
   * multisampled canvas without changing the material to transparent. The map carries folded-blade
   * shading; each `InstancedMesh` carries the meadow palette and value shifts through `instanceColor` while all
   * regions and all four former grass assets keep one program and one material.
   */
  grassSprite(): MeshStandardNodeMaterial {
    if (this.grassSpriteMaterial) return this.grassSpriteMaterial;

    const source = new MeshStandardNodeMaterial({
      color: 0xffffff,
      map: createGrassSpriteTexture(),
      alphaTest: 0.38,
      alphaToCoverage: true,
      transparent: false,
      depthWrite: true,
      // `InstancedMesh.instanceColor` enables Three's instancing-colour shader path by itself.
      // Enabling `vertexColors` as well would make the shader multiply by a geometry `color`
      // attribute; the shared crossed-card geometry intentionally has no such attribute, and
      // WebGL supplies zero for that missing input, turning every instance black.
      vertexColors: false,
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    source.name = "grass-sprite";
    // Upright cards approximate many curved blades. An upward diffuse normal keeps their two
    // faces from alternating between bright green and black as the camera orbits the same tuft.
    composeSurface(source, { normal: normal => mix(normal,
      cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize(), 0.78).normalize() });
    this.grassSpriteMaterial = this.wind(this.organic(source, "foliage"), GRASS_WIND_STRENGTH) as MeshStandardNodeMaterial;
    return this.grassSpriteMaterial;
  }

  grassBlades(): THREE.Material {
    return this.remember("grass-blades", () => {
      const source = new MeshStandardNodeMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.92 });
      source.name = "Corealm folded grass blades";
      composeSurface(source, { normal: normal => mix(normal,
        cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize(), 0.45).normalize() });
      return this.wind(this.organic(source, "foliage"), GRASS_WIND_STRENGTH);
    });
  }

  /**
   * Adds a small GPU-side bend while preserving the source material's node graph.
   *
   * The clone shares every texture with `source`. One cached clone serves each source/strength
   * pair, and a translation-derived phase keeps instances and BatchedMesh entries out of lockstep.
   */
  wind(source: THREE.Material, strength: number): THREE.Material {
    const amount = Number.isFinite(strength) ? Math.max(0, strength) : 0;
    if (amount === 0) return source;

    const key = this.key(["wind", this.baseKey(source), amount]);
    return this.remember(key, () => {
      const clone = cloneNodeMaterial(source);
      const uniforms: WindUniforms = {
        uCorealmWindTime: { value: this.timeSeconds },
        uCorealmWindStrength: { value: amount },
      };
      this.windUniforms.push(uniforms);
      clone.name = `${source.name || source.type}@wind:${amount}`;
      const time = reference('value', 'float', uniforms.uCorealmWindTime);
      const strengthNode = reference('value', 'float', uniforms.uCorealmWindStrength);
      composeSurface(clone, { position: previous => Fn(() => {
        const height = smoothstep(0, 0.75, max(positionGeometry.y, 0));
        const phase = objectInstanceWorldOrigin().xz.dot(vec2(0.173, 0.277));
        const main = sin(time.mul(0.82).add(phase));
        const ripple = sin(time.mul(1.67).add(phase.mul(1.31)).add(positionGeometry.y.mul(0.73)));
        const bend = vec2(0.86, 0.51).mul(main).add(vec2(-0.22, 0.37).mul(ripple)).mul(strengthNode).mul(height);
        // positionNode runs after instancing; transform only this added displacement so roots,
        // instance orientation, scale and any preceding skinning remain unchanged.
        const displacement = objectInstanceMatrix().mul(vec4(bend.x, 0, bend.y, 0)).xyz;
        return previous.add(displacement);
      })() });
      clone.userData.corealmWind = uniforms;
      return clone;
    });
  }

  /**
   * Standing water: depth-tinted, alpha driven by depth, and two generated normal maps scrolling
   * across each other.
   *
   * What was here before was a flat tinted plane whose rim faded to alpha 0 over the outer 40% of
   * the disc, which dissolved the shoreline instead of drawing one — measured, 55-56% of the tarn
   * footprints had dry hillside above the surface, so the "shoreline" was a wash lying on a slope.
   * The geometry now stops exactly where the terrain crosses the surface (see `WorldScene.
   * buildWater`), and this material fades the last 25 cm of depth so the waterline is a real edge
   * rather than a drawn line or a smear.
   *
   * TWO scrolled normal maps, not one. One always reads as a texture sliding across a plane; two
   * at different tilings and 33 degrees apart read as a surface. The plane is horizontal and
   * unrotated, so its tangent frame is world-axis-aligned and the perturbed normal needs no
   * tangent attribute and no `getTangentFrame` call.
   *
   * Roughness 0.14 needs something to reflect. `scene.environment` now exists, but the scene's
   * environment intensity was cut to 0.50 to stop dark and metal surfaces reading as pale blue,
   * and at 0.50 the water lost its sky and went back to a flat tinted plane. `WATER_ENV_RESPONSE`
   * puts it back for this material alone.
   */
  water(regionId: RegionId = "fallowmarch", mode: "lake" | "ocean" = "lake"): MeshStandardNodeMaterial {
    return this.remember(this.key(["water", regionId, mode]), () => this.createWater(regionId, mode));
  }

  /** Independent animation controls for a caller-owned river material, sharing water textures. */
  createWaterVariant(regionId: RegionId, options: WaterVariantOptions = {}): MeshStandardNodeMaterial {
    return this.createWater(regionId, 'lake', options);
  }

  private createWater(regionId: RegionId, mode: "lake" | "ocean", options: WaterVariantOptions = {}): MeshStandardNodeMaterial {
    const ocean = mode === "ocean";
    const palette = REGION_PALETTES[regionId];
    const material = new MeshStandardNodeMaterial({
      color: 0xffffff, roughness: 0.14, metalness: 0, transparent: true,
      opacity: ocean ? 1 : 0.94, side: THREE.FrontSide, depthWrite: false,
      normalMap: createWaterNormalMap("fine"), normalScale: new THREE.Vector2(0.55, 0.55),
    });
    material.name = ocean ? `ocean-${regionId}` : `water-${regionId}`;
    const uniforms: WaterUniforms = {
      uTime: options.time ?? { value: this.timeSeconds },
      uShallow: { value: new THREE.Color(mixHex(palette.water, palette.groundLow, 0.45)) },
      uDeep: { value: new THREE.Color(mixHex(palette.water, 0x000000, 0.3)) },
      uNormalB: { value: createWaterNormalMap("coarse") },
      uDepthRange: { value: 1.2 }, uEdgeFade: { value: options.edgeFade ?? 0.25 },
      uWaveScale: { value: new THREE.Vector2(1 / 8, 1 / 3.7) },
      uWaveScrollA: { value: options.waveScrollA ?? new THREE.Vector2(0.012, 0.004) },
      uWaveScrollB: { value: options.waveScrollB ?? new THREE.Vector2(-0.0159, 0.0104) },
    };
    if (!options.time) this.waterUniforms.push(uniforms);
    const time = reference('value', 'float', uniforms.uTime);
    const range = reference('value', 'float', uniforms.uDepthRange);
    const edgeFade = reference('value', 'float', uniforms.uEdgeFade);
    const shallow = reference('value', 'color', uniforms.uShallow);
    const deep = reference('value', 'color', uniforms.uDeep);
    const scale = reference('value', 'vec2', uniforms.uWaveScale);
    const scrollA = reference('value', 'vec2', uniforms.uWaveScrollA);
    const scrollB = reference('value', 'vec2', uniforms.uWaveScrollB);
    const authoredDepth = attribute('aWaterDepth', 'float' as const);
    let depth: import('three/webgpu').Node<'float'> = authoredDepth;
    if (ocean) {
      const gridUniforms = this.oceanDepthUniforms;
      const fallback = new THREE.DataTexture(new Float32Array(4), 2, 2, THREE.RedFormat, THREE.FloatType);
      fallback.minFilter = fallback.magFilter = THREE.NearestFilter;
      fallback.needsUpdate = true;
      material.addEventListener('dispose', () => fallback.dispose());
      const grid = texture(this.oceanDepthTexture ?? fallback).onRenderUpdate(() => this.oceanDepthTexture ?? fallback);
      const ready = reference('value', 'float', gridUniforms.uOceanDepthReady);
      const bounds = reference('value', 'vec4', gridUniforms.uOceanGridBounds);
      const size = reference('value', 'vec2', gridUniforms.uOceanGridSize);
      const step = reference('value', 'vec2', gridUniforms.uOceanGridStep);
      const sea = reference('value', 'float', gridUniforms.uOceanSeaLevel);
      depth = Fn(() => {
        const world = positionWorld.xz;
        const result = max(range, authoredDepth).toVar();
        const inside = ready.greaterThanEqual(0.5).and(world.x.greaterThanEqual(bounds.x))
          .and(world.y.greaterThanEqual(bounds.y)).and(world.x.lessThanEqual(bounds.z)).and(world.y.lessThanEqual(bounds.w));
        If(inside, () => {
          const gridPosition = world.sub(bounds.xy).div(step).clamp(vec2(0), size.sub(1));
          const cell = min(gridPosition.floor(), size.sub(2));
          const f = gridPosition.sub(cell);
          const a = textureLoad(grid, ivec2(cell)).r;
          const b = textureLoad(grid, ivec2(cell.add(vec2(1, 0)))).r;
          const c = textureLoad(grid, ivec2(cell.add(vec2(0, 1)))).r;
          const d = textureLoad(grid, ivec2(cell.add(1))).r;
          // Match the coast mesh's triangle diagonal, interpolating height before depth clamping.
          const low = a.add(b.sub(a).mul(f.x)).add(c.sub(a).mul(f.y));
          const high = d.add(c.sub(d).mul(float(1).sub(f.x))).add(b.sub(d).mul(float(1).sub(f.y)));
          result.assign(max(0, sea.sub(f.x.add(f.y).lessThanEqual(1).select(low, high))));
        });
        return result;
      })();
    }
    const depth01 = depth.div(range).clamp(0, 1);
    composeSurface(material, {
      color: previous => previous.rgb.mul(mix(shallow, deep, depth01)),
      opacity: previous => previous.mul(smoothstep(0, edgeFade, depth))
        .mul(ocean ? mix(0.94, 1, depth01) : 1),
      normal: () => {
        const waveA = texture(material.normalMap!, positionWorld.xz.mul(scale.x).add(scrollA.mul(time))).xyz.mul(2).sub(1);
        const waveB = texture(uniforms.uNormalB.value, positionWorld.xz.mul(scale.y).add(scrollB.mul(time))).xyz.mul(2).sub(1);
        const slope = vec3(waveA.xy.add(waveB.xy), waveA.z.mul(waveB.z)).normalize();
        const scaled = slope.xy.mul(sourceMaterialReference<'vec2'>(material, 'normalScale', 'vec2'));
        return cameraViewMatrix.mul(vec4(scaled.x, slope.z, scaled.y, 0)).xyz.normalize();
      },
    });
    material.userData.corealmWater = { uniforms, oceanDepth: ocean ? this.oceanDepthUniforms : null };
    environmentResponse(material, WATER_ENV_RESPONSE);
    return material;
  }

  /**
   * Snapshot the completed coast mesh grid. Replacing or clearing it releases the prior texture;
   * cached ocean materials keep their uniform wrappers, while lakes never receive these uniforms.
   * WorldScene must clear this field when clearing or rebuilding its coast.
   */
  setOceanDepthGrid(grid: OceanDepthGrid | null, seaLevel = 0): void {
    if (!Number.isFinite(Math.fround(seaLevel))) {
      throw new RangeError("Ocean sea level must be finite");
    }
    const bounds = grid ? oceanDepthGridBounds(grid) : null;
    let texture: THREE.DataTexture | null = null;
    if (grid) {
      texture = new THREE.DataTexture(grid.heights.slice(), grid.cols, grid.rows, THREE.RedFormat, THREE.FloatType);
      texture.name = "ocean-coast-depth";
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.unpackAlignment = 1;
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
    }
    const previousTexture = this.oceanDepthTexture;
    this.oceanDepthTexture = texture;
    const uniforms = this.oceanDepthUniforms;
    uniforms.uOceanDepthGrid.value = texture;
    uniforms.uOceanDepthReady.value = grid ? 1 : 0;
    uniforms.uOceanSeaLevel.value = seaLevel;
    if (grid && bounds) {
      uniforms.uOceanGridBounds.value.set(grid.minX, grid.minZ, bounds.maxX, bounds.maxZ);
      uniforms.uOceanGridSize.value.set(grid.cols, grid.rows);
      uniforms.uOceanGridStep.value.set(grid.stepX, grid.stepZ);
    } else {
      uniforms.uOceanGridBounds.value.set(0, 0, 0, 0);
      uniforms.uOceanGridSize.value.set(2, 2);
      uniforms.uOceanGridStep.value.set(1, 1);
    }
    previousTexture?.dispose();
  }

  /** Advances every animated material. View-only: nothing here feeds semantic state. */
  setTime(seconds: number): void {
    this.timeSeconds = seconds;
    this.magicTreeTime.value = seconds;
    for (const uniforms of this.waterUniforms) uniforms.uTime.value = seconds;
    for (const uniforms of this.windUniforms) uniforms.uCorealmWindTime.value = seconds;
  }

  /** Exposed stone face for cliffs and terrace risers. */
  cliff(regionId: RegionId): MeshStandardNodeMaterial {
    return this.surface(REGION_PALETTES[regionId].rock, 0.96, 0);
  }

  /** Metal for tools, weapons, and ore veins. Restrained: low metalness keeps it readable. */
  metal(tier: number): MeshStandardNodeMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["metal", palette.tier]), () =>
      new MeshStandardNodeMaterial({
        color: palette.metal,
        roughness: 0.55,
        metalness: 0.35,
        emissive: palette.emissive > 0 ? palette.metal : 0x000000,
        emissiveIntensity: palette.emissive,
      }));
  }

  /**
   * The exposed ore seam sitting on a node's rock body.
   *
   * This is the half of the readability contract that colour on the rock alone could not carry.
   * The body takes the tier's `body` swatch through `variant()`; this material is the vein on top
   * of it, so a node reads as "grey rock + warm ochre vein" (Grithe) or "blue-black rock + cyan
   * fracture line" (Kaldite) exactly as the PRD authors them, instead of two grey rocks.
   *
   * Two deliberate departures from the raw palette:
   *  - `raiseContrast` pushes saturation and value up. `palette.metal` is authored to sit NEXT to
   *    the body colour on a chart, not on top of it; unmodified it loses the value contrast that
   *    makes the vein visible at 12 m.
   *  - a small emissive floor even at tiers with no authored glow, because an unlit ochre line
   *    disappears the moment the rock falls into shadow, which in Gravelmaw is always.
   *
   * Cached per (tier, depleted), so every ore node in a region shares one material instance.
   */
  oreRock(tier: number, depleted: boolean): MeshStandardNodeMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["ore", palette.tier, depleted]), () => {
      const colour = new THREE.Color(depleted ? palette.body : palette.metal);
      if (depleted) applyDepletion(colour);
      else raiseContrast(colour);
      const glow = depleted ? 0 : Math.max(SEAM_GLOW, palette.emissive);
      return new MeshStandardNodeMaterial({
        color: colour,
        roughness: depleted ? 0.98 : 0.62,
        metalness: depleted ? 0 : 0.25,
        emissive: glow > 0 ? colour.clone() : new THREE.Color(0x000000),
        emissiveIntensity: glow,
        // Faceted, so the shards read as crystal against the smooth-shaded rock they sit in.
        flatShading: true,
      });
    });
  }

  foliage(tier: number): MeshStandardNodeMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["foliage", palette.tier]), () =>
      new MeshStandardNodeMaterial({
        color: palette.accent,
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide,
      }));
  }

  /**
   * Region colour for one Medieval Village material, derived from the texture's own luminance.
   *
   * A normal material colour is multiplied into its map channel by channel. That can darken the
   * orange roof texture but cannot make it slate because the texture has very little blue to begin
   * with. This treatment samples the finished base colour after `<map_fragment>`, keeps its linear
   * luminance, and replaces only chroma before the ordinary lights, shadows, fog and tone mapping.
   * Tile joints, plaster flecks, mortar and wood grain therefore survive the regional recolour.
   *
   * One derived material is cached per source, region and role. Its name and shader cache key both
   * carry the style identity because `EntityViews` batches equal materials across separately loaded
   * GLBs. Omitting either key could paint one region with another region's compiled shader.
   */
  architecture(
    base: THREE.Material,
    regionId: RegionId,
    role: ArchitectureMaterialRole,
  ): THREE.Material {
    const source = ensureNodeMaterial(base);
    if (!(source instanceof MeshStandardNodeMaterial)) return source;

    const key = this.key(["architecture", this.baseKey(base), regionId, role]);
    return this.remember(key, () => {
      const treatment = ARCHITECTURE_TREATMENT[role];
      const tint = new THREE.Color(ARCHITECTURE_PALETTES[regionId][role]);
      const tintLuminance = Math.max(1e-4, luminance(tint));
      // Unit-luminance chroma. The shader restores the texture's own value by multiplying this by
      // the sampled texel luminance, then applies the deliberately restrained role brightness.
      tint.multiplyScalar(1 / tintLuminance);

      const clone = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
      const brightness = treatment.brightness * (regionId === "wilderness" ? .52 : 1);
      clone.name = `${source.name || "MeshStandardNodeMaterial"}@architecture:${regionId}:${role}`;
      composeSurface(clone, { color: previous => {
        const luminanceNode = previous.dot(vec3(0.2126, 0.7152, 0.0722));
        const value = luminanceNode.sub(0.18).mul(treatment.contrast).add(0.18).clamp(0, 1);
        const tinted = value.mul(vec3(tint.r, tint.g, tint.b)).clamp(0, 1);
        return mix(previous, tinted, treatment.strength).mul(brightness);
      } });
      return clone;
    });
  }

  /**
   * THE tier-variant entry point, and the reason instancing survives 36 tier x family combinations.
   *
   * Given a material that came off a loaded GLB, this returns a cached variant that keeps the
   * ORIGINAL maps (base colour texture, alpha settings, side) and only swaps colour, roughness and
   * emissive. One texture, many tiers, one InstancedMesh per (asset, variant) pair.
   */
  variant(base: THREE.Material, spec: VariantSpec): THREE.Material {
    const source = ensureNodeMaterial(base);
    const palette = paletteForTier(spec.tier);
    const state: SurfaceState = spec.state ?? "normal";
    const strength = Math.min(1, Math.max(0, spec.strength ?? 0.55));
    const swatch: PaletteSwatch = spec.swatch ?? "metal";
    const glow = Math.max(0, spec.glow ?? 0);

    // A zero-strength, unlit, live surface IS the source material. Handing back the original
    // instance rather than an identical clone is not a micro-optimisation: a clone is a second
    // material, and a second material on the same geometry is a second draw call downstream.
    // Props, non-architectural landmarks and NPC art all take this path because they have no tier
    // ladder to express. Architecture takes the separate region-aware path above.
    if (strength === 0 && glow === 0 && state === "normal") return source;

    const key = this.key(["variant", this.baseKey(base), palette.tier, state, strength, swatch, glow]);

    return this.remember(key, () => {
      if (!(source instanceof MeshStandardNodeMaterial)) {
        // Non-standard materials (rare, and only from third-party GLBs) pass through unchanged
        // rather than being silently replaced with something that does not match the art.
        return source;
      }
      const target = new THREE.Color(swatchColour(palette, swatch));
      const clone = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
      // clone() keeps the same texture object references. Do NOT reassign clone.map.
      clone.color = new THREE.Color(source.color.getHex()).lerp(target, strength);
      // A tier tint on a TEXTURED material changes hue only. This is the fix for the black
      // geometry, and it is arithmetic rather than taste: three multiplies `color` by the base
      // colour map per fragment, and these kits author `baseColorFactor` as a white multiplier with
      // all of the value in the texture, so pulling that multiplier toward a mid-value tier swatch
      // multiplies an already-dark texture a SECOND time. Measured live at the `rootfall` pose with
      // runs/corealm/audit/lit-probe.ts, which reports `material.color` x the mean texel of its map
      // as an effective albedo: the `Rocks` material reads 0.0895 untinted, and 0.0295 / 0.0256 /
      // 0.0196 at tiers 1 / 5 / 10 — up to 4.6x darker. On screen in w2-rootfall.png that put the
      // Hollowcut ore nodes at rgb (12,18,19) and (16,20,18) against the grass beside them at
      // (65,72,47), which is the reported "pure-black scatter geometry". Rescaling keeps the
      // swatch's HUE, which is the entire job of a tier tint, and leaves the value where the
      // texture's author put it. Untextured materials are untouched: with no map, `color` IS the
      // albedo and the swatch's value is the point.
      if (source.map) preserveLuminance(clone.color, source.color);
      clone.roughness = Math.min(1, source.roughness * 0.9 + 0.12);
      // The 0.12 metalness floor that used to apply to EVERY variant now applies only when the
      // variant is being pulled toward a tier's metal swatch. It was authored before this game had
      // an environment map, when metalness only changed how the sun's specular lobe behaved. With
      // `scene.environment` present, metalness is what decides how much of the sky a surface
      // returns, and forcing 0.12 onto cloth, leather, hide and painted wood put a blue sheen on
      // every retinted NPC and every piece of worn equipment in the game.
      clone.metalness = state === "normal"
        ? (swatch === "metal" ? Math.max(source.metalness, 0.12) : source.metalness)
        : 0;
      if (state !== "normal") {
        applyDepletion(clone.color);
        clone.roughness = 1;
        clone.metalness = 0;
        clone.emissive = new THREE.Color(0x000000);
        clone.emissiveIntensity = 0;
      } else {
        const intensity = Math.max(glow, palette.emissive);
        if (intensity > 0) {
          clone.emissive = target.clone();
          clone.emissiveIntensity = intensity;
        }
      }
      return clone;
    });
  }

  /**
   * Desaturated, darkened treatment for a depleted node or a dead body when no `depletedAssetId`
   * is authored. Same geometry, same texture, different bucket — a state change costs one matrix
   * write, never a mesh rebuild.
   */
  depleted(base: THREE.Material): THREE.Material {
    const source = ensureNodeMaterial(base);
    const key = this.key(["depleted", this.baseKey(base)]);
    return this.remember(key, () => {
      if (!(source instanceof MeshStandardNodeMaterial)) return source;
      const clone = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
      clone.color = new THREE.Color(source.color.getHex());
      applyDepletion(clone.color);
      clone.roughness = 1;
      clone.metalness = 0;
      clone.emissive = new THREE.Color(0x000000);
      clone.emissiveIntensity = 0;
      return clone;
    });
  }

  /** Hover / selection ring. Unlit so it stays legible against dark terrain and in shadow. */
  highlight(colour: string | number): MeshBasicNodeMaterial {
    const value = typeof colour === "string" ? new THREE.Color(colour).getHex() : colour;
    return this.remember(this.key(["highlight", value]), () =>
      new MeshBasicNodeMaterial({
        color: value,
        transparent: true,
        opacity: 0.68,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })) as MeshBasicNodeMaterial;
  }

  /** Stable identity for a source material, so variants of the same base share a cache namespace. */
  private baseKey(base: THREE.Material): string {
    const existing = this.variantKeys.get(base);
    if (existing) return existing;
    const created = `${base.name || base.type}#${(this.nextVariantKey += 1)}`;
    this.variantKeys.set(base, created);
    return created;
  }

  /**
   * Retints an asset's existing materials for a tier while keeping its base texture.
   * This is how one source mesh becomes a whole tier ladder without new art.
   *
   * `accept` exists because a blanket retint is wrong on character art: pulling an eye, a tooth or
   * a pure-black trim toward the tier colour destroys the read of the face while doing nothing for
   * tier legibility. Callers pass a predicate; materials it rejects are left exactly as authored
   * (and, via `variant`'s zero-strength path, are not even cloned).
   */
  retint(
    object: THREE.Object3D,
    tier: number,
    strength = 0.7,
    swatch: PaletteSwatch = "metal",
    accept: (material: THREE.Material) => boolean = () => true,
  ): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = materials.map((source) =>
        this.variant(source, { tier, swatch, strength: accept(source) ? strength : 0 }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  size(): number {
    return this.cache.size;
  }

  dispose(): void {
    this.setOceanDepthGrid(null);
    this.setFairyGroundSurface(null);
    for (const material of new Set(this.cache.values())) material.dispose();
    this.cache.clear();
    this.groundUniforms?.uCobble.value.dispose();
    this.groundUniforms = null;
    this.groundStoneUniforms.uGroundStoneAlbedo.value = null;
    this.groundStoneUniforms.uGroundStoneNormal.value = null;
    this.groundStoneUniforms.uGroundStoneRoughness.value = null;
    this.groundStoneUniforms.uGroundStoneReady.value = 0;
    this.waterUniforms = [];
    this.windUniforms = [];
    this.grassSpriteMaterial = null;
    this.foliageOcclusion.setEnabled(false);
    this.timeSeconds = 0;
    disposeGeneratedTextures();
  }
}

/**
 * Depleted nodes go nearly grey and lose almost half their value, so "spent" reads at a glance
 * from the default pitch.
 *
 * Round 1 used s*0.55 / l*0.78. On a rock texture that is already desaturated and mid-value, that
 * is a change of a few percent per channel — a state transition nobody could see, which is why the
 * PRD's "visible state change" was not met. This is deliberately blunt.
 */
function applyDepletion(colour: THREE.Color): void {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, hsl.s * 0.15, Math.max(0.06, hsl.l * 0.55));
}

/** Rec. 709 luminance of a colour in the linear working space. */
function luminance(colour: THREE.Color): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/**
 * Rescales `colour` in place so it returns as much light as `reference` does, keeping its hue.
 *
 * The scale is capped so no channel passes 1.0, because an albedo above 1 is a surface that emits.
 * That cap costs a little of the target luminance — for a white source pulled 0.55 toward the
 * tier-5 body swatch the result lands at 0.970 of the source rather than 1.000 — and losing 3% is
 * the right trade against reflecting more light than arrives.
 */
function preserveLuminance(colour: THREE.Color, reference: THREE.Color): void {
  const want = luminance(reference);
  const have = luminance(colour);
  if (have <= 1e-4 || want <= 1e-4) return;
  const peak = Math.max(colour.r, colour.g, colour.b, 1e-4);
  colour.multiplyScalar(Math.min(want / have, 1 / peak));
}

/** Emissive floor on an ore seam, so a vein still reads in shadow and underground. */
const SEAM_GLOW = 0.3;

/**
 * Pushes a swatch up in saturation and value. Used on the ore seam: the tier palette's `metal` is
 * authored to sit beside its `body`, not on top of it, and side by side at 12 m the two collapse
 * into one grey blob without this.
 */
function raiseContrast(colour: THREE.Color): void {
  const hsl = { h: 0, s: 0, l: 0 };
  colour.getHSL(hsl);
  colour.setHSL(hsl.h, Math.min(1, hsl.s * 1.5 + 0.16), Math.min(0.82, hsl.l * 1.2 + 0.12));
}
