import { describe, expect, it, vi } from 'vitest';
import { FramePacer, gameplayPixelRatio } from '../game/src/render/framePacer.js';

function fixture(limit = 1) {
  let status = 2, lost = false;
  const gl = { TIMEOUT_EXPIRED: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3, WAIT_FAILED: 4,
    SYNC_GPU_COMMANDS_COMPLETE: 5, isContextLost: () => lost,
    clientWaitSync: vi.fn(() => status), deleteSync: vi.fn(), fenceSync: vi.fn(() => ({})) };
  return { gl, pacer: new FramePacer(gl as unknown as WebGL2RenderingContext, limit),
    status: (next: number) => { status = next; }, lose: () => { lost = true; } };
}

describe('gameplay GPU queue', () => {
  it('uses one slot under overload and restores pipelining after prompt recovery', () => {
    const {pacer,gl,status}=fixture(2);
    pacer.submit(0);status(gl.TIMEOUT_EXPIRED);
    expect(pacer.ready(16)).toBe(true);pacer.submit(16);
    expect(pacer.ready(32)).toBe(false);
    status(gl.ALREADY_SIGNALED);expect(pacer.ready(140)).toBe(true);
    expect(pacer.snapshot(140).limit).toBe(1);
    pacer.submit(140);status(gl.TIMEOUT_EXPIRED);
    expect(pacer.ready(156)).toBe(false);
    status(gl.ALREADY_SIGNALED);expect(pacer.ready(173)).toBe(true);
    for(let frame=0;frame<9;frame++) { pacer.submit(180+frame*34);expect(pacer.ready(213+frame*34)).toBe(true); }
    expect(pacer.snapshot(520).limit).toBe(2);
  });
  it('permits double buffering without allowing a third stale frame', () => {
    const {pacer, gl, status} = fixture(2);
    pacer.submit(0); status(gl.TIMEOUT_EXPIRED);
    expect(pacer.ready(16)).toBe(true); pacer.submit(16);
    expect(pacer.ready(32)).toBe(false);
    expect(() => pacer.submit(32)).toThrow();
    status(gl.ALREADY_SIGNALED); expect(pacer.ready(48)).toBe(true);
    expect(pacer.snapshot(48)).toMatchObject({pending:0,completed:2,recent:[{id:1,ms:48},{id:2,ms:32}]});
    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });
  it('keeps one pending frame and never blocks for GPU completion', () => {
    const { pacer, gl, status } = fixture();
    expect(pacer.ready(0)).toBe(true);
    pacer.submit(0); status(gl.TIMEOUT_EXPIRED);
    for (let at = 16; at <= 960; at += 16) expect(pacer.ready(at)).toBe(false);
    expect(pacer.snapshot(960)).toMatchObject({ submitted: 1, completed: 0, pending: 1, skipped: 60 });
    expect(gl.fenceSync).toHaveBeenCalledTimes(1);
    for (const call of gl.clientWaitSync.mock.calls as unknown[][]) expect(call.slice(1)).toEqual([0, 0]);
    expect(() => pacer.submit(970)).toThrow();
    status(gl.CONDITION_SATISFIED);
    expect(pacer.ready(976)).toBe(true);
    pacer.submit(977);
    expect(pacer.snapshot(978)).toMatchObject({ submitted: 2, completed: 1, pending: 1 });
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
    pacer.dispose(); expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it('does not mistake slow JS callbacks or a suspended tab for GPU overload', () => {
    const { pacer } = fixture(2);
    pacer.submit(0); expect(pacer.ready(30_000)).toBe(true);
    expect(pacer.snapshot(30_000).limit).toBe(2);
    for (let at = 30_000; at < 31_000; at += 50) {
      pacer.submit(at); expect(pacer.ready(at + 49)).toBe(true);
    }
    expect(pacer.snapshot(31_000).limit).toBe(2);
  });

  it('does not submit work to a lost context or after a failed fence', () => {
    const f = fixture(); f.lose(); expect(f.pacer.ready(0)).toBe(false);
    const other = fixture(); other.pacer.submit(0); other.status(other.gl.WAIT_FAILED);
    expect(other.pacer.ready(20)).toBe(false);
    expect(other.pacer.snapshot(20).failed).toBe(true);
    expect(() => other.pacer.submit(21)).toThrow();
    other.pacer.contextRestored(); expect(other.pacer.ready(22)).toBe(true);
    other.pacer.submit(22); expect(other.pacer.snapshot(22).pending).toBe(1);
  });

  it('honors all resolution choices at both desktop and phone pixel ratios', () => {
    expect(gameplayPixelRatio(3, 1)).toBe(2);
    expect(gameplayPixelRatio(3, 0.85)).toBe(1.7);
    expect(gameplayPixelRatio(3, 0.7)).toBe(1.4);
    expect(gameplayPixelRatio(1, 1)).toBe(1);
    expect(gameplayPixelRatio(1, 0.85)).toBe(0.85);
    expect(gameplayPixelRatio(1, 0.7)).toBe(0.7);
  });
});
