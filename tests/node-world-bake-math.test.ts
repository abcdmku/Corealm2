import { describe, expect, it } from "vitest";
import { CORRECTLY_ROUNDED_MATH, withCorrectlyRoundedMath } from "../game/src/world/bake/correctlyRoundedMath.js";

/**
 * The Node world bake evaluates `Math` correctly rounded, as Chromium's V8 does, so its records match the
 * Chromium bake bit for bit. Each case below is an argument where Node 24's fdlibm result is one unit off:
 * the expected value is Chromium 151's, which is also the correctly rounded one (checked at 200 bits).
 */
const CASES: [keyof typeof CORRECTLY_ROUNDED_MATH, number[], number][] = [
  ["sin", [-8.449215898290277], -0.8280171689166229], ["sin", [8.597068870440125], 0.7363833566274074],
  ["cos", [-8.449215898290277], -0.5607027447581302], ["cos", [9.764001066796482], -0.9430134651077177],
  ["tan", [-2.329207523725927], 1.0554847689715896], ["tan", [-5.904123061336577], 0.3983257736847024],
  ["atan", [-4.780016224831343], -1.3645663358038187], ["atan", [0.7829288067296147], 0.6642446533924341],
  ["atan2", [1.7346515227109194, 1.37], 0.9023157760441181], ["atan2", [-4.452800150029361, 1.37], -1.2723163421597883],
  ["asin", [0.8214639919787171], 0.9639735262813082], ["asin", [-0.5031371364427115], -0.5272250326839868],
  ["acos", [-0.8333769894044037], 2.5559860916389776], ["acos", [-0.5272495003432017], 2.1261566447077684],
  ["exp", [-5.0314216781407595], 0.006529521091383717], ["exp", [1.7346515227109194], 5.666952655379089],
  ["log", [34.41234138032794], 3.5384152610960373], ["log", [19.50457973575592], 2.9706492962387148],
  ["log2", [5.527489960029722], 2.466624499575018], ["log2", [0.6279347807392478], -0.6713133707867128],
];

describe("correctly rounded Math for the Node world bake", () => {
  it("returns Chromium's correctly rounded result where fdlibm is one unit off", () => {
    for (const [name, args, expected] of CASES) expect([name, (CORRECTLY_ROUNDED_MATH[name] as (...a: number[]) => number)(...args)]).toEqual([name, expected]);
  });

  it("keeps the special values and V8's small-argument atan", () => {
    const { sin, cos, atan, atan2, exp, log, log2, asin, acos } = CORRECTLY_ROUNDED_MATH;
    expect([Object.is(sin(-0), -0), cos(0), exp(0), log(1), log2(8), log2(1024), atan(1e-9), atan(Infinity), atan2(0, -1), atan2(1, 0), asin(1), acos(1)])
      .toEqual([true, 1, 1, 0, 3, 10, 1e-9, Math.PI / 2, Math.PI, Math.PI / 2, Math.PI / 2, 0]);
    expect([sin(NaN), exp(Infinity), exp(-Infinity), log(-1), log(0)]).toEqual([NaN, Infinity, 0, NaN, -Infinity]);
    // Payne-Hanek reduction for arguments past the fast reduction's range.
    expect([sin(1e22), cos(1e22), sin(2 ** 60)]).toEqual([-0.8522008497671888, 0.523214785395139, -0.8306492176372546]);
  });

  it("replaces Math only while the bake runs", async () => {
    const before = Math.sin;
    const inside = await withCorrectlyRoundedMath(async () => Math.sin(-8.449215898290277));
    expect(inside).toBe(-0.8280171689166229);
    expect(Math.sin).toBe(before);
  });
});
