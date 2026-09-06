/**
 * Scene composition: the walkable world surface, roads, water, scatter hosting, and the player view.
 *
 * Round 1 turns the round-0 single square into THREE connected regions in ONE coordinate system.
 * The important structural decision: there is a single continuous height function over the whole
 * world, and region identity is a weight on that function rather than a separate mesh per region.
 * Regions therefore cannot have a seam or a navmesh gap by construction — a seam would need two
 * height functions disagreeing at a border, and there is only one.
 *
 *   h(x,z) = SUM_i w_i(x,z) * h_i(x,z) / SUM_i w_i(x,z)
 *
 * When organic biome data exists, the same normalized hub-and-band weights blend relief, palette,
 * and scatter. Authored rectangles still own semantic regions and world bounds. Older specs keep
 * the signed-distance rectangle blend as a fallback.
 *
 * The second structural decision, added later: THE GROUND ABSORBS THE THINGS DRAWN ON IT. Roads,
 * paved squares and waterlogged banks are per-vertex surface weights and colours on the terrain
 * mesh, not separate geometry laid over it. That removed 42 transparent depth-write-off road
 * ribbons — the frame's largest overdraw source and its largest single draw-call block — and with
 * them a whole family of defects that only exist when two surfaces describe the same ground:
 * z-fighting, a lift tuned against the wrong interpolant, and an unpainted hole at every junction.
 *
 * Everything the surface knows is sampled onto ONE 2 m height lattice, the same lattice the chunk
 * meshes are tessellated from and the same one `heightfieldSamples` hands to Rapier, so the drawn
 * ground, the physics ground and every derived quantity are the same surface by construction.
 *
 * This file owns no gameplay state. It reads geometry parameters and draws.
 */
import * as THREE from "three";
import { createGrassBladeGeometry } from "./grassBlades.js";
import type { WorldSite } from "../content/worldSites.js";
import { applyWorldSiteTerrain, worldSiteWorkFloorWeight } from "../world/siteTerrain.js";
import { portalLandformHeight, type PortalLandform } from "../world/portalLandform.js";
import type { GroundSurfaceSample, RegionId, Vec3 } from "../contracts.js";
import { GRASS_WIND_STRENGTH, MaterialLibrary, REGION_PALETTES, surfaceColour } from "./materials.js";
import { artSurfaceRoleForMaterial } from "./artDirection.js";
import { finalizeScatterBounds, scatterWindMargin } from "./scatterBounds.js";
import { ScatterVisibility } from "./scatterVisibility.js";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../app/config.js";
import { Rng } from "../core/rng.js";
import { clamp } from "../core/math.js";
import { yieldToMainThread } from "../core/yield.js";
import { resolveWaterBasinBaseHeight, waterBasinOuterBankHeight, type WaterBasinSpec } from "../world/waterBodies.js";
import {
  organicDistance,
  sampleOrganicBiomeWeights,
  sampleOrganicCoast,
  type OrganicBiomeSpec,
  type OrganicCoastShapeSpec,
  type OrganicShapeSpec,
} from "../world/organicFields.js";

// ----------------------------------------------------------------- specs

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * How a region's ground behaves. Character is what makes the three regions feel authored rather
 * than "the same noise with a different colour".
 */
export type RegionCharacter = "plains" | "woodland" | "highlands" | "cavern";

export interface RegionTerrainSpec {
  regionId: RegionId;
  /** Region rects tile semantic ownership with no gaps and define the legacy relief blend. */
  rect: Rect;
  seed: number;
  character: RegionCharacter;
  /** Vertical offset of the region's floor, in metres. */
  baseHeight: number;
  /** Peak displacement of the region's own relief, in metres. */
  amplitude: number;
  /**
   * Which way "uphill" runs for terraced characters, and from which end.
   *
   * The canonical region data in `content/regions.ts` authors Karrowmoor's terraces as z-bands
   * climbing toward -z, so the axis cannot be hardcoded to x. `"-z"` means the low end is at
   * `rect.maxZ` and the ridge is at `rect.minZ`.
   */
  terraceAxis?: "+x" | "-x" | "+z" | "-z";
  /** Number of terrace steps. Defaults to 4. */
  terraceSteps?: number;
}

/** A flattened pad. Settlements need buildable ground; noise does not provide it. */
export interface FlatSpot {
  x: number;
  z: number;
  /** Fully flat inside this radius. Ignored when `halfExtents` is set. */
  radius: number;
  /** Metres of falloff outside the radius. */
  blend: number;
  /** Explicit height. Defaults to the natural height at the centre. */
  height?: number;
  /**
   * Rectangular pad, as half-extents along the pad's local x and z. When present the core is that
   * rectangle rather than a circle, and `radius` is only used to size the falloff sweep.
   *
   * This exists because a circular pad cannot hold a terrace. Highcairn is authored around an 18 m
   * riser and its 35 m circular pad erases the whole thing: the region's one piece of designed
   * verticality becomes a disc of uniform grey, visible in terrain-highcairn as an arc where the
   * pad boundary meets the hillside. A rectangle whose long axis runs ALONG the terrace flattens
   * the building ground without touching the riser above or below it.
   */
  halfExtents?: readonly [number, number];
  /** Yaw of a rectangular pad, in radians. Ignored for circular pads. */
  rotationY?: number;
}

export interface WorldTerrainSpec {
  bounds: Rect;
  /** One draw call per chunk. 100 m over a 700x400 world is 28 chunks. */
  chunkSize: number;
  /** Terrain grid resolution. 2 m keeps the whole world under 150k triangles. */
  metresPerQuad: number;
  /** Half-width of the legacy rectangular relief blend, in metres. */
  blendMetres: number;
  regions: RegionTerrainSpec[];
  flats?: FlatSpot[];
  worldSites?: readonly WorldSite[];
  portalLandforms?: readonly Omit<PortalLandform, "floorY">[];
  /** Closed recessed profiles for authored water. Applied after flats and haul roads. */
  basins?: WaterBasinSpec[];
  /** Normalized hub-and-band fields shared by terrain relief, palette, and scatter. */
  biomes?: OrganicBiomeSpec<RegionId>;
  /** Render-only land edge and ocean. It never expands physics, navigation, or map bounds. */
  coast?: CoastSpec;
}

export interface CoastSpec extends OrganicCoastShapeSpec {
  /** Rendered land outside the playable bounds, in metres. */
  collar: number;
  seaLevel: number;
  /** Seabed depth below sea level at the outside of the collar. */
  floorDepth: number;
  /** Coast mesh spacing. Match `metresPerQuad` so the inner edge shares the terrain lattice. */
  gridStep: number;
  /** Ocean plane size. Keep this comfortably beyond the camera far plane and fog. */
  oceanSize: number;
}

interface ResolvedWaterBasin extends WaterBasinSpec {
  /** Terrain height at the centre before this basin is applied. */
  baseY: number;
  floorY: number;
  level: number;
}

/**
 * THE Corealm region layout. One coordinate system, 700 m x 400 m, three vertical bands running
 * west to east in ascending tier order, so the whole route Fallowmarch -> Vellenwood -> Karrowmoor
 * is one continuous walk with no loading and no teleport.
 *
 *   Fallowmarch  x -360 .. -120   (240 x 400)   centre (-240, 0)   floor  0 m
 *   Vellenwood   x -120 .. +110   (230 x 400)   centre   (-5, 0)   floor +4 m
 *   Karrowmoor   x +110 .. +340   (230 x 400)   centre (+225, 0)   floor +6 m, rising to +42 m
 *
 * Seams: x = -120 (Fallowmarch/Vellenwood) and x = +110 (Vellenwood/Karrowmoor).
 */
export const COREALM_WORLD: WorldTerrainSpec = {
  bounds: { minX: -360, maxX: 340, minZ: -200, maxZ: 200 },
  chunkSize: 100,
  metresPerQuad: 2,
  blendMetres: 45,
  regions: [
    {
      regionId: "fallowmarch",
      rect: { minX: -360, maxX: -120, minZ: -200, maxZ: 200 },
      seed: 0x0f4110,
      character: "plains",
      baseHeight: 0,
      amplitude: 15,
    },
    {
      regionId: "vellenwood",
      rect: { minX: -120, maxX: 110, minZ: -200, maxZ: 200 },
      seed: 0x0e11e2,
      character: "woodland",
      baseHeight: 4,
      amplitude: 22,
    },
    {
      regionId: "karrowmoor",
      rect: { minX: 110, maxX: 340, minZ: -200, maxZ: 200 },
      seed: 0x4a2200,
      character: "highlands",
      baseHeight: 6,
      amplitude: 36,
    },
  ],
};

// ----------------------------------------------------------------- noise

/**
 * Deterministic value noise. Seeded so terrain is identical across reloads and test runs.
 * Exported because the scatter system masks off the same noise family.
 */
export function createValueNoise(seed: number): (x: number, z: number) => number {
  const rng = new Rng(seed);
  const permutation = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) source[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const swap = source[i]!;
    source[i] = source[j]!;
    source[j] = swap;
  }
  for (let i = 0; i < 512; i += 1) permutation[i] = source[i & 255]!;

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  const grad = (hash: number, x: number, z: number): number => {
    const h = hash & 3;
    const u = h < 2 ? x : z;
    const v = h < 2 ? z : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  return (x: number, z: number): number => {
    const xi = Math.floor(x) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(zf);
    const aa = permutation[permutation[xi]! + zi]!;
    const ab = permutation[permutation[xi]! + zi + 1]!;
    const ba = permutation[permutation[xi + 1]! + zi]!;
    const bb = permutation[permutation[xi + 1]! + zi + 1]!;
    return mix(
      mix(grad(aa, xf, zf), grad(ba, xf - 1, zf), u),
      mix(grad(ab, xf, zf - 1), grad(bb, xf - 1, zf - 1), u),
      v,
    );
  };
}

type Noise2D = (x: number, z: number) => number;
type HeightSampler = (x: number, z: number) => number;

/** Fractal sum. Returns roughly -1..1. */
function fbm(noise: Noise2D, x: number, z: number, octaves: number, featureSize: number): number {
  let total = 0;
  let amplitude = 1;
  let normaliser = 0;
  let frequency = 1 / featureSize;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise(x * frequency, z * frequency) * amplitude;
    normaliser += amplitude;
    amplitude *= 0.48;
    frequency *= 2.07;
  }
  return total / normaliser;
}

function smoothstep01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Node probes count as development; Vite production explicitly supplies `DEV: false`. */
function isDevelopmentBuild(): boolean {
  const environment = (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env;
  return environment?.DEV !== false;
}

/** Positive inside the rect, negative outside, in metres. */
function signedDepth(rect: Rect, x: number, z: number): number {
  const qx = Math.max(rect.minX - x, x - rect.maxX);
  const qz = Math.max(rect.minZ - z, z - rect.maxZ);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qz), 0);
  return -(outside + inside);
}

