import { SIM_TICK_MS, type SimClock } from '../core/time.js';

/** Local movement consumes each frame immediately; world systems retain their fixed tick. */
export function stepPlayerFrame(clock: SimClock, realDeltaMs: number,
  move: (deltaMs: number, atMs: number) => void, tick: () => void): void {
  const previousRemainder = clock.alpha() * SIM_TICK_MS;
  const ticks = clock.advance(realDeltaMs);
  const remainder = clock.alpha() * SIM_TICK_MS;
  let remaining = clock.paused ? 0 : Math.max(0, ticks * SIM_TICK_MS + remainder - previousRemainder);
  const advance = (duration: number, atMs: number) => {
    for (let elapsed = 0; elapsed < duration && !clock.paused;) {
      const delta = Math.min(20, duration - elapsed);
      move(delta, atMs + elapsed);
      elapsed += delta;
    }
  };
  for (let i = 0; i < ticks; i++) {
    const from = i === 0 ? previousRemainder : 0;
    const duration = Math.min(remaining, SIM_TICK_MS - from);
    advance(duration, clock.elapsedMs + from);
    remaining -= duration;
    tick();
  }
  advance(remaining, clock.elapsedMs + remainder - remaining);
}
