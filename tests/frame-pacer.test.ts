import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGpuCompletion, FramePacer, gameplayPixelRatio } from '../game/src/render/framePacer.js';

function fixture(limit = 1) {
  let now = 0;
  const pending: { resolve(): void; reject(error: Error): void }[] = [];
  const completion = Object.assign(vi.fn(() => new Promise<void>((resolve, reject) => {
    pending.push({ resolve, reject });
  })), { dispose: vi.fn() });
  return { completion, pacer: new FramePacer(completion, limit, () => now),
    complete: async (index: number, at: number) => { now = at; pending[index]!.resolve(); await Promise.resolve(); },
    fail: async (index: number) => { pending[index]!.reject(new Error('Device lost')); await Promise.resolve(); } };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('gameplay GPU queue', () => {
  it('uses one slot under overload and restores pipelining after prompt recovery', async () => {
    const f = fixture(2);
    f.pacer.submit(0);
    expect(f.pacer.ready(16)).toBe(true); f.pacer.submit(16);
    expect(f.pacer.ready(32)).toBe(false);
    await f.complete(0, 140); await f.complete(1, 140);
    expect(f.pacer.ready(140)).toBe(true);
    expect(f.pacer.snapshot(140).limit).toBe(1);
    for (let frame = 0; frame < 10; frame++) {
      const at = 150 + frame * 34;
      f.pacer.submit(at);
      expect(f.pacer.ready(at + 16)).toBe(false);
      await f.complete(frame + 2, at + 33);
      expect(f.pacer.ready(at + 33)).toBe(true);
    }
    expect(f.pacer.snapshot(500).limit).toBe(2);
  });

  it('permits double buffering without allowing a third stale frame', async () => {
    const f = fixture(2);
    f.pacer.submit(0);
    expect(f.pacer.ready(16)).toBe(true); f.pacer.submit(16);
    expect(f.pacer.ready(32)).toBe(false);
    expect(() => f.pacer.submit(32)).toThrow();
    await f.complete(0, 48); await f.complete(1, 48);
    expect(f.pacer.snapshot(48)).toMatchObject({ pending: 0, completed: 2, recent: [{ id: 1, ms: 48 }, { id: 2, ms: 32 }] });
    expect(f.completion).toHaveBeenCalledTimes(2);
  });

  it('never waits or polls from the animation loop', async () => {
    const f = fixture();
    expect(f.pacer.ready(0)).toBe(true);
    f.pacer.submit(0);
    for (let at = 16; at <= 960; at += 16) expect(f.pacer.ready(at)).toBe(false);
    expect(f.pacer.snapshot(960)).toMatchObject({ submitted: 1, completed: 0, pending: 1, skipped: 60 });
    expect(f.completion).toHaveBeenCalledTimes(1);
    expect(f.pacer.pressureMs(960)).toBe(960);
    await f.complete(0, 976);
    expect(f.pacer.ready(976)).toBe(true);
    f.pacer.submit(977);
    f.pacer.dispose();
    await f.complete(1, 978);
    expect(f.completion.dispose).toHaveBeenCalledOnce();
    expect(f.pacer.snapshot(978)).toMatchObject({ completed: 1, pending: 0 });
    expect(f.pacer.ready(978)).toBe(false);
  });

  it('does not mistake a suspended animation loop for GPU overload', async () => {
    const f = fixture(2);
    f.pacer.submit(0);
    await f.complete(0, 30_000);
    expect(f.pacer.ready(30_000)).toBe(true);
    expect(f.pacer.snapshot(30_000).limit).toBe(2);
  });

  it('keeps failures observable and ignores completions from before context restoration', async () => {
    const f = fixture(2);
    f.pacer.submit(0); f.pacer.submit(1);
    await f.fail(0);
    expect(f.pacer.ready(20)).toBe(false);
    expect(f.pacer.snapshot(20).failed).toBe(true);
    expect(() => f.pacer.submit(21)).toThrow();
    f.pacer.contextRestored();
    f.pacer.submit(22);
    await f.complete(1, 25);
    expect(f.pacer.snapshot(25)).toMatchObject({ pending: 1, completed: 0, failed: false });
    await f.complete(2, 30);
    expect(f.pacer.snapshot(30)).toMatchObject({ pending: 0, completed: 1, lastCompletionMs: 8 });
  });

  it('preserves submission order if completion callbacks arrive out of order', async () => {
    const f = fixture(2);
    f.pacer.submit(0); f.pacer.submit(16);
    await f.complete(1, 40);
    expect(f.pacer.snapshot(40).pending).toBe(2);
    await f.complete(0, 48);
    expect(f.pacer.snapshot(48)).toMatchObject({ pending: 0, completed: 2, recent: [{ id: 1 }, { id: 2 }] });
  });

  it('honors resolution choices independently of GPU pressure', () => {
    expect(gameplayPixelRatio(3, 1)).toBe(2);
    expect(gameplayPixelRatio(3, 0.85)).toBe(1.7);
    expect(gameplayPixelRatio(3, 0.7)).toBe(1.4);
    expect(gameplayPixelRatio(1, 1)).toBe(1);
    expect(gameplayPixelRatio(1, 0.85)).toBe(0.85);
    expect(gameplayPixelRatio(1, 0.7)).toBe(0.7);
  });
});

function fallbackFixture() {
  let status = 1, lost = false;
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 0, TIMEOUT_EXPIRED: 1, CONDITION_SATISFIED: 2, WAIT_FAILED: 3,
    isContextLost: () => lost, fenceSync: vi.fn(() => ({})), flush: vi.fn(), deleteSync: vi.fn(),
    clientWaitSync: vi.fn(() => status) };
  const completion = createGpuCompletion({ backend: { isWebGLBackend: true, gl } }, 100);
  return { gl, completion, status: (value: number) => { status = value; }, lose: () => { lost = true; } };
}

