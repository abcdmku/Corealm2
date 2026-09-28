/**
 * Correctly rounded `sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `log` and `log2`.
 *
 * Why the Node world bake needs it: the release world is baked in Chromium, whose V8 returns the
 * correctly rounded result for these functions (Chromium 151, measured against 200-bit references).
 * Node 24's V8 still uses fdlibm, which is off by one unit in the last place in 1 to 20 percent of
 * calls, and those bits reach the baked data: a dressing rotation, a spawn coordinate, the scatter's
 * exclusion signature, and past a threshold whether a plant is placed at all. A correctly rounded
 * function has exactly one right answer, so a bake under these functions matches the Chromium bake bit for bit.
 *
 * One exception, measured: V8's `atan` returns x itself for |x| < 2^-26, and so does this one.
 *
 * Each function evaluates in double-double arithmetic (about 104 significant bits) and rounds once.
 * The native result seeds the Newton-style corrections of the inverse functions. Non-finite, zero and
 * extreme arguments whose native result is already exact go to the native function.
 */

const native = { sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2, asin: Math.asin, acos: Math.acos, exp: Math.exp, log: Math.log, log2: Math.log2 };

// ---------------------------------------------------------------- double-double arithmetic
// Results come back in two registers rather than arrays: the bake calls these tens of millions of times.
let H = 0, L = 0;
const SPLITTER = 134217729; // 2^27 + 1

function twoProd(a: number, b: number): void {
  const p = a * b;
  let t = SPLITTER * a; const ah = t - (t - a), al = a - ah;
  t = SPLITTER * b; const bh = t - (t - b), bl = b - bh;
  H = p; L = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
}
function twoSum(a: number, b: number): void {
  const s = a + b, bb = s - a;
  H = s; L = (a - (s - bb)) + (b - bb);
}
/** (ah, al) + (bh, bl), accurate under cancellation. */
function add(ah: number, al: number, bh: number, bl: number): void {
  twoSum(ah, bh); const sh = H, sl = L;
  twoSum(al, bl); const th = H, tl = L;
  const u = sl + th, v = sh + u, w = tl + (u - (v - sh));
  H = v + w; L = w - (H - v);
}
/** (ah, al) + (bh, bl) without the cancellation guard: for sums whose result is not much smaller than either term. */
function addFast(ah: number, al: number, bh: number, bl: number): void {
  const s = ah + bh, bb = s - ah, e = (ah - (s - bb)) + (bh - bb) + al + bl;
  H = s + e; L = e - (H - s);
}
function mul(ah: number, al: number, bh: number, bl: number): void {
  twoProd(ah, bh); const ph = H, pl = L + (ah * bl + al * bh);
  H = ph + pl; L = pl - (H - ph);
}
function div(ah: number, al: number, bh: number, bl: number): void {
  const q1 = ah / bh;
  mul(q1, 0, bh, bl); add(ah, al, -H, -L); const r1h = H, r1l = L;
  const q2 = r1h / bh;
  mul(q2, 0, bh, bl); add(r1h, r1l, -H, -L);
  const q3 = H / bh;
  twoSum(q1, q2); add(H, L, q3, 0);
}

