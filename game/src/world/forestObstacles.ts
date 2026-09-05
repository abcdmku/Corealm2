import type { Vec3 } from "../contracts.js";
import type { ForestTreeDescriptor } from "./forestResources.js";
import { SpatialIndex } from "./spatial.js";

type Trunk = Pick<ForestTreeDescriptor, "id" | "position" | "trunkRadius">;
const SKIN = 0.002;

/** Resident trunks are dynamic circles; they never require a terrain or navmesh rebuild. */
export class ForestObstacles {
  private readonly trunks = new Map<string, Trunk>();
  private readonly spatial = new SpatialIndex(8);
  private readonly candidates: Trunk[] = [];
  private largestRadius = 0;

  get size(): number { return this.trunks.size; }

  upsert(tree: Trunk): void {
    if (!Number.isFinite(tree.trunkRadius) || tree.trunkRadius <= 0) {
      this.remove(tree.id);
      return;
    }
    this.trunks.set(tree.id, tree);
    this.spatial.insert(tree.id, [tree.position[0], 0, tree.position[2]]);
    this.largestRadius = Math.max(this.largestRadius, tree.trunkRadius);
  }

  remove(id: string): void {
    this.trunks.delete(id);
    this.spatial.remove(id);
  }

  clear(): void {
    this.trunks.clear();
    this.spatial.clear();
    this.largestRadius = 0;
  }

  /** Resident trunk overlap for placement review, using the same height and radius rules as movement. */
  overlaps(position: Vec3, radius: number): string[] {
    this.collect(position, position, radius);
    return this.candidates.filter((trunk) =>
      Math.hypot(position[0] - trunk.position[0], position[2] - trunk.position[2]) < trunk.trunkRadius + radius,
    ).map((trunk) => trunk.id).sort();
  }

