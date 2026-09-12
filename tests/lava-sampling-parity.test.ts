import { expect, it } from 'vitest';
import { lavaSections, lavaBankWidthAt, sampleLavaChannel, WILDERNESS_LAVA_CHANNELS,
  DEEP_WILDERNESS_LAVA_LAB_CHANNELS, WILDERNESS_LAVA_LAB_CHANNELS } from '../game/src/content/wildernessLava.js';

it('retains exact shoreline and centre samples across banks, forks, pools and distant queries', () => {
  for (const channel of [...WILDERNESS_LAVA_LAB_CHANNELS, ...DEEP_WILDERNESS_LAVA_LAB_CHANNELS, ...WILDERNESS_LAVA_CHANNELS]) {
    const sections = lavaSections(channel, channel.rugged ? .55 : 1.2);
    const points = sections.filter((_, i) => i % 11 === 0).flatMap(s => [-40, -8, 0, 3, 15, 100].map(d => [s.x + d, s.z - d * .7]));
    for (const [x, z] of points) {
      let closest = Infinity, nearestCentre = Infinity, centreProgress = 0, result: any;
      for (let i = 1; i < sections.length; i++) {
        const a = sections[i - 1]!, b = sections[i]!, dx = b.x - a.x, dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x! - a.x) * dx + (z! - a.z) * dz) / (dx * dx + dz * dz || 1)));
        const cx = a.x + dx * t, cz = a.z + dz * t, distance = Math.hypot(x! - cx, z! - cz);
        const progress = a.progress + (b.progress - a.progress) * t;
        if (distance < nearestCentre) { nearestCentre = distance; centreProgress = progress; }
        const side = (x! - cx) * -dz + (z! - cz) * dx < 0 ? -1 : 1;
        const aw = side < 0 ? a.leftHalfWidth : a.rightHalfWidth, bw = side < 0 ? b.leftHalfWidth : b.rightHalfWidth;
        const halfWidth = aw + (bw - aw) * t;
        if (distance - halfWidth >= closest) continue;
        closest = distance - halfWidth;
        result = { channelId: channel.id, distance, signedDistance: closest, halfWidth,
          bankWidth: lavaBankWidthAt(channel, progress, side), progress, centre: [cx, cz] };
      }
      expect(sampleLavaChannel(channel, x!, z!)).toEqual({ ...result, centreProgress, centreDistance: nearestCentre });
    }
  }
});