describe('backend GPU completion', () => {
  it('observes the native GPU queue without touching any GL API', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const queue = { onSubmittedWorkDone: vi.fn(() => new Promise<void>(done => { resolve = done; })) };
    const completion = createGpuCompletion({ backend: { isWebGPUBackend: true, device: { queue },
      get gl() { throw new Error('Native WebGPU must not access GL'); } } });
    const result = completion();
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
    resolve(); await expect(result).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    completion.dispose?.();
  });

  it('rejects native timeouts and disposal instead of reporting false completion', async () => {
    vi.useFakeTimers();
    const completion = createGpuCompletion({ backend: { isWebGPUBackend: true,
      device: { queue: { onSubmittedWorkDone: () => new Promise<void>(() => {}) } } } }, 100);
    const timedOut = expect(completion()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100); await timedOut;
    const cancelled = expect(completion()).rejects.toThrow('disposed');
    completion.dispose?.(); await cancelled;
    await expect(completion()).rejects.toThrow('disposed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('polls fallback fences with zero timeout only and releases resources', async () => {
    vi.useFakeTimers();
    const f = fallbackFixture();
    const result = f.completion();
    expect(f.gl.flush).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20);
    for (const call of f.gl.clientWaitSync.mock.calls as unknown[][]) expect(call.slice(1)).toEqual([0, 0]);
    f.status(f.gl.CONDITION_SATISFIED);
    await vi.advanceTimersByTimeAsync(4); await expect(result).resolves.toBeUndefined();
    expect(f.gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects fallback context loss without querying or deleting invalid fences', async () => {
    vi.useFakeTimers();
    const f = fallbackFixture();
    const result = expect(f.completion()).rejects.toThrow('context was lost');
    f.lose(); await vi.advanceTimersByTimeAsync(4); await result;
    expect(f.gl.clientWaitSync).not.toHaveBeenCalled();
    expect(f.gl.deleteSync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