function pointInContour(x: number, z: number, contour: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index, index += 1) {
    const a = contour[index];
    const b = contour[previous];
    if (!a || !b) continue;
    const crosses = (a[1] > z) !== (b[1] > z)
      && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Soft terrace. `riserFraction` of each band is the climb, the rest is flat. Keeping the riser
 * wide is what makes Karrowmoor's verticality survive navmesh generation: a hard step would be a
 * vertical wall and Detour would drop the terrace above it out of the connected mesh.
 */
function terrace(t: number, riserFraction: number): number {
  const index = Math.floor(t);
  const f = t - index;
  const flat = 1 - riserFraction;
  if (f <= flat) return index;
  return index + smoothstep01((f - flat) / riserFraction);
}

// ------------------------------------------------------------- the scene

interface RegionField {
  spec: RegionTerrainSpec;
  height: (x: number, z: number) => number;
  palette: (typeof REGION_PALETTES)[RegionId];
  /**
   * The height range the region's field ACTUALLY produces over the rendered land, swept at 4 m.
   *
   * Normalising against the measured range keeps the full authored palette available. `buildWorld`
   * measures the coast-expanded visual rectangle so the palette does not reset at a semantic edge.
   */
  hMin: number;
  hMax: number;
}

/**
 * The pieces of the world that change the GROUND rather than stand on it.
 *
 * Roads, paved squares and water bodies used to be separate geometry laid over the terrain: 42
 * transparent depth-write-off road ribbons (the frame's largest overdraw source and largest single
 * draw-call block), no paving at all, and a water disc that did not know where the bank was.
 * Stamped into the terrain's own vertex colours and splat weights they are mip-correct,
 * shadow-correct and z-fight-free by construction, and they cost nothing to draw.
 */
export interface RoadStamp {
  /** World-space polyline. Only x and z are read; the ground supplies y. */
  points: readonly Vec3[];
  /** Full worn width in metres. Defaults to 3.2 m. */
  width?: number;
}

/**
 * What a settlement paves in. Chooses the ground swatch AND the course pattern the ground shader
 * draws, which is the whole reason a paved area no longer needs slabs laid on it.
 */
export type PavingSurface = "stone" | "brick" | "plank";

export interface PavingStamp {
  centre: readonly [number, number];
  halfExtents: readonly [number, number];
  rotationY?: number;
  /** Defaults to laid stone. */
  surface?: PavingSurface;
  /** A kerbed rect is held to the line its kerb stands on. An unkerbed one frays into the ground. */
  kerb?: boolean;
}

/** The 0..1 code `aPaved` carries. Matched by the ground shader's three pattern weights. */
export const PAVING_SURFACE_CODE: Record<PavingSurface, number> = {
  stone: 0,
  brick: 0.5,
  plank: 1,
};

export interface WaterStamp {
  centre: readonly [number, number];
  radius: number;
  /** Surface height in metres. The mud and wet bands are placed against this. */
  level: number;
  /** Same deformation as the carved basin, so its wet-bank stamp follows the real shore. */
  shape?: OrganicShapeSpec;
}

/** Read-only proof of the basin and shoreline the renderer actually built. */
export interface WaterBodySnapshot {
  id: string;
  centre: [number, number];
  level: number;
  floorY: number;
  depth: number;
  radii: {
    floor: number;
    shore: number;
    crest: number;
    outer: number;
  };
  /** Closed shoreline points in world x/z order. */
  contour: [number, number][];
  closed: boolean;
  error?: string;
}

export interface GroundStamps {
  roads?: readonly RoadStamp[];
  paving?: readonly PavingStamp[];
  water?: readonly WaterStamp[];
  /** Seeds road meander; each road derives a stable child seed from its controls and width. */
  seed?: number;
}

/** Diagnostic counts for proving whether a terrain build needed a second vertex pass. */
export interface TerrainBuildStats {
  chunkBuildCount: number;
  restampPassCount: number;
  restampedVertexCount: number;
}

/** One instance in a `scatterInstanced` call. */
export interface ScatterPlacement {
  position: Vec3;
  rotationY: number;
  /** A single number scales uniformly; a triple scales per axis. */
  scale: number | readonly [number, number, number];
  /** Terrain normal to lean into. Omitted means upright. */
  normal?: Vec3;
  /** 0..1 fraction of the way from upright to fully aligned with `normal`. */
  tilt?: number;
}

/** One low-poly grass tuft rendered by `scatterGrassSprites`. */
export interface GrassSpritePlacement {
  position: Vec3;
  rotationY: number;
  /** Drawn width across either crossed card, in world metres. */
  width: number;
  /** Drawn height from the grounded base, in world metres. */
  height: number;
  /** Packed sRGB instance tint, multiplied by the shared blade shading. */
  colour: number;
  normal?: Vec3;
  tilt?: number;
}

/**
 * Two upright quads crossing at 90 degrees, both rooted at local y = 0.
 *
 * Four triangles replace 155-622 triangles in one source grass GLB. A crossed card is used rather
 * than `THREE.Sprite`: sprites do not batch through `InstancedMesh`, always face the full camera
 * pitch, and would collapse into screen-facing stamps in the overhead map. The crossed silhouette
 * reads from ground level and from above with no per-frame camera work.
 */
function createGrassSpriteGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, 0.5, 0, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function materialMovesInWind(material: THREE.Material): boolean {
  return /^(?:Leaves(?:_|$)|Flowers(?:_|$)|MI_Vine(?:_|$))/i.test(material.name);
}

export interface RegionLayout {
  regionId: RegionId;
  rect: Rect;
  centre: [number, number];
  character: RegionCharacter;
}

export interface HeightfieldSamples {
  /** Rapier wants (nrows+1) x (ncols+1) heights in COLUMN-major order. */
  heights: Float32Array;
  nrows: number;
  ncols: number;
  /** Total world extents the field covers. */
  scale: { x: number; y: number; z: number };
  /** Field centre in world space. */
  centre: { x: number; y: number; z: number };
}

export class WorldScene {
  readonly root = new THREE.Group();
  readonly terrainGroup = new THREE.Group();
  readonly scatterGroup = new THREE.Group();
  readonly entityGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();

  readonly materials = new MaterialLibrary();
  readonly scatterVisibility = new ScatterVisibility();
  /** Shared by every grass tile for this scene and retained across `clear()` rebuilds. */
  private readonly grassSpriteGeometry = createGrassSpriteGeometry();
  private grassBladeGeometry: THREE.BufferGeometry | null = null;

  setGrassSource(source: THREE.Object3D): void {
    this.grassBladeGeometry?.dispose();
    this.grassBladeGeometry = createGrassBladeGeometry(source);
  }

  hasNativeGrass(): boolean { return this.grassBladeGeometry !== null; }

  /** The meshes recast builds the navmesh from. Ground only — never scatter, never props. */
  private walkable: THREE.Mesh[] = [];
  private fields: RegionField[] = [];
  private mineSurfaces: { site: WorldSite; reach: number }[] = [];
  private portalLandforms: PortalLandform[] = [];
  private flats: FlatSpot[] = [];
  private basinSpecs: WaterBasinSpec[] = [];
  private basins: ResolvedWaterBasin[] = [];
  private world: WorldTerrainSpec | null = null;
  private scatterByRegion = new Map<RegionId, THREE.Object3D[]>();

  /**
   * The 2 m height lattice the terrain mesh is actually built from.
   *
   * `heightAtXZ` is the analytic field; the surface a player stands on and clicks is the mesh
   * INTERPOLATED between lattice nodes, and the two disagree by meanAbs 0.031 m (6.1% of samples
   * over 5 cm). That gap is why 10% of road ribbon vertices were below the drawn ground. Sampling
   * the lattice once and reading it everywhere makes the mesh, the physics heightfield and every
   * derived quantity agree by construction, and it turns the 24 horizon-AO samples per vertex from
   * 1.75M analytic field evaluations into 1.75M array reads.
   */
  private lattice: HeightLattice | null = null;
  /** The drawn render-only coast grid. It never enters physics, navigation, or terrain raycasts. */
  private coastGrid: CoastHeightGrid | null = null;
  private chunks: ChunkRecord[] = [];
  private roads: RoadSegment[] = [];
  private roadPolylines: Vec3[][] = [];
  private roadGrid = new Map<number, number[]>();
  private paving: PavingStamp[] = [];
  private waters: WaterStamp[] = [];
  private builtWaterBodies: WaterBodySnapshot[] = [];
  /**
   * The macro-variation field the surface weights are broken up with.
   *
   * Measured before it existed: on a settlement pad the terrain relief is EXACTLY 0.000 m, so the
   * altitude ramp that decides grass-versus-dry returns one number over the whole 7,238 m2 disc
   * and the square reads as a single flat swatch with a hard arc where it meets the hillside -
   * visible as the pale grey plate filling the foreground of runs/corealm/screenshots/
   * wire-town_entrance.png. Altitude is also the ONLY signal the weights had, and the height noise
   * has no content below a 21 m wavelength, so the same flatness applies at every scale a player
   * walks through. Two octaves of dedicated surface noise at 62 m and 19 m give the weights
   * something to vary by that the height field does not have to provide.
   */
  private surfaceNoise: Noise2D | null = null;
  /** Graded corridors joining flat pads the raw terrain cannot join. See `buildHaulRoads`. */
  private hauls: HaulRoad[] = [];
  private haulGrid = new Map<number, number[]>();
  /**
   * The pads that were authored with an explicit height — the fishing basins.
   *
   * They are holes, not places, so they are excluded from the haul-road graph: a corridor graded
   * down to a basin floor is a drainage channel, and nobody asked for one.
   */
  private carvedPads = new Set<FlatSpot>();
  /**
   * The pads a haul road is not allowed to regrade: buildable ground and water basins.
   *
   * Measured pad inventory for the authored world (47 pads): 40 location markers at radius 7 /
   * blend 9, three settlement pads at radius 26.1, 34.1 and 43, and four fishing basins carrying
   * an explicit height. The two populations are 19 m apart in radius, so a radius threshold
   * separates them cleanly and will keep separating them as settlements are re-authored.
   *
   * The distinction matters because the two kinds of pad want opposite things from a corridor. A
   * settlement pad IS the buildable ground - the `building-footing` gate line measures 0.000 m of
   * tilt across 46 footprints and a graded lane through it would be a trench across the town. A
   * location pad is a 7 m marker that exists so an interaction does not happen on a broken slope,
   * and `karrow_ramp_two` is literally named "Second Ramp": a road at road grade running through
   * it is what the content asked for. Carved pads are basins, and a road draining one is not a
   * road.
   */
  private protectedPads: FlatSpot[] = [];
  private terrainBuildStats: TerrainBuildStats = {
    chunkBuildCount: 0,
    restampPassCount: 0,
    restampedVertexCount: 0,
  };

  playerMesh: THREE.Object3D | null = null;
  private playerTarget = new THREE.Vector3();
  private playerFacing = 0;
  private lastSyncMs = 0;

  constructor(parent: THREE.Scene) {
    this.root.name = "corealm-world";
    // The input layer raycasts the object named "terrain" for click-to-move, so this group holds
    // ground and nothing else. Trees living in here would make every canopy click a move order.
    this.terrainGroup.name = "terrain";
    this.scatterGroup.name = "scatter";
    this.entityGroup.name = "entities";
    this.overlayGroup.name = "overlays";
    this.root.add(this.terrainGroup, this.scatterGroup, this.entityGroup, this.overlayGroup);
    parent.add(this.root);
  }

  // ------------------------------------------------------------ building

  /**
   * Builds the whole three-region world as one continuous surface, chunked for frustum culling.
   *
   * Returns the chunk meshes. They are already in the scene and already registered as walkable, so
   * the caller can hand them straight to `Navigation.build` and `Physics`.
   */
  buildWorld(
    spec: WorldTerrainSpec = COREALM_WORLD,
    prepareSurface?: (scene: WorldScene) => void,
  ): THREE.Mesh[] {
    const created: THREE.Mesh[] = [];
    for (const step of this.worldBuildSteps(spec, prepareSurface, created)) step();
    return created;
  }

  /**
   * The production boot variant of `buildWorld`.
   *
   * It executes the exact same ordered build steps and writes the exact same geometry, but yields
   * between authored field solves and terrain chunks. That keeps input and the loading UI moving
   * instead of presenting the browser with one multi-second task. The supplied scheduler is a test
   * seam; production uses a MessageChannel task yield.
   */
  async buildWorldYielding(
    spec: WorldTerrainSpec = COREALM_WORLD,
    prepareSurface?: (scene: WorldScene) => void,
    yieldToMain: () => Promise<void> = yieldToMainThread,
  ): Promise<THREE.Mesh[]> {
    const created: THREE.Mesh[] = [];
    const steps = this.worldBuildSteps(spec, prepareSurface, created);
    for (let index = 0; index < steps.length; index += 1) {
      steps[index]!();
      if (index + 1 < steps.length) await yieldToMain();
    }
    return created;
  }

  /** One canonical step list backs both the synchronous tools path and cooperative browser boot. */
  private worldBuildSteps(
    spec: WorldTerrainSpec,
    prepareSurface: ((scene: WorldScene) => void) | undefined,
    created: THREE.Mesh[],
  ): Array<() => void> {
    const { bounds, chunkSize } = spec;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const cols = Math.max(1, Math.round(width / chunkSize));
    const rows = Math.max(1, Math.round(depth / chunkSize));
    const chunkX = width / cols;
    const chunkZ = depth / rows;
    const segmentsX = Math.max(1, Math.round(chunkX / spec.metresPerQuad));
    const segmentsZ = Math.max(1, Math.round(chunkZ / spec.metresPerQuad));
    const coastPadding = Number.isFinite(spec.coast?.collar)
      ? Math.max(0, spec.coast?.collar ?? 0)
      : 0;
    const visualLandBounds: Rect = {
      minX: bounds.minX - coastPadding,
      maxX: bounds.maxX + coastPadding,
      minZ: bounds.minZ - coastPadding,
      maxZ: bounds.maxZ + coastPadding,
    };
    const material = this.materials.ground();
    const steps: Array<() => void> = [() => {
      this.terrainBuildStats = {
        chunkBuildCount: 0,
        restampPassCount: 0,
        restampedVertexCount: 0,
      };
      this.world = spec;
      this.portalLandforms = [];
      this.mineSurfaces = (spec.worldSites ?? []).filter((site) => site.kind === "mine").map((site) => ({
        site,
        reach: Math.hypot(site.extent[0], site.extent[1]),
      }));
      this.coastGrid = null;
      this.materials.setOceanDepthGrid(null);
      // Carry existing pads forward when rebuilding without a preceding clear().
      this.flats = [...this.flats, ...(spec.flats ?? [])].map((flat) => ({ ...flat }));
      this.basinSpecs = (spec.basins ?? []).map((basin) => ({ ...basin }));
      this.basins = [];
      this.builtWaterBodies = [];
      this.fields = [];
    }];

    for (const region of spec.regions) {
      steps.push(() => {
        const height = makeRegionField(region);
        const range = sweepFieldRange(visualLandBounds, height);
        this.fields.push({
          spec: region,
          height,
          palette: REGION_PALETTES[region.regionId],
          hMin: range.min,
          hMax: range.max,
        });
      });
    }

    steps.push(
      () => {
        // Its own stream, drawn once, so adding it shifts nothing else in the world's rng order.
        this.surfaceNoise = createValueNoise((spec.regions[0]?.seed ?? 0x5b0a11) ^ 0x51_7f_ac_e1);
        this.resolveFlatTargets();
      },
      () => this.buildHaulRoads(),
      () => this.normaliseFlats(),
      () => {
        this.portalLandforms = (spec.portalLandforms ?? []).map((landform) => ({
          ...landform,
          floorY: this.preBasinHeight(landform.centre[0], landform.centre[1]),
        }));
      },
      () => this.resolveBasins(),
      () => this.buildLattice(),
      // Roads and paving need the resolved height field, while water needs the exact lattice to
      // solve its shoreline. No chunk has been shaded at this point.
      () => { prepareSurface?.(this); },
    );

    for (let cz = 0; cz < rows; cz += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        steps.push(() => {
          const originX = bounds.minX + cx * chunkX;
          const originZ = bounds.minZ + cz * chunkZ;
          const mesh = this.buildChunk(originX, originZ, chunkX, chunkZ, segmentsX, segmentsZ, material);
          mesh.name = `terrain-chunk-${cx}-${cz}`;
          mesh.userData.walkable = true;
          mesh.userData.regionId = this.regionAt(originX + chunkX / 2, originZ + chunkZ / 2);
          this.terrainGroup.add(mesh);
          this.walkable.push(mesh);
          created.push(mesh);
        });
      }
    }
    if (spec.coast) steps.push(...this.coastBuildSteps(spec.coast, spec));
    return steps;
  }


  private buildChunk(
    originX: number,
    originZ: number,
    sizeX: number,
    sizeZ: number,
    segmentsX: number,
    segmentsZ: number,
    material: THREE.Material,
  ): THREE.Mesh {
    this.terrainBuildStats.chunkBuildCount += 1;
    const geometry = new THREE.PlaneGeometry(sizeX, sizeZ, segmentsX, segmentsZ);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colours = new Float32Array(position.count * 3);
    const normals = new Float32Array(position.count * 3);
    // Eight surface weights as two normalised Uint8 vec4s, plus the road frame. 12 bytes/vertex,
    // about 876 KB over the world's ~73k terrain vertices. See the splat block in materials.ts.
    const splatA = new Uint8Array(position.count * 4);
    const splatB = new Uint8Array(position.count * 4);
    const extra = new Uint8Array(position.count * 4);
    // One more byte per vertex: which of the three surfaces this is paved in. PAVING_SURFACE_CODE.
    const paved = new Uint8Array(position.count);
    const centreX = originX + sizeX / 2;
    const centreZ = originZ + sizeZ / 2;
    const surface: SurfaceSample = emptySurface();

    for (let i = 0; i < position.count; i += 1) {
      const worldX = position.getX(i) + centreX;
      const worldZ = position.getZ(i) + centreZ;
      // The lattice IS the mesh: chunk vertices land exactly on lattice nodes, so reading the
      // lattice here rather than re-evaluating the analytic field costs nothing in accuracy and
      // makes the drawn surface and `meshHeightAt` identical by construction.
      const height = this.sampleLattice(worldX, worldZ);
      position.setY(i, height);
      const normal = this.normalAt(worldX, worldZ);
      normals[i * 3] = normal[0];
      normals[i * 3 + 1] = normal[1];
      normals[i * 3 + 2] = normal[2];

      this.sampleSurface(worldX, worldZ, height, surface);
      colours[i * 3] = surface.colour.r;
      colours[i * 3 + 1] = surface.colour.g;
      colours[i * 3 + 2] = surface.colour.b;
      writeSplat(splatA, splatB, extra, paved, i, surface);
    }
    position.needsUpdate = true;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute("aSplatA", new THREE.BufferAttribute(splatA, 4, true));
    geometry.setAttribute("aSplatB", new THREE.BufferAttribute(splatB, 4, true));
    geometry.setAttribute("aGround", new THREE.BufferAttribute(extra, 4, true));
    geometry.setAttribute("aPaved", new THREE.BufferAttribute(paved, 1, true));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centreX, 0, centreZ);
    mesh.receiveShadow = true;
    // Terrain never casts. It would double every terrain draw call in the shadow pass and the
    // relief is gentle enough that self-shadowing buys nothing.
    mesh.castShadow = false;
    this.chunks.push({ mesh, centreX, centreZ, sizeX, sizeZ });
    return mesh;
  }

  /**
   * Builds a visual collar around the fixed gameplay rectangle, then puts one ocean plane under it.
   * Neither mesh is walkable or raycast as terrain: content, nav, physics, and the map keep their
   * existing bounds while the camera sees a shoreline instead of the end of a rectangular slab.
   */
  private coastBuildSteps(spec: CoastSpec, world: WorldTerrainSpec): Array<() => void> {
    // Read the bounds off the SPEC being built, never `this.world`: the step list is assembled
    // before the first step assigns `this.world`, so on a fresh scene that field is still null
    // here and this guard silently dropped the whole coast. That is how the island lost its
    // coastline when boot went incremental — the committed world map still had one because it was
    // captured before that refactor, and nothing walks to the edge in any gate.
    const bounds = world.bounds;
    if (!bounds || spec.gridStep <= 0 || spec.oceanSize <= 0) return [];

    const minimumReach = Math.max(0.001, Math.min(spec.shoreline[0], spec.shoreline[1]));
    const maximumReach = Math.max(minimumReach, Math.max(spec.shoreline[0], spec.shoreline[1]));
    if (!Number.isFinite(spec.collar) || spec.collar + COAST_GRID_EPSILON < maximumReach) {
      throw new Error(
        `Coast collar ${spec.collar} m is shorter than its ${maximumReach} m shoreline reach.`,
      );
    }

    const terrainStep = world.metresPerQuad ?? spec.gridStep;
    if (Math.abs(terrainStep - spec.gridStep) > COAST_GRID_EPSILON) {
      throw new Error(
        `Coast gridStep ${spec.gridStep} m must match terrain metresPerQuad ${terrainStep} m.`,
      );
    }
    const gridUnits = (distance: number, label: string): number => {
      if (!Number.isFinite(distance)) throw new Error(`${label} must be finite.`);
      const units = Math.round(distance / spec.gridStep);
      if (Math.abs(units * spec.gridStep - distance) > COAST_GRID_EPSILON) {
        throw new Error(`${label} ${distance} m does not land on the ${spec.gridStep} m coast grid.`);
      }
      return units;
    };
    const collarUnits = gridUnits(spec.collar, "Coast collar");
    const playableCols = gridUnits(bounds.maxX - bounds.minX, "World X span");
    const playableRows = gridUnits(bounds.maxZ - bounds.minZ, "World Z span");

    const minX = bounds.minX - spec.collar;
    const minZ = bounds.minZ - spec.collar;
    const cols = playableCols + collarUnits * 2;
    const rows = playableRows + collarUnits * 2;
    const stepX = spec.gridStep;
    const stepZ = spec.gridStep;
    const vertexCols = cols + 1;
    const vertexRows = rows + 1;
    const vertexCount = vertexCols * vertexRows;
    const positions = new Float32Array(vertexCount * 3);
    const heights = new Float32Array(vertexCount);
    const descents = new Float32Array(vertexCount);
    const colours = new Float32Array(vertexCount * 3);
    const splatA = new Uint8Array(vertexCount * 4);
    const splatB = new Uint8Array(vertexCount * 4);
    const ground = new Uint8Array(vertexCount * 4);
    const paved = new Uint8Array(vertexCount);
    const referenced = new Uint8Array(vertexCount);
    const indices: number[] = [];
    const steps: Array<() => void> = [];

    // Height first. The material pass below needs the complete drawn coast for its slope,
    // curvature, and horizon samples; using the playable lattice there would clamp all three to
    // the old rectangular edge.
    for (let row = 0; row <= rows; row += 1) {
      steps.push(() => {
        const z = minZ + row * stepZ;
        for (let col = 0; col <= cols; col += 1) {
          const x = minX + col * stepX;
          const vertex = row * vertexCols + col;
          const strictInterior = x > bounds.minX && x < bounds.maxX
            && z > bounds.minZ && z < bounds.maxZ;
          if (strictInterior) {
            heights[vertex] = this.sampleLattice(x, z);
            descents[vertex] = 0;
          } else {
            const profile = this.coastProfileAt(x, z, spec);
            heights[vertex] = profile.landHeight;
            descents[vertex] = profile.descent;
          }
          positions[vertex * 3] = x;
          positions[vertex * 3 + 1] = heights[vertex]!;
          positions[vertex * 3 + 2] = z;
        }
      });
    }
    steps.push(() => {
      this.coastGrid = {
        heights,
        cols: vertexCols,
        rows: vertexRows,
        minX,
        minZ,
        stepX,
        stepZ,
      };
      this.materials.setOceanDepthGrid(this.coastGrid, spec.seaLevel);
    });

    for (let row = 0; row < rows; row += 1) {
      steps.push(() => {
        const centreZ = minZ + (row + 0.5) * stepZ;
        for (let col = 0; col < cols; col += 1) {
          const centreX = minX + (col + 0.5) * stepX;
          const inside = centreX >= bounds.minX && centreX <= bounds.maxX
            && centreZ >= bounds.minZ && centreZ <= bounds.maxZ;
          if (inside) continue;
          const a = row * vertexCols + col;
          const b = a + 1;
          const c = a + vertexCols;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
          referenced[a] = 1;
          referenced[b] = 1;
          referenced[c] = 1;
          referenced[d] = 1;
        }
      });
    }

    const coastHeightAt = (x: number, z: number): number => (
      this.sampleCoastGrid(x, z) ?? spec.seaLevel - Math.max(0, spec.floorDepth)
    );
    const surface = emptySurface();
    const seabed = new THREE.Color(0x31473f);
    const colour = new THREE.Color();
    for (let row = 0; row <= rows; row += 1) {
      steps.push(() => {
        const z = minZ + row * stepZ;
        for (let col = 0; col <= cols; col += 1) {
          const vertex = row * vertexCols + col;
          if (referenced[vertex] === 0) continue;
          const x = minX + col * stepX;
          const playable = x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
          this.sampleSurface(x, z, heights[vertex]!, surface, true, playable ? undefined : coastHeightAt);
          writeSplat(splatA, splatB, ground, paved, vertex, surface);
          colour.copy(surface.colour).lerp(seabed, descents[vertex]!);
          colours[vertex * 3] = colour.r;
          colours[vertex * 3 + 1] = colour.g;
          colours[vertex * 3 + 2] = colour.b;
        }
      });
    }

    let geometry!: THREE.BufferGeometry;
    let normalAttribute!: THREE.BufferAttribute;
    steps.push(() => {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      geometry.setAttribute("aSplatA", new THREE.BufferAttribute(splatA, 4, true));
      geometry.setAttribute("aSplatB", new THREE.BufferAttribute(splatB, 4, true));
      geometry.setAttribute("aGround", new THREE.BufferAttribute(ground, 4, true));
      geometry.setAttribute("aPaved", new THREE.BufferAttribute(paved, 1, true));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      normalAttribute = geometry.getAttribute("normal") as THREE.BufferAttribute;
    });
    for (let row = 0; row <= rows; row += 1) {
      steps.push(() => {
        const start = row * vertexCols;
        const end = Math.min(positions.length / 3, start + vertexCols);
        for (let vertex = start; vertex < end; vertex += 1) {
          if (referenced[vertex] === 0) continue;
          const x = positions[vertex * 3]!;
          const z = positions[vertex * 3 + 2]!;
          const coastSample = sampleOrganicCoast(x, z, bounds, spec);
          const seamWidth = Math.min(COAST_EDGE_PIN_METRES, coastSample.shelfWidth);
          if (coastSample.outsideDistance > seamWidth) continue;
          const terrainNormal = this.normalAt(coastSample.boundaryX, coastSample.boundaryZ);
          const skirtWeight = smoothstep01(
            coastSample.outsideDistance / Math.max(0.000_001, seamWidth),
          );
          const normalX = terrainNormal[0]
            + (normalAttribute.getX(vertex) - terrainNormal[0]) * skirtWeight;
          const normalY = terrainNormal[1]
            + (normalAttribute.getY(vertex) - terrainNormal[1]) * skirtWeight;
          const normalZ = terrainNormal[2]
            + (normalAttribute.getZ(vertex) - terrainNormal[2]) * skirtWeight;
          const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
          normalAttribute.setXYZ(
            vertex,
            normalX / normalLength,
            normalY / normalLength,
            normalZ / normalLength,
          );
        }
      });
    }
    steps.push(() => {
      normalAttribute.needsUpdate = true;
      geometry.computeBoundingSphere();
      const coast = new THREE.Mesh(geometry, this.materials.ground());
      coast.name = "coastal-skirt";
      coast.castShadow = false;
      coast.receiveShadow = true;
      this.scatterGroup.add(coast);

      const oceanGeometry = new THREE.PlaneGeometry(spec.oceanSize, spec.oceanSize);
      oceanGeometry.rotateX(-Math.PI / 2);
      const oceanDepth = new Float32Array(oceanGeometry.getAttribute("position").count);
      oceanDepth.fill(Math.max(1.2, spec.floorDepth));
      oceanGeometry.setAttribute("aWaterDepth", new THREE.BufferAttribute(oceanDepth, 1));
      const ocean = new THREE.Mesh(oceanGeometry, this.materials.water("fallowmarch", "ocean"));
      ocean.userData.ownedGeometry = true;
      ocean.name = "infinite-ocean";
      ocean.position.set((bounds.minX + bounds.maxX) / 2, spec.seaLevel, (bounds.minZ + bounds.maxZ) / 2);
      ocean.renderOrder = 0;
      ocean.castShadow = false;
      ocean.receiveShadow = false;
      this.scatterGroup.add(ocean);
    });
    return steps;
  }

  /**
   * Recomputes the surface of every terrain vertex inside a world-space box.
   *
   * Used when ground or water stamps arrive after the chunks are built. Every affected vertex is
   * recomputed against the current stamps, so restamping the same ground twice gives the same
   * answer as stamping it once.
   */
  private restampArea(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.terrainBuildStats.restampPassCount += 1;
    const surface: SurfaceSample = emptySurface();
    for (const chunk of this.chunks) {
      const halfX = chunk.sizeX / 2;
      const halfZ = chunk.sizeZ / 2;
      if (chunk.centreX + halfX < minX || chunk.centreX - halfX > maxX) continue;
      if (chunk.centreZ + halfZ < minZ || chunk.centreZ - halfZ > maxZ) continue;

      const geometry = chunk.mesh.geometry;
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
      const splatA = geometry.getAttribute("aSplatA") as THREE.BufferAttribute;
      const splatB = geometry.getAttribute("aSplatB") as THREE.BufferAttribute;
      const extra = geometry.getAttribute("aGround") as THREE.BufferAttribute;
      const paved = geometry.getAttribute("aPaved") as THREE.BufferAttribute;
      if (!colour || !splatA || !splatB || !extra || !paved) continue;

      const colours = colour.array as Float32Array;
      const arrayA = splatA.array as Uint8Array;
      const arrayB = splatB.array as Uint8Array;
      const arrayExtra = extra.array as Uint8Array;
      const arrayPaved = paved.array as Uint8Array;
      let touched = false;

      for (let i = 0; i < position.count; i += 1) {
        const worldX = position.getX(i) + chunk.centreX;
        const worldZ = position.getZ(i) + chunk.centreZ;
        if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) continue;
        this.sampleSurface(worldX, worldZ, position.getY(i), surface);
        colours[i * 3] = surface.colour.r;
        colours[i * 3 + 1] = surface.colour.g;
        colours[i * 3 + 2] = surface.colour.b;
        writeSplat(arrayA, arrayB, arrayExtra, arrayPaved, i, surface);
        this.terrainBuildStats.restampedVertexCount += 1;
        touched = true;
      }

      if (!touched) continue;
      colour.needsUpdate = true;
      splatA.needsUpdate = true;
      splatB.needsUpdate = true;
      extra.needsUpdate = true;
      paved.needsUpdate = true;
    }
  }

  /**
   * Widens each pad's falloff until its collar is walkable.
   *
   * A 7 m pad with a 9 m falloff on a Karrowmoor terrace riser cuts a mesa with 60-degree sides:
   * recast drops the sides, and the location on top becomes an island the player can path to but
   * not reach. Measured against the authored region data, this is where most of the world's
   * unwalkable ground came from. So each pad's falloff is expanded to whatever the local height
   * difference actually needs, capped at 4x so a pad on a cliff edge does not flatten a region.
   */
  /**
   * Pins each pad's target height, in order, against the pads already applied under it.
   *
   * Pads nest: a settlement gets a wide one and every named location inside it — the bank counter,
   * the gate, the square — gets a 7 m one of its own. Left unresolved, each pad targets the
   * NATURAL height at its own centre, so a location pad sitting inside a flattened settlement
   * pulled the raw hillside back up through the middle of the town. Highcairn's huts stood on
   * ground that moved 1.3 m across a six-metre footprint because of it, and a building is
   * assembled level: that 1.3 m came out as a corner in the air and a wall through the grass.
   *
   * Resolving in order makes an inner pad adopt the height of the pad it stands on, so its own
   * blend runs between two equal values and changes nothing. Pads that carry an explicit height —
   * the fishing basins — are left alone; theirs is the point.
   */
  private resolveFlatTargets(): void {
    // Pads that carry an explicit height are clamped against the ground they sit on FIRST, because
    // every later decision (the implicit pads' targets, the falloff widths) is measured against
    // them. The fishing basins are authored as a depth below the REGION FLOOR, and Karrowmoor's
    // terraces climb 36 m above their floor, so the Cairn Tarn and the Far Tarn were both authored
    // 36 m inside a hillside. Measured consequence: `normaliseFlats` widened their falloffs to
    // 63.0 m and 84.8 m to keep the sides walkable, which dragged a natural 43 m ridge down to
    // 10.4 m and left the ridge_pines location pad standing in it as a 7 m-radius, 32.75 m-tall
    // pillar with an unblended vertical wall. A tarn belongs ON its terrace, not in a crater
    // through it, so a pad may carve at most MAX_PAD_CARVE below the natural ground at its centre.
    for (const flat of this.flats) {
      if (flat.height === undefined) continue;
      this.carvedPads.add(flat);
      const natural = this.naturalHeight(flat.x, flat.z);
      flat.height = Math.max(flat.height, natural - MAX_PAD_CARVE);
    }
    for (let index = 0; index < this.flats.length; index += 1) {
      const flat = this.flats[index];
      if (!flat || flat.height !== undefined) continue;
      flat.height = this.applyFlats(flat.x, flat.z, this.naturalHeight(flat.x, flat.z), index);
    }
  }

  /**
   * Widens each pad's falloff until its collar is walkable, and no further.
   *
   * A 7 m pad with a 9 m falloff on a Karrowmoor terrace riser cuts a mesa with 60-degree sides:
   * recast drops the sides, and the location on top becomes an island the player can path to but
   * not reach. So each pad's falloff expands to whatever the local height difference actually
   * needs — but the previous cap of 4x had no relationship to the pad, which is how a 16 m basin
   * acquired an 84.8 m falloff and became a regional depression. The cap is now 3x the pad's own
   * radius, which is a collar, not a landscape.
   *
   * The ring is sampled against the FLATTENED height rather than the natural one. Sampling the
   * natural field meant a pad could not see the neighbour that was about to pull the ground out
   * from under its collar, which is the other half of how the 32.75 m cliff was cut.
   */
  private normaliseFlats(): void {
    const maxGradient = 0.6; // about 31 degrees, comfortably inside the 64-degree uphill limit
    // Two passes: the first pass changes the flattened field the second pass measures against.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const flat of this.flats) {
        const centre = flat.height ?? this.naturalHeight(flat.x, flat.z);
        const reach = padReach(flat);
        let drop = 0;
        const ring = reach + flat.blend;
        for (let step = 0; step < 8; step += 1) {
          const angle = (step / 8) * Math.PI * 2;
          const x = flat.x + Math.cos(angle) * ring;
          const z = flat.z + Math.sin(angle) * ring;
          drop = Math.max(drop, Math.abs(this.heightAtXZ(x, z) - centre));
        }
        const needed = Math.max(flat.blend, drop / maxGradient);
        flat.blend = Math.min(needed, Math.max(flat.blend, reach * 3));
      }
    }
  }

  /**
   * Resolves authored basin depths against the finished dry terrain.
   *
   * The old fishing pads stored an absolute height relative to the region floor, then competed in
   * the same weighted mean as ordinary location pads. Redsill was consequently carved only 0.22 m
   * despite asking for 0.9 m, while the two Karrowmoor tarns first aimed more than 30 m through
   * their terraces and had to be clamped. A basin is local: its floor is exactly `depth` below the
   * dry terrain at its own centre, regardless of the region's nominal floor.
   */
  private resolveBasins(): void {
    for (const basin of this.basinSpecs) {
      const numbers = [
        basin.x, basin.z, basin.floorRadius, basin.shoreRadius, basin.crestRadius,
        basin.outerRadius, basin.depth, basin.fillFraction, basin.freeboard,
      ];
      if (numbers.some((value) => !Number.isFinite(value))) {
        throw new Error(`Water basin "${basin.id}" contains a non-finite parameter.`);
      }
      if (!(basin.floorRadius > 0
        && basin.floorRadius < basin.shoreRadius
        && basin.shoreRadius < basin.crestRadius
        && basin.crestRadius < basin.outerRadius)) {
        throw new Error(`Water basin "${basin.id}" radii must increase from floor to outer bank.`);
      }
      if (!(basin.depth > 0 && basin.fillFraction > 0 && basin.fillFraction < 1 && basin.freeboard > 0)) {
        throw new Error(`Water basin "${basin.id}" needs positive depth/freeboard and a fill fraction between 0 and 1.`);
      }
    }

    for (let first = 0; first < this.basinSpecs.length; first += 1) {
      const a = this.basinSpecs[first]!;
      for (let second = first + 1; second < this.basinSpecs.length; second += 1) {
        const b = this.basinSpecs[second]!;
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.outerRadius + b.outerRadius) {
          throw new Error(`Water basins "${a.id}" and "${b.id}" overlap; their closed banks would disagree.`);
        }
      }
    }

    this.basins = this.basinSpecs.map((basin) => {
      const baseY = resolveWaterBasinBaseHeight(basin, (x, z) => this.preBasinHeight(x, z));
      const floorY = baseY - basin.depth;
      return {
        ...basin,
        baseY,
        floorY,
        level: floorY + basin.depth * basin.fillFraction,
      };
    });
  }

  /**
   * Grades a walkable corridor between every pair of neighbouring flat pads the raw terrain cannot
   * join - a haul road up a quarry face.
   *
   * THE DEFECT THIS CLOSES. Karrowmoor is four terraces and every flat place on it is a pad: the
   * Moor Road Bend, Highcairn, the two ramps, the Upper Karrow Seam, the Great Cairn. Measured
   * against `NAV_CONFIG.walkableSlopeAngle` of 48 degrees, the ground BETWEEN those pads was not
   * walkable - the Moor Road Bend to Highcairn escarpment peaked at 1.38 (54 degrees) and the
   * ramp-two to ramp-three riser at 1.02 (45.6 degrees). Recast therefore never connected terrace
   * two, and an offline navmesh build over the authored 6x7 probe grid (x 50..300, z 0..-180 from
   * the Lower Quarry at (60,-16)) reached 7 of 42 cells: only the z = 0 strip. Highcairn, its
   * bank, its plots, both ramps, the Upper Karrow Seam and the Great Cairn were all NOT_REACHABLE,
   * which is three red gate-check lines.
   *
   * WHY IT IS A TERRAIN FIX AND NOT A NAVIGATION ONE. Nothing about the navmesh is wrong. A
   * terraced quarry with no way up its faces is a quarry nobody could have worked, and the way up
   * a quarry face is a haul road: a graded cutting across the riser. So the ground grows one,
   * rather than the slope limit being loosened to pretend the cliff is walkable.
   *
   * WHERE THE ROUTES COME FROM. The pads themselves. Every named location in `content/regions.ts`
   * is a pad, and the authored road network joins locations, so the pad graph already contains
   * every route the content asks for and this file does not have to know the content to find them.
   * The graph is Gabriel-like: A and B are neighbours when no third pad sits inside the circle on
   * AB as diameter, which keeps the edges local and drops the long chords that would cut a trench
   * across a whole region. Only edges whose terrain measures too steep are graded at all, so
   * Fallowmarch and Vellenwood, where the worst authored route measures 0.66, get none.
   *
   * The Agility distance ledger in `content/regions.ts` is unaffected: it is straight-line metres
   * between authored coordinates and a haul road changes only y.
   *
   * WHERE IT STANDS. 33 corridors over the world's 47 pads; the same 6x7 probe grid now reaches 40
   * of 42 cells and all 15 named Karrowmoor locations connect from the Lower Quarry. The two cells
   * still missing, (200,-30) and (50,-90), are shelves on a terrace riser that no authored route
   * touches: the ground measures 0.59 and 0.49 there, walkable in itself but cut off from the moor
   * below by the riser it sits on. Across the 15 authored Karrowmoor road links the walked path is
   * at most 1.26 times the straight line on every link longer than 16 m, and the worst surface
   * metre is 32.1 degrees, at the five-way junction on the Second Ramp pad.
   */
  private buildHaulRoads(): void {
    this.protectedPads = this.flats.filter(
      (flat) => this.carvedPads.has(flat) || padReach(flat) >= HAUL_PROTECTED_PAD_REACH,
    );
    const pads = this.flats.filter((flat) => !this.carvedPads.has(flat));
    if (pads.length < 2) return;

    // A pad may not veto a link that leaves the settlement it is standing in.
    //
    // The Gabriel test exists to stop a chord being cut through a place. A link that STARTS inside
    // a protected core is not that: the corridor has no authority on that ground (see
    // `protectedAuthority`), so the pads sharing the core cannot be trenched by it, and vetoing on
    // them only blocks the settlement's own way out. Measured: the authored
    // `highcairn_bank -> karrow_ramp_two` ramp — the one road onto Karrowmoor's third terrace —
    // was vetoed by three pads all inside Highcairn's 22 x 14 m core, its own settlement pad at
    // (142,-61) and the outpost and plots markers, so it got no corridor at all and measured 43.2
    // degrees against a 48-degree limit while the navmesh detoured 64.3 m round a 51 m link.
    //
    // Both conditions matter. Waiving the veto for every pad on immovable ground instead of only
    // for links that share its core admitted 7 more chords across Karrowmoor, including a 128.3 m
    // Moor Road Bend to Upper Karrow Seam trench, and pushed `karrow_ramp_three` to
    // `upper_karrow_seam` from 19.2 to 36.3 surface degrees.
    const sharesCoreWith = (flat: FlatSpot, a: FlatSpot, b: FlatSpot): boolean => this.protectedPads
      .some((core) => padDistance(core, flat.x, flat.z) <= 0
        && (padDistance(core, a.x, a.z) <= 0 || padDistance(core, b.x, b.z) <= 0));

    for (let i = 0; i < pads.length; i += 1) {
      for (let j = i + 1; j < pads.length; j += 1) {
        const a = pads[i]!;
        const b = pads[j]!;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        if (span < HAUL_MIN_LINK || span > HAUL_MAX_LINK) continue;
        if (!isGabrielNeighbour(pads, i, j, (other) => sharesCoreWith(other, a, b))) continue;
        const road = this.gradeHaulRoad(a, b, span);
        if (!road) continue;
        this.hauls.push(road);
        this.indexHaulRoad(this.hauls.length - 1, road);
      }
    }
  }

  /**
   * Samples the ground along one pad-to-pad link and, if it is too steep to walk, returns the
   * graded profile that replaces it.
   *
   * Grading is repeated binomial smoothing with the two endpoints pinned. That is the cheapest
   * operation that is local (a straight stretch is a fixed point of a blur, so only the riser
   * moves) and guaranteed to converge - the limit of the blur is the straight line between the
   * pins, whose gradient is the link's mean and therefore the gentlest any corridor between those
   * two pads could be. It stops as soon as the profile is walkable, so the corridor keeps as much
   * of the hill's shape as the grade allows.
   */
  private gradeHaulRoad(a: FlatSpot, b: FlatSpot, span: number): HaulRoad | null {
    const count = Math.max(3, Math.round(span / HAUL_SAMPLE_METRES) + 1);
    const xs = new Float64Array(count);
    const zs = new Float64Array(count);
    const natural = new Float64Array(count);
    // A sample is pinned when the ground under it belongs to something the corridor may not move:
    // the two pads it joins, and the core of any settlement pad or basin it crosses. Pinning is
    // what makes `protectedAuthority` continuous rather than a step - the profile and the pad
    // already agree where the corridor loses its authority, so switching it off changes nothing.
    const pinned = new Array<boolean>(count).fill(false);
    const spacing = span / (count - 1);

    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      xs[index] = x;
      zs[index] = z;
      natural[index] = this.heightAtXZ(x, z);
      if (index === 0 || index === count - 1) pinned[index] = true;
      else for (const flat of this.protectedPads) {
        if (padDistance(flat, x, z) <= 0) { pinned[index] = true; break; }
      }
    }

    if (worstRise(natural) <= HAUL_TRIGGER_GRADE * spacing) return null;

    const limit = HAUL_ROAD_GRADE * spacing;
    const graded = Float64Array.from(natural);
    const previous = new Float64Array(count);
    for (let pass = 0; pass < HAUL_SMOOTH_PASSES; pass += 1) {
      if (worstRise(graded) <= limit) break;
      previous.set(graded);
      for (let index = 1; index < count - 1; index += 1) {
        if (pinned[index]) continue;
        graded[index] = (previous[index - 1]! + 2 * previous[index]! + previous[index + 1]!) / 4;
      }
    }

    // Nothing moved far enough to be worth a corridor: the link measured steep because of a single
    // 2 m sample, and ground that shifts by centimetres is not a road.
    let deepest = 0;
    for (let index = 0; index < count; index += 1) {
      deepest = Math.max(deepest, Math.abs(graded[index]! - natural[index]!));
    }
    if (deepest < HAUL_MIN_CUT) return null;

    // The cutting has to blend back into the hillside it was cut out of, and how far that takes is
    // set by the ground at the collar's OWN outer edge, not by the ground on the centreline. Those
    // are different numbers wherever a pad has already pulled the centreline down — measured at
    // the ramp-two corridor, the centreline cut read 0.5 m while the hillside 6 m to the side stood
    // 7 m higher, so a collar sized off the centreline left a slot with a 2.22 gradient wall. The
    // probe distance depends on the collar width and the collar width depends on the probe, so it
    // is a fixed point; four passes converge it to under 10 cm on every corridor in the world.
    const nx = -(b.z - a.z) / span;
    const nz = (b.x - a.x) / span;
    const feather = new Float64Array(count);
    feather.fill(HAUL_MIN_FEATHER);
    for (let pass = 0; pass < 4; pass += 1) {
      for (let index = 0; index < count; index += 1) {
        const reach = HAUL_ROAD_HALF + feather[index]!;
        const target = graded[index]!;
        let drop = Math.abs(target - natural[index]!);
        for (const side of [-1, 1]) {
          const px = xs[index]! + nx * reach * side;
          const pz = zs[index]! + nz * reach * side;
          const ground = this.heightAtXZ(px, pz);
          drop = Math.max(drop, Math.abs(ground - target));
        }
        feather[index] = clamp(drop / HAUL_FEATHER_GRADE, HAUL_MIN_FEATHER, HAUL_MAX_FEATHER);
      }
    }
    // One smoothing pass on the collar width itself, so the corridor's edge is a line rather than
    // a staircase of per-sample widths.
    const collar = Float64Array.from(feather);
    for (let index = 1; index < count - 1; index += 1) {
      collar[index] = (feather[index - 1]! + 2 * feather[index]! + feather[index + 1]!) / 4;
    }

    return { xs, zs, heights: graded, feather: collar };
  }

  /** Buckets each corridor segment on the same grid scheme the road stamps use. */
  private indexHaulRoad(roadIndex: number, road: HaulRoad): void {
    for (let index = 0; index < road.xs.length - 1; index += 1) {
      const reach = HAUL_ROAD_HALF + Math.max(road.feather[index]!, road.feather[index + 1]!);
      const minX = Math.min(road.xs[index]!, road.xs[index + 1]!) - reach;
      const maxX = Math.max(road.xs[index]!, road.xs[index + 1]!) + reach;
      const minZ = Math.min(road.zs[index]!, road.zs[index + 1]!) - reach;
      const maxZ = Math.max(road.zs[index]!, road.zs[index + 1]!) + reach;
      for (let cz = Math.floor(minZ / HAUL_CELL); cz <= Math.floor(maxZ / HAUL_CELL); cz += 1) {
        for (let cx = Math.floor(minX / HAUL_CELL); cx <= Math.floor(maxX / HAUL_CELL); cx += 1) {
          const key = cellKey(cx, cz);
          const packed = roadIndex * HAUL_INDEX_STRIDE + index;
          const bucket = this.haulGrid.get(key);
          if (bucket) bucket.push(packed);
          else this.haulGrid.set(key, [packed]);
        }
      }
    }
  }

  /**
   * Blends a point toward whatever haul-road corridors reach it.
   *
   * Same weighted-mean-plus-influence shape as `applyFlats`, for the same reason: the mean decides
   * WHAT the ground becomes where two corridors cross, and the separate influence decides HOW MUCH
   * of it survives at the corridor's edge. Both terms use the same falloff, so a crossing is
   * continuous rather than a seam.
   */
  private applyHaulRoads(x: number, z: number, height: number): number {
    if (this.hauls.length === 0) return height;
    const bucket = this.haulGrid.get(cellKey(Math.floor(x / HAUL_CELL), Math.floor(z / HAUL_CELL)));
    if (!bucket) return height;

    let accumulated = 0;
    let weightSum = 0;
    let influence = 0;

    for (const packed of bucket) {
      const road = this.hauls[Math.floor(packed / HAUL_INDEX_STRIDE)]!;
      const index = packed % HAUL_INDEX_STRIDE;
      const ax = road.xs[index]!;
      const az = road.zs[index]!;
      const ex = road.xs[index + 1]! - ax;
      const ez = road.zs[index + 1]! - az;
      const lengthSquared = ex * ex + ez * ez;
      const t = lengthSquared <= 1e-9
        ? 0
        : clamp(((x - ax) * ex + (z - az) * ez) / lengthSquared, 0, 1);
      const distance = Math.hypot(x - (ax + ex * t), z - (az + ez * t));
      const feather = road.feather[index]! + (road.feather[index + 1]! - road.feather[index]!) * t;
      if (distance > HAUL_ROAD_HALF + feather) continue;
      const weight = 1 - smoothstep01((distance - HAUL_ROAD_HALF) / feather);
      if (weight <= 0) continue;
      const target = road.heights[index]! + (road.heights[index + 1]! - road.heights[index]!) * t;
      influence = Math.max(influence, weight);
      accumulated += target * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) return height;
    const target = accumulated / weightSum;
    const reach = influence * (1 - this.protectedAuthority(x, z, Math.abs(target - height)));
    if (reach <= 0) return height;
    return height + (target - height) * reach;
  }

  /**
   * How much of the ground at a point belongs to a pad a corridor may not move, 0..1.
   *
   * 1 inside a settlement pad or a basin core, falling to 0 outside it over whatever distance the
   * handover itself needs. What must not move is the pad's CORE — that is the ground
   * `building-footing` measures the 0.000 m of relief across, and it is where the buildings stand.
   * The collar outside it is hillside, and a haul road cut across a hillside beside a town is a
   * road, not a trench through the square.
   *
   * THE HANDBACK IS SIZED BY THE DISAGREEMENT, NOT BY THE PAD, and both fixed sizes were measured
   * wrong before this. Running it over the pad's whole blend gave Highcairn's 26.1 m pad authority
   * out to 53.6 m from (142,-61), and the riser the Second Ramp climbs sits 33.6 m out, where the
   * pad still held 80% of the ground: the corridor got a fifth of a say on the one stretch it
   * existed for, and the authored `highcairn_bank -> karrow_ramp_two` road line measured 43.2
   * degrees with a corridor graded to 16.5 running underneath it. Pinning it to a flat 8 m instead
   * fixed those and broke `moor_road_bend -> highcairn_outpost`, which climbs past Highcairn 5 m
   * outside the core where the corridor and the collar disagree by 6.7 m: 6.7 m of handover in 8 m
   * measured 38.6 degrees.
   *
   * So the distance comes from the disagreement, exactly the way `gradeHaulRoad` sizes the
   * corridor's own collar: `SMOOTHSTEP_PEAK` * drop / `HAUL_FEATHER_GRADE`, which is the width at
   * which a smoothstep of that drop peaks at a walkable gradient. It is bounded by the pad's own
   * blend, because past that the pad is not holding the ground anyway.
   *
   * Only the protected pads are swept — seven of the world's 47 — and only when a corridor already
   * reaches the point, so this costs nothing on the 99% of the lattice no haul road touches.
   */
  private protectedAuthority(x: number, z: number, disagreement: number): number {
    const needed = (SMOOTHSTEP_PEAK * disagreement) / HAUL_FEATHER_GRADE;
    let authority = 0;
    for (const flat of this.protectedPads) {
      const handback = clamp(needed, HAUL_MIN_FEATHER, flat.blend);
      const distance = padDistance(flat, x, z);
      if (distance >= handback) continue;
      const falloff = distance <= 0 ? 1 : 1 - smoothstep01(distance / Math.max(0.001, handback));
      if (falloff > authority) authority = falloff;
    }
    return authority;
  }


  // ------------------------------------------------------------- queries

  /**
   * Sampled terrain height. The `regionId` argument is kept for the frozen call sites; the world
   * is one continuous field, so the answer is correct at region boundaries by construction and
   * does not depend on which region the caller thinks it is in.
   */
  heightAt(_regionId: RegionId, x: number, z: number): number {
    if (this.fields.length === 0) return 0;
    return this.heightAtXZ(x, z);
  }

  /**
   * Blended world height at a point, in metres.
   *
   * Four layers, in this order: the region fields, the flat pads, haul roads, then water basins.
   * Basins run last because their floor and closed bank are authored terrain, not a suggestion an
   * overlapping location pad or road may average away.
   *
   * THE ROADS USED TO RUN SECOND AND IT COST THE WHOLE GRADE. `applyFlats` is affine in the height
   * it is handed - `h + (padMean - h) * padInfluence` - so wherever a pad reached, the corridor
   * underneath it had no say at all. Highcairn's pad blend is 26 m wide and the Moor Road Bend's
   * is 9 m, which between them cover 40 of the 65.4 m from the bend to the outpost: the corridor
   * spent its whole 0.30 allowance climbing ground the pads then flattened back down, and the
   * climb it still owed was squeezed into what was left. Measured along that centreline the
   * surface ran flat for 8 m and then hit 0.98 (44.4 degrees) at 13 m, against a 48-degree
   * walkable limit - 3.6 degrees of margin on the one route into Highcairn.
   *
   * Running the roads last inverts that: the corridor is authoritative on the open riser, which is
   * exactly where a haul road belongs. What protects the settlements is not the ordering but
   * `protectedAuthority` - see `applyHaulRoads`.
   */
  heightAtXZ(x: number, z: number): number {
    return this.applyBasins(x, z, this.preBasinHeight(x, z));
  }

  private preBasinHeight(x: number, z: number): number {
    const flattened = this.applyFlats(x, z, this.naturalHeight(x, z));
    const worked = this.world?.worldSites?.length
      ? applyWorldSiteTerrain(x, z, flattened, this.world.worldSites, this.sampleNaturalHeight, this.sampleSiteSupportHeight)
      : flattened;
    let height = this.applyHaulRoads(x, z, worked);
    for (const landform of this.portalLandforms) height = portalLandformHeight(x, z, height, landform);
    return height;
  }

  private readonly sampleNaturalHeight = (x: number, z: number): number => this.naturalHeight(x, z);
  private readonly sampleSiteSupportHeight = (x: number, z: number): number => this.applyFlats(x, z, this.naturalHeight(x, z));

  /**
   * Carves a flat floor, raises it to the waterline, closes it with a dry crest, then returns to the
   * original terrain. Basin outer circles are validated as disjoint, so at most one profile can
   * own a point and the result cannot depend on list order.
   */
  private applyBasins(x: number, z: number, height: number): number {
    for (const basin of this.basins) {
      const radius = organicDistance(x - basin.x, z - basin.z, basin.shape);
      if (radius >= basin.outerRadius) continue;
      if (radius <= basin.floorRadius) return basin.floorY;

      let bankProfile: number;
      if (radius <= basin.shoreRadius) {
        const t = smoothstep01((radius - basin.floorRadius) / (basin.shoreRadius - basin.floorRadius));
        bankProfile = basin.floorY + (basin.level - basin.floorY) * t;
      } else {
        const crestY = basin.level + basin.freeboard;
        const crestRiseRadius = (basin.shoreRadius + basin.crestRadius) / 2;
        if (radius <= crestRiseRadius) {
          const t = smoothstep01((radius - basin.shoreRadius) / (crestRiseRadius - basin.shoreRadius));
          bankProfile = basin.level + (crestY - basin.level) * t;
        } else if (radius <= basin.crestRadius) {
          bankProfile = crestY;
        } else {
          // This is a MINIMUM bank, not another full terrain blend. On a high side the broad
          // `terrainReturn` below climbs back to the hillside; pulling the crest directly to a
          // 23 m hill over ten metres is what made Redsill's first closed version a 74-degree cut.
          bankProfile = waterBasinOuterBankHeight(basin, x, z, height, crestY, (sampleX, sampleZ) => this.preBasinHeight(sampleX, sampleZ));
        }
      }

      // Blend the dry terrain back from the FLOOR edge over the full available width. This keeps a
      // naturally high bank high enough to close early without asking the narrow crest collar to
      // climb the entire hillside. The zero derivative at both ends matters: a linear blend adds
      // `height delta / width` to the original terrain slope right up to the outer boundary.
      const terrainT = (radius - basin.floorRadius) / (basin.outerRadius - basin.floorRadius);
      const terrainBlend = smoothstep01(terrainT);
      const terrainReturn = basin.floorY + (height - basin.floorY) * terrainBlend;
      return Math.max(bankProfile, terrainReturn);
    }
    return height;
  }

  /** One normalized field shared by terrain relief, surface palette, scatter masks, and diagnostics. */
  private biomeWeightsAt(x: number, z: number): readonly { id: RegionId; weight: number }[] {
    const spec = this.world?.biomes;
    if (spec) return sampleOrganicBiomeWeights(x, z, spec);
    if (this.fields.length === 0) return [];
    if (this.fields.length === 1) return [{ id: this.fields[0]!.spec.regionId, weight: 1 }];

    const blend = this.world?.blendMetres ?? 45;
    const raw = this.fields.map((field) => ({
      id: field.spec.regionId,
      weight: smoothstep01((signedDepth(field.spec.rect, x, z) + blend) / (2 * blend)),
    }));
    const sum = raw.reduce((total, sample) => total + sample.weight, 0);
    if (sum > 0) return raw.map((sample) => ({ ...sample, weight: sample.weight / sum }));
    const nearest = this.fields.reduce((best, field) => (
      signedDepth(field.spec.rect, x, z) > signedDepth(best.spec.rect, x, z) ? field : best
    ), this.fields[0]!);
    return raw.map((sample) => ({
      id: sample.id,
      weight: sample.id === nearest.spec.regionId ? 1 : 0,
    }));
  }

  private coastProfileAt(x: number, z: number, spec: CoastSpec): {
    boundaryX: number;
    boundaryZ: number;
    boundaryHeight: number;
    outsideDistance: number;
    shorelineWidth: number;
    shelfWidth: number;
    descent: number;
    land: boolean;
    landHeight: number;
  } {
    const bounds = this.world?.bounds ?? { minX: x, maxX: x, minZ: z, maxZ: z };
    const coast = sampleOrganicCoast(x, z, bounds, spec);
    const boundaryHeight = this.meshHeightAt(coast.boundaryX, coast.boundaryZ);
    const edgeStep = Math.max(0.25, this.lattice?.step ?? spec.gridStep);
    let gradientX = 0;
    let gradientZ = 0;
    if (x < bounds.minX) {
      const innerX = Math.min(bounds.maxX, coast.boundaryX + edgeStep);
      gradientX = (this.meshHeightAt(innerX, coast.boundaryZ) - boundaryHeight)
        / Math.max(0.000_001, innerX - coast.boundaryX);
    } else if (x > bounds.maxX) {
      const innerX = Math.max(bounds.minX, coast.boundaryX - edgeStep);
      gradientX = (boundaryHeight - this.meshHeightAt(innerX, coast.boundaryZ))
        / Math.max(0.000_001, coast.boundaryX - innerX);
    }
    if (z < bounds.minZ) {
      const innerZ = Math.min(bounds.maxZ, coast.boundaryZ + edgeStep);
      gradientZ = (this.meshHeightAt(coast.boundaryX, innerZ) - boundaryHeight)
        / Math.max(0.000_001, innerZ - coast.boundaryZ);
    } else if (z > bounds.maxZ) {
      const innerZ = Math.max(bounds.minZ, coast.boundaryZ - edgeStep);
      gradientZ = (boundaryHeight - this.meshHeightAt(coast.boundaryX, innerZ))
        / Math.max(0.000_001, coast.boundaryZ - innerZ);
    }
    const edgePlaneHeight = boundaryHeight
      + gradientX * (x - coast.boundaryX)
      + gradientZ * (z - coast.boundaryZ);
    const naturalHeight = coast.land ? this.heightAtXZ(x, z) : edgePlaneHeight;
    // The playable lattice supplies both the seam value and its inward one-sided gradient. Four
    // coast quads later, the unchanged analytic field owns the headland; smoothstep leaves the
    // derivative of each source intact at its end of the blend.
    const edgeBlend = smoothstep01(coast.outsideDistance / COAST_EDGE_PIN_METRES);
    const plateauHeight = edgePlaneHeight + (naturalHeight - edgePlaneHeight) * edgeBlend;
    const floorY = spec.seaLevel - Math.max(0, spec.floorDepth);
    return {
      boundaryX: coast.boundaryX,
      boundaryZ: coast.boundaryZ,
      boundaryHeight,
      outsideDistance: coast.outsideDistance,
      shorelineWidth: coast.shorelineWidth,
      shelfWidth: coast.shelfWidth,
      descent: coast.descent,
      land: coast.land,
      landHeight: plateauHeight + (floorY - plateauHeight) * coast.descent,
    };
  }

  private naturalHeight(x: number, z: number): number {
    if (this.fields.length === 0) return 0;
    if (this.world?.biomes) {
      const weights = this.biomeWeightsAt(x, z);
      let height = 0;
      for (const field of this.fields) {
        const weight = weights.find((sample) => sample.id === field.spec.regionId)?.weight ?? 0;
        height += field.height(x, z) * weight;
      }
      return height;
    }
    if (this.fields.length === 1) return this.fields[0]!.height(x, z);

    const blend = this.world?.blendMetres ?? 45;
    let total = 0;
    let weightSum = 0;
    let nearest = this.fields[0]!;
    let nearestDepth = -Infinity;

    for (const field of this.fields) {
      const depth = signedDepth(field.spec.rect, x, z);
      if (depth > nearestDepth) {
        nearestDepth = depth;
        nearest = field;
      }
      const weight = smoothstep01((depth + blend) / (2 * blend));
      if (weight <= 0) continue;
      total += field.height(x, z) * weight;
      weightSum += weight;
    }

    // Outside every region rect and outside every blend band. Fall back to the nearest region so
    // the surface stays defined rather than collapsing to y = 0 and tearing a cliff at the edge.
    if (weightSum <= 0) return nearest.height(x, z);
    return total / weightSum;
  }

  /**
   * Flattens `height` through every pad that reaches this point.
   *
   * This used to hard-set `result = target` inside a pad's radius and then SKIP every later pad's
   * falloff, on the reasoning that a pad's falloff must never disturb ground another pad has
   * already made flat. The reasoning was right and the implementation cut a cliff: at
   * (253.3,-101.8) the ridge_pines core kept its natural 43.12 m with both fishing-basin falloffs
   * skipped, while one metre away the same natural ground took both falloffs and landed at
   * 10.37 m. That is a 32.75 m step in 1 m, and 3.4% of the world (1317 of 38332 samples) came out
   * steeper than 45 degrees with a maximum of 86.3.
   *
   * The replacement is inverse-distance weighting, and the DISTANCE UNIT MATTERS. The first
   * version weighted by `1/t^3` where `t` is the fraction of the way through a pad's own falloff.
   * That keeps a core flat, but between two pads it concentrates the whole height change into the
   * middle of the gap: differentiating `t_b^3 / (t_a^3 + t_b^3)` at the crossover gives 3x the
   * mean gradient, so the 15.96 m between the Moor Road Bend pad and Highcairn's came out at 1.38
   * (54 degrees) instead of the 0.58 the gap could have carried. Recast refused it, and half of
   * Karrowmoor was unreachable on foot as a result.
   *
   * Weighting by `falloff / distance` in METRES fixes that by construction: with `d_a + d_b`
   * constant along the line between two cores, `d_b / (d_a + d_b)` is LINEAR in position, so two
   * pads produce a constant-gradient ramp of exactly `height difference / gap`. The measured
   * consequence, world-wide: samples with |mesh - field| > 0.5 m went 20 -> 4 and the worst
   * disagreement 0.779 -> 0.633 m, because the field stopped having sub-2 m structure the mesh
   * lattice cannot represent.
   *
   * The rest of the properties are unchanged:
   *
   *  - the weight still rises without bound toward a pad's core, which is what makes flat mean
   *    flat: at Coldbrace's centre the settlement pad outweighs anything reaching it by 10^5, so
   *    the measured relief across the pad stays 0.000 m and buildings still assemble level;
   *  - `falloff` in the numerator takes the weight continuously to zero at the blend edge, so a
   *    pad entering or leaving the sum cannot step the surface;
   *  - cores weight by penetration depth, so where two cores overlap the deeper one wins smoothly
   *    rather than by list order.
   *
   * `influence` is a separate plain falloff that returns the result to the natural field at the
   * outer edge of the outermost pad, which the raw weighted mean cannot do on its own.
   */
  private applyFlats(x: number, z: number, height: number, limit = this.flats.length): number {
    if (this.flats.length === 0) return height;
    let accumulated = 0;
    let weightSum = 0;
    let influence = 0;

    for (let index = 0; index < limit; index += 1) {
      const flat = this.flats[index];
      if (!flat) continue;
      const distance = padDistance(flat, x, z);
      if (distance > flat.blend) continue;
      const target = flat.height ?? this.naturalHeight(flat.x, flat.z);

      // ONE expression across the core boundary, which is the whole point. Weighting the core by a
      // separate constant makes the weight jump by orders of magnitude at `distance == 0`, and a
      // discontinuous weight is a discontinuous surface: it measured as a 4.4 m step in the ground
      // 2 m outside a location pad, which is the same class of defect as the 32.75 m cliff.
      const t = distance <= 0 ? 0 : distance / Math.max(0.001, flat.blend);
      const falloff = distance <= 0 ? 1 : 1 - smoothstep01(t);
      const depth = distance < 0 ? -distance : 0;
      const weight = ((1 + depth) * falloff) / (Math.max(0, distance) + PAD_CORE_EPSILON);
      influence = Math.max(influence, falloff);
      accumulated += target * weight;
      weightSum += weight;
    }

    if (weightSum <= 0 || influence <= 0) return height;
    return height + (accumulated / weightSum - height) * influence;
  }

  /** Which region owns a point. The rect that contains it, or the nearest one. */
  regionAt(x: number, z: number): RegionId {
    if (this.fields.length === 0) return "fallowmarch";
    let best = this.fields[0]!;
    let bestDepth = -Infinity;
    for (const field of this.fields) {
      const depth = signedDepth(field.spec.rect, x, z);
      if (depth > bestDepth) {
        bestDepth = depth;
        best = field;
      }
    }
    return best.spec.regionId;
  }

  /** Blend weight of a region at a point, 0..1. Scatter uses it to fade species between biomes. */
  regionWeightAt(regionId: RegionId, x: number, z: number): number {
    return this.biomeWeightsAt(x, z).find((sample) => sample.id === regionId)?.weight ?? 0;
  }

  /** Terrain steepness at a point, as rise over run. 0 is flat, 1 is 45 degrees. */
  slopeAt(x: number, z: number, step = 1.5): number {
    const dx = (this.heightAtXZ(x + step, z) - this.heightAtXZ(x - step, z)) / (2 * step);
    const dz = (this.heightAtXZ(x, z + step) - this.heightAtXZ(x, z - step)) / (2 * step);
    return Math.hypot(dx, dz);
  }

  getRegionRect(regionId: RegionId): Rect | null {
    return this.fields.find((field) => field.spec.regionId === regionId)?.spec.rect ?? null;
  }

  getWorldBounds(): Rect {
    return this.world?.bounds ?? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }

  /**
   * Candidate bounds for visual scatter. Gameplay bounds stay canonical; a requested bleed may
   * reach the coast mesh but never past its declared rectangular collar.
   */
  getScatterBounds(bleed: number): Rect {
    const bounds = this.getWorldBounds();
    const collar = Math.max(0, this.world?.coast?.collar ?? 0);
    const requested = Number.isNaN(bleed) ? 0 : Math.max(0, bleed);
    const padding = Math.min(collar, requested);
    return {
      minX: bounds.minX - padding,
      maxX: bounds.maxX + padding,
      minZ: bounds.minZ - padding,
      maxZ: bounds.maxZ + padding,
    };
  }

  /**
   * The drawn ground visual scatter may sit on. Outside gameplay this reads only the render coast
   * grid, fades through its final shore band, and disappears before the ocean surface. It is never
   * used by physics, navigation, entity placement, or click raycasts.
   */
  scatterSurfaceAt(x: number, z: number): {
    height: number;
    normal: Vec3;
    slope: number;
    density: number;
    coast: boolean;
  } | null {
    const bounds = this.getWorldBounds();
    const playable = x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
    if (playable) {
      const height = this.meshHeightAt(x, z);
      const normal = this.normalAt(x, z);
      const slope = normal[1] > 0.000_001
        ? Math.hypot(normal[0], normal[2]) / normal[1]
        : Number.POSITIVE_INFINITY;
      return { height, normal, slope, density: 1, coast: false };
    }

    const spec = this.world?.coast;
    const grid = this.coastGrid;
    if (!spec || !grid) return null;
    const scatterBounds = this.getScatterBounds(spec.collar);
    if (x < scatterBounds.minX || x > scatterBounds.maxX
      || z < scatterBounds.minZ || z > scatterBounds.maxZ) return null;

    const profile = this.coastProfileAt(x, z, spec);
    if (!profile.land) return null;
    const height = this.sampleCoastGrid(x, z);
    if (height === null || height <= spec.seaLevel + COAST_SCATTER_WATER_CLEARANCE) return null;

    const shoreWidth = Math.max(0.000_001, profile.shorelineWidth - profile.shelfWidth);
    const shoreProgress = smoothstep01((profile.outsideDistance - profile.shelfWidth) / shoreWidth);
    const density = 1 - shoreProgress;
    if (density <= 0.000_001) return null;

    const sampleX = Math.max(0.25, grid.stepX);
    const sampleZ = Math.max(0.25, grid.stepZ);
    const dx = (this.sampleCoastGrid(x + sampleX, z)! - this.sampleCoastGrid(x - sampleX, z)!)
      / (2 * sampleX);
    const dz = (this.sampleCoastGrid(x, z + sampleZ)! - this.sampleCoastGrid(x, z - sampleZ)!)
      / (2 * sampleZ);
    const length = Math.hypot(dx, 1, dz);
    const normal: Vec3 = [-dx / length, 1 / length, -dz / length];
    return { height, normal, slope: Math.hypot(dx, dz), density, coast: true };
  }

  /** One compact, JSON-safe probe for biome/coast authoring and browser diagnostics. */
  sampleWorld(x: number, z: number): {
    x: number;
    z: number;
    playable: boolean;
    height: number;
    slope: number | null;
    semanticRegion: RegionId;
    visualBiome: RegionId;
    biomeWeights: Partial<Record<RegionId, number>>;
    waterBodyId: string | null;
    coast: { outsideDistance: number; shorelineWidth: number; seaLevel: number } | null;
  } {
    const bounds = this.getWorldBounds();
    const boundaryX = clamp(x, bounds.minX, bounds.maxX);
    const boundaryZ = clamp(z, bounds.minZ, bounds.maxZ);
    const outsideDistance = Math.hypot(x - boundaryX, z - boundaryZ);
    const playable = outsideDistance <= 0.000_001;
    const raw = this.biomeWeightsAt(x, z);
    const biomeWeights: Partial<Record<RegionId, number>> = {};
    for (const entry of raw) biomeWeights[entry.id] = entry.weight;
    const visualBiome = raw.reduce(
      (best, entry) => entry.weight > best.weight ? entry : best,
      raw[0] ?? { id: this.regionAt(x, z), weight: 1 },
    ).id;

    const coastSpec = this.world?.coast;
    const profile = coastSpec ? this.coastProfileAt(x, z, coastSpec) : null;
    const height = playable
      ? this.meshHeightAt(x, z)
      : profile
        ? Math.max(this.sampleCoastGrid(x, z) ?? profile.landHeight, coastSpec!.seaLevel)
        : this.meshHeightAt(boundaryX, boundaryZ);
    const waterBody = this.builtWaterBodies.find((body) => body.closed && pointInContour(x, z, body.contour));

    return {
      x,
      z,
      playable,
      height,
      slope: playable ? this.slopeAt(x, z) : null,
      semanticRegion: this.regionAt(x, z),
      visualBiome,
      biomeWeights,
      waterBodyId: waterBody?.id ?? null,
      coast: coastSpec && profile
        ? {
            outsideDistance: profile.outsideDistance,
            shorelineWidth: profile.shorelineWidth,
            seaLevel: coastSpec.seaLevel,
          }
        : null,
    };
  }

  /** JSON-safe layout description, so the debug surface and the world builder can reconcile. */
  describeRegions(): RegionLayout[] {
    return this.fields.map((field) => ({
      regionId: field.spec.regionId,
      rect: { ...field.spec.rect },
      centre: [
        (field.spec.rect.minX + field.spec.rect.maxX) / 2,
        (field.spec.rect.minZ + field.spec.rect.maxZ) / 2,
      ] as [number, number],
      character: field.spec.character,
    }));
  }


  getWalkableMeshes(): THREE.Mesh[] {
    return this.walkable;
  }

  /**
   * A Rapier-ready heightfield of the whole world. Far cheaper than a 140k-triangle trimesh and it
   * gives exact ground queries. Heights come from the same lattice interpolation as the terrain
   * meshes, rather than re-evaluating the analytic field. They are column-major, as Rapier
   * requires.
   */
  heightfieldSamples(resolution = 2): HeightfieldSamples {
    const bounds = this.getWorldBounds();
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;
    const ncols = Math.max(1, Math.round(width / resolution));
    const nrows = Math.max(1, Math.round(depth / resolution));
    const heights = new Float32Array((nrows + 1) * (ncols + 1));

    for (let col = 0; col <= ncols; col += 1) {
      const x = bounds.minX + (col / ncols) * width;
      for (let row = 0; row <= nrows; row += 1) {
        const z = bounds.minZ + (row / nrows) * depth;
        heights[col * (nrows + 1) + row] = this.sampleLattice(x, z);
      }
    }

    return {
      heights,
      nrows,
      ncols,
      scale: { x: width, y: 1, z: depth },
      centre: { x: (bounds.minX + bounds.maxX) / 2, y: 0, z: (bounds.minZ + bounds.maxZ) / 2 },
    };
  }

  // -------------------------------------------------- the 2 m mesh lattice

  /**
   * Samples the analytic field once onto the 2 m lattice the chunks are tessellated from.
   *
   * ~70k evaluations, and it replaces the ~365k the old `buildChunk` did (five per vertex for the
   * height and its central differences). Everything downstream — vertex heights, slope, curvature,
   * horizon AO, `meshHeightAt`, `normalAt`, the water shoreline — reads this array instead, which
   * is both faster and, more importantly, guarantees they all describe the SAME surface.
   */
  private buildLattice(): void {
    const world = this.world;
    if (!world) return;
    const bounds = world.bounds;
    const step = Math.max(0.25, world.metresPerQuad);
    const cols = Math.max(1, Math.round((bounds.maxX - bounds.minX) / step)) + 1;
    const rows = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / step)) + 1;
    const heights = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      const z = bounds.minZ + row * step;
      for (let col = 0; col < cols; col += 1) {
        heights[row * cols + col] = this.heightAtXZ(bounds.minX + col * step, z);
      }
    }
    this.lattice = { heights, cols, rows, minX: bounds.minX, minZ: bounds.minZ, step };
  }

  /** Bilinear read of the lattice, falling back to the analytic field before it exists. */
  private sampleLattice(x: number, z: number): number {
    const lattice = this.lattice;
    if (!lattice) return this.heightAtXZ(x, z);
    const fx = clamp((x - lattice.minX) / lattice.step, 0, lattice.cols - 1);
    const fz = clamp((z - lattice.minZ) / lattice.step, 0, lattice.rows - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, lattice.cols - 1);
    const z1 = Math.min(z0 + 1, lattice.rows - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = lattice.heights[z0 * lattice.cols + x0]!;
    const h10 = lattice.heights[z0 * lattice.cols + x1]!;
    const h01 = lattice.heights[z1 * lattice.cols + x0]!;
    const h11 = lattice.heights[z1 * lattice.cols + x1]!;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /** Bilinear read of the render-only coast grid. Coordinates outside its rectangle clamp to it. */
  private sampleCoastGrid(x: number, z: number): number | null {
    const grid = this.coastGrid;
    if (!grid) return null;
    const fx = clamp((x - grid.minX) / grid.stepX, 0, grid.cols - 1);
    const fz = clamp((z - grid.minZ) / grid.stepZ, 0, grid.rows - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, grid.cols - 1);
    const z1 = Math.min(z0 + 1, grid.rows - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const h00 = grid.heights[z0 * grid.cols + x0]!;
    const h10 = grid.heights[z0 * grid.cols + x1]!;
    const h01 = grid.heights[z1 * grid.cols + x0]!;
    const h11 = grid.heights[z1 * grid.cols + x1]!;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }

  /**
   * The height of the DRAWN ground, bilinear on the same 2 m lattice the mesh is built from.
   *
   * Not the same thing as `heightAtXZ`, which is the analytic field: measured over 38332 samples,
   * the two differ by meanAbs 0.031 m, 6.1% of samples exceed 5 cm, and 10% of road ribbon
   * vertices sat BELOW the drawn ground because of it. Anything that has to touch the surface a
   * player sees — a decal, a shoreline, a placed prop — belongs on this one.
   */
  meshHeightAt(x: number, z: number): number {
    return this.sampleLattice(x, z);
  }

  /** A defensive snapshot used by startup tests and boot diagnostics. */
  getTerrainBuildStats(): TerrainBuildStats {
    return { ...this.terrainBuildStats };
  }

  /** Unit surface normal of the drawn ground. Central difference on the same 2 m lattice. */
  normalAt(x: number, z: number): Vec3 {
    const step = this.lattice?.step ?? 2;
    const dx = (this.sampleLattice(x + step, z) - this.sampleLattice(x - step, z)) / (2 * step);
    const dz = (this.sampleLattice(x, z + step) - this.sampleLattice(x, z - step)) / (2 * step);
    const length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  }

  /** Returns the same ground-material blend the visible terrain uses at this point. */
  groundSurfaceAt(x: number, z: number): GroundSurfaceSample {
    const surface = emptySurface();
    this.sampleSurface(x, z, this.sampleLattice(x, z), surface, false);
    return {
      grass: surface.grass,
      dry: surface.dry,
      rock: surface.rock,
      gravel: surface.gravel,
      dirt: surface.dirt,
      mud: surface.mud,
      cobble: surface.cobble,
      wet: surface.wet,
    };
  }

  // -------------------------------------------------------- ground stamps

  /**
   * Hands the ground the things that change it rather than stand on it.
   *
   * Call from `buildWorld`'s surface-preparation callback and the stamps are baked into each chunk
   * as it is built. A late call updates the existing chunks through `restampArea`.
   */
  setGroundStamps(stamps: GroundStamps): void {
    this.paving = (stamps.paving ?? []).map((entry) => ({ ...entry }));
    this.waters = (stamps.water ?? []).map((entry) => ({ ...entry }));
    this.roadPolylines = [];
    this.roads = [];
    const seed = stamps.seed ?? 0x0a0d;
    for (const road of stamps.roads ?? []) {
      const roadSeed = roadSeedFromStamp(seed, road);
      const curved = curveRoadPolyline(road.points, roadSeed);
      this.roadPolylines.push(curved);
      appendRoadSegments(
        this.roads,
        curved,
        road.width ?? ROAD_DEFAULT_WORN_WIDTH,
        roadSeed,
        road.points,
      );
    }
    this.rebuildRoadGrid();
    if (this.chunks.length > 0) this.restampArea(-Infinity, -Infinity, Infinity, Infinity);
  }

  /**
   * The road centrelines as they were actually stamped, after the meander.
   *
   * Kerbs, foliage exclusions, the world map and anything else that follows a route need this
   * resolved line. Terrain height and route costs stay unchanged; only the stamped centreline bows.
   */
  getRoadPolylines(): Vec3[][] {
    return this.roadPolylines.map((line) => line.map((point) => [point[0], point[1], point[2]] as Vec3));
  }

  /** A defensive copy for acceptance diagnostics and downstream shoreline consumers. */
  getWaterBodies(): WaterBodySnapshot[] {
    return this.builtWaterBodies.map((body) => ({
      ...body,
      centre: [...body.centre] as [number, number],
      radii: { ...body.radii },
      contour: body.contour.map((point) => [...point] as [number, number]),
    }));
  }

  private rememberWaterBody(snapshot: WaterBodySnapshot): void {
    const existing = this.builtWaterBodies.findIndex((body) => body.id === snapshot.id);
    if (existing >= 0) this.builtWaterBodies[existing] = snapshot;
    else this.builtWaterBodies.push(snapshot);
  }

  private rebuildRoadGrid(): void {
    this.roadGrid.clear();
    for (const [index, segment] of this.roads.entries()) {
      const reach = roadOuterHalf(Math.max(segment.aWidth, segment.bWidth));
      const minX = Math.min(segment.ax, segment.bx) - reach;
      const maxX = Math.max(segment.ax, segment.bx) + reach;
      const minZ = Math.min(segment.az, segment.bz) - reach;
      const maxZ = Math.max(segment.az, segment.bz) + reach;
      for (let cz = Math.floor(minZ / ROAD_CELL); cz <= Math.floor(maxZ / ROAD_CELL); cz += 1) {
        for (let cx = Math.floor(minX / ROAD_CELL); cx <= Math.floor(maxX / ROAD_CELL); cx += 1) {
          const key = cellKey(cx, cz);
          const bucket = this.roadGrid.get(key);
          if (bucket) bucket.push(index);
          else this.roadGrid.set(key, [index]);
        }
      }
    }
  }

  /**
   * Distance from a point to the nearest road centreline, with the sign of which side it is on.
   *
   * Bucketed on an 8 m grid, so a terrain vertex tests a handful of segments rather than all ~700.
   * Returns `null` past the local verge. Width is interpolated along the winning segment.
   */
  private roadAt(x: number, z: number): {
    distance: number;
    perpendicular: number;
    wornHalf: number;
    fadeHalf: number;
    vergeMetres: number;
  } | null {
    if (this.roads.length === 0) return null;
    let best = Infinity;
    let bestPerpendicular = 0;
    let bestWornHalf = 0;
    let bestFadeHalf = 0;
    let bestVerge = 0;
    const cx = Math.floor(x / ROAD_CELL);
    const cz = Math.floor(z / ROAD_CELL);
    const bucket = this.roadGrid.get(cellKey(cx, cz));
    if (!bucket) return null;
    for (const index of bucket) {
      const segment = this.roads[index]!;
      const ex = segment.bx - segment.ax;
      const ez = segment.bz - segment.az;
      const lengthSquared = ex * ex + ez * ez;
      const t = lengthSquared <= 1e-9
        ? 0
        : clamp(((x - segment.ax) * ex + (z - segment.az) * ez) / lengthSquared, 0, 1);
      const px = segment.ax + ex * t;
      const pz = segment.az + ez * t;
      const distance = Math.hypot(x - px, z - pz);
      const wornWidth = segment.aWidth + (segment.bWidth - segment.aWidth) * t;
      const widthScale = wornWidth / ROAD_DEFAULT_WORN_WIDTH;
      const wornHalf = wornWidth / 2;
      const fadeHalf = wornHalf + ROAD_FADE_METRES * widthScale;
      const vergeMetres = ROAD_VERGE_METRES * widthScale;
      if (distance > fadeHalf + vergeMetres) continue;
      if (distance >= best) continue;
      best = distance;
      const length = Math.sqrt(lengthSquared) || 1;
      bestPerpendicular = ((x - px) * (ez / length) - (z - pz) * (ex / length));
      bestWornHalf = wornHalf;
      bestFadeHalf = fadeHalf;
      bestVerge = vergeMetres;
    }
    if (!Number.isFinite(best)) return null;
    return {
      distance: best,
      perpendicular: bestPerpendicular,
      wornHalf: bestWornHalf,
      fadeHalf: bestFadeHalf,
      vergeMetres: bestVerge,
    };
  }

  /**
   * Everything the ground needs to know about itself at one point: eight surface weights, the
   * colour they blend to, the horizon AO that multiplies it, and the road frame.
   *
   * `groundColourAt` before this returned a lerp of two palette swatches by altitude, and altitude
   * only varies at the 74-190 m feature sizes of the height noise. That is why the terrain read as
   * a solid colour field, why 21.7% of all sampled vertices in the world were one exact colour,
   * and why a worn track, a scree hollow, a paved square and a waterlogged bank were all
   * undrawable. Every weight below comes from data the chunk builder already had (slope, altitude,
   * the second derivative of the same central differences) or from a stamp.
   */
  private sampleSurface(
    x: number,
    z: number,
    height: number,
    out: SurfaceSample,
    shadeColour = true,
    heightAt?: HeightSampler,
  ): void {
    let weightSum = 0;
    let local = 0;
    let lowR = 0; let lowG = 0; let lowB = 0;
    let highR = 0; let highG = 0; let highB = 0;
    let rockR = 0; let rockG = 0; let rockB = 0;
    let gravelR = 0; let gravelG = 0; let gravelB = 0;
    let dirtR = 0; let dirtG = 0; let dirtB = 0;
    let mudR = 0; let mudG = 0; let mudB = 0;
    let cobbleR = 0; let cobbleG = 0; let cobbleB = 0;
    let brickR = 0; let brickG = 0; let brickB = 0;
    let plankR = 0; let plankG = 0; let plankB = 0;
    let wetR = 0; let wetG = 0; let wetB = 0;

    const biomeWeights = this.biomeWeightsAt(x, z);
    for (const field of this.fields) {
      const weight = biomeWeights.find((sample) => sample.id === field.spec.regionId)?.weight ?? 0;
      if (weight <= 0) continue;
      const swatches = swatchesFor(field.spec.regionId);
      // Altitude within the height range the region's field ACTUALLY produces. See RegionField.
      local += smoothstep01((height - field.hMin) / Math.max(1, field.hMax - field.hMin)) * weight;
      lowR += swatches.low.r * weight; lowG += swatches.low.g * weight; lowB += swatches.low.b * weight;
      highR += swatches.high.r * weight; highG += swatches.high.g * weight; highB += swatches.high.b * weight;
      rockR += swatches.rock.r * weight; rockG += swatches.rock.g * weight; rockB += swatches.rock.b * weight;
      gravelR += swatches.gravel.r * weight; gravelG += swatches.gravel.g * weight; gravelB += swatches.gravel.b * weight;
      dirtR += swatches.dirt.r * weight; dirtG += swatches.dirt.g * weight; dirtB += swatches.dirt.b * weight;
      mudR += swatches.mud.r * weight; mudG += swatches.mud.g * weight; mudB += swatches.mud.b * weight;
      cobbleR += swatches.cobble.r * weight; cobbleG += swatches.cobble.g * weight; cobbleB += swatches.cobble.b * weight;
      brickR += swatches.brick.r * weight; brickG += swatches.brick.g * weight; brickB += swatches.brick.b * weight;
      plankR += swatches.plank.r * weight; plankG += swatches.plank.g * weight; plankB += swatches.plank.b * weight;
      wetR += swatches.wet.r * weight; wetG += swatches.wet.g * weight; wetB += swatches.wet.b * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) {
      const fallback = swatchesFor("fallowmarch");
      out.colour.copy(fallback.high);
      out.grass = 1; out.dry = 0; out.rock = 0; out.gravel = 0;
      out.dirt = 0; out.mud = 0; out.cobble = 0; out.wet = 0;
      out.pavedKind = 0;
      out.roadPerpendicular = 0.5;
      out.roadPresence = 0;
      out.roadWear = 0;
      out.macro = 0.5;
      return;
    }

    const inverse = 1 / weightSum;
    local *= inverse;

    const step = this.lattice?.step ?? 2;
    const hxp = heightAt ? heightAt(x + step, z) : this.sampleLattice(x + step, z);
    const hxm = heightAt ? heightAt(x - step, z) : this.sampleLattice(x - step, z);
    const hzp = heightAt ? heightAt(x, z + step) : this.sampleLattice(x, z + step);
    const hzm = heightAt ? heightAt(x, z - step) : this.sampleLattice(x, z - step);
    const slope = Math.hypot((hxp - hxm) / (2 * step), (hzp - hzm) / (2 * step));
    // Laplacian on the same stencil. Positive is a hollow, negative is a crest. Measured over the
    // world this lands in roughly -0.35..0.35 m, so 0.10 is a pronounced hollow, not a wobble.
    const curvature = (hxp + hxm + hzp + hzm - 4 * height) / (step * step);

    // Macro variation. Everything above this point is derived from the height field, and the
    // height field is flat on every pad and smooth at 21 m and up everywhere else, so without an
    // independent signal the ground has nothing to say between a hill and a texel. Two octaves:
    // 62 m sets which parts of a meadow are dry and which are lush, 19 m breaks the boundary
    // between them so it is not one soft gradient.
    const noise = this.surfaceNoise;
    const macro = noise
      ? noise(x / 62, z / 62) * 0.62 + noise((x + 611) / 19, (z - 407) / 19) * 0.38
      : 0;

    // Altitude still leads, and the noise is a bias on it rather than a replacement, so the
    // region's authored high/low swatches still land where the region author put them.
    const dryness = clamp(local + macro * SURFACE_MACRO_RANGE, 0, 1);

    // Slope above ~23 degrees loses its soil and shows stone. Lowered from the old 0.5 threshold
    // because at 0.5 only 12.71% of the world had any surface variation at all. The macro field
    // moves the soil line by +/-3.5 degrees so it is a coastline rather than a contour.
    const rock = smoothstep01((slope - 0.42 - macro * 0.07) / 0.5);
    // Debris collects in hollows and washes off crests, and gathers in patches within that.
    const gravel = smoothstep01((curvature - 0.05) / 0.14) * (1 - rock * 0.6)
      * clamp(0.45 + macro * 0.8, 0, 1);

    // Mine floors wear along their exposure and haul approach. The cut's banks retain their
    // regional stone/soil response; this is an irregular working area, not a circular paving pad.
    let worked = 0;
    let workedGrit = 0.26;
    for (const { site, reach } of this.mineSurfaces) {
      const dx = x - site.centre[0];
      const dz = z - site.centre[1];
      if (Math.abs(dx) >= reach || Math.abs(dz) >= reach) continue;
      const floor = worldSiteWorkFloorWeight(x, z, site);
      if (floor <= 0) continue;
      const grain = noise ? noise((x + 47) / 5.7, (z - 83) / 5.7) : 0;
      const wear = clamp(floor + grain * 0.18 * floor * (1 - floor), 0, 1) * (1 - rock * 0.85) * 0.96;
      if (wear > worked) {
        worked = wear;
        workedGrit = clamp(0.26 + grain * 0.12, 0.16, 0.38);
      }
    }

    // Stamps, in priority order: paving beats a road, a road beats a waterlogged bank.
    //
    // The stamp owns the local width. Its low-frequency drift moves the worn edge, fade and gravel
    // verge together, while the default 3.2 m worn band stays narrow enough to read as a track.
    const road = this.roadAt(x, z);
    let dirt = 0;
    let verge = 0;
    let roadPerpendicular = 0.5;
    let roadPresence = 0;
    let roadWear = 0;
    if (road) {
      dirt = 1 - smoothstep01((road.distance - road.wornHalf) / (road.fadeHalf - road.wornHalf));
      // A gravel shoulder peaking exactly where the dirt gives out, and gone by the time the
      // untouched ground starts.
      verge = (1 - dirt) * (1 - smoothstep01((road.distance - road.fadeHalf) / road.vergeMetres));
      roadPerpendicular = clamp(road.perpendicular / (ROAD_PERP_RANGE * 2) + 0.5, 0, 1);
      roadPresence = dirt > 0.02 ? 1 : 0;
      roadWear = dirt;
    }

    // Paving. The signed distance to the nearest authored rectangle, pushed by a low-frequency
    // wobble so the boundary is not a straight line, and ramped across the edge rather than from
    // it. `pavedEdge` is kept so the gravel shoulder below can sit outside whatever the wobble did.
    let cobble = 0;
    let pavedKind = 0;
    let pavedEdge = Number.POSITIVE_INFINITY;
    let edgeKerbed = false;
    const pavingWobble = noise
      ? (noise(x / 7.3, z / 7.3) * 0.7 + noise((x - 233) / 2.6, (z + 91) / 2.6) * 0.3)
        * PAVING_EDGE_WOBBLE
      : 0;
    for (const pad of this.paving) {
      // A kerbed rect does NOT wobble. The kerb is real geometry standing on the authored line, so
      // an edge that wanders 0.9 m across it puts grass inside the square and cobble outside it.
      const kerbed = pad.kerb === true;
      const feather = kerbed ? PAVING_KERB_FEATHER : PAVING_FEATHER;
      const distance = rectDistance(x, z, pad.centre, pad.halfExtents, pad.rotationY ?? 0)
        + (kerbed ? 0 : pavingWobble);
      if (distance < pavedEdge) {
        pavedEdge = distance;
        edgeKerbed = kerbed;
      }
      const weight = 1 - smoothstep01((distance + feather * 0.4) / feather);
      if (weight > cobble) {
        cobble = weight;
        pavedKind = PAVING_SURFACE_CODE[pad.surface ?? "stone"];
      }
    }
    // Grit and broken stone where the paving gives out, which is the same shoulder a worn road
    // gets and the reason a town square stops looking like a rug thrown on a lawn. A kerb IS that
    // shoulder, in stone, so a kerbed rect does not get a second one in gravel.
    if (!edgeKerbed && pavedEdge < PAVING_FEATHER + PAVING_VERGE_METRES) {
      const shoulder = (1 - cobble)
        * (1 - smoothstep01((pavedEdge - PAVING_FEATHER * 0.6) / PAVING_VERGE_METRES));
      verge = Math.max(verge, clamp(shoulder, 0, 1));
    }

    let wet = 0;
    let mud = 0;
    for (const body of this.waters) {
      const localX = x - body.centre[0];
      const localZ = z - body.centre[1];
      const distance = body.shape
        ? organicDistance(localX, localZ, body.shape)
        : Math.hypot(localX, localZ);
      if (distance > body.radius + WATER_BANK_METRES) continue;
      const above = height - body.level;
      // Waterlogged right at and below the line, churned mud for the next 0.9 m up the bank.
      wet = Math.max(wet, 1 - smoothstep01((above + 0.05) / 0.35));
      mud = Math.max(mud, (1 - smoothstep01((above - 0.2) / 0.9)) * smoothstep01((above + 0.1) / 0.3));
    }

    // Paving covers a road; both cover the bank.
    dirt = Math.min(dirt, 1 - cobble);
    wet = Math.min(wet, 1 - cobble - dirt);
    mud = Math.min(mud, Math.max(0, 1 - cobble - dirt - wet));
    verge = Math.min(verge, Math.max(0, 1 - cobble - dirt - wet - mud));

    // Existing paving, roads and wet banks keep their priority. The working surface replaces only
    // unclaimed natural ground and never advertises road ruts or a paved material to the shader.
    const workingSurface = worked * Math.max(0, 1 - cobble - dirt - wet - mud - verge);
    dirt += workingSurface * (1 - workedGrit);
    verge += workingSurface * workedGrit;

    const stamped = clamp(cobble + dirt + wet + mud + verge, 0, 1);
    const natural = 1 - stamped;
    out.rock = rock * natural;
    out.gravel = clamp(gravel, 0, 1) * (1 - rock) * natural + verge;
    const remaining = Math.max(0, natural - rock * natural - clamp(gravel, 0, 1) * (1 - rock) * natural);
    out.dry = remaining * dryness;
    out.grass = remaining * (1 - dryness);
    out.cobble = cobble;
    out.pavedKind = pavedKind;
    out.dirt = dirt;

    // The paved swatch follows what the settlement paves IN. One "cobble" tone for all three would
    // put Rootfall's plank green and Highcairn's dressed brick under Coldbrace's river stone, and
    // the ground IS the paving now rather than the bed a slab sits on.
    if (pavedKind >= 0.75) {
      cobbleR = plankR; cobbleG = plankG; cobbleB = plankB;
    } else if (pavedKind >= 0.25) {
      cobbleR = brickR; cobbleG = brickG; cobbleB = brickB;
    }
    out.wet = wet;
    out.mud = mud;
    out.roadPerpendicular = roadPerpendicular;
    out.roadPresence = roadPresence;
    out.roadWear = roadWear;
    out.macro = clamp(macro * 0.5 + 0.5, 0, 1);

    out.colour.setRGB(
      (lowR * out.grass + highR * out.dry + rockR * out.rock + gravelR * out.gravel
        + dirtR * out.dirt + mudR * out.mud + cobbleR * out.cobble + wetR * out.wet) * inverse,
      (lowG * out.grass + highG * out.dry + rockG * out.rock + gravelG * out.gravel
        + dirtG * out.dirt + mudG * out.mud + cobbleG * out.cobble + wetG * out.wet) * inverse,
      (lowB * out.grass + highB * out.dry + rockB * out.rock + gravelB * out.gravel
        + dirtB * out.dirt + mudB * out.mud + cobbleB * out.cobble + wetB * out.wet) * inverse,
    );

    if (shadeColour) {
      const ao = this.horizonAo(x, z, height, heightAt);
      out.colour.multiplyScalar(ao);
    }
  }

  /**
   * Baked sky occlusion: how much of the horizon is blocked, at 8 azimuths and three ranges.
   *
   * There was no ambient occlusion and no contact darkening anywhere in the renderer, which is
   * why terrain-great_cairn read as a beige card rather than a mountainside — a slope with no
   * shading break has no form, whatever its silhouette does. 24 lattice reads per vertex over
   * ~73k vertices is about 40 ms at build time and exactly zero at runtime, and it is the single
   * change that makes relief legible.
   */
  private horizonAo(x: number, z: number, height: number, heightAt?: HeightSampler): number {
    if (!heightAt && !this.lattice) return 1;
    let maxAngle = 0;
    for (let step = 0; step < AO_AZIMUTHS; step += 1) {
      const angle = (step / AO_AZIMUTHS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      for (const range of AO_RANGES) {
        const sampled = heightAt
          ? heightAt(x + dx * range, z + dz * range)
          : this.sampleLattice(x + dx * range, z + dz * range);
        const rise = sampled - height;
        if (rise <= 0) continue;
        const angleTo = Math.atan2(rise, range);
        if (angleTo > maxAngle) maxAngle = angleTo;
      }
    }
    return AO_FLOOR + (1 - AO_FLOOR) * (1 - clamp(maxAngle / (Math.PI / 2), 0, 1));
  }


  /**
   * A still water surface for a pool, tarn or brook. Not walkable, not a collider.
   *
   * A radial grid whose OUTER RING IS THE SHORELINE, not a 34-vertex triangle fan with a faded
   * rim. Measured, the fan was wrong in three separate ways at once: `CircleGeometry(radius, 32)`
   * is one hub plus 33 rim vertices over a 46 m disc, so there was no interior geometry to vary;
   * the rim was dropped 0.35 m and faded to alpha 0, which dissolved the outer 40% of the disc
   * into a wash instead of drawing a waterline; and the disc was sized `cluster.radius + 14` with
   * no relationship to the basin, so 55-56% of the tarn footprints had dry hillside above the
   * surface by up to 7.3 m.
   *
   * Instead: a size-dependent number of azimuths, and along each one a bisection for the exact
   * distance at which the DRAWN ground crosses the surface height. Per-vertex depth into an
   * `aWaterDepth` attribute, which the material turns into a shallow-to-deep tint and an alpha
   * that reaches zero exactly at the bank. The shoreline is then a property of the geometry rather
   * than something the shader has to guess at.
   */
  buildWater(rect: Rect, level: number, regionId: RegionId): THREE.Mesh | null {
    const centreX = (rect.minX + rect.maxX) / 2;
    const centreZ = (rect.minZ + rect.maxZ) / 2;
    const maxRadius = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2;
    const basin = this.basins.find((candidate) => Math.hypot(candidate.x - centreX, candidate.z - centreZ) < 0.1);
    const bodyId = basin?.id ?? `water-${regionId}-${centreX.toFixed(1)}-${centreZ.toFixed(1)}`;
    const radii = basin
      ? {
          floor: basin.floorRadius,
          shore: basin.shoreRadius,
          crest: basin.crestRadius,
          outer: basin.outerRadius,
        }
      : { floor: 0, shore: maxRadius, crest: maxRadius, outer: maxRadius };
    const reject = (reason: string): null => {
      this.rememberWaterBody({
        id: bodyId,
        centre: [centreX, centreZ],
        level,
        floorY: this.meshHeightAt(centreX, centreZ),
        depth: 0,
        radii,
        contour: [],
        closed: false,
        error: reason,
      });
      const message = `Water body "${bodyId}" is not enclosed: ${reason}`;
      if (isDevelopmentBuild()) throw new Error(message);
      console.error(message);
      return null;
    };

    if (!basin) return reject("no matching terrain basin was built");
    if (Math.abs(maxRadius - basin.crestRadius) > 0.1) {
      return reject(`mesh search radius ${maxRadius.toFixed(2)} m does not reach crest radius ${basin.crestRadius.toFixed(2)} m`);
    }
    if (Math.abs(level - basin.level) > 0.02) {
      return reject(`surface level ${level.toFixed(3)} m disagrees with basin level ${basin.level.toFixed(3)} m`);
    }
    const centreDepth = level - this.meshHeightAt(centreX, centreZ);
    if (centreDepth < WATER_MIN_CENTRE_DEPTH) {
      return reject(`centre depth is ${centreDepth.toFixed(3)} m, below the ${WATER_MIN_CENTRE_DEPTH.toFixed(2)} m minimum`);
    }

    // See `WATER_SHORE_ARC`: the spoke count follows the body, so the shoreline is always solved
    // at the terrain lattice's own 2 m spacing rather than at a fixed 32 azimuths.
    const segments = clamp(
      Math.round((2 * Math.PI * maxRadius) / WATER_SHORE_ARC),
      WATER_MIN_SEGMENTS,
      WATER_MAX_SEGMENTS,
    );

    // Shoreline distance per azimuth: the FIRST radius at which the drawn ground crosses the
    // surface, found by marching outward and then bisecting inside the step it crossed in.
    //
    // This was a pure bisection with an early-out that returned `maxRadius` whenever the ground at
    // maxRadius was below the level, on the stated reasoning that the bank is monotonic over the
    // basin's falloff. Measured, it is not: on a 1 m grid, 11% of the Redsill and Cairn Tarn disc
    // footprints stood ABOVE the surface by up to 2.12 m, because a spur crosses the plane at
    // r = 21 and drops back under it by r = 23, and the early-out drew straight over the top of it.
    // Marching finds the first crossing by construction, which is the definition of a shoreline.
    // A spoke that never crosses is rejected. The old code left `high = maxRadius`, bisected two
    // equal values, and faded that unsupported edge to zero alpha. Every authored body had open
    // spokes, and Cairn Tarn's fake rim floated 4.28 m above the ground on its low side.
    const shoreline = new Float64Array(segments);
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let low = 0;
      let high = maxRadius;
      let found = false;
      for (let radius = WATER_MARCH_METRES; radius <= maxRadius; radius += WATER_MARCH_METRES) {
        if (this.meshHeightAt(centreX + dx * radius, centreZ + dz * radius) >= level) {
          high = radius;
          found = true;
          break;
        }
        low = radius;
      }
      if (!found) {
        return reject(`spoke ${step + 1}/${segments} never reaches dry ground within ${maxRadius.toFixed(2)} m`);
      }
      for (let iteration = 0; iteration < 12; iteration += 1) {
        const mid = (low + high) / 2;
        if (this.meshHeightAt(centreX + dx * mid, centreZ + dz * mid) < level) low = mid;
        else high = mid;
      }
      // Use the dry side of the bracket. It buries the last sub-millimetre under the bank instead
      // of leaving the outer ring unsupported on the wet side.
      shoreline[step] = high;
    }

    const rings = WATER_RINGS;
    const vertexCount = 1 + segments * rings;
    const positions = new Float32Array(vertexCount * 3);
    const depths = new Float32Array(vertexCount);
    const indices: number[] = [];

    depths[0] = Math.max(0, level - this.meshHeightAt(centreX, centreZ));
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const reach = shoreline[step]!;
      for (let ring = 0; ring < rings; ring += 1) {
        // Biased so the rings bunch toward the rim; see `WATER_RING_BIAS`.
        const radius = reach * Math.pow((ring + 1) / rings, WATER_RING_BIAS);
        const index = 1 + step * rings + ring;
        const x = dx * radius;
        const z = dz * radius;
        positions[index * 3] = x;
        positions[index * 3 + 2] = z;
        // The taper inside it is `WATER_EDGE_METRES` of real bank rather than one ring, because a
        // ring is `reach / rings` metres wide and that is 1.9 m at Redsill against 0.21 m at a pool
        // near the minimum size. The wet edge used to be eight times wider on a big pond than on a
        // small one for no reason but the tessellation.
        const trueDepth = Math.max(0, level - this.meshHeightAt(centreX + x, centreZ + z));
        depths[index] = ring === rings - 1
          ? 0
          : trueDepth * clamp((reach - radius) / WATER_EDGE_METRES, 0, 1);
      }
    }

    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      const a0 = 1 + step * rings;
      const b0 = 1 + next * rings;
      indices.push(0, b0, a0);
      for (let ring = 0; ring < rings - 1; ring += 1) {
        const a = a0 + ring;
        const b = b0 + ring;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aWaterDepth", new THREE.BufferAttribute(depths, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.materials.water(regionId));
    mesh.position.set(centreX, level, centreZ);
    mesh.name = `water-${regionId}`;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.scatterGroup.add(mesh);
    // The bank treatment in the terrain splat needs to know where the waterline is, so it is
    // registered at the radius the SHORELINE reached rather than at the rect the caller guessed.
    // Registering the guess put the mud and wet bands metres inside or outside the drawn edge.
    let reached = 0;
    for (let step = 0; step < segments; step += 1) reached = Math.max(reached, shoreline[step]!);
    this.waters.push({ centre: [centreX, centreZ], radius: reached, level, shape: basin.shape });
    this.rememberWaterBody({
      id: bodyId,
      centre: [centreX, centreZ],
      level,
      floorY: basin.floorY,
      depth: centreDepth,
      radii,
      contour: Array.from(shoreline, (radius, step) => {
        const angle = (step / segments) * Math.PI * 2;
        return [centreX + Math.cos(angle) * radius, centreZ + Math.sin(angle) * radius];
      }),
      closed: true,
    });
    if (this.chunks.length > 0) {
      const reach = reached + WATER_BANK_METRES;
      this.restampArea(centreX - reach, centreZ - reach, centreX + reach, centreZ + reach);
    }
    return mesh;
  }

  // ------------------------------------------------------------- scatter

  /**
   * Places many copies of one asset as a single InstancedMesh per (geometry, material) pair.
   *
   * This is the draw-call discipline the budget depends on: 200 trees cost the same handful of
   * calls as one tree. Tier variants must be colour swaps over a shared texture, never separate
   * textures, or batching fragments (runs/corealm/architecture.md, correction R6).
   * The source geometry stays intact at every visible distance. Spatial shards, instancing and
   * frustum rejection control rendering cost without changing branch or foliage silhouettes.
   */
  scatterInstanced(
    source: THREE.Object3D,
    placements: ScatterPlacement[],
    name: string,
    options: {
      regionId?: RegionId; castShadow?: boolean; windStrength?: number; compactVisibility?: boolean;
    } = {},
  ): THREE.InstancedMesh[] {
    if (placements.length === 0) return [];

    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4; windStrength: number }[] = [];
    source.updateMatrixWorld(true);
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!material) return;
      let resolvedMaterial = needsStoneDetail(mesh.geometry, material) ? stoneDetail(material) : material;
      const organicRole = artSurfaceRoleForMaterial(material.name);
      if (organicRole) resolvedMaterial = this.materials.organic(resolvedMaterial, organicRole);
      const windStrength = materialMovesInWind(material) ? (options.windStrength ?? 0) : 0;
      if (windStrength > 0) resolvedMaterial = this.materials.wind(resolvedMaterial, windStrength);
      parts.push({
        geometry: mesh.geometry,
        // The six platformer rocks ship with no UVs and no texture, so a scattered crag drew as a
        // smooth flat cone. See `stoneDetail`.
        material: resolvedMaterial,
        matrix: mesh.matrixWorld.clone(),
        windStrength,
      });
    });

    const created: THREE.InstancedMesh[] = [];
    const transform = new THREE.Matrix4();
    const placement = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const tiltQuaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const normalVector = new THREE.Vector3();
    const scaleVector = new THREE.Vector3();
    const positionVector = new THREE.Vector3();

    for (const [index, part] of parts.entries()) {
      const instanced = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      instanced.name = `${name}-${index}`;
      instanced.castShadow = options.castShadow ?? true;
      if (part.windStrength > 0) {
        instanced.customDepthMaterial = this.materials.windShadow(part.material, part.windStrength, "depth");
        instanced.customDistanceMaterial = this.materials.windShadow(part.material, part.windStrength, "distance");
      }
      instanced.receiveShadow = true;
      instanced.frustumCulled = true;
      // The object stays at identity; placement and wind live in instance data/shaders.
      // Keep world-matrix propagation enabled so transformed fixture parents still work.
      instanced.matrixAutoUpdate = false;
      let windMargin = 0;

      for (const [slot, entry] of placements.entries()) {
        positionVector.set(entry.position[0], entry.position[1], entry.position[2]);
        quaternion.setFromAxisAngle(axis, entry.rotationY);
        // A ground normal leans the instance into the slope it stands on. Applied on the LEFT of
        // the yaw, so the asset still faces where it was told to and only its footing changes;
        // multiplying the other way rotates the lean around with the yaw and a row of trees on one
        // hillside ends up leaning in different directions.
        if (entry.normal && (entry.tilt ?? 1) > 0) {
          normalVector.set(entry.normal[0], entry.normal[1], entry.normal[2]).normalize();
          tiltQuaternion.setFromUnitVectors(axis, normalVector);
          const amount = clamp(entry.tilt ?? 1, 0, 1);
          if (amount < 1) tiltQuaternion.slerp(IDENTITY_QUATERNION, 1 - amount);
          quaternion.premultiply(tiltQuaternion);
        }
        if (typeof entry.scale === "number") scaleVector.setScalar(entry.scale);
        else scaleVector.set(entry.scale[0], entry.scale[1], entry.scale[2]);
        placement.compose(positionVector, quaternion, scaleVector);
        transform.multiplyMatrices(placement, part.matrix);
        instanced.setMatrixAt(slot, transform);
        if (part.windStrength > 0) windMargin = Math.max(windMargin, scatterWindMargin(transform, part.windStrength));
      }
      instanced.instanceMatrix.needsUpdate = true;
      finalizeScatterBounds(instanced, windMargin);
      if (options.compactVisibility) this.scatterVisibility.add(instanced, windMargin);

      // Size-classed cull radius, consumed by `updateStreaming`. The fog wall justifies hiding
      // ANY shard past ~195 m (fog is opaque at 210 m from the CAMERA, which trails the player
      // by up to ~30 m); knee-high detail earns a nearer 170 m horizon on readability
      // grounds — at that range the fog is 79% opaque and the piece itself is a pixel or two, so
      // drawing it out to the wall buys nothing. 170 rather than a tighter figure because a 130 m
      // sweep left a visible bare arc where the plains ground cover stopped (cull-march_road).
      let maxScale = 0;
      for (const entry of placements) {
        const s = typeof entry.scale === "number"
          ? entry.scale
          : Math.max(entry.scale[0], entry.scale[1], entry.scale[2]);
        if (s > maxScale) maxScale = s;
      }
      if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
      const drawnRadius = (part.geometry.boundingSphere?.radius ?? 1) * maxScale;
      instanced.userData.cullRadius = drawnRadius < 1.5 ? 170 : undefined;

      this.scatterGroup.add(instanced);
      created.push(instanced);
      if (options.regionId) this.registerScatter(options.regionId, instanced);
    }
    return created;
  }

  /**
   * Draws a spatial tile of grass as one alpha-tested `InstancedMesh`.
   *
   * The caller merges all four former grass asset ids before reaching this method, so common,
   * tall, green and dry-gold grass differ only in matrix and instance colour. Density changes
   * therefore change matrix count and four-triangle submissions, never material or draw count.
   */
  scatterGrassSprites(
    placements: readonly GrassSpritePlacement[],
    name: string,
    options: { regionId?: RegionId } = {},
  ): THREE.InstancedMesh[] {
    if (placements.length === 0) return [];

    const instanced = new THREE.InstancedMesh(
      this.grassBladeGeometry ?? this.grassSpriteGeometry,
      this.grassBladeGeometry ? this.materials.grassBlades() : this.materials.grassSprite(),
      placements.length,
    );
    instanced.name = name;
    instanced.castShadow = false;
    instanced.receiveShadow = true;
    instanced.frustumCulled = true;
    instanced.matrixAutoUpdate = false;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const tiltQuaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const colour = new THREE.Color();
    let windMargin = 0;

    for (const [slot, entry] of placements.entries()) {
      position.set(entry.position[0], entry.position[1], entry.position[2]);
      quaternion.setFromAxisAngle(up, entry.rotationY);
      if (entry.normal && (entry.tilt ?? 1) > 0) {
        normal.set(entry.normal[0], entry.normal[1], entry.normal[2]).normalize();
        tiltQuaternion.setFromUnitVectors(up, normal);
        const amount = clamp(entry.tilt ?? 1, 0, 1);
        if (amount < 1) tiltQuaternion.slerp(IDENTITY_QUATERNION, 1 - amount);
        quaternion.premultiply(tiltQuaternion);
      }
      scale.set(entry.width, entry.height, entry.width);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(slot, matrix);
      windMargin = Math.max(windMargin, scatterWindMargin(matrix, GRASS_WIND_STRENGTH));
      instanced.setColorAt(slot, colour.setHex(entry.colour));
    }

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    finalizeScatterBounds(instanced, windMargin);
    // Grass blades are the smallest thing scattered; see the cull-radius note in scatterInstanced.
    instanced.userData.cullRadius = 170;
    this.scatterGroup.add(instanced);
    if (options.regionId) this.registerScatter(options.regionId, instanced);
    return [instanced];
  }


  /** Advances every animated surface. View-only: no gameplay state is read or written here. */
  updateTime(seconds: number): void {
    this.materials.setTime(seconds);
  }

  /** The centre and radius of the last streaming cull, applied to late-arriving shards. */
  private lastScatterCull: { x: number; z: number; radius: number } | null = null;

  /** Registers legacy region scatter and organic biome recipe shards under their recipe id. */
  registerScatter(regionId: RegionId, object: THREE.Object3D): void {
    const list = this.scatterByRegion.get(regionId) ?? [];
    list.push(object);
    this.scatterByRegion.set(regionId, list);
    // Background streaming keeps delivering tiles while the player stands still, and a shard that
    // arrives after the last updateStreaming sweep would otherwise stay visible at any distance.
    if (this.lastScatterCull && this.world?.biomes !== undefined) {
      this.applyScatterCull(object, this.lastScatterCull.x, this.lastScatterCull.z, this.lastScatterCull.radius);
    }
  }

  unregisterScatter(object: THREE.Object3D): void {
    if ((object as THREE.InstancedMesh).isInstancedMesh) this.scatterVisibility.remove(object as THREE.InstancedMesh);
    for (const [regionId, objects] of this.scatterByRegion) {
      const index = objects.indexOf(object);
      if (index < 0) continue;
      objects.splice(index, 1);
      if (objects.length === 0) this.scatterByRegion.delete(regionId);
      break;
    }
    object.removeFromParent();
    // The asset registry retains geometry/materials. InstancedMesh owns only its uploaded
    // instance buffers here, and removeFromParent alone does not release those GPU allocations.
    if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose();
  }

  private applyScatterCull(object: THREE.Object3D, x: number, z: number, radius: number): void {
    if (radius === Infinity) {
      object.visible = true;
      return;
    }
    const cull = Math.min(radius, (object.userData.cullRadius as number | undefined) ?? radius);
    const box = (object as THREE.InstancedMesh).boundingBox;
    if (box && !box.isEmpty()) {
      // Tile bounds are already in world space. Their enclosing sphere extends well beyond
      // the actual tile edges, keeping distant shards alive unnecessarily. Measure the nearest
      // horizontal box edge instead. finalizeScatterBounds already includes shader wind.
      const dx = Math.max(box.min.x - x, 0, x - box.max.x);
      const dz = Math.max(box.min.z - z, 0, z - box.max.z);
      object.visible = dx * dx + dz * dz < cull * cull;
      return;
    }
    const sphere = (object as THREE.InstancedMesh).boundingSphere
      ?? (object as THREE.Mesh).geometry?.boundingSphere
      ?? null;
    if (!sphere) {
      object.visible = true;
      return;
    }
    const dx = sphere.center.x - x;
    const dz = sphere.center.z - z;
    object.visible = Math.hypot(dx, dz) - sphere.radius < cull;
  }

  /**
   * Legacy region scatter switches off beyond its semantic rectangle. Organic biome recipe shards
   * can occur anywhere on the island; their tile-sized bounding spheres give frustum culling
   * something to reject, but frustum culling alone stopped being enough when Kilnhalt grew the
   * island by 65%: a pose looking across the map submitted every in-frustum tile at any distance,
   * and the Cinderwake arena view measured 633 draw calls against the 400 budget. The "far"
   * preset's fog is fully opaque at 210 m, so hiding a shard whose nearest edge sits past the
   * 240 m default is visually lossless and pays for the whole northern band.
   */
  updateStreaming(x: number, z: number, radius = 195): void {
    const organicBiomes = this.world?.biomes !== undefined;
    this.lastScatterCull = { x, z, radius };
    for (const [regionId, objects] of this.scatterByRegion) {
      if (organicBiomes) {
        // An InstancedMesh composes its instances into its OWN boundingSphere; a plain mesh keeps
        // the sphere on the geometry. Both sit unparented at the origin, so the sphere centre is
        // already in world space. See applyScatterCull.
        for (const object of objects) this.applyScatterCull(object, x, z, radius);
        continue;
      }
      const rect = this.getRegionRect(regionId);
      const visible = rect === null || signedDepth(rect, x, z) > -radius;
      for (const object of objects) object.visible = visible;
    }
  }

  // -------------------------------------------------------------- player

  /**
   * Placeholder player body used until the character rig lands in round 4.
   * Deliberately a clear silhouette so movement is legible in round 0 screenshots.
   */
  createPlaceholderPlayer(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = "player";

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 6, 12),
      this.materials.surface(0x4a6fa5, 0.7, 0.05),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10),
      this.materials.surface(0xe0b58c, 0.85, 0),
    );
    head.position.y = PLAYER_HEIGHT + 0.02;
    head.castShadow = true;
    group.add(head);

    // A nose-like wedge so facing direction is unambiguous in screenshots.
    const facing = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.34, 8),
      this.materials.surface(0xd8d0c0, 0.8, 0),
    );
    facing.rotation.x = Math.PI / 2;
    facing.position.set(0, PLAYER_HEIGHT * 0.62, PLAYER_RADIUS + 0.14);
    group.add(facing);

    this.entityGroup.add(group);
    this.playerMesh = group;
    return group;
  }

  /**
   * Draws the player at the store's position.
   *
   * The simulation ticks at 100 ms and the renderer runs at 60+ FPS, so following the store
   * position exactly would visibly step. This smooths toward it with a frame-rate-independent
   * factor, and snaps on a large jump so teleports and resets are instant.
   */
  syncPlayer(position: Vec3, facingRad: number, snap = false): void {
    const now = typeof performance === "undefined" ? 0 : performance.now();
    // The water's scroll clock lives here rather than in a new per-frame call, so the surface
    // animates without boot having to wire anything. `updateTime` is still public for whoever
    // eventually owns the frame loop.
    this.updateTime(now / 1000);
    if (!this.playerMesh) return;
    const deltaMs = this.lastSyncMs === 0 ? 16.7 : clamp(now - this.lastSyncMs, 0, 250);
    this.lastSyncMs = now;

    this.playerTarget.set(position[0], position[1], position[2]);
    const jump = this.playerMesh.position.distanceTo(this.playerTarget);
    if (snap || jump > 3.5 || jump === 0) {
      this.playerMesh.position.copy(this.playerTarget);
      this.playerFacing = facingRad;
      this.playerMesh.rotation.y = facingRad;
      this.updateStreaming(position[0], position[2]);
      return;
    }

    const alpha = 1 - Math.pow(0.0015, deltaMs / 1000);
    this.playerMesh.position.lerp(this.playerTarget, alpha);

    let delta = facingRad - this.playerFacing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.playerFacing += delta * Math.min(1, alpha * 1.4);
    this.playerMesh.rotation.y = this.playerFacing;

    this.updateStreaming(position[0], position[2]);
  }

  clear(): void {
    this.scatterVisibility.clear();
    this.terrainGroup.clear();
    this.scatterGroup.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose();
      if (object.userData.ownedGeometry && (object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose();
      if (object.userData.ownedMaterial && (object as THREE.Mesh).isMesh) {
        const material = (object as THREE.Mesh).material;
        for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
      }
    });
    this.scatterGroup.clear();
    this.entityGroup.clear();
    this.overlayGroup.clear();
    this.walkable = [];
    this.fields = [];
    this.mineSurfaces = [];
    this.portalLandforms = [];
    this.flats = [];
    this.world = null;
    this.scatterByRegion.clear();
    this.surfaceNoise = null;
    this.playerMesh = null;
    this.lastSyncMs = 0;
    this.lattice = null;
    this.coastGrid = null;
    this.materials.setOceanDepthGrid(null);
    this.chunks = [];
    this.roads = [];
    this.roadPolylines = [];
    this.roadGrid.clear();
    this.paving = [];
    this.waters = [];
    this.builtWaterBodies = [];
    this.basinSpecs = [];
    this.basins = [];
    this.hauls = [];
    this.haulGrid.clear();
    this.carvedPads.clear();
    this.terrainBuildStats = {
      chunkBuildCount: 0,
      restampPassCount: 0,
      restampedVertexCount: 0,
    };
  }

  /** Final release of scene-owned shared resources. Ordinary clear() rebuilds retain grass. */
  dispose(): void {
    this.clear();
    this.grassBladeGeometry?.dispose();
    this.grassBladeGeometry = null;
    this.grassSpriteGeometry.dispose();
    this.materials.dispose();
  }
}