// ---------------------------------------------------------------- constants (generated with mpmath at 600 bits)
const INV_FACT_HI = [1, 1, 0.5, 0.16666666666666666, 0.041666666666666664, 0.008333333333333333, 0.001388888888888889, 0.0001984126984126984, 2.48015873015873e-05, 2.7557319223985893e-06, 2.755731922398589e-07, 2.505210838544172e-08, 2.08767569878681e-09, 1.6059043836821613e-10, 1.1470745597729725e-11, 7.647163731819816e-13, 4.779477332387385e-14, 2.8114572543455206e-15, 1.5619206968586225e-16, 8.22063524662433e-18, 4.110317623312165e-19, 1.9572941063391263e-20, 8.896791392450574e-22, 3.868170170630684e-23, 1.6117375710961184e-24, 6.446950284384474e-26, 2.4795962632247976e-27, 9.183689863795546e-29, 3.279889237069838e-30, 1.1309962886447716e-31];
const INV_FACT_LO = [0, 0, 0, 9.25185853854297e-18, 2.3129646346357427e-18, 1.1564823173178714e-19, -5.300543954373577e-20, 1.7209558293420705e-22, 2.1511947866775882e-23, -1.858393274046472e-22, 2.3767714622250297e-23, -1.448814070935912e-24, -1.20734505911326e-25, 1.2585294588752098e-26, 2.0655512752830745e-28, 7.03872877733453e-30, 4.399205485834081e-31, 1.6508842730861433e-31, 1.1910679660273754e-32, 2.2141894119604265e-34, 1.4412973378659527e-36, -1.3643503830087908e-36, -7.911402614872376e-38, -8.843177655482344e-40, -3.6846573564509766e-41, -1.9330404233703465e-42, -1.2953730964765229e-43, 1.4303150396787322e-45, 1.5117542744029879e-46, 1.0498015412959506e-47];
/** ln 2 in three parts; the first two have 40 significant bits, so k times them is exact for |k| < 2^13. */
const LN2_A = 0.6931471805592082, LN2_B = 7.371002565161996e-13, LN2_C = 5.8029889835956905e-25;
const INV_LN2_HI = 1.4426950408889634, INV_LN2_LO = 2.0355273740931033e-17;
/** pi/2 in four parts; the first three have 33 significant bits, so k times them is exact for |k| < 2^20. */
const PIO2_A = 1.5707963267341256, PIO2_B = 6.077100506303966e-11, PIO2_C = 2.0222662487111665e-21, PIO2_D = 8.4784276603689e-32;
const PIO2_HI = 1.5707963267948966, PIO2_LO = 6.123233995736766e-17;
const TWO_OVER_PI = 0.6366197723675814;
/** floor(2/pi * 2^1100). */
const TWO_OVER_PI_BITS = 8647197003706405937124707469357268788989348917996601678872418306052387260641554263215294846106395384121087357864314012712605171188197135140500661979680923857256067138911553439857781785153562480420393875125226924188381049808375019049196497326808548246769702346883425076390109639002652801836986668748171627046383845217503914944888832n;
/** 1/n as double-doubles, for the logarithm's series near one. */
const RECIPROCAL_HI: number[] = [], RECIPROCAL_LO: number[] = [];
for (let n = 1; n <= 17; n++) { const inverse = 1 / n; twoProd(inverse, n); RECIPROCAL_HI[n] = inverse; RECIPROCAL_LO[n] = ((1 - H) - L) / n; }
const FAST_REDUCTION_LIMIT = 800_000; // |k| stays below 2^19

