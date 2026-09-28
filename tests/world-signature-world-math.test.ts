import { afterEach, describe, expect, it, vi } from "vitest";
import { hypot, installWorldMath, nativeMathIsWorldMath, pow, WORLD_MATH } from "../game/src/world/worldMath.js";
import { perturbedMath } from "./world-signature-fixtures.js";

const math = Math as unknown as Record<string, unknown>;
const native = Object.fromEntries(Object.getOwnPropertyNames(Math).filter(name => typeof math[name] === "function").map(name => [name, math[name]]));
afterEach(() => { Object.assign(math, native); vi.resetModules(); });

/** World-scale arguments: coordinates, offsets and angles. */
function samples(count: number): number[][] {
  let seed = 7;
  const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  return Array.from({ length: count }, () => [(next() - 0.5) * 4000, (next() - 0.5) * 4000, next() * 3, next() * 8 - 4]);
}
const view = new DataView(new ArrayBuffer(8));
/** How many representable doubles lie between a and b. */
function ulpsApart(a: number, b: number): number {
  const ordered = (x: number) => { view.setFloat64(0, x); const bits = view.getBigInt64(0); return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits; };
  const gap = ordered(a) - ordered(b);
  return Number(gap < 0n ? -gap : gap);
}

describe("the world's Math", () => {
  it("computes hypot bit for bit as V8 does", () => {
    // Node's Math.hypot is V8's, as Chromium's is.
    const mismatches = samples(100_000).filter(([a, b, c, d]) => !Object.is(hypot(a!, b!), Math.hypot(a!, b!))
      || !Object.is(hypot(a!, c!, b!), Math.hypot(a!, c!, b!)) || !Object.is(hypot(d!, c!), Math.hypot(d!, c!)));
    expect(mismatches).toEqual([]);
    expect([hypot(), hypot(-0), hypot(3, 4), hypot(NaN, Infinity), hypot(NaN, 1), hypot(1e300, 1e300), hypot(1e-320, 0)])
      .toEqual([0, 0, 5, Infinity, NaN, 1.4142135623730952e300, 1e-320]);
  });

  it("computes pow within one unit of the true value", () => {
    // True values to 23 digits (Python decimal at 40 digits).
    const cases: [number, number, string][] = [
      [0.9, 2.6081849355250597, "7.5972427336120379981575e-1"], [0.65, -2.5939447665587068, "3.0569787472358414191464e+0"],
      [1.7117410502396524, 0.9, "1.6221621332103108020803e+0"], [10, 2.5, "3.1622776601683793319989e+2"],
      [2, 0.5000001, "1.4142136603989127413759e+0"], [0.9, -7.3, "2.1578918814405651170774e+0"],
      [123.456, -3.21, "1.9330622189610804021069e-7"], [1e-05, 11.5, "3.1622776601683823068645e-58"],
      [1.0000001, 1234567.0, "1.1314010069151415986385e+0"], [0.45, 0.1, "9.2325411366742678380481e-1"],
      [3.2, 0.9, "2.8486230262007119909744e+0"], [700.5, 1.25, "3.6037957977143865363507e+3"],
    ];
    expect(cases.filter(([x, y, truth]) => ulpsApart(pow(x, y), Number(truth)) > 1)).toEqual([]);
    // Exact results stay exact.
    expect([pow(2, 10), pow(10, 3), pow(3, 4), pow(-2, 3), pow(0.5, -3), pow(4, 0.5), pow(2, -1074), pow(7, 2)]).toEqual([1024, 1000, 81, -8, 8, 2, 5e-324, 49]);
  });

  it("gives pow the language's special values", () => {
    const special = [0, -0, 0.5, -0.5, 1, -1, 2, -2, 3, -3, 1.5, Infinity, -Infinity, NaN, 1e-310, 1e308, 2 ** 53, -(2 ** 53) - 2];
    const wrong = special.flatMap(x => special.filter(y => !Object.is(pow(x, y), Math.pow(x, y))
      // Only finite, nonzero results may differ from this engine's pow, and only in the last place.
      && !(Number.isFinite(Math.pow(x, y)) && Math.pow(x, y) !== 0 && ulpsApart(pow(x, y), Math.pow(x, y)) === 1)).map(y => [x, y]));
    expect(wrong).toEqual([]);
  });

  it("gives the same answers when the engine's own functions it seeds from are one unit off", async () => {
    const answer = (world: typeof WORLD_MATH) => samples(20_000).map(([a, b, c, d]) => [world.sin(d!), world.cos(a! / 100), world.atan2(a!, b!),
      world.asin(d! / 4), world.acos(d! / 4), world.exp(d!), world.log(c! + 0.01), world.log2(c! + 0.01), world.pow(c!, d!), world.hypot(a!, b!)]);
    const reference = answer(WORLD_MATH);
    // The correctly rounded functions capture the engine's own when their module is evaluated.
    Object.assign(math, perturbedMath(3));
    vi.resetModules();
    const { WORLD_MATH: onOtherEngine } = await import("../game/src/world/worldMath.js");
    expect(onOtherEngine.sin).not.toBe(WORLD_MATH.sin);
    expect(answer(onOtherEngine)).toEqual(reference);
  });

  it("replaces pow on every engine, and the rest only where they differ", () => {
    // Node's fdlibm is one engine whose functions differ.
    expect(nativeMathIsWorldMath()).toBe(false);
    const other: Record<string, unknown> = { ...native, ...perturbedMath() };
    expect(installWorldMath(other)).toEqual(["sin", "cos", "tan", "atan", "atan2", "asin", "acos", "exp", "log", "log2", "hypot", "pow"]);
    expect(Object.entries(WORLD_MATH).filter(([name, fn]) => other[name] !== fn)).toEqual([]);

    // An engine answering as Chromium 151 does keeps its own, except pow.
    const chromium: Record<string, unknown> = { ...native, ...WORLD_MATH, hypot: native.hypot, pow: native.pow };
    expect(installWorldMath(chromium)).toEqual(["pow"]);
    expect([chromium.pow, chromium.hypot, chromium.sin]).toEqual([pow, native.hypot, WORLD_MATH.sin]);
  });
});