  /** Continuous collision prevents a long step from crossing a narrow trunk between endpoints. */
  resolve(desired: Vec3, from: Vec3, radius: number): Vec3 {
    if (this.trunks.size === 0) return desired;
    this.collect(from, desired, radius);
    if (this.candidates.length === 0) return desired;
    let x = from[0];
    let z = from[2];
    let dx = desired[0] - x;
    let dz = desired[2] - z;
    for (let pass = 0; pass < 4 && dx * dx + dz * dz > 1e-12; pass += 1) {
      // Finish overlap projection before sweeping. Changing the direction midway through a
      // sweep would invalidate every contact already checked earlier in its candidate list.
      for (let projection = 0; projection < 4; projection += 1) {
        let changed = false;
        for (const trunk of this.candidates) {
          const reach = trunk.trunkRadius + radius;
          const ox = x - trunk.position[0];
          const oz = z - trunk.position[2];
          const distanceSq = ox * ox + oz * oz;
          if (distanceSq < reach * reach - 1e-7 && distanceSq > 1e-10) {
            // Loading/respawning under the player permits escape at normal walking speed.
            const inward = ox * dx + oz * dz;
            if (inward < -1e-10) {
              dx -= ox * inward / distanceSq;
              dz -= oz * inward / distanceSq;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      let first = 1;
      let hit: Trunk | undefined;
      for (const trunk of this.candidates) {
        const reach = trunk.trunkRadius + radius;
        const ox = x - trunk.position[0];
        const oz = z - trunk.position[2];
        if (ox * ox + oz * oz < reach * reach - 1e-7 && ox * dx + oz * dz < -1e-9) {
          // Conflicting initial overlaps may need more projection passes than this frame allows.
          // Keep the accepted position rather than deepening an earlier overlap.
          return [x, desired[1], z];
        }
        const time = entryTime(x, z, dx, dz, trunk, reach);
        if (time !== null && time < first) { first = time; hit = trunk; }
      }
      if (!hit) { x += dx; z += dz; break; }
      const length = Math.hypot(dx, dz);
      const travel = Math.max(0, first - SKIN / length);
      x += dx * travel;
      z += dz * travel;
      dx *= 1 - travel;
      dz *= 1 - travel;
      const nx = x - hit.position[0];
      const nz = z - hit.position[2];
      const normalSq = nx * nx + nz * nz;
      const inward = (dx * nx + dz * nz) / normalSq;
      if (inward < 0) { dx -= nx * inward; dz -= nz * inward; }
    }
    return Math.abs(x - desired[0]) + Math.abs(z - desired[2]) < 1e-9 ? desired : [x, desired[1], z];
  }

  /** A short waypoint around the first obstructing trunk; the caller keeps its original path. */
  waypoint(from: Vec3, toward: Vec3, radius: number, accept?: (candidate: Vec3) => boolean): Vec3 | null {
    if (this.trunks.size === 0) return null;
    const dx = toward[0] - from[0];
    const dz = toward[2] - from[2];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return null;
    const scale = Math.min(1, 4 / length);
    const end: Vec3 = [from[0] + dx * scale, toward[1], from[2] + dz * scale];
    this.collect(from, end, radius + 0.3);
    let blocker: Trunk | undefined;
    let earliest = Infinity;
    for (const trunk of this.candidates) {
      const reach = trunk.trunkRadius + radius + 0.08;
      // There is no route into a trunk. Returning another ring point would orbit forever;
      // Movement can then report the unreachable endpoint through its bounded stuck recovery.
      if (Math.hypot(toward[0] - trunk.position[0], toward[2] - trunk.position[2]) < trunk.trunkRadius + radius) return null;
      const gap = Math.hypot(from[0] - trunk.position[0], from[2] - trunk.position[2]);
      if (gap < reach && (from[0] - trunk.position[0]) * dx + (from[2] - trunk.position[2]) * dz >= 0) continue;
      const time = gap < reach ? 0 : entryTime(from[0], from[2], dx * scale, dz * scale, trunk, reach);
      if (time !== null && time < earliest) { earliest = time; blocker = trunk; }
    }
    if (!blocker) return null;
    const bx = blocker.position[0];
    const bz = blocker.position[2];
    const gap = Math.hypot(from[0] - bx, from[2] - bz);
    const reach = blocker.trunkRadius + radius;
    const angle = gap > 1e-6 ? Math.atan2(from[2] - bz, from[0] - bx) : Math.atan2(dz, dx);
    const advance = Math.min(Math.PI / 3, Math.acos(Math.min(1, reach / Math.max(gap, reach))) * 0.7 + 0.35);
    let best: Vec3 | null = null;
    let bestCost = Infinity;
    for (const side of [1, -1]) {
      const a = angle + side * advance;
      const point: Vec3 = [bx + Math.cos(a) * (reach + 0.24), from[1], bz + Math.sin(a) * (reach + 0.24)];
      let blocked = false;
      for (const other of this.candidates) {
        if (other === blocker) continue;
        const otherReach = other.trunkRadius + radius + 0.04;
        if (entryTime(from[0], from[2], point[0] - from[0], point[2] - from[2], other, otherReach) !== null
          || Math.hypot(point[0] - other.position[0], point[2] - other.position[2]) < otherReach) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (accept && !accept(point)) continue;
      const cost = Math.hypot(point[0] - from[0], point[2] - from[2])
        + Math.hypot(toward[0] - point[0], toward[2] - point[2]);
      if (cost < bestCost) { best = point; bestCost = cost; }
    }
    return best;
  }

  private collect(from: Vec3, to: Vec3, radius: number): void {
    this.candidates.length = 0;
    const centre: Vec3 = [(from[0] + to[0]) / 2, 0, (from[2] + to[2]) / 2];
    const reach = Math.hypot(to[0] - from[0], to[2] - from[2]) / 2 + radius + this.largestRadius;
    this.spatial.forEachInRadius(centre, reach, (id) => {
      const trunk = this.trunks.get(id)!;
      const base = trunk.position[1];
      // Do not collide with a forest on a different terrace or above a dungeon floor.
      if (Math.max(from[1], to[1]) < base - 1.8 || Math.min(from[1], to[1]) > base + 3) return;
      this.candidates.push(trunk);
    });
  }
}

function entryTime(x: number, z: number, dx: number, dz: number, trunk: Trunk, radius: number): number | null {
  const ox = x - trunk.position[0];
  const oz = z - trunk.position[2];
  const a = dx * dx + dz * dz;
  const b = ox * dx + oz * dz;
  if (a < 1e-12 || b >= 0) return null;
  const discriminant = b * b - a * (ox * ox + oz * oz - radius * radius);
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