// ------------------------------------------------------- untextured stone

/**
 * Screen-space relief and mottling for a mesh that has NO UVs and therefore cannot be textured.
 *
 * THE MEASUREMENT. Of the 213 shipped GLBs, 19 carry no texture at all, and the six that matter
 * are the ultimate-platformer rocks: `boulder_large`, `boulder_medium`, `cliff_tall` and
 * `cliff_step_1..3`. Their primitives carry POSITION and NORMAL and nothing else — no TEXCOORD_0,
 * no COLOR_0 — under one `baseColorFactor` of (0.384, 0.208, 0.108) at roughness 0.85. The
 * stylized-nature-megakit rocks beside them (`rock_medium_*`, `pebble_*`, `path_rock_*`) all carry
 * TEXCOORD_0 and an embedded `Rocks_Diffuse` or `PathRocks_Diffuse` jpeg. So this is not a tint
 * being flattened, a texture failing to load, or an atlas tiling once across a large mesh: there is
 * no UV set to sample any texture with, at any scale, and no material swap can fix it. It is why
 * runs/corealm/screenshots/w3-karrowmoor_terraces.png is two thirds smooth pale-tan cones — the
 * Karrowmoor `crags` scatter layer draws `boulder_medium` at up to 2.4x and `cliff_tall` at 1.8x.
 *
 * WHAT THIS DOES INSTEAD. Two octaves of 3D value noise evaluated at the WORLD position need no UVs
 * at all, and the same scalar drives three things: the diffuse mottling, a roughness break-up, and
 * — through `dFdx`/`dFdy` of that scalar — a bump-mapped normal. That last one is what actually
 * kills the cone read; colour alone leaves the silhouette smooth. The perturbation is three's own
 * `perturbNormalArb` inlined, exactly as `materials.ts` `GROUND_NORMAL_BODY` does it and for the
 * same reason: that function is only compiled under `USE_BUMPMAP` and these materials have no
 * bumpMap, so it is not in the program to call.
 *
 * COST. No extra draw calls — the derived material replaces the source on the same
 * `InstancedMesh`, one for one. One extra compiled program per distinct source material, which is
 * two for the whole world (`boulder_medium`'s `Rock` and `cliff_tall`'s), and it is paid at the
 * boot warmup rather than on a frame. Per fragment it is 16 hash evaluations plus the four
 * derivatives, and only on rock.
 *
 * Exported because `render/entityViews.ts` draws the SAME six assets through `BatchedMesh` for
 * landmark and scatter entities and is a different owner's file; `buildings.ts` has moved every
 * composition it owns off the platformer rocks, but `content/regions.ts` still names
 * `boulder_large` as the Great Cairn's hero mesh and `boulder_medium` as the Thornline Stones'.
 */
