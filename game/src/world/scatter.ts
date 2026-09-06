import { TREE_SPECIES, treeAssetIds, treeSpeciesForAsset, treeEncounterWeight, type TreeSpeciesId } from "../content/treeSpecies.js";
/**
 * Deterministic ecological dressing around authored sites. Generate stable candidates on the
 * 96 m world grid. Native understory reserves growing space within those original patches;
 * trees and grass retain their exact streams. Render shards keep native geometry at every distance.
 * Ordinary forest descriptors feed nearby harvesting; distant trees remain static instances.
 * Placement exclusions, terrain, climate, roads and water use the production world fields.
 */
import type { RegionId, Vec3 } from "../contracts.js";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { ForestTreeDescriptor } from "./forestResources.js";
import { GRASS_COLOURS } from "../render/artDirection.js";
import { REGIONS } from "../content/regions.js";
import { Rng } from "../core/rng.js";
import { BOOT_SPANS, bootTelemetry } from "../perf/bootTelemetry.js";
import type { AssetPriority, AssetRegistry } from "../render/assets.js";
import {
  createValueNoise,
  type GrassSpritePlacement,
  type Rect,
  type ScatterPlacement,
  type WorldScene,
} from "../render/scene.js";

// ------------------------------------------------------------- exclusions

export type ExclusionKind =
  | "building"
  | "settlement"
  | "road"
  | "cluster"
  | "spawn"
  | "water"
  | "ritual"
  | "worksite"
  | "custom";

interface CircleZone { kind: ExclusionKind; id: string; x: number; z: number; radius: number }
interface RectZone {
  kind: ExclusionKind;
  id: string;
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  rotationY: number;
  margin: number;
}

interface TreeClearance {
  id: string;
  /** Counterclockwise convex hull in XZ, with point and segment degeneracies retained. */
  hull: readonly (readonly [number, number])[];
  bodyRadius: number;
  bounds: Rect;
}

/**
 * How one layer answers one zone: dead clear out to `hard` metres past the zone edge, then ramping
 * linearly to full density over the next `fade` metres.
 *
 * `hard` may be negative, which reaches INSIDE the zone. Ground cover uses that, because the root
 * registers every settlement on a flat 46 m circle while the widest settlement actually authored
 * measures 33.9 m from its centre (Coldbrace; Rootfall 22.4 m, Highcairn 22.1 m). A boolean test on
 * that circle is what produced the bare disc in every settlement screenshot.
 */
export interface ExclusionBand { hard: number; fade: number }

export interface ExclusionProfile {
  base: ExclusionBand;
  byKind?: Partial<Record<ExclusionKind, ExclusionBand>>;
  /**
   * Band against a settlement's own authored buildings, wall runs, paving and props, which are a
   * separate zone set from the root's one 46 m ring per settlement. Defaults to `base`.
   */
  authored?: ExclusionBand;
  /** Building-footprint override within the authored set. Defaults to `authored`. */
  authoredBuilding?: ExclusionBand;
}

const HARD_EDGE: ExclusionProfile = { base: { hard: 0, fade: 0 } };

/**
 * Widest reach the circle index is built for, in metres. Any profile asking for more than this
 * falls back to a linear scan, which is correct but O(zones); the world registers ~870 circles
 * (mostly road corridor stamps) and scatter evaluates the field ~50,000 times per build, so the
 * index is the difference between a 40 ms and a 2 s dressing pass.
 */
const ZONE_INDEX_REACH = 48;
const ZONE_CELL = 24;
const exclusionRevisions = new WeakMap<ExclusionZones, number>();
let nextExclusionRevision = 0;

/**
 * Places nothing may be scattered, and how sharply. Registered by the root before `scatterRegion`
 * runs, because scatter has no idea what a bank or an ore seam is and must not learn.
 */
export class ExclusionZones {
  private circles: CircleZone[] = [];
  private rects: RectZone[] = [];
  private treeClearances: TreeClearance[] = [];
  private index: Map<number, number[]> | null = null;
  private rectIndex: Map<number, number[]> | null = null;

  addCircle(x: number, z: number, radius: number, kind: ExclusionKind = "custom", id = ""): this {
    this.circles.push({ kind, id, x, z, radius });
    exclusionRevisions.set(this, ++nextExclusionRevision);
    this.index = null;
    return this;
  }

  addPoint(position: Vec3, radius: number, kind: ExclusionKind = "cluster", id = ""): this {
    return this.addCircle(position[0], position[2], radius, kind, id);
  }

  addRect(rect: Rect, margin = 0, kind: ExclusionKind = "settlement", id = ""): this {
    return this.addOrientedRect(
      (rect.minX + rect.maxX) / 2,
      (rect.minZ + rect.maxZ) / 2,
      rect.maxX - rect.minX,
      rect.maxZ - rect.minZ,
      0,
      margin,
      kind,
      id,
    );
  }

  /** A precise footprint rectangle in its own rotated frame. Width/depth are full extents. */
  addOrientedRect(
    x: number,
    z: number,
    width: number,
    depth: number,
    rotationY: number,
    margin = 0,
    kind: ExclusionKind = "settlement",
    id = "",
  ): this {
    this.rects.push({
      kind,
      id,
      x,
      z,
      halfX: Math.max(0, width / 2),
      halfZ: Math.max(0, depth / 2),
      rotationY,
      margin,
    });
    this.rectIndex = null;
    exclusionRevisions.set(this, ++nextExclusionRevision);
    return this;
  }

  /** A road, river or path. Registered as overlapping circles along the spline. */
  addCorridor(points: readonly Vec3[], width: number, kind: ExclusionKind = "road", id = ""): this {
    const radius = width / 2;
    const spacing = Math.max(1.5, radius * 0.85);
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        this.addCircle(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, radius, kind, id);
      }
    }
    return this;
  }

  /**
   * Reserves a local convex walking footprint for tree trunks only. One point makes a disc, two
   * make an exact capsule, and more points reserve their convex interior. The root supplies the
   * animal's movement envelope and drawn body radius; scatter owns neither habitat nor AI policy.
   * This separate query lane never participates in candidate generation or exclusion profiles.
   */
  addTreeClearance(points: readonly Vec3[], bodyRadius: number, id = ""): this {
    if (!Number.isFinite(bodyRadius) || bodyRadius < 0) throw new Error("Tree clearance needs a finite nonnegative body radius.");
    if (points.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[2]))) {
      throw new Error("Tree clearance needs finite XZ positions.");
    }
    if (points.length === 0) return this;
    const hull = treeClearanceHull(points);
    this.treeClearances.push({
      id, hull, bodyRadius,
      bounds: {
        minX: Math.min(...hull.map((point) => point[0])), maxX: Math.max(...hull.map((point) => point[0])),
        minZ: Math.min(...hull.map((point) => point[1])), maxZ: Math.max(...hull.map((point) => point[1])),
      },
    });
    exclusionRevisions.set(this, ++nextExclusionRevision);
    return this;
  }

  /** Tests the final trunk origin against the body footprint expanded by that trunk's radius. */
  blocksTreeClearance(x: number, z: number, trunkRadius: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(trunkRadius) || trunkRadius < 0) {
      throw new Error("Tree clearance query needs finite XZ and a nonnegative trunk radius.");
    }
    for (const zone of this.treeClearances) {
      // Endpoint subtraction can place exact contact a few ulps outside a diagonal capsule.
      // Scale the rounding allowance to world coordinates; it remains picometres on this island.
      const rounding = 16 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(z),
        Math.abs(zone.bounds.minX), Math.abs(zone.bounds.maxX), Math.abs(zone.bounds.minZ), Math.abs(zone.bounds.maxZ));
      const reach = zone.bodyRadius + trunkRadius + rounding;
      // There are few authored walking footprints. Skip their boxes before doing polygon work.
      if (x < zone.bounds.minX - reach || x > zone.bounds.maxX + reach
        || z < zone.bounds.minZ - reach || z > zone.bounds.maxZ + reach) continue;
      const squaredReach = reach * reach;
      const first = zone.hull[0]!;
      if (zone.hull.length === 1) {
        if ((x - first[0]) ** 2 + (z - first[1]) ** 2 <= squaredReach) return true;
        continue;
      }
      let inside = zone.hull.length > 2;
      const edges = zone.hull.length === 2 ? 1 : zone.hull.length;
      for (let index = 0; index < edges; index += 1) {
        const from = zone.hull[index]!;
        const to = zone.hull[(index + 1) % zone.hull.length]!;
        const dx = to[0] - from[0], dz = to[1] - from[1];
        const px = x - from[0], pz = z - from[1];
        if (dx * pz - dz * px < 0) inside = false;
        const fraction = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)));
        if ((px - dx * fraction) ** 2 + (pz - dz * fraction) ** 2 <= squaredReach) return true;
      }
      if (inside) return true;
    }
    return false;
  }

  /**
   * 0..1 planting density at a point: 0 inside a zone plus its `hard` margin, 1 once every zone is
   * `hard + fade` metres away, linear between. The minimum over all zones, so the tightest rule
   * wins.
   *
   * This replaced a boolean `blocks()` because the boolean is what produced the bare 46 m disc
   * around every settlement — trees, bushes, grass and pebbles all stopped dead on the same circle
   * and nothing was planted inside it.
   */
  densityAt(x: number, z: number, profile: ExclusionProfile = HARD_EDGE): number {
    let density = 1;
    for (const circle of this.circleCandidates(x, z, profile)) {
      const band = profile.byKind?.[circle.kind] ?? profile.base;
      const outside = Math.hypot(x - circle.x, z - circle.z) - circle.radius;
      density = Math.min(density, ramp(outside, band));
      if (density <= 0) return 0;
    }
    for (const zone of this.rectCandidates(x, z, profile)) {
      const band = profile.byKind?.[zone.kind] ?? profile.base;
      const worldX = x - zone.x;
      const worldZ = z - zone.z;
      const cosine = Math.cos(zone.rotationY);
      const sine = Math.sin(zone.rotationY);
      const localX = worldX * cosine - worldZ * sine;
      const localZ = worldX * sine + worldZ * cosine;
      const outsideX = Math.max(Math.abs(localX) - zone.halfX, 0);
      const outsideZ = Math.max(Math.abs(localZ) - zone.halfZ, 0);
      density = Math.min(density, ramp(Math.hypot(outsideX, outsideZ) - zone.margin, band));
      if (density <= 0) return 0;
    }
    return density;
  }

  /** True when a point is inside any zone, expanded by `margin` metres. */
  blocks(x: number, z: number, margin = 0): boolean {
    return this.densityAt(x, z, { base: { hard: margin, fade: 0 } }) <= 0;
  }

  count(): number {
    return this.circles.length + this.rects.length + this.treeClearances.length;
  }

  /** JSON-safe, for the debug surface. */
  describe(): { circles: number; rects: number; kinds: Record<string, number> } {
    const kinds: Record<string, number> = {};
    for (const circle of this.circles) kinds[circle.kind] = (kinds[circle.kind] ?? 0) + 1;
    for (const zone of this.rects) kinds[zone.kind] = (kinds[zone.kind] ?? 0) + 1;
    if (this.treeClearances.length > 0) kinds.treeClearance = this.treeClearances.length;
    return { circles: this.circles.length, rects: this.rects.length, kinds };
  }

  clear(): void {
    exclusionRevisions.set(this, ++nextExclusionRevision);
    this.circles = [];
    this.rects = [];
    this.treeClearances = [];
    this.index = null;
    this.rectIndex = null;
  }

  /** Circles that can possibly affect `(x, z)`, from the grid when the profile fits inside it. */
  private circleCandidates(x: number, z: number, profile: ExclusionProfile): CircleZone[] {
    const reach = profileReach(profile);
    if (reach > ZONE_INDEX_REACH) return this.circles;
    const bucket = this.zoneIndex().get(cellKey(Math.floor(x / ZONE_CELL), Math.floor(z / ZONE_CELL)));
    if (!bucket) return EMPTY_ZONES;
    return bucket.map((slot) => this.circles[slot]!);
  }

  /** Rectangles that can affect `(x, z)`, using the same bounded-reach grid as circles. */
  private rectCandidates(x: number, z: number, profile: ExclusionProfile): RectZone[] {
    const reach = profileReach(profile);
    if (reach > ZONE_INDEX_REACH) return this.rects;
    const bucket = this.rectZoneIndex().get(cellKey(Math.floor(x / ZONE_CELL), Math.floor(z / ZONE_CELL)));
    if (!bucket) return EMPTY_RECT_ZONES;
    return bucket.map((slot) => this.rects[slot]!);
  }

  private zoneIndex(): Map<number, number[]> {
    if (this.index) return this.index;
    const index = new Map<number, number[]>();
    for (const [slot, circle] of this.circles.entries()) {
      const reach = circle.radius + ZONE_INDEX_REACH;
      const minCol = Math.floor((circle.x - reach) / ZONE_CELL);
      const maxCol = Math.floor((circle.x + reach) / ZONE_CELL);
      const minRow = Math.floor((circle.z - reach) / ZONE_CELL);
      const maxRow = Math.floor((circle.z + reach) / ZONE_CELL);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const key = cellKey(col, row);
          const bucket = index.get(key);
          if (bucket) bucket.push(slot);
          else index.set(key, [slot]);
        }
      }
    }
    this.index = index;
    return index;
  }

  private rectZoneIndex(): Map<number, number[]> {
    if (this.rectIndex) return this.rectIndex;
    const index = new Map<number, number[]>();
    for (const [slot, zone] of this.rects.entries()) {
      const cosine = Math.abs(Math.cos(zone.rotationY));
      const sine = Math.abs(Math.sin(zone.rotationY));
      const extentX = zone.halfX * cosine + zone.halfZ * sine + zone.margin + ZONE_INDEX_REACH;
      const extentZ = zone.halfX * sine + zone.halfZ * cosine + zone.margin + ZONE_INDEX_REACH;
      const minCol = Math.floor((zone.x - extentX) / ZONE_CELL);
      const maxCol = Math.floor((zone.x + extentX) / ZONE_CELL);
      const minRow = Math.floor((zone.z - extentZ) / ZONE_CELL);
      const maxRow = Math.floor((zone.z + extentZ) / ZONE_CELL);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const key = cellKey(col, row);
          const bucket = index.get(key);
          if (bucket) bucket.push(slot);
          else index.set(key, [slot]);
        }
      }
    }
    this.rectIndex = index;
    return index;
  }
}

const EMPTY_ZONES: CircleZone[] = [];
const EMPTY_RECT_ZONES: RectZone[] = [];

