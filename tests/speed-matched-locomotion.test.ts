import { describe, expect, it } from "vitest";
import { selectSpeedMatchedLocomotion as select } from "../game/src/render/speedMatchedLocomotion.js";

const native = { locomotionPolicy: "speed-matched" as const, impliedWalkMps: 1.2, impliedRunMps: 4.8 };

describe("opted-in native locomotion", () => {
  it("uses walk for a pursuit closer to native walk and returns that gait's retiming speed", () => {
    expect(select("run", 1.8, native)).toEqual({ motion: "walk", nativeReferenceSpeed: 1.2 });
    expect(select("run", 3.1, native)).toEqual({ motion: "run", nativeReferenceSpeed: 4.8 });
    expect(select("run", 3, native).motion).toBe("run");
  });

  it("compares world-space stride while keeping the reference in native metres", () => {
    expect(select("run", 4, native, 2)).toEqual({ motion: "walk", nativeReferenceSpeed: 1.2 });
    expect(select("run", 4, native, -2)).toEqual(select("run", 4, native, 2));
    expect(select("run", 1.6, native, 0.5).motion).toBe("run");
    for (const scale of [0, NaN, Infinity]) expect(select("run", 1.8, native, scale)).toEqual(select("run", 1.8, native));
  });

  it("preserves explicit walks and non-locomotion actions", () => {
    expect(select("walk", 9, native)).toEqual({ motion: "walk", nativeReferenceSpeed: 1.2 });
    for (const motion of ["idle", "attack", "hit", "death"] as const) {
      expect(select(motion, 1.8, native)).toEqual({ motion, nativeReferenceSpeed: undefined });
    }
  });

  it("leaves unflagged assets and missing-speed fallback unchanged", () => {
    expect(select("run", 1.8, { impliedWalkMps: 1.2, impliedRunMps: 4.8 }))
      .toEqual({ motion: "run", nativeReferenceSpeed: 4.8 });
    expect(select("run", 1.8, { locomotionPolicy: "speed-matched", impliedWalkMps: 1.2 }))
      .toEqual({ motion: "run", nativeReferenceSpeed: 1.2 });
    expect(select("run", 1.8, undefined)).toEqual({ motion: "run", nativeReferenceSpeed: undefined });
  });

  it("does not reinterpret stationary or invalid movement", () => {
    for (const speed of [undefined, 0, -1, NaN, Infinity]) {
      expect(select("run", speed, native)).toEqual({ motion: "run", nativeReferenceSpeed: 4.8 });
    }
    for (const run of [0, -1, NaN, Infinity, 1.2, 0.6]) {
      expect(select("run", 0.1, { ...native, impliedRunMps: run }).motion).toBe("run");
    }
    for (const walk of [0, -1, NaN, Infinity]) {
      expect(select("run", 0.1, { ...native, impliedWalkMps: walk }).motion).toBe("run");
    }
  });
});
