import { describe, expect, it, vi } from "vitest";
import { GpuTimer } from "../game/src/render/gpuTimer.js";

function fixture(supported = true) {
  let available = false;
  let disjoint = false;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => supported ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
    getParameter: () => disjoint,
    createQuery: vi.fn(() => ({})), deleteQuery: vi.fn(), beginQuery: vi.fn(), endQuery: vi.fn(),
    getQueryParameter: vi.fn((_query: unknown, parameter: number) => {
      if (parameter === 1) return available;
      if (!available) throw new Error("Blocking query result read");
      return 12_500_000;
    }),
  };
  return { gl, timer: new GpuTimer(gl as unknown as WebGL2RenderingContext),
    available: () => { available = true; }, disjoint: () => { disjoint = true; } };
}

describe("nonblocking GPU render timer", () => {
  it("alternates frame and shadow queries without nesting the WebGL elapsed target", () => {
    const f = fixture();
    let active = false;
    f.gl.beginQuery.mockImplementation(() => { expect(active).toBe(false); active = true; });
    f.gl.endQuery.mockImplementation(() => { expect(active).toBe(true); active = false; });
    const whole = new GpuTimer(f.gl as unknown as WebGL2RenderingContext, 20, 0);
    const shadow = new GpuTimer(f.gl as unknown as WebGL2RenderingContext, 20, 10);
    for (let frame = 0; frame < 40; frame++) {
      whole.begin(); shadow.begin(); shadow.end(); whole.end();
    }
    expect(f.gl.beginQuery).toHaveBeenCalledTimes(4);
    expect(whole.snapshot().pending).toBe(2);
    expect(shadow.snapshot().pending).toBe(2);
    expect(active).toBe(false);
    whole.dispose(); shadow.dispose();
  });
  it("leaves unsupported contexts uninstrumented", () => {
    const f = fixture(false);
    f.timer.begin(); f.timer.end();
    expect(f.gl.createQuery).not.toHaveBeenCalled();
    expect(f.timer.snapshot()).toMatchObject({ supported: false, milliseconds: null });
  });
  it("bounds pending work and reads elapsed time only after availability", () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) { f.timer.begin(); f.timer.end(); }
    expect(f.gl.createQuery).toHaveBeenCalledTimes(4);
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: null, pending: 4 });
    f.available(); f.timer.begin(); f.timer.end();
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: 12.5, completed: 4 });
    f.timer.dispose();
    expect(f.timer.snapshot().pending).toBe(0);
  });
  it("discards disjoint samples without reading their result", () => {
    const f = fixture();
    f.timer.begin(); f.timer.end();
    f.disjoint(); f.timer.begin();
    expect(f.gl.getQueryParameter).not.toHaveBeenCalled();
    expect(f.gl.deleteQuery).toHaveBeenCalledTimes(1);
    expect(f.timer.snapshot()).toMatchObject({ milliseconds: null, completed: 0, pending: 0 });
  });
});
