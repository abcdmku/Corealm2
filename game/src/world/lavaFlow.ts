import { lavaSections, sampleLavaChannel, type LavaChannel } from '../content/wildernessLava.js';

/** One velocity field for overlapping ribbons, so joined channels advect the same crust. */
export function buildLavaFlowField(channels: readonly LavaChannel[], height: (x: number, z: number) => number) {
  const paths = channels.map(channel => {
    const rows = lavaSections(channel, .55);
    const first = rows[0]!, last = rows.at(-1)!;
    const drop = height(first.x, first.z) - height(last.x, last.z);
    const fallback = Math.abs(drop) > .08 ? Math.sign(drop) : channel.openEnds?.[0] ? -1 : 1;
    const velocity = rows.map((row, i) => {
      const a = rows[Math.max(0, i - 5)]!, b = rows[Math.min(rows.length - 1, i + 5)]!;
      const fall = height(a.x, a.z) - height(b.x, b.z);
      const direction = Math.abs(fall) > .035 ? Math.sign(fall) : fallback;
      return [row.tx * direction, row.tz * direction] as const;
    });
    const margin = channel.halfWidth * 1.25 + 2;
    return { channel, rows, velocity,
      minX: Math.min(...rows.map(r => r.x)) - margin, maxX: Math.max(...rows.map(r => r.x)) + margin,
      minZ: Math.min(...rows.map(r => r.z)) - margin, maxZ: Math.max(...rows.map(r => r.z)) + margin };
  });
  return (x: number, z: number): readonly [number, number] => {
    let vx = 0, vz = 0, total = 0;
    for (const path of paths) {
      if (x < path.minX || x > path.maxX || z < path.minZ || z > path.maxZ) continue;
      const sample = sampleLavaChannel(path.channel, x, z);
      if (sample.signedDistance > 1.5) continue;
      const index = sample.progress * (path.rows.length - 1);
      const i = Math.floor(index), t = index - i;
      const a = path.velocity[i]!, b = path.velocity[Math.min(i + 1, path.velocity.length - 1)]!;
      const weight = Math.max(.01, 1 - Math.max(0, sample.signedDistance) / 1.5)
        * Math.max(.2, sample.halfWidth);
      vx += (a[0] + (b[0] - a[0]) * t) * weight;
      vz += (a[1] + (b[1] - a[1]) * t) * weight;
      total += weight;
    }
    // Preserve slowing where currents meet instead of normalizing a near-zero vector.
    return total ? [vx / total, vz / total] : [0, 0];
  };
}