const STONE_DETAIL_CACHE = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();

/**
 * The neutral the flat platformer brown is pulled toward, and how far.
 *
 * (0.384, 0.208, 0.108) linear renders as sRGB (166, 125, 93), which is the tan in the shots. At
 * 0.75 toward 0x6d6f6e it lands at sRGB (124, 114, 105) — a warm grey that sits with the megakit
 * rocks beside it instead of glowing against them — and the noise then swings it 0.74x to 1.26x.
 */
const STONE_TINT = 0x6d6f6e;
const STONE_TINT_MIX = 0.75;

/** How hard the noise gradient bends the normal. 2.6 was read off the crags at 20-30 m, not close up. */
const STONE_BUMP_SCALE = 2.6;

const STONE_SHARED_HEADER = /* glsl */ `
varying vec3 vStoneWorld;
`;

const STONE_VERTEX_BODY = /* glsl */ `
{
  // 'transformed' is still the object-space position after <project_vertex>; this repeats that
  // chunk's own instancing and batching steps rather than trying to invert the view matrix, which
  // GLSL ES 1.00 has no inverse() for.
  vec4 stoneObject = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    stoneObject = batchingMatrix * stoneObject;
  #endif
  #ifdef USE_INSTANCING
    stoneObject = instanceMatrix * stoneObject;
  #endif
  vStoneWorld = ( modelMatrix * stoneObject ).xyz;
}
`;

