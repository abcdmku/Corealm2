/**
 * Solid volumes: the one place that answers "is this point inside something" and "where does this
 * step actually end up".
 *
 * Why this file exists, measured before it was written (runs/corealm/diagnosis/collision-*.md):
 * the entire world held 40 colliders — one terrain heightfield and 39 boxes derived from the 36
 * authored buildings — while 892 semantic entities registered no volume at all. Walking straight
 * lines through the bank chest (+1.30 m past its centre), the anvil (+2.56 m), a market stall
 * (+2.56 m), an NPC (+1.38 m), an enemy (+3.40 m), a tree trunk (+1.04 m) and 13.86 m across a
 * pond floor was all reproducible in one session.
 *
 * Navigation owns the player's position. This is pure geometry over the volume list the
 * world layer produces — no stepping, no RNG, no state of its own. The navmesh stays authoritative
 * for where the player may stand; this clamps the step that gets there.
 *
 * The broadphase is the same uniform-grid idea as `world/spatial.ts`, reimplemented rather than
 * imported because `systems/` must not import `world/` (the layering rule runs the other way).
 * It is a different index anyway: that one holds entity points and is queried by radius, this one
 * holds volume footprints and is queried by a swept step. At ~900 volumes, a brute-force scan per
 * movement tick is 900 rotate-and-clamp tests 10 times a second; the grid makes it about 6.
 */
import type { SolidVolume, Vec3 } from "../contracts.js";
import { PLAYER_HEIGHT } from "../app/config.js";

/**
 * Grid cell edge in metres.
 *
 * Sized off the query, not off the volumes: a movement step is at most 0.42 m and the player
 * radius is 0.35 m, so a resolve touches one cell almost always and four at a cell corner. 8 m
 * keeps the largest authored building (a 12 x 8 m hall) inside four cells rather than spraying it
 * across sixty, which is what a 2 m cell would do.
 */
const CELL_SIZE = 8;

/** Same packing trick as `world/spatial.ts`: exact, allocation-free, no string keys. */
const KEY_OFFSET = 1 << 15;
const KEY_SPAN = 1 << 16;

/**
 * How far BELOW the queried point a volume still counts as blocking it.
 *
 * The player walks on the navmesh and the navmesh floats above the drawn ground: measured at four
 * places, +0.147 m at Coldbrace square, +0.274 m on the fallen duskoak, +0.341 m at the far tarn,
 * +0.417 m on the ridge pines. Volume bases come from the terrain field instead. Without this
 * slack a 0.4 m fence whose base sits at the drawn ground reads as entirely below the player's
 * feet and stops blocking.
 */
const FOOT_SLACK = 0.5;

/** Push-out iterations. Two volumes meeting at a corner need a second pass; three is plenty. */
const RESOLVE_PASSES = 3;

/** Below this the point is treated as sitting exactly on a volume's axis and pushed along +X. */
const DEGENERATE = 1e-6;

interface BoxEntry {
  kind: 0;
  cx: number;
  cz: number;
  baseY: number;
  topY: number;
  halfX: number;
  halfZ: number;
  /** cos / sin of `rotationY`, so `resolve` never calls a trig function. */
  cos: number;
  sin: number;
  /** Footprint half-diagonal, for the grid and for the broad reject. */
  bound: number;
}

interface CylinderEntry {
  kind: 1;
  cx: number;
  cz: number;
  baseY: number;
  topY: number;
  radius: number;
  bound: number;
}

type Entry = BoxEntry | CylinderEntry;

export class Solids {
  private readonly entries: Entry[] = [];
  private readonly cells = new Map<number, number[]>();
  /** Reused across resolves. Movement is single-threaded and never re-entrant. */
  private readonly scratch: number[] = [];

  constructor(volumes: readonly SolidVolume[]) {
    for (const volume of volumes) {
      const entry = toEntry(volume);
      if (!entry) continue;
      const index = this.entries.length;
      this.entries.push(entry);
      this.insert(index, entry);
    }
  }

  count(): number {
    return this.entries.length;
  }

  /** How many grid cells hold at least one volume. Diagnostics only. */
  cellCount(): number {
    return this.cells.size;
  }

