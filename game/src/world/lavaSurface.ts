import { lavaBedAt, lavaSections, sampleLavaChannel, type LavaChannel } from '../content/wildernessLava.js';

/** A free surface above the bed, not a coating copied from the terrain triangles. */
export function buildLavaSurfaceField(channels: readonly LavaChannel[], ground: (x: number, z: number) => number) {
  const paths = channels.filter(c => c.bedHeights).map(channel => {
    const rows = lavaSections(channel);
    const margin = Math.max(...rows.map(row => row.halfWidth)) + 1;
    return { channel, minX: Math.min(...rows.map(row => row.x)) - margin,
      maxX: Math.max(...rows.map(row => row.x)) + margin,
      minZ: Math.min(...rows.map(row => row.z)) - margin,
      maxZ: Math.max(...rows.map(row => row.z)) + margin };
  });
  return (x: number, z: number): number => {
    let surface = Infinity;
    for (const path of paths) {
      if (x < path.minX || x > path.maxX || z < path.minZ || z > path.maxZ) continue;
      const sample = sampleLavaChannel(path.channel, x, z);
      if (sample.signedDistance > .3) continue;
      surface = Math.min(surface, lavaBedAt(path.channel, sample.centreProgress)! + 1.04);
    }
    return Number.isFinite(surface) ? surface : ground(x, z) + .16;
  };
}
