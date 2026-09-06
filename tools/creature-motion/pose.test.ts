import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { addChannel, sample } from './pose.js';

describe('dense motion sampler', () => {
  it('preserves interpolation on irregular keys, exact keys, and clamped endpoints', () => {
    const doc = new Document(); doc.createBuffer();
    const node = doc.createNode('foot'), clip = doc.createAnimation('Run');
    const times = Array.from({ length: 2049 }, (_, i) => Math.fround((i / 2048) ** 2));
    addChannel(doc, clip, node, 'translation', times, times.flatMap(t => [t * 2, -t, t * .5]));
    const sampler = clip.listSamplers()[0]!;
    for (const t of [-1, 0, times[1]!, times[1024]!, .3333333, .997, 1, 2]) {
      const clamped = Math.max(0, Math.min(1, t));
      sample(sampler, t).forEach((value, i) => expect(value).toBeCloseTo([clamped * 2, -clamped, clamped * .5][i]!, 7));
    }
  });

  it('supports held one-key clips without reading outside the accessor', () => {
    const doc = new Document(); doc.createBuffer();
    const node = doc.createNode('foot'), clip = doc.createAnimation('Idle');
    addChannel(doc, clip, node, 'translation', [0], [2, 3, 4]);
    for (const time of [-1, 0, 1]) expect(sample(clip.listSamplers()[0]!, time)).toEqual([2, 3, 4]);
  });
});