// ---------------------------------------------------------------- sin, cos, tan
let R_H = 0, R_L = 0;
/** Reduces x to (R_H, R_L) in about [-pi/4, pi/4] and returns the quadrant k mod 4. */
function reduce(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 0.7853981633974483) { R_H = x; R_L = 0; return 0; }
  if (ax < FAST_REDUCTION_LIMIT) {
    const k = Math.round(x * TWO_OVER_PI);
    // x - k*A is exact: both are within a factor of two of each other.
    twoSum(x - k * PIO2_A, -k * PIO2_B);
    add(H, L, -k * PIO2_C, 0);
    const h = H, l = L;
    twoProd(-k, PIO2_D);
    add(h, l, H, L);
    R_H = H; R_L = L;
    return k & 3;
  }
  // Payne-Hanek with an exact integer product: x = m * 2^e, then the fraction of x * 2/pi.
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, ax);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & 0xfffffffffffffn) | (1n << 52n), e = exponent - 1075;
  const shift = BigInt(1100 - e), product = mantissa * TWO_OVER_PI_BITS;
  let whole = product >> shift, fraction = product - (whole << shift);
  if (fraction >= 1n << (shift - 1n)) { whole += 1n; fraction -= 1n << shift; }
  const top = fraction >> (shift - 110n), hi = Number(top), lo = Number(top - BigInt(hi));
  mul(hi * 2 ** -110, lo * 2 ** -110, PIO2_HI, PIO2_LO);
  let k = Number(whole & 3n);
  if (x < 0) { H = -H; L = -L; k = (4 - k) & 3; }
  R_H = H; R_L = L;
  return k;
}
let S_H = 0, S_L = 0, C_H = 0, C_L = 0;
/** sin and cos of (R_H, R_L), |r| <= about 0.8, by Taylor series to 2^-110. */
function sinCosReduced(): void {
  mul(R_H, R_L, R_H, R_L); const x2h = H, x2l = L;
  let ph = INV_FACT_HI[29]!, pl = INV_FACT_LO[29]!;
  for (let n = 27; n >= 1; n -= 2) { mul(x2h, x2l, ph, pl); add(INV_FACT_HI[n]!, INV_FACT_LO[n]!, -H, -L); ph = H; pl = L; }
  mul(ph, pl, R_H, R_L); S_H = H; S_L = L;
  ph = INV_FACT_HI[28]!; pl = INV_FACT_LO[28]!;
  for (let n = 26; n >= 0; n -= 2) { mul(x2h, x2l, ph, pl); add(INV_FACT_HI[n]!, INV_FACT_LO[n]!, -H, -L); ph = H; pl = L; }
  C_H = ph; C_L = pl;
}
/** sin and cos of i/64 for |i| <= 51, filled below by the series above. */
const TABLE_SIN_HI: number[] = [], TABLE_SIN_LO: number[] = [], TABLE_COS_HI: number[] = [], TABLE_COS_LO: number[] = [];
for (let i = -51; i <= 51; i++) { R_H = i / 64; R_L = 0; sinCosReduced(); TABLE_SIN_HI[i + 51] = S_H; TABLE_SIN_LO[i + 51] = S_L; TABLE_COS_HI[i + 51] = C_H; TABLE_COS_LO[i + 51] = C_L; }
/**
 * sin and cos of (R_H, R_L) to about 2^-66 relative: r = a + b with a = i/64 from the table and
 * |b| <= 1/128, whose series needs three terms. `want` skips the half no caller reads: 1 sin, 2 cos, 3 both.
 * The callers round only when that bound decides the result. |b| <= |a|/2 when a is not zero, so neither
 * sum below cancels by more than a factor of three.
 */