/** Copy, deduplicate and remove interior points without changing the caller's authored array. */
function treeClearanceHull(points: readonly Vec3[]): [number, number][] {
  const sorted = points.map((point): [number, number] => [point[0], point[2]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, index, all) => index === 0 || point[0] !== all[index - 1]![0] || point[1] !== all[index - 1]![1]);
  if (sorted.length <= 2) return sorted;
  const cross = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
    (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  const half = (ordered: readonly [number, number][]): [number, number][] => {
    const hull: [number, number][] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function profileReach(profile: ExclusionProfile): number {
  let reach = Math.max(0, profile.base.hard + profile.base.fade);
  for (const band of Object.values(profile.byKind ?? {})) {
    if (band) reach = Math.max(reach, band.hard + band.fade);
  }
  return reach;
}

function cellKey(col: number, row: number): number {
  return ((col & 0xffff) << 16) | (row & 0xffff);
}

/** Existing coarse groups remain appropriate for inexpensive grass, pebbles and props. */
const BUCKET_TILE_METRES = 128;
/** Also the generation grid. Changing this rerolls world candidates and is not a render optimization. */
const SHADOW_TILE_METRES = 96;
const TILE_MIN_INSTANCES = 4000;

interface MeshInstanceBucket {
  kind: "mesh";
  assetId: string;
  castShadow: boolean;
  placements: ForestScatterPlacement[];
}

type ForestScatterPlacement = ScatterPlacement & { forestTree?: ForestTreeDescriptor };

interface GrassInstanceBucket {
  kind: "grass";
  assetId: "grass-sprite";
  castShadow: false;
  placements: GrassSpritePlacement[];
}

type InstanceBucket = MeshInstanceBucket | GrassInstanceBucket;

const GRASS_SPRITE_IDS = new Set([
  "grass_common_short",
  "grass_common_tall",
  "grass_wispy_short",
  "grass_wispy_tall",
]);

function isGrassSprite(assetId: string): boolean {
  return GRASS_SPRITE_IDS.has(assetId);
}

/** Small material bend for living mesh foliage. Grass sprites animate in their own material. */
function windStrengthForAsset(assetId: string): number {
  if (assetId.startsWith("corealm_oak_") || assetId.startsWith("corealm_pine_")) return 0.035;
  if (assetId.startsWith("corealm_fern_") || assetId.startsWith("corealm_shrub_")) return 0.075;
  if (assetId.startsWith("tree_dead_") || assetId.startsWith("mushroom_")) return 0;
  if (
    assetId.startsWith("rock_")
    || assetId.startsWith("pebble_")
    || assetId.startsWith("path_rock_")
    || assetId.startsWith("boulder_")
    || assetId.startsWith("cliff_")
  ) return 0;
  if (assetId.startsWith("tree_")) return 0.035;
  if (
    assetId.startsWith("fern_")
    || assetId.startsWith("plant_")
    || assetId.startsWith("flower_")
    || assetId.startsWith("vine_")
    || assetId.startsWith("bush_")
  ) return 0.075;
  return 0;
}

function tileIndex(x: number, z: number, metres: number): number {
  return cellKey(Math.floor(x / metres), Math.floor(z / metres));
}

/** Detailed foliage needs small render groups; generation tiles and saved identities stay fixed. */
export const FOLIAGE_RENDER_TILE_METRES = { trees: 24, understory: 12 } as const;

/** Partition existing placements without changing their transforms, order within a tile, or IDs. */
export function shardByTile<T extends { position: Vec3 }>(
  bucket: { castShadow: boolean; placements: T[] },
  tileMetres?: number,
): { tile: number; placements: T[] }[] {
  const metres = tileMetres ?? (bucket.castShadow
    ? SHADOW_TILE_METRES
    : bucket.placements.length >= TILE_MIN_INSTANCES ? BUCKET_TILE_METRES : 0);
  if (metres <= 0) return [{ tile: 0, placements: bucket.placements }];
  const shards = new Map<number, T[]>();
  for (const placement of bucket.placements) {
    const tile = tileIndex(placement.position[0], placement.position[2], metres);
    const shard = shards.get(tile);
    if (shard) shard.push(placement);
    else shards.set(tile, [placement]);
  }
  return [...shards].map(([tile, placements]) => ({ tile, placements }));
}

/** 0 at or inside `hard`, 1 at `hard + fade`, linear between. A zero `fade` is a step. */
function ramp(distance: number, band: ExclusionBand): number {
  if (distance <= band.hard) return 0;
  if (band.fade <= 0) return 1;
  return Math.min(1, (distance - band.hard) / band.fade);
}

/**
 * The registry the root writes settlement and cluster footprints into. `scatterRegion` uses it
 * unless a spec supplies its own, so the wiring is one import and a few `addCircle` calls.
 */
export const worldExclusions = new ExclusionZones();

/** The accepted dry island is about 1.95 times the authored gameplay area. */
const FULL_ISLAND_FIELD_SCALE = 1.95;

/**
 * Generation tile size. Candidate generation starts inside these tiles, before assets or meshes
 * are created. It matches the shadow footprint already used for scatter mesh culling.
 */
export const SCATTER_STREAM_TILE_METRES = SHADOW_TILE_METRES;

export interface ScatterTile {
  /** Stable coordinate id. It is an authoring input to the tile seed. */
  id: string;
  col: number;
  row: number;
  bounds: Rect;
}

export interface ScatterTileLoadOptions {
  priority?: AssetPriority;
  /** Spawn-visible assets use the registry's primary retry callbacks. */
  primary?: boolean;
  /** Semantic tile owner for travel/background request reprioritization. */
  regionId?: RegionId;
  /** Cooperative browser scheduler used between authored layers; it never participates in seeds. */
  yieldToMain?: () => Promise<void>;
  /** Register a resource only after all primitive instances exist and can be suppressed together. */
  onTree?: (descriptor: ForestTreeDescriptor, setVisible: (visible: boolean) => void) => void;
}

function scatterTileFromCell(col: number, row: number): ScatterTile {
  const minX = col * SCATTER_STREAM_TILE_METRES;
  const minZ = row * SCATTER_STREAM_TILE_METRES;
  return {
    id: `${col}:${row}`,
    col,
    row,
    bounds: {
      minX,
      maxX: minX + SCATTER_STREAM_TILE_METRES,
      minZ,
      maxZ: minZ + SCATTER_STREAM_TILE_METRES,
    },
  };
}

/** The canonical generation tile containing a world position. */
export function scatterTileAt(x: number, z: number): ScatterTile {
  return scatterTileFromCell(
    Math.floor(x / SCATTER_STREAM_TILE_METRES),
    Math.floor(z / SCATTER_STREAM_TILE_METRES),
  );
}

/** Canonical row-major tile list for a non-empty world rectangle. */
export function scatterTilesForBounds(bounds: Rect): ScatterTile[] {
  if (bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) return [];
  const minCol = Math.floor(bounds.minX / SCATTER_STREAM_TILE_METRES);
  const maxCol = Math.ceil(bounds.maxX / SCATTER_STREAM_TILE_METRES) - 1;
  const minRow = Math.floor(bounds.minZ / SCATTER_STREAM_TILE_METRES);
  const maxRow = Math.ceil(bounds.maxZ / SCATTER_STREAM_TILE_METRES) - 1;
  const tiles: ScatterTile[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) tiles.push(scatterTileFromCell(col, row));
  }
  return tiles;
}

// ------------------------------------------------------------------ specs

/** Where a layer's candidate points come from. A layer may use more than one. */
export type ScatterSource = "field" | "road" | "shore";

export interface ScatterSpeciesSpec {
  assetId: string;
  /** Relative pick weight inside the layer. Defaults to 1. */
  weight?: number;
  /** Overrides the layer scale band. Multiplier on the GLB's native size. */
  scale?: [number, number];
  /** Overrides the layer tilt: 0 stands plumb, 1 aligns fully with the ground normal. */
  tilt?: number;
  /** Overrides the layer sink, in metres. */
  sink?: number;
  /** Restricts the species to some of the layer's sources. Reeds are `["shore"]`. */
  sources?: ScatterSource[];
}

/**
 * Two-level placement. Centres are Poisson-sampled at `spacing` and tested against terrain, mask
 * and settlement rules; members are Poisson-sampled inside a disc of radius drawn from `radius`.
 */
export interface ScatterClusterSpec {
  /** Minimum metres between cluster centres. Honoured exactly — no auto-widening. */
  spacing: number;
  /** Cluster radius band, in metres. */
  radius: [number, number];
  /** Minimum metres between members inside a cluster. */
  memberSpacing: number;
  /** Base probability a candidate centre becomes a cluster, before the terrain rules multiply it. */
  accept: number;
  /** 0..1. How hard members thin toward the rim, as `1 - falloff * (r/R)^2`. Defaults to 0.75. */
  falloff?: number;
  /** 0..1 share of members that use the cluster's dominant species. Defaults to 0.7. */
  dominance?: number;
}

/** Dressing that follows the CURVED road centrelines, not the authored endpoints. */
export interface ScatterRoadSpec {
  /** Lateral offset band from the centreline, in metres. Both sides. */
  band: [number, number];
  /** Instances per linear metre of road, summed over both sides. */
  perMetre: number;
}

/** Dressing that follows the water mesh's contour. */
export interface ScatterShoreSpec {
  /** Offset band from the waterline, in metres. Negative reaches into the water. */
  band: [number, number];
  /** Instances per metre of shoreline. */
  perMetre: number;
}

export interface ScatterTerrainSpec {
  /** Reject placements steeper than this (rise over run). 0.7 is about 35 degrees. */
  slopeMax?: number;
  /**
   * Acceptance multiplier from slope: `flat` at or below `low`, `steep` at or above `high`, lerped
   * between. Scree wants x4 on the risers and x0.15 on the terrace tops; grass wants the reverse.
   */
  slopeBias?: { low: number; high: number; flat: number; steep: number };
  /** Altitude band as a fraction of the region's terrain amplitude above its base height. */
  altitude?: [number, number];
  /** Metres of soft edge on the altitude band. Defaults to 4. */
  altitudeFade?: number;
  /** Acceptance multiplier within `reach` metres of a waterline. */
  moisture?: { reach: number; boost: number };
}

export interface ScatterLayerSpec {
  id: string;
  /** The species pool, with per-species weight, scale, tilt and source restrictions. */
  species?: ScatterSpeciesSpec[];
  /** Shorthand for a flat, equally weighted pool. */
  assetIds?: string[];
  /** Last resort: every manifest asset carrying ALL of `tags`, capped by `maxVariants`. */
  tags?: string[];
  /**
   * Cap on distinct assets from a `tags` lookup only; an explicit `species` list is taken whole.
   * A source GLB costs one `InstancedMesh` per primitive and every tree in this kit has two, so a
   * 2-variant shadow-casting tree layer is 2 x 2 x 2 = 8 draw calls while a 6-variant pebble layer
   * is 6. Instance count does not affect it at all.
   */
  maxVariants?: number;
  /**
   * Minimum spacing between lone props, in metres, for a layer with no `cluster`. Honoured exactly:
   * the old sampler silently widened it to `sqrt(area * 0.66 / maxCount)`, which on every region in
   * the world exceeded every authored value.
   */
  spacing?: number;
  /**
   * Cap on instances from the `field` generator. Stops accepting new CLUSTERS, so a cluster is
   * never cut in half; `road` and `shore` are budgeted by their own per-metre rates on top.
   */
  maxCount: number;
  scale: [number, number];
  /**
   * Exponent on the uniform draw inside the scale band. Above 1 most props are small and a few are
   * large, which is what gives a stand a size hierarchy instead of one uniform band. Defaults 2.2.
   */
  sizeBias?: number;
  /** 0..1 lean into the ground normal. 1 for pebbles and flat plants, 0.1 for trees. */
  tilt?: number;
  /** Metres to sink into the ground so rocks and stumps bed in. */
  sink?: number;
  /** Only large silhouettes cast: shadow casters cost a second draw call each. */
  castShadow?: boolean;
  /** 50% half-turn facing variation. Kept as the authored `mirror` switch for spec compatibility. */
  mirror?: boolean;
  /** Extra metres added to every exclusion band for this layer. */
  clearance?: number;
  exclusion?: ExclusionProfile;
  terrain?: ScatterTerrainSpec;
  cluster?: ScatterClusterSpec;
  /** Low-frequency fbm that carves clearings by rejecting whole clusters. */
  mask?: { strength: number; featureSize: number };
  /** Optional metres past the semantic rect. Omit to sample every dry point on the organic island. */
  bleed?: number;
  road?: ScatterRoadSpec;
  shore?: ScatterShoreSpec;
  /** Optional absolute altitude band, in metres. */
  heightRange?: [number, number];
}

export interface RegionScatterSpec {
  regionId: RegionId;
  layers: ScatterLayerSpec[];
  /** Defaults to the region's rect from the scene. */
  rect?: Rect;
  exclusions?: ExclusionZones;
}

export interface ScatterResult {
  regionId: RegionId;
  placed: number;
  rejected: number;
  /** Accepted cluster centres, world-wide for this region. A copse is one; a tuft of grass is one. */
  clusters: number;
  instancedMeshes: number;
  /**
   * Draw calls added, counting the shadow pass for casters, WITH NOTHING CULLED.
   *
   * Same warning as `estimatedTriangles` below and it is easy to misread the other way: this is an
   * upper bound over the whole region, not a per-frame figure. Shipped, the three regions report
   * 127 / 167 / 130 = 424, while the frustum sweep in runs/corealm/audit/dcb-sweep.ts puts the
   * worst single pose at 166 and the mean at 103 — a quarter of the world-wide number. Do not
   * subtract this from `renderer.info.render.calls`; they are different quantities.
   */
  estimatedDrawCalls: number;
  /**
   * Triangles this region submits when it is streamed in AND nothing is frustum-culled, counting
   * the shadow pass. Since the buckets are tiled (`BUCKET_TILE_METRES`, `SHADOW_TILE_METRES`) this
   * is an upper bound rather than the per-frame figure: what the GPU actually sees is this number
   * times the share of tiles inside the camera frustum, and a much smaller share again for the
   * shadow pass. Measured across the 18 poses, the worst pose sees 58% of this and the mean 41%.
   */
  estimatedTriangles: number;
  /** Distinct spatial tiles the placements were cut into. `estimatedDrawCalls` scales with this. */
  tiles: number;
  byLayer: Record<string, number>;
  bySource: Record<string, number>;
  /** Accepted instance counts, including rare tree species, independent of camera culling. */
  byAsset: Record<string, number>;
  missingAssets: string[];
}

function createScatterResult(regionId: RegionId, spec?: RegionScatterSpec): ScatterResult {
  return {
    regionId,
    placed: 0,
    rejected: 0,
    clusters: 0,
    instancedMeshes: 0,
    estimatedDrawCalls: 0,
    estimatedTriangles: 0,
    tiles: 0,
    byLayer: Object.fromEntries((spec?.layers ?? []).map((layer) => [layer.id, 0])),
    bySource: {},
    byAsset: {},
    missingAssets: [],
  };
}

function addScatterResult(target: ScatterResult, source: ScatterResult): void {
  target.placed += source.placed;
  target.rejected += source.rejected;
  target.clusters += source.clusters;
  target.instancedMeshes += source.instancedMeshes;
  target.estimatedDrawCalls += source.estimatedDrawCalls;
  target.estimatedTriangles += source.estimatedTriangles;
  target.tiles += source.tiles;
  for (const [layerId, count] of Object.entries(source.byLayer)) {
    target.byLayer[layerId] = (target.byLayer[layerId] ?? 0) + count;
  }
  for (const [sourceId, count] of Object.entries(source.bySource)) {
    target.bySource[sourceId] = (target.bySource[sourceId] ?? 0) + count;
  }
  for (const [assetId, count] of Object.entries(source.byAsset)) {
    target.byAsset[assetId] = (target.byAsset[assetId] ?? 0) + count;
  }
  for (const missing of source.missingAssets) {
    if (!target.missingAssets.includes(missing)) target.missingAssets.push(missing);
  }
}

/**
 * Folds any set of resident tile results into the stable debug shape. Authored layers stay present
 * with a zero count before their first tile becomes resident.
 */
export function mergeScatterResults(
  results: readonly ScatterResult[],
  specs: Partial<Record<RegionId, RegionScatterSpec>> = DEFAULT_SCATTER,
): ScatterResult[] {
  const merged = new Map<RegionId, ScatterResult>();
  for (const spec of Object.values(specs)) {
    if (spec) merged.set(spec.regionId, createScatterResult(spec.regionId, spec));
  }
  for (const result of results) {
    const target = merged.get(result.regionId) ?? createScatterResult(result.regionId, specs[result.regionId]);
    addScatterResult(target, result);
    merged.set(result.regionId, target);
  }
  return [...merged.values()];
}

// ------------------------------------------------------------- sampling

/**
 * Bridson Poisson-disc sampling over a rect, seeded, at EXACTLY `minDistance`.
 *
 * The old version widened the radius to `sqrt(area * 0.66 / maxCount)` whenever that beat the
 * authored spacing, which on a 70,000-132,000 m2 region it always did. That is what made every
 * authored spacing inert and every layer an even sprinkle. Density is now controlled by capping
 * clusters, not by pushing points apart.
 *
 * `hardCap` only exists so a mis-authored spacing cannot hang the boot; it is not a density dial.
 */
type ScatterPoint = [number, number];

function* poissonDiscSteps(
  rect: Rect,
  minDistance: number,
  rng: Rng,
  hardCap = 60000,
): Generator<void, ScatterPoint[], void> {
  const width = rect.maxX - rect.minX;
  const depth = rect.maxZ - rect.minZ;
  if (width <= 0 || depth <= 0 || minDistance <= 0) return [];

  const radius = minDistance;
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(depth / cell));
  if (cols * rows > 4_000_000) return [];
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: ScatterPoint[] = [];
  const active: number[] = [];

  const insert = (x: number, z: number): void => {
    const index = points.length;
    points.push([x, z]);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((x - rect.minX) / cell)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((z - rect.minZ) / cell)));
    grid[row * cols + col] = index;
    active.push(index);
  };

  const fits = (x: number, z: number): boolean => {
    if (x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ) return false;
    const col = Math.floor((x - rect.minX) / cell);
    const row = Math.floor((z - rect.minZ) / cell);
    for (let r = Math.max(0, row - 2); r <= Math.min(rows - 1, row + 2); r += 1) {
      for (let c = Math.max(0, col - 2); c <= Math.min(cols - 1, col + 2); c += 1) {
        const index = grid[r * cols + c]!;
        if (index < 0) continue;
        const other = points[index]!;
        const dx = other[0] - x;
        const dz = other[1] - z;
        if (dx * dx + dz * dz < radius * radius) return false;
      }
    }
    return true;
  };

  insert(rect.minX + rng.next() * width, rect.minZ + rng.next() * depth);

  const attempts = 18;
  let iterations = 0;
  while (active.length > 0 && points.length < hardCap) {
    const pick = Math.floor(rng.next() * active.length);
    const seedIndex = active[pick]!;
    const seed = points[seedIndex]!;
    let placed = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const angle = rng.next() * Math.PI * 2;
      const distance = radius * (1 + rng.next());
      const x = seed[0] + Math.cos(angle) * distance;
      const z = seed[1] + Math.sin(angle) * distance;
      if (!fits(x, z)) continue;
      insert(x, z);
      placed = true;
      break;
    }

    if (!placed) {
      active[pick] = active[active.length - 1]!;
      active.pop();
    }
    iterations += 1;
    if (iterations % 64 === 0) yield;
  }
  return points;
}

