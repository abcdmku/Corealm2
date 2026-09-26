import { signedDepth } from '../world/terrainSampler.js';

interface RegionBounds { bounds: { min: readonly [number, number]; max: readonly [number, number] } }

/** Match terrain regionAt: deepest containing rectangle, otherwise nearest, through coastal land. */
export function regionForPoint<T extends RegionBounds>(regions: readonly T[], x: number, z: number): T | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  let best: T | undefined, bestDepth = -Infinity;
  for (const region of regions) {
    const { min, max } = region.bounds;
    const depth = signedDepth({ minX: min[0], maxX: max[0], minZ: min[1], maxZ: max[1] }, x, z);
    if (depth > bestDepth) { best = region; bestDepth = depth; }
  }
  return best;
}