function sinCosReducedFast(want: number): void {
  const i = Math.round(R_H * 64), a = i / 64;
  // R_H - a is exact: both lie within a factor of two of each other, or a is zero.
  twoSum(R_H - a, R_L); const bh = H, bl = L;
  const b2 = bh * bh;
  // sin b = b + tail, cos b = 1 + c with c = -b^2/2 + tail.
  const sinTail = b2 * bh * (-1 / 6 + b2 * (1 / 120 - b2 * (1 / 5040)));
  twoSum(bh, sinTail); const sbh = H, sbl = L + bl;
  if (i === 0) {
    if (want & 1) { S_H = sbh + sbl; S_L = sbl - (S_H - sbh); }
    if (want & 2) { const cosTail = b2 * b2 * (1 / 24 - b2 * (1 / 720 - b2 * (1 / 40320))); twoProd(bh, bh); addFast(1, 0, -0.5 * H, cosTail - 0.5 * (L + 2 * bh * bl)); C_H = H; C_L = L; }
    return;
  }
  twoProd(bh, bh); const b2h = H, b2l = L + 2 * bh * bl;
  const cosTail = b2 * b2 * (1 / 24 - b2 * (1 / 720 - b2 * (1 / 40320)));
  twoSum(-0.5 * b2h, cosTail); const ch = H, cl = L - 0.5 * b2l;
  const sah = TABLE_SIN_HI[i + 51]!, sal = TABLE_SIN_LO[i + 51]!, cah = TABLE_COS_HI[i + 51]!, cal = TABLE_COS_LO[i + 51]!;
  // sin r = sa + (sa c + ca sb); cos r = ca + (ca c - sa sb).
  if (want & 1) { mul(sah, sal, ch, cl); const p1h = H, p1l = L; mul(cah, cal, sbh, sbl); addFast(p1h, p1l, H, L); addFast(sah, sal, H, L); S_H = H; S_L = L; }
  if (want & 2) { mul(cah, cal, ch, cl); const p2h = H, p2l = L; mul(sah, sal, sbh, sbl); addFast(p2h, p2l, -H, -L); addFast(cah, cal, H, L); C_H = H; C_L = L; }
}
/** Sets (S_H, S_L) and (C_H, C_L) to sin x and cos x: to about 2^-66 relative, or to 2^-100 when `precise`. */
function sinCos(x: number, precise: boolean, want = 3): void {
  const k = reduce(x);
  if (precise) sinCosReduced(); else sinCosReducedFast(k & 1 ? (want === 3 ? 3 : 3 - want) : want);
  const sh = S_H, sl = S_L, ch = C_H, cl = C_L;
  if (k === 0) { S_H = sh; S_L = sl; C_H = ch; C_L = cl; }
  else if (k === 1) { S_H = ch; S_L = cl; C_H = -sh; C_L = -sl; }
  else if (k === 2) { S_H = -sh; S_L = -sl; C_H = -ch; C_L = -cl; }
  else { S_H = -ch; S_L = -cl; C_H = sh; C_L = sl; }
}

/** Ziv's rounding test: the double nearest to (h, l) when every value within `error` of it rounds the same way, else NaN. */
function rounded(h: number, l: number, error: number): number {
  const low = h + (l - error), high = h + (l + error);
  return low === high ? low : NaN;
}
/** The fast evaluation's bound, with an eightfold margin over the analysis. */
const FAST_ERROR = 2 ** -62;

export function sin(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return native.sin(x);
  sinCos(x, false, 1);
  const fast = rounded(S_H, S_L, Math.abs(S_H) * FAST_ERROR);
  if (fast === fast) return fast;
  sinCos(x, true); return S_H + S_L;
}
export function cos(x: number): number {
  if (!Number.isFinite(x)) return native.cos(x);
  sinCos(x, false, 2);
  const fast = rounded(C_H, C_L, Math.abs(C_H) * FAST_ERROR);
  if (fast === fast) return fast;
  sinCos(x, true); return C_H + C_L;
}
export function tan(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return native.tan(x);
  sinCos(x, false); div(S_H, S_L, C_H, C_L);
  const fast = rounded(H, L, Math.abs(H) * FAST_ERROR * 2);
  if (fast === fast) return fast;
  sinCos(x, true); div(S_H, S_L, C_H, C_L); return H + L;
}