function poissonDisc(rect: Rect, minDistance: number, rng: Rng, hardCap = 60000): ScatterPoint[] {
  const steps = poissonDiscSteps(rect, minDistance, rng, hardCap);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

async function poissonDiscYielding(
  rect: Rect,
  minDistance: number,
  rng: Rng,
  hardCap: number,
  yieldToMain?: () => Promise<void>,
): Promise<ScatterPoint[]> {
  if (!yieldToMain) return poissonDisc(rect, minDistance, rng, hardCap);
  const steps = poissonDiscSteps(rect, minDistance, rng, hardCap);
  let result = steps.next();
  while (!result.done) {
    await yieldToMain();
    result = steps.next();
  }
  return result.value;
}

/** Members of one cluster: Poisson over the bounding square, kept inside the disc. */
function poissonDisc2(centreX: number, centreZ: number, radius: number, minDistance: number, rng: Rng): [number, number][] {
  const rect: Rect = {
    minX: centreX - radius, maxX: centreX + radius,
    minZ: centreZ - radius, maxZ: centreZ + radius,
  };
  const points = poissonDisc(rect, minDistance, rng, 4000);
  return points.filter(([x, z]) => Math.hypot(x - centreX, z - centreZ) <= radius);
}

async function poissonDisc2Yielding(
  centreX: number,
  centreZ: number,
  radius: number,
  minDistance: number,
  rng: Rng,
  yieldToMain?: () => Promise<void>,
): Promise<ScatterPoint[]> {
  const rect: Rect = {
    minX: centreX - radius, maxX: centreX + radius,
    minZ: centreZ - radius, maxZ: centreZ + radius,
  };
  const points = await poissonDiscYielding(rect, minDistance, rng, 4000, yieldToMain);
  return points.filter(([x, z]) => Math.hypot(x - centreX, z - centreZ) <= radius);
}

/** Integer hash. Used to reorder Poisson output so truncating it stays spatially uniform. */
function hash32(seed: number, value: number): number {
  let h = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Deterministic reorder.
 *
 * Bridson grows outward from its seed point, so taking the first N of its output leaves a blob
 * where the algorithm started and bare ground everywhere else. Sorting on a positional-independent
 * hash first makes any prefix a uniform sample of the whole rect.
 */
function shuffleByHash<T>(items: readonly T[], seed: number): T[] {
  return items
    .map((item, index) => ({ item, key: hash32(seed, index) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

/**
 * Three-octave fbm in 0..1.
 *
 * The old mask was single-octave value noise at a 85-130 m feature size over a 330-400 m region:
 * three or four lattice periods across the whole world, i.e. three giant smooth gradients with no
 * grove-scale structure at all. Three octaves at a 60-90 m base gives the clearings an edge.
 */
function createFbm(seed: number): (x: number, z: number) => number {
  const octave1 = createValueNoise(seed);
  const octave2 = createValueNoise((seed ^ 0x85ebca6b) >>> 0);
  const octave3 = createValueNoise((seed ^ 0xc2b2ae35) >>> 0);
  return (x: number, z: number): number => {
    const value = octave1(x, z) * 0.55 + octave2(x * 2.03, z * 2.03) * 0.3 + octave3(x * 4.11, z * 4.11) * 0.15;
    return clamp01(value * 0.5 + 0.5);
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// --------------------------------------------------------- world features

/**
 * A built fishing pond as scatter needs to see it. The renderer owns the shoreline contour;
 * scatter only turns its evenly spaced contour points back into radial samples for cheap queries.
 */
interface WaterBody {
  x: number;
  z: number;
  level: number;
  maxRadius: number;
  perimeter: number;
  /** Shoreline radius per renderer-provided contour point, starting at +x. */
  shoreline: number[];
  /** Closed renderer-provided contour. It is the authority for tile-local shore stations. */
  contour: [number, number][];
}

const waterBodyCache = new WeakMap<WorldScene, WaterBody[]>();

function waterBodies(scene: WorldScene): WaterBody[] {
  const cached = waterBodyCache.get(scene);
  if (cached) return cached;
  const bodies = scene.getWaterBodies()
    .filter((body) => body.closed && body.contour.length >= 3)
    .map((body) => {
      const [x, z] = body.centre;
      const shoreline = body.contour.map((point) => Math.hypot(point[0] - x, point[1] - z));
      let perimeter = 0;
      for (let index = 0; index < body.contour.length; index += 1) {
        const current = body.contour[index]!;
        const next = body.contour[(index + 1) % body.contour.length]!;
        perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
      }
      return {
        x,
        z,
        level: body.level,
        maxRadius: Math.max(...shoreline),
        perimeter,
        shoreline,
        contour: body.contour.map((point): [number, number] => [point[0], point[1]]),
      };
    });
  waterBodyCache.set(scene, bodies);
  return bodies;
}

/** Shoreline radius toward a point, linearly interpolated between azimuth samples. */
function shorelineToward(body: WaterBody, x: number, z: number): number {
  const samples = body.shoreline.length;
  if (samples === 0) return 0;
  const angle = Math.atan2(z - body.z, x - body.x);
  const turns = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
  const position = turns * samples;
  const low = Math.floor(position) % samples;
  const high = (low + 1) % samples;
  const t = position - Math.floor(position);
  return body.shoreline[low]! + (body.shoreline[high]! - body.shoreline[low]!) * t;
}

/** Metres beyond the measured waterline that ordinary layers must stay. */
const WATER_MARGIN_METRES = 1.2;

/**
 * A settlement's own geometry, as one zone per authored thing rather than one disc round the lot.
 *
 * The root registers every settlement as a single 46 m circle. A boolean test on that circle is
 * what produced the bare disc in every settlement screenshot, and an enclosing circle measured off
 * the content is barely better: Coldbrace's wall runs reach ~40 m from its centre, so one disc that
 * clears them clears the entire approach as well. Registering the buildings, the wall runs, the
 * paving and the props separately lets grass grow in the yards, along the foot of the wall and
 * right up to the gate, and still keeps it out of a cottage.
 *
 * Everything here is read from `content/regions.ts`, so a settlement that gains a wall or a paved
 * square in a later pass pushes the planting back on its own.
 */
let authoredZoneCache: ExclusionZones | null = null;

function authoredZones(): ExclusionZones {
  if (authoredZoneCache) return authoredZoneCache;
  const zones = new ExclusionZones();
  for (const region of REGIONS) {
    const settlement = region.settlement;
    if (!settlement) continue;

    for (const building of settlement.buildings) {
      // Use the authored collision footprint in its own rotated frame. The old circumscribed circle
      // was radius hypot(width, depth)/2 + 1 m, which kept cover hard-clear 3.4 m past the narrow
      // side of a 6 x 4 m cottage and left the lanes between neighbouring houses bald. Cover wants
      // the wall edge, not the roof's circumscribed/eave envelope.
      const [width, depth] = building.footprint;
      zones.addOrientedRect(
        building.position[0], building.position[1],
        width, depth, building.rotationY, 0, "building", building.id,
      );
    }
    for (const wall of settlement.walls ?? []) {
      const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
      const steps = Math.max(1, Math.ceil(length / 2.5));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        zones.addCircle(
          wall.from[0] + (wall.to[0] - wall.from[0]) * t,
          wall.from[1] + (wall.to[1] - wall.from[1]) * t,
          1.8, "settlement", wall.id,
        );
      }
    }
    for (const paving of settlement.paving ?? []) {
      zones.addRect(paving.rect, 0.5, "settlement", paving.id);
    }
    for (const station of settlement.stations) zones.addCircle(station.position[0], station.position[1], 1.8, "custom", station.id);
    for (const shop of settlement.shops) zones.addCircle(shop.position[0], shop.position[1], 2.2, "custom", shop.id);
    zones.addCircle(settlement.bank.position[0], settlement.bank.position[1], 2.2, "custom", settlement.bank.id);
    for (const prop of settlement.props ?? []) zones.addCircle(prop.position[0], prop.position[1], 1.4, "custom", prop.id);
    for (const npc of settlement.npcs) zones.addCircle(npc.position[0], npc.position[1], 1.2, "custom", npc.id);
  }
  authoredZoneCache = zones;
  return zones;
}

/** Region terrain envelope, for the altitude rules. */
function regionAltitude(regionId: RegionId): { base: number; amplitude: number } {
  const region = REGIONS.find((entry) => entry.id === regionId);
  return { base: region?.baseHeight ?? 0, amplitude: Math.max(1, region?.terrainAmplitude ?? 1) };
}

/**
 * Road centrelines resampled to 1 m. Each biome's organic weight decides which accents survive.
 *
 * These are `scene.getRoadPolylines()` -- the resolved curves after the meander -- not the authored
 * endpoints. Road dressing, exclusion corridors, and the rendered map all consume this same line,
 * so a broad bend never leaves foliage sitting on the worn track.
 */
type RoadStation = { x: number; z: number; nx: number; nz: number };

const roadStationCache = new WeakMap<WorldScene, RoadStation[]>();

function roadStations(scene: WorldScene): RoadStation[] {
  const cached = roadStationCache.get(scene);
  if (cached) return cached;
  const stations: { x: number; z: number; nx: number; nz: number }[] = [];
  for (const line of scene.getRoadPolylines()) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dz);
      if (length < 1e-3) continue;
      const nx = -dz / length;
      const nz = dx / length;
      const steps = Math.max(1, Math.round(length));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const x = a[0] + dx * t;
        const z = a[2] + dz * t;
        stations.push({ x, z, nx, nz });
      }
    }
  }
  roadStationCache.set(scene, stations);
  return stations;
}

// -------------------------------------------------------------- placement

/** Keep the selected entry so duplicate asset ids retain their own scale/tilt/sink variant. */
interface Candidate { x: number; z: number; source: ScatterSource; species: ResolvedSpecies }

interface LayerContext {
  scene: WorldScene;
  regionId: RegionId;
  rect: Rect;
  tile: ScatterTile;
  exclusions: ExclusionZones;
  waters: WaterBody[];
  authored: ExclusionZones;
  altitude: { base: number; amplitude: number };
  roads: { x: number; z: number; nx: number; nz: number }[];
  seed: number;
}

interface ResolvedSpecies {
  assetId: string;
  sourceAssetId: string;
  sizeRatio: number;
  treeSpecies: TreeSpeciesId | null;
  weight: number;
  scale: [number, number];
  tilt: number;
  sink: number;
  sources: ScatterSource[] | null;
}

/** Display aliases retain the recipe's species weights and random-number sequence. */
const COREALM_SCATTER_ALIASES: Readonly<Record<string, string>> = {
  tree_common_1: "corealm_oak_1", tree_common_2: "corealm_oak_2", tree_common_3: "corealm_oak_3",
  tree_common_4: "corealm_oak_3", tree_common_5: "corealm_oak_1",
  tree_pine_1: "corealm_pine_3", tree_pine_2: "corealm_pine_2", tree_pine_3: "corealm_pine_1",
  tree_pine_4: "corealm_pine_1", tree_pine_5: "corealm_pine_2",
  tree_twisted_1: "corealm_oak_1", tree_twisted_2: "corealm_oak_2",
  tree_twisted_3: "corealm_pine_3", tree_twisted_4: "corealm_pine_1", tree_twisted_5: "corealm_oak_3",
  fern_1: "corealm_fern_1", fern_2: "corealm_fern_2",
  plant_leafy_small: "corealm_shrub_2", plant_leafy_large: "corealm_shrub_1", bush_common: "corealm_shrub_1",
  rock_medium_1: "corealm_rock_strata_1", rock_medium_2: "corealm_rock_strata_2", rock_medium_3: "corealm_rock_strata_3",
};

const TREE_TRUNK_RADII: Readonly<Record<string, number>> = Object.fromEntries(
  TREE_SPECIES.flatMap(species => treeAssetIds(species).map(id => [id, species.trunkRadius])),
);

/**
 * Resolves the species pool a layer will actually use.
 *
 * Unknown explicit ids are reported rather than silently dropped. Every id in `DEFAULT_SCATTER` is
 * hand-picked off the measured triangle and native-height tables, so a typo that quietly degrades a
 * layer to two variants is exactly the failure that is hardest to see in a screenshot.
 */
function resolveSpecies(
  assets: AssetRegistry,
  layer: ScatterLayerSpec,
): { species: ResolvedSpecies[]; unknown: string[] } {
  const declared: ScatterSpeciesSpec[] = layer.species
    ? layer.species
    : layer.assetIds
      ? layer.assetIds.map((assetId) => ({ assetId }))
      : (layer.tags && layer.tags.length > 0
        ? assets.byTags(...layer.tags).slice(0, layer.maxVariants ?? 4).map((entry) => ({ assetId: entry.id }))
        : []);

  const species: ResolvedSpecies[] = [];
  const unknown: string[] = [];
  for (const entry of declared) {
    const source = assets.entry(entry.assetId);
    if (!source) { unknown.push(entry.assetId); continue; }
    const assetId = COREALM_SCATTER_ALIASES[entry.assetId] ?? entry.assetId;
    const replacement = assets.entry(assetId);
    if (!replacement) { unknown.push(assetId); continue; }
    const treeSpecies = treeSpeciesForAsset(assetId)?.id ?? null;
    let sizeRatio = 1;
    if (assetId !== entry.assetId) {
      const originalWidth = Math.max(source.size.x, source.size.z);
      const replacementWidth = Math.max(replacement.size.x, replacement.size.z);
      sizeRatio = treeSpecies === "oak"
        ? Math.min(source.size.y / replacement.size.y, originalWidth * 1.35 / replacementWidth)
        : treeSpecies === "pine" ? source.size.y / replacement.size.y
          : Math.max(source.size.x, source.size.y, source.size.z)
            / Math.max(replacement.size.x, replacement.size.y, replacement.size.z);
      if (!Number.isFinite(sizeRatio) || sizeRatio <= 0) throw new Error(`Invalid scatter dimensions for ${entry.assetId} -> ${assetId}.`);
    }
    species.push({
      assetId,
      sourceAssetId: entry.assetId,
      sizeRatio,
      treeSpecies,
      weight: entry.weight ?? 1,
      scale: entry.scale ?? layer.scale,
      tilt: entry.tilt ?? layer.tilt ?? 0.4,
      sink: entry.sink ?? layer.sink ?? 0,
      sources: entry.sources ?? null,
    });
  }
  return { species, unknown };
}

function pickSpecies(pool: ResolvedSpecies[], source: ScatterSource, rng: Rng): ResolvedSpecies | null {
  let total = 0;
  for (const entry of pool) {
    if (entry.sources && !entry.sources.includes(source)) continue;
    total += entry.weight;
  }
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const entry of pool) {
    if (entry.sources && !entry.sources.includes(source)) continue;
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return null;
}

/** Stable per-region, per-layer seed. Order-independent so editing one layer never moves another. */
function layerSeed(seed: number, regionId: RegionId, layerId: string): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  for (const text of [regionId, layerId]) {
    for (let i = 0; i < text.length; i += 1) {
      hash = (Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0);
    }
  }
  return hash >>> 0;
}

/** Stable world + recipe + layer + generation-tile stream. */
export function deriveScatterTileSeed(
  worldSeed: number,
  regionId: RegionId,
  layerId: string,
  tileId: string,
): number {
  let hash = layerSeed(worldSeed, regionId, layerId);
  for (let index = 0; index < tileId.length; index += 1) {
    hash = Math.imul(hash ^ tileId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash32(hash, tileId.length);
}

/**
 * Acceptance multipliers that depend only on where a point is.
 *
 * Returns 0 for a hard reject. Everything expensive lives here, so it is called on cluster CENTRES
 * and then only the cheap half is repeated per member.
 */
function siteFactor(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  x: number,
  z: number,
  source: ScatterSource,
  applyBiomeAndPreferences: boolean,
): number {
  const surface = ctx.scene.scatterSurfaceAt(x, z);
  if (!surface || surface.density <= 0) return 0;

  const profile = layerProfile(layer, source);
  let factor = ctx.exclusions.densityAt(x, z, profile) * surface.density;
  if (factor <= 0) return 0;

  const authoredBase = profile.authored ?? profile.base;
  factor *= ctx.authored.densityAt(x, z, {
    base: authoredBase,
    byKind: profile.authoredBuilding
      ? { building: profile.authoredBuilding }
      : undefined,
  });
  if (factor <= 0) return 0;

  // Water is a hard reject except for a shore layer that deliberately wades in. Round 1 excluded
  // fishing clusters at `radius + 3` while the water disc was built at `radius + 14`, so an 11 m
  // annulus of grass and pebbles was drawn under every pond.
  const waterMargin = source === "shore"
    ? Math.min(layer.shore?.band[0] ?? 0, WATER_MARGIN_METRES)
    : WATER_MARGIN_METRES;
  for (const body of ctx.waters) {
    const distance = Math.hypot(x - body.x, z - body.z);
    if (distance > body.maxRadius + 40) continue;
    if (distance < shorelineToward(body, x, z) + waterMargin) return 0;
  }

  // A clustered layer chooses its biome once, at the centre. Members still answer to the dry
  // surface, shore fade, water, exclusions and slope, but multiplying the biome weight here again
  // would turn a 50/50 ecotone into 25% density from each side.
  if (applyBiomeAndPreferences) {
    factor *= ctx.scene.regionWeightAt(ctx.regionId, x, z);
    if (factor <= 0) return 0;
  }

  const rules = layer.terrain;
  const slope = surface.slope;
  if (slope > (rules?.slopeMax ?? 0.85)) return 0;
  // Everything below is a PREFERENCE rather than a rule, and preferences belong to the cluster as a
  // whole. Applying them again per member would square them: a scree cluster biased x0.15 on flat
  // ground would then lose 85% of the members it did place there, and the cluster would dissolve
  // instead of moving.
  if (!applyBiomeAndPreferences) return factor;
  if (rules?.slopeBias) {
    const { low, high, flat, steep } = rules.slopeBias;
    const t = high > low ? clamp01((slope - low) / (high - low)) : slope > low ? 1 : 0;
    factor *= flat + (steep - flat) * t;
  }

  const height = surface.height;
  if (layer.heightRange && (height < layer.heightRange[0] || height > layer.heightRange[1])) return 0;
  if (rules?.altitude) {
    const fade = rules.altitudeFade ?? 4;
    const lower = ctx.altitude.base + rules.altitude[0] * ctx.altitude.amplitude;
    const upper = ctx.altitude.base + rules.altitude[1] * ctx.altitude.amplitude;
    factor *= smoothstep01((height - lower) / fade) * smoothstep01((upper - height) / fade);
  }

  if (rules?.moisture) {
    let nearest = Infinity;
    for (const body of ctx.waters) {
      const distance = Math.hypot(x - body.x, z - body.z) - shorelineToward(body, x, z);
      nearest = Math.min(nearest, distance);
    }
    if (nearest < rules.moisture.reach) {
      factor *= 1 + (rules.moisture.boost - 1) * clamp01(1 - nearest / rules.moisture.reach);
    }
  }

  return factor;
}

/** The layer's exclusion profile, widened by `clearance` and opened up along its own source. */
function layerProfile(layer: ScatterLayerSpec, source: ScatterSource): ExclusionProfile {
  const base = layer.exclusion ?? SHRUB_EXCLUSION;
  const clearance = layer.clearance ?? 0;
  const widen = (band: ExclusionBand): ExclusionBand => ({ hard: band.hard + clearance, fade: band.fade });
  const byKind: Partial<Record<ExclusionKind, ExclusionBand>> = {};
  for (const [kind, band] of Object.entries(base.byKind ?? {})) {
    if (band) byKind[kind as ExclusionKind] = widen(band);
  }
  // Road candidates use the same resolved curves as the exclusion corridors. Keep their
  // clearance checks so jitter and intersecting roads cannot plant the worn carriageway.
  // `authored` has to be carried through. Dropping it here made every `authored` band in every
  // profile dead code — `siteFactor` reads `profile.authored ?? profile.base` and always got the
  // base — so a wall or a paving kerb was answered with the open-country fade instead of the
  // tighter one written for it.
  return {
    base: widen(base.base),
    byKind,
    authored: base.authored ? widen(base.authored) : undefined,
    authoredBuilding: base.authoredBuilding ? widen(base.authoredBuilding) : undefined,
  };
}

function intersectRect(left: Rect, right: Rect): Rect | null {
  const intersection = {
    minX: Math.max(left.minX, right.minX),
    maxX: Math.min(left.maxX, right.maxX),
    minZ: Math.max(left.minZ, right.minZ),
    maxZ: Math.min(left.maxZ, right.maxZ),
  };
  return intersection.maxX > intersection.minX && intersection.maxZ > intersection.minZ
    ? intersection
    : null;
}

function rectArea(rect: Rect): number {
  return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxZ - rect.minZ);
}

function layerFieldBounds(ctx: LayerContext, layer: ScatterLayerSpec): Rect {
  const islandBounds = ctx.scene.getScatterBounds(Infinity);
  if (layer.bleed === undefined) return islandBounds;
  return {
    minX: Math.max(islandBounds.minX, ctx.rect.minX - layer.bleed),
    maxX: Math.min(islandBounds.maxX, ctx.rect.maxX + layer.bleed),
    minZ: Math.max(islandBounds.minZ, ctx.rect.minZ - layer.bleed),
    maxZ: Math.min(islandBounds.maxZ, ctx.rect.maxZ + layer.bleed),
  };
}

interface TileFieldWeights {
  total: number;
  byTile: Map<string, number>;
}

const tileFieldWeightCache = new WeakMap<WorldScene, Map<string, TileFieldWeights>>();

function fieldWeights(ctx: LayerContext, bounds: Rect): TileFieldWeights {
  let sceneCache = tileFieldWeightCache.get(ctx.scene);
  if (!sceneCache) {
    sceneCache = new Map();
    tileFieldWeightCache.set(ctx.scene, sceneCache);
  }
  const key = `${ctx.regionId}:${bounds.minX}:${bounds.maxX}:${bounds.minZ}:${bounds.maxZ}`;
  const cached = sceneCache.get(key);
  if (cached) return cached;

  const byTile = new Map<string, number>();
  let total = 0;
  for (const tile of scatterTilesForBounds(bounds)) {
    const overlap = intersectRect(bounds, tile.bounds);
    if (!overlap) continue;
    const width = overlap.maxX - overlap.minX;
    const depth = overlap.maxZ - overlap.minZ;
    const cols = Math.max(1, Math.ceil(width / 16));
    const rows = Math.max(1, Math.ceil(depth / 16));
    let samples = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = overlap.minX + ((col + 0.5) / cols) * width;
        const z = overlap.minZ + ((row + 0.5) / rows) * depth;
        const surface = ctx.scene.scatterSurfaceAt(x, z);
        if (!surface) continue;
        samples += surface.density * ctx.scene.regionWeightAt(ctx.regionId, x, z);
      }
    }
    const weight = samples * rectArea(overlap) / (cols * rows);
    byTile.set(tile.id, weight);
    total += weight;
  }
  const weights = { total, byTile };
  sceneCache.set(key, weights);
  return weights;
}

/**
 * Gives each tile its deterministic share of a whole-layer cap. The shared biome and dry-land
 * fields supply the weights, so ocean tiles do not consume the budget and ecotones may cross
 * semantic rectangles. Cumulative allocation avoids one rounded instance per sparse tile.
 */
function fieldBudgetForTile(total: number, bounds: Rect, ctx: LayerContext): number {
  const weights = fieldWeights(ctx, bounds);
  if (total <= 0 || weights.total <= 0) return 0;
  let weightBefore = 0;
  for (const candidate of scatterTilesForBounds(bounds)) {
    const weight = weights.byTile.get(candidate.id) ?? 0;
    if (candidate.id === ctx.tile.id) {
      const before = Math.floor((weightBefore / weights.total) * total);
      const after = Math.floor(((weightBefore + weight) / weights.total) * total);
      return Math.max(0, after - before);
    }
    weightBefore += weight;
  }
  return 0;
}

const isNativeUnderstory = (id: string): boolean => /^corealm_(fern|shrub)_\d+$/.test(id);
const UNDERSTORY_SPACE = 1.5;
const UNDERSTORY_CROWN_CONTACT = 0.85;
const UNDERSTORY_PLAN_LIMIT = 32;
const UNDERSTORY_ACCENTS = new Set(["bracken", "undergrowth", "scrub", "dry_scrub"]);

interface ScatterLayerPlan {
  candidates: Candidate[];
  transformState: number;
  rejected: number;
  clusters: number;
  missingAssets: string[];
}

interface UnderstorySite {
  candidate: Candidate;
  x: number;
  z: number;
  radius: number;
  rank: number;
  priority: number;
  identity: string;
}

interface UnderstoryTilePlan {
  layers: Map<RegionId, Map<ScatterLayerSpec, ScatterLayerPlan>>;
  sites: UnderstorySite[];
}

interface UnderstoryPlanCache {
  inputs: readonly unknown[];
  signature: string;
  halo: number;
  tiles: Map<string, ScatterTile>;
  pending: Map<string, Promise<UnderstoryTilePlan>>;
  completed: Map<string, UnderstoryTilePlan>;
}

const understoryPlanCaches = new WeakMap<WorldScene, UnderstoryPlanCache>();

function layerContext(
  scene: WorldScene, regionId: RegionId, spec: RegionScatterSpec, seed: number, tile: ScatterTile,
): LayerContext | null {
  const rect = spec.rect ?? scene.getRegionRect(regionId);
  return rect ? {
    scene, regionId, rect, tile, exclusions: spec.exclusions ?? worldExclusions,
    waters: waterBodies(scene), authored: authoredZones(), altitude: regionAltitude(regionId),
    roads: roadStations(scene), seed,
  } : null;
}

/** Plan the unchanged source stream without loading GLBs or publishing any scene objects. */
async function planScatterLayer(
  ctx: LayerContext, assets: AssetRegistry, layer: ScatterLayerSpec, yieldToMain?: () => Promise<void>,
): Promise<ScatterLayerPlan> {
  const { species, unknown } = resolveSpecies(assets, layer);
  const result = createScatterResult(ctx.regionId);
  result.missingAssets = unknown.map((id) => `${layer.id}:${id}`);
  if (species.length === 0) result.missingAssets.push(layer.id);
  const rng = new Rng(deriveScatterTileSeed(ctx.seed, ctx.regionId, layer.id, ctx.tile.id));
  const candidates: Candidate[] = [];
  if (species.length > 0) {
    const span = bootTelemetry.startSpan(BOOT_SPANS.SCATTER_CANDIDATES, {
      detail: { regionId: ctx.regionId, layerId: layer.id, tileId: ctx.tile.id },
    });
    try {
      const mask = createFbm(layerSeed(ctx.seed, ctx.regionId, `${layer.id}-mask`));
      await collectField(layer, ctx, species, rng, mask, candidates, result, yieldToMain);
      await yieldToMain?.();
      collectRoad(layer, ctx, species, rng, candidates, result);
      await yieldToMain?.();
      collectShore(layer, ctx, species, rng, candidates, result);
      span.end({ regionId: ctx.regionId, layerId: layer.id, tileId: ctx.tile.id, candidates: candidates.length });
    } catch (error) {
      span.fail(error, { regionId: ctx.regionId, layerId: layer.id, tileId: ctx.tile.id });
      throw error;
    }
  }
  return {
    candidates, transformState: rng.getState(), rejected: result.rejected,
    clusters: result.clusters, missingAssets: result.missingAssets,
  };
}

/** Actual static crown envelope about the placement origin; shader wind is not growth space. */
function understoryRadius(assets: AssetRegistry, assetId: string, placement: ScatterPlacement): number {
  const asset = assets.entry(assetId)!;
  const size = asset.size;
  const base = asset.base ?? { x: -size.x / 2, y: 0, z: -size.z / 2 };
  const up = new Vector3(0, 1, 0);
  const rotation = new Quaternion().setFromAxisAngle(up, placement.rotationY);
  if (placement.normal && (placement.tilt ?? 1) > 0) {
    const tilt = new Quaternion().setFromUnitVectors(up, new Vector3(...placement.normal).normalize());
    tilt.slerp(new Quaternion(), 1 - clamp01(placement.tilt ?? 1));
    rotation.premultiply(tilt);
  }
  const scale = typeof placement.scale === "number"
    ? new Vector3().setScalar(placement.scale) : new Vector3(...placement.scale);
  const corner = new Vector3();
  let radius = 0;
  for (const x of [base.x, base.x + size.x]) for (const y of [base.y, base.y + size.y]) {
    for (const z of [base.z, base.z + size.z]) {
      corner.set(x, y, z).multiply(scale).applyQuaternion(rotation);
      radius = Math.max(radius, Math.hypot(corner.x, corner.z));
    }
  }
  return radius;
}

function understoryPriority(identity: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < identity.length; index += 1) {
    value = Math.imul(value ^ identity.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash32(value, identity.length);
}

function understoryInputs(
  scene: WorldScene, assets: AssetRegistry, seed: number, specs: Partial<Record<RegionId, RegionScatterSpec>>,
): Pick<UnderstoryPlanCache, "inputs" | "signature"> {
  const walkable = scene.getWalkableMeshes?.();
  const inputs = [
    assets, assets.getManifest?.(), seed, walkable, walkable?.length, walkable?.at(-1),
    scene.terrainGroup?.children[0], scene.terrainGroup?.children.length,
    scene.getTerrainBuildStats?.().restampPassCount,
    ...Object.values(specs).flatMap((spec) => [spec, ...spec.layers]),
  ];
  // Include values so an in-place authoring edit or exclusion update cannot reuse stale plans.
  const signature = JSON.stringify(Object.entries(specs).map(([regionId, spec]) => [regionId, {
    ...spec, exclusions: exclusionRevisions.get(spec.exclusions ?? worldExclusions) ?? 0,
  }]));
  return { inputs, signature };
}

function sameUnderstoryInputs(
  left: Pick<UnderstoryPlanCache, "inputs" | "signature">,
  right: Pick<UnderstoryPlanCache, "inputs" | "signature">,
): boolean {
  return left.signature === right.signature && left.inputs.length === right.inputs.length
    && left.inputs.every((value, index) => value === right.inputs[index]);
}

function understoryCache(
  scene: WorldScene, assets: AssetRegistry, seed: number, specs: Partial<Record<RegionId, RegionScatterSpec>>,
): UnderstoryPlanCache {
  const { inputs, signature } = understoryInputs(scene, assets, seed, specs);
  const previous = understoryPlanCaches.get(scene);
  if (previous && sameUnderstoryInputs(previous, { inputs, signature })) return previous;

  // These older input caches also belong to the terrain/exclusion generation being replaced.
  waterBodyCache.delete(scene);
  roadStationCache.delete(scene);
  tileFieldWeightCache.delete(scene);
  let excursion = 0;
  let maximumRadius = 0;
  for (const spec of Object.values(specs)) for (const layer of spec.layers) {
    const native = resolveSpecies(assets, layer).species.filter((entry) => isNativeUnderstory(entry.assetId));
    if (native.length === 0) continue;
    excursion = Math.max(excursion, layer.cluster?.radius[1] ?? 0,
      layer.road ? Math.max(...layer.road.band.map(Math.abs)) + Math.SQRT2 * 0.4 : 0,
      layer.shore ? Math.max(...layer.shore.band.map(Math.abs)) : 0);
    for (const entry of native) {
      const asset = assets.entry(entry.assetId)!;
      const { size } = asset;
      const base = asset.base ?? { x: -size.x / 2, y: 0, z: -size.z / 2 };
      // Rotation and tilt cannot exceed this scaled 3D distance from the native origin.
      maximumRadius = Math.max(maximumRadius, entry.sizeRatio * Math.max(...entry.scale.map(Math.abs))
        * Math.hypot(1.12 * Math.max(Math.abs(base.x), Math.abs(base.x + size.x)),
          1.25 * Math.max(Math.abs(base.y), Math.abs(base.y + size.y)),
          1.12 * Math.max(Math.abs(base.z), Math.abs(base.z + size.z))));
    }
  }
  const cache: UnderstoryPlanCache = {
    inputs, signature,
    halo: Math.ceil((2 * excursion + Math.max(UNDERSTORY_SPACE, 2 * UNDERSTORY_CROWN_CONTACT * maximumRadius))
      / SCATTER_STREAM_TILE_METRES),
    tiles: new Map(scatterTilesForBounds(scene.getScatterBounds(Infinity)).map((tile) => [tile.id, tile])),
    pending: new Map(), completed: new Map(),
  };
  understoryPlanCaches.set(scene, cache);
  return cache;
}

async function planUnderstoryTile(
  cache: UnderstoryPlanCache, scene: WorldScene, assets: AssetRegistry, seed: number, tile: ScatterTile,
  specs: Partial<Record<RegionId, RegionScatterSpec>>, yieldToMain?: () => Promise<void>,
): Promise<UnderstoryTilePlan> {
  const cached = cache.completed.get(tile.id);
  if (cached) {
    cache.completed.delete(tile.id);
    cache.completed.set(tile.id, cached);
    return cached;
  }
  const pending = cache.pending.get(tile.id);
  if (pending) return pending;
  const task = (async (): Promise<UnderstoryTilePlan> => {
    const plan: UnderstoryTilePlan = { layers: new Map(), sites: [] };
    for (const layout of scene.describeRegions()) {
      const spec = specs[layout.regionId];
      if (!spec) continue;
      const ctx = layerContext(scene, layout.regionId, spec, seed, tile);
      if (!ctx) continue;
      const layers = new Map<ScatterLayerSpec, ScatterLayerPlan>();
      plan.layers.set(layout.regionId, layers);
      for (const layer of spec.layers) {
        if (!resolveSpecies(assets, layer).species.some((entry) => isNativeUnderstory(entry.assetId))) continue;
        const raw = await planScatterLayer(ctx, assets, layer, yieldToMain);
        layers.set(layer, raw);
        const rng = new Rng(0);
        rng.setState(raw.transformState);
        for (const [index, candidate] of raw.candidates.entries()) {
          // Grass composition wraps this same function without consuming any extra RNG.
          const placement = composePlacement(layer, ctx, candidate.species, candidate, assets, rng);
          if ((index + 1) % 128 === 0) await yieldToMain?.();
          if (!isNativeUnderstory(candidate.species.assetId)) continue;
          const identity = `${layout.regionId}:${layer.id}:${tile.id}:${candidate.source}:${index}:${candidate.x}:${candidate.z}`;
          plan.sites.push({
            candidate, x: placement.position[0], z: placement.position[2],
            radius: understoryRadius(assets, candidate.species.assetId, placement),
            rank: candidate.source === "shore" && candidate.species.assetId.startsWith("corealm_fern_") ? 0
              : UNDERSTORY_ACCENTS.has(layer.id) ? 1 : 2,
            priority: understoryPriority(identity, seed), identity,
          });
        }
        await yieldToMain?.();
      }
    }
    return plan;
  })();
  cache.pending.set(tile.id, task);
  try {
    const plan = await task;
    cache.completed.set(tile.id, plan);
    while (cache.completed.size > UNDERSTORY_PLAN_LIMIT) cache.completed.delete(cache.completed.keys().next().value!);
    return plan;
  } finally {
    if (cache.pending.get(tile.id) === task) cache.pending.delete(tile.id);
  }
}

async function understoryCompetition(
  scene: WorldScene, assets: AssetRegistry, seed: number, tile: ScatterTile,
  specs: Partial<Record<RegionId, RegionScatterSpec>>, yieldToMain?: () => Promise<void>,
): Promise<{ own: UnderstoryTilePlan; rejected: Set<Candidate>; assertCurrent: () => void }> {
  const cache = understoryCache(scene, assets, seed, specs);
  const assertCurrent = (): void => {
    // A different immutable recipe may be planning on the same scene concurrently.
    // Validate these inputs without replacing its cache or invalidating either request.
    if (!sameUnderstoryInputs(cache, understoryInputs(scene, assets, seed, specs))) {
      throw new Error("Scatter planning was invalidated by changed world inputs");
    }
  };
  const own = await planUnderstoryTile(cache, scene, assets, seed, tile, specs, yieldToMain);
  const rejected = new Set<Candidate>();
  if (own.sites.length === 0) {
    assertCurrent();
    return { own, rejected, assertCurrent };
  }
  const plans = [own];
  for (let row = tile.row - cache.halo; row <= tile.row + cache.halo; row += 1) {
    for (let col = tile.col - cache.halo; col <= tile.col + cache.halo; col += 1) {
      const neighbour = cache.tiles.get(`${col}:${row}`);
      if (!neighbour || neighbour.id === tile.id) continue;
      plans.push(await planUnderstoryTile(cache, scene, assets, seed, neighbour, specs, yieldToMain));
    }
  }
  let maximumRadius = 0;
  for (const plan of plans) for (const site of plan.sites) maximumRadius = Math.max(maximumRadius, site.radius);
  const cellSize = Math.max(UNDERSTORY_SPACE, 2 * UNDERSTORY_CROWN_CONTACT * maximumRadius);
  const index = new Map<string, UnderstorySite[]>();
  for (const plan of plans) {
    for (const site of plan.sites) {
      const key = `${Math.floor(site.x / cellSize)}:${Math.floor(site.z / cellSize)}`;
      const cell = index.get(key);
      if (cell) cell.push(site);
      else index.set(key, [site]);
    }
    await yieldToMain?.();
  }
  for (const [siteIndex, site] of own.sites.entries()) {
    const col = Math.floor(site.x / cellSize);
    const row = Math.floor(site.z / cellSize);
    search: for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      for (const other of index.get(`${col + dx}:${row + dy}`) ?? []) {
        const priority = other.rank - site.rank || other.priority - site.priority
          || (other.identity < site.identity ? -1 : other.identity > site.identity ? 1 : 0);
        if (priority >= 0) continue;
        const spacing = Math.max(UNDERSTORY_SPACE, UNDERSTORY_CROWN_CONTACT * (site.radius + other.radius));
        if ((site.x - other.x) ** 2 + (site.z - other.z) ** 2 >= spacing ** 2) continue;
        // Compare RAW candidates. Accepted-only competition has unbounded priority chains
        // and would depend on which generation tile happened to stream first.
        rejected.add(site.candidate);
        break search;
      }
    }
    if ((siteIndex + 1) % 128 === 0) await yieldToMain?.();
  }
  assertCurrent();
  return { own, rejected, assertCurrent };
}

/** Places one generation tile of one visual-biome recipe. */
async function scatterRegionTile(
  scene: WorldScene,
  assets: AssetRegistry,
  regionId: RegionId,
  spec: RegionScatterSpec,
  seed: number,
  tile: ScatterTile,
  loadOptions: ScatterTileLoadOptions,
  competition?: Awaited<ReturnType<typeof understoryCompetition>>,
): Promise<ScatterResult> {
  const rect = spec.rect ?? scene.getRegionRect(regionId);
  const exclusions = spec.exclusions ?? worldExclusions;
  const result = createScatterResult(regionId, spec);
  if (!rect) return result;

  const ctx: LayerContext = {
    scene,
    regionId,
    rect,
    tile,
    exclusions,
    waters: waterBodies(scene),
    authored: authoredZones(),
    altitude: regionAltitude(regionId),
    roads: roadStations(scene),
    seed,
  };

  // Region-wide rather than per-layer: `scatterInstanced` builds one InstancedMesh per (asset,
  // primitive), so two layers naming the same asset used to pay for it twice. Vellenwood's fern,
  // broad-leaf mat and small leafy plant each appeared in two layers, which was 5 draw calls of
  // pure duplication world-wide. Layers naming the same asset add instances to this shared bucket
  // instead of creating another mesh.
  const buckets = new Map<string, InstanceBucket>();

  for (const layer of spec.layers) {
    const plan = competition?.own.layers.get(regionId)?.get(layer)
      ?? await planScatterLayer(ctx, assets, layer, loadOptions.yieldToMain);
    result.rejected += plan.rejected;
    result.clusters += plan.clusters;
    result.missingAssets.push(...plan.missingAssets);
    const candidates = plan.candidates;
    const rng = new Rng(0);
    rng.setState(plan.transformState);

    try {
      // Candidate generation comes first so a spawn tile requests only assets it actually uses.
      // Grass uses generated cards and never requests its source GLB.
      const requested = [...new Set(candidates
        .filter((candidate) => !competition?.rejected.has(candidate))
        .map((candidate) => candidate.species.assetId)
        .filter((assetId) => !isGrassSprite(assetId)))];
      if (requested.length > 0) {
        await assets.loadMany(requested, {
          priority: loadOptions.priority ?? "background",
          regionId: loadOptions.regionId,
          primary: loadOptions.primary,
        });
      }
    } catch (error) {
      result.missingAssets.push(layer.id);
      // Do not mark a tile resident after a transient load failure. The streaming controller can
      // retry it when the registry's primary-asset retry path becomes ready.
      throw error;
    }

    competition?.assertCurrent();
    const castShadow = layer.castShadow ?? false;
    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (candidateIndex % 64 === 0) await loadOptions.yieldToMain?.();
      const entry = candidate.species;
      const assetId = entry.assetId;
      if (isGrassSprite(assetId)) {
        const key = "grass-sprite|-";
        const found = buckets.get(key);
        const bucket: GrassInstanceBucket = found?.kind === "grass"
          ? found
          : { kind: "grass", assetId: "grass-sprite", castShadow: false, placements: [] };
        const grassPlacement = composeGrassPlacement(layer, ctx, entry, candidate, assets, rng);
        // Folded blades replace four-triangle cards. Keep the same clustered field and RNG
        // sequence with a deterministic quarter-density sample, then broaden each tuft slightly.
        if (scene.hasNativeGrass?.()) {
          const coverage = Math.imul(Math.round(candidate.x * 100), 73856093) ^ Math.imul(Math.round(candidate.z * 100), 19349663);
          if ((coverage >>> 0) % 4 !== 0) continue;
          grassPlacement.width *= 1.4;
        }
        bucket.placements.push(grassPlacement);
        buckets.set(key, bucket);
        result.placed += 1;
        result.byLayer[layer.id] = (result.byLayer[layer.id] ?? 0) + 1;
        result.bySource[candidate.source] = (result.bySource[candidate.source] ?? 0) + 1;
        result.byAsset[assetId] = (result.byAsset[assetId] ?? 0) + 1;
        continue;
      }
      // Keyed on shadow as well as asset, because the shadow flag is a property of the
      // InstancedMesh: fern undergrowth and fern on a damp bank share one mesh, a shadow-casting
      // pine and a non-casting one could not.
      // Always consume the source transform, even for a crowded native plant. Grass,
      // trees and later transforms keep their original stream, and rejected slots never refill.
      const placement = composePlacement(layer, ctx, entry, candidate, assets, rng);
      if (competition?.rejected.has(candidate)) {
        result.rejected += 1;
        continue;
      }
      // Habitat clearances reject only the already-composed native trunk. Its origin can differ
      // from the source candidate after display-alias fitting, and its final uniform scale owns
      // trunk width. Keeping this after every transform draw preserves all surviving placements.
      if (entry.treeSpecies && exclusions.blocksTreeClearance(
        placement.position[0], placement.position[2],
        placement.forestTree?.trunkRadius ?? (assets.entry(assetId)?.trunkRadius ?? TREE_TRUNK_RADII[assetId]!) * (placement.scale as number),
      )) {
        result.rejected += 1;
        continue;
      }
      const key = `${assetId}|${castShadow ? "s" : "-"}`;
      const found = buckets.get(key);
      const bucket: MeshInstanceBucket = found?.kind === "mesh"
        ? found
        : { kind: "mesh", assetId, castShadow, placements: [] };
      bucket.placements.push(placement);
      buckets.set(key, bucket);
      result.placed += 1;
      result.byLayer[layer.id] = (result.byLayer[layer.id] ?? 0) + 1;
      result.bySource[candidate.source] = (result.bySource[candidate.source] ?? 0) + 1;
      result.byAsset[assetId] = (result.byAsset[assetId] ?? 0) + 1;
    }

    // A dense organic layer can be meaningful work even though it owns only one deterministic
    // recipe. Yield after the complete layer so no RNG stream or bucket is split across tasks.
    await loadOptions.yieldToMain?.();
  }

  const meshSpan = bootTelemetry.startSpan(BOOT_SPANS.SCATTER_MESHES, {
    detail: { regionId, tileId: tile.id },
  });
  competition?.assertCurrent();
  for (const bucket of buckets.values()) {
    if (bucket.kind === "grass") {
      for (const shard of shardByTile(bucket)) {
        await loadOptions.yieldToMain?.();
        result.tiles += 1;
        const meshes = scene.scatterGrassSprites(
          shard.placements,
          `scatter-${regionId}-grass-sprite-g${tile.id}-t${shard.tile >>> 0}`,
          { regionId },
        );
        result.instancedMeshes += meshes.length;
        result.estimatedDrawCalls += meshes.length;
        for (const mesh of meshes) {
          const indices = mesh.geometry.getIndex();
          const positions = mesh.geometry.getAttribute("position");
          const triangles = Math.round((indices?.count ?? positions?.count ?? 0) / 3);
          result.estimatedTriangles += triangles * mesh.count;
        }
      }
      continue;
    }
    const renderTile = /^corealm_(oak|pine)_\d+$/.test(bucket.assetId) ? FOLIAGE_RENDER_TILE_METRES.trees
      : /^corealm_(fern|shrub)_\d+$/.test(bucket.assetId) ? FOLIAGE_RENDER_TILE_METRES.understory : undefined;
    for (const shard of shardByTile(bucket, renderTile)) {
      await loadOptions.yieldToMain?.();
      result.tiles += 1;
      const meshes = scene.scatterInstanced(
        assets.instance(bucket.assetId),
        shard.placements,
        `scatter-${regionId}-${bucket.assetId}-g${tile.id}-t${shard.tile >>> 0}`,
        {
          regionId, castShadow: bucket.castShadow, windStrength: windStrengthForAsset(bucket.assetId),
          compactVisibility: !bucket.castShadow && /^corealm_(fern|shrub)_\d+$/.test(bucket.assetId),
        },
      );
      if (loadOptions.onTree && meshes.length > 0) {
        for (const [slot, placement] of shard.placements.entries()) {
          if (!placement.forestTree) continue;
          const originals = meshes.map((mesh) => {
            const matrix = new Matrix4();
            mesh.getMatrixAt(slot, matrix);
            return matrix;
          });
          const hidden = originals.map((matrix) => matrix.clone().scale(new Vector3(0, 0, 0)));
          let visible = true;
          loadOptions.onTree(placement.forestTree, (nextVisible) => {
            if (visible === nextVisible) return;
            visible = nextVisible;
            for (let primitive = 0; primitive < meshes.length; primitive += 1) {
              const mesh = meshes[primitive]!;
              mesh.setMatrixAt(slot, (visible ? originals : hidden)[primitive]!);
              mesh.instanceMatrix.needsUpdate = true;
            }
          });
        }
      }
      result.instancedMeshes += meshes.length;
      result.estimatedDrawCalls += meshes.length * (bucket.castShadow ? 2 : 1);
      for (const mesh of meshes) {
        const indices = mesh.geometry.getIndex();
        const positions = mesh.geometry.getAttribute("position");
        const triangles = Math.round((indices?.count ?? positions?.count ?? 0) / 3);
        result.estimatedTriangles += triangles * mesh.count * (bucket.castShadow ? 2 : 1);
      }
    }
  }
  meshSpan.end({
    regionId,
    tileId: tile.id,
    meshes: result.instancedMeshes,
    tiles: result.tiles,
    triangles: result.estimatedTriangles,
  });

  return result;
}

