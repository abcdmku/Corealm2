import { describe, expect, it } from 'vitest';
import { decodeWorldData, encodeWorldData, generationScope } from '../game/src/world/worldDataFormat.js';

describe('release world container', () => {
  it('preserves exact geometry bytes and structured placement data', () => {
    const data = { input: 'world', geometry: { position: new Float32Array([1.23, -0, 900.01]),
      index: new Uint16Array([0, 1, 65535]), wide: new Uint32Array([0xffffffff]), color: new Uint8Array([255, 0]) },
      trees: [{ id: 'tree', position: [13.11111111111111, 0, -12], tilt: 0 }] };
    expect(decodeWorldData(encodeWorldData(data))).toEqual(data);
  });
  it('rejects truncated files and unsupported array types', () => {
    const bytes = encodeWorldData({ heights: new Float32Array([1, 2, 3]) });
    expect(() => decodeWorldData(bytes.subarray(0, 8))).toThrow(/header/);
    expect(() => decodeWorldData(bytes.subarray(0, bytes.length - 1))).toThrow(/Truncated/);
    expect(() => encodeWorldData(new Float64Array([1]))).toThrow(/Unsupported/);
  });
  it('uses the same fixture scope for baking, downloaded data and browser storage', () => {
    expect(generationScope('feature-lab', 1337, '?mode=combat&spawnSpacing=1&world-bake=1'))
      .toBe(generationScope('feature-lab', 1337, '?mode=combat&spawnSpacing=1&startup-cache=1&world-data=somewhere'));
    expect(generationScope('game', 1337, '?startup-cache=0')).toBe('game/1337/world');
    expect(generationScope('game', 1, '')).not.toBe(generationScope('game', 2, ''));
  });
});