const STONE_FRAGMENT_HEADER = /* glsl */ `
float gStoneRelief = 0.0;

float stoneHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float stoneNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( stoneHash( i + vec3( 0.0, 0.0, 0.0 ) ), stoneHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
         mix( stoneHash( i + vec3( 0.0, 1.0, 0.0 ) ), stoneHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
    mix( mix( stoneHash( i + vec3( 0.0, 0.0, 1.0 ) ), stoneHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
         mix( stoneHash( i + vec3( 0.0, 1.0, 1.0 ) ), stoneHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}
`;

const STONE_COLOUR_BODY = /* glsl */ `
{
  // 0.53 m and 2.4 m features, plus a bedding term in world Y warped by the coarse octave. The
  // bedding is what makes a 9 m crag read as rock rather than as noise sprayed on a cone.
  float fine = stoneNoise( vStoneWorld * 1.9 );
  float coarse = stoneNoise( vStoneWorld * 0.42 );
  float bedding = sin( vStoneWorld.y * 2.1 + coarse * 6.28 );
  gStoneRelief = fine * 0.55 + coarse * 0.45 + bedding * 0.13;
  diffuseColor.rgb *= 0.74 + 0.52 * gStoneRelief;
}
`;

const STONE_ROUGHNESS_BODY = /* glsl */ `
roughnessFactor = clamp( roughnessFactor * ( 0.86 + 0.26 * gStoneRelief ), 0.2, 1.0 );
`;