/** Generates one spatial tile across every authored visual-biome recipe. */
export async function scatterWorldTile(
  scene: WorldScene,
  assets: AssetRegistry,
  seed: number,
  tile: ScatterTile,
  specs: Partial<Record<RegionId, RegionScatterSpec>> = DEFAULT_SCATTER,
  loadOptions: ScatterTileLoadOptions = {},
): Promise<ScatterResult[]> {
  const results: ScatterResult[] = [];
  const competition = await understoryCompetition(scene, assets, seed, tile, specs, loadOptions.yieldToMain);
  for (const layout of scene.describeRegions()) {
    const spec = specs[layout.regionId];
    if (!spec) continue;
    results.push(await scatterRegionTile(scene, assets, layout.regionId, spec, seed, tile, loadOptions, competition));
  }
  return results;
}

/**
 * Compatibility entry point for callers that ask for one recipe. It still partitions before
 * candidate generation and folds the tile costs into one result.
 */
export async function scatterRegion(
  scene: WorldScene,
  assets: AssetRegistry,
  regionId: RegionId,
  spec: RegionScatterSpec,
  seed: number,
): Promise<ScatterResult> {
  const partials: ScatterResult[] = [];
  const specs = { [regionId]: spec };
  for (const tile of scatterTilesForBounds(scene.getScatterBounds(Infinity))) {
    const competition = await understoryCompetition(scene, assets, seed, tile, specs);
    partials.push(await scatterRegionTile(scene, assets, regionId, spec, seed, tile, {}, competition));
  }
  return mergeScatterResults(partials, { [regionId]: spec })[0] ?? createScatterResult(regionId, spec);
}

