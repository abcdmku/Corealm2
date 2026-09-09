import type { Vec3 } from "../contracts.js";

/** Keep interpolation on terrain only when both simulation endpoints stand on it. */
export function interpolatedGroundHeight(previous: Vec3, current: Vec3, drawn: Vec3,
  heightAt: (x: number, z: number) => number): number {
  if (Math.abs(previous[1] - heightAt(previous[0], previous[2])) > 0.02
    || Math.abs(current[1] - heightAt(current[0], current[2])) > 0.02) return drawn[1];
  const height = heightAt(drawn[0], drawn[2]);
  return Number.isFinite(height) ? height : drawn[1];
}
