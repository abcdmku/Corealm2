/**
 * The base game version: `package.json`'s `version`, as plain semver. `MAJOR.MINOR.PATCH` with an
 * optional `-prerelease`, and nothing else: no leading `v`, no `+build` metadata, no leading zeros.
 *
 * Browser-safe and dependency-free. The server, the protocol check a client runs on a descriptor,
 * the build tools and devdocs all read versions through this one module.
 */
export const MAX_VERSION_CHARS = 64;

export interface SemVer { major: number; minor: number; patch: number; prerelease: readonly (string | number)[] }

const NUMBER = "(?:0|[1-9][0-9]*)";
const IDENTIFIER = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
const PATTERN = new RegExp(`^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`);

/** The parsed version, or null for anything that is not strict semver of at most 64 characters. */
export function parseSemver(value: unknown): SemVer | null {
  if (typeof value !== "string" || value.length > MAX_VERSION_CHARS) return null;
  const match = PATTERN.exec(value);
  if (!match) return null;
  const numbers = [match[1], match[2], match[3]].map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  const prerelease = match[4] === undefined ? [] : match[4].split(".").map(part => /^[0-9]+$/.test(part) ? Number(part) : part);
  if (prerelease.some(part => typeof part === "number" && !Number.isSafeInteger(part))) return null;
  return { major: numbers[0]!, minor: numbers[1]!, patch: numbers[2]!, prerelease };
}

export function isSemver(value: unknown): value is string { return parseSemver(value) !== null; }

/** Throws with the value named, for build tools and configuration. */
export function semver(value: unknown, what = "version"): string {
  if (!isSemver(value)) throw new Error(`${what} must be MAJOR.MINOR.PATCH with an optional -prerelease, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * Semver precedence: negative when `a` is older than `b`, zero when equal, positive when newer.
 * A prerelease is older than its release; prerelease identifiers compare numerically when both are
 * numbers, as ASCII text otherwise, a number before text, and a shorter list before a longer one
 * that starts the same. Throws on anything that is not strict semver.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a), right = parseSemver(b);
  if (!left || !right) throw new Error(`Not a version: ${JSON.stringify(left ? b : a)}`);
  for (const key of ["major", "minor", "patch"] as const) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const x = left.prerelease[index], y = right.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
