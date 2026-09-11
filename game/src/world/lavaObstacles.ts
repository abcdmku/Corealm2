import type { SolidVolume } from '../contracts.js';
import { lavaCollisionSegments, type LavaChannel } from '../content/wildernessLava.js';

/** The molten footprint is impassable. Terrain and visible banks use this same centreline. */
export function lavaObstacles(channels: readonly LavaChannel[], groundHeightAt: (x: number, z: number) => number): SolidVolume[] {
  const solids: SolidVolume[] = [];
  for (const channel of channels) {
    for (const [i, segment] of lavaCollisionSegments(channel).entries()) {
      const [ax, az] = segment.from, [bx, bz] = segment.to;
      const x = (ax + bx) / 2, z = (az + bz) / 2;
      const y = Math.min(groundHeightAt(ax, az), groundHeightAt(bx, bz)) - .5;
      solids.push({ kind: 'box', id: `lava:${channel.id}:${i}`, position: [x, y, z],
        size: [segment.radius * 2, 6, Math.hypot(bx - ax, bz - az) + .15], rotationY: Math.atan2(bx - ax, bz - az) });
      solids.push({ kind: 'cylinder', id: `lava:${channel.id}:${i}:joint`, position: [ax, y, az], radius: segment.radius, height: 6 });
    }
  }
  return solids;
}