/** Region-wide placement: two-level clusters, or lone props when no `cluster` is authored. */
async function collectField(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  mask: (x: number, z: number) => number,
  out: Candidate[],
  result: ScatterResult,
  yieldToMain?: () => Promise<void>,
): Promise<void> {
  // Biomes own visual land, not semantic rectangles. The field domain still spans the organic
  // island, then this pass intersects it with the generation tile before Poisson sampling starts.
  const fieldBounds = layerFieldBounds(ctx, layer);
  const sampleRect = intersectRect(fieldBounds, ctx.tile.bounds);
  if (!sampleRect) return;
  const fieldScale = layer.bleed === undefined ? FULL_ISLAND_FIELD_SCALE : 1;
  const fieldLimit = fieldBudgetForTile(Math.ceil(layer.maxCount * fieldScale), fieldBounds, ctx);
  if (fieldLimit <= 0) return;

  const maskAt = (x: number, z: number): number => {
    if (!layer.mask || layer.mask.strength <= 0) return 1;
    const value = mask(x / layer.mask.featureSize, z / layer.mask.featureSize);
    // Threshold rises with strength, so a strong mask carves real clearings rather than thinning
    // uniformly. strength 1 rejects roughly half the world; strength 0 rejects nothing.
    return smoothstep01((value - (0.5 - (1 - layer.mask.strength) * 0.5)) / 0.18);
  };

  const cluster = layer.cluster;
  if (!cluster) {
    // Stop a tiny authored spacing from turning one tile into a several-hundred-thousand point job.
    const grassOnly = species.every((entry) => isGrassSprite(entry.assetId));
    const candidateCeiling = grassOnly ? 18_000 : 12_000;
    const candidateCap = Math.min(candidateCeiling, Math.max(64, Math.ceil(fieldLimit * 2.5)));
    const points = shuffleByHash(
      await poissonDiscYielding(sampleRect, layer.spacing ?? 6, rng, candidateCap, yieldToMain),
      deriveScatterTileSeed(0x5eed01, ctx.regionId, layer.id, ctx.tile.id),
    );
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const [x, z] = points[pointIndex]!;
      if (out.length >= fieldLimit) break;
      const factor = siteFactor(layer, ctx, x, z, "field", true) * maskAt(x, z);
      if (factor <= 0 || rng.next() > factor) { result.rejected += 1; continue; }
      const entry = pickSpecies(species, "field", rng);
      if (!entry) break;
      out.push({ x, z, source: "field", species: entry });
      if ((pointIndex + 1) % 128 === 0) await yieldToMain?.();
    }
    return;
  }

  const falloff = cluster.falloff ?? 0.75;
  const dominance = cluster.dominance ?? 0.7;
  const centres = shuffleByHash(
    await poissonDiscYielding(sampleRect, cluster.spacing, rng, 60_000, yieldToMain),
    deriveScatterTileSeed(0x5eed02, ctx.regionId, layer.id, ctx.tile.id),
  );
  for (const [cx, cz] of centres) {
    if (out.length >= fieldLimit) break;
    const factor = siteFactor(layer, ctx, cx, cz, "field", true) * maskAt(cx, cz) * cluster.accept;
    if (factor <= 0 || rng.next() > factor) { result.rejected += 1; continue; }

    // A cluster straddling a region seam is squeezed into a hedgerow rather than allowed to sprawl
    // into the neighbour, which is what turns the border from a paint-bucket edge into a treeline.
    const seam = ctx.scene.regionWeightAt(ctx.regionId, cx, cz);
    const onSeam = seam < 0.72;
    const radius = onSeam
      ? Math.min(9, cluster.radius[0])
      : cluster.radius[0] + rng.next() * (cluster.radius[1] - cluster.radius[0]);
    const memberSpacing = onSeam ? cluster.memberSpacing * 0.75 : cluster.memberSpacing;

    const dominant = pickSpecies(species, "field", rng);
    if (!dominant) break;
    result.clusters += 1;

    for (const [x, z] of await poissonDisc2Yielding(cx, cz, radius, memberSpacing, rng, yieldToMain)) {
      const reach = radius > 0 ? Math.hypot(x - cx, z - cz) / radius : 0;
      if (rng.next() > 1 - falloff * reach * reach) { result.rejected += 1; continue; }
      const site = siteFactor(layer, ctx, x, z, "field", false);
      if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
      const entry = rng.next() < dominance ? dominant : pickSpecies(species, "field", rng);
      if (!entry) continue;
      out.push({ x, z, source: "field", species: entry });
    }
    await yieldToMain?.();
  }
}

