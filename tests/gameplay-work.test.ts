import { expect, it } from 'vitest';
import { GameplayWork } from '../game/src/render/gameplayWork.js';

it('keeps startup unpaced, then starts priority jobs across frames without locking on an async dependency', async () => {
  const frames: (() => void)[] = [], events: string[] = [];
  let time = 0;
  const work = new GameplayWork(run => frames.push(run), () => time += 2);
  await work.run(() => events.push('boot'));
  expect(frames).toHaveLength(0);
  work.setInteractive(true);
  let promote = 0;
  const background = work.run(() => events.push('background'));
  const dependency = work.run(() => events.push('dependency'), () => promote);
  const primary = work.run(() => { events.push('primary'); return dependency; }, () => 3);
  frames.shift()!();
  expect(events).toEqual(['boot', 'primary']);
  promote = 2;
  frames.shift()!();
  await primary;
  expect(events).toEqual(['boot', 'primary', 'dependency']);
  frames.shift()!(); await background;
  expect(events.at(-1)).toBe('background'); expect(frames).toHaveLength(0);
});

it('rejects failed work, continues the queue and flushes pending jobs for a covered load', async () => {
  const frames: (() => void)[] = [];
  let time = 0;
  const work = new GameplayWork(run => frames.push(run), () => time += 2);
  work.setInteractive(true);
  const failed = work.run(() => { throw Error('decode failed'); });
  const rejected = expect(failed).rejects.toThrow('decode failed');
  const next = work.run(() => 42);
  frames.shift()!(); await rejected;
  work.setInteractive(false);
  expect(await next).toBe(42);
  frames.shift()!(); expect(frames).toHaveLength(0);
});

it('groups cheap placement work but yields after the time budget or a costly job', async () => {
  const frames: (() => void)[] = [], finished: number[] = [];
  let time = 0;
  const work = new GameplayWork(run => frames.push(run), () => time);
  work.setInteractive(true);
  const jobs = [1, 1, 8, ...Array(10).fill(0)].map((cost, id) => work.run(() => {
    time += cost; finished.push(id);
  }));
  frames.shift()!(); expect(finished).toEqual([0, 1]);
  frames.shift()!(); expect(finished).toEqual([0, 1, 2]);
  frames.shift()!(); expect(finished).toHaveLength(11);
  frames.shift()!(); await Promise.all(jobs);
  expect(finished).toHaveLength(13); expect(frames).toHaveLength(0);
});

it('splits a computation across painted frames while higher priority work can run between slices', async () => {
  const frames: (() => void)[] = [], events: string[] = [];
  let time = 0;
  const work = new GameplayWork(run => frames.push(run), () => time);
  work.setInteractive(true);
  function* compute() {
    for (let i = 0; i < 6; i++) { time++; events.push(`pixel-${i}`); yield; }
    return 42;
  }
  const result = work.runSliced(compute());
  expect(events).toEqual([]);
  frames.shift()!();
  expect(events).toEqual(['pixel-0', 'pixel-1']);
  const input = work.run(() => { events.push('input'); time += 2; }, () => 10);
  frames.shift()!(); await input;
  expect(events.at(-1)).toBe('input');
  frames.shift()!(); expect(events.at(-1)).toBe('pixel-3');
  frames.shift()!(); expect(events.at(-1)).toBe('pixel-5');
  frames.shift()!(); expect(await result).toBe(42);
  expect(frames).toHaveLength(0);
});

it('rejects an iterator failure and keeps unrelated preparation usable', async () => {
  const frames: (() => void)[] = [];
  let time = 0;
  const work = new GameplayWork(run => frames.push(run), () => time);
  work.setInteractive(true);
  function* compute() { time += 2; yield; throw Error('bad sample'); }
  const result = work.runSliced(compute());
  const rejected = expect(result).rejects.toThrow('bad sample');
  frames.shift()!(); frames.shift()!(); await rejected;
  const next = work.run(() => 7);
  frames.shift()!(); expect(await next).toBe(7);
});
