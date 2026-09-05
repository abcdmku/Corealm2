/** The completed coastal mesh grid, ordered by increasing X within increasing Z rows. */
export interface OceanDepthGrid {
  heights: Float32Array;
  cols: number;
  rows: number;
  minX: number;
  minZ: number;
  stepX: number;
  stepZ: number;
}

/** Reject malformed fields before they can produce invalid texture reads or shader uniforms. */
export function oceanDepthGridBounds(grid: OceanDepthGrid): { maxX: number; maxZ: number } {
  if (!Number.isSafeInteger(grid.cols) || grid.cols < 2
    || !Number.isSafeInteger(grid.rows) || grid.rows < 2
    || !Number.isSafeInteger(grid.cols * grid.rows)
    || !(grid.heights instanceof Float32Array)
    || grid.heights.length !== grid.cols * grid.rows) {
    throw new RangeError("Ocean depth grid requires at least 2 by 2 matching float heights");
  }
  if (![grid.minX, grid.minZ, grid.stepX, grid.stepZ].every((value) => Number.isFinite(Math.fround(value)))
    || grid.stepX <= 0 || grid.stepZ <= 0
    || Math.fround(grid.stepX) <= 0 || Math.fround(grid.stepZ) <= 0) {
    throw new RangeError("Ocean depth grid requires finite origins and positive finite spacing");
  }
  const maxX = grid.minX + (grid.cols - 1) * grid.stepX;
  const maxZ = grid.minZ + (grid.rows - 1) * grid.stepZ;
  if (!Number.isFinite(Math.fround(maxX)) || !Number.isFinite(Math.fround(maxZ))
    || Math.fround(maxX) <= Math.fround(grid.minX)
    || Math.fround(maxZ) <= Math.fround(grid.minZ)) {
    throw new RangeError("Ocean depth grid requires finite, nonempty world bounds");
  }
  if (!grid.heights.every(Number.isFinite)) {
    throw new RangeError("Ocean depth grid heights must be finite");
  }
  return { maxX, maxZ };
}
