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

  it('selects the current STEP key at exact boundaries and holds the actual last key', () => {
    const doc = new Document(); doc.createBuffer();
    const node = doc.createNode('body'), clip = doc.createAnimation('Death');
    addChannel(doc, clip, node, 'translation', [0, .5, 1], [0, 2, 0, 0, 1, 0, 0, .125, 0]);
    const sampler = clip.listSamplers()[0]!.setInterpolation('STEP');
    for (const [time, y] of [[-1, 2], [0, 2], [.49, 2], [.5, 1], [.99, 1], [1, .125], [2, .125]]) {
      expect(sample(sampler, time!)).toEqual([0, y, 0]);
    }
  });

  it('matches the runtime last value for malformed duplicate terminal timestamps', () => {
    const doc = new Document(); doc.createBuffer();
    const node = doc.createNode('ground'), clip = doc.createAnimation('Death');
    addChannel(doc, clip, node, 'translation', [0, 1, 1], [0, 0, 0, 0, .5, 0, 0, .125, 0]);
    const sampler = clip.listSamplers()[0]!;
    for (const interpolation of ['LINEAR', 'STEP'] as const) {
      sampler.setInterpolation(interpolation);
      expect(sample(sampler, 1)).toEqual([0, .125, 0]);
      expect(sample(sampler, 2)).toEqual([0, .125, 0]);
    }
  });
});
