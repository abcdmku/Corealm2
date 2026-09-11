import { lavaBedAt, lavaSections, sampleLavaChannel, type LavaChannel } from '../content/wildernessLava.js';

/** Transport coordinates are fixed to the channel. Only the longitudinal coordinate
 * advances with time, so bends cannot stretch the crust indefinitely during a session. */
export function buildLavaTextureField(channels: readonly LavaChannel[], height: (x: number, z: number) => number) {
  const paths = channels.map(channel => {
    const rows = lavaSections(channel, .55), first = rows[0]!, last = rows.at(-1)!;
    const drop = (lavaBedAt(channel, 0) ?? height(first.x, first.z))
      - (lavaBedAt(channel, 1) ?? height(last.x, last.z));
    const direction = Math.abs(drop) > .08 ? Math.sign(drop) : channel.openEnds?.[0] ? -1 : 1;
    const margin = Math.max(...rows.map(r => r.halfWidth)) + 4;
    return { channel, rows, direction, offset: [0, 0], longScale: 1, crossDrift: 0, parent: -1,
      minX: Math.min(...rows.map(r => r.x)) - margin, maxX: Math.max(...rows.map(r => r.x)) + margin,
      minZ: Math.min(...rows.map(r => r.z)) - margin, maxZ: Math.max(...rows.map(r => r.z)) + margin };
  });
  const raw = (index: number, x: number, z: number): readonly [number, number] => {
    const path = paths[index]!;
    const station = sampleLavaChannel(path.channel, x, z).centreProgress * (path.rows.length - 1);
    const i = Math.floor(station), t = station - i;
    const a = path.rows[i]!, b = path.rows[Math.min(i + 1, path.rows.length - 1)]!;
    const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    return [((x - cx) * -tz + (z - cz) * tx) * path.direction + path.offset[0]!
      + station / (path.rows.length - 1) * path.crossDrift,
      (a.distance + (b.distance - a.distance) * t) * path.direction * path.longScale + path.offset[1]!];
  };
  const coordinate = (index: number, x: number, z: number): readonly [number, number] => {
    const path = paths[index]!, own = raw(index, x, z);
    if (path.parent < 0) return own;
    const distance = sampleLavaChannel(paths[path.parent]!.channel, x, z).signedDistance;
    if (distance >= 2) return own;
    const parent = coordinate(path.parent, x, z);
    const t = Math.max(0, Math.min(1, distance / 2)), blend = t * t * (3 - 2 * t);
    return [parent[0] + (own[0] - parent[0]) * blend, parent[1] + (own[1] - parent[1]) * blend];
  };
  for (let i = 1; i < paths.length; i++) {
    const path = paths[i]!;
    for (let j = 0; j < i && path.parent < 0; j++) {
      for (const end of [path.rows[0]!, path.rows.at(-1)!]) {
        if (sampleLavaChannel(paths[j]!.channel, end.x, end.z).signedDistance > .5) continue;
        const first = path.rows[0]!, last = path.rows.at(-1)!;
        if ([first,last].every(row => sampleLavaChannel(paths[j]!.channel,row.x,row.z).signedDistance < 0)) {
          // A bypass rejoins downstream. Match both ends so the transport field
          // remains coherent around the island instead of stretching at one mouth.
          const start = coordinate(j,first.x,first.z), finish = coordinate(j,last.x,last.z);
          path.offset = [start[0],start[1]];
          path.crossDrift = finish[0]-start[0];
          path.longScale = (finish[1]-start[1]) / (last.distance * path.direction);
          path.parent = j;
          break;
        }
        // Align where the tributary actually enters the receiving shore. Anchoring
        // at its buried end stretches a long acute confluence into a bright fan.
        const mouth = path.rows.reduce((best, row) => {
          const distance = Math.abs(sampleLavaChannel(paths[j]!.channel, row.x, row.z).signedDistance);
          return distance < best.distance ? { row, distance } : best;
        }, { row: end, distance: Infinity }).row;
        const target = coordinate(j, mouth.x, mouth.z), own = raw(i, mouth.x, mouth.z);
        path.offset = [target[0] - own[0], target[1] - own[1]];
        path.parent = j;
        break;
      }
    }
  }
  return (x: number, z: number): readonly [number, number] => {
    let nearest = Infinity, selected = -1;
    for (const [i, path] of paths.entries()) {
      if (x < path.minX || x > path.maxX || z < path.minZ || z > path.maxZ) continue;
      const d = sampleLavaChannel(path.channel, x, z).signedDistance;
      if (d < nearest) { nearest = d; selected = i; }
      if (d <= 0) break; // Same ownership as the clipped molten meshes.
    }
    return selected < 0 ? [x, z] : coordinate(selected, x, z);
  };
}
