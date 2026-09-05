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
import type { RegionId } from "../contracts.js";
import { oceanDepthGridBounds, type OceanDepthGrid } from "../world/coastDepth.js";
import { createArtDirectedMaterial, type ArtSurfaceRole } from "./artDirection.js";
import { createFoliageOcclusionMaterial, FoliageOcclusion } from "./foliageOcclusion.js";
import type { CorealmSurfaceTextures } from "./corealmSurfaceMaterials.js";
import {
  DETAIL_TILING_METRES,
  DETAIL_VALUE_OFFSET,
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

/**
 * Per-material-class image-based-lighting scale, injected as a shader constant.
 *
 * It has to be a constant in the shader rather than `material.envMapIntensity`, and that is a
 * measured property of three 0.185, not a preference. In `WebGLRenderer.setProgram`:
 *
 *   if ( ( material.isMeshStandardMaterial || ... ) && material.envMap === null &&
 *        scene.environment !== null ) m_uniforms.envMapIntensity.value = scene.environmentIntensity;
 *
 * — for any material lit by `scene.environment` rather than its own `envMap`, which is every
 * material in this game, `envMapIntensity` is OVERWRITTEN by the scene value every frame. Setting
 * it per material does nothing at all. Scaling `getIBLIrradiance` and `getIBLRadiance` where they
 * are summed is the same arithmetic and it actually takes effect.
 *
 * Costs nothing: both callers already carry a `customProgramCacheKey`, so no extra program is
 * compiled and the value is folded at compile time.
 */
function iblScale(scale: number): string {
  const s = scale.toFixed(3);
  return /* glsl */ `
#if defined( RE_IndirectDiffuse )
  #ifdef USE_LIGHTMAP
    vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
    irradiance += lightMapTexel.rgb * lightMapIntensity;
  #endif
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
    #if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
      iblIrradiance += getIBLIrradiance( geometryNormal ) * ${s};
    #endif
  #endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * ${s};
#endif
`;
}
// The stock chunk also branches on USE_ANISOTROPY and USE_CLEARCOAT. Neither define can be set
// here: both callers are plain MeshStandardMaterials, and neither anisotropy nor clearcoat exists
// on that class in three, so the branches would be dead source.

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

const WIND_VERTEX_HEADER = /* glsl */ `
uniform float uCorealmWindTime;
uniform float uCorealmWindStrength;
`;

const WIND_VERTEX_BODY = /* glsl */ `
{
  // Geometry roots sit at or below local y = 0. Only the flexible height bends.
  float gWindHeight = smoothstep( 0.0, 0.75, max( position.y, 0.0 ) );
  vec4 gWindOrigin = vec4( 0.0, 0.0, 0.0, 1.0 );
  #ifdef USE_BATCHING
    gWindOrigin = batchingMatrix * gWindOrigin;
  #endif
  #ifdef USE_INSTANCING
    gWindOrigin = instanceMatrix * gWindOrigin;
  #endif
  gWindOrigin = modelMatrix * gWindOrigin;

  // Translation changes phase without another attribute or material per instance.
  float gWindPhase = dot( gWindOrigin.xz, vec2( 0.173, 0.277 ) );
  float gWindMain = sin( uCorealmWindTime * 0.82 + gWindPhase );
  float gWindRipple = sin( uCorealmWindTime * 1.67 + gWindPhase * 1.31 + position.y * 0.73 );
  vec2 gWindBend = vec2( 0.86, 0.51 ) * gWindMain + vec2( -0.22, 0.37 ) * gWindRipple;
  transformed.xz += gWindBend * uCorealmWindStrength * gWindHeight;
}
`;

// ------------------------------------------------------------ ground splat
//
// Eight surface weights per vertex, packed as two normalised Uint8 vec4s written by
// `WorldScene.buildChunk` (8 bytes/vertex, about 584 KB over the world's ~73k terrain vertices):
//
//   aSplatA = (grass, dryGrass, rock, gravel)
//   aSplatB = (dirt, mud, cobble, wet)
//
// plus `aGround`, which carries the things a weight cannot express:
//
//   aGround.x  signed distance to the nearest road centreline, remapped -3.5..3.5 m onto 0..1
//   aGround.y  1 where a road is within reach, so wheel ruts exist only on roads
//   aGround.z  how worn the track is, 0 at the shoulder to 1 on the centreline
//   aGround.w  the macro-variation field, 0.5 at its mean
//
// plus `aPaved`, one byte: WHICH of the three paved surfaces the cobble weight above is made of,
// 0 laid stone / 0.5 dressed block / 1 sawn plank (`PAVING_SURFACE_CODE` in render/scene.ts). A
// settlement is paved by stamping the ground, not by laying 2 m slabs on it, so the course pattern
// has to be drawn here.
//
// The ruts are computed in the FRAGMENT shader from the interpolated perpendicular distance, not
// from a vertex weight, because the terrain lattice is 2 m and a rut band is 0.2 m wide: at vertex
// resolution a rut lands between samples and is never drawn at all.

const GROUND_VERTEX_HEADER = /* glsl */ `
attribute vec4 aSplatA;
attribute vec4 aSplatB;
attribute vec4 aGround;
attribute float aPaved;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vGroundExtra;
varying vec3 vGroundWorld;
varying float vPaved;
`;

const GROUND_VERTEX_BODY = /* glsl */ `
vSplatA = aSplatA;
vSplatB = aSplatB;
vGroundExtra = aGround;
vPaved = aPaved;
vGroundWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const GROUND_FRAGMENT_HEADER = /* glsl */ `
uniform sampler2D uDetail;
uniform sampler2D uMacro;
uniform sampler2D uNormalGS;
uniform sampler2D uNormalRV;
uniform sampler2D uCobble;
uniform float uCobbleTiling;
uniform sampler2D uGroundStoneAlbedo;
uniform sampler2D uGroundStoneNormal;
uniform sampler2D uGroundStoneRoughness;
uniform vec3 uGroundStoneMean;
uniform float uGroundStoneTiling;
uniform float uGroundStoneReady;
uniform vec4 uDetailTiling;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec4 vGroundExtra;
varying vec3 vGroundWorld;
varying float vPaved;
float gMacroShade;
vec2 gGroundBump;
vec2 gCobbleBump;
float gCobbleCoverage;
float gCobbleRoughness;

// One hash per unit laid, off the unit's own cell index, so a stone keeps its tone across a chunk
// seam and adding a paving rect cannot re-roll the one next to it.
float gPavedHash( vec2 cell ) {
  return fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
`;

const GROUND_FRAGMENT_BODY = /* glsl */ `
{
  vec2 detailUv = vGroundWorld.xz * uDetailTiling.x;
  vec4 detail = texture2D( uDetail, detailUv ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};
  vec4 near = texture2D( uMacro, vGroundWorld.xz * uDetailTiling.y ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};
  vec4 middle = texture2D( uMacro, vGroundWorld.xz * uDetailTiling.z ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};
  vec4 macro = texture2D( uMacro, vGroundWorld.xz * uDetailTiling.w ) + ${DETAIL_VALUE_OFFSET.toFixed(1)};

  // Atlas channels are R grass, G soil, B rock, A gravel; the macro texture uses the same order.
  // The eight per-vertex weights fold onto those four, and dry grass is deliberately SPLIT rather
  // than dumped whole into soil: a crest of dry grass that reads as bare dirt is why the shipped
  // build had no grassland variation at all, only "green" and "brown".
  vec4 channel = vec4(
    vSplatA.x + 0.55 * vSplatA.y,
    0.45 * vSplatA.y + vSplatB.x + vSplatB.y + vSplatB.w,
    vSplatA.z,
    vSplatA.w + vSplatB.z
  );
  // Sharpened BEFORE normalising. The weights arrive as a partition of unity, so a seam between two
  // surfaces is a linear ramp and the four detail values simply average across it — which is why a
  // rock/grass or road/grass boundary reads as one uniform tint rather than as two surfaces
  // meeting. Squaring costs one multiply and turns a 70/30 vertex into 84/16, so each surface holds
  // its own character until the last metre of the seam. Anything sharper than a square starts
  // showing the 2 m terrain lattice as a staircase along the boundary.
  channel *= channel;
  float total = max( 0.001, channel.x + channel.y + channel.z + channel.w );
  channel /= total;

  // Preserve the broad 16/40 m color variation while quieting the 6.3 m pattern. Multiplication
  // lets each scale fade through its own mip levels without changing the region's base palette.
  float macroShade = mix( 1.0, dot( channel, near ), 0.45 )
    * mix( 1.0, dot( channel, middle ), 0.72 )
    * mix( 1.0, dot( channel, macro ), 0.72 );
  // Fine terrain grain supports the authored meshes. Gravel keeps stronger per-stone variation;
  // the rock channel's dense ridges stay subordinate to the outcrop's broad faces.
  float detailStrength = dot( channel, vec4( 0.28, 0.25, 0.36, 0.65 ) );
  float shade = clamp( mix( 1.0, dot( channel, detail ), detailStrength ) * macroShade, 0.50, 1.46 );

  // Two wheel ruts at +/-0.55 m from the centreline, 0.16 m wide.
  float perpendicular = ( vGroundExtra.x - 0.5 ) * 7.0;
  float rut = vGroundExtra.y * exp( -pow( ( abs( perpendicular ) - 0.55 ) / 0.16, 2.0 ) );
  shade *= 1.0 - 0.22 * rut;

  // The macro reads alone drive the screen-space bump in GROUND_NORMAL_BODY. The detail read is
  // excluded from it because the detail atlas now has a real normal map of its own, and running
  // both off the same signal counts its relief twice.
  gMacroShade = macroShade * ( 1.0 - 0.22 * rut );

  // PER-CHANNEL RELIEF, sampled from the two normal maps generated alongside the albedo atlas.
  // Both store the world X and Z of a heightfield normal, because the atlas is mapped planar in
  // world XZ, so blending is a weighted sum of the four tangential pairs and no tangent frame is
  // needed. The channel weights are already a partition of unity, so the blend can never exceed
  // any one surface's authored relief.
  vec4 bumpGS = texture2D( uNormalGS, detailUv ) * 2.0 - 1.0;
  vec4 bumpRV = texture2D( uNormalRV, detailUv ) * 2.0 - 1.0;
  gGroundBump = channel.x * bumpGS.xy + channel.y * bumpGS.zw
              + channel.z * bumpRV.xy + channel.w * bumpRV.zw;

  // PER-SURFACE CHROMA, and this is the part that survives distance.
  //
  // Everything above is a VALUE multiplier read out of a texture, and every texture read mips
  // toward its own mean, so past about 20 m all four channels converge on the same colour. The
  // contrast stretch in proceduralTextures.ts is what stops that happening this side of 60 m:
  // measured on palewood_copse open ground, the 20-60 m band went p5..p95 = 101.9..177.0 with a
  // high-pass RMS of 8.67 to 93.5..209.2 and 11.31, the near band 109.3..130.7 / 6.22 to
  // 105.2..137.7 / 6.31, and the near road 89.6..117.6 / 3.83 to 88.5..125.6 / 5.05.
  //
  // These tints come from the WEIGHTS, not from a texture, so they do not mip and they are the
  // only surface signal left at 60 m. Each vector is normalised to Rec. 709 luminance 1.0, so this
  // rotates hue and cannot move the region palette's value — REGION_PALETTES still decides how
  // light the ground is, and this decides what it is made of.
  //
  // Grass gets two, and the dryness selector comes from the 40 m macro read, whose 3 authored
  // cells put its patches at about 13.3 m across, which is the feature size the 20-60 m band
  // needs. Tying it to
  // the same channel that brightens the shade is deliberate — straw IS brighter than sward, so the
  // value and the hue move together instead of fighting.
  const vec3 TINT_GRASS_LUSH = vec3( 0.880, 1.056, 0.802 );
  const vec3 TINT_GRASS_DRY  = vec3( 1.115, 0.998, 0.685 );
  const vec3 TINT_SOIL       = vec3( 1.184, 0.973, 0.722 );
  const vec3 TINT_ROCK       = vec3( 0.987, 0.997, 1.068 );
  const vec3 TINT_GRAVEL     = vec3( 1.035, 0.996, 0.937 );
  // 0.88..1.16, widened with the channel. The macro grass channel's sigma went 0.077 -> 0.140, and
  // at the old 0.93..1.11 window that is +/-0.64 sigma: dryness would saturate to 0 or 1 across
  // most of the field and the sward/straw boundary would read as a drawn edge rather than as one
  // drying into the other. +/-1.0 sigma keeps the transition about as soft as it was.
  float dryness = smoothstep( 0.88, 1.16, macro.x );
  vec3 tint = channel.x * mix( TINT_GRASS_LUSH, TINT_GRASS_DRY, dryness )
            + channel.y * TINT_SOIL
            + channel.z * TINT_ROCK
            + channel.w * TINT_GRAVEL;

  // LAID GROUND.
  //
  // Paving is stamped into terrain. Gathered cobble combines fitted faces with the same authored
  // stone PBR maps as the quarry assets. World-XZ coordinates keep its size fixed in metres
  // across terrain chunks. Cobble joints and stone grain fade through their mip chains;
  // the drawn brick and plank joints include the pixel footprint to avoid distant shimmer.
  float paved = vSplatB.z;
  // Gathered stone uses a separate irregular pattern. Brick and plank retain their laid courses.
  float wStone = max( 0.0, 1.0 - vPaved * 2.0 );
  float wPlank = max( 0.0, vPaved * 2.0 - 1.0 );
  float wBrick = 1.0 - wStone - wPlank;
  float cobbled = paved * wStone;
  gCobbleCoverage = cobbled;
  gCobbleBump = vec2( 0.0 );
  gCobbleRoughness = 0.97;
  if ( cobbled > 0.004 ) {
    vec4 cobble = texture2D( uCobble, vGroundWorld.xz * uCobbleTiling );
    vec3 stoneDetail = vec3( 1.0 );
    vec2 stoneNormal = vec2( 0.0 );
    if ( uGroundStoneReady > 0.5 ) {
      vec2 stoneUv = vGroundWorld.xz * uGroundStoneTiling;
      vec3 stoneRelative = texture2D( uGroundStoneAlbedo, stoneUv ).rgb / uGroundStoneMean;
      float stoneLuma = dot( stoneRelative, vec3( 0.2126, 0.7152, 0.0722 ) );
      stoneRelative = mix( vec3( stoneLuma ), stoneRelative, 0.45 );
      stoneDetail = clamp( mix( vec3( 1.0 ), stoneRelative, 0.86 ), vec3( 0.42 ), vec3( 1.90 ) );
      stoneNormal = texture2D( uGroundStoneNormal, stoneUv ).xy * 2.0 - 1.0;
      float stoneRoughness = texture2D( uGroundStoneRoughness, stoneUv ).g;
      gCobbleRoughness = mix( 0.95, clamp( stoneRoughness, 0.52, 0.96 ), cobble.a );
    }
    float cobbleShade = cobble.r * 1.5 * macroShade;
    shade = mix( shade, cobbleShade, cobbled );
    gGroundBump *= 1.0 - cobbled;
    gCobbleBump = ( cobble.gb * 2.0 - 1.0 ) + stoneNormal * 0.65 * cobble.a;
    gMacroShade = mix( gMacroShade, macroShade, cobbled );
    tint = mix( tint, mix( vec3( 1.0 ), stoneDetail, cobble.a ), cobbled );
  }
  float laid = paved * ( 1.0 - wStone );
  if ( laid > 0.004 ) {

    // Unit size in metres. Gathered stone is nearly square and hand sized; a dressed block is a
    // long shallow course; a plank is 2.4 m of sawmill run, 30 cm wide.
    vec2 unit = vec2( 0.62, 0.52 ) * wStone + vec2( 0.68, 0.30 ) * wBrick + vec2( 2.40, 0.30 ) * wPlank;
    float jointW = 0.045 * wStone + 0.026 * wBrick + 0.020 * wPlank;
    float toneVar = 0.30 * wStone + 0.15 * wBrick + 0.22 * wPlank;
    float jointDark = 0.52 * wStone + 0.60 * wBrick + 0.66 * wPlank;

    // Keep every course on a mason's line. The former stone-only sine warp turned the whole paved
    // field into broad repeating waves and made an altar court read like scales. Random bond,
    // per-stone tone, variable joints, and the detail atlas already supply enough irregularity.
    vec2 p = vGroundWorld.xz;
    vec2 q = p;

    // Bond. A block wall is a running bond, half a unit per course; stone and plank are staggered
    // at random, because a random stagger is what a mason and a sawyer both actually produce.
    float row = floor( q.y / unit.y );
    float bond = mix( gPavedHash( vec2( row, 7.3 ) ), fract( row * 0.5 ), wBrick );
    float colf = q.x / unit.x + bond;
    vec2 cell = vec2( floor( colf ), row );

    // Metres to the nearest joint, along whichever axis is closer.
    float border = min(
      ( 0.5 - abs( fract( colf ) - 0.5 ) ) * unit.x,
      ( 0.5 - abs( fract( q.y / unit.y ) - 0.5 ) ) * unit.y
    );
    float tone = gPavedHash( cell + 0.5 );
    // Joint width varies per unit, which is most of what separates stone bedded by hand from a
    // printed grid.
    float footprint = fwidth( p.x ) + fwidth( p.y );
    float face = smoothstep( 0.0, jointW * ( 0.55 + 0.9 * tone ) + footprint, border );
    // Grain along the plank, which is the one thing that says sawn timber rather than long stone.
    float grain = 1.0 + wPlank * 0.085 * sin( q.x * 23.0 + tone * 40.0 );
    // The detail atlas still runs underneath at a quarter strength: the surface keeps its grit
    // without the gravel channel deciding what a paved square looks like.
    float bed = mix( 1.0, detail.w, 0.25 );

    float pavedShade = ( 1.0 - toneVar * 0.5 + toneVar * tone )
      * mix( jointDark, 1.0, face ) * grain * bed;
    shade = mix( shade, clamp( pavedShade * macroShade, 0.42, 1.46 ), laid );
    // Joints as relief, through the screen-space bump the macro reads already drive. It fades out
    // with the joint, so the grooves are there underfoot and gone by the time they would shimmer.
    gMacroShade = mix( gMacroShade, macroShade * mix( 0.78, 1.0, face ), laid );
    // The gravel channel's warm tint is the bed a slab was set in. The paving IS the ground now,
    // and its hue is the swatch the vertex already carries.
    tint = mix( tint, vec3( 1.0 ), laid );
  }

  diffuseColor.rgb *= shade * tint;
}
`;

/**
 * Screen-space bump strength for the three MACRO reads.
 *
 * The macro texture has no normal map — it is sampled at 6.3, 16 and 40 m, so a single stored
 * relief would be wrong at two of the three rates — and a screen-space derivative is the right
 * tool at that scale: `gMacroShade` is already in registers, so this costs two `dFdx`-class
 * instructions and no fetch, and it is automatically mip-correct.
 *
 * Broad color patches need only shallow relief. The lower response keeps those patches from
 * reading as ripples under the low sun; authored terrain geometry supplies the large slopes.
 */
const GROUND_MACRO_BUMP_SCALE = 0.6;

/**
 * Strength multiplier on the detail normal maps, on top of the metres of relief baked into them.
 *
 * 1.0 means the atlas's authored relief is taken literally. It is set by looking at the ground at
 * the camera's actual pitch and height — the shot presets sit 6-34 m out at a 28-38 degree
 * pitch — rather than at a debug close-up, because relief that reads correctly with the surface
 * filling the frame is roughly twice too strong once the same surface is 20 m away and lit at a
 * grazing angle.
 */
const GROUND_NORMAL_SCALE = 0.3;

const GROUND_NORMAL_BODY = /* glsl */ `
{
  // three's own perturbNormalArb, inlined: that function is compiled only under USE_BUMPMAP and
  // this material has no bumpMap, so it is not in the program to call. Macro relief only.
  vec2 dHdxy = vec2( dFdx( gMacroShade ), dFdy( gMacroShade ) ) * ${GROUND_MACRO_BUMP_SCALE.toFixed(1)};
  vec3 sigmaX = normalize( dFdx( - vViewPosition ) );
  vec3 sigmaY = normalize( dFdy( - vViewPosition ) );
  vec3 r1 = cross( sigmaY, normal );
  vec3 r2 = cross( normal, sigmaX );
  float det = dot( sigmaX, r1 );
  normal = normalize( abs( det ) * normal - sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 ) );

  // Detail relief, added in WORLD space and rotated into view space by the view matrix's rotation.
  // The atlas is mapped planar in world XZ, so its stored components ARE the world X and Z of the
  // perturbed normal; adding them to the geometric normal and renormalising is the standard cheap
  // blend, and on ground that is within about 20 degrees of level — which is all of it outside the
  // Karrowmoor risers — it is within a degree of the exact frame construction. viewMatrix is a
  // rigid transform, so mat3 of it needs no inverse-transpose.
  vec3 worldBump = vec3( gGroundBump.x, 0.0, gGroundBump.y ) * ${GROUND_NORMAL_SCALE.toFixed(1)};
  normal = normalize( normal + mat3( viewMatrix ) * worldBump );
  // Cobble crowns need their own response. The terrain's 0.3 grain scale flattened these broad
  // faces even though the sampled normals were valid. This term is zero off stone pavement.
  vec3 cobbleWorldBump = vec3( gCobbleBump.x, 0.0, gCobbleBump.y ) * 0.72 * gCobbleCoverage;
  normal = normalize( normal + mat3( viewMatrix ) * cobbleWorldBump );
}
`;

// ------------------------------------------------------------------- water

const WATER_VERTEX_HEADER = /* glsl */ `
attribute float aWaterDepth;
varying float vWaterDepth;
varying vec3 vWaterWorld;
`;

const WATER_VERTEX_BODY = /* glsl */ `
vWaterDepth = aWaterDepth;
vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const WATER_FRAGMENT_HEADER = /* glsl */ `
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform sampler2D uNormalB;
uniform float uDepthRange;
uniform float uEdgeFade;
uniform vec2 uWaveScale;
uniform vec2 uWaveScrollA;
uniform vec2 uWaveScrollB;
varying float vWaterDepth;
varying vec3 vWaterWorld;
`;

const WATER_FRAGMENT_BODY = /* glsl */ `
{
  float depth01 = clamp( vWaterDepth / uDepthRange, 0.0, 1.0 );
  diffuseColor.rgb *= mix( uShallow, uDeep, depth01 );
  // The geometry already stops at the waterline, so this only softens the last few centimetres.
  diffuseColor.a *= smoothstep( 0.0, uEdgeFade, vWaterDepth );
}
`;

// The full-world coast supplies the same raw heights used by its triangles. Manual nearest
// sampling avoids float-linear-filter requirements and preserves the actual shoreline slope.
const OCEAN_DEPTH_FRAGMENT_HEADER = /* glsl */ `
uniform sampler2D uOceanDepthGrid;
uniform float uOceanDepthReady;
uniform vec4 uOceanGridBounds;
uniform vec2 uOceanGridSize;
uniform vec2 uOceanGridStep;
uniform float uOceanSeaLevel;

float corealmOceanDepth( vec2 worldXZ ) {
  if ( uOceanDepthReady < 0.5
    || any( lessThan( worldXZ, uOceanGridBounds.xy ) )
    || any( greaterThan( worldXZ, uOceanGridBounds.zw ) ) ) {
    return max( uDepthRange, vWaterDepth );
  }
  vec2 gridPosition = clamp(
    ( worldXZ - uOceanGridBounds.xy ) / uOceanGridStep,
    vec2( 0.0 ), uOceanGridSize - vec2( 1.0 )
  );
  vec2 cell = min( floor( gridPosition ), uOceanGridSize - vec2( 2.0 ) );
  vec2 f = gridPosition - cell;
  float a = texture2D( uOceanDepthGrid, ( cell + vec2( 0.5, 0.5 ) ) / uOceanGridSize ).r;
  float b = texture2D( uOceanDepthGrid, ( cell + vec2( 1.5, 0.5 ) ) / uOceanGridSize ).r;
  float c = texture2D( uOceanDepthGrid, ( cell + vec2( 0.5, 1.5 ) ) / uOceanGridSize ).r;
  float d = texture2D( uOceanDepthGrid, ( cell + vec2( 1.5, 1.5 ) ) / uOceanGridSize ).r;
  // Match the coast's (a,c,b), (b,c,d) diagonal. Interpolate raw height before clamping depth.
  float height = f.x + f.y <= 1.0
    ? a + ( b - a ) * f.x + ( c - a ) * f.y
    : d + ( c - d ) * ( 1.0 - f.x ) + ( b - d ) * ( 1.0 - f.y );
  return max( 0.0, uOceanSeaLevel - height );
}
`;

const OCEAN_FRAGMENT_BODY = /* glsl */ `
{
  float depth = corealmOceanDepth( vWaterWorld.xz );
  float depth01 = clamp( depth / uDepthRange, 0.0, 1.0 );
  diffuseColor.rgb *= mix( uShallow, uDeep, depth01 );
  // Deep water must not reveal where the finite coastal floor ends. Shallows keep their fade.
  diffuseColor.a *= smoothstep( 0.0, uEdgeFade, depth ) * mix( 0.94, 1.0, depth01 );
}
`;

const WATER_NORMAL_BODY = /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 waveA = texture2D( normalMap, vWaterWorld.xz * uWaveScale.x + uWaveScrollA * uTime ).xyz * 2.0 - 1.0;
  vec3 waveB = texture2D( uNormalB, vWaterWorld.xz * uWaveScale.y + uWaveScrollB * uTime ).xyz * 2.0 - 1.0;
  // Partial-derivative blend: add the slopes, keep the product of the up components.
  vec3 mapN = normalize( vec3( waveA.xy + waveB.xy, waveA.z * waveB.z ) );
  mapN.xy *= normalScale;
  // The surface is an unrotated horizontal plane, so tangent space is world space with y and z
  // swapped. No tangent attribute and no getTangentFrame call, and it stays correct across
  // three.js versions that reshuffle the tangent chunk.
  //
  // viewMatrix, not normalMatrix: three declares normalMatrix in its VERTEX prefix only, so the
  // obvious version of this line fails to compile with "undeclared identifier" and the water
  // silently falls back to an error material.
  normal = normalize( ( viewMatrix * vec4( mapN.x, mapN.z, mapN.y, 0.0 ) ).xyz );
#endif
`;

/**
 * Material cache. Identical descriptors must return the identical material instance, or instancing
 * silently fragments and the draw-call budget is gone.
 */
export class MaterialLibrary {
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
  private grassSpriteMaterial: THREE.MeshStandardMaterial | null = null;
  private timeSeconds = 0;
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
  surface(colour: number, roughness = 0.92, metalness = 0): THREE.MeshStandardMaterial {
    return this.remember(this.key(["surface", colour, roughness, metalness]), () =>
      new THREE.MeshStandardMaterial({ color: colour, roughness, metalness, flatShading: false }));
  }

  /** Shared organic treatment after tier/state colour and before animation shader extensions. */
  organic(source: THREE.Material, role: ArtSurfaceRole): THREE.Material {
    return this.remember(this.key(["organic", this.baseKey(source), role]), () => {
      const graded = createArtDirectedMaterial(source, role);
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

  setFoliageOcclusionEnabled(enabled: boolean): void {
    this.foliageOcclusionEnabled = enabled;
    if (!enabled) this.foliageOcclusion.setEnabled(false);
  }

  updatePlayerOcclusion(
    renderer: THREE.WebGLRenderer,
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
   * horizon AO. What `onBeforeCompile` adds is the VALUE detail the vertex colour physically
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
  ground(): THREE.MeshStandardMaterial {
    return this.remember("ground", () => {
      const material = new THREE.MeshStandardMaterial({
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

      material.customProgramCacheKey = () => "corealm-ground-splat-v11";
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uDetail = uniforms.uDetail;
        shader.uniforms.uMacro = uniforms.uMacro;
        shader.uniforms.uNormalGS = uniforms.uNormalGS;
        shader.uniforms.uNormalRV = uniforms.uNormalRV;
        shader.uniforms.uCobble = uniforms.uCobble;
        shader.uniforms.uCobbleTiling = uniforms.uCobbleTiling;
        shader.uniforms.uDetailTiling = uniforms.uDetailTiling;
        Object.assign(shader.uniforms, this.groundStoneUniforms);

        shader.vertexShader = `${GROUND_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${GROUND_VERTEX_BODY}`,
        );
        shader.fragmentShader = `${GROUND_FRAGMENT_HEADER}\n${shader.fragmentShader}`
          .replace("#include <map_fragment>", `#include <map_fragment>\n${GROUND_FRAGMENT_BODY}`)
          .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, gCobbleRoughness, gCobbleCoverage );`)
          .replace("#include <normal_fragment_maps>", GROUND_NORMAL_BODY)
          .replace("#include <lights_fragment_maps>", iblScale(GROUND_ENV_RESPONSE));
      };
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
  grassSprite(): THREE.MeshStandardMaterial {
    if (this.grassSpriteMaterial) return this.grassSpriteMaterial;

    const source = new THREE.MeshStandardMaterial({
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
    source.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
vec3 grassUp = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
normal = normalize( mix( normal, grassUp, 0.78 ) );`,
      );
    };
    source.customProgramCacheKey = () => "corealm-grass-light-v1";
    this.grassSpriteMaterial = this.wind(this.organic(source, "foliage"), GRASS_WIND_STRENGTH) as THREE.MeshStandardMaterial;
    return this.grassSpriteMaterial;
  }

  grassBlades(): THREE.Material {
    return this.remember("grass-blades", () => {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.92 });
      source.name = "Corealm folded grass blades";
      source.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
vec3 grassUp = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
normal = normalize(mix(normal, grassUp, 0.45));`);
      };
      source.customProgramCacheKey = () => "corealm-grass-blades-v1";
      return this.wind(this.organic(source, "foliage"), GRASS_WIND_STRENGTH);
    });
  }

  /**
   * Adds a small GPU-side bend while preserving the source material's own shader hook.
   *
   * The clone shares every texture with `source`. One cached clone serves each source/strength
   * pair, and a translation-derived phase keeps instances and BatchedMesh entries out of lockstep.
   */
  wind(source: THREE.Material, strength: number): THREE.Material {
    const amount = Number.isFinite(strength) ? Math.max(0, strength) : 0;
    if (amount === 0) return source;

    const key = this.key(["wind", this.baseKey(source), amount]);
    return this.remember(key, () => {
      const clone = source.clone();
      const sourceCompile = source.onBeforeCompile;
      const sourceProgramKey = source.customProgramCacheKey.bind(source);
      const uniforms: WindUniforms = {
        uCorealmWindTime: { value: this.timeSeconds },
        uCorealmWindStrength: { value: amount },
      };
      this.windUniforms.push(uniforms);

      clone.name = `${source.name || source.type}@wind:${amount}`;
      clone.onBeforeCompile = (shader, renderer) => {
        sourceCompile.call(source, shader, renderer);
        shader.uniforms.uCorealmWindTime = uniforms.uCorealmWindTime;
        shader.uniforms.uCorealmWindStrength = uniforms.uCorealmWindStrength;
        shader.vertexShader = `${WIND_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${WIND_VERTEX_BODY}`,
        );
      };
      // Strength is a uniform, so every wind material can share the same compiled program shape.
      clone.customProgramCacheKey = () => `${sourceProgramKey()}|corealm-wind-v1`;
      return clone;
    });
  }

  /** Shadow passes sample the identical wind displacement and clock as the visible foliage. */
  windShadow(source: THREE.Material, strength: number, mode: "depth" | "distance"): THREE.Material {
    return this.remember(this.key(["wind-shadow", this.baseKey(source), strength, mode]), () => {
      const original = source as THREE.MeshStandardMaterial;
      const shadow = mode === "depth"
        ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
        : new THREE.MeshDistanceMaterial();
      shadow.name = `${source.name}:${mode}`;
      shadow.map = original.map ?? null;
      shadow.alphaMap = original.alphaMap ?? null;
      shadow.alphaTest = original.alphaTest;
      shadow.side = original.side;
      shadow.displacementMap = original.displacementMap ?? null;
      shadow.displacementScale = original.displacementScale ?? 1;
      shadow.displacementBias = original.displacementBias ?? 0;
      const animated = this.wind(shadow, strength);
      if (animated !== shadow) shadow.dispose();
      return animated;
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
  water(regionId: RegionId = "fallowmarch", mode: "lake" | "ocean" = "lake"): THREE.MeshStandardMaterial {
    const ocean = mode === "ocean";
    return this.remember(this.key(["water", regionId, mode]), () => {
      const palette = REGION_PALETTES[regionId];
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.14,
        metalness: 0,
        transparent: true,
        opacity: ocean ? 1 : 0.94,
        // The basin owns a closed bank. Rendering the back face would make an invalid or clipped
        // water plane visible from below, which is the exact defect the basin closure prevents.
        side: THREE.FrontSide,
        depthWrite: false,
        normalMap: createWaterNormalMap("fine"),
        normalScale: new THREE.Vector2(0.55, 0.55),
      });
      material.name = ocean ? `ocean-${regionId}` : `water-${regionId}`;

      const uniforms = {
        uTime: { value: this.timeSeconds },
        // Shallow lifts 45% toward the region's own low ground so the edge of the water agrees
        // with the bank it meets; deep darkens 30%, which is the whole depth cue.
        uShallow: { value: new THREE.Color(mixHex(palette.water, palette.groundLow, 0.45)) },
        uDeep: { value: new THREE.Color(mixHex(palette.water, 0x000000, 0.3)) },
        uNormalB: { value: createWaterNormalMap("coarse") },
        // Metres of depth over which the tint runs, and metres over which the edge fades out.
        uDepthRange: { value: 1.2 },
        uEdgeFade: { value: 0.25 },
        // 8.0 m and 3.7 m tiling. Scroll 0.012 and -0.019 m/s, 33 degrees apart, so neither the
        // pattern nor the drift direction ever resolves as one moving texture.
        uWaveScale: { value: new THREE.Vector2(1 / 8, 1 / 3.7) },
        uWaveScrollA: { value: new THREE.Vector2(0.012, 0.004) },
        uWaveScrollB: { value: new THREE.Vector2(-0.0159, 0.0104) },
      };
      this.waterUniforms.push(uniforms);

      material.customProgramCacheKey = () => ocean ? "corealm-ocean-water-v1" : "corealm-water-v2";
      material.onBeforeCompile = (shader) => {
        for (const [name, uniform] of Object.entries(uniforms)) shader.uniforms[name] = uniform;
        if (ocean) {
          for (const [name, uniform] of Object.entries(this.oceanDepthUniforms)) shader.uniforms[name] = uniform;
        }

        shader.vertexShader = `${WATER_VERTEX_HEADER}\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n${WATER_VERTEX_BODY}`,
        );
        shader.fragmentShader = `${WATER_FRAGMENT_HEADER}\n${ocean ? OCEAN_DEPTH_FRAGMENT_HEADER : ""}\n${shader.fragmentShader}`
          .replace("#include <map_fragment>", `#include <map_fragment>\n${ocean ? OCEAN_FRAGMENT_BODY : WATER_FRAGMENT_BODY}`)
          .replace("#include <normal_fragment_maps>", WATER_NORMAL_BODY)
          .replace("#include <lights_fragment_maps>", iblScale(WATER_ENV_RESPONSE));
      };
      return material;
    });
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
    for (const uniforms of this.waterUniforms) uniforms.uTime.value = seconds;
    for (const uniforms of this.windUniforms) uniforms.uCorealmWindTime.value = seconds;
  }

  /** Exposed stone face for cliffs and terrace risers. */
  cliff(regionId: RegionId): THREE.MeshStandardMaterial {
    return this.surface(REGION_PALETTES[regionId].rock, 0.96, 0);
  }

  /** Metal for tools, weapons, and ore veins. Restrained: low metalness keeps it readable. */
  metal(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["metal", palette.tier]), () =>
      new THREE.MeshStandardMaterial({
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
  oreRock(tier: number, depleted: boolean): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["ore", palette.tier, depleted]), () => {
      const colour = new THREE.Color(depleted ? palette.body : palette.metal);
      if (depleted) applyDepletion(colour);
      else raiseContrast(colour);
      const glow = depleted ? 0 : Math.max(SEAM_GLOW, palette.emissive);
      return new THREE.MeshStandardMaterial({
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

  foliage(tier: number): THREE.MeshStandardMaterial {
    const palette = paletteForTier(tier);
    return this.remember(this.key(["foliage", palette.tier]), () =>
      new THREE.MeshStandardMaterial({
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
    const source = base as THREE.MeshStandardMaterial;
    if (!source.isMeshStandardMaterial) return base;

    const key = this.key(["architecture", this.baseKey(base), regionId, role]);
    return this.remember(key, () => {
      const treatment = ARCHITECTURE_TREATMENT[role];
      const tint = new THREE.Color(ARCHITECTURE_PALETTES[regionId][role]);
      const tintLuminance = Math.max(1e-4, luminance(tint));
      // Unit-luminance chroma. The shader restores the texture's own value by multiplying this by
      // the sampled texel luminance, then applies the deliberately restrained role brightness.
      tint.multiplyScalar(1 / tintLuminance);

      const clone = source.clone();
      const sourceCompile = source.onBeforeCompile;
      const sourceProgramKey = source.customProgramCacheKey();
      const shaderKey = `architecture-luma-v2:${regionId}:${role}`;
      const strength = treatment.strength.toFixed(3);
      const brightness = treatment.brightness.toFixed(3);
      const contrast = treatment.contrast.toFixed(3);
      const tintVector = `vec3(${tint.r.toFixed(6)}, ${tint.g.toFixed(6)}, ${tint.b.toFixed(6)})`;

      clone.name = `${source.name || "MeshStandardMaterial"}@architecture:${regionId}:${role}`;
      clone.onBeforeCompile = (shader, renderer) => {
        sourceCompile.call(source, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          /* glsl */ `#include <map_fragment>
float gArchitectureLuminance = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
float gArchitectureValue = clamp( ( gArchitectureLuminance - 0.18 ) * ${contrast} + 0.18, 0.0, 1.0 );
vec3 gArchitectureTinted = clamp( gArchitectureValue * ${tintVector}, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, gArchitectureTinted, ${strength} ) * ${brightness};`,
        );
      };
      clone.customProgramCacheKey = () => `${sourceProgramKey}|${shaderKey}`;
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
    const source = base as THREE.MeshStandardMaterial;
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
    if (strength === 0 && glow === 0 && state === "normal") return base;

    const key = this.key(["variant", this.baseKey(base), palette.tier, state, strength, swatch, glow]);

    return this.remember(key, () => {
      if (!source.isMeshStandardMaterial) {
        // Non-standard materials (rare, and only from third-party GLBs) pass through unchanged
        // rather than being silently replaced with something that does not match the art.
        return source;
      }
      const target = new THREE.Color(swatchColour(palette, swatch));
      const clone = source.clone();
      clone.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(source, shader, renderer);
      clone.customProgramCacheKey = source.customProgramCacheKey.bind(source);
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
    const source = base as THREE.MeshStandardMaterial;
    const key = this.key(["depleted", this.baseKey(base)]);
    return this.remember(key, () => {
      if (!source.isMeshStandardMaterial) return source;
      const clone = source.clone();
      clone.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(source, shader, renderer);
      clone.customProgramCacheKey = source.customProgramCacheKey.bind(source);
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
  highlight(colour: string | number): THREE.MeshBasicMaterial {
    const value = typeof colour === "string" ? new THREE.Color(colour).getHex() : colour;
    return this.remember(this.key(["highlight", value]), () =>
      new THREE.MeshBasicMaterial({
        color: value,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })) as THREE.MeshBasicMaterial;
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
