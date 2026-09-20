import type { RegionId, Vec3 } from "../contracts.js";
import { clamp } from "../core/math.js";
import type { Rect, WaterBodySnapshot } from "../render/scene.js";

/**
 * Ground queries over plain data.
 *
 * `WorldScene` builds the terrain lattice and answers these questions for the client. The server asks
 * the same questions from a baked world pack, with no renderer loaded. The grid read and the two
 * geometry helpers below are the ones `WorldScene` itself calls, so both sides walk one surface.
 */

/** Positive inside the rect, negative outside, in metres. */
export function signedDepth(rect: Rect, x: number, z: number): number {
  const qx = Math.max(rect.minX - x, x - rect.maxX);
  const qz = Math.max(rect.minZ - z, z - rect.maxZ);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inside = Math.min(Math.max(qx, qz), 0);
  return -(outside + inside);
}

export function pointInContour(x: number, z: number, contour: readonly (readonly [number, number])[]): boolean {
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

/** A row-major height grid. Coordinates outside its rectangle clamp to it. */
export interface HeightGrid {
  heights: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  stepX: number;
  stepZ: number;
}

/** Triangle read of a height grid. PlaneGeometry and the coast split each quad along h10--h01. */
export function sampleHeightGrid(heights: Float32Array, cols: number, rows: number, minX: number, minZ: number,
  stepX: number, stepZ: number, x: number, z: number): number {
  const fx = clamp((x - minX) / stepX, 0, cols - 1);
  const fz = clamp((z - minZ) / stepZ, 0, rows - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, cols - 1);
  const z1 = Math.min(z0 + 1, rows - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = heights[z0 * cols + x0]!;
  const h10 = heights[z0 * cols + x1]!;
  const h01 = heights[z1 * cols + x0]!;
  const h11 = heights[z1 * cols + x1]!;
  return tx + tz <= 1
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

/** Everything a `TerrainSampler` reads. `WorldScene.terrainSamplerData()` produces it from a built terrain. */
export interface TerrainSamplerData {
  /** The playable core. The coast collar lies outside it. */
  bounds: Rect;
  coast: { collar: number; seaLevel: number } | null;
  /** Region rects in field order. `regionAt` keeps the first of two equally deep rects. */
  regions: { regionId: RegionId; rect: Rect }[];
  lattice: HeightGrid;
  /** The shared coastal grid that continues the ground past `bounds`. Present exactly when `coast` is. */
  coastGrid: HeightGrid | null;
  waterBodies: WaterBodySnapshot[];
  roads: Vec3[][];
}

/** What placing a body on the ground asks. `WorldScene` and `TerrainSampler` both answer it. */
export interface PlacementTerrain {
  meshHeightAt(x: number, z: number): number;
  placementSurfaceAt(x: number, z: number): { height: number; slope: number; semanticRegion: RegionId; waterBodyId: string | null } | null;
}

/** The part of `WorldScene.sampleWorld` the simulation reads. */
export interface GroundSample {
  playable: boolean;
  height: number;
  slope: number | null;
  semanticRegion: RegionId;
  waterBodyId: string | null;
  coast: { seaLevel: number } | null;
}

export class TerrainSampler implements PlacementTerrain {
  constructor(private readonly data: TerrainSamplerData) {
    if (Boolean(data.coast) !== Boolean(data.coastGrid)) throw new Error("Terrain sampler needs a coast grid exactly when the terrain has a coast");
    if (data.regions.length === 0) throw new Error("Terrain sampler needs at least one region");
  }

  getWorldBounds(): Rect { return { ...this.data.bounds }; }

  /** The whole sampled extent: the core plus the coast collar. */
  getExtent(): Rect {
    const { bounds, coast } = this.data, collar = Math.max(0, coast?.collar ?? 0);
    return { minX: bounds.minX - collar, maxX: bounds.maxX + collar, minZ: bounds.minZ - collar, maxZ: bounds.maxZ + collar };
  }

  contains(x: number, z: number): boolean {
    const extent = this.getExtent();
    return x >= extent.minX && x <= extent.maxX && z >= extent.minZ && z <= extent.maxZ;
  }

  getWaterBodies(): WaterBodySnapshot[] { return this.data.waterBodies; }
  getRoadPolylines(): Vec3[][] { return this.data.roads; }

  private lattice(x: number, z: number): number {
    const grid = this.data.lattice;
    return sampleHeightGrid(grid.heights, grid.cols, grid.rows, grid.minX, grid.minZ, grid.stepX, grid.stepZ, x, z);
  }

  private coastGrid(x: number, z: number): number | null {
    const grid = this.data.coastGrid;
    return grid ? sampleHeightGrid(grid.heights, grid.cols, grid.rows, grid.minX, grid.minZ, grid.stepX, grid.stepZ, x, z) : null;
  }

  heightAt(_regionId: RegionId, x: number, z: number): number { return this.meshHeightAt(x, z); }

  meshHeightAt(x: number, z: number): number {
    const bounds = this.data.bounds;
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return this.coastGrid(x, z) ?? this.lattice(x, z);
    return this.lattice(x, z);
  }

  /** Unit surface normal of the drawn ground. Central difference on the lattice, as the renderer does it. */
  normalAt(x: number, z: number): Vec3 {
    const step = this.data.lattice.stepX;
    const dx = (this.lattice(x + step, z) - this.lattice(x - step, z)) / (2 * step);
    const dz = (this.lattice(x, z + step) - this.lattice(x, z - step)) / (2 * step);
    const length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  }

  slopeAt(x: number, z: number, step = 1.5): number {
    const dx = (this.meshHeightAt(x + step, z) - this.meshHeightAt(x - step, z)) / (2 * step);
    const dz = (this.meshHeightAt(x, z + step) - this.meshHeightAt(x, z - step)) / (2 * step);
    return Math.hypot(dx, dz);
  }

  regionAt(x: number, z: number): RegionId {
    let best = this.data.regions[0]!;
    let bestDepth = -Infinity;
    for (const region of this.data.regions) {
      const depth = signedDepth(region.rect, x, z);
      if (depth > bestDepth) { bestDepth = depth; best = region; }
    }
    return best.regionId;
  }

  private waterBodyAt(x: number, z: number, height: number): string | null {
    return this.data.waterBodies.find(body => body.closed && (!body.id.startsWith("river:") || height < body.level + .01)
      && pointInContour(x, z, body.contour))?.id ?? null;
  }

  placementSurfaceAt(x: number, z: number): { height: number; slope: number; semanticRegion: RegionId; waterBodyId: string | null } | null {
    const { bounds, coast } = this.data;
    const dx = Math.max(bounds.minX - x, 0, x - bounds.maxX);
    const dz = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);
    const outsideDistance = Math.hypot(dx, dz);
    const height = this.meshHeightAt(x, z);
    if (outsideDistance > 0.000_001 && !(coast && outsideDistance <= coast.collar && height >= coast.seaLevel)) return null;
    return { height, slope: this.slopeAt(x, z), semanticRegion: this.regionAt(x, z), waterBodyId: this.waterBodyAt(x, z, height) };
  }

  sampleWorld(x: number, z: number): GroundSample {
    const { bounds, coast } = this.data;
    const boundaryX = clamp(x, bounds.minX, bounds.maxX);
    const boundaryZ = clamp(z, bounds.minZ, bounds.maxZ);
    const outsideDistance = Math.hypot(x - boundaryX, z - boundaryZ);
    const core = outsideDistance <= 0.000_001;
    const playable = core || Boolean(coast && outsideDistance <= coast.collar && this.meshHeightAt(x, z) >= coast.seaLevel);
    const height = playable ? this.meshHeightAt(x, z)
      : coast ? Math.max(this.coastGrid(x, z)!, coast.seaLevel) : this.meshHeightAt(boundaryX, boundaryZ);
    return { playable, height, slope: playable ? this.slopeAt(x, z) : null, semanticRegion: this.regionAt(x, z),
      waterBodyId: this.waterBodyAt(x, z, height), coast: coast ? { seaLevel: coast.seaLevel } : null };
  }
}