const STONE_NORMAL_BODY = /* glsl */ `
{
  vec2 dHdxy = vec2( dFdx( gStoneRelief ), dFdy( gStoneRelief ) ) * ${STONE_BUMP_SCALE.toFixed(1)};
  vec3 sigmaX = normalize( dFdx( - vViewPosition ) );
  vec3 sigmaY = normalize( dFdy( - vViewPosition ) );
  vec3 r1 = cross( sigmaY, normal );
  vec3 r2 = cross( normal, sigmaX );
  float det = dot( sigmaX, r1 );
  normal = normalize( abs( det ) * normal - sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 ) );
}
`;

/** True when a (geometry, material) pair has no UV set and no base-colour map to sample with one. */
export function needsStoneDetail(geometry: THREE.BufferGeometry, material: THREE.Material): boolean {
  if (geometry.getAttribute("uv") !== undefined) return false;
  const standard = material as THREE.MeshStandardMaterial;
  return standard.isMeshStandardMaterial === true && standard.map === null;
}

/** The derived material for one untextured source material. Cached, so the program compiles once. */
export function stoneDetail(source: THREE.Material): THREE.MeshStandardMaterial {
  const cached = STONE_DETAIL_CACHE.get(source);
  if (cached) return cached;

  const derived = (source as THREE.MeshStandardMaterial).clone();
  derived.name = `${source.name || "stone"}-detail`;
  derived.color.lerp(new THREE.Color(STONE_TINT), STONE_TINT_MIX);
  // Required: without a cache key of its own, three keys the program on the material's PROPERTIES,
  // so an untouched copy of the same GLB material would be handed this one's compiled program.
  derived.customProgramCacheKey = () => "corealm-stone-detail-v1";
  derived.onBeforeCompile = (shader) => {
    shader.vertexShader = `${STONE_SHARED_HEADER}\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${STONE_VERTEX_BODY}`,
    );
    shader.fragmentShader = `${STONE_SHARED_HEADER}${STONE_FRAGMENT_HEADER}\n${shader.fragmentShader}`
      .replace("#include <color_fragment>", `#include <color_fragment>\n${STONE_COLOUR_BODY}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${STONE_ROUGHNESS_BODY}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${STONE_NORMAL_BODY}`);
  };
  STONE_DETAIL_CACHE.set(source, derived);
  return derived;
}

