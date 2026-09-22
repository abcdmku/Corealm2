import { describe, expect, it, vi } from 'vitest';
import { GpuTimer } from '../game/src/render/gpuTimer.js';

function fixture(supported = true, interval = 10, phase = 0) {
  const pending: { resolve(ms: number | undefined): void; reject(error: Error): void }[] = [];
  const renderer = {
    hasFeature: vi.fn(() => supported),
    resolveTimestampsAsync: vi.fn(() => new Promise<number | undefined>((resolve, reject) => {
      pending.push({ resolve, reject });
    })),
  };
  return { renderer, timer: new GpuTimer(renderer, interval, phase),
    complete: async (index: number, ms: number | undefined) => { pending[index]!.resolve(ms); await Promise.resolve(); },
    fail: async (index: number) => { pending[index]!.reject(new Error('Device lost')); await Promise.resolve(); } };
}

describe('nonblocking GPU render timer', () => {
  it('leaves unsupported backends uninstrumented', () => {
    const f = fixture(false);
    f.timer.begin(); f.timer.end();
    expect(f.renderer.hasFeature).toHaveBeenCalledWith('timestamp-query');
    expect(f.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    expect(f.timer.snapshot()).toMatchObject({ supported: false, milliseconds: null });
  });

  it('bounds async readback to one request and retains millisecond timing', async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) { f.timer.begin(); f.timer.end(); }
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledExactlyOnceWith('render');
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: null, completed: 0, pending: 1 });
    await f.complete(0, 12.5);
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: 12.5, completed: 1, pending: 0 });
    f.timer.begin(); f.timer.end();
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(2);
    f.timer.dispose();
    await f.complete(1, 50);
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: 12.5, completed: 1, pending: 0 });
  });

  it('samples the requested frame cadence after its render completes', async () => {
    const f = fixture(true, 4, 1);
    f.timer.begin(); f.timer.end();
    expect(f.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    f.timer.begin();
    expect(f.renderer.resolveTimestampsAsync).not.toHaveBeenCalled();
    f.timer.end(); await f.complete(0, 7);
    for (let i = 0; i < 3; i++) { f.timer.begin(); f.timer.end(); }
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(1);
    f.timer.begin(); f.timer.end();
    expect(f.renderer.resolveTimestampsAsync).toHaveBeenCalledTimes(2);
  });

  it('ignores missing or invalid samples and recovers from a rejected readback', async () => {
    const f = fixture(true, 1);
    for (const [index, value] of [undefined, NaN, -1].entries()) {
      f.timer.begin(); f.timer.end(); await f.complete(index, value);
    }
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: null, completed: 0, pending: 0 });
    f.timer.begin(); f.timer.end(); await f.fail(3);
    expect(f.timer.snapshot().pending).toBe(0);
    f.timer.begin(); f.timer.end(); await f.complete(4, 0);
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: 0, completed: 1, pending: 0 });
  });
});
