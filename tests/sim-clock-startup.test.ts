import { expect, it } from 'vitest';
import { SimClock } from '../game/src/core/time.js';

it('preserves accumulated time through an invalid or stale frame and commits the next normal tick', () => {
  const clock = new SimClock();
  expect(clock.advance(40)).toBe(0);
  for (const delta of [-5000, NaN, Infinity, -Infinity]) expect(clock.advance(delta)).toBe(0);
  expect(clock.advance(60)).toBe(1);
  clock.commitTick();
  expect(clock.tick).toBe(1);
  expect(clock.elapsedMs).toBe(100);
  expect(clock.alpha()).toBe(0);
});