// ------------------------------------------------------------ region fields

/** Authored Vellenwood stream reach. Both ends sit beyond the old semantic region edges. */
const WOODLAND_STREAM_START: readonly [number, number] = [-75, 250];
const WOODLAND_STREAM_END: readonly [number, number] = [430, -55];
const WOODLAND_STREAM_WIDTH = 16;

interface TerraceFrame {
  originX: number;
  originZ: number;
  uphillX: number;
  uphillZ: number;
  lateralX: number;
  lateralZ: number;
  metresPerStep: number;
  steps: number;
}

/** Fixed world-space frame for one authored terrace climb. */
function makeTerraceFrame(spec: RegionTerrainSpec, width: number, depth: number): TerraceFrame {
  const steps = Math.max(1, spec.terraceSteps ?? 4);
  const centreX = (spec.rect.minX + spec.rect.maxX) / 2;
  const centreZ = (spec.rect.minZ + spec.rect.maxZ) / 2;
  let originX = spec.rect.minX;
  let originZ = centreZ;
  let uphillX = 1;
  let uphillZ = 0;
  let climbMetres = width;

  switch (spec.terraceAxis ?? "+x") {
    case "-x":
      originX = spec.rect.maxX;
      uphillX = -1;
      break;
    case "+z":
      originX = centreX;
      originZ = spec.rect.minZ;
      uphillX = 0;
      uphillZ = 1;
      climbMetres = depth;
      break;
    case "-z":
      originX = centreX;
      originZ = spec.rect.maxZ;
      uphillX = 0;
      uphillZ = -1;
      climbMetres = depth;
      break;
  }

  return {
    originX,
    originZ,
    uphillX,
    uphillZ,
    lateralX: -uphillZ,
    lateralZ: uphillX,
    metresPerStep: climbMetres / steps,
    steps,
  };
}

/**
 * Each region gets its own relief, and each relief is chosen for how it plays, not how it looks:
 *
 *  - plains    long sightlines, low gradient. You can see Coldbrace from anywhere on the march.
 *  - woodland  tighter, higher-frequency undulation plus a shallow stream cut. Feels enclosed
 *              without ever producing a slope the navmesh will not accept.
 *  - highlands soft terraces along the authored climb axis, with broad bends and ridge spurs.
 */
function makeRegionField(spec: RegionTerrainSpec): (x: number, z: number) => number {
  const noise = createValueNoise(spec.seed);
  const detail = createValueNoise((spec.seed ^ 0x9e3779b9) >>> 0);
  const width = Math.max(1, spec.rect.maxX - spec.rect.minX);
  const depth = Math.max(1, spec.rect.maxZ - spec.rect.minZ);

  switch (spec.character) {
    case "plains":
      return (x, z) => {
        const rolling = fbm(noise, x, z, 3, 120);
        const swell = fbm(detail, x, z, 2, 46) * 0.28;
        return spec.baseHeight + (rolling + swell) * spec.amplitude * 0.62;
      };

    case "woodland": {
      const streamDX = WOODLAND_STREAM_END[0] - WOODLAND_STREAM_START[0];
      const streamDZ = WOODLAND_STREAM_END[1] - WOODLAND_STREAM_START[1];
      const streamLength = Math.hypot(streamDX, streamDZ);
      const streamX = streamDX / streamLength;
      const streamZ = streamDZ / streamLength;
      const streamNormalX = -streamZ;
      const streamNormalZ = streamX;
      return (x, z) => {
        // Billowed noise (|n|) gives rounded mounds and narrow hollows: the "enclosed" read.
        const mounds = Math.abs(fbm(noise, x, z, 4, 74));
        const ripple = fbm(detail, x, z, 3, 21) * 0.22;
        let height = spec.baseHeight + (mounds * 1.15 + ripple) * spec.amplitude * 0.55;

        // A shallow world-space corridor through Vellenwood. The segment outlives the semantic
        // rectangle, while its broad lateral drift keeps the cut from reading as a ruler line.
        const projected = (x - WOODLAND_STREAM_START[0]) * streamX
          + (z - WOODLAND_STREAM_START[1]) * streamZ;
        const along = clamp(projected, 0, streamLength);
        const meander = Math.sin(along / 72 + 0.65) * 4.5
          + fbm(detail, along, 0, 2, 130) * 3.5;
        const centreX = WOODLAND_STREAM_START[0] + streamX * along + streamNormalX * meander;
        const centreZ = WOODLAND_STREAM_START[1] + streamZ * along + streamNormalZ * meander;
        const distance = Math.hypot(x - centreX, z - centreZ);
        const channel = Math.exp(-Math.pow(distance / WOODLAND_STREAM_WIDTH, 2));
        height -= channel * 2.6;
        return height;
      };
    }

    case "highlands": {
      const frame = makeTerraceFrame(spec, width, depth);
      return (x, z) => {
        // The frame starts at the authored low edge and advances in metres along the uphill axis.
        // Karrowmoor keeps four 52.5 m bands, so its height and broad walkable risers stay familiar.
        const offsetX = x - frame.originX;
        const offsetZ = z - frame.originZ;
        const uphillMetres = offsetX * frame.uphillX + offsetZ * frame.uphillZ;
        const lateralMetres = offsetX * frame.lateralX + offsetZ * frame.lateralZ;

        // A broad lateral bend and a smaller two-dimensional fold break the old straight z bands.
        // Together they move a contour by at most one quarter of a step and retain the wide risers.
        const bendMetres = fbm(noise, lateralMetres, 0, 3, 190) * frame.metresPerStep * 0.18;
        const foldMetres = fbm(detail, x, z, 2, 155) * frame.metresPerStep * 0.07;
        const terracePosition = clamp(
          (uphillMetres * 0.94 + bendMetres + foldMetres) / frame.metresPerStep,
          0,
          frame.steps * 0.999,
        );
        const terraced = terrace(terracePosition, 0.62) / frame.steps;

        // Ridge spurs running across the slope. Ridged noise (1 - |n|) makes crests, not bumps.
        const spur = (1 - Math.abs(fbm(detail, x, z, 3, 105))) * 0.32;
        const rubble = fbm(detail, x * 0.9, z * 0.9, 3, 30) * 0.045;

        return spec.baseHeight + (terraced + spur * 0.22 + rubble) * spec.amplitude;
      };
    }

    case "cavern":
    default:
      return (x, z) => spec.baseHeight + fbm(noise, x, z, 3, 40) * spec.amplitude * 0.3;
  }
}

/**
 * The road corridor, in metres either side of the centreline.
 *
 * A stamp's width is the full worn track. Dirt then feathers over `ROAD_FADE_METRES`, and a gravel
 * shoulder carries the edge the last `ROAD_VERGE_METRES`. Both bands scale with the local width.
 *
 * The first stamped version used 1.9 m and 3.4 m, which put 1.5 m of pure gradient either side of
 * a 3.8 m track, and a 6.8 m corridor that is more than half feather reads as an airbrush smear
 * rather than as a road. A 3.2 m rut band with a 1 m fade keeps the boundary inside one 2 m lattice
 * quad. The shoulder is a MATERIAL change (gravel) rather than less of the same dirt.
 *
 * `ROAD_PERP_RANGE` is only the encoding range of the perpendicular distance in `aGround.x`; at
 * 2.6 m it gives the fragment shader 2.0 cm of resolution, finer than any rut band worth drawing.
 */
const ROAD_DEFAULT_WORN_WIDTH = 3.2;
const ROAD_FADE_METRES = 1;
const ROAD_PERP_RANGE = 2.6;

/** How far past the worn edge the gravel shoulder reaches, in metres. */
const ROAD_VERGE_METRES = 1.1;

/** Maximum local width drift. Its two broad waves sum to this fraction. */
const ROAD_WIDTH_DRIFT = 0.13;

/**
 * How far the macro field may bias the grass/dry split, as a fraction of the whole ramp.
 *
 * 0.34 is enough that a flat settlement pad, whose altitude ramp is one constant number, still
 * shows dry patches and lush patches; small enough that the region's authored altitude palette is
 * still the thing you read when you walk uphill.
 */
const SURFACE_MACRO_RANGE = 0.34;

/** Bucket size for the road segment grid, in metres. One bucket covers the whole fade width. */
const ROAD_CELL = 8;

/**
 * How far a paved edge feathers into the ground around it, in metres.
 *
 * 1.2 m of ramp starting exactly ON the authored rectangle, which is what this was, draws a hard
 * axis-aligned line: the cobble swatch at full strength right up to a straight edge and then a
 * metre of gradient. Against a green field that reads as a decal, which is what a player sees
 * looking north out of Coldbrace's square. The band is wider now and STRADDLES the edge - it
 * begins 0.4 x this inside the rect and ends 0.6 x outside - so the paving thins before it stops.
 */
const PAVING_FEATHER = 2.4;

/**
 * The same band for a KERBED rect, in metres.
 *
 * A kerb is a laid boundary and the pavement runs right up to it, so this is a mortar joint rather
 * than a transition: wide enough that the 2 m terrain lattice can still resolve it, narrow enough
 * that the paving reaches the kerb instead of stopping a metre inside it.
 */
const PAVING_KERB_FEATHER = 0.7;

/**
 * How far the paved edge wanders off the authored rectangle, in metres.
 *
 * Two octaves of the surface noise: 7.3 m sets which stretch of the edge has crept out into the
 * grass and which has been worn back, and 2.6 m breaks the line between them so it is a coastline
 * rather than one soft gradient. Nothing else in the ground stamp is axis-aligned, and a town
 * square is the one place the player stands still and looks at the boundary.
 */
const PAVING_EDGE_WOBBLE = 0.9;

/** Gravel shoulder outside the paved edge, in metres. The verge a worn approach actually has. */
const PAVING_VERGE_METRES = 1.7;

/** How far past a water body's radius the bank treatment reaches, in metres. */
const WATER_BANK_METRES = 6;

/**
 * Arc between two shoreline spokes, in metres. NOT a fixed azimuth count.
 *
 * A fixed 32 spokes is 4.5 m of arc at the Redsill rim, and the fan draws a straight chord across
 * every one of those gaps whatever the ground does inside it. Measured on the shipped world with
 * `__gameDebug.groundHeight` on a 1 m grid over each disc footprint (runs/corealm/audit/
 * wd-measure.ts): 14.6% of the Redsill footprint and 18.4% of the Cairn Tarn's had DRY GROUND
 * above the drawn surface, by up to 5.16 m — spurs narrower than one spoke gap, that the solver
 * never sampled and the fan therefore flooded.
 *
 * 2 m is the terrain lattice's own quad, so the shoreline is now sampled at the finest spacing the
 * drawn mesh can actually represent a bank at. The spoke count follows the body's size, clamped so
 * a 2.5 m pool is still round and the widest disc in the world stays under 200 spokes.
 */
const WATER_SHORE_ARC = 2;
const WATER_MIN_SEGMENTS = 32;
const WATER_MAX_SEGMENTS = 192;

/** Rings between the hub and the shoreline. */
const WATER_RINGS = 12;

/**
 * Ring distribution exponent. `radius = reach * pow(ring / rings, WATER_RING_BIAS)`.
 *
 * Evenly spaced rings put reach/12 = 1.9 m between the last two at Redsill, which is wider than
 * the band `WATER_EDGE_METRES` has to taper across, so the taper landed on a single vertex and
 * the edge came back as a hard arc. 0.6 packs the outer ring spacing down to 5.1% of the reach.
 */
const WATER_RING_BIAS = 0.6;

/**
 * How far in from the waterline the drawn depth is tapered to zero, in metres.
 *
 * The depth attribute drives the material's colour ramp AND its alpha (`materials.water`, alpha =
 * smoothstep(0, 0.25 m, depth)), so this is the width of the wet edge. It used to be "the outer
 * ring", which is a resolution-dependent distance: reach/10, or 2.3 m at Redsill and 0.25 m at a
 * small pool. A metre and a bit is a bank, at any size of pond.
 */
const WATER_EDGE_METRES = 1.4;

/** An authored body shallower than this is rejected instead of drawing a film over dry ground. */
const WATER_MIN_CENTRE_DEPTH = 0.25;

/**
 * Outward march step when solving for the shoreline, in metres.
 *
 * 1 m is half the terrain lattice's 2 m quad, so the march cannot step over a bank the drawn mesh
 * is able to represent. 26 steps on the widest disc in the world, then 12 bisections inside the
 * metre it crossed in, which resolves the waterline to 0.25 mm.
 */
const WATER_MARCH_METRES = 0.5;



