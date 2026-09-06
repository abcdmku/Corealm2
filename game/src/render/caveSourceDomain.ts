import type { BufferGeometry } from 'three';

/**
 * Smooth global coordinate variation changes where the real scan is sampled, never its amplitude.
 *
 * Adjacent 3.9 m x 3.38 m tiles repeat the periodic scan grid, so the warp has to move the sampling
 * point by a different amount on each tile. The first V7 coefficients only used 20-32 m wavelengths;
 * neighbouring tiles then received almost the same offset wherever those long waves were flat, and
 * about one tile pair in ten stayed a near copy (correlation above 0.6). A third, shorter wave in each
 * axis breaks those plateaus while the summed slope stays below the fold limit: the sampling Jacobian
 * determinant remains above 0.2 across the authored Gravelmaw extents for wall and roof frames.
 */
export function caveSourceCoordinates(u: number, v: number, x: number, y: number, z: number): [number, number] {
  return [u + 0.95 * Math.sin(0.211 * x + 0.139 * z + 0.17 * y)
    + 0.50 * Math.sin(0.353 * z - 0.181 * x + 0.23 * y)
    + 0.30 * Math.sin(0.47 * x + 0.29 * z - 0.47 * y),
  v + 0.75 * Math.sin(0.191 * x - 0.251 * z + 0.26 * y)
    + 0.36 * Math.cos(0.331 * x + 0.211 * z - 0.29 * y)
    + 0.27 * Math.sin(0.27 * x + 0.43 * z + 0.55 * y)];
}

/** Bilinear lookup in the staged, periodic scan-derived grid. Adjacent surfaces share one domain. */
export function caveEnvelopeSampler(geometry: BufferGeometry, columns: number, rows: number): (u: number, v: number) => number {
  const positions = geometry.getAttribute('position');
  if (positions.count !== (columns + 1) * (rows + 1)) throw new Error('Unexpected cave envelope grid');
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, width = bounds.max.x - bounds.min.x, height = bounds.max.y - bounds.min.y;
  return (u, v) => {
    const x = (((u - bounds.min.x) % width + width) % width) / width * columns;
    const y = (((v - bounds.min.y) % height + height) % height) / height * rows;
    const column = Math.floor(x), row = Math.floor(y), dx = x - column, dy = y - row;
    const a = positions.getZ(row * (columns + 1) + column), b = positions.getZ(row * (columns + 1) + column + 1);
    const c = positions.getZ((row + 1) * (columns + 1) + column), d = positions.getZ((row + 1) * (columns + 1) + column + 1);
    return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
  };
}