  /**
   * Is this point inside a volume?
   *
   * Used to refuse a teleport or a navmesh snap that landed somewhere no walk could reach — the
   * roof of the March Company Hall (y = 9.041, five walkable metres of ridge) and the ~1 m island
   * inside every cottage are both reachable today through `nav.closestPoint`, which every
   * teleport, region travel, focus-camera and respawn call goes through.
   */
  contains(point: Vec3): boolean {
    const x = point[0];
    const y = point[1];
    const z = point[2];
    let hit = false;
    this.forEachNear(x, z, 0, (entry) => {
      if (hit) return;
      if (y >= entry.topY) return;
      if (y + FOOT_SLACK < entry.baseY) return;
      hit = insideFootprint(entry, x, z);
    });
    return hit;
  }

  /**
   * XZ push-out with wall slide. Returns the corrected point; `y` is passed through untouched.
   *
   * The push is along the surface normal, which is what makes this a slide rather than a stop: the
   * component of the step running parallel to the wall survives the correction, so pressing W+A
   * into a wall walks along it instead of sticking. Nothing here reads `from` except to decide
   * which side of a volume the player came from when they are already exactly on its axis.
   */
  resolve(desired: Vec3, from: Vec3, radius: number): Vec3 {
    if (this.entries.length === 0) return desired;

    const y = desired[1];
    let x = desired[0];
    let z = desired[2];

    // Gather once over the swept step, then iterate: re-querying the grid with a point that the
    // last push already moved is how a corner turns into a jitter.
    const candidates = this.scratch;
    candidates.length = 0;
    const midX = (x + from[0]) * 0.5;
    const midZ = (z + from[2]) * 0.5;
    const reach = radius + Math.hypot(x - from[0], z - from[2]) * 0.5;
    this.forEachNear(midX, midZ, reach, (entry, index) => {
      if (y - FOOT_SLACK >= entry.topY) return;
      if (y + PLAYER_HEIGHT <= entry.baseY) return;
      candidates.push(index);
    });
    if (candidates.length === 0) return desired;

    for (let pass = 0; pass < RESOLVE_PASSES; pass += 1) {
      let moved = false;
      for (let i = 0; i < candidates.length; i += 1) {
        const entry = this.entries[candidates[i]!]!;
        const pushed = pushOut(entry, x, z, radius, from);
        if (!pushed) continue;
        x = pushed[0];
        z = pushed[1];
        moved = true;
      }
      if (!moved) break;
    }

    if (x === desired[0] && z === desired[2]) return desired;
    return [x, y, z];
  }

  // ----------------------------------------------------------- broadphase

  private insert(index: number, entry: Entry): void {
    const minCellX = Math.floor((entry.cx - entry.bound) / CELL_SIZE);
    const maxCellX = Math.floor((entry.cx + entry.bound) / CELL_SIZE);
    const minCellZ = Math.floor((entry.cz - entry.bound) / CELL_SIZE);
    const maxCellZ = Math.floor((entry.cz + entry.bound) / CELL_SIZE);
    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        const key = (cx + KEY_OFFSET) * KEY_SPAN + cz + KEY_OFFSET;
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(index);
      }
    }
  }

  /**
   * Visits every volume whose footprint could be within `radius` of (x, z). A volume straddling
   * several cells is visited once per cell it occupies, so `visit` must tolerate repeats — both
   * callers do, because a second push-out against a volume already resolved is a no-op.
   */
  private forEachNear(
    x: number,
    z: number,
    radius: number,
    visit: (entry: Entry, index: number) => void,
  ): void {
    const minCellX = Math.floor((x - radius) / CELL_SIZE);
    const maxCellX = Math.floor((x + radius) / CELL_SIZE);
    const minCellZ = Math.floor((z - radius) / CELL_SIZE);
    const maxCellZ = Math.floor((z + radius) / CELL_SIZE);
    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
      const column = (cx + KEY_OFFSET) * KEY_SPAN;
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        const bucket = this.cells.get(column + cz + KEY_OFFSET);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i += 1) {
          const index = bucket[i]!;
          const entry = this.entries[index]!;
          const dx = Math.abs(entry.cx - x);
          const dz = Math.abs(entry.cz - z);
          const reach = entry.bound + radius;
          if (dx > reach || dz > reach) continue;
          visit(entry, index);
        }
      }
    }
  }
}

// ------------------------------------------------------------------ geometry