/**
 * Horizon-AO sampling: 8 azimuths at 12 / 25 / 50 m, and a floor of 0.62 at a fully blocked
 * horizon. Three ranges rather than one because a hillside is read at three scales at once — a
 * bank at 12 m, a spur at 25 m, a ridge at 50 m — and a single range only darkens one of them.
 */
const AO_AZIMUTHS = 8;
const AO_RANGES: readonly number[] = [12, 25, 50];
const AO_FLOOR = 0.62;

/** Coast quads used to join the canonical mesh before the unchanged organic relief takes over. */
const COAST_EDGE_PIN_METRES = 8;

/** Tolerance for authored coast dimensions that must share exact terrain-grid nodes. */
const COAST_GRID_EPSILON = 1e-6;

/** Keeps visual scatter roots clear of the ocean plane and its depth edge. */
const COAST_SCATTER_WATER_CLEARANCE = 0.08;

/**
 * How far a pad may carve BELOW the natural ground at its own centre, in metres.
 *
 * The fishing basins are authored as a depth below the region floor, and Karrowmoor's terraces
 * climb 36 m above theirs, so the Cairn Tarn and the Far Tarn were both authored 36 m inside a
 * hillside. See `resolveFlatTargets` for what that cost. 2.6 m is deeper than the 0.9 m the
 * content asks for and shallow enough that the bank stays walkable without a wide collar.
 */
const MAX_PAD_CARVE = 2.6;

/**
 * Softening term in the inverse-distance pad weight, in METRES, which sets the weight at a pad's
 * core edge.
 *
 * 1e-5 m puts the core-edge weight at 1e5 against about 0.05 for a pad 20 m away, so a settlement
 * pad outweighs anything reaching into it by six orders of magnitude. That is what keeps the
 * measured relief across the 7,238 m2 Coldbrace pad at 0.0000 m and lets a building assemble level
 * on it. Finite, so the field stays continuous across the core boundary.
 */
const PAD_CORE_EPSILON = 1e-5;

/**
 * Haul roads: the graded corridors `buildHaulRoads` cuts between flat pads. Every number here is
 * measured against `NAV_CONFIG` in app/config.ts, which is cs 0.45 (large world), walkableRadius 1
 * voxel = 0.45 m, walkableClimb 0.40 m, and the directional uphill limit is 64 degrees. Haul roads
 * stay far gentler than that so their local collars remain reliable after rasterisation.
 *
 * HAUL_TRIGGER_GRADE 0.50 (26.6 degrees) is where a link stops being walkable in practice rather
 * than in theory: recast rasterises at 0.45 m and the 2 m terrain lattice quantises the slope it
 * sees, and a smoothstep collar peaks at 1.5x its own mean gradient, so ground whose link mean
 * measures 0.50 has produced local spans at 0.75 that recast rejected. Everything under it is left
 * exactly as the region field wrote it.
 *
 * HAUL_ROAD_GRADE 0.30 (16.7 degrees) is what a graded corridor aims for. Less than a third of the
 * limit, because the graded profile is not what the player walks on: the corridor is blended into
 * the pads and the region field around it, and every measured route comes out steeper on the
 * surface than on its own profile. Measured over all 15 authored Karrowmoor road links, 0.30 puts
 * the worst surface metre on each between 13.6 and 32.1 degrees, mean 21.1.
 *
 * HAUL_ROAD_HALF 2.6 m of full regrade is 5.2 m of flat lane. Recast erodes walkableRadius 0.45 m
 * from each side, so 4.3 m of walkable width survives - nearly five times the agent - and the
 * collar outside it is graded too, so the usable corridor is wider still.
 *
 * HAUL_MIN_LINK 10 m was 18, which silently dropped the shortest authored ramp in the world: the
 * Lower Quarry to the Gravelmaw mouth is 16.1 m apart with a 3.91 m step, so it got no corridor
 * and measured 1.85 (61.6 degrees). The 16 m walk between them pathed 131.1 m round the outside.
 * Nothing is lost by lowering it, because two pads at the same height never trip
 * HAUL_TRIGGER_GRADE in the first place; HAUL_MAX_LINK 150 m is longer than the longest authored
 * road link in the world (the 110.5 m Moor Road Bend to Lower Quarry) with margin.
 */
const HAUL_TRIGGER_GRADE = 0.50;
const HAUL_ROAD_GRADE = 0.30;
const HAUL_ROAD_HALF = 2.6;
const HAUL_MIN_LINK = 10;
const HAUL_MAX_LINK = 150;

/** Spacing at which a haul road's profile is sampled and graded, in metres. Matches the lattice. */
const HAUL_SAMPLE_METRES = 2;

/**
 * Cap on the grading blur. Each pass halves the profile's curvature over one sample, so spreading
 * a 15 m step to a 0.45 gradient at 2 m spacing needs about 90 passes; 600 leaves room for the
 * longest link in the world and the loop exits the moment the profile is walkable anyway.
 */
const HAUL_SMOOTH_PASSES = 600;

/** Below this much movement a corridor is not worth cutting, in metres. */
const HAUL_MIN_CUT = 0.35;

/**
 * Ratio of a smoothstep's steepest gradient to its mean, which is exactly 1.5: the derivative of
 * 3t^2 - 2t^3 is 6t(1 - t), which peaks at t = 0.5 with value 1.5.
 *
 * Every collar in this file — a pad's blend, a corridor's feather, a corridor's handback to a pad
 * — is a smoothstep, and every one of them used to be sized as `drop / gradient`, which sets the
 * MEAN gradient and lets the middle of the collar run half again as steep. That is not a rounding
 * error: `normaliseFlats` aims a pad collar at 0.6 (31 degrees) and Highcairn's measured 43.2.
 */
const SMOOTHSTEP_PEAK = 1.5;

/** Gradient of the corridor's own collar back into the hillside. */
const HAUL_FEATHER_GRADE = 0.5;
const HAUL_MIN_FEATHER = 3;
const HAUL_MAX_FEATHER = 22;

/** Bucket size for the haul-road segment grid, in metres. One bucket spans the widest collar. */
const HAUL_CELL = 26;

/** Segments per road in the packed grid key. Far more than any link can produce at 2 m spacing. */
const HAUL_INDEX_STRIDE = 4096;

/**
 * Pad reach at or above which a pad is buildable ground rather than a location marker, in metres.
 *
 * Measured across the authored world's 47 pads: 40 location markers at radius 7, three settlement
 * pads at 26.1, 34.1 and 43, four basins (protected by their explicit height instead). 20 m sits
 * in the 19 m gap between the two populations.
 */
const HAUL_PROTECTED_PAD_REACH = 20;

/** Spacing at which a stamped road polyline is resampled into segments, in metres. */
const ROAD_SEGMENT_SPACING = 4;

/** Maximum lateral displacement on a long open road leg, in metres. */
const ROAD_MAX_SWAY = 9;

/** Distance near an authored control over which its centreline straightens, in metres. */
const ROAD_CONTROL_TAPER = 16;

/** Reused in the scatter tilt slerp. Allocating one per instance showed up in the profile. */
const IDENTITY_QUATERNION = new THREE.Quaternion();

interface HeightLattice {
  heights: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  step: number;
}

interface CoastHeightGrid {
  heights: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  stepX: number;
  stepZ: number;
}

interface ChunkRecord {
  mesh: THREE.Mesh;
  centreX: number;
  centreZ: number;
  sizeX: number;
  sizeZ: number;
}

interface RoadSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  aWidth: number;
  bWidth: number;
}

/** The eight surface weights at one point, plus the colour they blend to. */
interface SurfaceSample {
  colour: THREE.Color;
  grass: number;
  dry: number;
  rock: number;
  gravel: number;
  dirt: number;
  mud: number;
  cobble: number;
  wet: number;
  /** What the paving under this vertex is made of, as `PAVING_SURFACE_CODE`. */
  pavedKind: number;
  /** Signed perpendicular distance to the nearest road, remapped onto 0..1. 0.5 is no road. */
  roadPerpendicular: number;
  /** 1 where a road is close enough for wheel ruts to exist. */
  roadPresence: number;
  /** How worn the track is here, 0 at the shoulder to 1 on the centreline. Drives rut depth. */
  roadWear: number;
  /** The macro-variation field, remapped onto 0..1 with 0.5 as its mean. */
  macro: number;
}

function emptySurface(): SurfaceSample {
  return {
    colour: new THREE.Color(),
    grass: 1, dry: 0, rock: 0, gravel: 0,
    dirt: 0, mud: 0, cobble: 0, wet: 0, pavedKind: 0,
    roadPerpendicular: 0.5, roadPresence: 0, roadWear: 0, macro: 0.5,
  };
}

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Packs one surface sample into the three Uint8 vertex attributes the ground shader reads. */
function writeSplat(
  splatA: Uint8Array,
  splatB: Uint8Array,
  extra: Uint8Array,
  paved: Uint8Array,
  index: number,
  surface: SurfaceSample,
): void {
  splatA[index * 4] = toByte(surface.grass);
  splatA[index * 4 + 1] = toByte(surface.dry);
  splatA[index * 4 + 2] = toByte(surface.rock);
  splatA[index * 4 + 3] = toByte(surface.gravel);
  splatB[index * 4] = toByte(surface.dirt);
  splatB[index * 4 + 1] = toByte(surface.mud);
  splatB[index * 4 + 2] = toByte(surface.cobble);
  splatB[index * 4 + 3] = toByte(surface.wet);
  extra[index * 4] = toByte(surface.roadPerpendicular);
  extra[index * 4 + 1] = toByte(surface.roadPresence);
  extra[index * 4 + 2] = toByte(surface.roadWear);
  extra[index * 4 + 3] = toByte(surface.macro);
  paved[index] = toByte(surface.pavedKind);
}

interface GroundSwatches {
  low: THREE.Color;
  high: THREE.Color;
  rock: THREE.Color;
  gravel: THREE.Color;
  dirt: THREE.Color;
  mud: THREE.Color;
  cobble: THREE.Color;
  brick: THREE.Color;
  plank: THREE.Color;
  wet: THREE.Color;
}

/**
 * The palette swatches the terrain blends between, as linear colours, cached per region.
 *
 * Hue lives in `REGION_PALETTES` and in `materials.surfaceColour`; the terrain only weights them.
 * The cache exists because `sampleSurface` runs ~73k times and allocating eight `THREE.Color`
 * objects per call was the largest single cost in the chunk builder.
 */
const SWATCH_CACHE = new Map<RegionId, GroundSwatches>();

function swatchesFor(regionId: RegionId): GroundSwatches {
  const cached = SWATCH_CACHE.get(regionId);
  if (cached) return cached;
  const palette = REGION_PALETTES[regionId];
  const swatches: GroundSwatches = {
    low: new THREE.Color(palette.groundLow),
    high: new THREE.Color(palette.groundHigh),
    rock: new THREE.Color(palette.rock),
    gravel: new THREE.Color(surfaceColour(regionId, "gravel")),
    dirt: new THREE.Color(surfaceColour(regionId, "dirt")),
    mud: new THREE.Color(surfaceColour(regionId, "mud")),
    cobble: new THREE.Color(surfaceColour(regionId, "cobble")),
    brick: new THREE.Color(surfaceColour(regionId, "brick")),
    plank: new THREE.Color(surfaceColour(regionId, "plank")),
    wet: new THREE.Color(surfaceColour(regionId, "wet")),
  };
  SWATCH_CACHE.set(regionId, swatches);
  return swatches;
}

/** The height range a region's own field produces over its rect, swept at 4 m. Costs about 6 ms. */
function sweepFieldRange(rect: Rect, height: (x: number, z: number) => number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let z = rect.minZ; z <= rect.maxZ; z += 4) {
    for (let x = rect.minX; x <= rect.maxX; x += 4) {
      const value = height(x, z);
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-3) return { min: 0, max: 1 };
  return { min, max };
}

/** One graded corridor, sampled at `HAUL_SAMPLE_METRES` along a pad-to-pad link. */
interface HaulRoad {
  xs: Float64Array;
  zs: Float64Array;
  /** The graded height at each sample, in metres. */
  heights: Float64Array;
  /** Collar width outside `HAUL_ROAD_HALF` at each sample, in metres. */
  feather: Float64Array;
}

/** Largest height change between neighbouring profile samples, in metres. */
function worstRise(profile: Float64Array): number {
  let worst = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const rise = Math.abs(profile[index]! - profile[index - 1]!);
    if (rise > worst) worst = rise;
  }
  return worst;
}

/**
 * True when no third pad sits inside the circle with AB as its diameter.
 *
 * The Gabriel graph is the right shape for "which pads are next to each other": it is local, it
 * has no crossing edges, and it never joins two pads with a third standing between them - which is
 * exactly the long chord that would otherwise cut a corridor straight through a settlement. The
 * test is on pad CENTRES only, because a pad's core is flat and a corridor through flat ground
 * costs nothing.
 *
 * `waived` decides which blockers do not count - see `buildHaulRoads` for the ramp that cost.
 */
function isGabrielNeighbour(
  pads: readonly FlatSpot[],
  i: number,
  j: number,
  waived: (flat: FlatSpot) => boolean,
): boolean {
  const a = pads[i]!;
  const b = pads[j]!;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const radiusSquared = ((a.x - b.x) ** 2 + (a.z - b.z) ** 2) / 4;
  for (let k = 0; k < pads.length; k += 1) {
    if (k === i || k === j) continue;
    const other = pads[k]!;
    if ((other.x - midX) ** 2 + (other.z - midZ) ** 2 >= radiusSquared) continue;
    if (waived(other)) continue;
    return false;
  }
  return true;
}

/** How far a pad's core reaches from its centre, in metres. Half-diagonal for a rectangle. */
function padReach(flat: FlatSpot): number {
  if (!flat.halfExtents) return flat.radius;
  return Math.hypot(flat.halfExtents[0], flat.halfExtents[1]);
}

/** Distance from a point to the edge of a pad's core. Zero or negative inside it. */
function padDistance(flat: FlatSpot, x: number, z: number): number {
  if (!flat.halfExtents) return Math.hypot(x - flat.x, z - flat.z) - flat.radius;
  return rectDistance(x, z, [flat.x, flat.z], flat.halfExtents, flat.rotationY ?? 0);
}

/**
 * Signed distance from a point to a rotated rectangle: 0 on the boundary, negative inside.
 *
 * Inside is the negative of the distance to the nearest edge, which is what makes a rectangular
 * pad's core weight rise toward its middle exactly the way a circular pad's does.
 */
function rectDistance(
  x: number,
  z: number,
  centre: readonly [number, number],
  halfExtents: readonly [number, number],
  rotationY: number,
): number {
  const dx = x - centre[0];
  const dz = z - centre[1];
  const cos = Math.cos(-rotationY);
  const sin = Math.sin(-rotationY);
  const lx = Math.abs(dx * cos - dz * sin) - halfExtents[0];
  const lz = Math.abs(dx * sin + dz * cos) - halfExtents[1];
  const outside = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
  const inside = Math.min(Math.max(lx, lz), 0);
  return outside + inside;
}

function cellKey(cx: number, cz: number): number {
  // 20 bits per axis, biased into the positive range. The world is 700 x 400 m at 8 m per cell, so
  // this cannot collide for anything the game is able to build.
  return ((cx + 0x40000) << 20) ^ (cz + 0x40000);
}

/**
 * Turns a `content/regions.ts` `PavingDef.rect` into a stamp.
 *
 * Exported so the wiring in boot cannot get the centre/half-extent conversion wrong: the content
 * layer authors paving as an axis-aligned min/max rect and the stamp works in centre-plus-extent,
 * and a sign error there would put a cobbled square in the wrong half of a settlement.
 */
export function pavingStampFromRect(
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  options: { surface?: PavingSurface; kerb?: boolean } = {},
): PavingStamp {
  return {
    centre: [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2],
    halfExtents: [Math.abs(rect.maxX - rect.minX) / 2, Math.abs(rect.maxZ - rect.minZ) / 2],
    surface: options.surface ?? "stone",
    kerb: options.kerb === true,
  };
}

function roadOuterHalf(wornWidth: number): number {
  const width = Number.isFinite(wornWidth) ? Math.max(0.25, wornWidth) : ROAD_DEFAULT_WORN_WIDTH;
  const scale = width / ROAD_DEFAULT_WORN_WIDTH;
  return width / 2 + (ROAD_FADE_METRES + ROAD_VERGE_METRES) * scale;
}

/** Stable seed for one authored feature. Array insertion and reordering cannot move another road. */
function roadSeedFromStamp(worldSeed: number, road: RoadStamp): number {
  let hash = (worldSeed ^ 0x811c9dc5) >>> 0;
  const mix = (value: number): void => {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  mix(road.points.length);
  for (const point of road.points) {
    mix(Math.round(point[0] * 1000));
    mix(Math.round(point[2] * 1000));
  }
  mix(Math.round((road.width ?? ROAD_DEFAULT_WORN_WIDTH) * 1000));
  return hash;
}

/** Chops a polyline into short segments and gives each endpoint a deterministic local width. */
function appendRoadSegments(
  into: RoadSegment[],
  points: readonly Vec3[],
  wornWidth: number,
  seed: number,
  stableControls: readonly Vec3[],
): void {
  const samples = resamplePolyline(points, ROAD_SEGMENT_SPACING);
  if (samples.length < 2) return;
  const baseWidth = Number.isFinite(wornWidth) ? Math.max(0.25, wornWidth) : ROAD_DEFAULT_WORN_WIDTH;
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0);
  const period = rng.float(30, 44);
  const longPeriod = period * rng.float(1.7, 2.2);
  const phase = rng.float(0, Math.PI * 2);
  const longPhase = rng.float(0, Math.PI * 2);
  const distances = new Float64Array(samples.length);
  const widths = new Float64Array(samples.length);

  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1]!;
    const sample = samples[i]!;
    distances[i] = distances[i - 1]! + Math.hypot(sample[0] - previous[0], sample[2] - previous[2]);
  }
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    let controlDistance = Infinity;
    for (const control of stableControls) {
      controlDistance = Math.min(controlDistance, Math.hypot(sample[0] - control[0], sample[2] - control[2]));
    }
    const controlFade = smoothstep01(controlDistance / 10);
    const distance = distances[i]!;
    const drift = (
      Math.sin(distance / period * Math.PI * 2 + phase) * 0.09
      + Math.sin(distance / longPeriod * Math.PI * 2 + longPhase) * 0.04
    ) * controlFade;
    widths[i] = baseWidth * (1 + drift);
  }

  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    into.push({
      ax: a[0], az: a[2], bx: b[0], bz: b[2],
      aWidth: widths[i]!, bWidth: widths[i + 1]!,
    });
  }
}

/**
 * Bends each authored leg into a route while preserving every supplied waypoint.
 *
 * Each leg advances monotonically along its chord and moves only along the perpendicular. Seeded
 * guides vary their spacing, side and depth, then a cubic ease joins them without overshoot. A
 * smooth envelope removes the offset near both controls, so gate approaches stay centred.
 *
 * The route graph is unaffected. It works on node ids, and both endpoints here are untouched, so
 * the distance ledger the Agility route flip is measured against does not move.
 */
export function curveRoadPolyline(points: readonly Vec3[], seed: number): Vec3[] {
  if (points.length < 2) return points.map((point) => [point[0], point[1], point[2]] as Vec3);
  const rng = new Rng(seed);
  const output: Vec3[] = [];

  for (let leg = 0; leg < points.length - 1; leg += 1) {
    const start = points[leg]!;
    const end = points[leg + 1]!;
    const dx = end[0] - start[0];
    const dz = end[2] - start[2];
    const length = Math.hypot(dx, dz);
    const divisions = Math.max(1, Math.ceil(length / ROAD_SEGMENT_SPACING));
    const legPoints: Vec3[] = [];
    const nx = length > 1e-9 ? -dz / length : 0;
    const nz = length > 1e-9 ? dx / length : 0;
    const sway = Math.min(ROAD_MAX_SWAY, Math.max(0, length - 14) * 0.11);
    const taperMetres = Math.min(ROAD_CONTROL_TAPER, length * 0.36);
    const guideCount = Math.max(1, Math.min(4, Math.round(length / 27)));
    const guideTs = [0];
    const guideOffsets = [0];
    const deepGuide = rng.int(0, guideCount - 1);

    for (let guide = 0; guide < guideCount; guide += 1) {
      const interval = 1 / (guideCount + 1);
      guideTs.push((guide + 1) * interval + rng.float(-interval * 0.28, interval * 0.28));
      const sign = rng.chance(0.5) ? -1 : 1;
      const depth = guide === deepGuide ? rng.float(0.74, 1) : rng.float(0.18, 0.82);
      guideOffsets.push(sign * sway * depth);
    }
    guideTs.push(1);
    guideOffsets.push(0);

    for (let division = 0; division <= divisions; division += 1) {
      const t = division / divisions;
      const edgeDistance = Math.min(t * length, (1 - t) * length);
      const envelope = taperMetres > 0 ? smoothstep01(edgeDistance / taperMetres) : 0;
      const offset = envelope * sampleRoadGuideOffset(guideTs, guideOffsets, t);
      legPoints.push([
        start[0] + dx * t + nx * offset,
        start[1] + (end[1] - start[1]) * t,
        start[2] + dz * t + nz * offset,
      ]);
    }
    legPoints[0] = [start[0], start[1], start[2]];
    legPoints[legPoints.length - 1] = [end[0], end[1], end[2]];

    output.push(...(leg === 0 ? legPoints : legPoints.slice(1)));
  }

  return output;
}

/** Smooth interpolation between uneven lateral guides, bounded by their two offsets. */
function sampleRoadGuideOffset(ts: readonly number[], offsets: readonly number[], t: number): number {
  for (let guide = 0; guide < ts.length - 1; guide += 1) {
    const endT = ts[guide + 1]!;
    if (t > endT) continue;
    const startT = ts[guide]!;
    const localT = smoothstep01((t - startT) / Math.max(1e-6, endT - startT));
    return offsets[guide]! + (offsets[guide + 1]! - offsets[guide]!) * localT;
  }
  return offsets[offsets.length - 1] ?? 0;
}

/** Even-ish resampling of a polyline, so road corridors do not stretch across long segments. */
function resamplePolyline(points: readonly Vec3[], spacing: number): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  output.push(points[points.length - 1]!);
  return output;
}
