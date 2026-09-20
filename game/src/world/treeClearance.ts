import type { Vec3 } from "../contracts.js";

/**
 * A local convex walking footprint that tree trunks must stay out of. Plain arithmetic, shared by the
 * scatter's exclusion zones and by the server, which filters its baked tree list without the scatter.
 */
export interface TreeClearance {
  id: string;
  /** Counterclockwise convex hull in XZ, with point and segment degeneracies retained. */
  hull: readonly (readonly [number, number])[];
  bodyRadius: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** One point makes a disc, two make an exact capsule, and more points reserve their convex interior. Null for no points. */
export function treeClearanceZone(points: readonly Vec3[], bodyRadius: number, id = ""): TreeClearance | null {
  if (!Number.isFinite(bodyRadius) || bodyRadius < 0) throw new Error("Tree clearance needs a finite nonnegative body radius.");
  if (points.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[2]))) {
    throw new Error("Tree clearance needs finite XZ positions.");
  }
  if (points.length === 0) return null;
  const hull = treeClearanceHull(points);
  return {
    id, hull, bodyRadius,
    bounds: {
      minX: Math.min(...hull.map((point) => point[0])), maxX: Math.max(...hull.map((point) => point[0])),
      minZ: Math.min(...hull.map((point) => point[1])), maxZ: Math.max(...hull.map((point) => point[1])),
    },
  };
}

/** Tests the final trunk origin against each body footprint expanded by that trunk's radius. */
export function treeClearanceBlocks(zones: readonly TreeClearance[], x: number, z: number, trunkRadius: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(trunkRadius) || trunkRadius < 0) {
    throw new Error("Tree clearance query needs finite XZ and a nonnegative trunk radius.");
  }
  for (const zone of zones) {
    // Endpoint subtraction can place exact contact a few ulps outside a diagonal capsule.
    // Scale the rounding allowance to world coordinates; it remains picometres on this island.
    const rounding = 16 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(z),
      Math.abs(zone.bounds.minX), Math.abs(zone.bounds.maxX), Math.abs(zone.bounds.minZ), Math.abs(zone.bounds.maxZ));
    const reach = zone.bodyRadius + trunkRadius + rounding;
    // There are few authored walking footprints. Skip their boxes before doing polygon work.
    if (x < zone.bounds.minX - reach || x > zone.bounds.maxX + reach
      || z < zone.bounds.minZ - reach || z > zone.bounds.maxZ + reach) continue;
    const squaredReach = reach * reach;
    const first = zone.hull[0]!;
    if (zone.hull.length === 1) {
      if ((x - first[0]) ** 2 + (z - first[1]) ** 2 <= squaredReach) return true;
      continue;
    }
    let inside = zone.hull.length > 2;
    const edges = zone.hull.length === 2 ? 1 : zone.hull.length;
    for (let index = 0; index < edges; index += 1) {
      const from = zone.hull[index]!;
      const to = zone.hull[(index + 1) % zone.hull.length]!;
      const dx = to[0] - from[0], dz = to[1] - from[1];
      const px = x - from[0], pz = z - from[1];
      if (dx * pz - dz * px < 0) inside = false;
      const fraction = Math.max(0, Math.min(1, (px * dx + pz * dz) / (dx * dx + dz * dz)));
      if ((px - dx * fraction) ** 2 + (pz - dz * fraction) ** 2 <= squaredReach) return true;
    }
    if (inside) return true;
  }
  return false;
}

/** A standalone set of clearances, for a caller that has trees but no scatter. */
export class TreeClearances {
  private readonly zones: TreeClearance[] = [];
  addTreeClearance(points: readonly Vec3[], bodyRadius: number, id = ""): this {
    const zone = treeClearanceZone(points, bodyRadius, id);
    if (zone) this.zones.push(zone);
    return this;
  }
  blocksTreeClearance(x: number, z: number, trunkRadius: number): boolean {
    return treeClearanceBlocks(this.zones, x, z, trunkRadius);
  }
}

/** Copy, deduplicate and remove interior points without changing the caller's authored array. */
function treeClearanceHull(points: readonly Vec3[]): [number, number][] {
  const sorted = points.map((point): [number, number] => [point[0], point[2]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, index, all) => index === 0 || point[0] !== all[index - 1]![0] || point[1] !== all[index - 1]![1]);
  if (sorted.length <= 2) return sorted;
  const cross = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
    (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  const half = (ordered: readonly [number, number][]): [number, number][] => {
    const hull: [number, number][] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