// ---------------------------------------------------------------- exp, log, log2
let E_H = 0, E_L = 0;
/** exp(x) as a double-double in (E_H, E_L) for -708 < x < 709.7. */
function expDD(x: number): void {
  const k = Math.round(x * INV_LN2_HI);
  twoSum(x - k * LN2_A, -k * LN2_B);
  const h = H, l = L;
  twoProd(-k, LN2_C); add(h, l, H, L);
  // e^r = (1 + m) with m = expm1(r / 1024) squared up ten times as m -> m (m + 2).
  const sh = H * (1 / 1024), sl = L * (1 / 1024);
  let mh = INV_FACT_HI[9]!, ml = INV_FACT_LO[9]!;
  for (let n = 8; n >= 1; n--) { mul(mh, ml, sh, sl); add(INV_FACT_HI[n]!, INV_FACT_LO[n]!, H, L); mh = H; ml = L; }
  mul(mh, ml, sh, sl); mh = H; ml = L;
  for (let i = 0; i < 10; i++) { add(mh, ml, 2, 0); mul(mh, ml, H, L); mh = H; ml = L; }
  add(1, 0, mh, ml);
  // In two steps: k reaches 1024 just below the overflow threshold, where e^r < 1.
  const scale = 2 ** (k - 1);
  E_H = H * scale * 2; E_L = L * scale * 2;
}
/** ln2/64 in three parts; the first two have 32 significant bits, so n times them is exact for |n| < 2^21. */
const LN2_64_A = 0.01083042469326756, LN2_64_B = 2.9815858263172973e-12, LN2_64_C = 6.679961858980702e-22;
const INV_LN2_64 = 92.33248261689366;
/** 2^(j/64) as double-doubles. */
const EXP2_HI = [1.0, 1.0108892860517005, 1.0218971486541166, 1.0330248790212284, 1.0442737824274138, 1.0556451783605572, 1.0671404006768237, 1.0787607977571199, 1.0905077326652577, 1.102382583307841, 1.1143867425958924, 1.1265216186082418, 1.1387886347566916, 1.1511892299529827, 1.1637248587775775, 1.1763969916502812, 1.189207115002721, 1.202156731452703, 1.215247359980469, 1.22848053610687, 1.241857812073484, 1.255380757024691, 1.2690509571917332, 1.2828700160787783, 1.2968395546510096, 1.3109612115247644, 1.3252366431597413, 1.339667524053303, 1.3542555469368927, 1.3690024229745905, 1.383909881963832, 1.3989796725383112, 1.4142135623730951, 1.42961333839197, 1.4451808069770467, 1.460917794180647, 1.4768261459394993, 1.4929077282912648, 1.5091644275934228, 1.5255981507445384, 1.5422108254079407, 1.559004400237837, 1.5759808451078865, 1.593142151342267, 1.6104903319492543, 1.6280274218573478, 1.645755478153965, 1.6636765803267364, 1.681792830507429, 1.7001063537185235, 1.718619298122478, 1.7373338352737062, 1.7562521603732995, 1.7753764925265212, 1.7947090750031072, 1.8142521755003989, 1.8340080864093424, 1.8539791250833855, 1.8741676341103, 1.8945759815869656, 1.9152065613971474, 1.9360617934922943, 1.9571441241754002, 1.978456026387951];
const EXP2_LO = [0.0, -1.5234778603368577e-17, 5.109225028973444e-17, 7.600838874027088e-18, 8.551889705537965e-17, 1.759325738772092e-18, -7.899853966841582e-17, -6.656660436056593e-17, -3.046782079812471e-17, 5.2660368715706944e-17, 1.0410278456845571e-16, 5.165856758795457e-17, 8.912812676025408e-17, 3.250710218863827e-17, 3.8292048369240935e-17, 5.554203254218079e-17, 3.982015231465646e-17, 6.644981499252301e-17, -7.712630692681488e-17, -1.89878163130253e-17, 4.658027591836937e-17, -6.7113898212968784e-18, 2.667932131342186e-18, 1.713594918243561e-17, 2.5382502794888315e-17, -7.181536135519454e-17, -2.8587312100388614e-17, 8.927282594831732e-17, 7.70094837980299e-17, 9.593797919118849e-17, -6.770511658794786e-17, -9.614213209051323e-17, -9.667293313452913e-17, -1.2031642489053655e-17, -3.0237581349939873e-17, -5.600377186075216e-17, -3.483994556892796e-17, 1.4192920154284036e-17, -1.016455327754295e-16, -1.1024941712342561e-16, 7.949834809697621e-17, 3.7812070533575275e-17, -1.0136916471278304e-17, -1.0094406542311964e-16, 2.4707192569797888e-17, -6.712955084707084e-17, -1.0125679913674773e-16, 5.8909926967131e-17, 8.199010020581497e-17, -8.0237193703977e-18, -1.851380418263111e-17, 3.164389299292957e-17, 2.960140695448873e-17, 6.429731796556572e-17, 1.8227458427912087e-17, -9.969531538920349e-17, 3.283107224245627e-17, 9.761887490727594e-17, -6.122763413004143e-17, 3.4034035352165297e-17, -1.0619946056195963e-16, 1.0332385960676326e-16, 8.960767791036668e-17, 4.0388753109278167e-17];
/** exp(x) to about 2^-70 relative, in (E_H, E_L): x = n ln2/64 + r, 2^(n/64) from the table, e^r by its series. */
function expFast(x: number): void {
  const n = Math.round(x * INV_LN2_64), j = n & 63, k = (n - j) / 64;
  twoSum(x - n * LN2_64_A, -n * LN2_64_B); const rh = H, rl = L - n * LN2_64_C;
  // e^r - 1 = r + r^2/2 + tail, |r| <= ln2/128.
  twoProd(rh, rh); const r2h = 0.5 * H, r2l = 0.5 * (L + 2 * rh * rl);
  const tail = rh * rh * rh * (1 / 6 + rh * (1 / 24 + rh * (1 / 120 + rh * (1 / 720 + rh * (1 / 5040 + rh * (1 / 40320 + rh * (1 / 362880)))))));
  add(rh, rl, r2h, r2l + tail);
  mul(EXP2_HI[j]!, EXP2_LO[j]!, H, L); add(EXP2_HI[j]!, EXP2_LO[j]!, H, L);
  const scale = 2 ** k;
  E_H = H * scale; E_L = L * scale;
}
export function exp(x: number): number {
  if (!(x > -708 && x < 709.7) || x === 0) return native.exp(x);
  expFast(x);
  const fast = rounded(E_H, E_L, Math.abs(E_H) * FAST_ERROR);
  if (fast === fast) return fast;
  expDD(x); return E_H + E_L;
}
/** log(x) as a double-double in (H, L) for positive, normal, finite x: j ln 2 + log m with x = m 2^j, m in [0.707, 1.414]. */
function logDD(x: number): void {
  let j = Math.floor(native.log2(x)), m = x * 2 ** -j;
  while (m >= 2) { m /= 2; j++; }
  while (m < 1) { m *= 2; j--; }
  if (m > Math.SQRT2) { m /= 2; j++; }
  const u = m - 1;
  if (Math.abs(u) < 1 / 128) {
    // Near one, log(1 + u) = u (1 - u (1/2 - u (1/3 - ...))), exact in u.
    let ph = RECIPROCAL_HI[17]!, pl = RECIPROCAL_LO[17]!;
    for (let n = 16; n >= 1; n--) { mul(ph, pl, u, 0); add(RECIPROCAL_HI[n]!, RECIPROCAL_LO[n]!, -H, -L); ph = H; pl = L; }
    mul(ph, pl, u, 0);
  } else {
    const y0 = native.log(m);
    expDD(-y0);
    twoProd(m, E_H); const ph = H, pl = L + m * E_L;
    add(ph, pl, -1, 0); const th = H, tl = L;
    // log(1 + t) = t - t^2 / 2 for t of the order of y0's rounding error.
    add(y0, 0, th, tl); add(H, L, -0.5 * th * th, 0);
  }
  if (j === 0) return;
  const lh = H, ll = L;
  twoSum(j * LN2_A, j * LN2_B); const ah = H, al = L;
  add(ah, al, j * LN2_C, 0); add(H, L, lh, ll);
}
export function log(x: number): number {
  if (!(x > 2.2250738585072014e-308 && x < Infinity) || x === 1) return native.log(x);
  logDD(x); return H + L;
}
export function log2(x: number): number {
  if (!(x > 2.2250738585072014e-308 && x < Infinity) || x === 1) return native.log2(x);
  logDD(x); mul(H, L, INV_LN2_HI, INV_LN2_LO); return H + L;
}