/** Verge and surface dressing along the drawn road centrelines. */
function collectRoad(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  out: Candidate[],
  result: ScatterResult,
): void {
  const spec = layer.road;
  if (!spec || ctx.roads.length === 0) return;
  const [near, far] = spec.band;
  for (const station of ctx.roads) {
    if (!pointInTile(station.x, station.z, ctx.tile)) continue;
    const whole = Math.floor(spec.perMetre);
    const wanted = whole + (rng.next() < spec.perMetre - whole ? 1 : 0);
    for (let index = 0; index < wanted; index += 1) {
      const side = rng.next() < 0.5 ? -1 : 1;
      const offset = (near + rng.next() * (far - near)) * side;
      const jitterX = rng.float(-0.4, 0.4);
      const jitterZ = rng.float(-0.4, 0.4);
      const x = station.x + station.nx * offset + jitterX;
      const z = station.z + station.nz * offset + jitterZ;
      const site = siteFactor(layer, ctx, x, z, "road", true);
      if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
      const entry = pickSpecies(species, "road", rng);
      if (!entry) return;
      out.push({ x, z, source: "road", species: entry });
    }
  }
}

function pointInTile(x: number, z: number, tile: ScatterTile): boolean {
  return x >= tile.bounds.minX && x < tile.bounds.maxX
    && z >= tile.bounds.minZ && z < tile.bounds.maxZ;
}

/** Reeds and moisture-loving cover along the renderer's solved water contour. */
function collectShore(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  species: ResolvedSpecies[],
  rng: Rng,
  out: Candidate[],
  result: ScatterResult,
): void {
  const spec = layer.shore;
  if (!spec) return;
  for (const body of ctx.waters) {
    for (let segment = 0; segment < body.contour.length; segment += 1) {
      const from = body.contour[segment]!;
      const to = body.contour[(segment + 1) % body.contour.length]!;
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(length));
      for (let step = 0; step < steps; step += 1) {
        const along = (step + 0.5) / steps;
        const shoreX = from[0] + dx * along;
        const shoreZ = from[1] + dz * along;
        if (!pointInTile(shoreX, shoreZ, ctx.tile)) continue;

        const stationLength = length / steps;
        const credit = stationLength * spec.perMetre;
        const whole = Math.floor(credit);
        const wanted = whole + (rng.next() < credit - whole ? 1 : 0);
        for (let index = 0; index < wanted; index += 1) {
          const outwardX = shoreX - body.x;
          const outwardZ = shoreZ - body.z;
          const outwardLength = Math.hypot(outwardX, outwardZ);
          if (outwardLength <= 1e-4) continue;
          const offset = spec.band[0] + rng.next() * (spec.band[1] - spec.band[0]);
          const x = shoreX + (outwardX / outwardLength) * offset;
          const z = shoreZ + (outwardZ / outwardLength) * offset;
          const site = siteFactor(layer, ctx, x, z, "shore", true);
          if (site <= 0 || rng.next() > site) { result.rejected += 1; continue; }
          const entry = pickSpecies(species, "shore", rng);
          if (!entry) return;
          out.push({ x, z, source: "shore", species: entry });
        }
      }
    }
  }
}

/**
 * One instance transform.
 *
 * Three things the old composer did not do, all of them free because they ride the same matrix:
 * lean into the ground normal, vary width against height, and turn half the opted-in instances to
 * the opposite facing. Scale stays positive so instancing never receives a flipped determinant.
 */
function composePlacement(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  entry: ResolvedSpecies,
  candidate: Candidate,
  assets: AssetRegistry,
  rng: Rng,
): ForestScatterPlacement {
  const surface = ctx.scene.scatterSurfaceAt(candidate.x, candidate.z);
  const height = surface?.height ?? ctx.scene.meshHeightAt(candidate.x, candidate.z);
  const bias = layer.sizeBias ?? 2.2;
  const size = entry.scale[0] + (entry.scale[1] - entry.scale[0]) * Math.pow(rng.next(), bias);
  const width = 1 + rng.float(-0.12, 0.12);
  const stretch = 1 + rng.float(-0.15, 0.25);
  // Always consume the old mirror draw when enabled so this safety fix does not move any later RNG
  // draws. A half turn supplies the facing variation without negative scale.
  const halfTurn = (layer.mirror ?? false) && rng.next() < 0.5 ? Math.PI : 0;
  const rotationY = rng.next() * Math.PI * 2 + halfTurn;
  const scaledSize = size * entry.sizeRatio;
  if (entry.treeSpecies) {
    // Preserve old canopy footprint for broad oaks, with the approved 35% allowance, and old
    // height for conifers. Consume both old aspect draws but never stretch a harvestable tree.
    const scale = scaledSize * (entry.treeSpecies === "oak" ? width : stretch);
    const old = assets.entry(entry.sourceAssetId)!;
    const next = assets.entry(entry.assetId)!;
    const oldX = (old.base?.x ?? -old.size.x / 2) + old.size.x / 2;
    const oldZ = (old.base?.z ?? -old.size.z / 2) + old.size.z / 2;
    const nextX = (next.base?.x ?? -next.size.x / 2) + next.size.x / 2;
    const nextZ = (next.base?.z ?? -next.size.z / 2) + next.size.z / 2;
    const offsetX = oldX * size * width - nextX * scale;
    const offsetZ = oldZ * size * width - nextZ * scale;
    const x = candidate.x + offsetX * Math.cos(rotationY) + offsetZ * Math.sin(rotationY);
    const z = candidate.z - offsetX * Math.sin(rotationY) + offsetZ * Math.cos(rotationY);
    const ground = ctx.scene.meshHeightAt(x, z);
    const position: Vec3 = [x, ground - (next.base?.y ?? 0) * scale, z];
    const semantic = ctx.scene.describeRegions().find((layout) => {
      const rect = ctx.scene.getRegionRect(layout.regionId);
      return rect && x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
    });
    const resourceId = treeSpeciesForAsset(entry.assetId)!.resourceId;
    const nativeTrunkRadius = next.trunkRadius ?? TREE_TRUNK_RADII[entry.assetId];
    if (nativeTrunkRadius === undefined) throw new Error(`Missing trunk dimensions for ${entry.assetId}.`);
    return {
      position, rotationY, scale, tilt: 0,
      ...(semantic ? { forestTree: {
        // The source candidate identifies the tree before display aliases, batching or sharding.
        id: `forest:${ctx.seed >>> 0}:${ctx.regionId}:${layer.id}:${ctx.tile.id}:${candidate.source}:${candidate.x.toFixed(4)}:${candidate.z.toFixed(4)}`,
        resourceId, regionId: semantic.regionId, position, assetId: entry.assetId, scale, rotationY,
        trunkRadius: nativeTrunkRadius * scale,
      } } : {}),
    };
  }
  const nativeBase = entry.assetId !== entry.sourceAssetId ? assets.entry(entry.assetId)?.base?.y ?? 0 : 0;
  return {
    position: [candidate.x, height - entry.sink - nativeBase * scaledSize * stretch, candidate.z],
    rotationY,
    scale: [scaledSize * width, scaledSize * stretch, scaledSize * width],
    normal: entry.tilt > 0
      ? surface?.normal ?? ctx.scene.normalAt(candidate.x, candidate.z)
      : undefined,
    tilt: entry.tilt,
  };
}

/**
 * Turns the same deterministic transform a GLB tuft would have received into a four-triangle card.
 * Source dimensions come from the manifest, so changing render geometry does not change authored
 * world height or the relative short/tall and common/wispy hierarchy.
 */
function composeGrassPlacement(
  layer: ScatterLayerSpec,
  ctx: LayerContext,
  entry: ResolvedSpecies,
  candidate: Candidate,
  assets: AssetRegistry,
  rng: Rng,
): GrassSpritePlacement {
  const placement = composePlacement(layer, ctx, entry, candidate, assets, rng);
  const scale = typeof placement.scale === "number"
    ? [placement.scale, placement.scale, placement.scale] as const
    : placement.scale;
  const native = assets.assetSize(entry.assetId) ?? { x: 0.8, y: 1.2, z: 0.8 };
  // The generated cutout contains a small fan of blades, so its physical width needs to read as
  // one tuft, not one stem. Field cards overlap at their authored member spacing; mixed cover
  // stays narrower so an accent clump does not become a wall.
  const minimumWidth = layer.id === "bladecarpet" ? 0.46 : 0.18;
  const width = clampRange(
    Math.max(native.x * Math.abs(scale[0]), native.z * Math.abs(scale[2])) * 0.9,
    minimumWidth,
    2.1,
  );
  const height = clampRange(native.y * Math.abs(scale[1]), 0.14, 2.3);
  return {
    position: placement.position,
    rotationY: placement.rotationY,
    width,
    height,
    colour: grassColour(entry.assetId, candidate.x, candidate.z),
    normal: placement.normal,
    tilt: placement.tilt,
  };
}

/** A positional colour shift. No extra RNG draw, so neighbouring non-grass transforms stay put. */
function grassColour(assetId: string, x: number, z: number): number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < assetId.length; index += 1) {
    seed = Math.imul(seed ^ assetId.charCodeAt(index), 0x01000193) >>> 0;
  }
  const position = (Math.imul(Math.round(x * 32), 0x1f123bb5)
    ^ Math.imul(Math.round(z * 32), 0x5f356495)) >>> 0;
  const unit = hash32(seed, position) / 0xffffffff;
  const gain = 0.86 + unit * 0.22;
  return scaleHex(assetId.startsWith("grass_wispy") ? GRASS_COLOURS.dry : GRASS_COLOURS.green, gain);
}

function scaleHex(colour: number, gain: number): number {
  const red = Math.min(255, Math.round(((colour >>> 16) & 0xff) * gain));
  const green = Math.min(255, Math.round(((colour >>> 8) & 0xff) * gain));
  const blue = Math.min(255, Math.round((colour & 0xff) * gain));
  return (red << 16) | (green << 8) | blue;
}

function clampRange(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** Dresses every region the scene knows about. */
export async function scatterWorld(
  scene: WorldScene,
  assets: AssetRegistry,
  seed: number,
  specs: Partial<Record<RegionId, RegionScatterSpec>> = DEFAULT_SCATTER,
): Promise<ScatterResult[]> {
  const tileResults: ScatterResult[] = [];
  for (const tile of scatterTilesForBounds(scene.getScatterBounds(Infinity))) {
    tileResults.push(...await scatterWorldTile(scene, assets, seed, tile, specs));
  }
  return mergeScatterResults(tileResults, specs);
}

// --------------------------------------------------- exclusion profiles

/**
 * Canopy. Nothing grows through a roof, so the hard clearance is generous, but the fade is 30 m so
 * a wood approaches a settlement rather than stopping on its property line.
 */
const TREE_EXCLUSION: ExclusionProfile = {
  base: { hard: 6, fade: 14 },
  byKind: {
    settlement: { hard: 9, fade: 30 },
    road: { hard: 5, fade: 12 },
    cluster: { hard: 5, fade: 10 },
    spawn: { hard: 9, fade: 20 },
    ritual: { hard: 1, fade: 8 },
  },
  authored: { hard: 6, fade: 12 },
};

/**
 * Waist-high volume. Close enough to a road to frame it, far enough not to hide a path.
 *
 * The `cluster` band reaches 6 m inside a resource cluster rather than stopping 2 m outside it, so
 * a copse or an ore field gets a ring of bracken in its outer few metres and stays clear in the
 * middle where the interactable nodes are. Nodes stay readable; the cluster stops looking like a
 * disc of mown lawn with props on it.
 */
const SHRUB_EXCLUSION: ExclusionProfile = {
  base: { hard: 2.5, fade: 9 },
  byKind: {
    settlement: { hard: -12, fade: 26 },
    road: { hard: 3, fade: 6 },
    cluster: { hard: -6, fade: 8 },
    spawn: { hard: 4, fade: 12 },
    ritual: { hard: 1, fade: 6 },
  },
  authored: { hard: 2.5, fade: 6 },
};

/**
 * Ground cover. Reaches straight through the root's placeholder rings, because a boolean test on
 * them is what produced every bare disc in the world. What actually keeps grass off a doorstep is
 * `authoredZones`, one small zone per building, wall segment, paving rect and prop.
 *
 * Both negative bands were measured against a screenshot rather than chosen. `cluster` was
 * `hard: -0.5`, which reads as "0.5 m inside the edge" and therefore leaves the whole INTERIOR of
 * the circle at zero: `app/boot.ts` registers every resource cluster at `radius + 3`, so Palewood
 * Copse (radius 15) held an 18 m bare disc and its route node another 9 m one. That is the entire
 * content of runs/corealm/screenshots/w2-palewood_copse.png — five trees on empty grass, with the
 * camera 18 m out and therefore looking at nothing but the hole. `-30` clears the deepest authored
 * cluster (18 m) with room to spare, so cover now grows between the choppable trees and between the
 * ore nodes, which is also what makes those nodes read as objects standing IN something.
 *
 * `settlement` was `-36` against a 46 m ring, leaving a 10 m bald spot on every town centre.
 */
const COVER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.6, fade: 3 },
  byKind: {
    settlement: { hard: -48, fade: 14 },
    road: { hard: 1.4, fade: 2.6 },
    cluster: { hard: -30, fade: 4 },
    spawn: { hard: 1, fade: 6 },
    ritual: { hard: 0.75, fade: 4 },
  },
  authored: { hard: 0.8, fade: 2.5 },
  // Only structural footprints use this close band. Paving, walls, doors/roads, stations and
  // props retain the authored 0.8 m hard / 2.5 m fade above, so foundations grow in without
  // putting cards in interaction or circulation space.
  authoredBuilding: { hard: 0.15, fade: 0.8 },
};

/** Pebbles and path rocks: allowed right up to anything, because they are ankle height. */
const LITTER_EXCLUSION: ExclusionProfile = {
  base: { hard: 0.5, fade: 3 },
  byKind: {
    settlement: { hard: -50, fade: 12 },
    road: { hard: -1, fade: 2 },
    cluster: { hard: -30, fade: 3 },
    spawn: { hard: 0.5, fade: 4 },
    ritual: { hard: 0.5, fade: 3 },
  },
  authored: { hard: 0.5, fade: 2 },
};

// --------------------------------------------------------- species presets

/**
 * The colour census every cover pool below is picked against.
 *
 * **Every species is picked off its own UVs, not off its material name.** The nature kit's
 * `Leaves` atlas is one 512x512 sheet holding greens, a blue leaf, two orange leaves and a purple
 * clover side by side, so two assets on the same material can be opposite colours and a
 * whole-texture mean says nothing. Sampled at the UVs each mesh actually reads
 * (`runs/corealm/audit/sct-uvcolour.mjs`):
 *
 *     plant_leafy_small/large  rgb(107,146,16)  green    fern_1             rgb(121,166,10)  green
 *     grass_common_short/tall  rgb(121,171,32)  green    grass_wispy_*      rgb(182,159,0)   gold
 *     plant_broad_small/large  rgb(184,63,27)   RED      clover_1/2         rgb(220,95,34)   RED
 *     flower_a_* petals        rgb(216,116,106) salmon   flower_b_* petals  rgb(167,129,190) violet
 *     mushroom_common          rgb(162,134,114) buff
 *
 * That table is why `plant_broad_small` is absent from every pool despite being, at 48 triangles
 * for a 1.05 x 0.96 m mat, by far the cheapest ground coverage in the kit — 46 triangles per
 * square metre against `grass_common_short`'s 330. It is red. `plant_broad_large`, `clover_1` and
 * `clover_2` are red for the same reason, and `bush_common`'s only material is the red autumn
 * `Leaves_TwistedTree`. Losing them is what makes dense cover cost triangles.
 *
 * ONE POOL PER REGION, which is this round's change and the brief's "not the same carpet tinted
 * three ways". The shared pool made all three regions the same sward with a different vertex
 * colour under it. Fallowmarch is river-plain meadow: common grass, a tall grass for silhouette,
 * and drifts of the salmon flower. Vellenwood is shaded woodland floor: fern and leafy plant carry
 * it, grass is thinned to a third, and mushrooms and stone litter stand in for leaf mould.
 * Karrowmoor is thin upland turf on scree: gold wispy moor grass, short common grass, and roughly
 * twice as much loose stone as either of the others.
 *
 * The cost argument that shapes every weight below: buckets are keyed on (asset, castShadow)
 * REGION-WIDE (`scatterRegion`), so a species already named by another layer in the same region
 * adds instances to an existing `InstancedMesh` and costs zero draw calls. `flower_a_single` is
 * free in Fallowmarch because `bloom` already instances it, `mushroom_common` is free in
 * Vellenwood because `fungus` does, and `grass_wispy_short` is free in Karrowmoor because `scrub`
 * does. Only `grass_common_tall` is genuinely new, and only in Fallowmarch.
 *
 * Scale bands are set against the manifest's native size. Round 2 put cover at 0.30-0.65 m and
 * that is measurably too small to read as a field: at the shipped 0.24 instances/m2 a 0.4 m tuft
 * covers about 3% of the ground, which is `w3-palewood_copse.png` — a green shader with occasional
 * props on it. Coverage is linear in count and QUADRATIC in scale, and scale is free in both
 * triangles and draw calls, so the bands here are ~1.35x wider and `sizeBias` has come down from
 * 1.6 to 1.25 so more of the draw lands near the top of the band. Together with roughly double the
 * count that is about 5x the ground coverage for about 2x the triangles.
 */

