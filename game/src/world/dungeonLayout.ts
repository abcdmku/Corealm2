import type { RegionId, Vec3 } from "../contracts.js";

/**
 * The authored shape of the dungeon and the two floor queries the simulation asks of it.
 * Plain data and arithmetic, so the server reads a chamber floor without loading the cavern renderer.
 */
export interface ChamberSpec {
  id: string;
  name: string;
  /** World-space centre. */
  centre: [number, number];
  radius: number;
  /** Absolute floor height. */
  floorY: number;
  lit: boolean;
}

export interface CorridorSpec {
  from: [number, number];
  to: [number, number];
  fromY: number;
  toY: number;
  width: number;
}

export interface DungeonSpec {
  regionId: RegionId;
  chambers: ChamberSpec[];
  corridors: CorridorSpec[];
  /** Interior height, floor to ceiling. */
  wallHeight: number;
}

/**
 * The height of the cavern floor at a world XZ.
 *
 * Inverse-distance weighting over the authored chamber floors, cubed. The exponent is the whole
 * design: at p = 3 the surface is within 0.21 m of the authored floor height across a chamber's own
 * disc, and the steepest gradient between two chambers is `drop * p / separation` = 4 * 3 / 20.6 =
 * 30 degrees, which clears the player's 64-degree uphill limit with margin. p = 2 would flatten the
 * ramp to 21 degrees but bow each chamber floor 0.88 m below its authored height at the rim; p = 4
 * holds the floors flat but ramps at 38 degrees.
 */
export function dungeonFloorHeight(spec: DungeonSpec, x: number, z: number): number {
  let weighted = 0;
  let total = 0;
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(x - chamber.centre[0], z - chamber.centre[1]);
    const weight = 1 / (distance * distance * distance + 0.05);
    weighted += chamber.floorY * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

/** Where a chamber's floor actually is, for placing entities on it. */
export function chamberFloorAt(spec: DungeonSpec, point: Vec3): number | null {
  for (const chamber of spec.chambers) {
    const distance = Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]);
    // The blended surface, not `chamber.floorY`. The two differ by up to 2.4 m near the mouth of a
    // chamber that overlaps a deeper one, and returning the authored constant is what left dungeon
    // entities standing in the air over the ramp down to the next room.
    if (distance <= chamber.radius) return dungeonFloorHeight(spec, point[0], point[2]);
  }
  return null;
}
