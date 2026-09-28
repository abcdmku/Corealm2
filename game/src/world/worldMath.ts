import { CORRECTLY_ROUNDED_MATH } from "./bake/correctlyRoundedMath.js";

/**
 * The `Math` a world is derived with, on the bake and on every page, so a page re-derives the bake's inputs exactly.
 *
 * A page accepts a baked world record only when it re-derives the record's inputs bit for bit: the terrain
 * spec and flats, the scatter specs, the exclusions and the road polylines under them. Those derivations
 * call `Math` millions of times, and a 1-ulp difference does not stay small: it changes how many points a
 * resolved road has. Measured on world-scale arguments, Firefox 153 and WebKit 26.5 differ from Chromium 151
 * on 1 to 18 percent of sin, cos, atan2, exp and log calls and on 37 percent of hypot calls, and `pow` is the
 * platform C library's in every engine (Chromium on Windows is not Chromium on Linux), which reaches the
 * scatter weights. So the world's `Math` is:
 *
 * - sin, cos, tan, atan, atan2, asin, acos, exp, log and log2 correctly rounded, as Chromium 151's are;
 * - hypot by V8's own algorithm, which is plain arithmetic and so Chromium's bits in every engine;
 * - pow by fdlibm's algorithm in plain arithmetic (within one ulp), in every engine, Chromium included.
 *
 * `cbrt`, the hyperbolic functions and the `**` operator are not replaced: no world record input uses them
 * (`**` appears only as `x ** 2` and exact powers, which every engine computes exactly).
 */