/**
 * Reeds and damp-bank fronds. Appended to every region's cover pool, because the moisture band is
 * the same plant everywhere and the shore source is what carries it.
 */
const SHORE_COVER: ScatterSpeciesSpec[] = [
  // 1.672 m native -> 1.25-2.09 m. Reeds stand plumb out of still water, so tilt is 0.
  { assetId: "grass_wispy_tall", weight: 5, scale: [0.75, 1.25], tilt: 0, sources: ["shore"] },
  // The same fern at damp-bank size. A second entry rather than a second asset: buckets are keyed
  // on asset id, so both sizes share one InstancedMesh and the variety costs no draw call.
  { assetId: "fern_1", weight: 3, scale: [0.45, 0.85], sources: ["shore"] },
];

/** Fallowmarch: river-plain meadow. Grass-dominant, waist-high tussocks, drifts of salmon flower. */
const MEADOW_COVER: ScatterSpeciesSpec[] = [
  // 1.334 m native -> 0.45-0.87 m. 155 triangles, and the backbone of the region.
  { assetId: "grass_common_short", weight: 11, scale: [0.34, 0.68] },
  // 1.014 m tall, 1.27 m wide native -> 0.44-0.83 m tall, 0.55-1.04 m across. 120 triangles: the
  // cheapest green leaf in the kit now that the red broad-leaf mats are out.
  { assetId: "plant_leafy_small", weight: 1.6, scale: [0.4, 0.72] },
  // 1.873 m native -> 0.60-1.09 m, 326 triangles. The only genuinely new species in any pool, and
  // the one thing a meadow needs that a scaled-up short tuft cannot fake: a different silhouette
  // at knee-to-waist height. Weight 1.6 keeps the bucket under `TILE_MIN_INSTANCES`, so it stays
  // one region-wide mesh and costs exactly one draw call.
  { assetId: "grass_common_tall", weight: 1.7, scale: [0.32, 0.58], tilt: 0.3 },
  // Small stones through the sward, and the cheapest trick in this file: 48 triangles, and the
  // `stones` layer already instances it, so these cost ZERO extra draw calls. 0.34 m native.
  { assetId: "rock_small_2", weight: 1.2, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // Same argument, 114 triangles, a rounder silhouette.
  { assetId: "pebble_round_1", weight: 1.1, scale: [0.5, 1.3], tilt: 1, sink: 0.03 },
  // 0.840 m tall, 2.83 m wide native -> 0.25-0.50 m tall, 0.85-1.70 m across: a low frond mat, and
  // the flat silhouette the red broad-leaf plants used to supply. Kept at weight 1: at 288
  // triangles it is 2.3x the cost of the greens either side of it.
  { assetId: "fern_1", weight: 0.7, scale: [0.3, 0.62], tilt: 1 },
  // 1.072 m tall, 1.32 m wide native -> 0.48-0.91 m tall, 0.59-1.12 m across. Gold, and free in
  // draw calls because `bracken` already instances it in this region. Fallowmarch is a FALLOW
  // march: a dry grass through the green is the region's name doing its job.
  { assetId: "grass_wispy_short", weight: 1.4, scale: [0.45, 0.85], tilt: 0.25 },
  // 2.068 m native -> 0.48-0.83 m. Free in draw calls (the `bloom` layer instances it) and weighted
  // low enough that the shared bucket stays one mesh. Colour through the whole field rather than
  // only in `bloom`'s drifts, which is what a river meadow in flower actually looks like.
  { assetId: "flower_a_single", weight: 0.5, scale: [0.23, 0.4], tilt: 0.3 },
  // Size hierarchy, and free. A field of cover all at one height reads as a texture; what makes it
  // read as ground is a few knee-high tussocks standing out of the ankle-high mat. Two more
  // ENTRIES on assets the pool already carries, so they share the same mesh and cost nothing.
  { assetId: "grass_common_short", weight: 2.6, scale: [0.62, 1.02], tilt: 0.25 },
  { assetId: "plant_leafy_small", weight: 0.5, scale: [0.8, 1.2], tilt: 0.3 },
  ...SHORE_COVER,
];

/** Vellenwood: shaded woodland floor. Fern and leaf, a third of the grass, mould-brown litter. */
const WOODLAND_COVER: ScatterSpeciesSpec[] = [
  // Fern leads here rather than trailing. 288 triangles, and the only asset in the kit whose
  // silhouette reads as a woodland floor rather than as a lawn.
  { assetId: "fern_1", weight: 3.4, scale: [0.32, 0.68], tilt: 0.9 },
  { assetId: "plant_leafy_small", weight: 2.6, scale: [0.36, 0.68] },
  // A third of Fallowmarch's grass weight. Grass under a closed canopy is patchy and thin, and
  // making it so is most of what separates this floor from that meadow.
  { assetId: "grass_common_short", weight: 4, scale: [0.3, 0.58] },
  // Stone litter carries what leaf mould would if the kit had a leaf-mould asset. 48 and 114
  // triangles, both already instanced by `stones`, so both are free.
  { assetId: "rock_small_2", weight: 2.8, scale: [0.5, 1.5], tilt: 1, sink: 0.05 },
  { assetId: "pebble_round_1", weight: 1.6, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // 880 triangles, so weighted to about 1.5% of the pool. Free in draw calls (`fungus` instances
  // it) and worth its triangles: a buff mushroom against dark green is the one warm note on this
  // floor, and finding them scattered rather than only in `fungus`'s rings is what makes the wood
  // feel walked in.
  { assetId: "mushroom_common", weight: 0.14, scale: [0.5, 1.0], tilt: 0.7 },
  // 360 triangles, free (the `undergrowth` layer instances it), and the mid-height green.
  { assetId: "plant_leafy_large", weight: 0.45, scale: [0.28, 0.5] },
  // The tussock entries, at woodland heights.
  { assetId: "plant_leafy_small", weight: 0.6, scale: [0.8, 1.2], tilt: 0.3 },
  { assetId: "fern_1", weight: 1.2, scale: [0.7, 1.15], tilt: 0.6 },
  ...SHORE_COVER,
];

/** Karrowmoor: thin upland turf on scree. Gold moor grass, short green, twice the loose stone. */
const UPLAND_COVER: ScatterSpeciesSpec[] = [
  // 1.072 m native -> 0.43-0.78 m of dry gold moor grass, rgb(182,159,0) at its own UVs. 494
  // triangles is expensive for cover, which is why it is weighted below the common grass despite
  // being the region's signature colour; free in draw calls because `scrub` already instances it.
  { assetId: "grass_wispy_short", weight: 1.8, scale: [0.4, 0.73], tilt: 0.25 },
  // Short, because upland turf is short. 155 triangles.
  { assetId: "grass_common_short", weight: 8, scale: [0.3, 0.58] },
  { assetId: "plant_leafy_small", weight: 1.3, scale: [0.36, 0.66] },
  // Roughly twice the stone weight of the other two regions, which is the whole read: this is turf
  // growing THROUGH scree rather than turf with a few stones on it. Both free in draw calls.
  { assetId: "rock_small_2", weight: 3.8, scale: [0.5, 1.6], tilt: 1, sink: 0.05 },
  { assetId: "pebble_round_1", weight: 2.2, scale: [0.5, 1.45], tilt: 1, sink: 0.04 },
  // The tussock entry. Gold, because a wind-blown moor tussock is the thing that catches the eye
  // on a grey slope.
  { assetId: "grass_wispy_short", weight: 0.8, scale: [0.62, 1.0], tilt: 0.2 },
  ...SHORE_COVER,
];

/**
 * Low grass stems that buy density without multiplying the mixed cover pools.
 *
 * Keeping these pools grass-only matters. Every pebble, fern and broad plant belongs to the lower
 * volume mixed-cover layers; a field can therefore become dense without multiplying those props.
 */
const MEADOW_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 10, scale: [0.16, 0.36] },
  { assetId: "grass_wispy_short", weight: 1.4, scale: [0.2, 0.38], tilt: 0.2 },
];

const WOODLAND_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 1, scale: [0.15, 0.3] },
];

const UPLAND_BLADES: ScatterSpeciesSpec[] = [
  { assetId: "grass_common_short", weight: 7, scale: [0.14, 0.28] },
  { assetId: "grass_wispy_short", weight: 3, scale: [0.18, 0.36], tilt: 0.2 },
];

/**
 * Pebbles, plus the six previously unused `path_rock_*` assets on roads only.
 *
 * All ten share the `PathRocks` material, so under a material-keyed batch the whole family would be
 * free; under per-asset InstancedMesh each one is another draw call, so the pool is cut to the
 * three cheapest silhouettes and one road stone.
 */
const STONE_SPECIES: ScatterSpeciesSpec[] = [
  { assetId: "pebble_round_1", weight: 4, scale: [0.5, 1.4], tilt: 1, sink: 0.04 },
  // pebble_round_2 is the same 0.4 m rounded stone at 124 triangles against 114 and was dropped:
  // a second near-identical silhouette is another draw call in every region for no read at all.
  { assetId: "rock_small_2", weight: 3, scale: [0.5, 1.5], tilt: 1, sink: 0.05 },
  // 559 triangles, and the cheapest of the six. Road only, and a minority even there. Its siblings
  // cost 998-3500 for a stone the player walks over, and each of them is another draw call.
  { assetId: "path_rock_small_2", weight: 2.4, scale: [0.7, 1.6], tilt: 1, sink: 0.06, sources: ["road"] },
];

// --------------------------------------------------------- region presets

/**
 * Per-region density and species mix.
 *
 * Every id below is picked by hand off a triangle and native-height census of the nature kit, not
 * by tag lookup, because the manifest tag order happens to select the *most* expensive member of
 * each family. Measured, per source asset, all primitives summed:
 *
 * ```text
 *   tree_twisted_1..5   9134 - 10104     tree_dead_1..5      5648 - 6557
 *   tree_common_1..5    3182 -  6265     tree_pine_1..5      1646 - 4964
 *   bush/fern/plant       48 -   1368    grass/clover/flower  155 -  1690
 *   pebble/rock_small     48 -    124    path_rock_*          559 -  3500
 *   boulder/cliff        288 -   1664
 * ```
 *
 * Two facts drive every number here (architecture.md, correction R6):
 *
 *  1. **Draw calls are flat in instance count.** One region-wide `InstancedMesh` costs one draw
 *     whether it holds 20 trees or 2000. Draw calls are set by *species count*, times primitives
 *     per asset (2 for every tree in this kit, trunk plus foliage), times 2 again for a shadow
 *     caster. Cutting density buys none. Cutting species and shadow casters buys all of them.
 *  2. **Triangles are linear in instance count and in per-asset cost.** Those same region-wide
 *     bounding spheres mean nothing is ever frustum-culled, so the whole streamed-in region is
 *     submitted every frame. The only levers are count and species.
 *
 * The first clustered blade fields still left ordinary play cameras between isolated 20 m discs.
 * This pass makes the centre lattice tighter and the discs smaller, then softens the mask so
 * neighbouring accepted centres join into swaths. The offline sampler lands at about 580,000 total
 * placements: 247k Fallowmarch, 173k Vellenwood and 159k Karrowmoor. About 435k are four-triangle
 * blade cards. No new asset bucket or material family was added; the extra draw cost comes only
 * from spatial tiles that were empty before.
 *
 *  Fallowmarch  sparse, long sightlines (PRD, "Look"). Real copses with real gaps between them;
 *               choppable trees are entities, not scatter.
 *  Vellenwood   deep green woodland. Enclosure comes from stands separated by clearings, not from
 *               a uniform gloom of evenly spaced trunks.
 *  Karrowmoor   rock and scrub. Scree belongs on the risers, not on the terrace tops.
 */
