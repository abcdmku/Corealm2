import { describe, expect, it } from 'vitest';
import { buildLavaFlowField } from '../game/src/world/lavaFlow.js';
import type { LavaChannel } from '../game/src/content/wildernessLava.js';

const channel: LavaChannel = { id: 'slope', points: [[0, 0], [0, 20]],
  halfWidth: 2, bankWidth: 4, depth: 2.6, seed: 5 };

describe('joined lava currents', () => {
  it('reverses with the receiving slope instead of following authored point order', () => {
    const rising = buildLavaFlowField([channel], (_x, z) => z * .2);
    const falling = buildLavaFlowField([channel], (_x, z) => -z * .2);
    expect(rising(0, 10)[1]).toBeLessThan(-.99);
    expect(falling(0, 10)[1]).toBeGreaterThan(.99);
  });
  it('feeds flat tributaries into the shared junction and blends both incoming paths', () => {
    const branch: LavaChannel = { ...channel, id: 'branch', points: [[0, 10], [12, 10]], openEnds: [true, false] };
    const flow = buildLavaFlowField([channel, branch], () => 0);
    expect(flow(10, 10)[0]).toBeLessThan(-.99);
    const joined = flow(0, 10);
    expect(joined[0]).toBeLessThan(-.2);
    expect(joined[1]).toBeGreaterThan(.2);
    expect(Math.hypot(...joined)).toBeLessThanOrEqual(1);
    expect(flow(90, 90)).toEqual([0, 0]);
  });
});
