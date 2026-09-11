/** An older volcanic rock body exposed by the channel cut. Coordinates and crown are world metres. */
export interface LavaRockMass {
  readonly id: string;
  readonly polygon: readonly (readonly [number, number])[];
  readonly crown: number;
}

const boundsCache = new WeakMap<LavaRockMass, readonly number[]>();
export function rockMassBounds(mass: LavaRockMass): readonly number[] {
  let bounds = boundsCache.get(mass);
  if (!bounds) {
    bounds = [Math.min(...mass.polygon.map(p => p[0])) - 3, Math.max(...mass.polygon.map(p => p[0])) + 3,
      Math.min(...mass.polygon.map(p => p[1])) - 3, Math.max(...mass.polygon.map(p => p[1])) + 3];
    boundsCache.set(mass, bounds);
  }
  return bounds;
}

/** Negative inside the authored fracture outline. */
export function rockMassDistance(mass: LavaRockMass, x: number, z: number): number {
  let inside = false, distance = Infinity;
  for (let i = 0, j = mass.polygon.length - 1; i < mass.polygon.length; j = i++) {
    const a = mass.polygon[j]!, b = mass.polygon[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    distance = Math.min(distance, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
  }
  return inside ? -distance : distance;
}

export function rockMassHeight(base: number, x: number, z: number, mass: LavaRockMass): number {
  const bounds = rockMassBounds(mass);
  if (x < bounds[0]! || x > bounds[1]! || z < bounds[2]! || z > bounds[3]!) return base;
  const d = rockMassDistance(mass, x, z);
  if (d >= 3) return base;
  // A broad resistant crown with a short, steep face and a low debris foot. The
  // polygon supplies coherent fracture-scale setbacks, rather than vertex noise.
  const t = Math.max(0, Math.min(1, (2 - d) / 3));
  const wall = t * t * (3 - 2 * t);
  return base + Math.max(0, mass.crown - base) * wall;
}