export const DEFAULT_SCATTER: Record<RegionId, RegionScatterSpec> = {
  fallowmarch: {
    regionId: "fallowmarch",
    layers: [
      {
        // The cheapest green broadleaf in the kit. Closely spaced centres form a few joined copses,
        // while the 90 m mask keeps long meadow sightlines between them.
        id: "copse",
        assetIds: ["tree_common_5"],
        maxCount: 150, scale: [0.95, 1.6], sizeBias: 1.6,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.45 },
        cluster: { spacing: 38, radius: [14, 28], memberSpacing: 7.5, accept: 0.96, falloff: 0.65, dominance: 0.78 },
        mask: { strength: 0.32, featureSize: 90 },
      },
      {
        // Bare silhouettes against the sky. One species: 12 of them over 132,000 m2 never repeat
        // inside a frame, and a second would cost 2 more draw calls for nothing. Deliberately not
        // clustered — a lone dead tree is a landmark, a stand of them is a swamp.
        id: "deadwood", assetIds: ["tree_dead_5"],
        spacing: 45, maxCount: 12, scale: [0.9, 1.35], sizeBias: 1.4,
        tilt: 0.08, castShadow: true, clearance: 2,
        exclusion: TREE_EXCLUSION,
      },
      {
        // Was 104 instances of `bush_common`, whose only material is `Leaves_TwistedTree` — the
        // red-dominant autumn texture this same file removed from Vellenwood for rendering crimson.
        // It read as magenta blobs on olive grass in every Fallowmarch screenshot. The replacement
        // is `plant_leafy_large` (rgb(107,146,16) at its UVs, 360 triangles against bush_common's
        // 900) and gold moor grass. `bush_flowering` was the obvious swap and is not used: it is
        // 1368 triangles across 2 primitives, i.e. twice the draw cost for one more silhouette.
        id: "bracken",
        species: [
          { assetId: "plant_leafy_large", weight: 3 },
          // 1.672 m native -> 0.84-1.51 m of dry gold moor grass, rgb(182,159,0) at its own UVs.
          { assetId: "grass_wispy_short", weight: 2, scale: [0.8, 1.4], tilt: 0.2 },
        ],
        maxCount: 4200, scale: [0.7, 1.3], tilt: 0.35, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        cluster: { spacing: 12.5, radius: [5, 14], memberSpacing: 1.25, accept: 0.78, falloff: 0.68, dominance: 0.8 },
        mask: { strength: 0.34, featureSize: 58 },
      },
      {
        // Deliberately NOT rock_medium_*: those are the ore-node meshes, and dressing that shares a
        // silhouette with a minable node is half of why ore is unreadable. Clustered into rock
        // fields, biased onto slopes, and extended along the roads as verge gravel.
        id: "stones", species: STONE_SPECIES,
        maxCount: 560, scale: [0.5, 1.3], tilt: 1, sink: 0.05, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.5, steep: 2.2 } },
        cluster: { spacing: 30, radius: [3, 10], memberSpacing: 1.3, accept: 0.42, falloff: 0.8, dominance: 0.5 },
        road: { band: [0.4, 4.6], perMetre: 0.55 },
        shore: { band: [1.5, 12], perMetre: 0.5 },
      },
      {
        // Mixed-height meadow tufts. The small 5.2 m centre spacing joins nearby clumps without
        // turning the field into an even grid; roads, water and authored footprints still thin it.
        id: "groundcover", species: MEADOW_COVER,
        maxCount: 48000, scale: [0.22, 0.46], sizeBias: 1.18, tilt: 0.55, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.2, high: 0.7, flat: 1.35, steep: 0.35 },
          moisture: { reach: 18, boost: 2.5 },
        },
        cluster: { spacing: 5.2, radius: [2.8, 6.6], memberSpacing: 0.48, accept: 0.82, falloff: 0.42, dominance: 0.58 },
        mask: { strength: 0.16, featureSize: 50 },
        road: { band: [2.6, 6.5], perMetre: 2.8 },
        shore: { band: [-0.6, 9], perMetre: 3.6 },
      },
      {
        // The grass floor. Small overlapping discs follow a broad mask, so fields connect across a
        // normal camera view but still break into grazed clearings. Mixed cover supplies accents.
        id: "bladecarpet", species: MEADOW_BLADES,
        maxCount: 190000, scale: [0.16, 0.36], sizeBias: 1.3, tilt: 0.45,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.8, flat: 1.2, steep: 0.35 } },
        cluster: { spacing: 14, radius: [7, 14], memberSpacing: 0.42, accept: 0.96, falloff: 0.28, dominance: 0.84 },
        mask: { strength: 0.52, featureSize: 90 },
      },
      {
        // Colour accents only, as drifts rather than as a lawn. `flower_a_group` is 2.055 m native
        // and was scaled to 1.44-2.47 m in round 1; at [0.28, 0.5] it lands at 0.58-1.03 m.
        id: "bloom",
        assetIds: ["flower_a_single"],
        maxCount: 1400, scale: [0.28, 0.52], tilt: 0.4, mirror: true,
        exclusion: COVER_EXCLUSION,
        cluster: { spacing: 18, radius: [3, 10], memberSpacing: 0.85, accept: 0.58, falloff: 0.72, dominance: 0.85 },
        mask: { strength: 0.48, featureSize: 46 },
      },
    ],
  },

  vellenwood: {
    regionId: "vellenwood",
    layers: [
      {
        // Critique finding 5. The dominant layer used to be the `twisted` family, which is an
        // autumn tree in the source texture: a wood built from it renders crimson and black, and a
        // 0.25-strength retint cannot move a dark red albedo. The dominant canopy is green
        // broadleaf, and also the cheapest green broadleaf: 3344 triangles average against the
        // twisted family's 9596.
        //
        // Enclosure comes from overlapping stands with clearings between them. Broadleaf count is
        // still capped because this shadow-casting layer moves the frame budget faster than grass.
        id: "canopy",
        species: [
          { assetId: "tree_common_3", weight: 3 },
          { assetId: "tree_common_5", weight: 2 },
        ],
        maxCount: 270, scale: [1.05, 1.7], sizeBias: 1.5,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.6 },
        cluster: { spacing: 22, radius: [11, 21], memberSpacing: 5.8, accept: 0.97, falloff: 0.6, dominance: 0.75 },
        mask: { strength: 0.3, featureSize: 78 },
      },
      {
        // tree_pine_5 is 1646 triangles, the cheapest tree in the kit by a factor of two, so
        // conifers carry count where broadleaves cannot. One species: a stand of a single conifer
        // is what real conifers look like, and it saves 4 draw calls. Biased uphill, because a
        // pine stand on the shoulder above a broadleaf hollow is free legibility.
        id: "conifer", assetIds: ["tree_pine_5"],
        maxCount: 220, scale: [1.0, 1.9], sizeBias: 1.5,
        tilt: 0.1, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.8, slopeBias: { low: 0.2, high: 0.6, flat: 0.75, steep: 1.6 } },
        cluster: { spacing: 20, radius: [9, 17], memberSpacing: 4.6, accept: 0.92, falloff: 0.65, dominance: 1 },
        mask: { strength: 0.3, featureSize: 70 },
      },
      {
        // The red tree survives as an accent, not as the wood. Sixteen across 70,300 m2 is a
        // handful per frame: a few autumn crowns in a green wood is deliberate art direction, and
        // at 9134 triangles each that is 0.29M instead of 1.9M. Not clustered, and scaled up hard,
        // so each one reads as an individual worth walking toward.
        id: "duskoak", assetIds: ["tree_twisted_2"],
        spacing: 44, maxCount: 16, scale: [1.35, 2.15], sizeBias: 1.3,
        tilt: 0.06, castShadow: true, clearance: 3,
        exclusion: TREE_EXCLUSION,
      },
      {
        // PRD: "ground clutter kept low so pathing stays legible" — so it is clustered rather than
        // spread, which keeps the corridors between clumps walkable-looking.
        //
        // `bush_common` is deliberately absent even though it is the cheapest volume in the kit:
        // it shares `Leaves_TwistedTree` with the autumn tree and put a crimson mass at eye height
        // across the whole wood. `plant_broad_large` is NOT the green replacement this file used to
        // claim it was - it is rgb(184,63,27) at its own UVs, redder than the bush it replaced - so
        // the volume comes from ferns and the two leafy plants instead.
        id: "undergrowth",
        species: [
          { assetId: "fern_1", weight: 4, scale: [0.7, 1.5], tilt: 0.8 },
          { assetId: "plant_leafy_large", weight: 2 },
          { assetId: "plant_leafy_small", weight: 3, scale: [0.5, 1.1] },
        ],
        maxCount: 6200, scale: [0.8, 1.55], tilt: 0.5, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        cluster: { spacing: 7.5, radius: [3.5, 10], memberSpacing: 1.1, accept: 0.82, falloff: 0.62, dominance: 0.72 },
        mask: { strength: 0.27, featureSize: 48 },
      },
      {
        // mushroom_bracket is 3216 triangles, more than a whole tree_common_5, for a prop the
        // player only ever sees from four metres. mushroom_common is 880, and in tight rings of
        // 6-10 it reads as a fairy ring rather than as scattered litter.
        id: "fungus", assetIds: ["mushroom_common"],
        maxCount: 220, scale: [0.7, 1.4], tilt: 0.7, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: { moisture: { reach: 22, boost: 2 } },
        cluster: { spacing: 32, radius: [1.2, 3.2], memberSpacing: 0.75, accept: 0.8, falloff: 0.6, dominance: 1 },
        mask: { strength: 0.4, featureSize: 50 },
      },
      {
        id: "stones", species: STONE_SPECIES,
        maxCount: 400, scale: [0.5, 1.3], tilt: 1, sink: 0.06, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.6, steep: 2 } },
        cluster: { spacing: 28, radius: [3, 9], memberSpacing: 1.4, accept: 0.6, falloff: 0.8, dominance: 0.5 },
        road: { band: [0.4, 4.6], perMetre: 0.5 },
        shore: { band: [1.5, 10], perMetre: 0.4 },
      },
      {
        // Fern and leaf rather than turf, and clumpier than the meadow: a woodland floor is a
        // mosaic of dense patches under the gaps and near-bare ground under a closed crown, which
        // is what the lower `accept` and the stronger mask buy.
        id: "groundcover", species: WOODLAND_COVER,
        maxCount: 38000, scale: [0.22, 0.45], sizeBias: 1.18, tilt: 0.55, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.2, high: 0.75, flat: 1.3, steep: 0.4 },
          moisture: { reach: 18, boost: 2.5 },
        },
        cluster: { spacing: 4.9, radius: [2.5, 6.2], memberSpacing: 0.5, accept: 0.82, falloff: 0.48, dominance: 0.6 },
        mask: { strength: 0.22, featureSize: 46 },
        road: { band: [2.6, 6.5], perMetre: 2.8 },
        shore: { band: [-0.6, 9], perMetre: 3.2 },
      },
      {
        // Broad but broken shade-grass fields. Ferns, stones and leaf plants stay in the sparse
        // mixed layers above, so the denser local spacing buys stems without cluttering paths.
        id: "bladecarpet", species: WOODLAND_BLADES,
        maxCount: 125000, scale: [0.15, 0.3], sizeBias: 1.35, tilt: 0.5,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.85, flat: 1.1, steep: 0.35 } },
        cluster: { spacing: 12.5, radius: [7, 13], memberSpacing: 0.43, accept: 0.94, falloff: 0.34, dominance: 1 },
        mask: { strength: 0.64, featureSize: 76 },
      },
    ],
  },

  karrowmoor: {
    regionId: "karrowmoor",
    layers: [
      {
        // The terrain already supplies the terraces. The old platformer boulder/cliff pair was
        // cheap, but its broad untextured faces filled the foreground and hid those terraces in
        // the authored shot. These textured rocks are already loaded by the stone layer, so the
        // crags retain their clustered silhouette without adding a material family or a draw call.
        id: "crags",
        species: [
          // Species scale composes with the layer's 0.8..1.8 band. Keep the product below 2.25:
          // larger values turn a crag on the first riser into the entire foreground.
          { assetId: "rock_medium_1", weight: 3, scale: [0.75, 1.25] },
          { assetId: "rock_medium_2", weight: 2, scale: [0.7, 1.2] },
          { assetId: "rock_medium_3", weight: 2, scale: [0.65, 1.15] },
        ],
        maxCount: 180, scale: [0.8, 1.8], sizeBias: 1.8, mirror: true,
        tilt: 0.3, sink: 0.6, castShadow: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.5, steep: 2.4 } },
        cluster: { spacing: 26, radius: [9, 18], memberSpacing: 4.6, accept: 0.85, falloff: 0.7, dominance: 0.6 },
        mask: { strength: 0.25, featureSize: 80 },
      },
      {
        // Same cheapest-pine argument as Vellenwood. Wind-stunted here, so the scale band is low,
        // and banded to the middle of the region's 62 m amplitude: no pines on the tarn shore and
        // none on the summit.
        id: "cairnpine", assetIds: ["tree_pine_5"],
        maxCount: 175, scale: [0.75, 1.2], sizeBias: 1.5,
        tilt: 0.12, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.62, altitude: [0.06, 0.88], altitudeFade: 6 },
        cluster: { spacing: 24, radius: [8, 16], memberSpacing: 5.2, accept: 0.8, falloff: 0.7, dominance: 1 },
        mask: { strength: 0.35, featureSize: 74 },
      },
      {
        id: "windfall", assetIds: ["tree_dead_5"],
        spacing: 40, maxCount: 14, scale: [0.7, 1.05], sizeBias: 1.4,
        tilt: 0.1, castShadow: true, clearance: 2,
        exclusion: TREE_EXCLUSION,
      },
      {
        // Scree wants to be dense to read as scree, and at ~100 triangles a stone it can be. The
        // x4 slope bias is what round 1 was missing: `scree` had no slope rule at all, so the grey
        // terrace tops carried the same stone density as the risers.
        id: "scree", species: STONE_SPECIES,
        maxCount: 1400, scale: [0.45, 1.4], sizeBias: 2, tilt: 1, sink: 0.06, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.15, steep: 4 } },
        cluster: { spacing: 17, radius: [4, 13], memberSpacing: 1.2, accept: 0.7, falloff: 0.8, dominance: 0.45 },
        road: { band: [0.4, 4.6], perMetre: 0.5 },
        shore: { band: [1.2, 9], perMetre: 0.5 },
      },
      {
        // Was 134 instances of `bush_common` and the same red-material problem as Fallowmarch's
        // bracken. `plant_leafy_small` is 120 triangles against bush_common's 900, and green.
        id: "scrub",
        species: [
          { assetId: "plant_leafy_small", weight: 3 },
          // Dry gold moor grass, rgb(182,159,0). The `plant_broad_large` that used to sit here is
          // rgb(184,63,27) - the same red the `bush_common` swap was made to get rid of.
          { assetId: "grass_wispy_short", weight: 3, scale: [0.7, 1.3], tilt: 0.2 },
        ],
        maxCount: 3600, scale: [0.6, 1.15], tilt: 0.5, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.7, flat: 1.2, steep: 0.5 } },
        cluster: { spacing: 10.5, radius: [4, 12], memberSpacing: 1.25, accept: 0.78, falloff: 0.68, dominance: 0.72 },
        mask: { strength: 0.34, featureSize: 58 },
      },
      {
        // Upland turf stays rougher than the meadow: wider member spacing, more loose stone and a
        // stronger mask. It should read as plants growing through scree, not as a lawn on a hill.
        id: "groundcover", species: UPLAND_COVER,
        maxCount: 32000, scale: [0.2, 0.42], sizeBias: 1.18, tilt: 0.6, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.25, high: 0.8, flat: 1.3, steep: 0.45 },
          moisture: { reach: 16, boost: 2.5 },
        },
        cluster: { spacing: 5.2, radius: [2.3, 5.8], memberSpacing: 0.56, accept: 0.8, falloff: 0.52, dominance: 0.6 },
        mask: { strength: 0.28, featureSize: 46 },
        road: { band: [2.6, 6.5], perMetre: 2.5 },
        shore: { band: [-0.6, 8], perMetre: 2.3 },
      },
      {
        // Wind-short moor fields, still thinner than the meadow. The broad mask leaves connected
        // turf on terrace tops and real gaps on the risers instead of gold stems peppered everywhere.
        id: "bladecarpet", species: UPLAND_BLADES,
        maxCount: 120000, scale: [0.14, 0.35], sizeBias: 1.35, tilt: 0.55,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.78, flat: 1.15, steep: 0.25 } },
        cluster: { spacing: 13, radius: [7, 13.5], memberSpacing: 0.45, accept: 0.92, falloff: 0.38, dominance: 0.72 },
        mask: { strength: 0.62, featureSize: 86 },
      },
    ],
  },

  // Ember foothills: SPARSE burned woodland over warm dark soil. The counts are deliberately
  // below Karrowmoor's — the region reads as ground the fire has already been through, so open
  // space is the point, and the draw-call budget for the new northern band stays comfortable.
  kilnhalt: {
    regionId: "kilnhalt",
    layers: [
      {
        // The survivors: twisted silhouettes matching the Cinderpine cluster's vocabulary, with
        // dead spars mixed through. Sparse spacing so single trees read against the sky.
        id: "burnwood",
        species: [
          { assetId: "tree_twisted_3", weight: 3, scale: [0.8, 1.2] },
          { assetId: "tree_twisted_4", weight: 2, scale: [0.75, 1.15] },
          { assetId: "tree_dead_2", weight: 2, scale: [0.7, 1.1] },
          { assetId: "tree_dead_4", weight: 1, scale: [0.7, 1.05] },
        ],
        maxCount: 120, scale: [0.8, 1.3], sizeBias: 1.5,
        tilt: 0.12, castShadow: true, mirror: true,
        exclusion: TREE_EXCLUSION,
        terrain: { slopeMax: 0.6, altitude: [0.05, 0.9], altitudeFade: 6 },
        cluster: { spacing: 34, radius: [9, 18], memberSpacing: 6.5, accept: 0.72, falloff: 0.7, dominance: 1 },
        mask: { strength: 0.4, featureSize: 88 },
      },
      {
        // Dark foothill outcrops, the same textured rock family every region shares.
        id: "ember_crags",
        species: [
          { assetId: "rock_medium_3", weight: 3, scale: [0.7, 1.2] },
          { assetId: "rock_medium_1", weight: 2, scale: [0.7, 1.2] },
        ],
        maxCount: 150, scale: [0.8, 1.7], sizeBias: 1.7, mirror: true,
        tilt: 0.3, sink: 0.55, castShadow: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.55, steep: 2.2 } },
        cluster: { spacing: 28, radius: [9, 17], memberSpacing: 4.8, accept: 0.82, falloff: 0.7, dominance: 0.6 },
        mask: { strength: 0.28, featureSize: 78 },
      },
      {
        // Clinker and loose dark stone on the slopes, thinner than Karrowmoor scree.
        id: "clinker", species: STONE_SPECIES,
        maxCount: 900, scale: [0.4, 1.2], sizeBias: 1.9, tilt: 1, sink: 0.06, mirror: true,
        exclusion: LITTER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.55, flat: 0.2, steep: 3.4 } },
        cluster: { spacing: 19, radius: [4, 12], memberSpacing: 1.3, accept: 0.7, falloff: 0.8, dominance: 0.45 },
        road: { band: [0.4, 4.6], perMetre: 0.4 },
        shore: { band: [1.2, 9], perMetre: 0.4 },
      },
      {
        // Dry gold brush between the burns; the wispy grass carries the region's warm read.
        id: "dry_scrub",
        species: [
          { assetId: "grass_wispy_short", weight: 4, scale: [0.7, 1.3], tilt: 0.2 },
          { assetId: "plant_leafy_small", weight: 2 },
        ],
        maxCount: 3000, scale: [0.6, 1.15], tilt: 0.5, mirror: true,
        exclusion: SHRUB_EXCLUSION,
        terrain: { slopeBias: { low: 0.3, high: 0.7, flat: 1.2, steep: 0.5 } },
        cluster: { spacing: 11.5, radius: [4, 12], memberSpacing: 1.3, accept: 0.76, falloff: 0.68, dominance: 0.7 },
        mask: { strength: 0.38, featureSize: 62 },
      },
      {
        // Sparse warm groundcover: plants coming back through ash, not a lawn.
        id: "groundcover", species: UPLAND_COVER,
        maxCount: 24000, scale: [0.2, 0.4], sizeBias: 1.15, tilt: 0.6, mirror: true,
        exclusion: COVER_EXCLUSION,
        terrain: {
          slopeBias: { low: 0.25, high: 0.8, flat: 1.25, steep: 0.45 },
          moisture: { reach: 16, boost: 2.4 },
        },
        cluster: { spacing: 5.6, radius: [2.3, 5.6], memberSpacing: 0.6, accept: 0.78, falloff: 0.52, dominance: 0.58 },
        mask: { strength: 0.34, featureSize: 50 },
        road: { band: [2.6, 6.5], perMetre: 2.3 },
        shore: { band: [-0.6, 8], perMetre: 2.1 },
      },
      {
        // Thin dry blade fields with strong masking, so bare warm soil stays visible in patches.
        id: "bladecarpet", species: UPLAND_BLADES,
        maxCount: 90000, scale: [0.14, 0.33], sizeBias: 1.3, tilt: 0.55,
        exclusion: COVER_EXCLUSION,
        terrain: { slopeBias: { low: 0.25, high: 0.78, flat: 1.1, steep: 0.25 } },
        cluster: { spacing: 14, radius: [7, 13], memberSpacing: 0.48, accept: 0.9, falloff: 0.38, dominance: 0.7 },
        mask: { strength: 0.68, featureSize: 92 },
      },
    ],
  },

  // Underground. Dressed by hand from the dungeon kit in a later round; scattering rubble in a
  // corridor produces nonsense.
  gravelmaw: { regionId: "gravelmaw", layers: [] },
};

// World composition follows the area's woodcutting level. All future species stay in the pool,
// with exponentially smaller encounter weights; no player's changing skill changes the forest.
for (const [regionId, areaLevel] of [["fallowmarch", 1], ["vellenwood", 5], ["karrowmoor", 10], ["kilnhalt", 20]] as const) {
  for (const layer of DEFAULT_SCATTER[regionId].layers) {
    const ids = layer.species?.map(entry => entry.assetId) ?? layer.assetIds ?? [];
    const living = (id: string) => /^tree_(common|pine|twisted)_/.test(id);
    if (!ids.some(living)) continue;
    const original = layer.species ?? ids.map(assetId => ({ assetId, weight: 1 }));
    const livingWeight = original.filter(entry => living(entry.assetId)).reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
    const total = TREE_SPECIES.reduce((sum, species) => sum + treeEncounterWeight(species, areaLevel), 0);
    layer.species = [...original.filter(entry => !living(entry.assetId)), ...TREE_SPECIES.flatMap(species => treeAssetIds(species).map(assetId => ({
      assetId, weight: livingWeight * treeEncounterWeight(species, areaLevel) / (total * species.variants),
      scale: [.64, 1.08] as [number, number], tilt: 0,
    })))];
    delete layer.assetIds;
  }
}