function toEntry(volume: SolidVolume): Entry | null {
  const [x, baseY, z] = volume.position;
  if (!Number.isFinite(x) || !Number.isFinite(baseY) || !Number.isFinite(z)) return null;

  if (volume.kind === "cylinder") {
    if (!(volume.radius > 0) || !(volume.height > 0)) return null;
    return {
      kind: 1,
      cx: x,
      cz: z,
      baseY,
      topY: baseY + volume.height,
      radius: volume.radius,
      bound: volume.radius,
    };
  }

  const halfX = volume.size[0] * 0.5;
  const height = volume.size[1];
  const halfZ = volume.size[2] * 0.5;
  if (!(halfX > 0) || !(height > 0) || !(halfZ > 0)) return null;
  return {
    kind: 0,
    cx: x,
    cz: z,
    baseY,
    topY: baseY + volume.size[1],
    halfX,
    halfZ,
    cos: Math.cos(volume.rotationY),
    sin: Math.sin(volume.rotationY),
    bound: Math.hypot(halfX, halfZ),
  };
}

function insideFootprint(entry: Entry, x: number, z: number): boolean {
  if (entry.kind === 1) {
    const dx = x - entry.cx;
    const dz = z - entry.cz;
    return dx * dx + dz * dz < entry.radius * entry.radius;
  }
  const dx = x - entry.cx;
  const dz = z - entry.cz;
  // World -> local is a rotation by -rotationY. Three.js `makeRotationY(a)` is [c 0 s; 0 1 0; -s 0 c],
  // so local = (dx*c - dz*s, dx*s + dz*c).
  const lx = dx * entry.cos - dz * entry.sin;
  const lz = dx * entry.sin + dz * entry.cos;
  return Math.abs(lx) < entry.halfX && Math.abs(lz) < entry.halfZ;
}

/**
 * Smallest XZ translation that takes a circle of `radius` at (x, z) out of `entry`, or null when
 * it is already clear. Returns the corrected [x, z] rather than the normal, because every caller
 * wants the point and the normal is only ever used to build it.
 */
function pushOut(entry: Entry, x: number, z: number, radius: number, from: Vec3): [number, number] | null {
  if (entry.kind === 1) {
    const dx = x - entry.cx;
    const dz = z - entry.cz;
    const reach = entry.radius + radius;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= reach * reach) return null;
    if (distanceSq > DEGENERATE) {
      const distance = Math.sqrt(distanceSq);
      const scale = reach / distance;
      return [entry.cx + dx * scale, entry.cz + dz * scale];
    }
    // Dead on the axis: leave along the line the step came in on, so a straight walk into a trunk
    // comes back out the way it went in instead of picking an arbitrary side.
    const ax = from[0] - entry.cx;
    const az = from[2] - entry.cz;
    const length = Math.hypot(ax, az);
    if (length <= DEGENERATE) return [entry.cx + reach, entry.cz];
    return [entry.cx + (ax / length) * reach, entry.cz + (az / length) * reach];
  }

  const dx = x - entry.cx;
  const dz = z - entry.cz;
  const lx = dx * entry.cos - dz * entry.sin;
  const lz = dx * entry.sin + dz * entry.cos;

  const nearestX = lx < -entry.halfX ? -entry.halfX : lx > entry.halfX ? entry.halfX : lx;
  const nearestZ = lz < -entry.halfZ ? -entry.halfZ : lz > entry.halfZ ? entry.halfZ : lz;
  const ox = lx - nearestX;
  const oz = lz - nearestZ;
  const outsideSq = ox * ox + oz * oz;

  let localX: number;
  let localZ: number;
  if (outsideSq > DEGENERATE) {
    if (outsideSq >= radius * radius) return null;
    const outside = Math.sqrt(outsideSq);
    const scale = radius / outside;
    localX = nearestX + ox * scale;
    localZ = nearestZ + oz * scale;
  } else {
    // Centre is inside the footprint. Leave by the nearest face; that is the minimum translation
    // and it is what keeps a player who clipped a corner from being flung across the building.
    const gapX = entry.halfX - Math.abs(lx);
    const gapZ = entry.halfZ - Math.abs(lz);
    if (gapX <= gapZ) {
      localX = (lx < 0 ? -1 : 1) * (entry.halfX + radius);
      localZ = lz;
    } else {
      localX = lx;
      localZ = (lz < 0 ? -1 : 1) * (entry.halfZ + radius);
    }
  }

  // Local -> world: world = (lx*c + lz*s, -lx*s + lz*c).
  return [
    entry.cx + localX * entry.cos + localZ * entry.sin,
    entry.cz - localX * entry.sin + localZ * entry.cos,
  ];
}
