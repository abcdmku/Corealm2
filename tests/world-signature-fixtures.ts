/**
 * A `Math` whose transcendental functions answer like another browser's libm: for about two thirds of
 * arguments the result is one unit in the last place above or below the true one, chosen by a hash of
 * the argument bits, so the same call always gets the same answer (as a real libm does).
 * `sqrt` and the rounding functions are exact in every engine and stay native.
 */
const PERTURBED = ["sin", "cos", "tan", "atan", "atan2", "asin", "acos", "exp", "log", "log2", "log10", "log1p", "expm1",
  "pow", "hypot", "cbrt", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh"] as const;

const view = new DataView(new ArrayBuffer(8));
function bits(value: number): bigint { view.setFloat64(0, value); return view.getBigUint64(0); }
function step(value: number, direction: number): number {
  if (!Number.isFinite(value) || value === 0 || direction === 0) return value;
  view.setFloat64(0, value);
  const away = (value > 0) === (direction > 0);
  view.setBigUint64(0, view.getBigUint64(0) + (away ? 1n : -1n));
  return view.getFloat64(0);
}
function direction(args: readonly number[], salt: number): number {
  let hash = BigInt(salt) * 0x9e3779b97f4a7c15n;
  for (const arg of args) hash = ((hash ^ bits(arg)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
  hash ^= hash >> 31n;
  return Number(hash % 3n) - 1;
}

export function perturbedMath(salt = 1): Record<(typeof PERTURBED)[number], (...args: number[]) => number> {
  const native = Math as unknown as Record<string, (...args: number[]) => number>;
  return Object.fromEntries(PERTURBED.map(name => {
    const original = native[name]!;
    return [name, (...args: number[]) => step(original(...args), direction(args, salt))];
  })) as Record<(typeof PERTURBED)[number], (...args: number[]) => number>;
}
