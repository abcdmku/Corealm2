import type { BufferGeometry } from 'three';

/** Smooth global coordinate variation changes where the real scan is sampled, never its amplitude. */
export function caveSourceCoordinates(u: number, v: number, x: number, y: number, z: number): [number, number] {
  return [u + 1.15 * Math.sin(0.193 * x + 0.127 * z + 0.12 * y)
    + 0.55 * Math.sin(0.311 * z - 0.163 * x + 0.11 * y),
  v + 0.85 * Math.sin(0.173 * x - 0.229 * z + 0.18 * y)
    + 0.40 * Math.cos(0.307 * x + 0.191 * z - 0.16 * y)];
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