/** V8's `Math.hypot` (`src/builtins/math.tq`), step for step. */
export function hypot(...values: number[]): number {
  let max = 0, nan = false;
  const magnitudes = new Array<number>(values.length);
  for (let index = 0; index < values.length; index++) {
    const value = +values[index]!;
    if (value !== value) { nan = true; magnitudes[index] = 0; continue; }
    const magnitude = Math.abs(value);
    magnitudes[index] = magnitude;
    if (magnitude > max) max = magnitude;
  }
  if (max === Infinity) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0, compensation = 0;
  for (const magnitude of magnitudes) {
    const normalised = magnitude / max;
    const summand = normalised * normalised - compensation;
    const preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return Math.sqrt(sum) * max;
}

// ---------------------------------------------------------------- pow
// fdlibm 5.3's __ieee754_pow, operation for operation over the IEEE words of each double. Engines call
// their platform's pow (and Firefox and WebKit multiply out integer exponents), so no native pow is portable.
const WORDS = new Float64Array(1), HALVES = new Int32Array(WORDS.buffer);
const LITTLE = new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f, HI = LITTLE ? 1 : 0, LO = 1 - HI;
const hi = (x: number): number => { WORDS[0] = x; return HALVES[HI]!; };
const lo = (x: number): number => { WORDS[0] = x; return HALVES[LO]! >>> 0; };
const withLo0 = (x: number): number => { WORDS[0] = x; HALVES[LO] = 0; return WORDS[0]; };
const withHi = (x: number, high: number): number => { WORDS[0] = x; HALVES[HI] = high; return WORDS[0]; };
const BP = [1.0, 1.5], DP_H = [0.0, 5.84962487220764160156e-01], DP_L = [0.0, 1.35003920212974897128e-08];
const TWO53 = 9007199254740992.0, HUGE = 1.0e300, TINY = 1.0e-300;
const L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01,
  L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
const LG2 = 6.93147180559945286227e-01, LG2_H = 6.93147182464599609375e-01, LG2_L = -1.90465429995776804525e-09;
const OVT = 8.0085662595372944372e-17;
const CP = 9.61796693925975554329e-01, CP_H = 9.61796700954437255859e-01, CP_L = -7.02846165095275826516e-09;
const IVLN2 = 1.44269504088896338700e+00, IVLN2_H = 1.44269502162933349609e+00, IVLN2_L = 1.92596299112661746887e-08;

export function pow(x: number, y: number): number {
  x = +x; y = +y;
  const hx = hi(x), lx = lo(x), hy = hi(y), ly = lo(y);
  let ix = hx & 0x7fffffff;
  const iy = hy & 0x7fffffff;
  if ((iy | ly) === 0) return 1;
  if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;
  // yisint: 0 when y is not an integer, 1 when it is odd, 2 when it is even.
  let yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3ff00000) {
      const k = (iy >> 20) - 0x3ff;
      if (k > 20) { const j = ly >>> (52 - k); if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1); }
      else if (ly === 0) { const j = iy >> (20 - k); if ((j << (20 - k)) === iy) yisint = 2 - (j & 1); }
    }
  }
  if (ly === 0) {
    if (iy === 0x7ff00000) {
      if (((ix - 0x3ff00000) | lx) === 0) return y - y;
      if (ix >= 0x3ff00000) return hy >= 0 ? y : 0;
      return hy < 0 ? -y : 0;
    }
    if (iy === 0x3ff00000) return hy < 0 ? 1 / x : x;
    if (hy === 0x40000000) return x * x;
    if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
  }
  let ax = Math.abs(x);
  if (lx === 0 && (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000)) {
    let z = ax;
    if (hy < 0) z = 1 / z;
    if (hx < 0) {
      if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z);
      else if (yisint === 1) z = -z;
    }
    return z;
  }
  let n = (hx >> 31) + 1;
  if ((n | yisint) === 0) return (x - x) / (x - x);
  let s = 1;
  if ((n | (yisint - 1)) === 0) s = -1;

  let t1: number, t2: number;
  if (iy > 0x41e00000) {
    if (iy > 0x43f00000) {
      if (ix <= 0x3fefffff) return hy < 0 ? HUGE * HUGE : TINY * TINY;
      if (ix >= 0x3ff00000) return hy > 0 ? HUGE * HUGE : TINY * TINY;
    }
    if (ix < 0x3fefffff) return hy < 0 ? s * HUGE * HUGE : s * TINY * TINY;
    if (ix > 0x3ff00000) return hy > 0 ? s * HUGE * HUGE : s * TINY * TINY;
    const t = ax - 1;
    const w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    const u = IVLN2_H * t, v = t * IVLN2_L - w * IVLN2;
    t1 = withLo0(u + v);
    t2 = v - (t1 - u);
  } else {
    n = 0;
    if (ix < 0x00100000) { ax *= TWO53; n -= 53; ix = hi(ax); }
    n += (ix >> 20) - 0x3ff;
    const j = ix & 0x000fffff;
    let k: number;
    ix = j | 0x3ff00000;
    if (j <= 0x3988e) k = 0;
    else if (j < 0xbb67a) k = 1;
    else { k = 0; n += 1; ix -= 0x00100000; }
    ax = withHi(ax, ix);
    let u = ax - BP[k]!, v = 1 / (ax + BP[k]!);
    const ss = u * v, sH = withLo0(ss);
    let tH = withHi(0, ((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
    let tL = ax - (tH - BP[k]!);
    const sL = v * ((u - sH * tH) - sH * tL);
    let s2 = ss * ss;
    let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += sL * (sH + ss);
    s2 = sH * sH;
    tH = withLo0(3.0 + s2 + r);
    tL = r - ((tH - 3.0) - s2);
    u = sH * tH;
    v = sL * tH + tL * ss;
    const pH = withLo0(u + v), pL = v - (pH - u);
    const zH = CP_H * pH, zL = CP_L * pH + pL * CP + DP_L[k]!;
    const t = n;
    t1 = withLo0(((zH + zL) + DP_H[k]!) + t);
    t2 = zL - (((t1 - t) - DP_H[k]!) - zH);
  }

  const y1 = withLo0(y);
  const pL = (y - y1) * t1 + y * t2;
  let pH = y1 * t1;
  let z = pL + pH;
  let j = hi(z);
  const i = lo(z) | 0;
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) !== 0) return s * HUGE * HUGE;
    if (pL + OVT > z - pH) return s * HUGE * HUGE;
  } else if ((j & 0x7fffffff) >= 0x4090cc00) {
    if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * TINY * TINY;
    if (pL <= z - pH) return s * TINY * TINY;
  }
  const im = j & 0x7fffffff;
  let k = (im >> 20) - 0x3ff;
  n = 0;
  if (im > 0x3fe00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7fffffff) >> 20) - 0x3ff;
    const t = withHi(0, n & ~(0x000fffff >> k));
    n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    pH -= t;
  }
  const t = withLo0(pL + pH);
  const u = t * LG2_H, v = (pL - (t - pH)) * LG2 + t * LG2_L;
  z = u + v;
  const w = v - (z - u);
  const tt = z * z;
  const t1b = z - tt * (P1 + tt * (P2 + tt * (P3 + tt * (P4 + tt * P5))));
  const r = (z * t1b) / (t1b - 2) - (w + z * w);
  z = 1 - (r - z);
  j = hi(z) + (n << 20);
  // A subnormal result: scale in two exact steps so it is rounded once, as scalbn does.
  if ((j >> 20) <= 0) z = z * 2 ** (n + 60) * 2 ** -60;
  else z = withHi(z, j);
  return s * z;
}

