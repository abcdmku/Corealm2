import type { EntityId, RegionId, SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "../app/config.js";
import type { DungeonDef } from "../content/regions.js";
import { dungeonFloorHeight, type DungeonSpec } from "../render/dungeon.js";

type DoorBox = Extract<SolidVolume, { kind: "box" }>;

/** Door leaf dimensions in the threshold's local frame. Position.y is its physical base. */
export interface DungeonDoorBarrier {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly size: readonly [number, number, number];
  readonly rotationY: number;
}

export interface DungeonDoorThreshold {
  readonly id: EntityId;
  /** Common frame for the gate assets and masonry. Local +Z faces the approach. */
  readonly origin: Vec3;
  readonly rotationY: number;
  readonly barrier: DungeonDoorBarrier;
  readonly staticSolids: readonly DoorBox[];
  readonly walls: readonly {
    readonly minX: number;
    readonly maxX: number;
    /** Local Y, sampled from the same floor as the collider. */
    readonly bottomAt: (x: number) => number;
    readonly height: number;
  }[];
}

export interface DungeonDoorThresholdSpec {
  readonly id: EntityId;
  readonly position: readonly [number, number];
  readonly rotationY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly wallHeight?: number;
}

const APERTURE = 3.2;
const PARTITION_DEPTH = 1.2;
const FRAME_TOP = 4.15;
const LEAF_HEIGHT = 3.4;
const LEAF_DEPTH = 0.32;

/** Authored spans reach beyond the generated cavern floor, including its hidden edge cells. */
const AUTHORED_THRESHOLDS: Readonly<Record<string, Omit<DungeonDoorThresholdSpec, "id" | "position">>> = {
  gravelmaw_stone_door: { rotationY: 0.41822432957922906, minX: -14, maxX: 13 },
  ordrun_gate: { rotationY: 0.5404195002705842, minX: -13, maxX: 14.5 },
};

/** Native-metre production geometry and collision, shared by authored doors and compact fixtures. */
export function createDungeonDoorThreshold(
  spec: DungeonDoorThresholdSpec,
  floorAt: (x: number, z: number) => number,
): DungeonDoorThreshold {
  if (spec.minX >= -APERTURE / 2 || spec.maxX <= APERTURE / 2) {
    throw new Error(`Dungeon door ${spec.id} has no masonry beside its aperture`);
  }
  const cos = Math.cos(spec.rotationY);
  const sin = Math.sin(spec.rotationY);
  const ground = (x: number, z: number): number => floorAt(
    spec.position[0] + x * cos + z * sin,
    spec.position[1] - x * sin + z * cos,
  );
  let gateBase = Infinity;
  for (const x of [-APERTURE / 2, 0, APERTURE / 2]) {
    for (const z of [-LEAF_DEPTH / 2, 0, LEAF_DEPTH / 2]) gateBase = Math.min(gateBase, ground(x, z));
  }
  gateBase -= 0.1;
  const origin: Vec3 = [spec.position[0], gateBase, spec.position[1]];
  const height = spec.wallHeight ?? 13.5;
  const bottomAt = (x: number): number => Math.min(
    ground(x, -PARTITION_DEPTH / 2), ground(x, 0), ground(x, PARTITION_DEPTH / 2),
  ) - 0.5 - gateBase;
  const walls = [
    { minX: spec.minX, maxX: -APERTURE / 2, bottomAt, height },
    { minX: APERTURE / 2, maxX: spec.maxX, bottomAt, height },
    { minX: -APERTURE / 2, maxX: APERTURE / 2, bottomAt: () => FRAME_TOP, height: height - FRAME_TOP },
  ];
  const staticSolids: DoorBox[] = [];
  for (const [wallIndex, wall] of walls.entries()) {
    const count = Math.ceil((wall.maxX - wall.minX) / 2);
    const width = (wall.maxX - wall.minX) / count;
    for (let index = 0; index < count; index += 1) {
      const minX = wall.minX + index * width;
      const maxX = minX + width;
      const x = (minX + maxX) / 2;
      const bottoms = [wall.bottomAt(minX), wall.bottomAt(x), wall.bottomAt(maxX)];
      const base = Math.min(...bottoms);
      const top = Math.max(...bottoms) + wall.height;
      staticSolids.push({
        kind: "box", id: `${spec.id}:partition:${wallIndex}:${index}`,
        position: [origin[0] + x * cos, gateBase + base, origin[2] - x * sin],
        size: [width, top - base, PARTITION_DEPTH], rotationY: spec.rotationY,
        ...(wallIndex === 2 ? { elevated: true } : {}),
      });
    }
  }
  return {
    id: spec.id, origin, rotationY: spec.rotationY, walls, staticSolids,
    barrier: { id: spec.id, position: [...origin],
      size: [APERTURE, LEAF_HEIGHT, LEAF_DEPTH], rotationY: spec.rotationY },
  };
}

/** floorBase is resolved by world placement; it must not be inferred from surface terrain here. */
export function authoredThresholds(dungeon: DungeonDef, floorBase: number): DungeonDoorThreshold[] {
  const floorSpec: DungeonSpec = {
    regionId: dungeon.id, corridors: [], wallHeight: 13,
    chambers: dungeon.chambers.map((chamber) => ({
      ...chamber, centre: [...chamber.centre] as [number, number], floorY: floorBase + chamber.floorOffset,
    })),
  };
  return dungeon.doors.map((door) => {
    const layout = AUTHORED_THRESHOLDS[door.id];
    if (!layout) throw new Error(`Missing authored threshold for dungeon door ${door.id}`);
    return createDungeonDoorThreshold({ id: door.id, position: door.position, ...layout },
      (x, z) => dungeonFloorHeight(floorSpec, x, z));
  });
}

export function createDungeonDoorEntities(threshold: DungeonDoorThreshold, options: {
  regionId: RegionId;
  tier: number;
  name: string;
  state: string;
  lockedReason: string;
}): SemanticEntity[] {
  const closedAssetId = "corealm_dungeon_portcullis";
  const openAssetId = "corealm_dungeon_portcullis_open";
  const open = options.state === "open" || options.state === "unbarred";
  return [{
    id: threshold.id, archetype: "door", name: options.name, tier: options.tier,
    regionId: options.regionId, position: [...threshold.origin], state: options.state,
    interactions: ["inspect", "open"],
    view: { assetId: open ? openAssetId : closedAssetId, scale: 1,
      rotationY: threshold.rotationY, labelHeight: 3.6 },
    meta: { dungeonDoor: true, lockedReason: options.lockedReason, closedAssetId, openAssetId,
      barrierWidth: APERTURE, barrierHeight: LEAF_HEIGHT, barrierDepth: LEAF_DEPTH },
  }, {
    id: `${threshold.id}:frame`, archetype: "landmark", name: `${options.name} frame`,
    tier: options.tier, regionId: options.regionId, position: [...threshold.origin],
    state: "present", interactions: [],
    view: { assetId: "corealm_dungeon_gate_frame", scale: 1,
      rotationY: threshold.rotationY, labelHeight: FRAME_TOP },
    meta: { scenery: true, dungeonDoorFrame: true, doorId: threshold.id },
  }];
}

interface Barrier {
  readonly box: DoorBox;
  readonly cos: number;
  readonly sin: number;
}

interface Contact {
  time: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

const SKIN = 0.002;
const FOOT_SLACK = 0.5;

/** Stateful door leaves share one swept collision rule with navigation queries. */
export class DungeonDoors {
  private readonly barriers: readonly Barrier[];

  constructor(
    barriers: readonly DungeonDoorBarrier[],
    private readonly getEntity: (id: EntityId) => Pick<SemanticEntity, "archetype" | "state"> | undefined,
  ) {
    const ids = new Set<string>();
    this.barriers = barriers.map((barrier): Barrier => {
      if (ids.has(barrier.id)) throw new Error(`Duplicate dungeon door barrier: ${barrier.id}`);
      if (![...barrier.position, ...barrier.size, barrier.rotationY].every(Number.isFinite)
        || barrier.size.some((extent) => extent <= 0)) {
        throw new Error(`Invalid dungeon door barrier: ${barrier.id}`);
      }
      ids.add(barrier.id);
      return {
        box: { kind: "box", id: barrier.id, position: [...barrier.position],
          size: [...barrier.size], rotationY: barrier.rotationY },
        cos: Math.cos(barrier.rotationY), sin: Math.sin(barrier.rotationY),
      };
    });
  }

  /** Read state on demand, including after save replacement and quest-driven transitions. */
  private closed(barrier: Barrier): boolean {
    const entity = this.getEntity(barrier.box.id);
    return entity?.archetype !== "door" || (entity.state !== "open" && entity.state !== "unbarred");
  }

  getSolids(): DoorBox[] {
    return this.barriers.filter((barrier) => this.closed(barrier)).map(({ box }) => ({
      ...box, position: [...box.position], size: [...box.size],
    }));
  }

  contains(point: Vec3): boolean {
    return this.barriers.some((barrier) => {
      if (!this.closed(barrier)) return false;
      const { box, cos, sin } = barrier;
      if (point[1] >= box.position[1] + box.size[1] || point[1] + FOOT_SLACK < box.position[1]) return false;
      const dx = point[0] - box.position[0];
      const dz = point[2] - box.position[2];
      return Math.abs(dx * cos - dz * sin) < box.size[0] / 2
        && Math.abs(dx * sin + dz * cos) < box.size[2] / 2;
    });
  }

  /** Whole-segment collision also protects long frames and paths planned before a door closes. */
  resolve(desired: Vec3, from: Vec3, radius: number): Vec3 {
    let position: Vec3 = from;
    let target: Vec3 = desired;
    for (let pass = 0; pass < 3; pass += 1) {
      const contact = this.firstContact(position, target, radius);
      if (!contact) return target;
      const dx = target[0] - position[0];
      const dy = target[1] - position[1];
      const dz = target[2] - position[2];
      const length = Math.hypot(dx, dy, dz);
      const travel = Math.max(0, contact.time - SKIN / Math.max(length, SKIN));
      position = [position[0] + dx * travel, position[1] + dy * travel, position[2] + dz * travel];
      let remainingX = dx * (1 - travel);
      let remainingY = dy * (1 - travel);
      let remainingZ = dz * (1 - travel);
      const inward = remainingX * contact.normalX + remainingY * contact.normalY + remainingZ * contact.normalZ;
      if (inward < 0) {
        remainingX -= contact.normalX * inward;
        remainingY -= contact.normalY * inward;
        remainingZ -= contact.normalZ * inward;
      }
      if (Math.hypot(remainingX, remainingY, remainingZ) < 1e-8) return position;
      target = [position[0] + remainingX, position[1] + remainingY, position[2] + remainingZ];
    }
    return position;
  }

  blocksSegment(from: Vec3, to: Vec3, radius = PLAYER_RADIUS): boolean {
    return this.firstContact(from, to, radius) !== null;
  }

  pathIsClear(path: readonly Vec3[], radius = PLAYER_RADIUS): boolean {
    if (path.length === 1) return !this.blocksSegment(path[0]!, path[0]!, radius);
    for (let index = 1; index < path.length; index += 1) {
      if (this.blocksSegment(path[index - 1]!, path[index]!, radius)) return false;
    }
    return true;
  }

  /** A partial route stops at the near face, so walking up to a locked door remains possible. */
  clipPath(path: readonly Vec3[], radius = PLAYER_RADIUS): { path: Vec3[]; blocked: boolean } {
    if (path.length === 0) return { path: [], blocked: false };
    const accepted: Vec3[] = [[...path[0]!]];
    if (path.length === 1) return { path: accepted, blocked: this.blocksSegment(path[0]!, path[0]!, radius) };
    for (let index = 1; index < path.length; index += 1) {
      const from = path[index - 1]!;
      const to = path[index]!;
      const contact = this.firstContact(from, to, radius);
      if (!contact) {
        accepted.push([...to]);
        continue;
      }
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const travel = Math.max(0, contact.time - SKIN / Math.max(length, SKIN));
      if (travel > 1e-8) accepted.push([
        from[0] + (to[0] - from[0]) * travel,
        from[1] + (to[1] - from[1]) * travel,
        from[2] + (to[2] - from[2]) * travel,
      ]);
      return { path: accepted, blocked: true };
    }
    return { path: accepted, blocked: false };
  }

  private firstContact(from: Vec3, to: Vec3, radius: number): Contact | null {
    let first: Contact | null = null;
    for (const barrier of this.barriers) {
      if (!this.closed(barrier)) continue;
      const contact = sweep(barrier, from, to, radius);
      if (contact && (!first || contact.time < first.time)) first = contact;
    }
    return first;
  }
}

function sweep(barrier: Barrier, from: Vec3, to: Vec3, radius: number): Contact | null {
  const { box, cos, sin } = barrier;
  const lowY = box.position[1] - PLAYER_HEIGHT;
  const highY = box.position[1] + box.size[1] + FOOT_SLACK;
  if (Math.max(from[1], to[1]) <= lowY || Math.min(from[1], to[1]) >= highY) return null;
  const offsetX = from[0] - box.position[0];
  const offsetZ = from[2] - box.position[2];
  const x = offsetX * cos - offsetZ * sin;
  const z = offsetX * sin + offsetZ * cos;
  const worldDx = to[0] - from[0];
  const worldDz = to[2] - from[2];
  const dx = worldDx * cos - worldDz * sin;
  const dy = to[1] - from[1];
  const dz = worldDx * sin + worldDz * cos;
  const halfX = box.size[0] / 2 + radius;
  const halfZ = box.size[2] / 2 + radius;
  const y = from[1] - (lowY + highY) / 2;
  const halfY = (highY - lowY) / 2;
  const axes = [
    [x, dx, halfX, cos, 0, -sin],
    [z, dz, halfZ, sin, 0, cos],
    [y, dy, halfY, 0, 1, 0],
  ] as const;

  if (Math.abs(x) < halfX && Math.abs(z) < halfZ && Math.abs(y) < halfY) {
    // If a saved position overlaps a newly closed door, permit escape toward the nearest face
    // without teleporting it or allowing motion farther through the leaf.
    let nearest: (typeof axes)[number] = axes[0];
    for (const axis of axes) if (axis[2] - Math.abs(axis[0]) < nearest[2] - Math.abs(nearest[0])) nearest = axis;
    const [coordinate, direction, , axisX, axisY, axisZ] = nearest;
    const side = coordinate === 0 ? Math.sign(direction) || 1 : Math.sign(coordinate);
    if (direction * side >= 0 && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-10) return null;
    return {
      time: 0,
      normalX: side * axisX,
      normalY: side * axisY,
      normalZ: side * axisZ,
    };
  }

  let enter = 0;
  let exit = 1;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  for (const [position, delta, halfExtent, axisX, axisY, axisZ] of axes) {
    if (Math.abs(delta) < 1e-10) {
      if (Math.abs(position) >= halfExtent) return null;
      continue;
    }
    const first = (-halfExtent - position) / delta;
    const last = (halfExtent - position) / delta;
    const near = Math.min(first, last);
    const far = Math.max(first, last);
    if (near >= enter) {
      enter = near;
      const side = delta > 0 ? -1 : 1;
      normalX = axisX * side;
      normalY = axisY * side;
      normalZ = axisZ * side;
    }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1 || normalX === 0 && normalY === 0 && normalZ === 0) return null;
  return { time: enter, normalX, normalY, normalZ };
}