// ---------------------------------------------------------------- inverse functions
// Each corrects the native result theta0 by delta = residual / derivative, from sin and cos of theta0.
// The native result is within an ulp, so delta is too, and one step leaves an error far below the last bit.

/** atan2 as theta0 + (y cos - x sin) / (x cos + y sin), in (H, L). */
function atan2From(y: number, x: number, theta0: number, precise: boolean): void {
  sinCos(theta0, precise);
  const sh = S_H, sl = S_L, ch = C_H, cl = C_L;
  twoProd(y, ch); const ah = H, al = L + y * cl;
  twoProd(x, sh); const bh = H, bl = L + x * sl;
  add(ah, al, -bh, -bl);
  twoSum(theta0, (H + L) / (x * ch + y * sh));
}
export function atan2(y: number, x: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return native.atan2(y, x);
  // atan2 is invariant under a common power-of-two scale; keep the splits away from overflow and underflow.
  const big = Math.max(Math.abs(x), Math.abs(y));
  if (big > 2 ** 500 || big < 2 ** -500) { const scale = 2 ** -Math.round(native.log2(big)); x *= scale; y *= scale; }
  if (Math.min(Math.abs(x), Math.abs(y)) < 2 ** -900) return native.atan2(y, x);
  const theta0 = native.atan2(y, x);
  atan2From(y, x, theta0, false);
  const fast = rounded(H, L, Math.abs(theta0) * FAST_ERROR * 4);
  if (fast === fast) return fast;
  atan2From(y, x, theta0, true); return H + L;
}
export function atan(x: number): number {
  // V8 returns x itself below 2^-26, where atan(x) = x (1 - x^2/3) can round one unit lower. Kept, to match its bake.
  if (Math.abs(x) < 2 ** -26) return x;
  if (!Number.isFinite(x) || Math.abs(x) > 2 ** 500) return native.atan(x);
  return atan2(x, 1);
}
export function asin(x: number): number {
  if (!(Math.abs(x) < 1) || x === 0) return native.asin(x);
  const theta0 = native.asin(x);
  // theta = theta0 + (x - sin theta0) / cos theta0.
  sinCos(theta0, false); add(x, 0, -S_H, -S_L);
  const c = C_H;
  twoSum(theta0, (H + L) / c);
  const fast = rounded(H, L, (Math.abs(theta0) + Math.abs(x / c)) * FAST_ERROR * 4);
  if (fast === fast) return fast;
  sinCos(theta0, true); add(x, 0, -S_H, -S_L);
  twoSum(theta0, (H + L) / (C_H + C_L)); return H + L;
}
export function acos(x: number): number {
  if (!(Math.abs(x) < 1)) return native.acos(x);
  const theta0 = native.acos(x);
  // theta = theta0 + (cos theta0 - x) / sin theta0.
  sinCos(theta0, false); add(C_H, C_L, -x, 0);
  const s = S_H;
  twoSum(theta0, (H + L) / s);
  const fast = rounded(H, L, (Math.abs(theta0) + Math.abs(C_H / s)) * FAST_ERROR * 4);
  if (fast === fast) return fast;
  sinCos(theta0, true); add(C_H, C_L, -x, 0);
  twoSum(theta0, (H + L) / (S_H + S_L)); return H + L;
}

export const CORRECTLY_ROUNDED_MATH = { sin, cos, tan, atan, atan2, asin, acos, exp, log, log2 } as const;

/**
 * Runs `work` with `Math`'s functions replaced by the correctly rounded ones, and restores them after.
 * The replacement is process-wide while `work` runs, so a bake runs in a process of its own.
 */
export async function withCorrectlyRoundedMath<T>(work: () => Promise<T>): Promise<T> {
  const math = Math as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(Object.keys(CORRECTLY_ROUNDED_MATH).map(name => [name, math[name]]));
  Object.assign(math, CORRECTLY_ROUNDED_MATH);
  try { return await work(); } finally { Object.assign(math, saved); }
}