export const WORLD_MATH = { ...CORRECTLY_ROUNDED_MATH, hypot, pow } as const;
type WorldMathName = keyof typeof WORLD_MATH;
/** Replaced on every engine: no engine's own is the same everywhere. */
const ALWAYS_REPLACED: readonly WorldMathName[] = ["pow"];

/**
 * Arguments where another engine's `Math` gives another answer, with Chromium 151's: Node 24's fdlibm
 * cases (`tests/node-world-bake-math.test.ts`), then cases where Firefox 153 or WebKit 26.5 differ.
 * An engine that answers every one as Chromium does keeps its native, faster functions (except `pow`).
 */
const PROBES: readonly [Exclude<WorldMathName, "pow">, readonly number[], number][] = [
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
  ["sin", [0.8583021257072687], 0.7567337142773667], ["cos", [-5.411086270585656], 0.6432207734717715],
  ["tan", [3.6870523262768984], 0.6068754848842141], ["atan", [2.2616355065256357], 1.1544830013368241],
  ["asin", [0.5152191915549338], 0.54126337826133], ["acos", [0.47688799584284425], 1.0736855651988717],
  ["atan2", [658.0433901399374, 890.9151023253798], 0.6361748981040732], ["atan2", [309.24141220748425, 756.2994649633765], 0.3881444746483023],
  ["exp", [1.5603678468614817], 4.7605720845978885], ["exp", [-3.833008451387286], 0.021644401452617073],
  ["log", [1.1944823099672794], 0.17771287810292957], ["log", [2.0051472813263533], 0.6957175150813227],
  ["log2", [1.393602673187852], 0.47881929640816845], ["log2", [1.149614867977798], 0.20115062541443748],
  ["hypot", [1310.3080969303846, 609.6286466345191], 1445.1831702863], ["hypot", [499.9838415533304, -592.223902232945], 775.0567670760913],
  ["hypot", [1399.767054244876, 2.095311057753861, -192.0259753242135], 1412.8786825757622],
  ["hypot", [1194.865195080638, 0.8346920991316438, -1508.6055407300591], 1924.4724494383977],
];

/** True when this engine's own sin, cos, tan, atan, atan2, asin, acos, exp, log, log2 and hypot are the world's. */
export function nativeMathIsWorldMath(math: Pick<Math, WorldMathName> = Math): boolean {
  return PROBES.every(([name, args, expected]) => Object.is((math[name] as (...a: number[]) => number)(...args), expected));
}

/**
 * Makes this page's `Math` the world's for the page's lifetime, before anything derives world data.
 * Returns the names it replaced: `pow` everywhere, and the rest only on an engine whose own differ.
 */
/**
 * Runs `work` with the whole world Math in place and restores what was there after. A Node bake uses
 * it: Node's own functions differ from the world's, so every one of them is replaced for the bake.
 */
export async function withWorldMath<T>(work: () => Promise<T>): Promise<T> {
  const math = Math as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(Object.keys(WORLD_MATH).map(name => [name, math[name]]));
  Object.assign(math, WORLD_MATH);
  try { return await work(); } finally { Object.assign(math, saved); }
}

export function installWorldMath(math: Record<string, unknown> = Math as unknown as Record<string, unknown>): readonly WorldMathName[] {
  const replaced = nativeMathIsWorldMath(math as unknown as Math) ? ALWAYS_REPLACED : Object.keys(WORLD_MATH) as WorldMathName[];
  for (const name of replaced) math[name] = WORLD_MATH[name];
  return replaced;
}
