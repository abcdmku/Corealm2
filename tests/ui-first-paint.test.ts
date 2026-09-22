import { afterEach, expect, it, vi } from 'vitest';
import { prepareUiFirstPaint } from '../game/src/ui/firstPaint.js';

function rootFor(decodes: Promise<void>[], fonts: Promise<void> = Promise.resolve()): HTMLElement {
  return {
    querySelectorAll: () => decodes.map(promise => ({ decode: () => promise })),
    ownerDocument: { fonts: { ready: fonts } },
  } as unknown as HTMLElement;
}

function frames() {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16));
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits for image decode and font readiness, then crosses paint frames before graphics preparation', async () => {
  frames();
  let decode!: () => void, font!: () => void, finished = false;
  const ready = prepareUiFirstPaint(rootFor([
    new Promise<void>(resolve => { decode = resolve; }),
  ], new Promise<void>(resolve => { font = resolve; }))).then(result => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  decode();
  await vi.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  font();
  await vi.advanceTimersByTimeAsync(31);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  expect(await ready).toEqual({ images: 1, timedOut: false });
  expect(vi.getTimerCount()).toBe(0);
});

it('continues after missing artwork and bounds a stalled decorative request', async () => {
  frames();
  const failed = prepareUiFirstPaint(rootFor([Promise.reject(new Error('missing icon'))]));
  await vi.advanceTimersByTimeAsync(33);
  expect(await failed).toEqual({ images: 1, timedOut: false });
  const stalled = prepareUiFirstPaint(rootFor([new Promise<void>(() => {})]));
  await vi.advanceTimersByTimeAsync(2033);
  expect(await stalled).toEqual({ images: 1, timedOut: true });
  expect(vi.getTimerCount()).toBe(0);
});
